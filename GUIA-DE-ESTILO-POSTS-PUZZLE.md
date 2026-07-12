# Guia de Estilo de Postagem — Puzzle Records

**Base:** análise do @lovefunkprodutora (mesmo dono, 4,6M seguidores) em 02/07/2026. Este guia alimenta os templates de arte e os prompts da OpenAI no agente.

## 1. Posicionamento do perfil

O perfil opera como **veículo de mídia** ("Notícias do FUNK e MUNDO"), não como vitrine institucional. Notícia viral geral traz alcance; conteúdo da label converte a audiência para os artistas.

## 2. Mix editorial observado

| Tipo | Proporção aproximada | Exemplos reais |
|---|---|---|
| Viral geral (futebol, celebridades, memes do momento) | dominante (~60–70%) | "TA COM MEDO?🤔 Haaland fala sobre enfrentar o Brasil...", "A torcida do Brasil, depois de eliminar a Noruega 🇳🇴🤣" |
| Notícias do funk / celebridades do nicho | intermediário | "GRAVE!🚨 Pamela Sara denuncia agressão do Menino GS." |
| Label: lançamentos, prévias, montagens de artistas | minoritário (~20–30%) | "A ESPERA ACABOU!🔥 MC Staylon solta a prévia do 'Samba consciente Vol.2'", "APÓS GRANDE ESPERA, O HIT 'IMPÉRIO' DO MC STAYLON É LANÇADO" |

## 3. Templates de arte

### Template A — Faixa branca (estilo "Choquei")
- Faixa branca no topo (ocupa de 25% a 45% da arte conforme o tamanho da manchete)
- Manchete em **caixa normal**, fonte preta sem serifa, negrito moderado
- Emojis no fim das frases (🔥🚨🤔🤣 + bandeiras)
- Citações entre aspas dentro da manchete quando há fala de alguém
- Mídia abaixo (foto, montagem lado a lado ou vídeo vertical)
- **Logo redonda da marca sobreposta** na divisa entre faixa e mídia
- Usado para: notícias virais, anúncios com contexto

### Template B — Manchete sobre a imagem
- Foto full-bleed; texto branco em **CAIXA ALTA**, fonte condensada/stencil com contorno/sombra, posicionado no terço inferior
- Rodapé pequeno: "SIGA @puzzlerecordss PARA VER MAIS"
- Logo redonda no canto
- Usado para: fatos de impacto, lançamentos, montagens de artistas

## 4. Fórmulas de manchete (para o prompt da OpenAI)

1. **Gancho-pergunta:** "TA COM MEDO?🤔 [fato]"
2. **Urgência/expectativa:** "A ESPERA ACABOU!🔥 [lançamento]", "GRAVE!🚨 [fato]"
3. **Recorde/marco:** "APÓS GRANDE ESPERA, O HIT [nome] É LANÇADO", "[música] BATE [X] PLAYS"
4. **Reação/humor:** "A torcida do Brasil, depois de [evento] 🤣", "Por que será que [situação]?😅"
5. **Citação:** manchete + fala entre aspas: "...admite: 'Temos poucas chances, parece até brincadeira'.🔥"

## 5. Padrões de legenda (sem hashtags!)

### Post viral — estrutura em 3 blocos
```
TREMEU NA BASE, HAALAND?🇳🇴🤔          ← gancho em CAPS + emojis

Haaland, craque da Noruega, abriu o jogo [...] 
e declarou que as chances deles são pequenas.
O QUE ACHARAM?                          ← lide curto + pergunta de engajamento

ESQUECE, AQUI É O BRASILLL RAPAZ!🇧🇷    ← fecho opinativo/torcida em CAPS
```

### Post de lançamento — curto e direto
```
O Talento do Staylon é surreal! 🔥
```
Sem @mention/música obrigatórios (não há mais cadastro de artista — conta
única `@puzzlerecordss`, ver `docs/CLAUDE.md`). Se o post menciona um
artista de terceiros que a equipe/IA conhece, citar o nome/@ dele no texto
é uma escolha editorial pontual, não um campo estruturado do sistema.

## 6. Tom de voz

- Informal, torcedor, hype; fala com o público como um amigo que traz a fofoca/notícia
- Emojis funcionais: 🔥 (hype), 🚨 (urgência), 🤔 (provocação), 🤣 (humor), bandeiras (contexto)
- Perguntas de engajamento geram threads de comentários (comentário top do post analisado: 226 curtidas, 35 respostas)
- Perfeição gramatical NÃO é requisito do estilo — tom de conversa vale mais que texto polido
- Artistas da label comentam nos posts (rede interna de engajamento — orientar os artistas da Puzzle a fazer o mesmo)

## 7. Regras para o agente (resumo executável)

1. Todo post gerado escolhe: Template A ou B + fórmula de manchete + padrão de legenda conforme o tipo (viral × lançamento).
2. Legendas sem hashtags; @mention/música em lançamentos são editoriais e
   pontuais, não obrigatórios (sem cadastro de artista, ver docs/CLAUDE.md).
3. Manchete carrega a informação; legenda carrega o engajamento.
4. Emojis obrigatórios, mas 2–4 por bloco, não em cada palavra.
5. Posts virais terminam com pergunta OU opinião de torcida — nunca neutros.
