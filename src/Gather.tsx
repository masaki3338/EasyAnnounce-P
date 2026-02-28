// Gather.tsx（全文置き換え）
import React, { useEffect, useRef, useState } from "react";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";
interface Props {
  onNavigate: (screen: string) => void; // 画面遷移用コールバック
}

/* ====== ミニSVGアイコン（依存なし） ====== */
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);
const IconUsers = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM5 20a7 7 0 0114 0v2H5v-2z" />
  </svg>
);

const IconAlert: React.FC = () => (
  <img
    src="/warning-icon.png"        // ← public/warning-icon.png
    alt="注意"
    className="w-6 h-6 object-contain select-none pointer-events-none"
    aria-hidden
    draggable={false}
    width={24}
    height={24}
  />
);
const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

const Gather: React.FC<Props> = ({ onNavigate }) => {
  const message = "両チームの選手はベンチ前にお集まりください。";
  const [speaking, setSpeaking] = useState(false);

  // アンマウント時は停止
  useEffect(() => () => { ttsStop(); setSpeaking(false); }, []);

  // 初回だけ VOICEVOX をウォームアップ（初回の待ち時間を短縮）
  useEffect(() => { void prewarmTTS(); }, []);

  // VOICEVOX優先：UIは待たせず、先頭文を先に鳴らす（progressive）
  const speakMessage = () => {
    setSpeaking(true);
    void ttsSpeak(message, { progressive: true, cache: true })
      .finally(() => setSpeaking(false));
  };
  const stopSpeaking = () => {
    ttsStop();
    setSpeaking(false);
  };

  return (
      <div
        className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          WebkitTouchCallout: "none", // iOS Safari 長押しメニュー禁止
          WebkitUserSelect: "none",   // テキスト選択禁止
          userSelect: "none",         // 全体で禁止
        }}
      >

      {/* ヘッダー */}
      <header className="w-full max-w-md md:max-w-none">
        <div className="flex items-center justify-between">

          <div className="w-10" />
        </div>

        {/* 中央大タイトル */}
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">👥</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              集合アナウンス
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <IconUsers />
            <span>先攻チーム 🎤</span>
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="w-full max-w-md md:max-w-none mt-6 space-y-5">
        {/* 注意文（条件付きの案内） */}
        <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <IconAlert />
            </div>
            <h2 className="font-semibold">読み上げタイミング</h2>
          </div>
          <p className="text-amber-50/90 text-sm leading-relaxed">
            グラウンド整備終了後、選手がベンチ前に待機していない場合のみ、案内してください。
          </p>
        </section>

        {/* 🔴 アナウンス文言（赤 強め） */}
        <section
          className="
            rounded-2xl p-4 shadow-lg text-left font-semibold
            border border-rose-600/90
            bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
            ring-1 ring-inset ring-rose-600/50
          "
        >

          <p className="text-white whitespace-pre-wrap leading-relaxed drop-shadow">
            {message}
          </p>
          {/* ▼ 赤枠内の操作ボタン */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={speakMessage}
              disabled={speaking}
              className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <IconMic /> 読み上げ
            </button>
            <button
              onClick={stopSpeaking}
              className="w-full px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center"
            >
              停止
            </button>
          </div>
        </section>  

        {/* ▼ 戻るボタン（カードの下に横幅いっぱい配置） */}
        <div className="mt-4">
          <button
            onClick={() => onNavigate("announcement")}
            className="w-full py-4 rounded-2xl bg-white/90 hover:bg-white text-gray-900 font-semibold text-lg shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>

      </main>
    </div>
  );
};

export default Gather;
