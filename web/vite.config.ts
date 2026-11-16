import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

/** The local server (`npm run serve` or `npm run dev:fake`) that `npm run dev:web` talks to. */
const API_TARGET = 'http://127.0.0.1:4321';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // Served by the server at / (src/http/web.ts).
  base: '/',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    // The API, MCP and health live on the server: forward them. It accepts requests that change
    // something only from its own origin, so the proxy presents that origin.
    proxy: { '^/(api|mcp|health)(/|$)': { target: API_TARGET, changeOrigin: true, headers: { origin: API_TARGET } } },
  },
});
