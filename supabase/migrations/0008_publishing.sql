-- M7: publicação via Zernio. Adiciona 'publicado' ao ciclo de vida do post,
-- rastreio de resultado (published_at/post_url) e erro (publish_error,
-- mesmo padrão de art_generation_error/copy_generation_error — nunca falha
-- em silêncio). social_accounts ganha a referência da conta no Zernio,
-- necessária para saber em qual conta publicar.

alter table public.posts
  drop constraint posts_status_check;

alter table public.posts
  add constraint posts_status_check
  check (status in ('pendente', 'rascunho', 'pendente_aprovacao', 'aprovado', 'rejeitado', 'publicado'));

alter table public.posts
  add column published_at timestamptz,
  add column post_url text,
  add column publish_error text;

alter table public.social_accounts
  add column zernio_account_id text;
