// vite.config.ts
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';

function ortRuntimeAssets(): Plugin {
  const ortDist = path.resolve(
    process.cwd(),
    'node_modules/onnxruntime-web/dist'
  );

  const wanted = new Set([
    'ort-wasm-simd-threaded.mjs',
    'ort-wasm-simd-threaded.wasm',
  ]);

  return {
    name: 'easyannounce-ort-runtime-assets',

    // npm run dev:
    // http://localhost:5173/ort/... を node_modules から返す
    configureServer(server) {
      server.middlewares.use('/ort/', (req, res, next) => {
        try {
          const pathname = decodeURIComponent(
            (req.url || '').split('?')[0]
          );
          const name = path.basename(pathname);

          if (!wanted.has(name)) {
            return next();
          }

          const filePath = path.join(ortDist, name);

          if (!fs.existsSync(filePath)) {
            res.statusCode = 404;
            res.end(`ORT runtime not found: ${name}`);
            return;
          }

          res.statusCode = 200;
          res.setHeader(
            'Content-Type',
            name.endsWith('.wasm')
              ? 'application/wasm'
              : 'text/javascript; charset=utf-8'
          );
          res.setHeader('Cache-Control', 'no-cache');

          fs.createReadStream(filePath).pipe(res);
        } catch (error) {
          next(error as Error);
        }
      });
    },

    // npm run build / Vercel:
    // dist/ort/ に同じ2ファイルをコピーする
    closeBundle() {
      const outDir = path.resolve(
        process.cwd(),
        'dist/ort'
      );

      fs.mkdirSync(outDir, {
        recursive: true,
      });

      for (const name of wanted) {
        const source = path.join(ortDist, name);
        const destination = path.join(outDir, name);

        if (!fs.existsSync(source)) {
          throw new Error(
            `必要なORTファイルが見つかりません: ${source}`
          );
        }

        fs.copyFileSync(source, destination);
      }

      console.log(
        '[ORT] copied 2 runtime files to dist/ort'
      );
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    ortRuntimeAssets(),

    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: 'auto',

      workbox: {
        // ORTの巨大WASM/MJSはprecacheしない。
        // /ort/ から通常のHTTP取得にする。
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webp,woff2,mp3,pdf}',
        ],
        globIgnores: [
          'ort/**',
        ],
        maximumFileSizeToCacheInBytes:
          10 * 1024 * 1024,
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
      ],

      manifest: {
        name: 'Easyアナウンス PONY',
        short_name: 'Easyアナウンス',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#d32f2f',
        icons: [
          {
            src: 'EasyAnnounce-Pony-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'EasyAnnounce-Pony-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
    }),
  ],

  resolve: {
    dedupe: [
      'react',
      'react-dom',
      'onnxruntime-web',
    ],
  },

  optimizeDeps: {
    // piper-plusは最適化しない。
    // ORTのWASMエントリもViteの .vite/deps に閉じ込めない。
    exclude: [
      'piper-plus',
      'onnxruntime-web',
      'onnxruntime-web/wasm',
    ],
  },
});
