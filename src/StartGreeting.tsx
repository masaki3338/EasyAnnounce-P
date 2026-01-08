// StartGreeting.tsx（全文置き換え）
import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

interface Props {
  onNavigate: (screen: string) => void;
  onBack?: () => void;
}

// ---- ミニSVGアイコン（依存なし） ----
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

const StartGreeting: React.FC<Props> = ({ onNavigate, onBack }) => {
  const [reading, setReading] = useState(false);
  const [tournamentName, setTournamentName] = useState("");
  const [matchNumber, setMatchNumber] = useState("");
  const [teamName, setTeamName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [benchSide, setBenchSide] = useState<"1塁側" | "3塁側">("1塁側");
  const [teamFurigana, setTeamFurigana] = useState("");
  const [opponentFurigana, setOpponentFurigana] = useState("");

  useEffect(() => {
    const load = async () => {
      const team = await localForage.getItem<any>("team");
      const matchInfo = await localForage.getItem<any>("matchInfo");
      if (team) {
        setTeamName(team.name || "");
        setTeamFurigana(team.furigana ?? team.nameFurigana ?? team.nameKana ?? "");
      }
      if (matchInfo) {
        setTournamentName(matchInfo.tournamentName || "");
        setMatchNumber(matchInfo.matchNumber || "〇");
        setOpponentName(matchInfo.opponentTeam || "");
        setBenchSide(matchInfo.benchSide || "1塁側");
        setOpponentFurigana(matchInfo.opponentTeamFurigana || "");
      }
    };
    load();
  }, []);

  // 初回だけ VOICEVOX を温める
  useEffect(() => { void prewarmTTS(); }, []);

  const team1st = benchSide === "1塁側" ? teamName : opponentName;
  const team3rd = benchSide === "3塁側" ? teamName : opponentName;

  // 読み上げ用（かな優先、無ければ漢字）
  const team1stRead = benchSide === "1塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);
  const team3rdRead = benchSide === "3塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);

  const messageSpeak =
    `おまたせいたしました。${tournamentName}。` +
    `ほんじつの だい${matchNumber}しあい、` +
    `${team1stRead}たい${team3rdRead}のしあい、` +
    `まもなくかいしでございます。`;

  const message =
    `お待たせいたしました \n${tournamentName}\n` +
    `本日の第${matchNumber}試合、\n` +
    `${team1st} 対 ${team3rd} の試合、\n` +
    `まもなく開始でございます。`;

  // VOICEVOX優先：押して“すぐ返す”。最初の1文を先に鳴らす（progressive）
  const handleSpeak = () => {
    setReading(true);
    void ttsSpeak(messageSpeak, { progressive: true, cache: true })
      .finally(() => setReading(false));
  };
  const handleStop = () => {
    ttsStop();        // VOICEVOXの <audio> と Web Speech の両方を停止
    setReading(false);
  };

  return (
      <div
        className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          WebkitTouchCallout: "none", // iOS Safari 長押しメニュー禁止
          WebkitUserSelect: "none",   // テキスト選択禁止
          userSelect: "none",         // 全体で禁止
        }}
      >

      {/* ヘッダー */}
      <header className="w-full max-w-md">
        <div className="flex items-center justify-between">

          <div className="w-10" />
        </div>

        {/* 中央大タイトル */}
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">🙇</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              試合開始挨拶
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>先攻チーム 🎤</span>
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="w-full max-w-md mt-6 space-y-5">
        {/* 注意/タイミングカード（アイコン＋淡いアンバー） */}
        <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <IconInfo />
            </div>
            <h2 className="font-semibold">読み上げタイミング</h2>
          </div>
          <p className="text-amber-50/90 text-sm leading-relaxed">
            挨拶終了後（後攻チームが守備につく時）
          </p>
        </section>

        {/* 🔴 アナウンス文言（“赤 強め”背景＋枠）。ボタンは枠の中に配置 */}
        <section
          className="
            rounded-2xl p-4 shadow-lg text-left font-semibold
            border border-rose-600/90
            bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
            ring-1 ring-inset ring-rose-600/50
          "
        >

          <p className="text-white whitespace-pre-wrap leading-relaxed drop-shadow">{message}</p>

          {/* 赤枠内の操作ボタン */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={handleSpeak}
              disabled={reading}
              className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <IconMic /> 読み上げ
            </button>
            <button
              onClick={handleStop}
              className="w-full px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center"
              disabled={!reading}
            >
              停止
            </button>
          </div>
        </section>

        {/* 戻るボタン（操作ボタンの下に横幅いっぱいで配置） */}
        <div className="mt-3">
          <button
            onClick={() => (onBack ? onBack() : onNavigate("startGame"))}
            className="w-full px-6 py-4 rounded-2xl bg-white/90 hover:bg-white text-gray-900 font-semibold text-lg shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>

      </main>
    </div>
  );
};

export default StartGreeting;
