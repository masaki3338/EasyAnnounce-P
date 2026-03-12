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
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        clientsClaim: true,
        skipWaiting: true,
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
        'EasyAnnounce-icon-192x192-v2.png',
        'EasyAnnounce-icon-512x512-v2.png',
        'EasyAnnounce-icon-512-maskable-v2.png',
      ],
      manifest: {
        name: '野球アナウンス支援 Easyアナウンス',
        short_name: 'Easyアナウンス',
        description: '野球の試合アナウンスを簡単に行えるアプリ',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#ffffff',
        theme_color: '#d32f2f',
        icons: [
          {
            src: '/EasyAnnounce-icon-192x192-v2.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/EasyAnnounce-icon-512x512-v2.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: '/EasyAnnounce-icon-512-maskable-v2.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      }
    }),
  ],
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['@react-pdf-viewer/core/lib/styles/index.css'],
  },
});