# Automação de horários estratégicos (3 posts/dia) — design

Data: 2026-07-20

## Contexto

Pedido do Victor: automação pra publicar posts aprovados em horários estratégicos escolhidos por ele (ex.: 3 por dia), integrada ao Calendário, que também deve exibir/gerenciar esses horários.

Já existe um mecanismo quase idêntico: `social_accounts.acervo_daily_slots` (`time[]`) + cron `acervo-schedule` (`lib/acervo/scheduler.ts`) — hoje só distribui posts de acervo aprovados nos horários configurados, com trava anti-duplo-agendamento e cálculo de fuso América/São Paulo sem lib externa. Decisão: generalizar esse mecanismo em vez de criar um novo.

## Decisões (brainstorming, 20/07/2026)

1. **Escopo**: vale pra todo post aprovado sem horário manual, qualquer origem (Drive, Post rápido, acervo) — não só acervo.
2. **Onde configurar**: painel de horários move de `Admin → Contas` pra `/calendario`.
3. **Comportamento padrão muda**: hoje só acervo espera `scheduled_at`; Drive/painel publicam quase na hora ao aprovar. Isso muda — todo post aprovado sem horário manual entra na fila de horários. Quem define um horário manual (na aprovação/edição) publica nesse horário, ignorando a fila.
4. **Prioridade entre posts disputando o mesmo horário**: conteúdo curado (Drive/Post rápido) antes do acervo — bate com a distinção "volume × estratégico" já documentada em `docs/CLAUDE.md`. Dentro do mesmo grupo, FIFO por `created_at` (mesmo critério de hoje).

## Mudanças

### Dados
- Migration: `alter table social_accounts rename column acervo_daily_slots to daily_post_slots`.

### Scheduler (`lib/acervo/scheduler.ts` → `lib/scheduling/dailySlots.ts`)
- `pickCandidateForSlot` deixa de filtrar por `content_source`; recebe candidatos de qualquer origem e ordena: curado (`drive`/`painel`) por `created_at` asc, depois acervo por `created_at` asc — pega o primeiro da lista combinada.
- `isSlotTaken`/`slotDateTime` (cálculo de fuso) não mudam.

### Cron (`acervo-schedule` → `daily-schedule`)
- `app/api/cron/acervo-schedule/route.ts` → `app/api/cron/daily-schedule/route.ts`.
- Query de candidatos remove `.eq("content_source", "acervo")` — busca todo post `aprovado` com `scheduled_at is null` da conta.
- Resto da lógica (slots do dia + amanhã, trava atômica de claim) não muda.
- `.github/workflows/cron-trigger.yml`: renomeia a rota na lista de 30 em 30 min.
- Branch `chore/vercel-native-crons` (preparada, não mergeada): mesma renomeação no `vercel.json`.

### Elegibilidade de publicação (`lib/posts/pendingPublish.ts`)
- Remove a distinção por `content_source` — todo post elegível só quando `scheduled_at !== null && scheduled_at <= now`, sem exceção pro "null = publicar agora" que hoje só vale pra Drive/painel.

### UI
- Novo painel no topo de `/calendario`: lista contas sociais com input de horários (mesmo padrão `"09:00, 13:00, 19:00"` já usado em Admin → Contas, só movido).
- Remove a coluna de horários de `components/admin/contas-panel.tsx`.
- Action `updateAcervoSlots` → `updateDailyPostSlots`, movida pra `lib/calendar/actions.ts` (novo arquivo, ao lado de `lib/calendar/timezone.ts` já existente).

## Fora de escopo (YAGNI)
- Sem drag-and-drop no calendário.
- Sem limite de exatamente 3 horários no código — lista livre.

## Teste ponta a ponta (autorizado pelo Victor, gasta crédito real do Cut.Pro)

Fluxo completo pedido: pegar vídeo/imagem do Drive → contexto (inventado para imagem) → editar com template Cut.Pro (vídeo) → gerar legenda → enviar pra aprovação → na aprovação, definir horário (teste usa +30s a partir da aprovação, já que a automação real permite qualquer data/hora escolhida pelo usuário) → aprovar → confirmar publicação real no Instagram.

Como os vídeos reais hoje na pasta do Drive são inutilizáveis pro teste (o `video` de 5s é curto demais pro Cut.Pro — `VIDEO_TOO_SHORT`; o vídeo de 111,5MB nem sincroniza, teto de Storage do plano Free) — sobe um clipe sintético (~30s, gerado via ffmpeg local) na pasta real do Drive pra validar o fluxo completo. Dado de teste removido do banco/Drive depois (mesmo padrão do M17); post publicado no Instagram de teste (`@althorya.ai`) fica no ar, mesmo padrão dos testes anteriores desta sessão/M12.
