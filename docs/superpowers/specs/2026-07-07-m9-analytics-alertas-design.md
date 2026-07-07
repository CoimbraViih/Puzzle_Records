# M9 — Analytics e alertas de conexão (design)

Data: 2026-07-07. Referência: [PLAN.md](../../../PLAN.md) (M9), [docs/CLAUDE.md](../../CLAUDE.md).

## Objetivo

Coleta periódica de métricas por post via API do Zernio, dashboard comparativo por conta/artista/horário, e alerta ativo quando uma conta social desconectar — sem depender de documentação real do Zernio (ainda não disponível), seguindo o mesmo espírito de stub best-effort isolado atrás de `PublishingProvider` já usado no M7.

## Decisões de escopo (perguntas fechadas no brainstorming)

- **Contrato de métricas do Zernio**: stub best-effort na interface `PublishingProvider`, mesmo padrão do M7 — não bloqueia o M9 esperando doc oficial.
- **Detecção de desconexão**: sinal indireto via falhas consecutivas de publicação (sem endpoint de status dedicado do Zernio, que não existe). Reaproveita o fluxo de `publish_error` já existente no M7.
- **Local do dashboard**: nova seção dentro de `/dashboard` (visão geral unificada existente), não uma rota nova.
- **Métricas coletadas**: curtidas, comentários, alcance/views — conjunto mínimo típico, suficiente para o comparativo pedido no PLAN.md.
- **Destinatários do alerta de desconexão**: aprovadores + admin, mesmo público de `notifyApprovers` (M6).
- **Frequência de coleta de métricas**: a cada 30 min, mesmo padrão de `sla-alert`/`acervo-schedule`.

## Modelo de dados

### Migration `0010_analytics.sql`

**Nova tabela `post_metrics`** (uma linha por post publicado, upsert a cada coleta):

- `post_id uuid primary key references public.posts (id)`
- `likes integer`
- `comments integer`
- `reach integer`
- `collected_at timestamptz not null default now()`
- `metrics_error text` — mesmo padrão de `art_generation_error`/`publish_error`: falha na coleta nunca é silenciosa.

RLS: `select` para qualquer usuário autenticado (mesmo padrão de `posts_select_authenticated`). Sem política de `insert`/`update` para usuários — só o cron (service-role, que ignora RLS) escreve.

**Novas colunas em `social_accounts`**:

- `connection_status text not null default 'conectada' check (connection_status in ('conectada', 'desconectada'))`
- `consecutive_publish_failures integer not null default 0`
- `disconnected_alert_sent_at timestamptz` — idempotência do alerta, mesmo padrão de `sla_alert_sent_at` (M6).

## Coleta de métricas

`lib/publishing/types.ts` ganha:

```ts
export interface PostMetrics {
  likes: number | null;
  comments: number | null;
  reach: number | null;
}

export interface PublishingProvider {
  publish(input: PublishInput): Promise<PublishResult>;
  getMetrics(postUrl: string): Promise<PostMetrics>;
}
```

`ZernioProvider.getMetrics` implementa um `GET` best-effort (formato exato a validar depois, mesma nota do M7 sobre `publish`), lançando `PublishError` em qualquer falha (rede, resposta malformada, HTTP não-2xx).

Novo cron `app/api/cron/collect-metrics/route.ts` (`*/30 * * * *`, mesmo padrão de auth `CRON_SECRET` fail-closed dos crons existentes):

- Busca posts com `status = 'publicado'`, `post_url is not null`, e `published_at` dentro dos últimos 30 dias (janela fixa — não configurável, evita crescimento ilimitado de chamadas ao Zernio para posts antigos).
- Para cada post, chama `provider.getMetrics(post.post_url)`.
- Sucesso: upsert em `post_metrics` (likes/comments/reach/collected_at), limpando `metrics_error`.
- Falha: upsert só de `metrics_error` (preserva últimas métricas boas conhecidas, não zera likes/comments/reach existentes).
- Falha em um post não interrompe o loop dos demais (mesmo padrão dos crons de M7/M8).

## Alerta de desconexão

Sem endpoint novo do Zernio. O cron `publish-scheduled` (M7, `lib/posts/pendingPublish.ts` / `app/api/cron/publish-scheduled/route.ts`) passa a atualizar `social_accounts` a cada tentativa de publicação:

- **Sucesso**: `consecutive_publish_failures = 0`, `connection_status = 'conectada'`, `disconnected_alert_sent_at = null`.
- **Falha**: `consecutive_publish_failures += 1`. Se o novo valor atingir `3` e `connection_status` ainda for `'conectada'`, marca `connection_status = 'desconectada'` e dispara o alerta.

Limiar de `3` falhas consecutivas: fixo no código (constante, mesmo padrão de `ACERVO_ARTIST_MIN_GAP_DAYS` do M8), não configurável por admin — evita over-engineering sem demanda real.

Alerta por e-mail: novo `lib/email/notifyAccountDisconnected.ts`, mesmo padrão de `notifyApprovers.ts` (busca usuários com papel `aprovador`/`admin`, escapa dados interpolados no HTML, falha de envio gravada em log, nunca bloqueia o fluxo do cron). Envio idempotente via `disconnected_alert_sent_at`: só dispara se ainda estiver `null` no momento da transição para `'desconectada'`.

Reconexão: a própria próxima publicação bem-sucedida naquela conta já reseta `connection_status`/`disconnected_alert_sent_at` — sem fluxo manual de "reconectar" no admin (fora de escopo do M9; se necessário depois, é ajuste pequeno).

## Dashboard comparativo

Nova seção em `app/(dashboard)/dashboard` (`lib/analytics/queries.ts` para as agregações), somando `post_metrics` dos últimos 30 dias:

- **Por conta social**: curtidas/comentários/alcance somados + contagem de posts publicados + badge de `connection_status`.
- **Por artista**: mesma agregação, via `posts.artist_id`.
- **Por horário**: agrupamento por hora do `scheduled_at` (ou `published_at` quando `scheduled_at` for nulo, caso do M7 "publicar agora") — para identificar horários de melhor engajamento.

Cada bloco mostra dados agregados só de posts com métricas coletadas (`post_metrics.collected_at is not null`); posts publicados sem métrica ainda (primeira janela de 30 min) aparecem implicitamente ausentes da soma, sem tratamento de erro visível — comportamento aceitável, não é uma falha do sistema.

## Fora de escopo (M9)

- Reconexão manual pelo admin (fluxo automático via publicação bem-sucedida já cobre o caso de uso real).
- Métricas por rede além de curtidas/comentários/alcance (ex.: cliques, salvamentos) — sem dado real do Zernio para validar o contrato ainda.
- Exportação/relatórios do dashboard — fica para o M10 (Polimento), que já lista "relatórios e exportação" explicitamente.
- Retenção/expurgo de `post_metrics` além da janela de coleta de 30 dias (a tabela não é limpa automaticamente; se crescer demais, é ajuste futuro).
