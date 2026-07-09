import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/api/cron/generate-art": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/conteudo": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/aprovacao": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
  },
  experimental: {
    serverActions: {
      // Default do Next.js é 1MB — createPost/createAcervoPost fazem
      // upload de mídia (incl. vídeo de acervo) via Server Action; um
      // clipe curto de funk facilmente passa de 1MB. Achado testando
      // publicação de vídeo real no M12 (ver PLAN.md).
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
