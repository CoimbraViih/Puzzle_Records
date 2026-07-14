-- Hardening apontado pelo advisor de segurança do Supabase (conferência
-- completa da sessão de 13/07/2026, ver PLAN.md M11):
-- 1) search_path mutável em set_updated_at (0002) — as demais funções
--    SECURITY DEFINER do projeto (is_admin, has_role) já fixam
--    search_path=public desde a criação; esta ficou de fora por ser a
--    única sem SECURITY DEFINER, mas ainda vale travar por defesa em
--    profundidade.
-- 2) handle_new_user (0001) só é chamada pelo trigger on_auth_user_created
--    (auth.users) — nunca precisa ser exposta como RPC pública
--    (/rest/v1/rpc/handle_new_user). Revogar de anon/authenticated não
--    quebra o trigger: a execução de uma trigger function não depende do
--    grant de EXECUTE do role que disparou o INSERT.
-- 3) has_role/is_admin são usadas dentro de políticas RLS avaliadas como
--    o role `authenticated` (mantém EXECUTE para esse role, senão toda
--    política que as chama quebra), mas não há motivo para `anon` poder
--    chamá-las via RPC direta.
alter function public.set_updated_at() set search_path = public;

-- Postgres concede EXECUTE a PUBLIC por padrão na criação da função —
-- revogar só de anon/authenticated não basta, pois os dois são membros
-- implícitos de PUBLIC e continuam herdando o privilégio por ele.
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.has_role(text) from public;
revoke execute on function public.is_admin() from public;

-- has_role/is_admin continuam necessárias para authenticated, que é o
-- role sob o qual as políticas de RLS são avaliadas.
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.is_admin() to authenticated;
