# M8 — Fila do acervo (design)

Contexto completo do produto em [docs/CLAUDE.md](../../CLAUDE.md). Milestone anterior (M7 — Publicação via Zernio) em [PLAN.md](../../../PLAN.md).

## Objetivo

Biblioteca de conteúdo já produzido (distinto da ingestão do Google Drive dos M3–M7, que é para conteúdo novo) com agendamento automático e distribuído de 2–3 posts/dia por conta social, evitando repetir o mesmo artista em uma janela recente.

## Decisões

1. **Origem do conteúdo**: upload manual direto no painel — a equipe sobe mídia + legenda já prontas, sem passar pela geração de IA (M4) nem pelo renderer de news card (M5). É conteúdo pronto para publicar, só precisa ser agendado.
2. **Aprovação**: reaproveita o funil de aprovação existente (Kanban de `/conteudo`, mesmas regras de RLS/`canEdit`/`canSubmit`/`canDecide`). A regra de ouro do projeto (nenhum post publica sem aprovação humana) não é enfraquecida — o upload cria um post em `rascunho`, que segue o ciclo normal até `aprovado`.
3. **Arte**: mídia já vem pronta (imagem ou vídeo), sem gerar arte com Template A/B. Ao criar o post de acervo, `rendered_art_url` é gravado como o mesmo path de `media_url` — reaproveita 100% do pipeline de publicação do M7 sem alterá-lo.
4. **Vídeo**: suportado desde já. O filtro `media_type = 'image'` em `lib/posts/pendingPublish.ts` (débito do M5, nunca foi implementado para vídeo) é removido; a exigência de `rendered_art_url` não nulo continua sendo o gate real.
5. **Anti-repetição**: não agendar 2 posts do mesmo artista dentro de uma janela mínima (constante de código, não configurável por admin — YAGNI).
6. **Horários**: slots fixos configuráveis pelo admin por conta social (ex.: 09h/13h/19h), não calculados automaticamente.
7. **Escopo de redes**: só contas Instagram, mesmo padrão "Instagram primeiro" do M6/M7.
8. **UI**: nova rota `/acervo` na sidebar (grupo "Operação"), separada do Kanban de `/conteudo`.

## Modelo de dados

Migration `supabase/migrations/0009_acervo.sql`:

- `posts.content_source` — enum `'drive' | 'acervo'`, default `'drive'` (não quebra posts existentes). Distingue conteúdo ingerido do Drive de upload manual de acervo.
- `social_accounts.acervo_daily_slots` — `time[]`, ex.: `{09:00,13:00,19:00}`. Horários-alvo configurados pelo admin. Só populado/relevante para contas Instagram.
- Nenhuma política de RLS nova: `content_source` e `acervo_daily_slots` são cobertas pelas políticas existentes de `posts`/`social_accounts` (são só mais colunas nas mesmas tabelas).

Os 3 estados do PLAN (novo/agendado/publicado) são **derivados**, não armazenados como um novo valor de `status`:

| Estado (UI) | Condição |
|---|---|
| Novo | `status='aprovado'` AND `content_source='acervo'` AND `scheduled_at IS NULL` |
| Agendado | `status='aprovado'` AND `content_source='acervo'` AND `scheduled_at IS NOT NULL` |
| Publicado | `status='publicado'` AND `content_source='acervo'` |

## Fluxo de upload e aprovação

- Novo formulário "Adicionar ao acervo" (variação de `components/kanban/post-form-dialog.tsx`): mídia (imagem ou vídeo) + legenda pronta + artista + conta social. Sem manchete gerada por IA, sem template de arte.
- Ao salvar: cria post com `content_source='acervo'`, `status='rascunho'`, `rendered_art_url = media_url` (mesmo path no bucket `posts-media`).
- Segue o Kanban normal de `/conteudo`: `rascunho → pendente_aprovacao → aprovado` (ou `rejeitado`), mesmas regras de permissão por papel já existentes.
- **Mudança de filtro no Kanban de `/conteudo`**: posts com `content_source='acervo'` só aparecem enquanto `status` for `rascunho`, `pendente_aprovacao` ou `rejeitado`. Ao chegar em `aprovado`/`publicado`, saem do Kanban e passam a aparecer só em `/acervo`. Posts `content_source='drive'` continuam aparecendo em todos os status, sem mudança de comportamento.

## Suporte a vídeo no pipeline de publicação (M7)

- `lib/posts/pendingPublish.ts`: remover o `.eq("media_type", "image")` da query. A exigência de `rendered_art_url IS NOT NULL` continua — que já é satisfeita tanto por posts do M5 (só imagem, inalterado) quanto pelos novos posts de acervo (imagem ou vídeo, via o passo acima).
- Nenhuma mudança necessária em `lib/publishing/zernio.ts` nem em `app/api/cron/publish-scheduled/route.ts`: ambos já são agnósticos ao tipo de mídia (só passam `media_url`/path adiante).

## Agendamento distribuído (novo cron)

Novo cron `app/api/cron/acervo-schedule/route.ts`, registrado no `vercel.json` a cada 30 minutos (mesmo padrão de autenticação via `CRON_SECRET` dos crons existentes):

1. Para cada `social_accounts` do Instagram com `acervo_daily_slots` preenchido:
2. Para cada slot de hoje e de amanhã (fuso `America/Sao_Paulo`, assumido — não há tratamento de fuso horário em nenhum outro lugar do código hoje):
   - Se já existe post `aprovado` (com `scheduled_at` = aquele slot) ou `publicado` daquela conta perto daquele horário → pula (slot ocupado).
   - Se o slot já passou → pula.
   - Se o slot está livre e no futuro → busca o candidato mais antigo (`created_at` ASC, FIFO) com `status='aprovado'`, `content_source='acervo'`, `scheduled_at IS NULL`, mesma conta social, cujo artista não tenha sido agendado/publicado (para qualquer conta) dentro da janela mínima de repetição (constante `ACERVO_ARTIST_MIN_GAP_DAYS = 3`, em `lib/acervo/constants.ts`).
   - Grava `scheduled_at` do post escolhido para o horário do slot. A partir daí, o cron `publish-scheduled` do M7 (inalterado) publica normalmente quando o horário chegar.
3. Não achar candidato elegível não é erro — só não preenche o slot naquele ciclo (tentará de novo no próximo).

## UI

- **Nova rota `/acervo`** (grupo "Operação" da sidebar, ao lado de Conteúdo/Aprovação): 3 colunas Novo/Agendado/Publicado, somente leitura de status (sem drag-and-drop — a transição Novo→Agendado é automática pelo cron, Agendado→Publicado pelo M7). Botão "Adicionar ao acervo" abre o formulário novo.
- **`/admin/contas`**: novo campo "Horários do acervo" (lista de horários `HH:MM`), editável inline por linha, mesmo padrão do campo `zernio_account_id` do M7 — só admin, só relevante para contas Instagram.

## Trade-offs assumidos (aceitos no design)

- Fuso horário fixo `America/Sao_Paulo` hardcoded, sem suporte multi-fuso.
- Janela anti-repetição de artista é constante de código, não exposta como configuração de admin.
- Provider Zernio continua sendo um stub best-effort (mesmo débito já documentado no M7) — vídeo passa pelo mesmo `publish()` sem validação real contra a API.

## Fora de escopo (explicitamente)

- Priorização de "horários de maior alcance" (mencionada no PRD) — depende de dados de analytics do M9, não existentes ainda. M8 usa só os slots fixos configurados pelo admin.
- Lembrete de reenvio/preenchimento retroativo de slots perdidos além do próprio ciclo de 30 min do cron.
- Suporte a redes além do Instagram.
