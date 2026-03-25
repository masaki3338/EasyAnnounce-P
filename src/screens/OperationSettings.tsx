// src/screens/OperationSettings.tsx
import type { ScreenType } from "../App";
import React, { useState } from "react";
import { getLeagueMode } from "../lib/leagueSettings";

type Props = {
  onNavigate: (s: ScreenType) => void;
};

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

export default function OperationSettings({ onNavigate }: Props) {
  const [showManual, setShowManual] = useState(false);

  const leagueMode = getLeagueMode();
  const manualFile = leagueMode === "boys" ? "Boysmanual.pdf" : "manual.pdf";
  const manualTitle =
    leagueMode === "boys"
      ? "ボーイズリーグ 連盟アナウンスマニュアル"
      : "ポニーリーグ 連盟アナウンスマニュアル";

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-4 sm:px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <header className="w-full max-w-2xl">
        <div className="mt-3 text-center select-none">
          <h1
            className="
              inline-flex items-center gap-2
              text-3xl md:text-4xl font-extrabold tracking-wide leading-tight
            "
          >
            <span className="text-2xl md:text-3xl">⚙️</span>
            <span
              className="
                bg-clip-text text-transparent
                bg-gradient-to-r from-white via-blue-100 to-blue-400
                drop-shadow
              "
            >
              運用設定
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
        </div>
      </header>

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
          onClick={() => setShowManual(true)}
        />

        <TileButton
          icon={<span className="text-2xl">🔊</span>}
          title="読み上げ設定"
          desc="声 / 話速"
          onClick={() => onNavigate("tts-settings")}
        />

        <TileButton
          icon={<span className="text-2xl">🏆</span>}
          title="リーグ設定"
          desc="ポニーリーグ / ボーイズリーグ"
          onClick={() => onNavigate("league-settings")}
        />

        <TileButton
          icon={<span className="text-2xl">📔</span>}
          title="チュートリアル"
          desc="使い方"
          onClick={() => onNavigate("tutorial")}
        />

        <TileButton
          icon={<span className="text-2xl">❓</span>}
          title="Q＆A"
          desc="よくある質問"
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

      {showManual && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm">
          <div
            className="
              h-[100svh] w-full
              flex flex-col
              bg-slate-950
              sm:px-3 sm:py-3
            "
            style={{
              paddingTop: "max(8px, env(safe-area-inset-top))",
              paddingBottom: "max(8px, env(safe-area-inset-bottom))",
              paddingLeft: "max(8px, env(safe-area-inset-left))",
              paddingRight: "max(8px, env(safe-area-inset-right))",
            }}
          >
            <div
              className="
                flex-1 min-h-0 w-full
                bg-slate-900
                sm:rounded-3xl
                sm:border sm:border-white/10
                sm:shadow-2xl
                overflow-hidden
                flex flex-col
              "
            >
              {/* ヘッダー */}
              <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-white/10 bg-slate-900/95">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base sm:text-lg font-bold leading-tight">
                      {manualTitle}
                    </div>
                    <div className="text-xs sm:text-sm text-white/65 mt-1 break-all">
                      {manualFile}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowManual(false)}
                    className="shrink-0 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 px-3 py-2 text-sm font-semibold"
                    aria-label="閉じる"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* PDF表示エリア */}
              <div className="flex-1 min-h-0 bg-white">
                <iframe
                  title={manualTitle}
                  src={`/${manualFile}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                  className="w-full h-full"
                />
              </div>

              {/* フッター */}
              <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-white/10 bg-slate-900">
                <button
                  onClick={() => setShowManual(false)}
                  className="
                    w-full rounded-2xl
                    bg-blue-600 hover:bg-blue-500 active:scale-[0.98]
                    transition font-bold
                    py-3.5 text-base sm:text-lg
                    shadow-lg
                  "
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}