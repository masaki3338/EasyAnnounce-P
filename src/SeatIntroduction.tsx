// SeatIntroduction.tsx（全文置き換え）
import React, { useEffect, useState, useRef } from "react";
import localForage from "localforage";
import { ScreenType } from "./pre-game-announcement";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

interface Props {
  onNavigate: (screen: ScreenType) => void;
  onBack?: () => void;
}

type PositionInfo = {
  lastName: string;
  lastNameKana: string;
  firstName: string;       // ★追加
  firstNameKana: string;   // ★追加
  honorific: string;
};


/* ==== ミニSVGアイコン（依存なし） ==== */
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);

const IconInfo: React.FC = () => (
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

// 追加：戻り先をストレージから都度解決
const resolveBackTarget = async (): Promise<ScreenType> => {
  const [last, matchInfo] = await Promise.all([
    localForage.getItem<string>("lastScreen"),
    localForage.getItem<any>("matchInfo"),
  ]);
  const s = (last || "").toLowerCase();
  const isFromPreAnnounce =
    s.includes("announce") || s.includes("warmup") || s.includes("greet") ||
    s.includes("knock") || s.includes("gather") || s.includes("seat");
  const isFromOffense =
    s.includes("offen") || s.includes("attack") || s.includes("bat");

  if (isFromPreAnnounce) return "announcement" as ScreenType;
  if (isFromOffense) return "defense" as ScreenType;
  if (matchInfo && matchInfo.isDefense === false) return "defense" as ScreenType; // 保険
  return "startGame" as ScreenType;
};

const SeatIntroduction: React.FC<Props> = ({ onNavigate, onBack }) => {
  const [teamName, setTeamName] = useState("");
  const [positions, setPositions] = useState<{ [key: string]: PositionInfo }>({});
  const [isHome, setIsHome] = useState(true); // true → 後攻
  const [speaking, setSpeaking] = useState(false);
  const [backTarget, setBackTarget] = useState<ScreenType>("announcement" as ScreenType);
  // ★ 同姓（苗字）重複セット
  const [dupLastNames, setDupLastNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      const list = (await localForage.getItem<string[]>("duplicateLastNames")) ?? [];
      setDupLastNames(new Set(list.map(s => String(s))));
    })();
  }, []);



  const positionLabels: [string, string][] = [
    ["投", "ピッチャー"],
    ["捕", "キャッチャー"],
    ["一", "ファースト"],
    ["二", "セカンド"],
    ["三", "サード"],
    ["遊", "ショート"],
    ["左", "レフト"],
    ["中", "センター"],
    ["右", "ライト"],
  ];

  const inning = isHome ? "1回の表" : "1回の裏";

  useEffect(() => {
    const loadData = async () => {
 const team = await localForage.getItem<any>("team");
 // ✅ まずスタメン専用キーを読む。無ければ従来キーにフォールバック
const latest = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
const starting = await localForage.getItem<Record<string, number | null>>("startingassignments");
const assignments: Record<string, number | null> = latest ?? starting ?? {};
 const matchInfo = await localForage.getItem<any>("matchInfo");
      const last = (await localForage.getItem<string>("lastScreen")) || "";

      console.log("SeatIntro lastScreen=", last, " isDefense=", matchInfo?.isDefense);

      if (team) setTeamName(team.name || "");
      if (matchInfo) setIsHome(matchInfo.isHome ?? true);

      // 戻り先の判定（大小無視の部分一致＋保険）
      const s = (last || "").toLowerCase();
      const isFromPreAnnounce =
        s.includes("announce") || s.includes("warmup") || s.includes("greet") ||        s.includes("knock") || s.includes("gather") || s.includes("seat");
      const isFromOffense =
        s.includes("offen") || s.includes("attack") || s.includes("bat");

      setBackTarget(await resolveBackTarget());
      const tgt = await resolveBackTarget();
      setBackTarget(tgt);
      console.log("SeatIntro backTarget(init)=", tgt, " lastScreen=", last, " isDefense=", matchInfo?.isDefense);

 if (team?.players) {
   const FIELD_POS = ["投","捕","一","二","三","遊","左","中","右"]; // ← フィールドだけ
   const posMap: { [key: string]: PositionInfo } = {};
   for (const pos of FIELD_POS) {
     const playerId = assignments[pos];
     if (typeof playerId !== "number") continue;
     const player = team.players.find((p: any) => p.id === playerId);
     if (!player) continue;
      posMap[pos] = {
        lastName: player.lastName,
        lastNameKana: player.lastNameKana,
        firstName: player.firstName,         // ★追加
        firstNameKana: player.firstNameKana, // ★追加
        honorific: player.isFemale ? "さん" : "くん",
      };

   }
   setPositions(posMap);
 }
    };
    loadData();
    return () => { ttsStop(); setSpeaking(false); };
  }, []);

  // 初回だけ VOICEVOX を温めて初回の待ち時間を短縮
  useEffect(() => { void prewarmTTS(); }, []);

  const speakText = () => {
    // 表示と同じ文面（読みやすい句切り）で VOICEVOX 読み上げ
    const text =
      [
        `${inning} 守ります、${teamName}のシートをお知らせします。`,
        ...positionLabels.map(([pos, label]) => {
          const p = positions[pos];
          const ln = p?.lastName || "";
          const forceFull = ln && dupLastNames.has(ln);
          const yomi = forceFull
            ? `${p?.lastNameKana || ""} ${p?.firstNameKana || ""}`
            : `${p?.lastNameKana || ""}`;
          return `${label} ${yomi}${p?.honorific || "くん"}`;
        }),
      ].join("、") + "です。";
    setSpeaking(true);
    // ❗️待たずに発火（IIFEでtry/finally）
    void (async () => {
      try {
        await ttsSpeak(text, { progressive: true, cache: true });
      } finally {
        setSpeaking(false);
      }
    })();
  };
  const stopSpeaking = () => {
    ttsStop();
    setSpeaking(false);
  };


  const formattedAnnouncement =
    `${inning}　守ります　${teamName} のシートをお知らせします。\n\n` +
    positionLabels
      .map(([pos, label]) => {
        const player = positions[pos];
        const p = positions[pos];
        const ln = p?.lastName || "";
        const forceFull = ln && dupLastNames.has(ln);
        const nameHTML = p?.lastName
          ? (forceFull
              ? `<ruby>${p.lastName}<rt>${p.lastNameKana || ""}</rt></ruby>` +
                `<ruby>${p.firstName || ""}<rt>${p.firstNameKana || ""}</rt></ruby>`
              : `<ruby>${p.lastName}<rt>${p.lastNameKana || ""}</rt></ruby>`)
          : "（苗字）";
        return `${label}　${nameHTML}　${p?.honorific || "くん"}`;

      })
      .join("<br />") + "です。";

  if (!teamName) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex items-center justify-center px-6">
        読み込み中…
      </div>
    );
  }

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
      <header className="w-full max-w-[720px]">
        <div className="flex items-center justify-between">

          <div className="w-10" />
        </div>

        {/* 中央大タイトル */}
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">🪑</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              シート紹介
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>{isHome ? "後攻チーム 🎤" : "先攻チーム 🎤"}</span>
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="w-full max-w-[720px] mt-6 space-y-5">
        {/* 注意カード（黄系） */}
        <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <IconInfo />
            </div>
            <h2 className="font-semibold">読み上げタイミング</h2>
          </div>
          <p className="text-amber-50/90 text-sm leading-relaxed">
            ピッチャーが練習球を1球投げてから
          </p>
        </section>

        {/* 🔴 アナウンス文言（赤 強め）＋ 枠内ボタン */}
        <section
          className="
            rounded-2xl p-4 shadow-lg text-left font-semibold
            border border-rose-600/90
            bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
            ring-1 ring-inset ring-rose-600/50
          "
        >

          <div
            className="text-white whitespace-pre-line leading-relaxed drop-shadow"
            dangerouslySetInnerHTML={{ __html: formattedAnnouncement }}
          />

          {/* 枠内の操作ボタン */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={speakText}
              disabled={speaking}
              className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <IconMic /> 読み上げ
            </button>
            <button
              onClick={stopSpeaking}
              disabled={!speaking}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center"
            >
              停止
            </button>
          </div>
        </section>

        {/* 戻るボタン（読み上げ・停止の下に横幅いっぱいで配置） */}
        <div className="mt-3">
          <button
            onClick={async () => {
              const tgt = await resolveBackTarget();
              console.log("SeatIntro back ->", tgt);
              onNavigate(tgt);
            }}
            className="w-full px-6 py-4 rounded-2xl bg-white/90 hover:bg-white
                      text-gray-900 font-semibold text-lg shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>

      </main>
    </div>
  );
};

export default SeatIntroduction;
