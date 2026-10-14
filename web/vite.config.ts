import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Relative base ('./') lets the same build work on GitHub Pages project sites
// (https://<user>.github.io/<repo>/) and on a custom domain.
export default defineConfig({
  base: process.env.VITE_BASE ?? './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg'],
      manifest: {
        name: 'Szókincs-edző',
        short_name: 'Szókincs',
        description: 'Napi magyar szókincs- és szinonimagyakorlat',
        lang: 'hu',
        display: 'standalone',
        start_url: './',
        scope: './',
        background_color: '#0f1720',
        theme_color: '#0f766e',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg}'],
        runtimeCaching: [
          {
            // word banks are large: cache after first load so the game works offline
            urlPattern: /\/data\/.*\.json$/,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'word-data' },
          },
        ],
      },
    }),
  ],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
