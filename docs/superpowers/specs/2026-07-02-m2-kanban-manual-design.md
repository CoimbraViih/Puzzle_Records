# M2 — Modelo de dados + Kanban manual — Design

Data: 2026-07-02
Escopo: [PLAN.md](../../../PLAN.md) — milestone M2.

## Objetivo

Validar o fluxo de aprovação antes de plugar IA e integrações: um post criado manualmente no
painel (sem Drive, sem OpenAI, sem Zernio) percorre todo o ciclo de status num Kanban, com
aprovar/editar/rejeitar funcionando ponta a ponta.

## Decisões (confirmadas com o usuário)

- **Campos do post**: conjunto mínimo (artista, mídia, manchete, legenda, template, rede/conta
  social, status) + `post_type` (viral geral / notícia funk / lançamento label — reflete o mix
  editorial do `GUIA-DE-ESTILO-POSTS-PUZZLE.md`) + `scheduled_at` opcional (sem lógica de
  publicação ainda — só o campo, para o M7 não precisar de migration nova).
- **4 colunas**: Rascunho → Pendente de aprovação → Aprovado → Rejeitado. Sem "Agendado"/
  "Publicado" ainda — esses só ganham função real em M7 e M8; adicioná-los agora seria UI morta.
- **Permissões por papel**: equipe de conteúdo cria e edita os próprios posts em Rascunho/
  Rejeitado; aprovador decide (aprova/edita/rejeita) posts em Pendente de aprovação; admin tem
  acesso total. Reflete as personas do `docs/CLAUDE.md`.
- **Artistas e contas sociais**: CRUD simples em `/admin` (sem integração real com Zernio/Drive
  ainda — são dados de referência usados no formulário de post).
- **Upload de mídia real** via Supabase Storage (bucket privado, URL assinada), não um campo de
  texto — evita retrabalho no M3 (ingestão do Drive vai popular o mesmo bucket/campo).
- **Transições de status via botões de ação** no card (não drag-and-drop) — sem dependência nova,
  menos código, evita mudança de status acidental. Drag-and-drop fica como polimento possível do
  M10.

## Modelo de dados

Migration `0002_content_model.sql`, três tabelas novas:

### `artists`

| coluna       | tipo                              | notas |
|--------------|------------------------------------|-------|
| `id`         | `uuid` PK, default `gen_random_uuid()` | |
| `name`       | `text not null`                    | |
| `handle`     | `text not null`                    | `@mention` do artista, ex. `@mcstaylon` |
| `created_at` | `timestamptz default now()`        | |

### `social_accounts`

| coluna         | tipo                                                        | notas |
|----------------|---------------------------------------------------------------|-------|
| `id`           | `uuid` PK, default `gen_random_uuid()`                        | |
| `network`      | `text not null check (network in ('instagram','tiktok','youtube','facebook'))` | |
| `handle`       | `text not null`                                                | |
| `display_name` | `text not null`                                                | |
| `created_at`   | `timestamptz default now()`                                    | |

### `posts`

| coluna              | tipo                                                                                   | notas |
|---------------------|------------------------------------------------------------------------------------------|-------|
| `id`                | `uuid` PK, default `gen_random_uuid()`                                                    | |
| `artist_id`         | `uuid` FK → `artists.id`, nullable                                                        | nem todo post é de lançamento |
| `social_account_id` | `uuid not null` FK → `social_accounts.id`                                                 | |
| `template`          | `text not null check (template in ('A','B'))`                                             | faixa branca / manchete sobre imagem |
| `post_type`         | `text not null check (post_type in ('viral_geral','noticia_funk','lancamento'))`          | |
| `headline`          | `text not null`                                                                            | |
| `caption`           | `text not null`                                                                            | |
| `media_url`         | `text not null`                                                                            | path no bucket `posts-media` |
| `media_type`        | `text not null check (media_type in ('image','video'))`                                   | |
| `status`            | `text not null check (status in ('rascunho','pendente_aprovacao','aprovado','rejeitado')) default 'rascunho'` | |
| `scheduled_at`      | `timestamptz`, nullable                                                                    | sem lógica de publicação neste M2 |
| `rejection_reason`  | `text`, nullable                                                                           | preenchido ao rejeitar |
| `created_by`        | `uuid not null` FK → `profiles.id`                                                        | |
| `approved_by`       | `uuid` FK → `profiles.id`, nullable                                                        | setado ao aprovar/rejeitar |
| `created_at`        | `timestamptz default now()`                                                                | |
| `updated_at`        | `timestamptz default now()`                                                                | trigger atualiza a cada `update` |

### RLS

Reaproveita a função `public.is_admin()` já existente (M1).

- `artists`, `social_accounts`: `select` para qualquer usuário autenticado; `insert`/`update`/
  `delete` só admin (`is_admin()`).
- `posts`:
  - `select`: qualquer usuário autenticado vê todos os posts (o Kanban mostra o board completo
    para todos os papéis; a UI restringe as ações, não a visibilidade).
  - `insert`: `equipe_conteudo` ou `admin`, com `created_by = auth.uid()`.
  - `update`:
    - `equipe_conteudo`: só a própria linha (`created_by = auth.uid()`) e só quando o `status`
      atual é `rascunho` ou `rejeitado`.
    - `aprovador`: qualquer linha, só quando o `status` atual é `pendente_aprovacao`.
    - `admin`: qualquer linha, sempre.
  - `delete`: `equipe_conteudo` só a própria linha em `rascunho`; `admin` sempre.

### Storage

Bucket privado `posts-media` (criado via `insert into storage.buckets` na migration):

- Política de `insert`/`select` em `storage.objects` para esse bucket: qualquer usuário
  autenticado (a mesma pessoa que sobe a mídia; leitura via URL assinada gerada no server, não
  bucket público).
- Sem política de `delete`/`update` neste M2 (mídia órfã de post excluído fica para faxina
  futura, não crítico no volume do MVP).

## Fluxo de status

```
rascunho ──(conteúdo: "Enviar para aprovação")──> pendente_aprovacao
rascunho ──(conteúdo: editar / excluir)
rejeitado ──(conteúdo: editar + "Reenviar para aprovação")──> pendente_aprovacao
pendente_aprovacao ──(aprovador/admin: "Aprovar")──> aprovado
pendente_aprovacao ──(aprovador/admin: "Rejeitar" + motivo obrigatório)──> rejeitado
aprovado ──(estado terminal neste M2; M7 acrescenta agendado/publicado)
```

Botões visíveis em cada card dependem do papel logado (`profile.role`, já disponível via
`getCurrentProfile()`) cruzado com o `status` atual do post — mesmo padrão de
`ROLE_LABELS`/`ROLE_HOME` já usado no projeto.

## Telas

- **`/conteudo`** (equipe de conteúdo): Kanban com as 4 colunas. Botão "Novo post" abre um
  formulário (artista — select opcional, conta social — select obrigatório, template A/B, tipo de
  post, manchete, legenda, upload de mídia, agendamento opcional). Ações habilitadas só nos
  próprios cards em Rascunho/Rejeitado (editar, excluir, enviar/reenviar para aprovação).
- **`/aprovacao`** (aprovador): mesmo componente de Kanban. Cards em Pendente de aprovação
  ganham os botões Aprovar / Editar / Rejeitar (motivo obrigatório em modal). Outras colunas
  ficam visíveis, somente leitura.
- **`/admin`**: dois links novos — **Artistas** (`/admin/artistas`) e **Contas sociais**
  (`/admin/contas`), CRUD simples (tabela + formulário criar/editar/excluir), acesso só admin.
  Admin também vê o mesmo Kanban com todas as ações liberadas (reaproveita o componente).

## Componentes principais

- `components/kanban/board.tsx` — recebe a lista de posts + o papel do usuário, agrupa por
  `status`, renderiza as 4 colunas.
- `components/kanban/post-card.tsx` — card com dados resumidos do post + botões de ação
  condicionais por papel/status.
- `components/kanban/post-form.tsx` — formulário de criar/editar (usado tanto por conteúdo
  quanto por aprovador, com campos habilitados/desabilitados conforme permissão).
- `components/kanban/reject-dialog.tsx` — modal com campo de motivo obrigatório.
- `lib/posts/queries.ts` — leitura de posts/artistas/contas sociais (server-side, Supabase
  client).
- `lib/posts/actions.ts` — server actions: criar, editar, excluir, enviar para aprovação,
  aprovar, rejeitar. Cada action reforça a mesma regra de permissão que a RLS (defesa em
  profundidade, como já feito em M1 para `/api/admin/**`).
- `app/admin/artistas/`, `app/admin/contas/` — páginas + server actions de CRUD, seguindo o
  padrão de `/admin/usuarios` (M1).

## Fora de escopo (fica para milestones seguintes)

- Drag-and-drop entre colunas (possível polimento do M10).
- Ingestão automática do Drive (M3) — posts só entram via formulário manual.
- Geração de manchete/legenda por IA (M4).
- Geração real da arte a partir do template (M5) — o `template` só é um campo escolhido no
  formulário, sem renderização de imagem ainda.
- Preview fiel por rede, notificações por e-mail, SLA de 4h (M6).
- Publicação real e uso do campo `scheduled_at` (M7).
- Status "agendado"/"publicado" e fila do acervo (M7/M8).
- Faxina de mídia órfã no Storage.

## Critério de pronto

Um post criado manualmente em `/conteudo` (com upload de mídia real) aparece no Kanban em
Rascunho, pode ser enviado para aprovação, aparece para o aprovador em `/aprovacao`, é aprovado
(ou rejeitado com motivo e reenviado depois de editado), e o status final reflete corretamente em
todas as telas que exibem o Kanban. RLS bloqueia uma tentativa de `equipe_conteudo` aprovar o
próprio post ou editar um post de outra pessoa.
