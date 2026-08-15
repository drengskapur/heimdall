// Plain Vite + React SPA build — no vinext, no RSC, no Cloudflare. The K8s/Helm
// backend is the standalone Node API server (server/api-server.mjs); in dev,
// /api/* (including the /api/kube-stream WebSocket) is proxied to it.

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Where Vite proxies /api. It has to agree with the port scripts/dev-spa.mjs
// starts the API server on, which is why both read the environment.
const API_TARGET = process.env.HEIMDALL_API_TARGET || "http://127.0.0.1:3011";

export default defineConfig({
  plugins: [react()],
  server: {
    port: Number(process.env.HEIMDALL_SPA_PORT || 5199),
    proxy: {
      "/api": { target: API_TARGET, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: "dist",
    chunkSizeWarningLimit: 4096,
  },
  // The app's runtime style-injection and history router need no special config.
});
