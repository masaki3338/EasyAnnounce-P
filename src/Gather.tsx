import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

interface Props {
  onNavigate: (screen: string) => void;
  onBack?: () => void;
  leagueMode: "pony" | "boys";
}

/* ====== ミニSVGアイコン（依存なし） ====== */
const IconUsers = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zM5 20a7 7 0 0114 0v2H5v-2z" />
  </svg>
);

const IconAlert: React.FC = () => (
  <img
    src="/warning-icon.png"
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
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z" />
  </svg>
);

const Gather: React.FC<Props> = ({ onNavigate, onBack, leagueMode }) => {
  const [speaking, setSpeaking] = useState(false);

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

  useEffect(() => {
    void prewarmTTS();
  }, []);

  useEffect(() => {
    return () => {
      ttsStop();
      setSpeaking(false);
    };
  }, []);

  const team1st = benchSide === "1塁側" ? teamName : opponentName;
  const team3rd = benchSide === "3塁側" ? teamName : opponentName;

  const team1stRead =
    benchSide === "1塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);
  const team3rdRead =
    benchSide === "3塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);

  const isBoys = leagueMode === "boys";

  const gatherMessage = "両チームの選手はベンチ前にお集まりください。";

  const startGreetingSpeak = isBoys
    ? `おまたせいたしました。${team1stRead}たい${team3rdRead}のしあい、まもなくかいしでございます。`
    : `おまたせいたしました。${tournamentName}。` +
      `ほんじつの だい${matchNumber}しあい、` +
      `${team1stRead}たい${team3rdRead}のしあい、` +
      `まもなくかいしでございます。`;

  const startGreetingText = isBoys
    ? `お待たせいたしました\n${team1st} 対 ${team3rd} の試合、\nまもなく開始でございます。`
    : `お待たせいたしました\n${tournamentName}\n本日の第${matchNumber}試合、\n${team1st} 対 ${team3rd} の試合、\nまもなく開始でございます。`;

  const handleSpeakGather = () => {
    setSpeaking(true);
    void ttsSpeak(gatherMessage, { progressive: true, cache: true }).finally(() => {
      setSpeaking(false);
    });
  };

  const handleSpeakGreeting = () => {
    setSpeaking(true);
    void ttsSpeak(startGreetingSpeak, { progressive: true, cache: true }).finally(() => {
      setSpeaking(false);
    });
  };

  const handleStop = () => {
    ttsStop();
    setSpeaking(false);
  };

  return (
    <div
      className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-4"
      style={{
        paddingTop: "max(10px, env(safe-area-inset-top))",
        paddingBottom: "max(10px, env(safe-area-inset-bottom))",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <header className="w-full max-w-md md:max-w-none">
        <div className="mt-1 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-2xl md:text-3xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">👥</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              集合 / 試合開始挨拶
            </span>
          </h1>
          <div className="mx-auto mt-1 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-2 inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/10 border border-white/10 text-[11px]">
            <IconUsers />
            <span>先攻チーム 🎤</span>
          </div>
        </div>
      </header>

<main className="w-full max-w-md md:max-w-none mt-4 space-y-3">
  {/* 集合セット */}
  <div className="space-y-0">
    <section className="rounded-t-2xl rounded-b-none p-3 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
          <IconAlert />
        </div>
        <h2 className="font-semibold">集合アナウンス</h2>
      </div>
      <p className="text-amber-50/90 text-sm leading-relaxed">
        グラウンド整備終了後、選手がベンチ前に
        <span className="mx-1 rounded bg-red-500/20 px-1.5 py-0.5 font-extrabold text-red-300">
          待機していない場合
        </span>
        のみ、案内してください。
      </p>
    </section>

    <section
      className="
        rounded-t-none rounded-b-2xl p-4 shadow-lg text-left font-semibold
        border-x border-b border-rose-600/90
        bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
        ring-1 ring-inset ring-rose-600/50
      "
    >
      <p className="text-white whitespace-pre-wrap leading-relaxed drop-shadow">
        {gatherMessage}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={handleSpeakGather}
          disabled={speaking}
          className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          <IconMic /> 読み上げ
        </button>
        <button
          onClick={handleStop}
          disabled={!speaking}
          className="w-full px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center disabled:opacity-60"
        >
          停止
        </button>
      </div>
    </section>
  </div>

  {/* 試合開始挨拶セット */}
  <div className="space-y-0">
    <section className="rounded-t-2xl rounded-b-none p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
      <div className="flex items-center gap-2 mb-1">
        <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
          <IconAlert />
        </div>
        <h2 className="font-semibold">試合開始挨拶</h2>
      </div>
      <p className="text-amber-50/90 text-[13px] leading-5">
        挨拶終了後（後攻チームが守備につく時）
      </p>
    </section>

    <section
      className="
        rounded-t-none rounded-b-2xl p-4 shadow-lg text-left font-semibold
        border-x border-b border-rose-600/90
        bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
        ring-1 ring-inset ring-rose-600/50
      "
    >
      <p className="text-white whitespace-pre-wrap leading-relaxed drop-shadow">
        {startGreetingText}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={handleSpeakGreeting}
          disabled={speaking}
          className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
        >
          <IconMic /> 読み上げ
        </button>
        <button
          onClick={handleStop}
          disabled={!speaking}
          className="w-full px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center disabled:opacity-60"
        >
          停止
        </button>
      </div>
    </section>
  </div>

  <div className="mt-4">
    <button
      onClick={() => (onBack ? onBack() : onNavigate("announcement"))}
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