import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { defineConfig } from "vite";

// qBittorrent serves the built output itself, so production is always
// same-origin and needs no proxy at all.
//
// Development is the awkward case. qBittorrent rejects a request whose `Origin`
// is not its own with 401 (CSRF), and one whose `Host` does not match with 403
// (host header validation). Vite's dev server would send both from
// localhost:5173, so the proxy rewrites them to look like they came from
// qBittorrent itself. Verified against 5.2.3 -- without these two lines every
// call in dev fails.
const target = process.env.QBIT_TARGET ?? "http://debian:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": resolve(import.meta.dirname, "src") } },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target,
        changeOrigin: true,
        headers: { Origin: target, Referer: `${target}/` },
      },
    },
  },
  // Relative base: qBittorrent may serve the alternative UI from a subpath.
  base: "./",
  build: { outDir: "dist", sourcemap: false, target: "es2022" },
});
