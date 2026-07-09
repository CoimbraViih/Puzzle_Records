-- M12: auditoria do adapter do Zernio contra a documentação real da API
-- (docs.zernio.com). A resposta real de POST /v1/posts retorna um `id`
-- interno do Zernio, separado do link público da rede social (post_url) --
-- e é esse `id` que a API de analytics (GET /v1/analytics?postId=...) exige
-- para buscar métricas depois. A implementação anterior (stub especulativo
-- do M7) nunca soube disso, porque não havia documentação real disponível
-- na época -- só guardava post_url. Sem essa coluna, collect-metrics (M9)
-- não teria como funcionar contra a API real.
alter table public.posts
  add column zernio_post_id text;
