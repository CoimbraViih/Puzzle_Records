# Ingestão do Drive sem `.json` obrigatório + contexto por nome de arquivo

**Data:** 14/07/2026 · **Responsável:** Victor (decisões) + Claude (implementação)

## Contexto e problema

Hoje (`lib/drive/pairFiles.ts`) o sistema só cria um post a partir de um arquivo solto
na pasta do Drive quando encontra **dois** arquivos com o mesmo nome-base: a mídia
(imagem/vídeo) e um `.json` de metadado (`lib/drive/metadata.ts`, campos
`fato`/`musica`/`tipo`). Um arquivo de mídia sozinho, sem `.json` correspondente, fica
"esperando o par" para sempre — nunca vira post.

Na prática isso é fricção real: a equipe de conteúdo (não-técnica) não tem paciência
nem know-how pra criar um arquivo `.json` de texto pra cada upload. O objetivo desta
mudança é deixar o `.json` **opcional** — soltar só a mídia já deve funcionar — mantendo
o `.json` como opção pra quem quiser digitar contexto real.

## Decisões tomadas (sessão de brainstorming, 14/07/2026)

- **`tipo` sem `.json`**: assume `"viral_geral"` por padrão (o mais genérico dos 3 tipos,
  sem tentar inferir "lançamento"/"notícia" do nome do arquivo).
- **Contexto por nome de arquivo**: quando não há `.json`, o sistema tenta primeiro
  extrair contexto do próprio **nome do arquivo** — muitos arquivos gerados por IA
  generativa já têm nomes descritivos (ex: `Crie uma imagem de um cachorro em um
  gramado.png`, literalmente o prompt usado pra gerar a imagem). Só quando o nome
  **não** é descritivo (nomes de câmera/ferramenta de geração de vídeo, tipo
  `20251022_2126_New Video_simple_compose_01k877bc1mfm59en0zkzg7ph8g.mp4`, que mistura
  poucas palavras reais com um hash longo) o sistema cai pro comportamento de
  fallback abaixo.
- **Fallback por tipo de mídia, quando nome não é descritivo E não há `.json`**:
  - **Vídeo**: cai na análise que já existe hoje (`lib/openai/videoAnalysis.ts` — frames
    via FFmpeg + transcrição via Whisper) — **nenhum código novo aqui**, o pivô de
    10/07/2026 já cobre esse caso (vídeo nunca depende de `fato`).
  - **Imagem**: **não** ganha um pipeline de análise de visão novo (decisão explícita —
    custo/complexidade não justificados agora). Continua exatamente como hoje: o cron
    `generate-copy` grava `copy_generation_error` explícito (sem custo de IA) e a equipe
    edita o post manualmente no Kanban pra escrever a manchete/legenda à mão.
- **Mesma heurística vale pro upload direto no painel** ("Post rápido",
  `createPostWithAI` em `lib/posts/actions.ts`): quando o campo de contexto vier vazio,
  tenta o nome do arquivo enviado antes de cair no mesmo fallback por tipo de mídia
  acima — mesma lógica, dois pontos de entrada (Drive e painel).
- **`.json` continua funcionando exatamente como hoje** quando presente — não é removido
  como opção, só deixa de ser obrigatório. Um `.json` com `fato` sempre tem prioridade
  sobre o nome do arquivo.
- **Fora de escopo desta mudança** (decisão explícita, vira brainstorming separado
  depois): formulário conectado ao WhatsApp pra dar contexto remotamente, sem precisar
  estar no computador.

## Heurística de "nome descritivo"

Nova função pura `lib/drive/filenameContext.ts`, testável isoladamente:

```ts
export function extractContextFromFilename(fileName: string): string | null
```

Regras (aplicadas ao nome-base, sem a extensão):
1. Separar o nome-base em tokens por espaço, `_`, `-`, `.` (tratando cada um como
   possível palavra).
2. Se **qualquer** token tiver 12+ caracteres alfanuméricos misturando letras e dígitos
   de forma densa (padrão de hash/ID gerado — ex: `01k877bc1mfm59en0zkzg7ph8g`) → nome
   **não é descritivo**, retorna `null`, independente do resto.
3. Senão, contar tokens que são só letras (aceita acentos), 3+ caracteres. Se houver
   **3 ou mais** desses tokens → nome **é descritivo**: retorna o nome-base limpo
   (tokens não-alfabéticos residuais removidos, espaços normalizados) como contexto.
4. Caso contrário → `null` (nome não descritivo).

Exemplos (validam a heurística contra os 2 arquivos reais já usados nesta sessão):
- `"Crie uma imagem de um cachorro em um gramado"` → 8 tokens alfabéticos, nenhum hash
  → **descritivo**, retorna a frase como está.
- `"20251022_2126_New Video_simple_compose_01k877bc1mfm59en0zkzg7ph8g"` → contém o token
  `01k877bc1mfm59en0zkzg7ph8g` (26 caracteres alfanuméricos densos) → **não descritivo**,
  retorna `null`, mesmo tendo palavras reais (“New”, “Video”, “simple”, “compose”).

## Arquitetura / arquivos afetados

1. **`lib/drive/pairFiles.ts`** — hoje só retorna itens com `media` **e** `metadata`
   presentes. Passa a retornar itens com `media` sempre presente e `metadata` **opcional**
   (`FilePair.metadata?: DriveFile`). Um `.json` órfão (sem mídia com o mesmo nome) continua
   sem sentido e é ignorado, como hoje.
2. **`lib/drive/filenameContext.ts`** (novo) — a heurística acima, função pura, sem
   dependência de rede/IA.
3. **`lib/drive/ingestFile.ts`** (`ingestFilePair`) — quando `pair.metadata` existe,
   comportamento idêntico ao atual (baixa e faz `parseMetadata`). Quando **não** existe:
   não tenta baixar/parsear nada; usa `extractContextFromFilename(pair.media.name)` como
   `source_fact` (pode ser `null`), `musica: null`, `tipo: "viral_geral"`. Sem
   `ingestion_warning` para esse caso — deixou de ser uma configuração "incompleta", é o
   caminho normal e esperado agora.
4. **`lib/posts/actions.ts`** (`createPostWithAI`) — quando o campo `context` do
   formulário vier vazio, tenta `extractContextFromFilename(mediaFile.name)` antes de
   aplicar a validação atual (hoje: erro obrigatório pra imagem sem contexto). Vídeo
   sempre analisa a própria mídia como já faz hoje, independente de haver ou não contexto
   do nome do arquivo (mesmo padrão do Drive).
5. **Nenhuma mudança** em `lib/openai/generateCopy.ts`, `lib/openai/prompts.ts`, nem no
   cron `app/api/cron/generate-copy/route.ts` — os modos `"text"`/`"video"` que já
   existem cobrem tudo; a única diferença é que `source_fact` chega preenchido com mais
   frequência (via nome do arquivo) antes desses componentes serem chamados.

## Erros / nunca falhar em silêncio

- Imagem sem `.json`, sem nome descritivo: mesmo comportamento já existente hoje —
  `copy_generation_error` explícito no post, visível no Kanban, sem retry custoso (o cron
  já pula posts de imagem sem `source_fact`, só que agora a condição de "sem contexto"
  inclui também "nome não descritivo").
- `extractContextFromFilename` é uma função pura sem I/O — não tem modo de falha (não
  lança exceção, na pior hipótese retorna `null`, que já é um valor válido tratado pelos
  chamadores).

## Teste

Manual (mesmo padrão de todos os milestones do projeto, sem framework de teste
automatizado no repo): usar os 2 arquivos reais já presentes na pasta de teste do Drive
(`Crie uma imagem de um cachorro em um gramado.png`, sem `.json`; e
`20251022_2126_New Video_simple_compose_01k877bc1mfm59en0zkzg7ph8g.mp4`, sem `.json`).
Rodar `drive-ingest`, confirmar que os dois viram posts `pendente`; rodar
`generate-copy` e confirmar: a imagem recebe `fato` derivado do nome (legenda sobre um
cachorro num gramado) sem erro; o vídeo cai na análise de frames+Whisper (comportamento
inalterado). Repetir o teste de nome descritivo/não-descritivo pro "Post rápido" no
painel com um upload de imagem sem digitar contexto.
