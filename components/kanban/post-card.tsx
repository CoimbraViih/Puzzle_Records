import { EditWithTemplateButton } from "@/components/drive/edit-with-template-button";
import { SubmitButton } from "@/components/ui/submit-button";
import { EDIT_STATUS_LABEL } from "@/lib/cutpro/labels";
import {
  regenerateArt,
  retryPublish,
  selectCopyVariation,
  submitForApproval,
} from "@/lib/posts/actions";
import { POST_TYPE_LABELS, type PostWithRelations } from "@/lib/types/post";
import type { Role } from "@/lib/types/profile";
import {
  SOCIAL_NETWORK_LABELS,
  type SocialAccount,
} from "@/lib/types/social-account";

import { ApproveDialog } from "./approve-dialog";
import { DeletePostButton } from "./delete-post-button";
import { InstagramPreviewDialog } from "./instagram-preview";
import { PostFormDialog } from "./post-form-dialog";
import { RejectDialog } from "./reject-dialog";

function canEdit(post: PostWithRelations, role: Role, userId: string) {
  if (role === "admin") return true;
  if (role === "equipe_conteudo") {
    const owned = post.created_by === userId || post.created_by === null;
    return (
      owned &&
      (post.status === "pendente" ||
        post.status === "rascunho" ||
        post.status === "rejeitado")
    );
  }
  if (role === "aprovador") return post.status === "pendente_aprovacao";
  return false;
}

function canDelete(post: PostWithRelations, role: Role, userId: string) {
  if (role === "admin") return true;
  return (
    role === "equipe_conteudo" &&
    post.created_by === userId &&
    post.status === "rascunho"
  );
}

function canSubmit(post: PostWithRelations, role: Role, userId: string) {
  const ownedByAuthor =
    role === "equipe_conteudo" &&
    (post.created_by === userId || post.created_by === null);
  const eligibleStatus =
    post.status === "pendente" ||
    post.status === "rascunho" ||
    post.status === "rejeitado";
  return (ownedByAuthor || role === "admin") && eligibleStatus;
}

function canDecide(post: PostWithRelations, role: Role) {
  return (
    (role === "aprovador" || role === "admin") &&
    post.status === "pendente_aprovacao"
  );
}

function canRetryPublish(post: PostWithRelations, role: Role) {
  return (
    role === "admin" &&
    post.status === "aprovado" &&
    Boolean(post.publish_error) &&
    !post.post_url
  );
}

/** Opcional em todos os fluxos que criam post direto (Post rápido/Novo
 * post, acervo) — mesmo padrão do Drive: só aparece enquanto o post ainda
 * está em rascunho (antes de "Enviar para aprovação"), nunca bloqueia o
 * envio. Ver docs/superpowers/specs/2026-07-19-cutpro-template-editing-todos-fluxos-design.md. */
function canEditWithTemplate(post: PostWithRelations, role: Role, userId: string) {
  return (
    post.media_type === "video" &&
    post.status === "rascunho" &&
    (post.edit_status === "nao_editado" || post.edit_status === "erro") &&
    canEdit(post, role, userId)
  );
}

export function PostCard({
  post,
  currentUserId,
  role,
  socialAccounts,
}: {
  post: PostWithRelations;
  currentUserId: string;
  role: Role;
  socialAccounts: SocialAccount[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {POST_TYPE_LABELS[post.post_type]}
        </span>
        {post.template && (
          <span className="text-xs text-muted-foreground">
            Template {post.template}
          </span>
        )}
      </div>

      {post.media_signed_url && post.media_type === "image" && (
        // URL assinada temporária do Storage — não faz sentido no otimizador
        // de imagem do Next (expira e muda a cada carregamento da página).
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.media_signed_url}
          alt={post.headline ?? "Mídia aguardando manchete da IA"}
          className="h-32 w-full rounded-md object-cover"
          loading="lazy"
          decoding="async"
        />
      )}
      {post.media_signed_url && post.media_type === "video" && (
        <video
          src={post.media_signed_url}
          controls
          preload="metadata"
          className="h-32 w-full rounded-md object-cover"
        />
      )}

      {post.rendered_art_signed_url &&
        post.content_source !== "acervo" &&
        post.media_type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.rendered_art_signed_url}
          alt="Arte gerada"
          className="mt-2 w-full rounded-md border"
          loading="lazy"
          decoding="async"
        />
      )}

      {(post.headline || post.content_source !== "acervo") && (
        <p className="text-sm font-semibold text-foreground">
          {post.headline ?? "Aguardando manchete da IA"}
        </p>
      )}
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {post.caption ?? "Aguardando legenda da IA"}
      </p>

      {post.copy_variations &&
        post.copy_variations.length > 1 &&
        canEdit(post, role, currentUserId) && (
        <div className="flex flex-wrap gap-1">
          {post.copy_variations.map((variation, index) => (
            <form key={index} action={selectCopyVariation.bind(null, post.id, index)}>
              <SubmitButton
                size="sm"
                variant={variation.headline === post.headline ? "default" : "outline"}
              >
                Variação {index + 1}
              </SubmitButton>
            </form>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        {post.social_account
          ? `${
              SOCIAL_NETWORK_LABELS[
                post.social_account.network as keyof typeof SOCIAL_NETWORK_LABELS
              ] ?? post.social_account.network
            } — ${post.social_account.display_name}`
          : "Conta social não vinculada"}
      </p>

      {post.post_url && (
        <a
          href={post.post_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-primary underline"
        >
          Ver post publicado
          {post.published_at &&
            ` — ${new Date(post.published_at).toLocaleString("pt-BR")}`}
        </a>
      )}

      {post.status === "rejeitado" && post.rejection_reason && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Motivo: {post.rejection_reason}
        </p>
      )}

      {post.ingestion_warning && (
        <p className="rounded-md bg-warning/10 px-2 py-1 text-xs text-warning">
          {post.ingestion_warning}
        </p>
      )}

      {post.copy_generation_error && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Erro ao gerar manchete/legenda: {post.copy_generation_error}
        </p>
      )}

      {post.art_generation_error && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Falha ao gerar arte: {post.art_generation_error}
        </p>
      )}

      {post.publish_error && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Falha ao publicar: {post.publish_error}
        </p>
      )}

      {post.media_type === "video" && post.edit_status !== "nao_editado" && (
        <p className="text-xs text-muted-foreground">
          Template: {EDIT_STATUS_LABEL[post.edit_status]}
        </p>
      )}
      {post.cutpro_error && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Erro na edição com template: {post.cutpro_error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {canEdit(post, role, currentUserId) && (
          <PostFormDialog
            mode="edit"
            post={post}
            socialAccounts={socialAccounts}
            triggerLabel="Editar"
            triggerVariant="outline"
          />
        )}

        {canEditWithTemplate(post, role, currentUserId) && (
          <EditWithTemplateButton kind="post" postId={post.id} />
        )}

        {canSubmit(post, role, currentUserId) && (
          <form action={submitForApproval.bind(null, post.id)}>
            <SubmitButton size="sm" pendingLabel="Enviando...">
              {post.status === "rejeitado"
                ? "Reenviar"
                : "Enviar para aprovação"}
            </SubmitButton>
          </form>
        )}

        {canDecide(post, role) && <ApproveDialog postId={post.id} />}

        {canDecide(post, role) && <RejectDialog postId={post.id} />}

        {canRetryPublish(post, role) && (
          <form action={retryPublish.bind(null, post.id)}>
            <SubmitButton size="sm" variant="outline" pendingLabel="Tentando...">
              Tentar publicar novamente
            </SubmitButton>
          </form>
        )}

        {post.headline &&
          post.template &&
          canEdit(post, role, currentUserId) && (
            <form action={regenerateArt.bind(null, post.id)}>
              <SubmitButton size="sm" variant="outline" pendingLabel="Gerando...">
                {post.rendered_art_url ? "Regenerar arte" : "Gerar arte"}
              </SubmitButton>
            </form>
          )}

        {canDelete(post, role, currentUserId) && (
          <DeletePostButton postId={post.id} />
        )}

        {(post.rendered_art_signed_url || post.media_signed_url) && (
          <InstagramPreviewDialog post={post} />
        )}
      </div>
    </div>
  );
}
