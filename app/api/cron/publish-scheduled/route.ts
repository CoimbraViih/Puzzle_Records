import { NextResponse } from "next/server";
import {
  getPublishingProvider,
  PublishError,
  PublishPendingError,
} from "@/lib/publishing";
import {
  listPostsPendingPublish,
  PUBLISHING_CLAIM_SENTINEL,
} from "@/lib/posts/pendingPublish";
import { createServiceClient } from "@/lib/supabase/service";
import { DISCONNECT_FAILURE_THRESHOLD } from "@/lib/analytics/constants";

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

// Post já submetido ao Zernio (zernio_post_id gravado por onSubmitted), mas
// que ainda não resolveu dentro da janela de polling desta chamada — não é
// uma falha. Limpa a sentinela de claim (publish_error) sem tocar em
// zernio_post_id, para que listPostsPendingPublish() volte a incluir este
// post no próximo ciclo do cron, que vai chamar resolvePendingPublish() em
// vez de publish() (zernio_post_id continua preenchido).
async function recordPublishPending(postId: string) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({ publish_error: null })
    .eq("id", postId);
  if (error) {
    console.error(
      `[publish-scheduled] falha ao limpar claim pendente do post ${postId}:`,
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
  postUrl: string,
  zernioPostId: string
) {
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("posts")
    .update({
      publish_error: `Publicado no Zernio (${postUrl}) mas falha ao gravar o status — verificar manualmente.`,
      post_url: postUrl,
      zernio_post_id: zernioPostId,
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
    })
    .eq("id", socialAccountId);

  if (error) {
    console.error(
      `[publish-scheduled] falha ao resetar contador de falhas da conta ${socialAccountId}:`,
      error.message
    );
  }
}

async function recordPublishFailureOnAccount(socialAccountId: string) {
  const supabase = createServiceClient();

  const { data: account, error: fetchError } = await supabase
    .from("social_accounts")
    .select("consecutive_publish_failures, connection_status")
    .eq("id", socialAccountId)
    .single();

  if (fetchError || !account) {
    console.error(
      `[publish-scheduled] falha ao ler estado da conta ${socialAccountId} antes de registrar falha:`,
      fetchError?.message
    );
    return;
  }

  const nextFailures = account.consecutive_publish_failures + 1;
  const crossedThreshold = nextFailures >= DISCONNECT_FAILURE_THRESHOLD;

  // Sem alerta por e-mail: a única ação além do contador é marcar
  // connection_status = "desconectada", que já é exibido no dashboard
  // (ver app/(dashboard)/dashboard/page.tsx).
  const update: Record<string, unknown> = {
    consecutive_publish_failures: nextFailures,
  };
  if (crossedThreshold && account.connection_status !== "desconectada") {
    update.connection_status = "desconectada";
  }

  const { error } = await supabase
    .from("social_accounts")
    .update(update)
    .eq("id", socialAccountId);

  if (error) {
    console.error(
      `[publish-scheduled] falha ao atualizar estado da conta ${socialAccountId}:`,
      error.message
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
    const network = post.social_account?.network ?? null;
    if (!zernioAccountId || !network) {
      await recordPublishError(
        post.id,
        !zernioAccountId
          ? "Conta social sem zernio_account_id configurado (ver /admin/contas)."
          : "Post sem conta social vinculada."
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
      .update({ publish_error: PUBLISHING_CLAIM_SENTINEL })
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
      // Se uma tentativa anterior já submeteu este post ao provedor mas não
      // chegou a resolver (post.zernio_post_id já preenchido), reconsulta
      // em vez de reenviar — reenviar duplicaria a publicação no Zernio.
      const { postUrl, zernioPostId } = post.zernio_post_id
        ? await provider.resolvePendingPublish(post.zernio_post_id, network)
        : await provider.publish(
            {
              postId: post.id,
              zernioAccountId,
              network,
              mediaUrl: signedUrl.signedUrl,
              mediaType: post.media_type,
              caption: post.caption,
            },
            async (providerId) => {
              const { error: submittedError } = await supabase
                .from("posts")
                .update({ zernio_post_id: providerId })
                .eq("id", post.id);
              if (submittedError) {
                console.error(
                  `[publish-scheduled] falha ao gravar zernio_post_id do post ${post.id} logo após submissão:`,
                  submittedError.message
                );
              }
            }
          );

      const { error } = await supabase
        .from("posts")
        .update({
          status: "publicado",
          published_at: new Date().toISOString(),
          post_url: postUrl,
          zernio_post_id: zernioPostId,
          publish_error: null,
        })
        .eq("id", post.id);

      if (error) {
        console.error(
          `[publish-scheduled] falha ao gravar publicacao do post ${post.id}:`,
          error.message
        );
        if (post.social_account_id) {
          await recordPublishSuccessOnAccount(post.social_account_id);
        }
        await recordPublishSucceededButStatusFailed(post.id, postUrl, zernioPostId);
        continue;
      }
      published += 1;
      if (post.social_account_id) {
        await recordPublishSuccessOnAccount(post.social_account_id);
      }
    } catch (err) {
      if (err instanceof PublishPendingError) {
        // Ainda processando do lado do Zernio — não é falha: não conta
        // contra a conta, e libera o post para ser reconsultado (não
        // resubmetido) no próximo ciclo do cron.
        console.error(`[publish-scheduled] post ${post.id} ainda pendente:`, err.message);
        await recordPublishPending(post.id);
        continue;
      }
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao publicar via Zernio.";
      await recordPublishError(post.id, message);
      if (post.social_account_id) {
        await recordPublishFailureOnAccount(post.social_account_id);
      }
    }
  }

  return NextResponse.json({ published, total: pending.length });
}
