// VersionInfo.tsx（UIのみ刷新・機能は完全据え置き）
import React from "react";

type Props = {
  version: string;
  onBack: () => void;
  onOpenContact: () => void;
};

// ── 見た目用ミニアイコン（ロジック非依存） ──
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);
const IconInfo = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1010 10A10 10 0 0012 2z" />
  </svg>
);
const IconHistory = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M13 3a9 9 0 109 9h-2a7 7 0 11-7-7V3l3 3-3 3V6a5 5 0 105 5h2A7 7 0 1113 5z"/>
  </svg>
);
const IconLegal = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M3 5h18v2H3V5zm2 4h14v10H5V9zm2 2v6h10v-6H7z"/>
  </svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
  </svg>
);

export default function VersionInfo({ version, onBack, onOpenContact }: Props) {
  const start = 2025;
  const y = new Date().getFullYear();
  const year = start === y ? `${y}` : `${start}–${y}`;

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full">
        {/* ヘッダー（フルブリード） */}
        <div className="w-[100svw] -mx-6 md:mx-0 md:w-full flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-white/90 active:scale-95 px-3 py-2 rounded-lg bg-white/10 border border-white/10"
          >
            <IconBack />
            <span className="text-sm">運用設定に戻る</span>
          </button>
          <div className="w-10" />
        </div>

        {/* タイトル */}
        <div className="mt-1 text-center select-none mb-2 w-full">
          <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-wide leading-tight">
            <IconInfo />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              バージョン情報
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
        </div>

        {/* Version & 更新履歴（フルブリードカード） */}
        <section
          className="w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4"
        >
          <div className="text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-sm">
              <IconInfo />
              <span className="font-semibold">Version {version}</span>
            </span>
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
                <IconHistory />
              </span>
              <h2 className="text-lg font-bold">更新履歴</h2>
            </div>
            <ul className="mt-2 text-base leading-7 list-disc ml-6">
              <li>2025.09.01　Vesion 0.10 β版 Release</li>
              <li>2026.01.07　Vesion 0.20 β版 追加仕様</li>
            </ul>
          </div>
        </section>

        {/* 法的情報（フルブリードカード） */}
        <section
          className="mt-4 w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4"
        >
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
              <IconLegal />
            </span>
            <h2 className="text-lg font-bold">法的情報 / Legal</h2>
          </div>

          {/* アプリ情報 */}
          <div>
            <p><span className="font-medium">アプリ名：</span>Easyアナウンス</p>
          </div>

          {/* 著作権 */}
          <div>
            <h3 className="font-semibold mb-1">著作権</h3>
            <p>© {year} M.OKUMURA. All rights reserved.</p>
            <p className="mt-2">
              本アプリおよび付随するコンテンツは著作権法等により保護されています。無断複製・転載・再配布を禁じます。
            </p>
          </div>

          {/* 第三者サービス（Google TTS, VOICEVOX） */}
          <div className="border rounded-lg p-4 bg-white/5">
            <h3 className="font-semibold mb-1">第三者サービス</h3>

            {/* Google TTS */}
            <p className="font-medium">Google Cloud Text-to-Speech API</p>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              <li>本アプリは音声合成に Google Cloud Text-to-Speech API を使用しています。</li>
              <li>当該APIの利用は、Google の提供する規約・ポリシー・ブランドガイドラインに従います。</li>
              <li>生成音声の取扱いはプライバシーポリシー／利用規約をご参照ください。</li>
            </ul>

          </div>


          {/* 商標 */}
          <div>
            <h3 className="font-semibold mb-1">商標</h3>
            <p>
              Google、Google Cloud は Google LLC の商標です。その他記載の会社名・製品名は各社の商標または登録商標です。
              本アプリは Google により後援・承認・提携されたものではありません。
            </p>
          </div>
        </section>

      </div>
    </div>
  );
}
