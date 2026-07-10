import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@resvg/resvg-js", "ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/cron/generate-art": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/conteudo": [
      "./lib/renderer/fonts/**",
      "./puzzle-records-logo.svg",
      "./node_modules/ffmpeg-static/**",
    ],
    "/aprovacao": ["./lib/renderer/fonts/**", "./puzzle-records-logo.svg"],
    "/api/cron/generate-copy": ["./node_modules/ffmpeg-static/**"],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default nextConfig;
