# Agente de IA para Redes Sociais — Puzzle Records

**Versão:** 2.0 · **Data:** 02/07/2026 · **Responsável:** Victor

---

## 1. Visão

Agente de IA que automatiza a distribuição de conteúdo das contas principais da Puzzle Records (Instagram, TikTok, YouTube, Facebook). A equipe produz o conteúdo; o agente cuida de legendas, hashtags, agendamento e publicação, com aprovação humana antes de qualquer post ir ao ar.

**Fase 1 é uma ferramenta interna.** A Puzzle Records vira o laboratório e a prova social. Só depois de validado internamente o produto é aberto como SaaS para o mercado musical ("construído dentro de uma produtora real").

### 1.1 Briefing do cliente (áudio de 02/07/2026)

Objetivo central: **crescer o perfil @puzzlerecordss no Instagram**, que concentra os artistas da gravadora. Máxima automação. Três frentes de conteúdo:

1. **Posts "news card"** — artes estilo portal de notícias (fundo branco, manchete + foto do artista): lançamentos, recordes, marcos ("MC Fulano lança single", "música X bate Y plays"). Geração 100% automática.
2. **Volume do acervo** — a gravadora tem grande biblioteca de conteúdo; publicar 2–3 vídeos/dia para manter o perfil ativo.
3. **Conteúdo estratégico** (visão do Victor) — vídeos pensados para viralizar e ampliar o alcance das músicas, além do básico de "só postar".

**Alinhamento de expectativa com o cliente:** volume mantém o perfil vivo, mas crescimento vem de conteúdo estratégico. Automação garante consistência; não garante viralização. A IA apoia a estratégia (análise de performance, sugestão de ganchos) — a criação criativa continua humana.

### 1.2 Modelo de conteúdo — referência @lovefunkprodutora (analisado em 02/07/2026)

Perfil de referência: 4,6M seguidores, 18 mil posts, bio "Notícias do FUNK e MUNDO". O perfil opera como **veículo de mídia**, não como perfil institucional:

- **Mix editorial:** maioria dos posts é notícia viral geral (futebol/Copa, celebridades, memes do momento) e a minoria é conteúdo da label (lançamentos, prévias, montagens com artistas). O viral traz alcance e seguidores; os lançamentos convertem essa audiência para os artistas.
- **Template A — faixa branca:** barra branca no topo, manchete em caixa normal com emojis ("A ESPERA ACABOU!🔥 MC Staylon solta a prévia..."), mídia abaixo, logo redonda da marca sobreposta.
- **Template B — manchete sobre imagem:** texto branco em caixa alta sobre a foto + rodapé "SIGA @perfil PARA VER MAIS".
- **Legendas:** curtas, de hype ("O Talento do Staylon é surreal! 🔥"), com @mention do artista e música taggeada. **Praticamente sem hashtags** — a manchete da arte carrega a informação.
- **Engajamento:** os próprios artistas comentam nos posts (rede interna de engajamento).

**Implicações para o sistema:** o gerador de artes precisa dos 2 templates; a OpenAI gera manchete + legenda curta + mention (não listas de hashtags); e o fluxo precisa de uma frente de **pauta viral** — parcialmente automatizável (monitorar trending topics), mas com curadoria humana na seleção.

## 2. Decisões tomadas

| Decisão | Escolha |
|---|---|
| Público inicial | Interno — contas da Puzzle Records |
| Função do agente | Agendar e postar conteúdo pronto (legendas + hashtags + calendário) |
| Escala inicial | 2–5 contas principais |
| Publicação | **Zernio** (grátis até 2 contas; depois ~US$1–6/conta/mês) |
| Entrada de conteúdo | Pasta no Google Drive |
| Aprovação | Painel web com fila de posts (preview → aprovar/editar/rejeitar) |
| IA de legendas/hashtags | OpenAI (API da Platform — GPT-4o-mini no volume normal, GPT-4o em lançamentos) |
| Analytics | Dados via agregador + dashboard no painel (Fase 1); insights por IA (Fase 2) |
| Volume alvo | 2–3 posts/dia (acervo + news cards + lançamentos) |
| Artes automáticas | Gerador de "news cards" (template HTML → imagem) |
| Desenvolvimento | Claude (Cowork) |

## 3. Fluxo do sistema

```
Equipe solta vídeo/arte na pasta do Google Drive
        │
        ▼
Agente detecta o arquivo novo + lê metadados
(nome do artista, música, data — via nome do arquivo ou arquivo .txt junto)
        │
        ▼
OpenAI gera legenda, hashtags e sugestão de horário por rede
(tom de voz da Puzzle Records, adaptado por plataforma)
        │
        ▼
Post entra na fila do painel web como "pendente"
        │
        ▼
Aprovador revisa: aprova / edita / rejeita
        │
        ▼
Zernio publica no horário agendado
        │
        ▼
Painel registra status + link do post publicado
        │
        ▼
Analytics: agente coleta views/likes/alcance via agregador
e exibe no dashboard do painel
```

## 4. Arquitetura técnica

- **Painel web:** Next.js hospedado na Vercel (plano gratuito no início). Login simples para a equipe, fila de aprovação, calendário de posts, histórico.
- **Banco de dados e autenticação:** Supabase (plano gratuito no início).
- **Geração de legendas e hashtags:** API da OpenAI (Platform). GPT-4o-mini para posts de rotina (custo baixo), GPT-4o para lançamentos importantes. Prompt com o tom de voz da Puzzle Records + regras por plataforma (limite de caracteres, hashtags banidas/saturadas, emojis). Gera 2–3 variações por post para o aprovador escolher.
- **Analytics:** coleta periódica de métricas dos posts publicados via API do agregador (views, likes, comentários, alcance, por rede). Dashboard no painel com comparativo por conta, artista e horário. Na Fase 2, a IA analisa esses dados e gera insights acionáveis.
- **Gerador de news cards:** templates HTML/CSS com a identidade da Puzzle Records nos 2 formatos de referência (faixa branca e manchete sobre imagem), renderizados em imagem (Puppeteer/Satori). A OpenAI escreve a manchete no tom do modelo (+ legenda curta de hype com @mention); a equipe só fornece a foto/vídeo e o fato. Sai pronto para a fila de aprovação.
- **Fila do acervo:** banco de conteúdos já produzidos com agendamento distribuído (2–3/dia), evitando repetição próxima e priorizando horários de maior alcance.
- **Entrada:** API do Google Drive monitorando a pasta acordada (verificação a cada X minutos).
- **Publicação:** API do Zernio. Camada de publicação isolada no código — trocar de agregador (plano B: Post Bridge, Postiz) é ajuste de horas, não redesenho.
- **Agendamento:** cron jobs (Vercel Cron ou Supabase Edge Functions).

### Conexão com a Meta (via Zernio)
O Zernio detém o app aprovado pela Meta. A conexão de cada conta é um OAuth único feito pela interface dele; tokens são armazenados e renovados por ele. Requisito inegociável da Meta: contas de Instagram **profissionais (Business)** vinculadas a uma **Página do Facebook**. Integração própria com a Graph API só na Fase 3, se o volume justificar.

## 5. Fases

**Fase 0 — Preparação (Victor, ~1 semana)**
Criar conta no Zernio e conectar as 2 primeiras contas sociais (grátis); criar a pasta padrão no Google Drive; definir quem são os aprovadores; reunir 10–20 posts antigos de referência para calibrar o tom de voz da IA.

**Fase 1 — MVP (desenvolvimento, 2–4 semanas de trabalho)**
Painel com fila de aprovação; detecção de arquivos no Drive; geração de legenda/hashtag via OpenAI; **gerador de news cards** (template Puzzle Records); fila do acervo com 2–3 posts/dia; publicação via Zernio no Instagram primeiro, depois as demais redes; dashboard de analytics básico. Critério de sucesso: 2 semanas de operação real com ≥80% dos posts saindo pelo sistema.

**Fase 2 — Analytics inteligente e estratégia de crescimento**
IA (OpenAI) analisa o histórico de métricas e gera insights acionáveis; identificação de padrões dos posts que mais performaram e sugestão de ganchos/formatos para os conteúdos estratégicos; sugestão de melhores horários baseada em dados reais; relatório semanal automático; feedback loop — o desempenho real realimenta o prompt de geração de legendas e manchetes. Candidato ao backlog: briefing por áudio de WhatsApp (transcrição via Whisper API → post).

**Fase 3 — Escala interna**
Contas de artistas (10–30), permissões por artista, templates de lançamento (clipe novo → sequência de posts pré-definida). Reavaliar Zernio vs APIs oficiais próprias no volume atingido.

**Fase 4 — SaaS**
Multi-tenant, cobrança, onboarding self-service, marca própria. Só entra em pauta com a Fase 1–3 comprovadas.

## 6. Custos mensais estimados (Fase 1)

| Item | Custo |
|---|---|
| Zernio | US$ 0 (até 2 contas); ~US$ 1–6/conta adicional |
| API da OpenAI (legendas, hashtags e insights) | US$ 5–20/mês no volume inicial |
| Vercel + Supabase | R$ 0 (planos gratuitos) no início |
| **Total** | **~US$ 5–20/mês no piloto** |

## 7. Riscos e contrapontos

1. **Zernio é empresa nova.** Risco de continuidade acima da média. Mitigação: camada de publicação isolada + plano B documentado (Post Bridge ~US$13/mês, Postiz US$29/mês); com 2–5 contas, migrar leva um dia.
2. **Tokens e permissões das contas.** Contas sociais desconectam (troca de senha, política da Meta). O painel precisa alertar quando uma conexão cair — senão posts falham em silêncio.
3. **Moderação de conteúdo musical.** Instagram/TikTok aplicam shadowban e derrubam conteúdo com letras explícitas ou música sem licença reconhecida. Automação amplifica o problema. A aprovação humana é a proteção — não remover na empolgação.
4. **Aprovação como gargalo.** Se o aprovador demora, o sistema vira fila morta. Definir SLA interno (ex.: aprovar em até 4h) e fallback (segundo aprovador).
5. **Direitos de imagem no conteúdo viral.** O modelo de referência usa fotos de jogadores, celebridades e trechos de TV — prática comum em perfis de mídia BR, mas juridicamente cinzenta (direito de imagem, copyright de emissoras). Automatizar isso amplia a exposição. Definir com o cliente o apetite de risco e priorizar mídia própria/licenciada quando possível.
6. **Direitos musicais.** Postar trechos de músicas em contas de terceiros (artistas) exige clareza contratual — problema da Fase 3, mas vale mapear já.
7. **Expectativa do cliente: volume ≠ crescimento.** O algoritmo do Instagram pune despejo de conteúdo; 2–3 posts/dia só sustentam se a qualidade acompanhar. Alinhar por escrito com o cliente que a automação entrega consistência e liberação de tempo — crescimento depende dos conteúdos estratégicos e será medido no dashboard. Sem esse alinhamento, em 60 dias vem a cobrança "postou todo dia e não cresceu".
8. **O concorrente real é o hábito.** O maior risco do MVP não é técnico: é a equipe continuar postando direto pelo celular. Sem adoção interna, não há prova social para o SaaS. Recomendação: escolher UMA conta piloto e migrar 100% dela para o sistema.

## 8. O que só o Victor pode providenciar

1. Conta no Zernio com as 2 primeiras contas sociais conectadas (grátis).
2. Acesso/credenciais: chave da API do Zernio, conta Google para o Drive, chave da API da OpenAI (platform.openai.com, com billing ativo).
3. Lista das 2–5 contas da Fase 1 e quem aprova os posts.
4. 10–20 legendas antigas que representam bem o tom da Puzzle Records (para calibrar a IA).

---

*Próximo passo após a Fase 0: desenvolvimento do painel e do fluxo Drive → legenda → aprovação → publicação.*
