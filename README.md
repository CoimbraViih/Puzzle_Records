# Agente IA Puzzle Records

Painel web interno que automatiza o pipeline de postagem da Puzzle Records — da ingestão
de mídia no Google Drive até a publicação aprovada nas redes sociais. Contexto completo
do produto em [docs/CLAUDE.md](docs/CLAUDE.md) e milestones em [PLAN.md](PLAN.md).

## Rodando localmente

```bash
cp .env.example .env.local   # preencha com as chaves reais
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000). A página inicial mostra o status de
conexão com o Supabase.

## Deploy

Ver [docs/DEPLOY.md](docs/DEPLOY.md) para os passos de link com Vercel e Supabase.

## Stack

Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui + Supabase. Gerenciador de
pacotes: npm.
