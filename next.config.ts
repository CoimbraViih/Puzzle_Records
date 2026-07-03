import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js"],
  outputFileTracingIncludes: {
    "/api/cron/generate-art": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/conteudo": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/aprovacao": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
  },
};

export default nextConfig;
