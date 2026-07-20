-- Generaliza os horários diários de agendamento (M8/acervo) pra valerem
-- pra todo post aprovado, não só acervo -- ver
-- docs/superpowers/specs/2026-07-20-horarios-estrategicos-design.md.
-- Renomeia em vez de criar coluna nova: mesmo dado, mesmo tipo, só o
-- significado muda (deixa de ser "só acervo").
alter table public.social_accounts
  rename column acervo_daily_slots to daily_post_slots;
