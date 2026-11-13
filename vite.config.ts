import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    // Test artefacts (screenshots, headless browser profiles) live in .tmp — don't watch them.
    watch: { ignored: ['**/.tmp/**', '**/server/*.db*'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
