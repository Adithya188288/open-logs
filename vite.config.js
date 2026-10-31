import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// The React app lives in app/ and builds to dist/, which the Worker serves as static assets.
export default defineConfig({
  root: 'app',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true },
});
