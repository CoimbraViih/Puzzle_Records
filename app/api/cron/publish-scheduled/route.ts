import { NextResponse } from "next/server";
import { getPublishingProvider, PublishError } from "@/lib/publishing";
import { listPostsPendingPublish } from "@/lib/posts/pendingPublish";
import { createServiceClient } from "@/lib/supabase/service";
import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";
import { notifyAccountDisconnected } from "@/lib/email/notifyAccountDisconnected";

function isAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

async function recordPublishError(postId: string, message: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ publish_error: message })
    .eq("id", postId);
  if (error) {
    console.error(
      `[publish-scheduled] falha ao gravar publish_error do post ${postId}:`,
      error.message
    );
  }
}

// Caso especifico: publish() teve sucesso no Zernio, mas a escrita do status
// falhou. Aqui gravamos publish_error + post_url juntos (sem mexer em status,
// que deve continuar 'aprovado' ate alguem investigar manualmente) — isso
// evita que "Tentar publicar novamente" fique disponivel sem o post_url
// registrado, o que causaria uma republicacao duplicada no Zernio.
async function recordPublishSucceededButStatusFailed(
  postId: string,
  postUrl: string
) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({
      publish_error: `Publicado no Zernio (${postUrl}) mas falha ao gravar o status — verificar manualmente.`,
      post_url: postUrl,
    })
    .eq("id", postId);
  if (error) {
    console.error(
      `[publish-scheduled] falha ao gravar publish_error/post_url do post ${postId}:`,
      error.message
    );
  }
}

async function recordPublishSuccessOnAccount(socialAccountId: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("social_accounts")
    .update({
      consecutive_publish_failures: 0,
      connection_status: "conectada",
      disconnected_alert_sent_at: null,
    })
    .eq("id", socialAccountId);

  if (error) {
    console.error(
      `[publish-scheduled] falha ao resetar contador de falhas da conta ${socialAccountId}:`,
      error.message
    );
  }
}

// Débito técnico conhecido: consecutive_publish_failures usa um snapshot lido
// no início da execução do cron (listPostsPendingPublish). Se 3+ posts da
// mesma conta falharem na mesma execução, cada chamada incrementa a partir do
// mesmo currentFailures em memória em vez do valor mais recente gravado por
// uma chamada anterior nesta mesma execução — o contador final pode subcontar
// entre posts da mesma conta lidos na mesma leitura. A transição para
// 'desconectada' abaixo é protegida contra duplicação (ver comentário
// interno), mas o valor exato do contador nesse cenário raro pode ficar
// ligeiramente atrasado até a próxima execução do cron corrigir.
async function recordPublishFailureOnAccount(
  socialAccountId: string,
  currentFailures: number,
  currentConnectionStatus: string,
  accountLabel: string
) {
  const supabase = createServiceClient();
  const nextFailures = currentFailures + 1;
  const shouldAttemptDisconnect =
    nextFailures >= DISCONNECT_FAILURE_THRESHOLD &&
    currentConnectionStatus === "conectada";

  if (!shouldAttemptDisconnect) {
    const { error } = await supabase
      .from("social_accounts")
      .update({ consecutive_publish_failures: nextFailures })
      .eq("id", socialAccountId);

    if (error) {
      console.error(
        `[publish-scheduled] falha ao incrementar contador de falhas da conta ${socialAccountId}:`,
        error.message
      );
    }
    return;
  }

  // Só transiciona para desconectada se a conta ainda estiver 'conectada' no
  // banco no momento desta escrita — evita que 2 posts da mesma conta,
  // falhando na mesma execução do cron com o mesmo snapshot em memória,
  // disparem o alerta duas vezes ou pisem no contador um do outro.
  const { data: claimed, error: claimError } = await supabase
    .from("social_accounts")
    .update({
      consecutive_publish_failures: nextFailures,
      connection_status: "desconectada",
    })
    .eq("id", socialAccountId)
    .eq("connection_status", "conectada")
    .select("id");

  if (claimError) {
    console.error(
      `[publish-scheduled] falha ao marcar conta ${socialAccountId} como desconectada:`,
      claimError.message
    );
    return;
  }

  if (!claimed || claimed.length === 0) {
    // Outro post da mesma conta, na mesma execução, já reivindicou a
    // transição para desconectada — não duplica o alerta.
    return;
  }

  const alertError = await notifyAccountDisconnected(accountLabel);

  const { error: alertWriteError } = await supabase
    .from("social_accounts")
    .update({
      disconnected_alert_sent_at: alertError ? null : new Date().toISOString(),
    })
    .eq("id", socialAccountId);

  if (alertError) {
    console.error(
      `[publish-scheduled] falha ao enviar alerta de desconexao da conta ${socialAccountId}:`,
      alertError
    );
  }
  if (alertWriteError) {
    console.error(
      `[publish-scheduled] falha ao gravar disconnected_alert_sent_at da conta ${socialAccountId}:`,
      alertWriteError.message
    );
  }
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const pending = await listPostsPendingPublish();
  const supabase = createServiceClient();
  const provider = getPublishingProvider();
  let published = 0;

  for (const post of pending) {
    const zernioAccountId = post.social_account?.zernio_account_id ?? null;
    if (!zernioAccountId) {
      await recordPublishError(
        post.id,
        "Conta social sem zernio_account_id configurado (ver /admin/contas)."
      );
      continue;
    }

    const { data: signedUrl, error: signError } = await supabase.storage
      .from("posts-media")
      .createSignedUrl(post.rendered_art_url, 60 * 10);

    if (signError || !signedUrl?.signedUrl) {
      await recordPublishError(
        post.id,
        "Falha ao gerar URL assinada da arte para publicação."
      );
      continue;
    }

    const { data: claimed, error: claimError } = await supabase
      .from("posts")
      .update({ publish_error: "Publicando..." })
      .eq("id", post.id)
      .eq("status", "aprovado")
      .is("publish_error", null)
      .is("post_url", null)
      .select("id");

    if (claimError || !claimed || claimed.length === 0) {
      // Outra execução do cron já reivindicou este post (ou ele mudou de
      // estado entre a listagem e aqui) — pula sem duplicar a publicação.
      continue;
    }

    try {
      const { postUrl } = await provider.publish({
        postId: post.id,
        zernioAccountId,
        mediaUrl: signedUrl.signedUrl,
        caption: post.caption,
      });

      const { error } = await supabase
        .from("posts")
        .update({
          status: "publicado",
          published_at: new Date().toISOString(),
          post_url: postUrl,
          publish_error: null,
        })
        .eq("id", post.id);

      if (error) {
        console.error(
          `[publish-scheduled] falha ao gravar publicacao do post ${post.id}:`,
          error.message
        );
        await recordPublishSucceededButStatusFailed(post.id, postUrl);
        continue;
      }
      published += 1;
      if (post.social_account_id) {
        await recordPublishSuccessOnAccount(post.social_account_id);
      }
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao publicar via Zernio.";
      await recordPublishError(post.id, message);
      if (post.social_account_id && post.social_account) {
        await recordPublishFailureOnAccount(
          post.social_account_id,
          post.social_account.consecutive_publish_failures,
          post.social_account.connection_status,
          post.social_account.display_name
        );
      }
    }
  }

  return NextResponse.json({ published, total: pending.length });
}
