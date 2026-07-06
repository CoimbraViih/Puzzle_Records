import { NextResponse } from "next/server";
import { getPublishingProvider, PublishError } from "@/lib/publishing";
import { listPostsPendingPublish } from "@/lib/posts/pendingPublish";
import { createServiceClient } from "@/lib/supabase/service";

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
    } catch (err) {
      const message =
        err instanceof PublishError
          ? err.message
          : "Erro inesperado ao publicar via Zernio.";
      await recordPublishError(post.id, message);
    }
  }

  return NextResponse.json({ published, total: pending.length });
}
