import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// In development the API runs on :8000 and is proxied so that the SPA and API share an
// origin (session cookies are SameSite=Strict and scoped to /api).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8000", changeOrigin: false },
    },
  },
  build: { sourcemap: false, chunkSizeWarningLimit: 900 },
  test: { environment: "jsdom", globals: true },
});
