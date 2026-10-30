import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The React app lives in app/ and builds to dist/, which the Worker serves as static assets.
// `npm run dev:ui` proxies the API to a running `wrangler dev` on :8787 for hot reload.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
      '/v1': 'http://localhost:8787',
    },
  },
});
