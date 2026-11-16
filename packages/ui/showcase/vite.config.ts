import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The component showcase: every @hhh/ui component with test data, used for the
// screenshots in docs/screenshots (npm run screenshots). Not shipped in the bundle.
export default defineConfig({
  root: dirname(fileURLToPath(import.meta.url)),
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
});
