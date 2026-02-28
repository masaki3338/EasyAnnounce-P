// OperationSettings.tsx（全文置き換え）

import type { ScreenType } from "../App";
import React from "react";

type Props = {
  onNavigate: (s: ScreenType) => void;
  onOpenManual?: () => void; // App側のマニュアル表示モーダルを開く
};

// ミニアイコン（依存なしのSVG）
const IconChevronLeft: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" className={className ?? "w-5 h-5"} fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);

// 共通カードボタン
const TileButton: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
}> = ({ icon, title, desc, onClick }) => (
  <button
    onClick={onClick}
    className="w-full rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition flex items-center gap-4"
  >
    <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/10 border border-white/10 shrink-0">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="font-semibold leading-tight">{title}</div>
      {desc && <div className="text-xs opacity-80 mt-0.5 truncate">{desc}</div>}
    </div>
  </button>
);

export default function OperationSettings({ onNavigate, onOpenManual }: Props) {
  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
{/* モバイルヘッダー（置き換え） */}
<header className="w-full max-w-2xl">

  {/* 下段：タイトルを大きく中央に */}
  <div className="mt-3 text-center select-none">
    <h1 className="
      inline-flex items-center gap-2
      text-3xl md:text-4xl font-extrabold tracking-wide leading-tight
    ">
      <span className="text-2xl md:text-3xl">⚙️</span>
      <span className="
        bg-clip-text text-transparent
        bg-gradient-to-r from-white via-blue-100 to-blue-400
        drop-shadow
      ">
        運用設定
      </span>
    </h1>
    {/* デコレーションライン（任意）：細いグラデ棒で締める */}
    <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
  </div>
</header>


      {/* 中央配置の本体 */}
      <div className="flex-1 w-full max-w-2xl flex flex-col justify-center gap-4">
        <TileButton
          icon={<span className="text-2xl">⚾️</span>}
          title="規定投球数"
          desc="学年別・大会別の上限"
          onClick={() => onNavigate("pitchLimit")}
        />

        <TileButton
          icon={<span className="text-2xl">🔀</span>}
          title="タイブレークルール"
          desc="開始回・無死満塁など"
          onClick={() => onNavigate("tiebreakRule")}
        />

        <TileButton
          icon={<span className="text-2xl">📘</span>}
          title="連盟アナウンスマニュアル"
          desc="PDFをアプリ内で表示"
          onClick={() => {
            if (onOpenManual) {
              onOpenManual();
            } else {
              const url = `${window.location.origin}/manual.pdf#zoom=page-fit`;
              const win = window.open(url, "_blank", "noopener");
              if (!win) window.location.href = url;
            }
          }}
        />

        <TileButton
          icon={<span className="text-2xl">🔊</span>}
          title="読み上げ設定"
          desc="声 / 話速"
          onClick={() => onNavigate("tts-settings")}
        />

        <TileButton
          icon={<span className="text-2xl">❓</span>}
          title="Q＆A"
          desc="使い方・よくある質問"
          onClick={() => onNavigate("qa")}
        />
        
        <TileButton
          icon={<span className="text-2xl">✉️</span>}
          title="お問い合わせ"
          desc="不具合・要望はこちら"
          onClick={() => onNavigate("contact")}
        />

        <TileButton
          icon={<span className="text-2xl">ℹ️</span>}
          title="バージョン情報"
          desc="ビルド番号・更新履歴"
          onClick={() => onNavigate("versionInfo")}
        />
      </div>
    </div>
  );
}
