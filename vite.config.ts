// vite.config.ts
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

// 固定音声は内容が変わったファイルだけURLを変更する。
// 公開前のビルド時のみ計算するため、更新確認時の通信量は増えない。
function readAudioRevisions(): Record<string, string> {
  const revisions: Record<string, string> = {};
  const audioRoot = path.resolve(process.cwd(), 'public/audio');
  const visit = (directory: string) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && /\.mp3$/i.test(entry.name)) {
        const key = 'audio/' + path.relative(audioRoot, file).split(path.sep).join('/');
        revisions[key] = createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 20);
      }
    }
  };
  visit(audioRoot);
  return revisions;
}
const audioRevisions = readAudioRevisions();

// ビルドごとにIDを生成。公開ファイル全体を同じリリースとして扱う。
function appUpdateInfo(): Plugin {
  const buildId = randomUUID();
  const info = JSON.stringify({ buildId, builtAt: new Date().toISOString() });
  return {
    name: 'easyannounce-update-info',
    config() {
      return { define: {
        'import.meta.env.VITE_APP_BUILD_ID': JSON.stringify(buildId),
        'import.meta.env.VITE_FIXED_AUDIO_REVISIONS': JSON.stringify(JSON.stringify(audioRevisions)),
      } };
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if ((req.url || '').split('?')[0].endsWith('/app-update.json')) {
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.end(info);
          return;
        }
        next();
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'app-update.json', source: info });
    },
  };
}

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
    appUpdateInfo(),
    ortRuntimeAssets(),

    VitePWA({
      registerType: 'prompt',
      injectRegister: false,

      workbox: {
        // ORTの巨大WASM/MJSはprecacheしない。
        // /ort/ から通常のHTTP取得にする。
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,webp,woff2,mp3,pdf}',
        ],
        globIgnores: [
          'ort/**',
          'app-update.json',
        ],
        maximumFileSizeToCacheInBytes:
          10 * 1024 * 1024,
        // 更新情報は必ずネットワークから取得。オフラインの古いIDを返さない。
        // オフライン用の事前保存も、tts.tsと同じ音声URLに揃える。
        manifestTransforms: [async (entries) => ({
          manifest: entries.map((entry) => {
            const revision = audioRevisions[entry.url.replace(/^\//, '')];
            return revision
              ? { ...entry, url: `${entry.url}?audio_rev=${revision}`, revision: null }
              : entry;
          }),
          warnings: [],
        })],
        runtimeCaching: [
          {
            urlPattern: /\/app-update\.json(?:\?|$)/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /[?&]__easy_updated=/,
            handler: 'NetworkOnly',
          },
          {
            urlPattern: /\/audio\/.*\.mp3\?audio_rev=/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'easyannounce-fixed-audio-v1',
              cacheableResponse: { statuses: [200] },
              rangeRequests: true,
            },
          },
        ],
        navigateFallbackDenylist: [/[?&]__easy_updated=/],
        clientsClaim: false,
        // 旧版に適用ボタンがなくても更新がwaitingで止まらないようにする。
        // SWの更新準備と画面の再読み込みは別。main.tsxは自動reloadしない。
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
