// StartTimeAnnouncement.tsx
import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

interface Props {
  onNavigate: (screen: string) => void;
  onBack?: () => void;
}

// ---- ミニSVGアイコン ----
const IconInfo: React.FC = () => (
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

function formatTimeText(value: any) {
  if (!value) return "〇時〇分";

  const s = String(value).trim();

  // そのまま「〇時〇分」形式なら返す
  if (s.includes("時")) return s;

  // 09:30 / 9:30 形式
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    return `${hh}時${mm}分`;
  }

  return s;
}

const StartTimeAnnouncement: React.FC<Props> = ({ onNavigate, onBack }) => {
  const hourList = Array.from({ length: 12 }, (_, i) => i + 1);

  const minuteList = [
    "00","05","10","15","20","25","30","35","40","45","50"
  ];

  const [startHour, setStartHour] = useState(9);
  const [startMinute, setStartMinute] = useState("00");

  const [knockHour, setKnockHour] = useState(8);
  const [knockMinute, setKnockMinute] = useState("30");
    const [reading, setReading] = useState(false);
  const [matchNumber, setMatchNumber] = useState("〇");
  const [startTimeText, setStartTimeText] = useState("〇時〇分");
  const [sheetKnockTimeText, setSheetKnockTimeText] = useState("〇時〇分");

useEffect(() => {
  const load = async () => {
    const matchInfo = await localForage.getItem<any>("matchInfo");
    if (!matchInfo) return;

    setMatchNumber(String(matchInfo.matchNumber || "〇"));

    const startRaw =
      matchInfo.startTime ??
      matchInfo.gameStartTime ??
      matchInfo.scheduledStartTime ??
      "";

    const knockRaw =
      matchInfo.sheetKnockTime ??
      matchInfo.knockTime ??
      matchInfo.scheduledSheetKnockTime ??
      "";

    const parseTime = (value: any) => {
      const s = String(value || "").trim();
      const m = s.match(/^(\d{1,2}):(\d{2})$/);
      if (!m) return null;
      return {
        hour: Number(m[1]),
        minute: m[2],
      };
    };

    const startParsed = parseTime(startRaw);
    if (startParsed) {
      setStartHour(startParsed.hour);
      setStartMinute(startParsed.minute);
    }

    const knockParsed = parseTime(knockRaw);
    if (knockParsed) {
      setKnockHour(knockParsed.hour);
      setKnockMinute(knockParsed.minute);
    }
  };

  load();
}, []);

  useEffect(() => {
    void prewarmTTS();
  }, []);

const message = `お知らせいたします。
第${matchNumber}試合は ${startHour}時${startMinute}分 開始の予定でございます。
なおシートノックは ${knockHour}時${knockMinute}分 を予定しております。
今しばらくお待ちください。`;

const messageSpeak = `おしらせいたします。だい${matchNumber}しあいは${startHour}じ${startMinute}ふん、かいしのよていでございます。なお、シートノックは${knockHour}じ${knockMinute}ふんをよていしております。いましばらくおまちください。`;
  const handleSpeak = () => {
    setReading(true);
    void ttsSpeak(messageSpeak, { progressive: true, cache: true }).finally(() =>
      setReading(false)
    );
  };

  const handleStop = () => {
    ttsStop();
    setReading(false);
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
      <header className="w-full max-w-md md:max-w-none">
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">📢</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              開始時間案内
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>シートノック前のご案内 🎤</span>
          </div>
        </div>
      </header>

      <main className="w-full max-w-md md:max-w-none mt-6 space-y-5">
        <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <IconInfo />
            </div>
            <h2 className="font-semibold">開始予定時刻設定</h2>
          </div>
          <p className="text-amber-50/90 text-sm leading-relaxed">
            開始予定時刻とシートノック予定時刻を選択してください
          </p>
        </section>

        <section className="rounded-2xl p-4 shadow-lg bg-white/10 border border-white/10 space-y-4">
          <div>
            <div className="mb-2 text-sm font-bold text-white/90">試合開始予定</div>
            <div className="flex justify-center items-center gap-2 text-xl font-bold">
              <select
                value={startHour}
                onChange={(e) => setStartHour(Number(e.target.value))}
                className="bg-white text-black px-3 py-2 rounded-lg"
              >
                {hourList.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span>時</span>
              <select
                value={startMinute}
                onChange={(e) => setStartMinute(e.target.value)}
                className="bg-white text-black px-3 py-2 rounded-lg"
              >
                {minuteList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span>分</span>
            </div>
          </div>

          <div>
            <div className="mb-2 text-sm font-bold text-white/90">シートノック予定</div>
            <div className="flex justify-center items-center gap-2 text-xl font-bold">
              <select
                value={knockHour}
                onChange={(e) => setKnockHour(Number(e.target.value))}
                className="bg-white text-black px-3 py-2 rounded-lg"
              >
                {hourList.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              <span>時</span>
              <select
                value={knockMinute}
                onChange={(e) => setKnockMinute(e.target.value)}
                className="bg-white text-black px-3 py-2 rounded-lg"
              >
                {minuteList.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <span>分</span>
            </div>
          </div>
        </section>

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
              disabled={!reading}
              className="w-full px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center"
            >
              停止
            </button>
          </div>
        </section>

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

export default StartTimeAnnouncement;