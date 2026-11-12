import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from './package.json' with { type: 'json' };

// base './' : the app works from any address (GitHub Pages serves it from /<repo>/).
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 'prompt': a new version waits for a tap on "Update", so a half-typed form is never reloaded away.
      registerType: 'prompt',
      includeAssets: ['apple-touch-icon.png', 'favicon-32.png', 'brand/logo.jpg', 'brand/mark.png'],
      manifest: {
        id: './',
        name: "Vanny's Fresh Juice",
        short_name: "Vanny's",
        description: 'Fruit, juice making, the fridge, sales, orders, deliveries and profit for Vanny\'s Fresh Juice.',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff8ee',
        theme_color: '#fff8ee',
        icons: [
          { src: 'icon-192.png?v=1', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png?v=1', sizes: '512x512', type: 'image/png' },
          { src: 'icon-maskable-512.png?v=1', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,jpg,svg,ico,webmanifest}'],
        // the old look-and-feel prototype is not part of the app
        globIgnores: ['prototype/**'],
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/prototype\//],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: { target: 'es2022', sourcemap: false },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
});
