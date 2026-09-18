import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// `pnpm dev` runs the frontend on 5173 and proxies /api to the server, so the
// session cookie is same-origin in development exactly as it is in production.
//
// `@wire` points straight at the server's type file. It is imported with
// `import type`, and `verbatimModuleSyntax` is on, so nothing from it survives
// into the bundle -- this is a compile-time link, not a runtime dependency.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(import.meta.dirname, "src"),
      "@wire": resolve(import.meta.dirname, "../server/src/wire.ts"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: process.env.API_TARGET ?? "http://localhost:8080",
        changeOrigin: false,
      },
    },
  },
  build: { outDir: "dist", sourcemap: false },
});
