-- Corrige 2 achados reais do advisor de performance do Supabase (auditoria
-- de 19/07/2026):
--
-- 1. cutpro_status_select_authenticated (0021) e
--    qa_test_runs_select_authenticated (0022) foram escritas com
--    `auth.uid() is not null` sem o wrapper `(select ...)` -- quebra da
--    convenção estabelecida em 0016/0017/0019 (comentário da 0019: "evita
--    reavaliação de auth.uid() por linha"), fazendo o Postgres reavaliar a
--    função por linha em vez de usar InitPlan.
-- 2. drive_items_post_id_idx (criado em 0019) não existe mais no banco de
--    produção -- nenhuma migration no repo dropa esse índice, então a
--    causa é uma migration aplicada fora do controle de versão (o
--    histórico remoto tem uma "drive_items_rename_context" entre 0020 e
--    0021 sem arquivo local correspondente); reconciliação do drift fica
--    para uma sessão futura, aqui só recria o índice que a FK
--    drive_items_post_id_fkey (0019/0024) precisa.

-- drive_items_select_authenticated/drive_items_update_authenticated (0019)
-- já usavam (select auth.uid()) no texto-fonte da migration, mas o
-- advisor continuava flagando -- recriar do zero (mesmo texto) resolveu;
-- suspeita é de um artefato do plano armazenado antes desta sessão, não
-- de um bug real na sintaxe original.
drop policy "drive_items_select_authenticated" on public.drive_items;
create policy "drive_items_select_authenticated"
  on public.drive_items for select
  using ((select auth.uid()) is not null);

drop policy "drive_items_update_authenticated" on public.drive_items;
create policy "drive_items_update_authenticated"
  on public.drive_items for update
  using ((select auth.uid()) is not null)
  with check ((select auth.uid()) is not null);

drop policy "cutpro_status_select_authenticated" on public.cutpro_status;
create policy "cutpro_status_select_authenticated" on public.cutpro_status
  for select using ((select auth.uid()) is not null);

drop policy "qa_test_runs_select_authenticated" on public.qa_test_runs;
create policy "qa_test_runs_select_authenticated"
  on public.qa_test_runs for select
  using ((select auth.uid()) is not null);

create index if not exists drive_items_post_id_idx on public.drive_items (post_id);
