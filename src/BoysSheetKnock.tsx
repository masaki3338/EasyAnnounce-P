import React, { useEffect, useRef, useState } from "react";
import localForage from "localforage";
import { speak as ttsSpeak, stop as ttsStop } from "./lib/tts";

type Props = {
  onBack: () => void;
};

/* ====== ミニSVGアイコン ====== */
const IconGym = () => (
  <svg
    viewBox="0 0 24 24"
    className="w-6 h-6"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="4.5" r="2" />
    <path d="M4 9 L12 8 L20 9" />
    <path d="M12 8 L12 14" />
    <path d="M12 14 L7.5 19" />
    <path d="M12 14 L16.5 19" />
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

const IconMic2 = () => (
  <img
    src="/mic-red.png"
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
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z" />
  </svg>
);

/* ====== 共通カード ====== */
const StepCard: React.FC<{
  step: number;
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  accent?: "blue" | "amber" | "red" | "gray";
}> = ({ step, icon, title, children, accent = "blue" }) => {
  const accents: Record<string, string> = {
    blue: "from-sky-400/25 via-sky-400/10 to-sky-300/5 border-sky-300/60 ring-sky-300/30",
    amber: "from-amber-400/25 via-amber-400/10 to-amber-300/5 border-amber-300/60 ring-amber-300/30",
    red: "from-rose-400/25 via-rose-400/10 to-rose-300/5 border-rose-300/60 ring-rose-300/30",
    gray: "from-white/10 via-white/5 to-transparent border-white/10 ring-white/10",
  };

  return (
    <section
      className={`relative rounded-2xl p-4 shadow-lg text-left
      bg-gradient-to-br ${accents[accent]}
      border ring-1 ring-inset`}
    >
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

/* ====== 読み上げカード ====== */
const MessageBlock: React.FC<{
  text: string;
  keyName: string;
  readingKey: string | null;
  onSpeak: (t: string, k: string) => void;
  onStop: () => void;
  label?: string;
}> = ({ text, keyName, readingKey, onSpeak, onStop, label }) => (
  <div
    className="
      rounded-2xl p-4
      border border-rose-500/80
      bg-gradient-to-br from-rose-600/40 via-rose-500/35 to-rose-400/30
      ring-1 ring-inset ring-rose-500/50
      shadow-lg
    "
  >
    <div className="flex items-start gap-2 mb-2">
      <div className="flex-1">
        {label && <div className="text-[11px] text-rose-50/90 mb-1">{label}</div>}
        <p className="text-white whitespace-pre-wrap font-semibold leading-relaxed drop-shadow">
          {text}
        </p>
      </div>
    </div>

    <div className="grid grid-cols-2 gap-2 mt-2">
      <button
        className={`w-full px-4 py-2 text-white rounded-lg shadow
          ${readingKey === keyName ? "bg-green-600" : "bg-blue-600 hover:bg-blue-700"}
          active:scale-95 flex items-center justify-center gap-2`}
        onClick={() => onSpeak(text, keyName)}
      >
        <IconMic />
        <span>読み上げ</span>
      </button>

      <button
        className="w-full px-4 py-2 text-white bg-gray-600 hover:bg-gray-700 rounded-lg shadow active:scale-95 disabled:opacity-50"
        onClick={onStop}
        disabled={readingKey !== keyName}
      >
        停止
      </button>
    </div>
  </div>
);

const BoysSheetKnock: React.FC<Props> = ({ onBack }) => {
  const [teamName, setTeamName] = useState("");
  const [opponentTeamName, setOpponentTeamName] = useState("");
  const [isHome, setIsHome] = useState<"先攻" | "後攻">("先攻");
  const [timeLeft, setTimeLeft] = useState(0);
  const [timerActive, setTimerActive] = useState(false);
  const [readingKey, setReadingKey] = useState<string | null>(null);
  const [showOneMinModal, setShowOneMinModal] = useState(false);
  const [showEndModal, setShowEndModal] = useState(false);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const warned1Min = useRef(false);

  const normalizeBoysName = (name: string) => {
    const trimmed = (name || "").trim();
    if (!trimmed) return "";
    return trimmed.includes("") ? trimmed : `${trimmed}`;
  };

  const selfTeamLabel = normalizeBoysName(teamName);
  const opponentTeamLabel = normalizeBoysName(opponentTeamName);

  const playBeeps = async (
    count = 3,
    freq = 1100,
    durationSec = 0.12,
    gapSec = 0.1,
    volume = 0.18
  ) => {
    try {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      if ((ctx as any).state === "suspended" && (ctx as any).resume) {
        await (ctx as any).resume();
      }

      const now = ctx.currentTime;
      for (let i = 0; i < count; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.value = freq;

        const t0 = now + i * (durationSec + gapSec);
        gain.gain.setValueAtTime(0, t0);
        gain.gain.linearRampToValueAtTime(volume, t0 + 0.005);
        gain.gain.setValueAtTime(volume, t0 + durationSec - 0.02);
        gain.gain.linearRampToValueAtTime(0, t0 + durationSec);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(t0);
        osc.stop(t0 + durationSec + 0.02);
      }

      setTimeout(() => {
        try {
          ctx.close();
        } catch {}
      }, (count * (durationSec + gapSec) + 0.3) * 1000);
    } catch {}
  };

  useEffect(() => {
    const load = async () => {
      const team = await localForage.getItem("team");
      const matchInfo = await localForage.getItem("matchInfo");

      if (team && typeof team === "object") {
        setTeamName((team as any).name || "");
      }

      if (matchInfo && typeof matchInfo === "object") {
        const info = matchInfo as any;
        setIsHome(info.isHome === true ? "後攻" : "先攻");
        setOpponentTeamName(
          info.opponentTeamName || info.opponentTeam || info.visitorTeam || info.homeTeam || ""
        );
      }
    };
    load();
  }, []);

  const handleSpeak = async (text: string, key: string) => {
    try {
      setReadingKey(key);
      await ttsSpeak(text);
    } finally {
      setReadingKey(null);
    }
  };

  const handleStop = () => {
    ttsStop();
    setReadingKey(null);
  };

  const startTimer = () => {
    if (timeLeft === 0) setTimeLeft(300); // 5分
    setTimerActive(true);
    warned1Min.current = false;
  };

  const stopTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerActive(false);
  };

  const resetTimer = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setTimerActive(false);
    setTimeLeft(0);
    warned1Min.current = false;
  };

  useEffect(() => {
    if (timerActive && timeLeft > 0) {
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          const next = prev - 1;

          if (next === 60 && !warned1Min.current) {
            warned1Min.current = true;
            setShowOneMinModal(true);
          }

          if (next <= 0) {
            if (timerRef.current) clearInterval(timerRef.current);
            setTimerActive(false);
            setShowEndModal(true);
            return 0;
          }

          return next;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timerActive, timeLeft]);

  useEffect(() => {
    if (showOneMinModal) {
      playBeeps(3, 1200, 0.12, 0.1, 0.2);
    }
  }, [showOneMinModal]);

  useEffect(() => {
    if (showEndModal) {
      playBeeps(4, 900, 0.14, 0.09, 0.22);
    }
  }, [showEndModal]);

  const formatTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const guideMessage =
    isHome === "後攻"
      ? `${selfTeamLabel}、ノックの準備をしてください。`
      : null;

  const startMessage =
    isHome === "後攻"
      ? `${selfTeamLabel}、ノックを始めてください。\nノック時間は5分間です。`
      : `${selfTeamLabel}、ノックを始めてください。\nノック時間は同じく5分間です。`;

  const oneMinuteMessage = `${selfTeamLabel}、ノック時間、あと1分です。`;

  const endMessage = `${opponentTeamLabel}、ノックを終了してください。`;

  const hasTimingHint = isHome === "先攻";
  const stepNum = (n: number) => n + (hasTimingHint ? 1 : 0);

  return (
    <div
      className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <header className="w-full max-w-md md:max-w-none">
        <div className="flex items-center justify-between">
          <div className="w-10" />
        </div>

        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">🏏</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              シートノック
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>上から順に進行</span>
            <span className="opacity-70">／</span>
            <span>現在: {isHome === "後攻" ? "後攻チーム" : "先攻チーム"}</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md md:max-w-none mt-6 space-y-5">
        {hasTimingHint && (
          <StepCard step={1} icon={<IconAlert />} title="読み上げタイミング" accent="amber">
            <div className="text-amber-50/90 text-sm leading-relaxed">
              後攻チームのノック終了後に🎤
            </div>
          </StepCard>
        )}

        {guideMessage && (
          <StepCard step={stepNum(1)} icon={<IconGym />} title="準備の案内" accent="blue">
            <MessageBlock
              text={guideMessage}
              keyName="guide"
              readingKey={readingKey}
              onSpeak={handleSpeak}
              onStop={handleStop}
              label="（ノックの準備が出来ていない場合のみ）"
            />
          </StepCard>
        )}

        <StepCard
          step={stepNum(guideMessage ? 2 : 1)}
          icon={<IconMic2 />}
          title="本アナウンス"
          accent="blue"
        >
          <MessageBlock
            text={startMessage}
            keyName="start"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
          />
        </StepCard>

        <StepCard
          step={stepNum(guideMessage ? 3 : 2)}
          icon={<IconAlert />}
          title="スタートの注意 と 5分タイマー"
          accent="amber"
        >
          <div className="text-amber-50/90 text-sm leading-relaxed">
            アナウンスをしたらストップウォッチを開始
          </div>

          <div className="my-3 h-px bg-white/10" />

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-4xl font-black tracking-widest tabular-nums">
              ⌛{timeLeft === 0 && !timerActive ? "5:00" : formatTime(timeLeft)}
            </div>
            <div className="flex items-center gap-2">
              {timeLeft === 0 && !timerActive ? (
                <button className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95">
                  <span onClick={startTimer}>開始</span>
                </button>
              ) : (
                <>
                  {timerActive ? (
                    <button
                      className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95"
                      onClick={stopTimer}
                    >
                      STOP
                    </button>
                  ) : (
                    <button
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95"
                      onClick={startTimer}
                    >
                      START
                    </button>
                  )}
                  <button
                    className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-xl font-semibold active:scale-95"
                    onClick={resetTimer}
                  >
                    RESET
                  </button>
                </>
              )}
            </div>
          </div>
        </StepCard>

        <StepCard
          step={stepNum(guideMessage ? 4 : 3)}
          icon={<IconMic2 />}
          title="残り1分の案内"
          accent="blue"
        >
          <MessageBlock
            text={oneMinuteMessage}
            keyName="1min"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
          />
        </StepCard>

        <StepCard
          step={stepNum(guideMessage ? 5 : 4)}
          icon={<IconMic2 />}
          title="終了案内"
          accent="blue"
        >
          <MessageBlock
            text={endMessage}
            keyName="end"
            readingKey={readingKey}
            onSpeak={handleSpeak}
            onStop={handleStop}
            label="（終了していない場合のみ）"
          />
        </StepCard>

        <div className="mt-2">
          <button
            onClick={onBack}
            className="w-full py-3 rounded-xl font-semibold
                      bg-white/90 text-gray-900
                      hover:bg-white active:scale-95
                      shadow-lg border border-white/60"
          >
            ← 戻る
          </button>
        </div>
      </main>

      {showOneMinModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-[2px] flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="one-min-title"
        >
          <div
            className="
              bg-white p-8 rounded-3xl shadow-2xl text-center text-gray-900
              w-[min(92vw,560px)] sm:w-[560px]
            "
          >
            <p id="one-min-title" className="text-2xl font-bold mb-6">
              残り1分です
            </p>
            <button
              className="min-w-28 text-lg bg-blue-600 text-white px-6 py-3 rounded-2xl hover:bg-blue-700 active:scale-95 shadow"
              onClick={() => setShowOneMinModal(false)}
              autoFocus
            >
              OK
            </button>
          </div>
        </div>
      )}

      {showEndModal && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-[2px] flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="end-title"
        >
          <div
            className="
              bg-white p-8 rounded-3xl shadow-2xl text-center text-gray-900
              w-[min(92vw,560px)] sm:w-[560px]
            "
          >
            <p id="end-title" className="text-2xl font-bold mb-6">
              タイマーが終了しました
            </p>
            <button
              className="min-w-28 text-lg bg-blue-600 text-white px-6 py-3 rounded-2xl hover:bg-blue-700 active:scale-95 shadow"
              onClick={() => setShowEndModal(false)}
              autoFocus
            >
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BoysSheetKnock;