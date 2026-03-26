// VersionInfo.tsx（UIのみ刷新・機能は完全据え置き）
import React, { useState } from "react";

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

type HistoryItem = {
  date: string;
  version: string;
  details: string[];
};

const historyData: HistoryItem[] = [
  {
    date: "2026.03.05",
    version: "Vesion 1.00 β",
    details: ["Release"],
  },
  {
    date: "2026.03.10",
    version: "Vesion 2.00 β",
    details: ["Boysリーグモード追加"],
  },
  {
    date: "2026.03.17",
    version: "Vesion 2.01 β",
    details: ["リエントリー時の不具合修正 他"],
  },
  {
    date: "2026.03.23",
    version: "Vesion 2.02 β",
    details: ["投球数の不具合修正 他"],
  },
  {
    date: "2026.03.26",
    version: "Vesion 2.03 β",
    details: ["選手交代の不具合修正 他"],
  },
];

export default function VersionInfo({ version, onBack }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(0); // 最新を最初から開く

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
        {/* ヘッダー */}
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

        {/* Version & 更新履歴 */}
        <section className="w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4">

          <div className="text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-sm">
              <IconInfo />
              <span className="font-semibold">Version {version}</span>
            </span>
          </div>

          {/* 更新履歴アコーディオン */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
                <IconHistory />
              </span>
              <h2 className="text-lg font-bold">更新履歴</h2>
            </div>

            <ul className="space-y-3">
              {historyData.map((item, index) => (
                <li key={index} className="rounded-xl bg-white/5 border border-white/10">
                  <button
                    onClick={() =>
                      setOpenIndex(openIndex === index ? null : index)
                    }
                    className="w-full text-left px-4 py-3 flex justify-between items-center active:scale-[0.99]"
                  >
                    <span className="font-medium text-base">
                      {item.date}　{item.version}
                    </span>
                    <span className="text-sm">
                      {openIndex === index ? "▲" : "▼"}
                    </span>
                  </button>

                  {openIndex === index && (
                    <div className="px-6 pb-4 text-sm text-gray-300">
                      <ul className="list-disc ml-4 space-y-1">
                        {item.details.map((d, i) => (
                          <li key={i}>{d}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 法的情報 */}
        <section className="mt-4 w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4">

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
              <IconLegal />
            </span>
            <h2 className="text-lg font-bold">法的情報 / Legal</h2>
          </div>

          <p><span className="font-medium">アプリ名：</span>野球アナウンス支援 Easyアナウンス</p>

          <div>
            <h3 className="font-semibold mb-1">著作権</h3>
            <p>© {year} M.OKUMURA. All rights reserved.</p>
            <p className="mt-2">
              本アプリおよび付随するコンテンツは著作権法等により保護されています。無断複製・転載・再配布を禁じます。
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-1">免責事項</h3>
            <p>
              本アプリは野球試合のアナウンスを支援する目的で提供されています。
              本アプリの利用または利用できなかったことにより生じたいかなる損害・トラブルについても、
              開発者は一切の責任を負いません。
            </p>
            <p className="mt-2">
              ご利用にあたっては、利用者ご自身の責任においてご使用ください。
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-1">商標</h3>
            <p>
              Google、Google Cloud は Google LLC の商標です。
              その他記載の会社名・製品名は各社の商標または登録商標です。
            </p>
          </div>

        </section>
      </div>
    </div>
  );
}