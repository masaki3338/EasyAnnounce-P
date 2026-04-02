import React, { useEffect, useState } from "react";
import localForage from "localforage";

export type ScreenType =
  | "menu"
  | "teamRegister"
  | "matchCreate"
  | "startingLineup"
  | "startGame"
  | "announcement"
  | "warmup"
  | "sheetKnock"
  | "announceStartingLineup"
  | "templateEdit"
  | "offense"
  | "defense"
  | "gather"
  | "startGreeting"
  | "seatIntroduction";

interface Props {
  onNavigate: (step: ScreenType) => void;
  onBack: () => void;
}

/* ---- ミニSVGアイコン（依存なし） ---- */
const commonSvgProps = {
  xmlns: "http://www.w3.org/2000/svg",
  viewBox: "0 0 24 24",
  className: "w-6 h-6 shrink-0",     // ← 明示サイズ
  "aria-hidden": "true",
  focusable: "false",
} as const;

const IconWarmup = () => (
  <svg {...commonSvgProps} fill="none" stroke="currentColor">
    <path
      strokeLinecap="round"                 // ← camelCase
      strokeLinejoin="round"
      strokeWidth="2"
      d="M15 5a1 1 0 1 0 2 0a1 1 0 1 0-2 0M5 20l5-.5l1-2m7 2.5v-5h-5.5L15 8.5l-5.5 1l1.5 2"
    />
  </svg>
);

const IconKnock = () => (
  <svg {...commonSvgProps} fill="none" stroke="currentColor">
    <g strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
      <path d="M5.46 20L20.556 8.69a3.738 3.738 0 1 0-5.246-5.247L4 18.541" />
      <path d="M5.578 21.843c1.502-2.072-1.332-4.932-3.42-3.418a.38.38 0 0 0-.046.577L5 21.888c.166.166.44.144.578-.045M10 17l-3-3" />
      <circle cx="2.5" cy="2.5" r="2.5" transform="matrix(-1 0 0 1 21 16)" />
    </g>
  </svg>
);
const IconMegaphone = () => (
  <svg {...commonSvgProps} fill="currentColor">
    <path d="M2 10v4l10-3V7L2 10zm12-3v10l6 2V5l-6 2z" />
  </svg>
);

const IconUsers = () => (
  <svg {...commonSvgProps} fill="currentColor">
    <path d="M3.5 7a5 5 0 1 1 10 0a5 5 0 0 1-10 0M5 14a5 5 0 0 0-5 5v2h17v-2a5 5 0 0 0-5-5zm19 7h-5v-2c0-1.959-.804-3.73-2.1-5H19a5 5 0 0 1 5 5zm-8.5-9a5 5 0 0 1-1.786-.329A6.97 6.97 0 0 0 15.5 7a6.97 6.97 0 0 0-1.787-4.671A5 5 0 1 1 15.5 12"/>
  </svg>
);

const Greeting = () => (
  <svg {...commonSvgProps} fill="currentColor">
    <path d="M1.5 4v1.5c0 4.15 2.21 7.78 5.5 9.8V20h15v-2c0-2.66-5.33-4-8-4h-.25C9 14 5 10 5 5.5V4m9 0a4 4 0 0 0-4 4a4 4 0 0 0 4 4a4 4 0 0 0 4-4a4 4 0 0 0-4-4Z"/>
  </svg>
);

const IconMic = () => (
  <svg {...commonSvgProps} fill="currentColor">
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

/* ---- ステップ行（番号＋縦ライン＋カード） ---- */
const StepRow: React.FC<{
  index: number;
  title: string;
  note?: string;
  enabled: boolean;
  icon: React.ReactNode;
  isLast?: boolean;
  onClick?: () => void;
}> = ({ index, title, note, enabled, icon, isLast, onClick }) => {
  // 担当（enabled）の“明るいスカイ”テーマ（前回のまま）
  const enabledCard =
    "relative w-full text-left rounded-2xl p-4 shadow-lg transition active:scale-95 " +
    "bg-gradient-to-br from-sky-400/35 via-sky-400/20 to-sky-300/10 " +
    "border border-sky-300/70 ring-1 ring-inset ring-sky-300/40 text-white";

  // ✅ 担当外は文字を“少しだけ濃く”（見やすく）＆背景をやや明るく
  const disabledCard =
    "relative w-full text-left rounded-2xl p-4 shadow-lg transition " +
    "bg-gray-200/90 border border-gray-300 text-gray-600 hover:bg-gray-200/90";

  return (
    <div className="grid grid-cols-[28px,1fr] gap-3 items-start">
      {/* 左：番号バッジ＋縦ライン */}
      <div className="flex flex-col items-center">
        <div
          className={
            "w-7 h-7 rounded-full text-xs font-bold flex items-center justify-center " +
            (enabled
              ? "bg-gradient-to-br from-sky-400 to-sky-500 text-white shadow-[0_0_0_3px_rgba(56,189,248,0.25)]"
              : "bg-gray-300 text-gray-700")
          }
        >
          {index}
        </div>
        {!isLast && (
          <div
            className={"w-px flex-1 mt-1 " + (enabled ? "bg-sky-400/80" : "bg-gray-400/50")}
            style={{ minHeight: 20 }}
          />
        )}
      </div>

      {/* 右：カード本体（担当=明るい青 / 担当外=少し濃い文字で見やすく） */}
      <button aria-disabled={!enabled} onClick={onClick} className={enabled ? enabledCard : disabledCard}>
        {/* 担当のみ：左端アクセントバー */}
        {enabled && (
          <div className="absolute left-0 top-0 bottom-0 w-1.5 rounded-l-2xl bg-gradient-to-b from-sky-300 to-sky-600" />
        )}

        <div className="flex items-center gap-3">
          <div
            className={
              "w-11 h-11 rounded-xl flex items-center justify-center " +
              (enabled
                ? "bg-sky-400/25 border border-sky-300/70 text-sky-50"
                : "bg-white/70 text-gray-600 border border-white/60")
            }
          >
            {icon}
          </div>
          <div className="min-w-0">
            <div className={"font-semibold " + (enabled ? "" : "text-gray-700")}>{title}</div>
            {note && (
              <div className={"text-xs mt-0.5 " + (enabled ? "text-sky-50/80" : "text-gray-600/90")}>
                {note}
              </div>
            )}
          </div>
        </div>
      </button>
    </div>
  );
};




const PreGameAnnouncement: React.FC<Props> = ({ onNavigate, onBack }) => {
  // 先攻/後攻を文字で統一
  const [attackLabel, setAttackLabel] = useState<"先攻" | "後攻">("先攻");
  const [showHelp, setShowHelp] = useState(false);
  
    useEffect(() => {
    const load = async () => {
      const matchInfo = await localForage.getItem("matchInfo");
      if (matchInfo && typeof matchInfo === "object") {
        const v: any = (matchInfo as any).isHome; // 以前の保存形式に合わせて正規化
        let label: "先攻" | "後攻" = "先攻";
        if (typeof v === "boolean") label = v ? "後攻" : "先攻"; // trueを「後攻」として扱っていたケースに対応
        else if (v === "先攻" || v === "後攻") label = v;
        else if (typeof (matchInfo as any).isFirst === "boolean")
          label = (matchInfo as any).isFirst ? "先攻" : "後攻";
        setAttackLabel(label);
      }
    };
    load();
  }, []);

  const isFirst = attackLabel === "先攻";

  const steps = [
    {
      key: "warmup" as const,
      title: "ウォーミングアップ",
      note: "後攻チーム 🎤",
      icon: <IconWarmup />,
      enabled: !isFirst,
    },
    {
      key: "sheetKnock" as const,
      title: "シートノック",
      note: "両チーム",
      icon: <IconKnock />,
      enabled: true,
    },
    {
      key: "announceStartingLineup" as const,
      title: "スタメン発表",
      note: "両チーム 🎤",
      icon: <IconMegaphone />,
      enabled: true,
    },
    {
      key: "gather" as const,
      title: "集合",
      note: "先攻チーム 🎤",
      icon: <IconUsers />,
      enabled: isFirst,
    },
    {
      key: "startGreeting" as const,
      title: "試合開始挨拶",
      note: "先攻チーム 🎤",
      icon: <Greeting />,
      enabled: isFirst,
    },
    {
      key: "seatIntroduction" as const,
      title: "シート紹介",
      note: "後攻チーム 🎤",
      icon: <IconMic />,
      enabled: !isFirst,
    },
  ];

  // 担当外でも遷移OK（確認付き）
const handleStepClick = async (s: typeof steps[number]) => {
  if (!s.enabled) {
    const ok = window.confirm(`${s.title} は現在の担当外です。開きますか？`);
    if (!ok) return;
  }
  // 📝 シート紹介に入る前だけ「どこから来たか」を保存
  if (s.key === "seatIntroduction") {
    await localForage.setItem("lastScreen", "announcement");
  }
  onNavigate(s.key);
};

  return (
      <div
        className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          WebkitTouchCallout: "none",
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >

      {/* ヘッダー */}
      <header className="relative w-full max-w-md md:max-w-none text-center select-none mt-1">
        <h1 className="flex items-center justify-center gap-2 text-2xl sm:text-3xl md:text-4xl font-extrabold tracking-wide leading-tight pr-12">
          <span className="text-xl sm:text-2xl md:text-3xl">🎤</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-blue-400 drop-shadow">
            試合前アナウンス
          </span>
        </h1>

        <button
          type="button"
          onClick={() => setShowHelp(true)}
          className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/15 border border-white/20 text-white font-extrabold text-lg shadow hover:bg-white/25 active:scale-95"
          aria-label="使い方を表示"
          title="使い方"
        >
          ？
        </button>
      </header>

      {/* 縦ステッパー本体 */}
      <main className="w-full max-w-md md:max-w-none mt-6 space-y-4">
        {steps.map((s, i) => (
          <StepRow
            key={s.key}
            index={i + 1}
            title={s.title}
            note={s.note}
            icon={s.icon}
            enabled={s.enabled}
            isLast={i === steps.length - 1}
             onClick={() => handleStepClick(s)}
          />
        ))}

        {/* 戻る */}
        <button
          className="w-full mt-4 bg-white/10 hover:bg-white/15 text-white px-4 py-3 rounded-2xl text-base border border-white/10"
          onClick={onBack}
        >
          ← 試合開始画面に戻る
        </button>
      </main>

      {/* 使い方モーダル */}
      {showHelp && (
        <div
          className="fixed inset-0 z-[1050] flex items-center justify-center bg-black/60 px-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowHelp(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="bg-blue-600 text-white text-center font-bold py-3">
              試合前アナウンスの使い方
            </div>

            <div className="px-5 py-5 text-[15px] leading-relaxed">
              <div className="rounded-2xl bg-white border border-gray-200 px-4 py-4 space-y-4">
                <div className="rounded-2xl bg-blue-50 border-2 border-blue-300 px-4 py-4">
                  <div className="font-extrabold text-gray-900 text-[17px] leading-snug">
                    試合前アナウンスは先攻、後攻で読み上げる項目が違います
                  </div>
                </div>

                <div className="rounded-2xl bg-sky-100 border-2 border-sky-300 px-4 py-4 shadow-sm">
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5 font-extrabold text-sky-900 text-[16px] leading-snug">
                      グレー表示されている項目は相手チームの読み上げ項目です
                    </div>
                  </div>
                </div>

                <div className="rounded-2xl bg-sky-100 border-2 border-sky-300 px-4 py-4 shadow-sm">
                  <div className="flex items-start gap-2">
                    <div className="pt-0.5 font-extrabold text-sky-900 text-[16px] leading-snug">
                      項目は上から読み上げる順番になっています
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-5 pb-5">
              <button
                className="w-full py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800"
                onClick={() => setShowHelp(false)}
              >
                閉じる
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PreGameAnnouncement;
