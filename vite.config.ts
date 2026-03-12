// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,webp,woff2,mp3,pdf}'],
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10MB
        clientsClaim: true,
        skipWaiting: true,
        // ※ VOICEVOX廃止のため、/api の特例（navigateFallbackDenylist / runtimeCaching）は不要
      },
      includeAssets: [
        'favicon.svg',
        'robots.txt',
        'field.png',
        'EasyAnnounceLOGO.png',
        'mic-red.png',
        'Defence.png',
        'Ofence.png',
        'Runner.png',
        'warning-icon.png',
        'manual.pdf',
        'Boysmanual.pdf',
      ],
      manifest: {
        name: '野球アナウンス支援 Easyアナウンス',
        short_name: 'Easyアナウンス',
        description: '野球の試合アナウンスを簡単に行えるアプリ',
        start_url: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#d32f2f',
        icons: [
          {
            src: 'EasyAnnounce-icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'EasyAnnounce-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      }
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  // ※ /api を使わないので開発プロキシも削除
  // server: { proxy: { ... } },

  optimizeDeps: {
    include: ['@react-pdf-viewer/core/lib/styles/index.css'],
  },
});
