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
