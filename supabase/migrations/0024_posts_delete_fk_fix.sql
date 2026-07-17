-- Corrige bug real: o botão "Excluir" de post na fila não fazia nada
-- quando o post tinha linhas relacionadas em drive_items, drive_ingestions
-- ou post_metrics -- as três FKs pra posts.id não tinham "on delete"
-- definido (padrão NO ACTION), então o delete falhava com violação de FK
-- em vez de apagar. deletePost() só logava isso no servidor, sem sinal
-- nenhum pro usuário (achado ao investigar report do Victor, 17/07/2026).
--
-- drive_items/drive_ingestions: post_id é nullable e representa um
-- vínculo opcional (arquivo do Drive já enviado pra aprovação) -- SET NULL
-- preserva a linha (legenda já gerada, estado do Cut.Pro) e o item volta
-- a aparecer como "não enviado" em /drive.
-- post_metrics: post_id é NOT NULL e a linha só existe em função do post
-- (snapshot de métricas) -- sem o post, o dado não tem sentido isolado,
-- então CASCADE é o único "on delete" compatível com a constraint NOT NULL.

alter table public.drive_items
  drop constraint drive_items_post_id_fkey,
  add constraint drive_items_post_id_fkey
    foreign key (post_id) references public.posts (id) on delete set null;

alter table public.drive_ingestions
  drop constraint drive_ingestions_post_id_fkey,
  add constraint drive_ingestions_post_id_fkey
    foreign key (post_id) references public.posts (id) on delete set null;

alter table public.post_metrics
  drop constraint post_metrics_post_id_fkey,
  add constraint post_metrics_post_id_fkey
    foreign key (post_id) references public.posts (id) on delete cascade;
