# Agente de IA para Redes Sociais — Love Funk

**Versão:** 1.0 · **Data:** 02/07/2026 · **Responsável:** Victor

---

## 1. Visão

Agente de IA que automatiza a distribuição de conteúdo das contas principais da Love Funk (Instagram, TikTok, YouTube, Facebook). A equipe produz o conteúdo; o agente cuida de legendas, hashtags, agendamento e publicação, com aprovação humana antes de qualquer post ir ao ar.

**Fase 1 é uma ferramenta interna.** A Love Funk vira o laboratório e a prova social. Só depois de validado internamente o produto é aberto como SaaS para o mercado musical ("feito pela maior produtora do Brasil").

## 2. Decisões tomadas

| Decisão | Escolha |
|---|---|
| Público inicial | Interno — contas da Love Funk |
| Função do agente | Agendar e postar conteúdo pronto (legendas + hashtags + calendário) |
| Escala inicial | 2–5 contas principais (Love Funk Produtora, LoveTV, etc.) |
| Publicação | Agregador pago (Ayrshare ou Post Bridge) |
| Entrada de conteúdo | Pasta no Google Drive |
| Aprovação | Painel web com fila de posts (preview → aprovar/editar/rejeitar) |
| IA de legendas/hashtags | OpenAI (API da Platform — GPT-4o-mini no volume normal, GPT-4o em lançamentos) |
| Analytics | Dados via agregador + dashboard no painel (Fase 1); insights por IA (Fase 2) |
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
(tom de voz da Love Funk, adaptado por plataforma)
        │
        ▼
Post entra na fila do painel web como "pendente"
        │
        ▼
Aprovador revisa: aprova / edita / rejeita
        │
        ▼
Agregador (Ayrshare/Post Bridge) publica no horário agendado
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
- **Geração de legendas e hashtags:** API da OpenAI (Platform). GPT-4o-mini para posts de rotina (custo baixo), GPT-4o para lançamentos importantes. Prompt com o tom de voz da Love Funk + regras por plataforma (limite de caracteres, hashtags banidas/saturadas, emojis). Gera 2–3 variações por post para o aprovador escolher.
- **Analytics:** coleta periódica de métricas dos posts publicados via API do agregador (views, likes, comentários, alcance, por rede). Dashboard no painel com comparativo por conta, artista e horário. Na Fase 2, a IA analisa esses dados e gera insights acionáveis ("posts do artista X às 19h performam 40% acima da média").
- **Entrada:** API do Google Drive monitorando a pasta acordada (verificação a cada X minutos).
- **Publicação:** API do agregador. Um único endpoint publica em IG, TikTok, YouTube e Facebook.
- **Agendamento:** cron jobs (Vercel Cron ou Supabase Edge Functions).

## 5. Fases

**Fase 0 — Preparação (Victor, ~1 semana)**
Criar conta no agregador e conectar as 2–5 contas sociais; criar a pasta padrão no Google Drive; definir quem são os aprovadores; reunir 10–20 posts antigos de referência para calibrar o tom de voz da IA.

**Fase 1 — MVP (desenvolvimento, 2–3 semanas de trabalho)**
Painel com fila de aprovação; detecção de arquivos no Drive; geração de legenda/hashtag via OpenAI; publicação via agregador em 1 rede primeiro (Instagram), depois as demais; dashboard de analytics básico (métricas por post e por conta). Critério de sucesso: 2 semanas de operação real com ≥80% dos posts saindo pelo sistema.

**Fase 2 — Analytics inteligente e calendário**
IA (OpenAI) analisa o histórico de métricas e gera insights acionáveis; sugestão de melhores horários baseada em dados reais das contas; relatório semanal automático; feedback loop — o desempenho real realimenta o prompt de geração de legendas.

**Fase 3 — Escala interna**
Contas de artistas (10–30), permissões por artista, templates de lançamento (clipe novo → sequência de posts pré-definida).

**Fase 4 — SaaS**
Multi-tenant, cobrança, onboarding self-service, marca própria. Só entra em pauta com a Fase 1–3 comprovadas.

## 6. Custos mensais estimados (Fase 1)

| Item | Custo |
|---|---|
| Agregador (Ayrshare Premium ou Post Bridge) | US$ 30–150/mês conforme plano e nº de contas |
| API da OpenAI (legendas, hashtags e insights) | US$ 5–20/mês no volume inicial |
| Vercel + Supabase | R$ 0 (planos gratuitos) no início |
| **Total** | **~US$ 35–170/mês** |

## 7. Riscos e contrapontos

1. **Dependência do agregador.** Se ele mudar preço ou for descontinuado, a publicação para. Mitigação: arquitetura com camada de publicação isolada, trocável por APIs oficiais na Fase 3.
2. **Tokens e permissões das contas.** Contas sociais desconectam (troca de senha, política da Meta). O painel precisa alertar quando uma conexão cair — senão posts falham em silêncio.
3. **Moderação de conteúdo funk.** Instagram/TikTok aplicam shadowban e derrubam conteúdo com letras explícitas ou música sem licença reconhecida. Automação amplifica o problema: um erro replicado em 5 contas. A aprovação humana é a proteção — não remover na empolgação.
4. **Aprovação como gargalo.** Se o aprovador demora, o sistema vira fila morta. Definir SLA interno (ex.: aprovar em até 4h) e fallback (segundo aprovador).
5. **Direitos musicais.** Postar trechos de músicas em contas de terceiros (artistas) exige clareza contratual sobre quem autoriza o quê — problema da Fase 3, mas vale mapear já.
6. **O concorrente real é o hábito.** O maior risco do MVP não é técnico: é a equipe continuar postando direto pelo celular. Sem adoção interna, não há prova social para o SaaS. Recomendação: escolher UMA conta piloto e migrar 100% dela para o sistema.

## 8. O que só o Victor pode providenciar

1. Conta no agregador escolhido (Ayrshare ou Post Bridge) com as contas sociais conectadas.
2. Acesso/credenciais: chave da API do agregador, conta Google para o Drive, chave da API da OpenAI (platform.openai.com, com billing ativo).
3. Lista das 2–5 contas da Fase 1 e quem aprova os posts.
4. 10–20 legendas antigas que representam bem o tom Love Funk (para calibrar a IA).

---

*Próximo passo após a Fase 0: desenvolvimento do painel e do fluxo Drive → legenda → aprovação → publicação.*
