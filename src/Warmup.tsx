// Warmup.tsx（全文置き換え）
import React, { useState, useRef, useEffect } from "react";
import localForage from "localforage";
import { ScreenType } from "./App";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";
import { pageStyle } from "./styles/pageStyle";

/* ====== ミニSVGアイコン（依存なし） ====== */
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
const IconMic2 = () => (
  <img
    src="/mic-red.png"        // ← public/mic-red.png
    alt="マイク"
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
const IconTimer = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M15 1H9v2h6V1zm-3 4a9 9 0 109 9 9 9 0 00-9-9zm1 9h-2v5h5v-2h-3z"/>
  </svg>
);
const IconGym = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <circle cx="12" cy="4.5" r="2" />
    <path d="M4 9 L12 8 L20 9" />
    <path d="M12 8 L12 14" />
    <path d="M12 14 L7.5 19" />
    <path d="M12 14 L16.5 19" />
  </svg>
);

/* ====== 共通：カードUI ====== */
const StepCard: React.FC<{
  step: number;
  icon: React.ReactNode;
  title: string;
  accent?: "blue" | "amber" | "gray";
  children: React.ReactNode;
}> = ({ step, icon, title, children, accent = "blue" }) => {
  const accents: Record<string, string> = {
    blue: "from-sky-400/25 via-sky-400/10 to-sky-300/5 border-sky-300/60 ring-sky-300/30",
    amber: "from-amber-400/25 via-amber-400/10 to-amber-300/5 border-amber-300/60 ring-amber-300/30",
    gray: "from-white/10 via-white/5 to-transparent border-white/10 ring-white/10",
  };
  return (
    <section
      className={`relative rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br ${accents[accent]} border ring-1 ring-inset`}
    >
      {/* 左上：番号バッジ */}
      <div className="absolute -left-3 -top-3 w-8 h-8 rounded-full bg-white/90 text-gray-800 text-sm font-bold shadow flex items-center justify-center">
        {step}
      </div>
      <div className="flex items-center gap-3 mb-2">
        <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white">
          {icon}
        </div>
        <h2 className="font-semibold text-white">{title}</h2>
      </div>
      <div>{children}</div>
    </section>
  );
};

/* ====== アナウンス文言ブロック（赤 強め＋枠内ボタン） ====== */
const MessageBlock: React.FC<{
  text: string;
  speakText?: string;
  keyName: string;
  readingKey: string | null;
  onSpeak: (t: string, k: string) => void;
  onStop: () => void;
  label?: string;
}> = ({ text, speakText, keyName, readingKey, onSpeak, onStop, label }) => (
  <div
    className="
      rounded-2xl p-4 shadow-lg text-left font-semibold
      border border-rose-600/90
      bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
      ring-1 ring-inset ring-rose-600/50
    "
  >
    <div className="flex items-start gap-2 mb-2">

      <div className="flex-1">
        {label && <div className="text-rose-50/90 text-[11px] mb-1">{label}</div>}
        <p className="text-white whitespace-pre-wrap leading-relaxed drop-shadow">{text}</p>
      </div>
    </div>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <button
        className={`flex-1 px-4 py-3 rounded-xl text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center gap-2 ${
          readingKey === keyName ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"
        }`}
        onClick={() => onSpeak(speakText ?? text, keyName)}
      >
        <IconMic /> 読み上げ
      </button>
      <button
        className="flex-1 px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center"
        onClick={onStop}
        disabled={readingKey !== keyName}
      >
        停止
      </button>
    </div>
  </div>
);

const Warmup: React.FC<{ onBack: () => void; onNavigate?: (screen: ScreenType) => void }> = ({ onBack }) => {
  const [teamName, setTeamName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [benchSide, setBenchSide] = useState<"1塁側" | "3塁側">("1塁側");
  const [teamFurigana, setTeamFurigana] = useState("");
  const [opponentFurigana, setOpponentFurigana] = useState("");
  const [readingKey, setReadingKey] = useState<string | null>(null);

  const [timer1Active, setTimer1Active] = useState(false);
  const [timer1TimeLeft, setTimer1TimeLeft] = useState(0);
  const [timer2Active, setTimer2Active] = useState(false);
  const [timer2TimeLeft, setTimer2TimeLeft] = useState(0);
  const [timer1Setting, setTimer1Setting] = useState(300); // 秒
  const [timer2Setting, setTimer2Setting] = useState(300);

  const [showEndModal1, setShowEndModal1] = useState(false);
  const [showEndModal2, setShowEndModal2] = useState(false);

  const timer1Ref = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timer2Ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const load = async () => {
      const matchInfo = await localForage.getItem("matchInfo");
      const team = await localForage.getItem("team");

      if (matchInfo && typeof matchInfo === "object") {
        const mi = matchInfo as any;
        setOpponentName(mi.opponentTeam || "");
        setBenchSide(mi.benchSide || "1塁側");
        setOpponentFurigana(mi.opponentTeamFurigana || "");
      }
      if (team && typeof team === "object") {
        const t = team as any;
        setTeamName(t.name || "");
        setTeamFurigana(t.furigana ?? t.nameFurigana ?? t.nameKana ?? "");
      }
    };
    load();
  }, []);

  // 初回だけ VOICEVOX を温めると、最初の読み上げが速くなります
 useEffect(() => { void prewarmTTS(); }, []);

 const team1 = benchSide === "1塁側" ? teamName : opponentName;
  const team3 = benchSide === "3塁側" ? teamName : opponentName;

  // 読み上げ用（かな優先）
  const team1Read = benchSide === "1塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);
  const team3Read = benchSide === "3塁側" ? (teamFurigana || teamName) : (opponentFurigana || opponentName);

  // VOICEVOX優先（失敗時 Web Speech に自動フォールバック）
  // VOICEVOX優先：UIは待たせず、最初の1文を先に再生（progressive）
  const handleSpeak = (text: string, key: string) => {
    setReadingKey(key);
    void ttsSpeak(text, { progressive: true, cache: true });
  };
  const handleStop = () => {
    ttsStop();         // VOXの<audio> も Web Speech も両方停止
    setReadingKey(null);
  };

  const startTimer = (num: 1 | 2) => {
    if (num === 1) {
      setTimer1TimeLeft(timer1Setting);
      setTimer1Active(true);
    } else {
      setTimer2TimeLeft(timer2Setting);
      setTimer2Active(true);
    }
  };
  const stopTimer = (num: 1 | 2) => {
    if (num === 1 && timer1Ref.current) {
      clearInterval(timer1Ref.current);
      setTimer1Active(false);
    }
    if (num === 2 && timer2Ref.current) {
      clearInterval(timer2Ref.current);
      setTimer2Active(false);
    }
  };
  const resetTimer = (num: 1 | 2) => {
    if (num === 1 && timer1Ref.current) {
      clearInterval(timer1Ref.current);
      setTimer1TimeLeft(0);
      setTimer1Active(false);
    }
    if (num === 2 && timer2Ref.current) {
      clearInterval(timer2Ref.current);
      setTimer2TimeLeft(0);
      setTimer2Active(false);
    }
  };

  useEffect(() => {
    if (timer1Active) {
      timer1Ref.current = setInterval(() => {
        setTimer1TimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer1Ref.current!);
            setTimer1Active(false);
            setShowEndModal1(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer1Ref.current!);
  }, [timer1Active]);

  useEffect(() => {
    if (timer2Active) {
      timer2Ref.current = setInterval(() => {
        setTimer2TimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer2Ref.current!);
            setTimer2Active(false);
            setShowEndModal2(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer2Ref.current!);
  }, [timer2Active]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const mainMessage =
    `両チームはウォーミングアップに入って下さい。\n` +
    `${team1} はトスバッティング、\n` +
    `${team3} はキャッチボールを開始してください。`;

  const mainSpeak =
    `りょうチームはウォーミングアップに入ってください。\n` +
    `${team1Read}はトスバッティング、\n` +
    `${team3Read}はキャッチボールを開始してください。`;

  return (
      <div 
        className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          WebkitTouchCallout: "none", // iOS Safari 長押しメニュー禁止
          WebkitUserSelect: "none",   // iOS/Android テキスト選択禁止
          userSelect: "none",         // 全体選択禁止
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
            <span className="text-2xl md:text-3xl">🤸</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              ウォーミングアップ
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />

        </div>
      </header>

      {/* 本体：カード群 */}
      <main className="w-full max-w-[720px] mt-6 space-y-5">
        {/* 1 読み上げタイミング（黄） */}
        <StepCard step={1} icon={<IconInfo />} title="読み上げタイミング" accent="amber">
          <div className="text-amber-50/90 text-sm leading-relaxed">
            試合開始30分前にアナウンス
          </div>
        </StepCard>

        {/* 2 本アナウンス（赤 強め） */}
        <StepCard step={2} icon={<IconMic2 />} title="本アナウンス" accent="blue">
          <MessageBlock
            text={mainMessage}
            speakText={mainSpeak}
            keyName="start"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
          />
        </StepCard>

        {/* 3 タイマー（1回目） */}
        <StepCard step={3} icon={<IconTimer />} title="タイマー（1回目）" accent="gray">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-4xl font-black tracking-widest tabular-nums">
              {timer1TimeLeft === 0 && !timer1Active ? `${Math.floor(timer1Setting / 60)}:00` : formatTime(timer1TimeLeft)}
            </div>
            <div className="flex items-center gap-2">
              {timer1TimeLeft === 0 && !timer1Active ? (
                <>
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => setTimer1Setting(Math.max(60, timer1Setting - 60))}
                  >
                    −
                  </button>
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => setTimer1Setting(timer1Setting + 60)}
                  >
                    ＋
                  </button>
                  <button
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => startTimer(1)}
                  >
                    START
                  </button>
                </>
              ) : (
                <>
                  {timer1Active ? (
                    <button className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => stopTimer(1)}>
                      STOP
                    </button>
                  ) : (
                    <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => startTimer(1)}>
                      START
                    </button>
                  )}
                  <button className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => resetTimer(1)}>
                    RESET
                  </button>
                </>
              )}
            </div>
          </div>
        </StepCard>

        {/* 4 交代案内（赤 強め） */}
        <StepCard step={4} icon={<IconMic2 />} title="交代案内" accent="blue">
          <MessageBlock
            text="両チーム 交代してください。"
            keyName="switch"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
          />
        </StepCard>

        {/* 5 タイマー（2回目） */}
        <StepCard step={5} icon={<IconTimer />} title="タイマー（2回目）" accent="gray">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-4xl font-black tracking-widest tabular-nums">
              {timer2TimeLeft === 0 && !timer2Active ? `${Math.floor(timer2Setting / 60)}:00` : formatTime(timer2TimeLeft)}
            </div>
            <div className="flex items-center gap-2">
              {timer2TimeLeft === 0 && !timer2Active ? (
                <>
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => setTimer2Setting(Math.max(60, timer2Setting - 60))}
                  >
                    −
                  </button>
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white px-3 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => setTimer2Setting(timer2Setting + 60)}
                  >
                    ＋
                  </button>
                  <button
                    className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={() => startTimer(2)}
                  >
                    START
                  </button>
                </>
              ) : (
                <>
                  {timer2Active ? (
                    <button className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => stopTimer(2)}>
                      STOP
                    </button>
                  ) : (
                    <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => startTimer(2)}>
                      START
                    </button>
                  )}
                  <button className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95" onClick={() => resetTimer(2)}>
                    RESET
                  </button>
                </>
              )}
            </div>
          </div>
        </StepCard>

        {/* 6 終了案内（赤 強め） */}
        <StepCard step={6} icon={<IconMic2 />} title="終了案内" accent="blue">
          <MessageBlock
            text="ウォーミングアップを終了してください。"
            keyName="end"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
          />
        </StepCard>

        {/* 戻るボタン（終了案内カードの下に横幅いっぱいで配置） */}
        <div className="mt-4">
          <button
            onClick={onBack}
            className="w-full py-4 rounded-2xl bg-white/90 hover:bg-white text-gray-900 font-semibold text-lg shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>

      </main>

      {/* モーダル（タイマー終了） */}
      {showEndModal1 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl text-center w-auto max-w-[90vw] text-gray-900">
            <p className="text-lg font-semibold mb-4 whitespace-nowrap">タイマー（1回目）が終了しました。</p>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 active:scale-95"
              onClick={() => setShowEndModal1(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
      {showEndModal2 && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-2xl shadow-2xl text-center w-auto max-w-[90vw] text-gray-900">
            <p className="text-lg font-semibold mb-4 whitespace-nowrap">タイマー（2回目）が終了しました。</p>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded-xl hover:bg-blue-700 active:scale-95"
              onClick={() => setShowEndModal2(false)}
            >
              OK
            </button>
          </div>
        </div>
      )}
      </div>
  );
};

export default Warmup;
