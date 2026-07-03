# M2 — Modelo de Dados + Kanban Manual Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task, dispatching a fresh subagent per task with a code-reviewer pass between tasks.

**Goal:** Validar o fluxo de aprovação antes de plugar IA e integrações — um post criado manualmente no painel percorre todo o ciclo de status (Rascunho → Pendente de aprovação → Aprovado/Rejeitado) num Kanban, com upload de mídia real e RLS aplicando as permissões por papel.

**Architecture:** Três tabelas novas (`artists`, `social_accounts`, `posts`) com RLS reforçando quem pode criar/editar/decidir cada post. Bucket privado `posts-media` no Supabase Storage para upload real. Camada `lib/posts/` concentra leitura (`queries.ts`) e escrita (`actions.ts`, Server Actions). UI em Server Components (`KanbanBoard`, `PostCard`) com pequenos Client Components só onde há estado local (modais de formulário). Transições de status via botões de ação (sem drag-and-drop). CRUD de artistas/contas sociais em `/admin`, reaproveitando o padrão de Server Actions + `revalidatePath` (mais simples que o padrão fetch/API usado em `/admin/usuarios` no M1, que só precisou de rota de API por causa da service role key — aqui a RLS já resolve).

**Tech Stack:** Next.js 16 (App Router), Server Actions, `@supabase/ssr`, Supabase Storage, React 19 (`useActionState`), Tailwind + shadcn/ui (`Button` já existente — sem novas dependências de UI).

Spec de referência: `docs/superpowers/specs/2026-07-02-m2-kanban-manual-design.md`

---

### Task 1: Migração SQL — `artists`, `social_accounts`, `posts`, RLS e bucket de mídia

**Agent:** fullstack-developer
**Skills de apoio:** `supabase`, `supabase-postgres-best-practices`

**Files:**
- Create: `supabase/migrations/0002_content_model.sql`

**Passos:**

1. Ler a spec (`docs/superpowers/specs/2026-07-02-m2-kanban-manual-design.md`) antes de escrever — o modelo de dados e as regras de RLS já estão decididos lá.

2. Criar `supabase/migrations/0002_content_model.sql` com o conteúdo exato:

```sql
-- Artistas da label (referência usada no formulário de post; sem
-- integração com Zernio/Drive ainda).
create table public.artists (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  handle text not null,
  created_at timestamptz not null default now()
);

-- Contas sociais onde os posts são publicados (referência; conexão real
-- com Zernio fica para M7/M9).
create table public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  network text not null
    check (network in ('instagram', 'tiktok', 'youtube', 'facebook')),
  handle text not null,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table public.artists enable row level security;
alter table public.social_accounts enable row level security;

create policy "artists_select_authenticated"
  on public.artists for select
  using (auth.uid() is not null);

create policy "artists_admin_write"
  on public.artists for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "social_accounts_select_authenticated"
  on public.social_accounts for select
  using (auth.uid() is not null);

create policy "social_accounts_admin_write"
  on public.social_accounts for all
  using (public.is_admin())
  with check (public.is_admin());

-- Helper reaproveitável para checar papel do usuário logado dentro de
-- políticas de RLS (mesmo padrão security-definer de public.is_admin(),
-- criada em 0001_profiles.sql).
create or replace function public.has_role(role_name text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = role_name
  );
$$;

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  artist_id uuid references public.artists (id),
  social_account_id uuid not null references public.social_accounts (id),
  template text not null check (template in ('A', 'B')),
  post_type text not null
    check (post_type in ('viral_geral', 'noticia_funk', 'lancamento')),
  headline text not null,
  caption text not null,
  media_url text not null,
  media_type text not null check (media_type in ('image', 'video')),
  status text not null
    check (status in ('rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado'))
    default 'rascunho',
  scheduled_at timestamptz,
  rejection_reason text,
  created_by uuid not null references public.profiles (id),
  approved_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger posts_set_updated_at
  before update on public.posts
  for each row execute function public.set_updated_at();

alter table public.posts enable row level security;

-- Qualquer papel autenticado vê o board completo; a UI restringe as
-- ações disponíveis, não a visibilidade dos cards.
create policy "posts_select_authenticated"
  on public.posts for select
  using (auth.uid() is not null);

-- Só equipe de conteúdo (ou admin) cria posts, e sempre como autor de
-- si mesmo.
create policy "posts_insert_conteudo_or_admin"
  on public.posts for insert
  with check (
    created_by = auth.uid()
    and (public.is_admin() or public.has_role('equipe_conteudo'))
  );

-- Equipe de conteúdo só edita os próprios posts em rascunho/rejeitado,
-- e o WITH CHECK trava o status alvo em rascunho/pendente_aprovacao —
-- sem essa trava, o autor conseguiria se auto-aprovar setando
-- status='aprovado' na mesma UPDATE que edita o texto (as políticas
-- permissivas de UPDATE se combinam com OR entre si, então o USING de
-- uma política não amarra o WITH CHECK de outra).
create policy "posts_update_owner_draft_or_rejected"
  on public.posts for update
  using (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status in ('rascunho', 'rejeitado')
  )
  with check (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status in ('rascunho', 'pendente_aprovacao')
  );

-- Aprovador decide (ou edita mantendo pendente) só posts pendentes.
create policy "posts_update_approver_pending"
  on public.posts for update
  using (
    (public.has_role('aprovador') or public.is_admin())
    and status = 'pendente_aprovacao'
  )
  with check (
    (public.has_role('aprovador') or public.is_admin())
    and status in ('pendente_aprovacao', 'aprovado', 'rejeitado')
  );

-- Admin tem acesso total, sem restrição de status.
create policy "posts_update_admin_all"
  on public.posts for update
  using (public.is_admin())
  with check (public.is_admin());

create policy "posts_delete_owner_draft"
  on public.posts for delete
  using (
    created_by = auth.uid()
    and public.has_role('equipe_conteudo')
    and status = 'rascunho'
  );

create policy "posts_delete_admin"
  on public.posts for delete
  using (public.is_admin());

-- Bucket privado para mídia dos posts. Leitura via URL assinada gerada
-- no server (lib/posts/queries.ts), nunca acesso público direto.
insert into storage.buckets (id, name, public)
values ('posts-media', 'posts-media', false)
on conflict (id) do nothing;

create policy "posts_media_authenticated_read"
  on storage.objects for select
  using (bucket_id = 'posts-media' and auth.uid() is not null);

create policy "posts_media_authenticated_insert"
  on storage.objects for insert
  with check (bucket_id = 'posts-media' and auth.uid() is not null);
```

**Verificação:** arquivo criado. Igual à Task 1 do M1 — a aplicação real da migration (`npx supabase db push`) fica para o checklist manual (Task 13), pois depende de `supabase link` (login interativo).

**Commit:**

```bash
git add supabase/migrations/0002_content_model.sql
git commit -m "feat(db): migration artists/social_accounts/posts com RLS e bucket de mídia"
```

---

### Task 2: Tipos TypeScript — `Post`, `Artist`, `SocialAccount`

**Agent:** typescript-pro

**Files:**
- Create: `lib/types/artist.ts`
- Create: `lib/types/social-account.ts`
- Create: `lib/types/post.ts`

**Passos:**

1. Criar `lib/types/artist.ts`:

```ts
export interface Artist {
  id: string;
  name: string;
  handle: string;
  created_at: string;
}
```

2. Criar `lib/types/social-account.ts`:

```ts
export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "youtube",
  "facebook",
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_NETWORK_LABELS: Record<SocialNetwork, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  facebook: "Facebook",
};

export interface SocialAccount {
  id: string;
  network: SocialNetwork;
  handle: string;
  display_name: string;
  created_at: string;
}
```

3. Criar `lib/types/post.ts`:

```ts
export const POST_STATUSES = [
  "rascunho",
  "pendente_aprovacao",
  "aprovado",
  "rejeitado",
] as const;

export type PostStatus = (typeof POST_STATUSES)[number];

export const POST_STATUS_LABELS: Record<PostStatus, string> = {
  rascunho: "Rascunho",
  pendente_aprovacao: "Pendente de aprovação",
  aprovado: "Aprovado",
  rejeitado: "Rejeitado",
};

export const POST_TEMPLATES = ["A", "B"] as const;
export type PostTemplate = (typeof POST_TEMPLATES)[number];

export const POST_TYPES = [
  "viral_geral",
  "noticia_funk",
  "lancamento",
] as const;

export type PostType = (typeof POST_TYPES)[number];

export const POST_TYPE_LABELS: Record<PostType, string> = {
  viral_geral: "Viral geral",
  noticia_funk: "Notícia funk",
  lancamento: "Lançamento",
};

export const MEDIA_TYPES = ["image", "video"] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

export interface Post {
  id: string;
  artist_id: string | null;
  social_account_id: string;
  template: PostTemplate;
  post_type: PostType;
  headline: string;
  caption: string;
  media_url: string;
  media_type: MediaType;
  status: PostStatus;
  scheduled_at: string | null;
  rejection_reason: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PostWithRelations extends Post {
  artist: { id: string; name: string; handle: string } | null;
  social_account: {
    id: string;
    network: string;
    handle: string;
    display_name: string;
  };
  /** Preenchido só pela camada de leitura (lib/posts/queries.ts). */
  media_signed_url?: string | null;
}
```

**Verificação:** `npx tsc --noEmit` não deve reportar erro relacionado a estes arquivos (sem consumidores ainda até a Task 3).

**Commit:**

```bash
git add lib/types/artist.ts lib/types/social-account.ts lib/types/post.ts
git commit -m "feat(types): tipos de Post, Artist e SocialAccount"
```

---

### Task 3: Camada de leitura — `lib/posts/queries.ts`

**Agent:** fullstack-developer
**Skill de apoio:** `supabase`

**Files:**
- Create: `lib/posts/queries.ts`

**Passos:**

1. Criar `lib/posts/queries.ts`:

```ts
import { createClient } from "@/lib/supabase/server";
import type { Artist } from "@/lib/types/artist";
import type { PostWithRelations } from "@/lib/types/post";
import type { SocialAccount } from "@/lib/types/social-account";

export async function listPosts(): Promise<PostWithRelations[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("posts")
    .select(
      "*, artist:artists(id, name, handle), social_account:social_accounts(id, network, handle, display_name)"
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Falha ao listar posts:", error);
    return [];
  }

  const posts = (data as PostWithRelations[]) ?? [];
  if (posts.length === 0) return posts;

  const { data: signedUrls, error: signedUrlsError } = await supabase.storage
    .from("posts-media")
    .createSignedUrls(
      posts.map((post) => post.media_url),
      60 * 60
    );

  if (signedUrlsError) {
    console.error("Falha ao gerar URLs assinadas da mídia:", signedUrlsError);
    return posts;
  }

  return posts.map((post, index) => ({
    ...post,
    media_signed_url: signedUrls?.[index]?.signedUrl ?? null,
  }));
}

export async function listArtists(): Promise<Artist[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("artists")
    .select("*")
    .order("name", { ascending: true });

  if (error) {
    console.error("Falha ao listar artistas:", error);
    return [];
  }

  return (data as Artist[]) ?? [];
}

export async function listSocialAccounts(): Promise<SocialAccount[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("social_accounts")
    .select("*")
    .order("display_name", { ascending: true });

  if (error) {
    console.error("Falha ao listar contas sociais:", error);
    return [];
  }

  return (data as SocialAccount[]) ?? [];
}
```

**Verificação:** `npx tsc --noEmit` passa.

**Commit:**

```bash
git add lib/posts/queries.ts
git commit -m "feat(posts): camada de leitura de posts/artistas/contas sociais"
```

---

### Task 4: Camada de escrita — `lib/posts/actions.ts` (Server Actions)

**Agent:** fullstack-developer
**Skill de apoio:** `supabase`

**Files:**
- Create: `lib/posts/actions.ts`

**Passos:**

1. Criar `lib/posts/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { createClient } from "@/lib/supabase/server";
import type {
  MediaType,
  PostStatus,
  PostTemplate,
  PostType,
} from "@/lib/types/post";

export type PostFormState = { error?: string; success?: boolean } | undefined;

function revalidatePostPages() {
  revalidatePath("/conteudo");
  revalidatePath("/aprovacao");
  revalidatePath("/admin");
}

function mediaTypeFromFile(file: File): MediaType {
  return file.type.startsWith("video/") ? "video" : "image";
}

async function uploadMedia(file: File): Promise<string> {
  const supabase = await createClient();
  const extension = file.name.split(".").pop() ?? "bin";
  const path = `${crypto.randomUUID()}.${extension}`;

  const { error } = await supabase.storage
    .from("posts-media")
    .upload(path, file, { contentType: file.type });

  if (error) {
    throw new Error("upload_failed");
  }

  return path;
}

function readPostFields(formData: FormData) {
  return {
    artist_id: (formData.get("artist_id") as string) || null,
    social_account_id: String(formData.get("social_account_id") ?? ""),
    template: String(formData.get("template") ?? "") as PostTemplate,
    post_type: String(formData.get("post_type") ?? "") as PostType,
    headline: String(formData.get("headline") ?? "").trim(),
    caption: String(formData.get("caption") ?? "").trim(),
    scheduled_at: (formData.get("scheduled_at") as string) || null,
  };
}

function validatePostFields(fields: ReturnType<typeof readPostFields>) {
  return Boolean(
    fields.social_account_id &&
      fields.template &&
      fields.post_type &&
      fields.headline &&
      fields.caption
  );
}

export async function createPost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (
    !profile ||
    (profile.role !== "equipe_conteudo" && profile.role !== "admin")
  ) {
    return { error: "Você não tem permissão para criar posts." };
  }

  const fields = readPostFields(formData);
  if (!validatePostFields(fields)) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const mediaFile = formData.get("media") as File | null;
  if (!mediaFile || mediaFile.size === 0) {
    return { error: "Selecione um arquivo de mídia." };
  }

  let mediaPath: string;
  try {
    mediaPath = await uploadMedia(mediaFile);
  } catch {
    return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("posts").insert({
    ...fields,
    media_url: mediaPath,
    media_type: mediaTypeFromFile(mediaFile),
    status: "rascunho",
    created_by: profile.id,
  });

  if (error) {
    return { error: "Não foi possível salvar o post." };
  }

  revalidatePostPages();
  return { success: true };
}

export async function updatePost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const postId = String(formData.get("post_id") ?? "");
  if (!postId) {
    return { error: "Post inválido." };
  }

  const fields = readPostFields(formData);
  if (!validatePostFields(fields)) {
    return { error: "Preencha todos os campos obrigatórios." };
  }

  const update: Record<string, unknown> = { ...fields };

  const mediaFile = formData.get("media") as File | null;
  if (mediaFile && mediaFile.size > 0) {
    try {
      update.media_url = await uploadMedia(mediaFile);
      update.media_type = mediaTypeFromFile(mediaFile);
    } catch {
      return { error: "Falha ao enviar o arquivo de mídia. Tente novamente." };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("posts")
    .update(update)
    .eq("id", postId);

  if (error) {
    return {
      error:
        "Não foi possível salvar as alterações. Verifique se você ainda pode editar este post.",
    };
  }

  revalidatePostPages();
  return { success: true };
}

export async function deletePost(postId: string, _formData: FormData) {
  const supabase = await createClient();
  await supabase.from("posts").delete().eq("id", postId);
  revalidatePostPages();
}

async function updateStatus(
  postId: string,
  status: PostStatus,
  extra: Record<string, unknown> = {}
) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("posts")
    .update({ status, ...extra })
    .eq("id", postId);
  return error;
}

export async function submitForApproval(postId: string, _formData: FormData) {
  const error = await updateStatus(postId, "pendente_aprovacao");
  if (!error) revalidatePostPages();
}

export async function approvePost(postId: string, _formData: FormData) {
  const profile = await getCurrentProfile();
  if (!profile) return;

  const error = await updateStatus(postId, "aprovado", {
    approved_by: profile.id,
    rejection_reason: null,
  });
  if (!error) revalidatePostPages();
}

export async function rejectPost(
  _prevState: PostFormState,
  formData: FormData
): Promise<PostFormState> {
  const profile = await getCurrentProfile();
  if (!profile) {
    return { error: "Sessão expirada. Faça login novamente." };
  }

  const postId = String(formData.get("post_id") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();

  if (!postId || !reason) {
    return { error: "Informe o motivo da rejeição." };
  }

  const error = await updateStatus(postId, "rejeitado", {
    approved_by: profile.id,
    rejection_reason: reason,
  });

  if (error) {
    return { error: "Não foi possível rejeitar o post." };
  }

  revalidatePostPages();
  return { success: true };
}
```

**Verificação:** `npx tsc --noEmit` passa. Teste funcional real (upload/mutações contra o banco) só é possível no checklist manual (Task 13), depois da migration aplicada.

**Commit:**

```bash
git add lib/posts/actions.ts
git commit -m "feat(posts): server actions de criar/editar/excluir/decidir posts"
```

---

### Task 5: Componentes do Kanban — `KanbanBoard` e `PostCard`

**Agent:** frontend-developer
**Skills de apoio:** `tailwind-patterns`, `ui-ux-pro-max`

**Files:**
- Create: `components/kanban/board.tsx`
- Create: `components/kanban/post-card.tsx`

**Nota:** este task só referencia `PostFormDialog` e `RejectDialog`, que são criados na Task 6. Ordem de commit não importa para o build final, mas rode `npx tsc --noEmit` só depois da Task 6 se quiser conferir sem erro de import.

**Passos:**

1. Criar `components/kanban/post-card.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { approvePost, deletePost, submitForApproval } from "@/lib/posts/actions";
import type { Artist } from "@/lib/types/artist";
import { POST_TYPE_LABELS, type PostWithRelations } from "@/lib/types/post";
import type { Role } from "@/lib/types/profile";
import {
  SOCIAL_NETWORK_LABELS,
  type SocialAccount,
} from "@/lib/types/social-account";

import { PostFormDialog } from "./post-form-dialog";
import { RejectDialog } from "./reject-dialog";

function canEdit(post: PostWithRelations, role: Role, userId: string) {
  if (role === "admin") return true;
  if (role === "equipe_conteudo") {
    return (
      post.created_by === userId &&
      (post.status === "rascunho" || post.status === "rejeitado")
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
    role === "equipe_conteudo" && post.created_by === userId;
  const eligibleStatus =
    post.status === "rascunho" || post.status === "rejeitado";
  return (ownedByAuthor || role === "admin") && eligibleStatus;
}

function canDecide(post: PostWithRelations, role: Role) {
  return (
    (role === "aprovador" || role === "admin") &&
    post.status === "pendente_aprovacao"
  );
}

export function PostCard({
  post,
  currentUserId,
  role,
  artists,
  socialAccounts,
}: {
  post: PostWithRelations;
  currentUserId: string;
  role: Role;
  artists: Artist[];
  socialAccounts: SocialAccount[];
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
          {POST_TYPE_LABELS[post.post_type]}
        </span>
        <span className="text-xs text-muted-foreground">
          Template {post.template}
        </span>
      </div>

      {post.media_signed_url && post.media_type === "image" && (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada
        // temporária do Storage, não faz sentido no otimizador de imagem do Next.
        <img
          src={post.media_signed_url}
          alt={post.headline}
          className="h-32 w-full rounded-md object-cover"
        />
      )}
      {post.media_signed_url && post.media_type === "video" && (
        <video
          src={post.media_signed_url}
          controls
          className="h-32 w-full rounded-md object-cover"
        />
      )}

      <p className="text-sm font-semibold text-foreground">{post.headline}</p>
      <p className="line-clamp-3 text-xs text-muted-foreground">
        {post.caption}
      </p>

      <p className="text-xs text-muted-foreground">
        {SOCIAL_NETWORK_LABELS[
          post.social_account.network as keyof typeof SOCIAL_NETWORK_LABELS
        ] ?? post.social_account.network}{" "}
        — {post.social_account.display_name}
        {post.artist && ` · ${post.artist.name} (${post.artist.handle})`}
      </p>

      {post.status === "rejeitado" && post.rejection_reason && (
        <p className="rounded-md bg-destructive/10 px-2 py-1 text-xs text-destructive">
          Motivo: {post.rejection_reason}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {canEdit(post, role, currentUserId) && (
          <PostFormDialog
            mode="edit"
            post={post}
            artists={artists}
            socialAccounts={socialAccounts}
            triggerLabel="Editar"
            triggerVariant="outline"
          />
        )}

        {canSubmit(post, role, currentUserId) && (
          <form action={submitForApproval.bind(null, post.id)}>
            <Button type="submit" size="sm">
              {post.status === "rejeitado"
                ? "Reenviar"
                : "Enviar para aprovação"}
            </Button>
          </form>
        )}

        {canDecide(post, role) && (
          <form action={approvePost.bind(null, post.id)}>
            <Button type="submit" size="sm">
              Aprovar
            </Button>
          </form>
        )}

        {canDecide(post, role) && <RejectDialog postId={post.id} />}

        {canDelete(post, role, currentUserId) && (
          <form action={deletePost.bind(null, post.id)}>
            <Button type="submit" variant="ghost" size="sm">
              Excluir
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
```

2. Criar `components/kanban/board.tsx`:

```tsx
import type { Artist } from "@/lib/types/artist";
import {
  POST_STATUSES,
  POST_STATUS_LABELS,
  type PostWithRelations,
} from "@/lib/types/post";
import type { Role } from "@/lib/types/profile";
import type { SocialAccount } from "@/lib/types/social-account";

import { PostCard } from "./post-card";

export function KanbanBoard({
  posts,
  currentUserId,
  role,
  artists,
  socialAccounts,
}: {
  posts: PostWithRelations[];
  currentUserId: string;
  role: Role;
  artists: Artist[];
  socialAccounts: SocialAccount[];
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
      {POST_STATUSES.map((status) => (
        <div
          key={status}
          className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3"
        >
          <h2 className="text-sm font-semibold text-foreground">
            {POST_STATUS_LABELS[status]}
          </h2>
          <div className="flex flex-col gap-3">
            {posts
              .filter((post) => post.status === status)
              .map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  currentUserId={currentUserId}
                  role={role}
                  artists={artists}
                  socialAccounts={socialAccounts}
                />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
```

**Verificação:** deixar para depois da Task 6 (imports de `PostFormDialog`/`RejectDialog` ainda não existem).

**Commit:**

```bash
git add components/kanban/board.tsx components/kanban/post-card.tsx
git commit -m "feat(kanban): board e card do Kanban de posts"
```

---

### Task 6: Modais de formulário — `PostFormDialog` e `RejectDialog`

**Agent:** frontend-developer
**Skills de apoio:** `senior-frontend`, `tailwind-patterns`

**Files:**
- Create: `components/kanban/post-form-dialog.tsx`
- Create: `components/kanban/reject-dialog.tsx`

**Passos:**

1. Criar `components/kanban/post-form-dialog.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { createPost, updatePost, type PostFormState } from "@/lib/posts/actions";
import type { Artist } from "@/lib/types/artist";
import {
  POST_TEMPLATES,
  POST_TYPE_LABELS,
  POST_TYPES,
  type PostWithRelations,
} from "@/lib/types/post";
import {
  SOCIAL_NETWORK_LABELS,
  type SocialAccount,
} from "@/lib/types/social-account";

const initialState: PostFormState = undefined;

export function PostFormDialog({
  mode,
  post,
  artists,
  socialAccounts,
  triggerLabel,
  triggerVariant = "default",
}: {
  mode: "create" | "edit";
  post?: PostWithRelations;
  artists: Artist[];
  socialAccounts: SocialAccount[];
  triggerLabel: string;
  triggerVariant?: "default" | "outline" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);
  const action = mode === "create" ? createPost : updatePost;
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <Button
        type="button"
        variant={triggerVariant}
        size="sm"
        onClick={() => setOpen(true)}
      >
        {triggerLabel}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              {mode === "create" ? "Novo post" : "Editar post"}
            </h2>

            <form action={formAction} className="flex flex-col gap-4">
              {mode === "edit" && post && (
                <input type="hidden" name="post_id" value={post.id} />
              )}

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="artist_id"
                  className="text-sm text-muted-foreground"
                >
                  Artista (opcional)
                </label>
                <select
                  id="artist_id"
                  name="artist_id"
                  defaultValue={post?.artist_id ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="">Nenhum</option>
                  {artists.map((artist) => (
                    <option key={artist.id} value={artist.id}>
                      {artist.name} ({artist.handle})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="social_account_id"
                  className="text-sm text-muted-foreground"
                >
                  Conta social
                </label>
                <select
                  id="social_account_id"
                  name="social_account_id"
                  required
                  defaultValue={post?.social_account_id ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                >
                  <option value="" disabled>
                    Selecione
                  </option>
                  {socialAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {SOCIAL_NETWORK_LABELS[account.network]} —{" "}
                      {account.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-4">
                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="template"
                    className="text-sm text-muted-foreground"
                  >
                    Template
                  </label>
                  <select
                    id="template"
                    name="template"
                    required
                    defaultValue={post?.template ?? ""}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TEMPLATES.map((template) => (
                      <option key={template} value={template}>
                        Template {template}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-1 flex-col gap-1.5">
                  <label
                    htmlFor="post_type"
                    className="text-sm text-muted-foreground"
                  >
                    Tipo
                  </label>
                  <select
                    id="post_type"
                    name="post_type"
                    required
                    defaultValue={post?.post_type ?? ""}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    <option value="" disabled>
                      Selecione
                    </option>
                    {POST_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {POST_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="headline"
                  className="text-sm text-muted-foreground"
                >
                  Manchete
                </label>
                <input
                  id="headline"
                  name="headline"
                  required
                  defaultValue={post?.headline ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="caption"
                  className="text-sm text-muted-foreground"
                >
                  Legenda
                </label>
                <textarea
                  id="caption"
                  name="caption"
                  required
                  rows={4}
                  defaultValue={post?.caption ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="media" className="text-sm text-muted-foreground">
                  Mídia {mode === "edit" ? "(opcional — substitui a atual)" : ""}
                </label>
                <input
                  id="media"
                  name="media"
                  type="file"
                  accept="image/*,video/*"
                  required={mode === "create"}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="scheduled_at"
                  className="text-sm text-muted-foreground"
                >
                  Agendamento (opcional)
                </label>
                <input
                  id="scheduled_at"
                  name="scheduled_at"
                  type="datetime-local"
                  defaultValue={post?.scheduled_at?.slice(0, 16) ?? ""}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={pending}>
                  {pending ? "Salvando..." : "Salvar"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

2. Criar `components/kanban/reject-dialog.tsx`:

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { rejectPost, type PostFormState } from "@/lib/posts/actions";

const initialState: PostFormState = undefined;

export function RejectDialog({ postId }: { postId: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    rejectPost,
    initialState
  );

  useEffect(() => {
    if (state?.success) {
      setOpen(false);
    }
  }, [state]);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={() => setOpen(true)}
      >
        Rejeitar
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-8">
          <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
            <h2 className="mb-4 text-lg font-semibold text-foreground">
              Rejeitar post
            </h2>
            <form action={formAction} className="flex flex-col gap-4">
              <input type="hidden" name="post_id" value={postId} />
              <div className="flex flex-col gap-1.5">
                <label htmlFor="reason" className="text-sm text-muted-foreground">
                  Motivo
                </label>
                <textarea
                  id="reason"
                  name="reason"
                  required
                  rows={3}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
              </div>

              {state?.error && (
                <p className="text-sm text-destructive">{state.error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancelar
                </Button>
                <Button type="submit" variant="destructive" disabled={pending}>
                  {pending ? "Rejeitando..." : "Confirmar rejeição"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
```

**Verificação:**

```bash
npm run build
```

Esperado: build passa (agora que `board.tsx`/`post-card.tsx` da Task 5 têm os imports satisfeitos).

**Commit:**

```bash
git add components/kanban/post-form-dialog.tsx components/kanban/reject-dialog.tsx
git commit -m "feat(kanban): modais de criar/editar post e de rejeição"
```

---

### Task 7: Wiring da página `/conteudo`

**Agent:** fullstack-developer

**Files:**
- Modify: `app/conteudo/page.tsx`

**Passos:**

1. Substituir o conteúdo de `app/conteudo/page.tsx` por:

```tsx
import { logout } from "@/app/login/actions";
import { KanbanBoard } from "@/components/kanban/board";
import { PostFormDialog } from "@/components/kanban/post-form-dialog";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function ConteudoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
            {profile ? ROLE_LABELS[profile.role] : "Equipe de conteúdo"}
          </span>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Fila de posts
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <PostFormDialog
            mode="create"
            artists={artists}
            socialAccounts={socialAccounts}
            triggerLabel="Novo post"
          />
          <form action={logout}>
            <Button type="submit" variant="outline">
              Sair
            </Button>
          </form>
        </div>
      </div>

      {profile && (
        <KanbanBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          artists={artists}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/conteudo/page.tsx
git commit -m "feat(conteudo): Kanban de posts na tela da equipe de conteúdo"
```

---

### Task 8: Wiring da página `/aprovacao`

**Agent:** fullstack-developer

**Files:**
- Modify: `app/aprovacao/page.tsx`

**Passos:**

1. Substituir o conteúdo de `app/aprovacao/page.tsx` por:

```tsx
import { logout } from "@/app/login/actions";
import { KanbanBoard } from "@/components/kanban/board";
import { Button } from "@/components/ui/button";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { listArtists, listPosts, listSocialAccounts } from "@/lib/posts/queries";
import { ROLE_LABELS } from "@/lib/types/profile";

export const dynamic = "force-dynamic";

export default async function AprovacaoPage() {
  const profile = await getCurrentProfile();
  const [posts, artists, socialAccounts] = await Promise.all([
    listPosts(),
    listArtists(),
    listSocialAccounts(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
            {profile ? ROLE_LABELS[profile.role] : "Aprovador"}
          </span>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">
            Fila de aprovação
          </h1>
        </div>
        <form action={logout}>
          <Button type="submit" variant="outline">
            Sair
          </Button>
        </form>
      </div>

      {profile && (
        <KanbanBoard
          posts={posts}
          currentUserId={profile.id}
          role={profile.role}
          artists={artists}
          socialAccounts={socialAccounts}
        />
      )}
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/aprovacao/page.tsx
git commit -m "feat(aprovacao): Kanban de posts na tela do aprovador"
```

---

### Task 9: CRUD de artistas (`/admin/artistas`)

**Agent:** frontend-developer
**Skill de apoio:** `tailwind-patterns`

**Files:**
- Create: `app/admin/artistas/actions.ts`
- Create: `app/admin/artistas/artist-form.tsx`
- Create: `app/admin/artistas/page.tsx`

**Passos:**

1. Criar `app/admin/artistas/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";

export type ArtistFormState = { error?: string } | undefined;

export async function createArtist(
  _prevState: ArtistFormState,
  formData: FormData
): Promise<ArtistFormState> {
  const name = String(formData.get("name") ?? "").trim();
  const handle = String(formData.get("handle") ?? "").trim();

  if (!name || !handle) {
    return { error: "Informe nome e @handle." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("artists").insert({ name, handle });

  if (error) {
    return { error: "Não foi possível salvar o artista." };
  }

  revalidatePath("/admin/artistas");
  return undefined;
}

export async function deleteArtist(artistId: string, _formData: FormData) {
  const supabase = await createClient();
  await supabase.from("artists").delete().eq("id", artistId);
  revalidatePath("/admin/artistas");
}
```

2. Criar `app/admin/artistas/artist-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";

import { createArtist, type ArtistFormState } from "./actions";

const initialState: ArtistFormState = undefined;

export function ArtistForm() {
  const [state, formAction, pending] = useActionState(
    createArtist,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="artist-name" className="text-sm text-muted-foreground">
          Nome
        </label>
        <input
          id="artist-name"
          name="name"
          required
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="artist-handle"
          className="text-sm text-muted-foreground"
        >
          @handle
        </label>
        <input
          id="artist-handle"
          name="handle"
          required
          placeholder="@mcstaylon"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar"}
      </Button>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
```

3. Criar `app/admin/artistas/page.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { listArtists } from "@/lib/posts/queries";

import { deleteArtist } from "./actions";
import { ArtistForm } from "./artist-form";

export const dynamic = "force-dynamic";

export default async function ArtistasPage() {
  const artists = await listArtists();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Artistas</h1>

      <ArtistForm />

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">Nome</th>
            <th className="py-2">Handle</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {artists.map((artist) => (
            <tr key={artist.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">{artist.name}</td>
              <td className="py-2 text-foreground">{artist.handle}</td>
              <td className="py-2 text-right">
                <form action={deleteArtist.bind(null, artist.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Excluir
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/admin/artistas
git commit -m "feat(admin): CRUD de artistas"
```

---

### Task 10: CRUD de contas sociais (`/admin/contas`)

**Agent:** frontend-developer
**Skill de apoio:** `tailwind-patterns`

**Files:**
- Create: `app/admin/contas/actions.ts`
- Create: `app/admin/contas/social-account-form.tsx`
- Create: `app/admin/contas/page.tsx`

**Passos:**

1. Criar `app/admin/contas/actions.ts`:

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { SOCIAL_NETWORKS, type SocialNetwork } from "@/lib/types/social-account";

export type SocialAccountFormState = { error?: string } | undefined;

export async function createSocialAccount(
  _prevState: SocialAccountFormState,
  formData: FormData
): Promise<SocialAccountFormState> {
  const network = String(formData.get("network") ?? "") as SocialNetwork;
  const handle = String(formData.get("handle") ?? "").trim();
  const displayName = String(formData.get("display_name") ?? "").trim();

  if (!SOCIAL_NETWORKS.includes(network) || !handle || !displayName) {
    return { error: "Preencha rede, @handle e nome de exibição." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("social_accounts")
    .insert({ network, handle, display_name: displayName });

  if (error) {
    return { error: "Não foi possível salvar a conta social." };
  }

  revalidatePath("/admin/contas");
  return undefined;
}

export async function deleteSocialAccount(
  accountId: string,
  _formData: FormData
) {
  const supabase = await createClient();
  await supabase.from("social_accounts").delete().eq("id", accountId);
  revalidatePath("/admin/contas");
}
```

2. Criar `app/admin/contas/social-account-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { Button } from "@/components/ui/button";
import { SOCIAL_NETWORK_LABELS, SOCIAL_NETWORKS } from "@/lib/types/social-account";

import { createSocialAccount, type SocialAccountFormState } from "./actions";

const initialState: SocialAccountFormState = undefined;

export function SocialAccountForm() {
  const [state, formAction, pending] = useActionState(
    createSocialAccount,
    initialState
  );

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="network" className="text-sm text-muted-foreground">
          Rede
        </label>
        <select
          id="network"
          name="network"
          required
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        >
          {SOCIAL_NETWORKS.map((network) => (
            <option key={network} value={network}>
              {SOCIAL_NETWORK_LABELS[network]}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="handle" className="text-sm text-muted-foreground">
          @handle
        </label>
        <input
          id="handle"
          name="handle"
          required
          placeholder="@puzzlerecordss"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor="display_name"
          className="text-sm text-muted-foreground"
        >
          Nome de exibição
        </label>
        <input
          id="display_name"
          name="display_name"
          required
          placeholder="Puzzle Records"
          className="rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Adicionar"}
      </Button>

      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
    </form>
  );
}
```

3. Criar `app/admin/contas/page.tsx`:

```tsx
import { Button } from "@/components/ui/button";
import { listSocialAccounts } from "@/lib/posts/queries";
import { SOCIAL_NETWORK_LABELS } from "@/lib/types/social-account";

import { deleteSocialAccount } from "./actions";
import { SocialAccountForm } from "./social-account-form";

export const dynamic = "force-dynamic";

export default async function ContasPage() {
  const accounts = await listSocialAccounts();

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-16">
      <h1 className="text-2xl font-semibold text-foreground">Contas sociais</h1>

      <SocialAccountForm />

      <table className="w-full max-w-2xl text-left text-sm">
        <thead>
          <tr className="border-b border-border text-muted-foreground">
            <th className="py-2">Rede</th>
            <th className="py-2">Handle</th>
            <th className="py-2">Nome</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {accounts.map((account) => (
            <tr key={account.id} className="border-b border-border/50">
              <td className="py-2 text-foreground">
                {SOCIAL_NETWORK_LABELS[account.network]}
              </td>
              <td className="py-2 text-foreground">{account.handle}</td>
              <td className="py-2 text-foreground">{account.display_name}</td>
              <td className="py-2 text-right">
                <form action={deleteSocialAccount.bind(null, account.id)}>
                  <Button type="submit" variant="ghost" size="sm">
                    Excluir
                  </Button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/admin/contas
git commit -m "feat(admin): CRUD de contas sociais"
```

---

### Task 11: Links de Artistas/Contas na home do admin

**Agent:** frontend-developer

**Files:**
- Modify: `app/admin/page.tsx`

**Passos:**

1. Editar `app/admin/page.tsx`, acrescentando os dois links novos ao lado do link já existente para "Gerenciar usuários":

```diff
       <Link
         href="/admin/usuarios"
         className="text-sm text-primary underline-offset-4 hover:underline"
       >
         Gerenciar usuários
       </Link>
+      <Link
+        href="/admin/artistas"
+        className="text-sm text-primary underline-offset-4 hover:underline"
+      >
+        Artistas
+      </Link>
+      <Link
+        href="/admin/contas"
+        className="text-sm text-primary underline-offset-4 hover:underline"
+      >
+        Contas sociais
+      </Link>
       <form action={logout}>
```

**Verificação:** `npm run build` passa.

**Commit:**

```bash
git add app/admin/page.tsx
git commit -m "feat(admin): links para Artistas e Contas sociais"
```

---

### Task 12: Revisão de código

**Agent:** code-reviewer

**Escopo:** revisar todo o diff do M2 (Tasks 1–11) contra a spec
`docs/superpowers/specs/2026-07-02-m2-kanban-manual-design.md`. Focar em:

- RLS de `posts`: confirmar que a combinação de políticas permissivas de
  `update` (owner/aprovador/admin) realmente impede um `equipe_conteudo`
  de setar `status = 'aprovado'` ou `'rejeitado'` em si mesmo (o ponto
  mais sutil da migration — releia o comentário da Task 1 e teste o
  raciocínio de OR entre `WITH CHECK`s).
- RLS de `posts`: `equipe_conteudo` só edita/exclui os próprios posts em
  `rascunho`/`rejeitado`; `aprovador` só atualiza posts em
  `pendente_aprovacao`; `insert`/`delete` sem policy vazam para ninguém
  além do previsto.
- Server Actions (`lib/posts/actions.ts`): cada mutação confia só na RLS
  (sem `service role key` aqui — diferente do M1) ou reforça checagem de
  papel redundante quando fizer sentido (`createPost` já checa o papel
  antes de tentar o insert, por exemplo).
- Upload de mídia: arquivo é enviado para o Storage antes do insert/update
  na tabela `posts`; se o upload falhar, nenhuma linha é criada/alterada
  com `media_url` órfã.
- Consistência de nomes de rota entre `KanbanBoard`, `PostCard` e as
  páginas (`/conteudo`, `/aprovacao`).
- Nada de código morto ou duplicado entre `app/admin/artistas` e
  `app/admin/contas` (os dois CRUDs são bem parecidos — checar se a
  duplicação é aceitável nesse tamanho ou se vale extrair algo comum,
  sem exagerar).

Rodar `npm run build` e `npx tsc --noEmit` como parte da revisão.

**Se houver findings:** corrigir inline nas mesmas tasks/arquivos, sem
criar uma "Task 12.5" — o objetivo é fechar o M2 limpo.

---

### Task 13: Checklist de aceite manual e commit final

**Agent:** devops-engineer (execução manual guiada — depende de projeto
Supabase linkado e de usuários reais dos 3 papéis, criados no M1)

**Roteiro:**

1. Rodar `npx supabase db push` (projeto já linkado desde o M1) para
   aplicar `0002_content_model.sql`.
2. Como admin, acessar `/admin/artistas` e `/admin/contas` e cadastrar
   pelo menos 1 artista e 1 conta social (ex: `@puzzlerecordss`,
   Instagram).
3. Como `equipe_conteudo`, acessar `/conteudo`, clicar em "Novo post",
   preencher os campos e subir uma imagem → confirmar que o card aparece
   na coluna Rascunho com a mídia visível.
4. Clicar em "Enviar para aprovação" → confirmar que o card migra para
   Pendente de aprovação.
5. Como `aprovador`, acessar `/aprovacao` → confirmar que o card aparece
   em Pendente de aprovação com os botões Editar/Aprovar/Rejeitar.
6. Rejeitar o post com um motivo → confirmar que o card vai para
   Rejeitado e mostra o motivo.
7. Como `equipe_conteudo`, editar o post rejeitado e reenviar → confirmar
   volta para Pendente de aprovação.
8. Como `aprovador`, aprovar o post → confirmar que o card vai para
   Aprovado.
9. Confirmar que `equipe_conteudo` **não** vê os botões Aprovar/Rejeitar
   em nenhum card (nem tentando editar um post pendente de outra
   pessoa).
10. Tentar (via um segundo usuário `equipe_conteudo`, se houver) editar
    um post criado por outro membro da equipe em Rascunho → confirmar
    que a RLS bloqueia (erro ao salvar).

**Critério de pronto do M2 (do PLAN.md):** um post criado manualmente
percorre todo o ciclo de status no Kanban — confirmado pelos passos 3–8
acima.

11. Marcar o M2 como concluído em `PLAN.md` (mudar o cabeçalho e os itens
    da seção "M2" para `[x]`, seguindo o padrão usado no M0/M1).
12. `git status` — confirmar que tudo das Tasks 1–11 já foi commitado
    individualmente. Commitar a atualização do `PLAN.md`:

```bash
git add PLAN.md
git commit -m "docs: marcar M2 como código pronto, checklist manual pendente"
```

13. Não fazer push. Informar ao usuário que os commits estão prontos
    localmente e perguntar se deve dar push para `origin`.
