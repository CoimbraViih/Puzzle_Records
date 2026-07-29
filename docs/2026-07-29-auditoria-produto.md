# Auditoria do produto — Puzzle Records (29/07/2026)

**Método**: três frentes de investigação em paralelo (pipeline nativo de conteúdo, UX do painel, infraestrutura/segurança/testes) mais a revisão dos dois workflows n8n e dos advisors do Supabase feita ao longo desta sessão. Só leitura — nenhuma mudança foi aplicada além das duas já combinadas com você antes desta auditoria (fix do `Aprovado?` no n8n e migração dos crons pro n8n).

**Priorização**: `(Impacto + Risco) × (6 − Esforço)`, escala 1–5 cada, adaptada do playbook de tech debt. Impacto = quanto te atrapalha no uso diário; Risco = o que acontece se não mexer (crédito perdido, post duplicado, confusão sobre o que está publicado de verdade); Esforço = dificuldade real do fix, considerando o que já vimos nesta sessão.

O critério que você pediu — "não travar em nenhuma etapa" — apareceu como o padrão dominante nos três achados de maior prioridade real: três crons sem timeout configurado (`maxDuration`) que, ao serem interrompidos no meio de uma chamada externa lenta, não gravam erro nenhum — o post simplesmente para, sem rastro, e ninguém (nem você, nem o sistema) sabe que precisa agir.

## Fase 0 — hoje, esforço mínimo, risco alto

Cada item abaixo é uma mudança pequena (1–3 linhas) que fecha um jeito real de perder crédito ou publicar errado sem aviso.

**`publish-scheduled` sem `maxDuration`** (`app/api/cron/publish-scheduled/route.ts`). A publicação real no Zernio espera até 30s de polling deliberado (`lib/publishing/zernio.ts`) mais upload de mídia — sem `maxDuration` explícito, a função provavelmente é interrompida no meio disso rotineiramente. Como o `zernio_post_id` já foi gravado antes do polling, o post pode estar publicado de verdade no Instagram enquanto o painel mostra "Publicando..." como se tivesse falhado — o maior risco de confusão real do produto hoje. Fix: `export const maxDuration = 300;`, mesmo padrão já usado em `generate-copy`/`generate-video-art`.

**`cutpro-pipeline` sem `maxDuration`** (`app/api/cron/cutpro-pipeline/route.ts`). Pra vídeos grandes, se a função for interrompida no meio do upload pro Cut.Pro, `cutpro_video_id` nunca é gravado e o próximo ciclo (5 min depois) reinicia o upload do zero — gastando créditos indefinidamente, sem nunca gravar `cutpro_error`. Mesmo fix de 1 linha.

**`drive-sync` sem `maxDuration`** (`app/api/cron/drive-sync/route.ts`). Arquivo grande do Drive pode nunca terminar de sincronizar, sem erro visível em `drive_items`. Mesmo fix.

**`generate-copy` sem filtro `content_source != 'n8n'`** (`lib/posts/pendingCopy.ts`). É exatamente o mesmo bug que já corrigimos no `cutpro-pipeline` esta semana, só que num cron diferente — ainda não replicado aqui. Um post do fluxo n8n pode ganhar uma legenda nativa gerada por engano antes do Agente de Legendas do n8n terminar o dele. Fix: mesma linha `.neq("content_source", "n8n")`.

**n8n — nó "Gerar legenda (app)" sem tratamento de erro**. Já vimos isso acontecer de verdade: um 504 real da Vercel deixou um post com Cut.Pro já pago (upload + clipagem + render) órfão pra sempre em `edit_status: enviando`, porque não existe nó de erro conectado nesse ponto — diferente de clipagem/render/upload no Storage, que já têm. Fix: adicionar um nó "Registrar erro (legenda)" igual aos outros três, conectado na saída de erro desse HTTP Request.

**Next.js com CVE high conhecida**. `next@16.2.10` tem SSRF em Server Actions/rewrites e bypass de middleware com Turbopack, ambos corrigidos em `16.2.12` — upgrade de patch, sem mudança de major. `npm audit fix` resolve isso e as vulnerabilidades transitivas (`postcss`, `sharp`, `brace-expansion`) junto.

**Leaked Password Protection desligada no Supabase Auth**. Um toggle no painel do Supabase (Authentication → Policies), sem custo, sem risco de quebrar nada.

## Fase 1 — esta semana, fecha os "trava sem avisar"

**`video_render_status` invisível na UI** (`components/kanban/post-card.tsx`, `components/drive/drive-item-card.tsx`). Um post de vídeo pode ficar horas em `processing` (fila de render Remotion travada) com o card idêntico a um post que nem começou — só aparece algo se `art_generation_error` for preenchido. Vale um badge simples reaproveitando o padrão já bom do `RenderStatusBadge` do Cut.Pro.

**Calendário: horário mal formatado é descartado em silêncio** (`lib/calendar/actions.ts`). Digitar `9:00` em vez de `09:00` faz o horário simplesmente sumir da lista salva, sem aviso — e isso reduz a fila automática de publicação sem você perceber até reparar que saíram menos posts que o esperado. Fix: validar no formulário e mostrar erro, não só filtrar em silêncio no server action.

**Admin → Contas sociais sem feedback nenhum** (`components/admin/contas-actions.ts`). Adicionar/salvar/excluir conta pode falhar (RLS, rede, ID duplicado) só com `console.error` — a tela volta ao normal como se tivesse dado certo. Diferente do padrão já bom usado nos botões de posts (`SubmitButton`/`ConfirmSubmitButton`), que só precisa ser replicado aqui.

**`generate-video-art` sem filtro de `edit_status`**. Um post que você mandou manualmente pro fluxo Cut.Pro pode ser pego em paralelo pelo pipeline Remotion nativo — duas máquinas de estado de vídeo diferentes competindo pela mesma linha. Fix: excluir posts com `edit_status` em transição (`enviando`/`clipando`/`renderizando`) da query de `pendingVideoArt.ts`.

**Manchete/tarja não aparece nos vídeos do fluxo n8n** — o que você perguntou mais cedo. Fix já mapeado: no nó "Registrar: pendente de aprovação", parar de gravar `rendered_art_url` na hora e gravar `media_url` = caminho real do vídeo editado pela Cut.Pro. O cron `generate-video-art` (já rodando via n8n) pega o post sozinho e queima a manchete na tarja usando o template padrão já configurado.

**`cutpro-pipeline`: execuções sobrepostas podem processar o mesmo item duas vezes**. `fetchEligibleItems` não reivindica (claim atômico) o item antes de processar — duas rodadas do cron podem pegar o mesmo post "enviando" em paralelo e pagar Cut.Pro duas vezes por ele. Esforço um pouco maior (precisa de um `UPDATE ... WHERE edit_status = X` atômico antes do processamento, mesmo padrão já usado em `poll-video-render` e `daily-schedule`).

## Fase 2 — estrutural (o que evita o *próximo* incidente, não só corrige os de hoje)

**Zero testes automatizados no app principal.** Não existe nenhum `*.test.ts` fora do subprojeto `render-worker`. Dado que já tivemos 2 incidentes reais de produção nesta mesma semana, e que a lógica mais frágil (claims atômicos, fallbacks, filtros de `content_source`) é exatamente o tipo de coisa que um teste unitário simples pega antes de virar incidente, comece pelos 3-4 crons mais críticos (`publish-scheduled`, `cutpro-pipeline`, `generate-video-art`) em vez de tentar cobertura ampla de uma vez.

**Nenhum monitoramento/alerta real.** Hoje você só descobre que algo travou olhando manualmente o painel ou o Supabase. Recomendo conectar o **Sentry** (captura de erro em produção, com alerta) — é a peça que fecha o padrão que se repetiu em quase todo achado desta auditoria: erro acontece, mas fica só em `console.error` ou em silêncio total. Deixei o botão de conectar logo abaixo desta mensagem.

**RLS de `drive_items`/`notifications` sem checagem de papel no UPDATE.** Hoje qualquer usuário autenticado pode atualizar qualquer linha dessas duas tabelas — inofensivo com você sozinho operando, mas o resto do schema (`posts`) já modela papéis (`admin`/`aprovador`/`equipe_conteudo`) corretamente, e esse ponto ficou pra trás. Só importa no dia que outra pessoa tiver login no painel.

## Achados de baixa prioridade (registrados, não urgentes)

Credenciais hardcoded nos nós HTTP do n8n em vez de credenciais reais do n8n (mesmo padrão usado desde o início do projeto — só importa se o workflow for exportado/compartilhado); botão "Duplicar" template engolindo erro silenciosamente; mensagem de erro da reconexão do Google Drive não menciona que a causa mais provável é esquecer o redeploy; funções `has_role`/`is_admin` expostas como `SECURITY DEFINER` via RPC (comportamento seguro hoje, mas value trocar pra `SECURITY INVOKER`); 4 índices não utilizados no Supabase (irrelevante com o volume atual de dados).

## Sobre a skill usada

Usei a skill `engineering:tech-debt` (já instalada) pra estruturar a priorização acima. Não precisei instalar nada novo pra fazer a auditoria em si — os únicos gaps genuínos que valeriam uma ferramenta nova são teste automatizado (`engineering:testing-strategy`, também já instalada, útil quando for montar a suíte da Fase 2) e monitoramento de erro, onde a recomendação concreta é conectar o Sentry (não é uma skill, é um MCP — botão abaixo).
