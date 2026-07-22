# Avaliação: ponte n8n vs. pipeline nativo Drive→Cut.Pro→Zernio (21/07/2026)

## Pergunta original

Victor perguntou se (a) o painel Next.js consegue editar a "Manchete" mostrada no modal "Editar post"; (b) o n8n pode servir de ponte, buscando vídeos do Drive "transformados em json" e publicando via Zernio; (c) o frontend do painel pode disparar esse workflow n8n como "capa da frente", maximizando a automação até a aprovação humana; e pediu um plano de desenvolvimento para essa arquitetura híbrida.

## Achado principal: a ponte já existe, nativa, e já foi validada com posts reais

Antes de desenhar qualquer ponte, li o `PLAN.md` do próprio projeto (550 linhas, milestones M0–M22) e o componente do modal do print (`components/kanban/post-form-dialog.tsx`). Conclusão: **o painel já faz exatamente o que a arquitetura híbrida proposta faria** — e já foi testado de ponta a ponta com publicação real no Instagram, duas vezes:

- `instagram.com/reel/DA_0rblicBe/` (M20, 19/07) e o mesmo link registrado de novo no M21 (20/07) — fluxo completo Drive → Cut.Pro (edição com template) → legenda por IA → aprovação com horário escolhido → publicação automática via Zernio.
- Isso roda inteiramente dentro do próprio painel: página `/drive` (espelho da pasta do Google Drive, M16), botão "Editar com template" (Cut.Pro, M16/M20), geração de legenda por IA (M4/D3), fila de aprovação existente (M6), agendamento por horário estratégico (M21), publicação via Zernio (M7/M12) — tudo já rastreado no Supabase, com RLS, fila de renderização visível (M22, implementado **hoje**), alerta de crédito baixo do Cut.Pro (D6) e trava contra reenvio duplicado.

Ou seja: o "n8n como ponte" e o "frontend como capa disparando o workflow" que você propôs já são, literalmente, a arquitetura que o M16–M22 implementaram — só que nativamente, sem n8n no meio, e com mais maturidade operacional (fila de renderização com progresso real, travas de concorrência, erro nunca silencioso) do que o workflow que construímos hoje.

## Sobre o campo "Manchete" do print

Não é o que você está pensando. `headline` (Manchete) no `PostFormDialog` alimenta o **Template A/B do M5** — um gerador de "news card" (imagem estática 1080×1350, renderizada via Satori, faixa branca com o texto) para posts de **imagem**. Não tem nenhuma ligação com o vídeo editado pelo Cut.Pro:

- M5 é explícito: "só posts com `media_type = 'image'`; vídeo grava erro explícito em vez de tentar extrair frame".
- M16/D5 (o fluxo de vídeo) é igualmente explícito: envia pra aprovação "sem gerar arte/manchete, mesmo padrão do acervo".

Então, se você preencher "Manchete" num post de vídeo hoje, o campo é salvo no banco mas **nunca é renderizado em lugar nenhum** — nem na imagem (não existe imagem), nem queimado no vídeo (Cut.Pro não usa esse campo). A única forma de ter um texto dinâmico queimado no vídeo seria reviver o **M14** (motor Remotion, construído mas nunca implantado — falta decidir onde hospedar o worker, que precisa de Chromium). Isso já bate com o que investigamos hoje mais cedo: a própria Cut.Pro (API e editor de template) não expõe nenhum jeito de sobrescrever o texto que ela queima no vídeo.

## Por que eu não recomendo construir a ponte n8n

1. **Duplicação de uma funcionalidade já mais madura.** O pipeline nativo já resolve trava de concorrência (M8/M17/M20), erro nunca silencioso em cada etapa, alerta de saldo baixo do Cut.Pro (D6), e progresso real de renderização visível na UI (M22, hoje). O workflow n8n de hoje não tem nada disso — inclusive o polling do Zernio no n8n **não tem teto de tentativas**, ao contrário do `lib/publishing/zernio.ts` de produção (10 tentativas, ~30s).
2. **Risco operacional real e imediato**: o `drive-sync` nativo e o workflow n8n de hoje **apuram a mesma pasta do Google Drive**. Rodando os dois, um vídeo pode ser processado (e potencialmente publicado) duas vezes, por dois caminhos diferentes, sem nenhuma coordenação entre eles.
3. **A "regra de ouro" está violada agora mesmo no n8n**: você desconectou a aprovação via WhatsApp "por enquanto" para testar, e ela nunca foi reconectada — o workflow publica direto no Instagram sem gate humano. Isso é exatamente o cenário que `docs/CLAUDE.md` chama de pior caso operacional.
4. **O painel nativo já publicou de verdade** duas vezes usando a mesma conta de teste (`@althorya.ai`) que usamos no n8n hoje — vale checar se não há posts duplicados/conflitantes nessa conta agora.

## O gargalo real não é arquitetura — é infraestrutura de cron

O motivo de "parecer" que falta automação não é a ausência de uma ponte: é que o cron do GitHub Actions (usado hoje porque o plano Vercel é Hobby) está **throttlado para ~1–3h por execução** em vez de 5 minutos (achado do M18, confirmado de novo no M20 de ontem). Isso já tem solução identificada e parcialmente pronta:

- Upgrade da Vercel para o plano Pro (~US$20/mês) — remove o teto de 1x/dia do Hobby para crons nativos.
- Branch `chore/vercel-native-crons` já preparada, só não mergeada — assim que o upgrade acontecer, é só mergear.

Isso sozinho entrega o "processo mais automatizado possível até a aprovação humana" que você pediu, sem escrever uma linha de integração nova.

## Recomendação

Não construir a arquitetura híbrida. Em vez disso:

1. **Pausar o workflow n8n desta sessão agora** (desativar o trigger, ou pelo menos reconectar a aprovação do WhatsApp) — ele está publicando sem gate humano neste exato momento se algo disparar o trigger de novo.
2. **Conferir a conta `@althorya.ai`** por posts duplicados/conflitantes entre os testes do n8n de hoje e os testes nativos do M20/M21.
3. **Upgrade Vercel Hobby → Pro** e merge da branch `chore/vercel-native-crons` — é a mudança que de fato resolve "automação máxima até a aprovação".
4. **Decidir sobre o headline estilo "notícia urgente" queimado no vídeo** separadamente: só é viável reabrindo o M14 (Remotion) e resolvendo a hospedagem do worker — orçar esse esforço antes de comprometer, já que a rota Cut.Pro está definitivamente descartada (confirmado hoje via API e editor de template).
5. **Arquivar o workflow n8n** ou reaproveitá-lo só se houver algum uso fora do escopo que o painel já cobre — como pipeline de publicação, ele é redundante.

## Item em aberto, não relacionado a esta avaliação

O vídeo publicado de cabeça para baixo no primeiro teste do n8n (execução 29) segue sem causa raiz confirmada; o segundo teste (execução 31, vídeo diferente) ainda não teve retorno seu sobre se saiu invertido também. Só relevante se decidir manter o n8n rodando para algo.
