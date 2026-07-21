import type { CutProEditableRow } from "./pipeline";

/** Rótulo do estado de edição do Cut.Pro, compartilhado entre o card do
 * Drive e o card do Kanban (post rápido/acervo) — mesma máquina de
 * estados, mesmo texto pro usuário nos dois lugares. */
export const EDIT_STATUS_LABEL: Record<CutProEditableRow["edit_status"], string> = {
  nao_editado: "Não editado",
  enviando: "Enviando pro Cut.Pro…",
  clipando: "Clipando…",
  aplicando: "Aplicando template…",
  renderizando: "Renderizando…",
  editado: "Editado",
  erro: "Erro na edição",
};

/** Estados de repouso da máquina — qualquer coisa fora desses 3 conta como
 * "edição em andamento" pra qualquer trava de segurança ou indicador de
 * progresso (quadro de renderização, M20+). Checagem por exclusão em vez de
 * uma lista fixa dos estados "em andamento": "aplicando" é reservado, sem
 * chamador hoje (lib/cutpro/pipeline.ts), mas se ganhar um algum dia essa
 * checagem já cobre sem precisar lembrar de atualizar em cada lugar que usa. */
const CUTPRO_RESTING_STATUSES: ReadonlySet<CutProEditableRow["edit_status"]> = new Set([
  "nao_editado",
  "editado",
  "erro",
]);

export function isCutProBusy(editStatus: CutProEditableRow["edit_status"]): boolean {
  return !CUTPRO_RESTING_STATUSES.has(editStatus);
}
