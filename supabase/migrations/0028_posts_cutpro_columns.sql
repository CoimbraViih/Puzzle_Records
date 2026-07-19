-- Padroniza a edição com template Cut.Pro (M16) pros fluxos que criam
-- posts direto (Post rápido/Novo post do painel, cadastro manual de
-- acervo) -- hoje exclusiva do fluxo curado do Drive (drive_items,
-- migration 0019). Mesmas colunas, mesmo significado, pra reaproveitar a
-- máquina de estados já validada em produção (lib/cutpro/pipeline.ts)
-- em vez de duplicar lógica. Ver
-- docs/superpowers/specs/2026-07-19-cutpro-template-editing-todos-fluxos-design.md.
alter table public.posts
  add column edit_status text not null default 'nao_editado'
    check (edit_status in (
      'nao_editado', 'enviando', 'clipando', 'aplicando', 'renderizando',
      'editado', 'erro'
    )),
  add column cutpro_video_id text,
  add column cutpro_submission_id text,
  add column cutpro_clip_id text,
  add column cutpro_template_id text,
  add column cutpro_render_id text,
  add column cutpro_error text,
  add column edited_media_path text;
