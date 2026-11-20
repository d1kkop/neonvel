import { defineConfig } from 'vite';

// Opened through a tunnel (phone test over https): the game finds its server at the same address, so the dev
// servers pass the game-server paths on to the local game server (port 8787).
const toGameServer = Object.fromEntries(['/ws', '/room', '/auth', '/store', '/stripe', '/laptimes', '/leaderboard'].map((p) => [p, { target: 'http://localhost:8787', ws: p === '/ws' || p === '/room', changeOrigin: true }]));

export default defineConfig({
  preview: { allowedHosts: ['.trycloudflare.com'], proxy: toGameServer },
  server: {
    port: 5173,
    allowedHosts: ['.trycloudflare.com'],
    proxy: toGameServer,
    // Test artefacts (screenshots, headless browser profiles) live in .tmp — don't watch them.
    watch: { ignored: ['**/.tmp/**', '**/server/*.db*'] },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});
