import React, { useState, useEffect, useRef } from "react";
import localForage from "localforage";
import Gather from "./Gather";
import StartGreeting from "./StartGreeting";  // 追加
import SeatIntroduction from "./SeatIntroduction";

import { DndProvider } from 'react-dnd';
import { TouchBackend } from 'react-dnd-touch-backend';
import { HTML5Backend } from 'react-dnd-html5-backend';

import { useKeepScreenAwake } from "./hooks/useKeepScreenAwake";

import { speak, stop } from "./lib/tts"; // ファイル先頭付近に追記

import ManualViewer from "./ManualViewer"; // ← 追加
const manualPdfURL = "/manual.pdf#zoom=page-fit"; // ページ全体にフィット
const boysmanualPdfURL = "/Boysmanual.pdf#view=FitH"; // ページ全体にフィット

// 各画面コンポーネントをインポート
import TeamRegister from "./TeamRegister";
import MatchCreate from "./MatchCreate";
import StartingLineup from "./StartingLineup";
import StartGame from "./StartGame";
import PreGameAnnouncement from "./pre-game-announcement";
import Warmup from "./Warmup";
//import SheetKnock from "./SheetKnock";
import SheetKnock from "./SheetKnock";
import AnnounceStartingLineup from "./AnnounceStartingLineup";
import OffenseScreen from "./OffenseScreen";
import DefenseScreen from "./DefenseScreen";
import DefenseChange from "./DefenseChange";
import OperationSettings from "./screens/OperationSettings";
import PitchLimit from "./screens/PitchLimit";
import TiebreakRule from "./screens/TiebreakRule";
import Contact from "./screens/Contact";
import TtsSettings from "./screens/TtsSettings";
import Qa from "./screens/Qa";
import Tutorial from "./screens/Tutorial";
import VersionInfo from "./screens/VersionInfo";
import AnnounceMindset from "./AnnounceMindset";
import LeagueSettings from "./screens/LeagueSettings";
import BoysPreGameAnnouncement from "./boys-pre-game-announcement";
import BoysSheetKnock from "./BoysSheetKnock";
import StartTimeAnnouncement from "./StartTimeAnnouncement";
import { getLeagueMode, type LeagueMode } from "./lib/leagueSettings";

// バージョン番号を定数で管理
const APP_VERSION = "2.05 β"

// iOS 判定を共通で使えるようにグローバル定数として定義
const isIOS = (() => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return /iP(hone|ad|od)/.test(ua) || ((/Macintosh/.test(ua)) && "ontouchend" in document);
})();

// --- Wake Lock 型(簡易) ※TSで型エラーを避けるため ---
type WakeLockSentinel = {
  released: boolean;
  release: () => Promise<void>;
  addEventListener: (type: string, listener: any) => void;
  removeEventListener: (type: string, listener: any) => void;
};



// 画面の種類を列挙した型
export type ScreenType =
  | "menu"
  | "announceMindset"
  | "teamRegister"
  | "matchCreate"
  | "startingLineup"
  | "startGame"
  | "announcement"
  | "warmup"
  | "sheetKnock"
  | "announceStartingLineup"
  | "offense"
  | "defense"
  | "defenseChange"
  | "gather"
  | "startGreeting"
  | "seatIntroduction"
  | "boysPreGameAnnouncement"
  | "boysSheetKnock"
  | "startTimeAnnouncement"
  | "operationSettings"
  | "pitchLimit"
  | "tiebreakRule"
  | "league-settings"
  | "contact"
  | "tts-settings"
  | "qa"
  | "tutorial"
  | "versionInfo";

const screenMap: { [key: string]: ScreenType } = {
  "チーム・選手登録": "teamRegister",
  "試合作成": "matchCreate",
  "試合開始": "startGame",
  "運用設定": "operationSettings",
};

// === 追加: ミニマルSVGアイコン群（外部依存なし） ===
const IconHome = ({ active=false }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? "opacity-100" : "opacity-70"}`} fill="currentColor">
    <path d="M12 3l9 8h-3v9h-5v-6H11v6H6v-9H3l9-8z"/>
  </svg>
);
const IconGame = ({ active=false }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? "opacity-100" : "opacity-70"}`} fill="currentColor">
    <path d="M7 6h10a3 3 0 013 3v6a3 3 0 01-3 3H7a3 3 0 01-3-3V9a3 3 0 013-3zm2 3a1 1 0 100 2 1 1 0 000-2zm6 0a1 1 0 100 2 1 1 0 000-2z"/>
  </svg>
);
const IconDefense = ({ active=false }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? "opacity-100" : "opacity-70"}`} fill="currentColor">
    <path d="M12 2l7 4v6c0 5-3.5 9.7-7 10-3.5-.3-7-5-7-10V6l7-4z"/>
  </svg>
);
const IconSettings = ({ active=false }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? "opacity-100" : "opacity-70"}`} fill="currentColor">
    <path d="M12 8a4 4 0 100 8 4 4 0 000-8zm9.4 4a7.5 7.5 0 00-.2-1.8l2-1.6-2-3.5-2.4 1a7.9 7.9 0 00-1.5-.9l-.4-2.6H9.2l-.4 2.6c-.5.2-1 .5-1.5.9l-2.4-1-2 3.5 2 1.6A7.5 7.5 0 003 12c0 .6.1 1.2.2 1.8l-2 1.6 2 3.5 2.4-1c.5.4 1 .7 1.5.9l.4 2.6h5.8l.4-2.6c.5-.2 1-.5 1.5-.9l2.4 1 2-3.5-2-1.6c.1-.6.2-1.2.2-1.8z"/>
  </svg>
);
const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

// === 追加: タブボタン & ボトムタブバー ===
const TabButton: React.FC<{
  label: string;
  active?: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}> = ({ label, active, onClick, icon }) => (
  <button
    onClick={onClick}
    className={`flex flex-col items-center justify-center py-2 text-xs ${
      active ? "text-blue-600 font-semibold" : "text-gray-600"
    }`}
    aria-current={active ? "page" : undefined}
  >
    <div className="mb-1">{icon}</div>
    <span className="leading-none">{label}</span>
  </button>
);

const BottomTab: React.FC<{
  current: ScreenType;
  onNavigate: (s: ScreenType) => void;
}> = ({ current, onNavigate }) => {
  const is = (s: ScreenType) => current === s;
  return (
    <nav
      className="fixed bottom-0 inset-x-0 z-40 bg-white/90 backdrop-blur border-t border-gray-200"
      style={{ paddingBottom: "max( env(safe-area-inset-bottom), 4px )" }}
    >
      <div className="grid grid-cols-4 w-full">
        <TabButton
          label="ホーム"
          active={is("menu")}
          onClick={() => onNavigate("menu")}
          icon={<IconHome active={is("menu")} />}
        />
        <TabButton
          label="試合"
          active={is("startGame")}
          onClick={() => onNavigate("startGame")}
          icon={<IconGame active={is("startGame")} />}
        />
        <TabButton
          label="守備"
          active={is("defense")}
          onClick={() => onNavigate("defense")}
          icon={<IconDefense active={is("defense")} />}
        />
        <TabButton
          label="設定"
          active={is("operationSettings")}
          onClick={() => onNavigate("operationSettings")}
          icon={<IconSettings active={is("operationSettings")} />}
        />
      </div>
    </nav>
  );
};

const App = () => {
  const [screen, setScreen] = useState<ScreenType>("menu");
  const [leagueMode, setLeagueMode] = useState<LeagueMode>("pony");
  const isBoys = leagueMode === "boys";
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showOffenseHelpModal, setShowOffenseHelpModal] = useState(false);
  const fromGameRef = useRef(false);
  const lastOffenseRef = useRef(false);
  const [showEndGamePopup, setShowEndGamePopup] = useState(false);
  const [showMenuHelpModal, setShowMenuHelpModal] = useState(false);
  const [endGameAnnouncement, setEndGameAnnouncement] = useState("");
  const [showHeatPopup, setShowHeatPopup] = useState(false);
  // 🔒 熱中症アナウンス 連打ロック
  const [heatSpeaking, setHeatSpeaking] = useState(false);
  const heatSpeakingRef = useRef(false);
  const [heatMessage] = useState("本日は気温が高く、熱中症が心配されますので、水分をこまめにとり、体調に気を付けてください。");
  const [otherOption, setOtherOption] = useState(""); // その他選択状態

  const [intentionalWalkTrigger, setIntentionalWalkTrigger] = useState(0);
  const [isContinueGame, setIsContinueGame] = useState(false);

  const [showManualPopup, setShowManualPopup] = useState(false);
  const [showContinuationModal, setShowContinuationModal] = useState(false);
  const [showSuspendPopup, setShowSuspendPopup] = useState(false);
  const [showSuspendedGamePopup, setShowSuspendedGamePopup] = useState(false);
  const [showBoysManualPopup, setShowBoysManualPopup] = useState(false);

  const [showTiebreakPopup, setShowTiebreakPopup] = useState(false);
  // ▼ タイブレーク開始後のヒントモーダル
  const [showTiebreakHint, setShowTiebreakHint] = useState(false);

  const [tiebreakMessage, setTiebreakMessage] = useState<string>("");
    // ▼ 投球数ポップアップ用
  const [showPitchListPopup, setShowPitchListPopup] = useState(false);
  const [pitchList, setPitchList] = useState<
    { name: string; number?: string; total: number }[]
  >([]);

  const [showWaterBreakPopup, setShowWaterBreakPopup] = useState(false);
  const [waterBreakMinutes, setWaterBreakMinutes] = useState<number>(3);
  const [waterBreakRemaining, setWaterBreakRemaining] = useState<number>(3 * 60);
  const [waterBreakRunning, setWaterBreakRunning] = useState(false);
  const [waterBreakAnnounced, setWaterBreakAnnounced] = useState(false);
  const [waterBreakPopupMessage, setWaterBreakPopupMessage] = useState("");
  const [showWaterBreakPopupMessage, setShowWaterBreakPopupMessage] = useState(false);
  const [waterBreakNotice, setWaterBreakNotice] = useState("");
  const [coolingPopupMessage, setCoolingPopupMessage] = useState("");
  const [showCoolingPopup, setShowCoolingPopup] = useState(false);
  const [seatIntroBackScreen, setSeatIntroBackScreen] = useState<"announcement" | "boysPreGameAnnouncement">("announcement");

  const [defenseInningStartTrigger, setDefenseInningStartTrigger] = useState(0);

  const openDefenseScreenWithSnapshot = () => {
    setDefenseInningStartTrigger((n) => n + 1);
    setScreen("defense");
  };

  const handleSeatIntroductionNavigate = (next: ScreenType) => {
  if (next === "defense") {
    // 先攻で「攻撃 → シート紹介 → 初回守備」に入るときだけ保存付きで開く
    if (fromGameRef.current && lastOffenseRef.current) {
      openDefenseScreenWithSnapshot();
    } else {
      openDefenseScreenWithoutSnapshot();
    }
    return;
  }

  setScreen(next);
};

const handleSeatIntroductionBack = () => {
  if (!fromGameRef.current) {
    setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement");
    return;
  }

  // 攻撃画面から来たなら攻撃へ戻す
  if (lastOffenseRef.current) {
    setScreen("offense");
    return;
  }

  // 守備画面から来たなら通常の守備へ戻す
  openDefenseScreenWithoutSnapshot();
};

  const openDefenseScreenWithoutSnapshot = () => {
    setScreen("defense");
  };

useEffect(() => {
  const saveLastGameScreen = async () => {
    // 「試合を継続する」で戻したい画面だけ保存
    if (screen === "offense" || screen === "defense") {
      await localForage.setItem("lastGameScreen", screen);
    }
  };

  void saveLastGameScreen();
}, [screen]);

const showCoolingNoticePopup = (message: string) => {
  setWaterBreakPopupMessage(message);
  setShowWaterBreakPopupMessage(true);

  setTimeout(() => {
    setShowWaterBreakPopupMessage(false);
  }, 3000);
};


const ponyOtherOptions: OtherOptionItem[] = [
  { value: "end", label: "試合終了" },
  { value: "tiebreak", label: "タイブレーク" },
  { value: "continue", label: "継続試合" },
  { value: "heat", label: "熱中症" },
  { value: "manual", label: "連盟🎤マニュアル" },
  { value: "pitchlist", label: "投球数⚾" },
];

const boysOtherOptions: OtherOptionItem[] = [
  { value: "intentionalWalk", label: "申告敬遠" },
  { value: "waterBreak", label: "給水タイム" },
  { value: "tiebreak", label: "タイブレーク" },
  { value: "end", label: "試合終了" },
  { value: "suspend", label: "中断" },
  { value: "suspendedGame", label: "サスペンデット" },
  { value: "boysmanual", label: "連盟🎤マニュアル" },
];

const getOtherOptions = () =>
  leagueMode === "boys" ? boysOtherOptions : ponyOtherOptions;
  // --- 試合終了アナウンスを分割して注意ボックスを差し込む ---
  const BREAKPOINT_LINE = "球審、EasyScore担当、公式記録員、球場役員もお集まりください。";
  const ann = endGameAnnouncement ?? "";
  const bpIndex = ann.indexOf(BREAKPOINT_LINE);
  const beforeText = bpIndex >= 0 ? ann.slice(0, bpIndex + BREAKPOINT_LINE.length) : ann;
  const afterText  = bpIndex >= 0 ? ann.slice(bpIndex + BREAKPOINT_LINE.length) : "";

// --- iOS用：無音1px動画を流すフォールバック ---
const [iosKeepAwake, setIosKeepAwake] = useState(false);
const iosVideoRef = useRef<HTMLVideoElement | null>(null);

// --- Screen Wake Lock（まずはこちらを使う） ---
const wakeLockRef = useRef<WakeLockSentinel | null>(null);

// App コンポーネント内のどこか（stateの定義付近）に追加
const warmedOnceRef = useRef(false);
useEffect(() => {
  setLeagueMode(getLeagueMode());
}, []);

const formatWaterBreakTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
};

const waterBreakMessage = `ただいまから${waterBreakMinutes}分間のクーリングタイムを取ります。`;

const handleWaterBreakStart = () => {
  if (waterBreakRemaining <= 0) {
    setWaterBreakRemaining(waterBreakMinutes * 60);
  }

  setWaterBreakAnnounced(false);
  setWaterBreakRunning(true);
};

const handleWaterBreakStop = () => {
  setWaterBreakRunning(false);
};

const handleWaterBreakClear = () => {
  setWaterBreakRunning(false);
  setWaterBreakRemaining(waterBreakMinutes * 60);
  setWaterBreakAnnounced(false);
};

useEffect(() => {
  if (!waterBreakRunning) return;

  const timer = window.setInterval(() => {
    setWaterBreakRemaining((prev) => {
      const next = prev - 1;

      if (waterBreakMinutes === 5 && next === 60) {
        const msg = "クーリングタイム残り1分です。";
        setWaterBreakNotice(msg);
        showCoolingNoticePopup(msg);
        speak(msg);
      }

      if (waterBreakMinutes === 10 && next === 120) {
        const msg = "クーリングタイム残り2分です。";
        setWaterBreakNotice(msg);
        showCoolingNoticePopup(msg);
        speak(msg);
      }

      if (next <= 0) {
        window.clearInterval(timer);
        setWaterBreakRunning(false);

        const msg = "クーリングタイム終了です。";
        setWaterBreakNotice(msg);
        showCoolingNoticePopup(msg);
        speak(msg);

        return 0;
      }

      return next;
    });
  }, 1000);

  return () => window.clearInterval(timer);
}, [waterBreakRunning, waterBreakMinutes]);

useEffect(() => {
  if (!waterBreakRunning && waterBreakRemaining === waterBreakMinutes * 60) {
    setWaterBreakRemaining(waterBreakMinutes * 60);
  }
}, [waterBreakMinutes]);

// マウント時に一度だけ軽いウォームアップ
useEffect(() => {
  if (warmedOnceRef.current) return; // ← dev StrictMode の二重実行ガード
  warmedOnceRef.current = true;

  fetch("/api/tts-voicevox/version", { cache: "no-store" })
    .catch(() => {});
}, []);


const acquireWakeLock = async () => {
  try {
    // iOS/Safari でも 2025現在はサポート。HTTPS & ユーザー操作直後が前提
    // @ts-ignore
    const wl = await (navigator as any).wakeLock?.request?.('screen');
    if (!wl) throw new Error('Wake Lock unsupported');
    wakeLockRef.current = wl;

    wl.addEventListener('release', () => {
      console.log('[WakeLock] released');
      wakeLockRef.current = null;
    });
    console.log('[WakeLock] acquired');
    return true;
  } catch (err) {
    console.warn('[WakeLock] request failed, fallback to silent video', err);
    return false;
  }
};



const releaseWakeLock = async () => {
  try {
    await wakeLockRef.current?.release();
  } catch {}
  wakeLockRef.current = null;
};

// タブ復帰で再取得（ユーザーがONのままなら）
useEffect(() => {
  const onVis = async () => {
    if (document.visibilityState === 'visible' && iosKeepAwake) {
      const ok = await acquireWakeLock();
      if (!ok) {
        // Wake Lock不可なら、既存の無音動画フォールバックに切替
        enableIOSAwake();
      }
    }
  };
  document.addEventListener('visibilitychange', onVis);
  return () => document.removeEventListener('visibilitychange', onVis);
}, [iosKeepAwake]);


const enableIOSAwake = () => {
  if (iosVideoRef.current) return; // 既にONなら何もしない
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("muted", "true");
  v.muted = true;
  v.loop = true;
  Object.assign(v.style, {
    position: "fixed", width: "1px", height: "1px", opacity: "0",
    pointerEvents: "none", zIndex: "-1",
  } as CSSStyleDeclaration);
  // 超小容量の無音動画
  v.src =
    "data:video/mp4;base64,AAAAIGZ0eXBtcDQyAAAAAG1wNDFtcDQyaXNvbTY4AAACAG1vb3YAAABsbXZoZAAAAAB8AAAAAHwAAAPAAACAAABAAAAAAEAAAEAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAB9tYWR0YQAAAAAAAQAAAABwZHRhAAAAAAABAAAAAABkYXRhAAAAAA==";
  document.body.appendChild(v);
  v.play()?.catch(() => {});
  iosVideoRef.current = v;
  setIosKeepAwake(true);
};

const disableIOSAwake = () => {
  try { iosVideoRef.current?.pause(); iosVideoRef.current?.remove(); } catch {}
  iosVideoRef.current = null;
  setIosKeepAwake(false);
};

// タブを裏に回したら自動解除
useEffect(() => {
  const onVis = () => {
    if (document.visibilityState !== "visible") disableIOSAwake();
  };
  document.addEventListener("visibilitychange", onVis);
  return () => document.removeEventListener("visibilitychange", onVis);
}, []);

// 🔽 守備画面へ遷移する関数をグローバル公開（DefenseChangeから呼ぶ）
useEffect(() => {
  (window as any).__app_go_defense = () => openDefenseScreenWithoutSnapshot();
  return () => { delete (window as any).__app_go_defense; };
}, []);

// 熱中症：読み上げ（連打ガード＋完了/停止で解除）
const handleHeatSpeak = async () => {
  if (heatSpeakingRef.current) return; // すでに再生中なら無視
  heatSpeakingRef.current = true;
  setHeatSpeaking(true);
  try {
    await speak(heatMessage); // progressiveにしたいなら { progressive:true } を第2引数に
  } finally {
    heatSpeakingRef.current = false;
    setHeatSpeaking(false);
  }
};

// 熱中症：停止（即解除）
const handleHeatStop = () => {
  try { stop(); } finally {
    heatSpeakingRef.current = false;
    setHeatSpeaking(false);
  }
};

const handleBoysOnlyMenu = async (value: string) => {
  if (value === "intentionalWalk") {
    alert("申告敬遠はこれから実装します");
    return true;
  }
  if (value === "waterBreak") {
    alert("給水タイムはこれから実装します");
    return true;
  }
  if (value === "suspend") {
    alert("中断はこれから実装します");
    return true;
  }
  if (value === "suspendedGame") {
    alert("サスペンデットはこれから実装します");
    return true;
  }
  if (value === "boysmanual") {
    setShowBoysManualPopup(true);
  }
  return false;
};



const handleSpeak = async () => {  
  const txt =
      "この試合は、ただ今で打ち切り、継続試合となります。\n" +
      "明日以降に中断した時点から再開いたします。\n" +
      "あしからずご了承くださいませ。";
    await speak(txt);
  };
  const handleStop = () => {
    stop();
  };

  const buildBoysEndGameAnnouncement = async (
    totalMyScore: number,
    totalOpponentScore: number,
    myTeam: string,
    formatted: string
  ) => {
    const teamData = (await localForage.getItem("team")) as
      | { name?: string; players?: any[] }
      | null;

    const players = Array.isArray(teamData?.players) ? teamData.players : [];

    const pitcherTotals =
      ((await localForage.getItem("pitcherTotals")) as Record<number, number>) || {};

    const pitcherOrder =
      (((await localForage.getItem("pitcherOrder")) as number[]) || []).map(Number);

    // 最後に投げた投手を優先
    const lastPitcherId =
      [...pitcherOrder].reverse().find((id) => Number.isFinite(Number(id))) ??
      Object.keys(pitcherTotals).map(Number).find((id) => Number.isFinite(id));

    const pitcher = players.find((p) => Number(p?.id) === Number(lastPitcherId));
    const pitcherName = pitcher?.lastName || "当該";
    const pitcherTotal =
      lastPitcherId != null ? Number(pitcherTotals[lastPitcherId] ?? 0) : 0;

    return (
      `ご覧のように${totalMyScore}対${totalOpponentScore}で${myTeam}が勝ちました。\n` +
      `${pitcherName}投手の合計投球数は${pitcherTotal}球です。\n` +
      `なおこの試合の終了時刻は${formatted}です。`
    );
  };

  const toGameRead = (n: number) => {
  const map: Record<number, string> = {
    1: "だいいちしあい",
    2: "だいにしあい",
    3: "だいさんしあい",
    4: "だいよんしあい",
    5: "だいごしあい",
  };
  return map[n] ?? `だい${n}しあい`;
};

  useKeepScreenAwake();




  return (
    <>
      {screen === "menu" && (
        <Menu
          onNavigate={setScreen}
          leagueMode={leagueMode}
          iosKeepAwake={iosKeepAwake}
          onEnableIOSAwake={async () => {
            const ok = await acquireWakeLock();
            if (!ok) {
              enableIOSAwake();
            }
            setIosKeepAwake(true);
          }}
          onDisableIOSAwake={async () => {
            await releaseWakeLock().catch(() => {});
            disableIOSAwake();
            setIosKeepAwake(false);
          }}
          onContinueGame={(nextScreen) => {
            setIsContinueGame(true);
            setScreen(nextScreen);
          }}
        />
      )}

      {screen === "announceMindset" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("menu")}
          >
            メニュー
          </button>
          <AnnounceMindset />
        </>
      )}

      {screen === "teamRegister" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("menu")}
          >
            ← メニューに戻る
          </button>
          <TeamRegister />
        </>
      )}

      {screen === "matchCreate" && (
      <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("menu")}
          >
            ← メニューに戻る
          </button>
          <MatchCreate
          onBack={() => setScreen("menu")}
          onGoToLineup={() => setScreen("startingLineup")}
          />
        </>
      )}

      {screen === "startingLineup" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("matchCreate")}
          >
            ← 試合情報に戻る
          </button>
          <StartingLineup />
        </>
      )}

      {screen === "startGame" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("menu")}
          >
            ← メニューに戻る
          </button>
            <StartGame
                onStart={async () => {
                  setIsContinueGame(false);
                  await localForage.removeItem("lastBatterIndex");
                
                const match = await localForage.getItem("matchInfo");
                if (match && typeof match === "object" && "isHome" in match) {
                  const { isHome } = match as { isHome: boolean };

                  const isTop = true;
                  const isOffense = isHome === false;

                  await localForage.setItem("matchInfo", {
                    ...(match as any),
                    inning: 1,
                    isTop: true,
                    isDefense: !isOffense,
                  });

                  if (isOffense) {
                    setScreen("offense");
                  } else {
                    openDefenseScreenWithSnapshot();
                  }
                } else {
                  alert("試合情報が見つかりません。試合作成画面で設定してください。");
                }
              }}
              onShowAnnouncement={() => setScreen("announcement")}
            />
        </>
      )}

      {screen === "announcement" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("startGame")}
          >
            ← 試合開始画面に戻る
          </button>

          {leagueMode === "boys" ? (
            <BoysPreGameAnnouncement
              onNavigate={async (next) => {
                if (next === "seatIntroduction") {
                  fromGameRef.current = false;
                  lastOffenseRef.current = false;
                }
                setScreen(next);
              }}
              onBack={() => setScreen("startGame")}
            />
          ) : (
            <PreGameAnnouncement
              onNavigate={async (next) => {
                // ★ 試合前アナウンス→シート紹介のときは“試合中からではない”扱いにする
                if (next === "seatIntroduction") {
                  fromGameRef.current = false;
                  lastOffenseRef.current = false;
                }
                setScreen(next);
              }}
              onBack={() => setScreen("startGame")}
            />
          )}
        </>
      )}

      {screen === "boysPreGameAnnouncement" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("startGame")}
          >
            ← 試合開始画面に戻る
          </button>
          <BoysPreGameAnnouncement
            onNavigate={async (next) => {
              if (next === "seatIntroduction") {
                fromGameRef.current = false;
                lastOffenseRef.current = false;
              }
              setScreen(next);
            }}
            onBack={() => setScreen("startGame")}
          />
        </>
      )}

      {screen === "warmup" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
          >
            ← 試合前アナウンスメニューに戻る
          </button>
          {screen === "warmup" && (
          <Warmup onBack={() => setScreen("announcement")} />
        )}
        </>
      )}

      {screen === "sheetKnock" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
          >
            ← 試合前アナウンスメニューに戻る
          </button>
          <SheetKnock onBack={() => setScreen("announcement")} />
        </>
      )}

      {screen === "startTimeAnnouncement" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("boysPreGameAnnouncement")}
          >
            ← 試合前アナウンス画面に戻る
          </button>
          <StartTimeAnnouncement
            onNavigate={setScreen}
            onBack={() => setScreen("boysPreGameAnnouncement")}
          />
        </>
      )}

      {screen === "boysSheetKnock" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen("boysPreGameAnnouncement")}
          >
            ← 試合前アナウンス画面に戻る
          </button>
          <BoysSheetKnock
            onNavigate={setScreen}
            onBack={() => setScreen("boysPreGameAnnouncement")}
          />
        </>
      )}

      {screen === "announceStartingLineup" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
          >
            ← 試合前アナウンスメニューに戻る
          </button>
          <AnnounceStartingLineup
            onNavigate={setScreen}
            leagueMode={leagueMode}
          />
        </>
      )}

      {screen === "gather" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
          >
            ← 試合前アナウンスメニューに戻る
          </button>
         <Gather onNavigate={setScreen} />  
        </>
      )}

      {screen === "startGreeting" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
          >
            ← 試合前アナウンスメニューに戻る
          </button>
          <StartGreeting
            onBack={() => setScreen(isBoys ? "boysPreGameAnnouncement" : "announcement")}
            onNavigate={setScreen}
            leagueMode={leagueMode}
          />
        </>
      )}

      {screen === "seatIntroduction" && (
        <>
          <button
            className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
            onClick={handleSeatIntroductionBack}
          >
            ← {fromGameRef.current ? "試合に戻る" : "試合前アナウンスメニューに戻る"}
          </button>

          <SeatIntroduction
            onNavigate={handleSeatIntroductionNavigate}
            onBack={handleSeatIntroductionBack}
            leagueMode={leagueMode}
          />
        </>
      )}


      {screen === "offense" && (
        <>
<div className="m-4 flex justify-between items-center gap-2">
  {/* 左側：メニューに戻る＋？ */}
  <div className="flex items-center gap-1 min-w-0">
    <button
      className="px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition whitespace-nowrap"
      onClick={() => setScreen("menu")}
    >
      メニュー
    </button>

    <button
      type="button"
      onClick={() => setShowOffenseHelpModal(true)}
      aria-label="攻撃画面の使い方"
      className="
        w-10 h-10
        rounded-full
        bg-sky-600 hover:bg-sky-700
        text-white font-bold text-lg
        shadow-md
        flex items-center justify-center
        shrink-0
      "
    >
      ？
    </button>
  </div>

  {/* 右側：その他 */}
  <select      
    className="px-2 py-2 rounded-full bg-gray-100 text-gray-800 shadow-sm border border-gray-300 text-sm"
    value={otherOption}
    onChange={async (e) => {
    const value = e.target.value;

    if (value === "end") {
      console.group("[END] その他→試合終了");
      const now = new Date();
      const formatted = `${now.getHours()}時${now.getMinutes()}分`;
      //setEndTime(formatted);

      const team = (await localForage.getItem("team")) as { name?: string } | null;
      const match = (await localForage.getItem("matchInfo")) as any;
      const noNextGame = Boolean(match?.noNextGame);
      console.log("matchInfo (RAW) =", match);

      const stash = await localForage.getItem("matchNumberStash");
      if (match && match.matchNumber == null && Number(stash) >= 1) {
        await localForage.setItem("matchInfo", { ...match, matchNumber: Number(stash) });
        console.log("🩹 repaired matchInfo at mount with matchNumber =", stash);
      }

      type Scores = { [inning: string]: { top?: number; bottom?: number } };
      const scores = ((await localForage.getItem("scores")) as Scores) || {};
      console.log("scores (RAW) =", scores);

      const isHome: boolean = !!(match?.isHome ?? true);
      console.log("isHome =", isHome);

      const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

      const totalMyScore = Object.values(scores).reduce((sum, s) => {
        const val = isHome ? (s?.bottom ?? 0) : (s?.top ?? 0);
        return sum + toNum(val);
      }, 0);

      const totalOpponentScore = Object.values(scores).reduce((sum, s) => {
        const val = isHome ? (s?.top ?? 0) : (s?.bottom ?? 0);
        return sum + toNum(val);
      }, 0);

      const myTeam = team?.name ?? "自チーム";

      let rawMatchNumber = match?.matchNumber;
      if (rawMatchNumber == null) {
        const stash = await localForage.getItem("matchNumberStash");
        if (Number(stash) >= 1) {
          rawMatchNumber = Number(stash);
          const repaired = { ...(match || {}), matchNumber: rawMatchNumber };
          await localForage.setItem("matchInfo", repaired);
        }
      }

      const parsed = Number(rawMatchNumber);
      const currentGame = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
      const nextGame = currentGame + 1;

if (totalMyScore > totalOpponentScore) {

  let announcement = "";
  const currentLeagueMode = getLeagueMode();

  if (currentLeagueMode === "boys") {
    // ボーイズ用
    const endGamePitcherInfo = (await localForage.getItem("endGamePitcherInfo")) as
      | { pitcherId?: number; pitcherName?: string; totalPitchCount?: number }
      | null;

    const pitcherName = endGamePitcherInfo?.pitcherName || "";
    const pitcherTotal = Number(endGamePitcherInfo?.totalPitchCount ?? 0);

    announcement =
      `ご覧のように${totalMyScore}対${totalOpponentScore}で${myTeam}が勝ちました。\n` +
      `${pitcherName}投手の合計投球数は${pitcherTotal}球です。\n` +
      `なおこの試合の終了時刻は${formatted}です。`;

  } else {

    // ポニー用
    announcement =
      `ただいまの試合は、ご覧のように${totalMyScore}対${totalOpponentScore}で${myTeam}が勝ちました。\n` +
      `審判員の皆様、ありがとうございました。\n` +
      `健闘しました両チームの選手に、盛大な拍手をお願いいたします。\n` +
      `尚、この試合の終了時刻は ${formatted}です。\n` +
      `これより、ピッチングレコードの確認を行います。\n` +
      `両チームの監督、キャプテンはピッチングレコードを記載の上、バックネット前にお集まりください。\n` +
      `球審、EasyScore担当、公式記録員、球場役員もお集まりください。\n`;

    if (!noNextGame) {
      announcement +=
        `第${nextGame}試合のグランド整備は、第${nextGame}試合のシートノック終了後に行います。\n` +
        `第${currentGame}試合の選手は、グランド整備ご協力をよろしくお願いいたします。`;
    }

  }

  setEndGameAnnouncement(announcement);
  setShowEndGamePopup(true);

} else {
  alert("試合終了しました");
}

      console.groupEnd();

    } else if (value === "tiebreak") {
      const cfg = (await localForage.getItem("tiebreakConfig")) as
        | { outs?: string; bases?: string }
        | null;
      const outs = cfg?.outs ?? "ワンナウト";
      const bases = cfg?.bases ?? "2,3塁";

      type Scores = { [inning: string]: { top?: number; bottom?: number } };
      const match = (await localForage.getItem("matchInfo")) as any;
      const scores = ((await localForage.getItem("scores")) as Scores) || {};

      let inning = Number(match?.inning);
      if (!Number.isFinite(inning) || inning < 1) {
        const keys = Object.keys(scores)
          .map((k) => Number(k))
          .filter((n) => Number.isFinite(n) && n >= 1);
        inning = keys.length > 0 ? Math.max(...keys) : 1;
      }

      const prevInning = Math.max(1, inning - 1);

      const msg =
        leagueMode === "boys"
          ? `ただいまより大会規定により、タイブレークをおこないます。\nタイブレークは${outs}${bases}の状態からおこないます。`
          : `この試合は、${prevInning}回終了して同点のため、大会規定により${outs}${bases}からのタイブレークに入ります。`;

      setTiebreakMessage(msg);
      setShowTiebreakPopup(true);

    } else if (value === "continue") {
      setShowContinuationModal(true);

    } else if (value === "heat") {
      setShowHeatPopup(true);

    } else if (value === "manual") {
      setShowManualPopup(true);

    } else if (value === "pitchlist") {
      const team = (await localForage.getItem("team")) as
        | { players?: any[] }
        | null;
      const totals =
        ((await localForage.getItem("pitcherTotals")) as Record<number, number>) ||
        {};
      const players = Array.isArray(team?.players) ? team!.players : [];

      const order =
        ((await localForage.getItem<number[]>("pitcherOrder")) || []).slice();

      const rowsMap = new Map<number, { name: string; number?: string; total: number }>();
      for (const [idStr, total] of Object.entries(totals)) {
        const tot = Number(total) || 0;
        if (tot <= 0) continue;
        const id = Number(idStr);
        const p = players.find((x) => x?.id === id);
        const name = (p?.lastName ?? "") + (p?.firstName ?? "") || `ID:${id}`;
        const number = p?.number ? `#${p.number}` : undefined;
        rowsMap.set(id, { name, number, total: tot });
      }

      const rows: { name: string; number?: string; total: number }[] = [];
      for (const id of order) {
        const r = rowsMap.get(id);
        if (r) {
          rows.push(r);
          rowsMap.delete(id);
        }
      }

      for (const r of rowsMap.values()) {
        rows.push(r);
      }

      setPitchList(rows);
      setShowPitchListPopup(true);

    } else if (value === "intentionalWalk") {
      setIntentionalWalkTrigger((n) => n + 1);

    } else if (value === "waterBreak") {
      setWaterBreakRunning(false);
      setWaterBreakRemaining(waterBreakMinutes * 60);
      setShowWaterBreakPopup(true);

    } else if (value === "suspend") {
      setShowSuspendPopup(true);

    } else if (value === "cancelGame") {
      setShowCancelGamePopup(true);

    } else if (value === "suspendedGame") {
      setShowSuspendedGamePopup(true);

    } else if (value === "boysmanual") {
      setShowBoysManualPopup(true);
    }

    setOtherOption("");
  }}
>
  <option value="" disabled hidden>
    その他
  </option>

  {isBoys ? (
    <>
      <option value="intentionalWalk">申告敬遠</option>
      <option value="waterBreak">給水タイム</option>
      <option value="tiebreak">タイブレーク</option>
      <option value="end">試合終了</option>
      <option value="suspend">中断</option>
      <option value="suspendedGame">サスペンデット</option>
      <option value="boysmanual">連盟🎤マニュアル</option>
    </>
  ) : (
    <>
      <option value="end">試合終了</option>
      <option value="tiebreak">タイブレーク</option>
      <option value="continue">継続試合</option>
      <option value="heat">熱中症</option>
      <option value="manual">連盟🎤マニュアル</option>
      <option value="pitchlist">投球数⚾</option>
    </>
  )}
</select>
    </div>
      <OffenseScreen
        onSwitchToDefense={async () => {
          const match =
            (await localForage.getItem("matchInfo")) as
              | { inning?: number; isTop?: boolean; isDefense?: boolean; isHome?: boolean }
              | null;

          const battingOrder =
            (await localForage.getItem("battingOrder")) as
              | { id: number; reason?: string }[]
              | null;

          const usedPlayerInfo =
            (await localForage.getItem("usedPlayerInfo")) as
              | Record<string, any>
              | null;

          const inning = Number(match?.inning ?? 1);
          const isTop = typeof match?.isTop === "boolean" ? match.isTop : true;
          const isVisitor = match?.isHome === false;

          const hasPinchInBattingOrder =
            Array.isArray(battingOrder) &&
            battingOrder.some(
              (e) =>
                e?.reason === "代打" ||
                e?.reason === "代走" ||
                e?.reason === "臨時代走"
            );

          const hasPinchInUsedInfo =
            !!usedPlayerInfo &&
            Object.values(usedPlayerInfo).some(
              (info: any) =>
                info?.reason === "代打" ||
                info?.reason === "代走" ||
                info?.reason === "臨時代走"
            );

          const shouldGoSeatIntroduction =
            isVisitor &&
            inning === 1 &&
            isTop &&
            (hasPinchInBattingOrder || hasPinchInUsedInfo);

          await localForage.setItem("matchInfo", {
            ...(match || {}),
            inning,
            isTop,
            isDefense: true,
          });

          if (shouldGoSeatIntroduction) {
            fromGameRef.current = true;
            lastOffenseRef.current = true;
            setScreen("seatIntroduction");
            return;
          }

          openDefenseScreenWithSnapshot();
        }}
        onGoToSeatIntroduction={() => {
          fromGameRef.current = true;
          lastOffenseRef.current = true;
          setScreen("seatIntroduction");
        }}
        openIntentionalWalkTrigger={intentionalWalkTrigger}
        isContinueGame={isContinueGame}
      />
        </>
      )}

{screen === "defense" && (        
  <>
    <div className="m-4 flex justify-between items-center">
      {/* 左側ボタン群 */}
      <div className="flex items-center gap-1">
        <button
          className="px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
          onClick={() => setScreen("menu")}
        >
          メニュー
        </button>

        <button
          className="px-4 py-2 bg-purple-600 text-white rounded-full shadow-sm hover:bg-purple-700 transition whitespace-nowrap"
          onClick={() => {
            window.dispatchEvent(new Event("restore-defense-inning-start"));
          }}
        >
          戻す
        </button>

        <button
          type="button"
          onClick={() => setShowHelpModal(true)}
          aria-label="守備画面の使い方"
          className="
            w-10 h-10
            rounded-full
            bg-sky-600 hover:bg-sky-700
            text-white font-bold text-lg
            shadow-md
            flex items-center justify-center
            shrink-0
          "
        >
          ？
        </button>
      </div>

      {/* 右端のドロップダウン */}
      <select      
        className="px-2 py-2 rounded-full bg-gray-100 text-gray-800 shadow-sm border border-gray-300 text-sm"
        value={otherOption}
        onChange={async (e) => {
          const value = e.target.value;

          if (value === "end") {
            console.group("[END] その他→試合終了");
            const now = new Date();
            const formatted = `${now.getHours()}時${now.getMinutes()}分`;
            //setEndTime(formatted);

            const team = (await localForage.getItem("team")) as { name?: string } | null;
            const match = (await localForage.getItem("matchInfo")) as any;
            const noNextGame = Boolean(match?.noNextGame);
            console.log("matchInfo (RAW) =", match);

            const stash = await localForage.getItem("matchNumberStash");
            if (match && match.matchNumber == null && Number(stash) >= 1) {
              await localForage.setItem("matchInfo", { ...match, matchNumber: Number(stash) });
              console.log("🩹 repaired matchInfo at mount with matchNumber =", stash);
            }

            type Scores = { [inning: string]: { top?: number; bottom?: number } };
            const scores = ((await localForage.getItem("scores")) as Scores) || {};
            console.log("scores (RAW) =", scores);

            const isHome: boolean = !!(match?.isHome ?? true);
            console.log("isHome =", isHome);

            const toNum = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);

            const totalMyScore = Object.values(scores).reduce((sum, s) => {
              const val = isHome ? (s?.bottom ?? 0) : (s?.top ?? 0);
              return sum + toNum(val);
            }, 0);

            const totalOpponentScore = Object.values(scores).reduce((sum, s) => {
              const val = isHome ? (s?.top ?? 0) : (s?.bottom ?? 0);
              return sum + toNum(val);
            }, 0);

            const myTeam = team?.name ?? "自チーム";

            let rawMatchNumber = match?.matchNumber;
            if (rawMatchNumber == null) {
              const stash = await localForage.getItem("matchNumberStash");
              if (Number(stash) >= 1) {
                rawMatchNumber = Number(stash);
                const repaired = { ...(match || {}), matchNumber: rawMatchNumber };
                await localForage.setItem("matchInfo", repaired);
              }
            }

            const parsed = Number(rawMatchNumber);
            const currentGame = Number.isFinite(parsed) && parsed >= 1 ? parsed : 1;
            const nextGame = currentGame + 1;

            if (totalMyScore > totalOpponentScore) {
              let announcement = "";
              const currentLeagueMode = getLeagueMode();

              if (currentLeagueMode === "boys") {
                // ボーイズ用
                const endGamePitcherInfo = (await localForage.getItem("endGamePitcherInfo")) as
                  | { pitcherId?: number; pitcherName?: string; totalPitchCount?: number }
                  | null;

                const pitcherName = endGamePitcherInfo?.pitcherName || "";
                const pitcherTotal = Number(endGamePitcherInfo?.totalPitchCount ?? 0);

                announcement =
                  `ご覧のように${totalMyScore}対${totalOpponentScore}で${myTeam}が勝ちました。\n` +
                  `${pitcherName}投手の合計投球数は${pitcherTotal}球です。\n` +
                  `なおこの試合の終了時刻は${formatted}です。`;

              } else {
                // ポニー用
                announcement =
                  `ただいまの試合は、ご覧のように${totalMyScore}対${totalOpponentScore}で${myTeam}が勝ちました。\n` +
                  `審判員の皆様、ありがとうございました。\n` +
                  `健闘しました両チームの選手に、盛大な拍手をお願いいたします。\n` +
                  `尚、この試合の終了時刻は ${formatted}です。\n` +
                  `これより、ピッチングレコードの確認を行います。\n` +
                  `両チームの監督、キャプテンはピッチングレコードを記載の上、バックネット前にお集まりください。\n` +
                  `球審、EasyScore担当、公式記録員、球場役員もお集まりください。\n`;

                if (!noNextGame) {
                  announcement +=
                    `第${nextGame}試合のグランド整備は、第${nextGame}試合のシートノック終了後に行います。\n` +
                    `第${currentGame}試合の選手は、グランド整備ご協力をよろしくお願いいたします。`;
                }
              }

              setEndGameAnnouncement(announcement);
              setShowEndGamePopup(true);

            } else {
              alert("試合終了しました");
            }

            console.groupEnd();
          } else if (value === "continue") {
            setShowContinuationModal(true);

          } else if (value === "heat") {
            setShowHeatPopup(true);

          } else if (value === "manual") {
            setShowManualPopup(true);

          } else if (value === "pitchlist") {
            type PitchRow = { playerId: number; name: string; total: number };

            const totals =
              (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};

            const team =
              (await localForage.getItem<{ players?: any[] }>("team")) || {};

            const players = Array.isArray(team.players) ? team.players : [];
            const playerMap = new Map<number, any>(
              players
                .filter((p: any) => typeof p?.id === "number")
                .map((p: any) => [Number(p.id), p])
            );

            const nameOf = (p: any) => {
              const last = String(p?.lastName ?? "").trim();
              const first = String(p?.firstName ?? "").trim();
              const full = String(p?.name ?? "").trim();
              return full || [last, first].filter(Boolean).join(" ") || `#${p?.id ?? ""}`;
            };

            const rowsMap = new Map<number, PitchRow>();
            Object.entries(totals).forEach(([idStr, total]) => {
              const id = Number(idStr);
              if (!Number.isFinite(id)) return;
              const p = playerMap.get(id);
              rowsMap.set(id, {
                playerId: id,
                name: p ? nameOf(p) : `#${id}`,
                total: Number(total) || 0,
              });
            });

            const currentPitch =
              (await localForage.getItem<{ pitcherId?: number; total?: number }>("pitchCounts")) || {};

            const currentPitcherId = Number(currentPitch?.pitcherId);
            const currentTotal = Number(currentPitch?.total ?? 0);

            if (Number.isFinite(currentPitcherId)) {
              const p = playerMap.get(currentPitcherId);
              rowsMap.set(currentPitcherId, {
                playerId: currentPitcherId,
                name: p ? nameOf(p) : `#${currentPitcherId}`,
                total: currentTotal,
              });
            }

            const order =
              ((await localForage.getItem<number[]>("pitcherOrder")) || []).slice();

            const rows: { playerId: number; name: string; total: number }[] = [];
            for (const id of order) {
              const r = rowsMap.get(id);
              if (r) {
                rows.push(r);
                rowsMap.delete(id);
              }
            }

            for (const r of rowsMap.values()) {
              rows.push(r);
            }

            setPitchList(rows);
            setShowPitchListPopup(true);

          } else if (value === "waterBreak") {
            setWaterBreakRunning(false);
            setWaterBreakRemaining(waterBreakMinutes * 60);
            setShowWaterBreakPopup(true);

          } else if (value === "suspend") {
            setShowSuspendPopup(true);

          } else if (value === "cancelGame") {
            setShowCancelGamePopup(true);

          } else if (value === "suspendedGame") {
            setShowSuspendedGamePopup(true);

          } else if (value === "boysmanual") {
            setShowBoysManualPopup(true);
          }

          setOtherOption("");
        }}
      >
        <option value="" disabled hidden>
          その他
        </option>

        {isBoys ? (
          <>
            <option value="waterBreak">給水タイム</option>
            <option value="end">試合終了</option>
            <option value="suspend">中断</option>
            <option value="suspendedGame">サスペンデット</option>
            <option value="boysmanual">連盟🎤マニュアル</option> 
          </>
        ) : (
          <>
            <option value="end">試合終了</option>
            <option value="continue">継続試合</option>
            <option value="heat">熱中症</option> 
            <option value="manual">連盟🎤マニュアル</option> 
            <option value="pitchlist">投球数⚾</option>
          </>
        )}
      </select>
    </div>


    <DefenseScreen
      key="defense"
      onChangeDefense={() => setScreen("defenseChange")}
      onSwitchToOffense={() => setScreen("offense")}
      saveInningStartTrigger={defenseInningStartTrigger}
    />
  </>
)}


{screen === "defenseChange" && (
  <DefenseChange
    onBack={() => setScreen("defense")}
    onConfirmed={(opts?: { goSeatIntroduction?: boolean }) => {
      if (opts?.goSeatIntroduction) {
        console.log("✅ 1回先攻・代打あり：シート紹介画面へ遷移します");
        fromGameRef.current = true;
        lastOffenseRef.current = false; // 守備交代画面から来た
        setScreen("seatIntroduction");
      } else {
        console.log("✅ 通常の守備交代：守備画面へ戻ります");
        if (typeof openDefenseScreenWithoutSnapshot === "function") {
          openDefenseScreenWithoutSnapshot();
        } else {
          setScreen("defense");
        }
      }
    }}
  />
)}

{screen === "operationSettings" && (
  <>
    <button
      className="m-4 px-4 py-2 bg-gray-200 rounded-full shadow-sm hover:bg-gray-300 transition"
      onClick={() => setScreen("menu")}
    >
      ← メニューに戻る
    </button>
    <OperationSettings
      onNavigate={setScreen}
      onOpenManual={() => setShowManualPopup(true)} // ← 追加：ManualViewerを開く
    />
        </>
)}


{screen === "pitchLimit" && (
  <PitchLimit onBack={() => setScreen("operationSettings")} />
)}

{screen === "tiebreakRule" && (
  <TiebreakRule onBack={() => setScreen("operationSettings")} />
)}

{screen === "tts-settings" && (
  <TtsSettings onBack={() => setScreen("operationSettings")} />
)}

{screen === "league-settings" && (
  <LeagueSettings
    onNavigate={(next) => {
      setLeagueMode(getLeagueMode());
      setScreen(next);
    }}
  />
)}

{screen === "tutorial" && (
  <Tutorial onBack={() => setScreen("operationSettings")} />
)}

{screen === "qa" && (
  <Qa onBack={() => setScreen("operationSettings")} />
)}

{screen === "contact" && (
  <Contact onBack={() => setScreen("operationSettings")} version={APP_VERSION} />
)}

{screen === "versionInfo" && (
  <VersionInfo version={APP_VERSION} onBack={() => setScreen("operationSettings")} />
)}

{/* 試合終了画面（スマホ風） */}
{showEndGamePopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="試合終了">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>試合終了</span>
            </h2>
            <div className="w-9 h-9" />
          </div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* 注意表示 */}
          <div className="bg-yellow-100 text-yellow-800 border-l-4 border-yellow-500 px-4 py-2 text-sm font-semibold flex items-center gap-2">
            <span className="text-2xl">⚠️</span>
            勝利チームがアナウンス
          </div>

          {/* 🔴 アナウンス文言エリア（ここに読み上げ／停止ボタンを内包） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
            </div>

            {/* 文言（改行保持） */}
            <div className="text-left text-red-700 font-bold whitespace-pre-wrap leading-relaxed max-h-[40vh] overflow-y-auto pr-2">
              {endGameAnnouncement}
            </div>

            {/* 読み上げ／停止（横いっぱい・等幅、アイコン右に文言で改行なし） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(endGameAnnouncement);
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>
              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター（OK） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowEndGamePopup(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}



 {/* 熱中症画面*/}
{showHeatPopup && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ（タップで閉じる） */}
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onClick={() => setShowHeatPopup(false)}
    />

    {/* 画面中央カード（スマホ風） */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl rounded-2xl
          w-full max-w-md max-h-[80vh]
          overflow-hidden flex flex-col
        "
        role="dialog"
        aria-modal="true"
        aria-label="熱中症"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー（グラデ＋ハンドル） */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>熱中症</span>
            </h2>
            <button
              onClick={() => setShowHeatPopup(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                         bg-white/15 hover:bg-white/25 active:bg-white/30
                         text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* 🔴 アナウンス文言エリア（ここに読み上げ/停止ボタンを内包） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">

            </div>

            {/* 文言 */}
            <p className="text-red-700 font-bold whitespace-pre-wrap">
              {heatMessage}
            </p>

            {/* 読み上げ／停止（横いっぱい・等幅、改行なし） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={handleHeatSpeak}
                disabled={heatSpeakingRef.current || heatSpeaking}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                
                <span className="inline-flex items-center gap-2 whitespace-nowrap leading-none align-middle">
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </span>
              </button>
              <button
                onClick={handleHeatStop}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowHeatPopup(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* タイブレーク画面 */}
{showTiebreakPopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="タイブレーク開始">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>タイブレーク開始</span>
            </h2>
            <div className="w-9 h-9" />
          </div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* 🔴 アナウンス文言エリア（ここに読み上げ/停止ボタンを内包） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span className="text-sm font-semibold text-red-700">アナウンス</span>
            </div>

            {/* 文言（改行保持） */}
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              {tiebreakMessage}
            </p>

            {/* 読み上げ／停止（横いっぱい・等幅、改行なしテキスト） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    tiebreakMessage.replace(/入ります。/g, "はいります。")
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                {/* アイコン右に文言／改行しない */}
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap leading-none">読み上げ</span>
              </button>

              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター（開始 / 終了） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            {/* 開始：フラグON → モーダル閉じる → ヒント表示 */}
            <button
              onClick={async () => {
                await localForage.setItem("tiebreak:enabled", true);
                setShowTiebreakPopup(false);
                setShowTiebreakHint(true); // ← これが確実に走るように
              }}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold active:scale-[0.99] transition"
            >
              開始
            </button>
            {/* 終了：フラグOFF → モーダル閉じる */}
            <button
              onClick={async () => {
                await localForage.setItem("tiebreak:enabled", false);
                setShowTiebreakPopup(false);
              }}
              className="w-full bg-gray-600 hover:bg-gray-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold active:scale-[0.99] transition"
            >
              終了
            </button>
          </div>

          {/* Safe-Area 対応の下余白は維持 */}
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>

      </div>
    </div>
  </div>
)}
{/* ✅ タイブレーク開始後ヒント（OKのみ） */}
{showTiebreakHint && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="タイブレークの使い方">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー（スマホ風グラデ&ハンドル） */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide">タイブレーク</h2>
            <div className="w-9 h-9" />
          </div>
        </div>

        {/* 本文 */}
        <div className="px-4 py-6 overflow-y-auto">
          <p className="text-gray-800 font-bold leading-relaxed text-center">
            打者を選択すると、タイブレイク用アナウンス文が表示されます
          </p>
        </div>

        {/* フッター（OKのみ） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowTiebreakHint(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* ✅　継続試合画面モーダル */}
{showContinuationModal && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="継続試合">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>継続試合</span>
            </h2>
            <div className="w-9 h-9" />
          </div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          {/* 🔴 アナウンス文言エリア（読み上げ/停止ボタンを内包） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
            </div>

            {/* 文言 */}
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              この試合は、ただ今で打ち切り、継続試合となります。{'\n'}
              明日以降に中断した時点から再開いたします。{'\n'}
              あしからずご了承くださいませ。
            </p>

            {/* 読み上げ／停止（横いっぱい・等幅、改行なしテキスト） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  const txt =
                    "この試合は、ただ今で打ち切り、継続試合となります。\n" +
                    "明日以降に中断した時点から再開いたします。\n" +
                    "あしからずご了承くださいませ。";
                  await speak(txt);
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <span className="inline-flex items-center gap-2 whitespace-nowrap leading-none align-middle">
                  <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span>読み上げ</span>
                </span>
              </button>

              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター（OK） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowContinuationModal(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{/* ✅ 使い方（攻撃画面）モーダル */}
{showOffenseHelpModal && (
  <div
    className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 px-3 py-3"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowOffenseHelpModal(false)}
  >
    <div
      className="w-full max-w-[460px] overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between bg-sky-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-[18px] leading-none">❓</span>
          <h2 className="text-[18px] font-extrabold leading-tight tracking-[0.01em]">
            攻撃画面の使い方
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setShowOffenseHelpModal(false)}
          aria-label="閉じる"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[18px] font-bold text-white transition hover:bg-white/30 active:scale-95"
        >
          ×
        </button>
      </div>

      {/* 本文 */}
      <div className="max-h-[72svh] overflow-y-auto bg-white px-3 py-3">
        <div className="space-y-3">
          {/* 上部説明 */}
          <div className="rounded-[16px] border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-[13px] font-semibold leading-5 text-slate-800">
              この画面では、攻撃中に
              <span className="font-bold">打者の進行・得点・代打・代走</span>
              を入力しながら、必要なときにアナウンスを行います。
            </p>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                主な操作
              </div>
              <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                ①次の打者 → ②得点 → ③イニング終了 → ④代打・代走
              </div>
            </div>
          </div>

          {/* 主な操作 */}
          <div className="rounded-[16px] border border-emerald-200 bg-white px-3 py-3 shadow-sm">
            <h3 className="text-[15px] font-extrabold leading-tight text-emerald-700">
              主な操作
            </h3>

            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-bold text-white">
                    ①
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-emerald-800">
                      次の打者
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      <span className="font-bold">【次の打者】</span>
                      ボタンを押して打者を進めます。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      選手名の左の□にチェックがある選手は、
                      一度アナウンスされた選手です。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      チェックがある選手は、2度目以降のアナウンス内容になります。
                    </p>
                    <p className="mt-1 text-[12.5px] leading-5 text-emerald-900">
                      ※ チェックは手動でつけたり外したりできます。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white">
                    補足
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-amber-800">
                      回の先頭打者
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      回の先頭打者は、先頭打者用のアナウンスになります。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      選手名をタッチすると、その選手が先頭打者になります。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      もう一度タッチすると、先頭打者ではなくなります。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white">
                    ②
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-sky-800">
                      得点
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      得点が入ったときは
                      <span className="font-bold">【得点＋1】</span>
                      を押します。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      得点板の回の点数を押すと、その回の得点を修正できます。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[12px] font-bold text-white">
                    ③
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-slate-800">
                      イニング終了
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      チェンジのときは
                      <span className="font-bold">【イニング終了】</span>
                      を押します。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      得点入力画面が表示されたら得点を入力し
                      <span className="font-bold">【OK】</span>
                      を押します。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-orange-500 text-[12px] font-bold text-white">
                    ④
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-orange-800">
                      代打・代走
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      <span className="font-bold">【代打】</span>
                      ボタン … 代打がある場合に押します。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      <span className="font-bold">【代走】</span>
                      ボタン … 代走がある場合に押します。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ボタン説明 */}
          <div className="rounded-[16px] border border-violet-200 bg-white px-3 py-3 shadow-sm">
            <h3 className="text-[15px] font-extrabold leading-tight text-violet-700">
              ボタンの説明
            </h3>

            <div className="mt-3 space-y-3 text-[13px] leading-5 text-slate-700">
              <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
                <div className="font-bold text-slate-900">【↻】ボタン / 【↺】ボタン</div>
                <p className="mt-1">
                  <span className="font-bold">【↻】</span>
                  ボタン … 確定した代打・代走を戻すことができます。
                </p>
                <p className="mt-1">
                  <span className="font-bold">【↺】</span>
                  ボタン … 【↻】で戻した操作をやめることができます。
                </p>
              </div>

              <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50 px-3 py-3">
                <div className="font-bold text-slate-900">右上の【その他】ボタン</div>
                <div className="mt-1 space-y-1">
                  <p>
                    <span className="font-bold">【試合終了】</span>
                    … 勝利チームの場合、読み上げるアナウンスが表示されます。
                  </p>
                  <p>
                    <span className="font-bold">【タイブレーク】【継続試合】【熱中症】</span>
                    … アナウンスが必要なときに押します。
                  </p>
                  <p>
                    <span className="font-bold">【連盟🎤マニュアル】</span>
                    … 連盟が発行しているアナウンスマニュアルを表示します。
                  </p>
                  <p>
                    <span className="font-bold">【投球数⚾】</span>
                    … 試合で投げた投手の投球数を表示します。
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* フッター */}
      <div className="bg-white px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => setShowOffenseHelpModal(false)}
          className="w-full rounded-2xl bg-emerald-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* ✅ 中断画面モーダル（ボーイズリーグ用） */}
{showSuspendPopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="中断">
    {/* 背景 */}
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onClick={() => setShowSuspendPopup(false)}
    />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[85vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>中断</span>
            </h2>
            <button
              onClick={() => setShowSuspendPopup(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                         bg-white/15 hover:bg-white/25 active:bg-white/30
                         text-white text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">

          {/* 雨天中断 */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="text-red-700 font-extrabold mb-2">雨天中断</div>
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              ご覧のような天候の為、試合を一時中断いたします。{'\n'}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    "ご覧のような天候の為、試合を一時中断いたします。\n"
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>
              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span>停止</span>
              </button>
            </div>
          </div>

          {/* 雷での中断 */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="text-red-700 font-extrabold mb-2">雷での中断</div>
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              お知らせいたします。雷雲が近づいている為、試合を一時中断いたします。{'\n'}
              スタンドの皆様も安全な場所に避難をお願い致します。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    "お知らせいたします。雷雲が近づいている為、試合を一時中断いたします。\n" +
                    "スタンドの皆様も安全な場所に避難をお願い致します。"
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>
              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span>停止</span>
              </button>
            </div>
          </div>

          {/* 中断→再開 */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="text-red-700 font-extrabold mb-2">中断→再開</div>
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              大変長らくお待たせをしております。{'\n'}
              ただいまからグラウンドの整備をおこないます。今しばらくお待ちください。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    "大変長らくお待たせをしております。\n" +
                    "ただいまからグラウンドの整備をおこないます。今しばらくお待ちください。"
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>
              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span>停止</span>
              </button>
            </div>
          </div>

          {/* 中断→中止 */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="text-red-700 font-extrabold mb-2">中断→中止</div>
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              ご覧のような天候状態の為、本日の試合は中止とさせていただきます。
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    "ご覧のような天候状態の為、本日の試合は中止とさせていただきます。"
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>
              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span>停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowSuspendPopup(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{/* ✅ サスペンデッドゲーム画面モーダル（ボーイズリーグ用） */}
{showSuspendedGamePopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="サスペンデッドゲーム">
    {/* 背景 */}
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onClick={() => setShowSuspendedGamePopup(false)}
    />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-rose-600 to-pink-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="" className="w-6 h-6" aria-hidden="true" />
              <span>サスペンデッドゲーム</span>
            </h2>
            <button
              onClick={() => setShowSuspendedGamePopup(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                         bg-white/15 hover:bg-white/25 active:bg-white/30
                         text-white text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              ご覧のような天候状態の為、{'\n'}試合続行が不可能となりましたので{'\n'}
              この試合は大会規定により、{'\n'}サスペンデッドゲームといたします。
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(
                    "ご覧のような天候状態の為、試合続行が不可能となりましたので\n" +
                    "この試合は大会規定により、サスペンデッドゲームといたします。"
                  );
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span>読み上げ</span>
              </button>

              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
              >
                <span>停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* フッター */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowSuspendedGamePopup(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{/* ✅ マニュアル（ボーイズリーグ）表示画面モーダル */}
{showBoysManualPopup && (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
    <div className="bg-white w-full max-w-4xl h-[90vh] rounded-xl shadow-lg overflow-hidden flex flex-col">
      <div className="bg-gray-800 text-white px-4 py-2 text-center font-bold">
        連盟🎤マニュアル
      </div>
      <div className="flex-1 overflow-hidden">
        <iframe
          src={boysmanualPdfURL}
          title="Boys Manual"
          className="w-full h-full border-0"
        />
      </div>
      <button
        className="bg-green-600 text-white py-2 text-lg"
        onClick={() => setShowBoysManualPopup(false)}
      >
        OK
      </button>
    </div>
  </div>
)}

{/* ✅ マニュアル（ポニーリーグ）表示画面モーダル */}
{showManualPopup && (
  <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center">
    <div className="bg-white w-full max-w-4xl h-[90vh] rounded-xl shadow-lg overflow-hidden flex flex-col">
      <div className="bg-gray-800 text-white px-4 py-2 text-center font-bold">
        連盟🎤マニュアル
      </div>
      <div className="flex-1 overflow-hidden">
        <ManualViewer />
      </div>
      <button
        className="bg-green-600 text-white py-2 text-lg"
        onClick={() => setShowManualPopup(false)}
      >
        OK
      </button>
    </div>
  </div>
)}

{/* ✅ 投球数ポップアップ（中央表示・スマホっぽいUI・機能変更なし） */}
{showPitchListPopup && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ（タップで閉じる） */}
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onClick={() => setShowPitchListPopup(false)}
    />

    {/* 画面中央にカード配置（SP/PC共通） */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full max-w-md
          max-h-[80vh]
          overflow-hidden
          flex flex-col
        "
        role="dialog"
        aria-modal="true"
        aria-label="投球数"
      >
        {/* ヘッダー（グラデ＋白文字＋ハンドル） */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <span className="text-xl">⚾</span>
              <span>投球数</span>
            </h2>
            <button
              onClick={() => setShowPitchListPopup(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                         bg-white/15 hover:bg-white/25 active:bg-white/30
                         text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-3 overflow-y-auto">
          {pitchList.length === 0 ? (
            <div className="text-center text-slate-500 py-8">記録がありません</div>
          ) : (
            <div className="space-y-2">
              {pitchList.map((r, i) => (
                <div
                  key={i}
                  className="
                    flex items-center justify-between gap-3
                    px-3 py-2 rounded-xl border
                    bg-white hover:bg-emerald-50 active:scale-[0.99] transition
                    border-slate-200
                  "
                >
                  {/* 左：名前＋背番号（番号は改行しない） */}
                  <div className="min-w-0 flex items-baseline gap-2">
                    <span className="font-medium text-slate-900 truncate">{r.name}</span>
                    {r.number && (
                      <span className="text-xs text-slate-600 shrink-0 whitespace-nowrap">
                        {r.number}
                      </span>
                    )}
                  </div>
                  {/* 右：投球数（改行なし） */}
                  <span className="shrink-0 whitespace-nowrap font-bold text-emerald-700">
                    {r.total}球
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* フッター（OKだけ・親のまま） */}
        <div className="px-4 pb-4">
          <button
            className="w-full px-6 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white
                       shadow-md shadow-amber-300/40 active:scale-[0.99] transition"
            onClick={() => setShowPitchListPopup(false)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </div>
)}



{/* ✅ 使い方（守備画面）モーダル */}
{showHelpModal && (
  <div
    className="fixed inset-0 z-[1300] flex items-center justify-center bg-black/50 px-3 py-3"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowHelpModal(false)}
  >
    <div
      className="w-full max-w-[460px] overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between bg-sky-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-[18px] leading-none">❓</span>
          <h2 className="text-[18px] font-extrabold leading-tight tracking-[0.01em]">
            守備画面の使い方
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setShowHelpModal(false)}
          aria-label="閉じる"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[18px] font-bold text-white transition hover:bg-white/30 active:scale-95"
        >
          ×
        </button>
      </div>

      {/* 本文 */}
      <div className="max-h-[72svh] overflow-y-auto bg-white px-3 py-3">
        <div className="space-y-3">
          {/* 上部説明 */}
          <div className="rounded-[16px] border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-[13px] font-semibold leading-5 text-slate-800">
              この画面では、守備中に
              <span className="font-bold">投球数・得点・守備交代</span>
              を入力しながら、必要なときにアナウンスを行います。
            </p>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                主な操作
              </div>
              <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                ①投球数 → ②得点 → ③守備交代 → ④イニング終了
              </div>
            </div>
          </div>

          {/* 入力する内容 */}
          <div className="rounded-[16px] border border-emerald-200 bg-white px-3 py-3 shadow-sm">
            <h3 className="text-[15px] font-extrabold leading-tight text-emerald-700">
              入力する内容
            </h3>

            <div className="mt-3 space-y-3">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-bold text-white">
                    ①
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-emerald-800">
                      投球数
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      <span className="font-bold">【投球数＋1】</span>
                      を押して投球数をカウントします。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      間違えたときは
                      <span className="font-bold">【投球数－1】</span>
                      を押して減らします。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      累計投球数を修正したい場合は
                      <span className="font-bold">【累計投球】</span>
                      を押します。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white">
                    ②
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-sky-800">
                      得点
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      得点が入ったときは
                      <span className="font-bold">【得点＋1】</span>
                      を押します。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      間違えたときは
                      <span className="font-bold">【得点－1】</span>
                      を押して減らします。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      得点板の回の点数を押すと、その回の得点を修正できます。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white">
                    ③
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-amber-800">
                      守備交代
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      守備の交代がある場合は
                      <span className="font-bold">【守備交代】</span>
                      を押します。
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-300 bg-slate-50 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-500 text-[12px] font-bold text-white">
                    ④
                  </div>
                  <div className="min-w-0">
                    <div className="text-[14px] font-bold leading-5 text-slate-800">
                      イニング終了
                    </div>
                    <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                      チェンジのときは
                      <span className="font-bold">【イニング終了】</span>
                      を押します。
                    </p>
                    <p className="mt-1 text-[13px] leading-5 text-slate-700">
                      得点入力画面が表示されたら得点を入力し
                      <span className="font-bold">【OK】</span>
                      を押します。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ボタン説明 */}
          <div className="rounded-[16px] border border-violet-200 bg-white px-3 py-3 shadow-sm">
            <h3 className="text-[15px] font-extrabold leading-tight text-violet-700">
              ボタンの説明
            </h3>

            <div className="mt-3 space-y-3 text-[13px] leading-5 text-slate-700">
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                <div className="font-bold text-slate-900">左上の【戻す】ボタン</div>
                <p className="mt-1">
                  「この回の最初に戻します。よろしいですか？」と表示されます。
                </p>
                <p className="mt-1">
                  <span className="font-bold">【OK】</span>
                  を押すと、その回の最初の状態に戻ります。
                </p>
                <p className="mt-1 text-[12.5px] text-amber-900">
                  ※ 入力した交代・得点・投球数は、その回の分がクリアされます。
                </p>
              </div>

              <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
                <div className="font-bold text-slate-900">右上の【その他】ボタン</div>
                <div className="mt-1 space-y-1">
                  <p>
                    <span className="font-bold">【試合終了】</span>
                    … 勝利チームの場合、読み上げるアナウンスが表示されます。
                  </p>
                  <p>
                    <span className="font-bold">【継続試合】【熱中症】</span>
                    … アナウンスが必要なときに押します。
                  </p>
                  <p>
                    <span className="font-bold">【連盟🎤マニュアル】</span>
                    … 連盟が発行しているアナウンスマニュアルを表示します。
                  </p>
                  <p>
                    <span className="font-bold">【投球数⚾】</span>
                    … 試合で投げた投手の投球数が表示されます。
                  </p>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>

      {/* フッター */}
      <div className="bg-white px-3 pb-3 pt-1">
        <button
          onClick={() => setShowHelpModal(false)}
          className="w-full rounded-2xl bg-emerald-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* ✅ 給水タイム */}
{showWaterBreakPopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="給水タイム">
    {/* 背景 */}
    <div
      className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      onClick={() => setShowWaterBreakPopup(false)}
    />

    {/* 中央カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-sky-600 to-cyan-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <span className="text-xl">💧</span>
              <span>給水タイム</span>
            </h2>
            <button
              onClick={() => setShowWaterBreakPopup(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                          bg-white/15 hover:bg-white/25 active:bg-white/30
                          text-white text-lg"
            >
              ×
            </button>
          </div>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-2">
              クーリングタイム
            </label>
            <select
              value={waterBreakMinutes}
              onChange={(e) => {
                const nextMinutes = Number(e.target.value);
                setWaterBreakMinutes(nextMinutes);

                // 停止中だけ表示時間も変更
                if (!waterBreakRunning) {
                  setWaterBreakRemaining(nextMinutes * 60);
                }
              }}
              disabled={waterBreakRunning}
              className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-slate-800"
            >
              {Array.from({ length: 10 }, (_, i) => i + 1).map((min) => (
                <option key={min} value={min}>
                  {min}分
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <p className="text-red-700 font-bold whitespace-pre-wrap leading-relaxed">
              {waterBreakNotice || waterBreakMessage}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(waterBreakMessage);
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                            inline-flex items-center justify-center gap-2"
              >
                <span className="whitespace-nowrap leading-none">読み上げ</span>
              </button>

              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                            inline-flex items-center justify-center"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-center">
            <div className="text-sm font-bold text-sky-700 mb-2">タイマー</div>
            <div className="text-5xl font-extrabold tracking-widest text-sky-900 tabular-nums">
              {formatWaterBreakTime(waterBreakRemaining)}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={handleWaterBreakStart}
              disabled={waterBreakRunning}
              className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold
                          disabled:bg-gray-300 disabled:cursor-not-allowed"
            >
              START
            </button>

            <button
              onClick={handleWaterBreakStop}
              className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold"
            >
              STOP
            </button>

            <button
              onClick={handleWaterBreakClear}
              className="h-12 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold"
            >
              クリア
            </button>
          </div>
        </div>

        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => {
              setShowWaterBreakPopup(false);
              setWaterBreakRunning(false);
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{showWaterBreakPopupMessage && (
  <div className="fixed inset-0 flex items-center justify-center z-[200]">
    <div className="rounded-2xl bg-black/90 text-white px-8 py-8 shadow-2xl text-center max-w-lg w-[90%]">
      <p className="text-3xl font-extrabold">
        {waterBreakPopupMessage}
      </p>
    </div>
  </div>
)}
    </>
  );
};

const Menu = ({
  onNavigate,
  leagueMode,
  iosKeepAwake,
  onEnableIOSAwake,
  onDisableIOSAwake,
  onContinueGame,
}: {
  onNavigate: (screen: ScreenType) => void;
  leagueMode: LeagueMode;
  iosKeepAwake: boolean;
  onEnableIOSAwake: () => void;
  onDisableIOSAwake: () => void;
  onContinueGame: (screen: ScreenType) => void;
}) => {
  const [canContinue, setCanContinue] = useState(false);
  const [lastScreen, setLastScreen] = useState<ScreenType | null>(null);
  const [showEndGamePopup, setShowEndGamePopup] = useState(false);
  const [endTime, setEndTime] = useState("");
  const [showMenuHelpModal, setShowMenuHelpModal] = useState(false);

  useEffect(() => {
    (async () => {
      const saved = await localForage.getItem("lastGameScreen");
      if (saved && typeof saved === "string") {
        const ok: ScreenType[] = ["offense", "defense", "defenseChange"];
        const preferred = ok.includes(saved as ScreenType)
          ? (saved as ScreenType)
          : "defense";
        setCanContinue(true);
        setLastScreen(preferred);
      }
    })();
  }, []);

  return (
    <div
      className="relative min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >
      <button
        type="button"
        onClick={() => setShowMenuHelpModal(true)}
        aria-label="メニュー画面の使い方"
        title="使い方"
        className="
          absolute right-4 top-4 z-20
          w-10 h-10 rounded-full
          bg-sky-600 hover:bg-sky-700
          text-white font-bold text-lg
          shadow-md
          flex items-center justify-center
          active:scale-95
        "
        style={{ top: "max(16px, env(safe-area-inset-top))" }}
      >
        ？
      </button>

      <div className="flex-1 w-full md:max-w-none flex flex-col items-center justify-center">
        <div className="w-full mb-8 md:mb-10">
          <h1 className="text-center mb-0">
            <img
              src="/EasyAnnounceLOGO.png"
              alt="Easyアナウンス ロゴ"
              className="mx-auto w-[280px] md:w-[360px] drop-shadow-lg"
            />
          </h1>

          <p
            className="text-center -mt-2 mb-4 text-lg font-extrabold italic"
            style={{
              color: "white",
              WebkitTextStroke:
                leagueMode === "boys" ? "0.5px #3B82F6" : "0.5px red", // Boysは青
            }}
          >
            {leagueMode === "boys"
              ? "～ Boys League Version ～"
              : "～ Pony League Version ～"}
          </p>
        </div>


    {/* ✅ 野球アナウンスの心得（横長ボタン） */}
      <button
        onClick={() => onNavigate("announceMindset")}
        className="
          inline-flex items-center gap-3
          mb-4
          rounded-2xl
          bg-gray-200 text-gray-900
          py-3 px-6
          shadow-lg
          hover:bg-gray-100
          transition
        "
      >
      <span className="text-xl">📖</span>
      <span
        className="text-lg font-bold tracking-wide"
        style={{ fontFamily: "'M PLUS Rounded 1c', sans-serif" }}
      >
        野球アナウンスの心得
      </span>
    </button>

    {/* ✅ 4つだけのグリッド（2×2） */}
    <div className="w-full grid grid-cols-2 gap-4">
      <button
        onClick={() => onNavigate("teamRegister")}
        className="rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition"
      >
        <div className="text-2xl">🧢</div>
        <div className="mt-2 font-bold">チーム・選手登録</div>
        <div className="text-xs opacity-80 mt-1">ふりがな,背番号登録</div>
      </button>

      <button
        onClick={() => onNavigate("matchCreate")}
        className="rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition"
      >
        <div className="text-2xl">🗓️</div>
        <div className="mt-2 font-bold">試合作成</div>
        <div className="text-xs opacity-80 mt-1">対戦相手,先攻後攻等</div>
      </button>

      <button
        onClick={() => onNavigate("startGame")}
        className="rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition"
      >
        <div className="text-2xl">🏁</div>
        <div className="mt-2 font-bold">試合開始</div>
        <div className="text-xs opacity-80 mt-1">攻守遷移,読み上げ</div>
      </button>

      <button
        onClick={() => onNavigate("operationSettings")}
        className="rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition"
      >
        <div className="text-2xl">⚙️</div>
        <div className="mt-2 font-bold">運用設定</div>
        <div className="text-xs opacity-80 mt-1">投球数,タイブレーク等</div>
      </button>
    </div>

      {/* 試合継続ボタン（存在する時のみ表示） */}
      {canContinue && lastScreen && (
        <button
          onClick={() => onContinueGame(lastScreen)}
          className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl shadow-xl font-semibold transition active:scale-95"
        >
          ▶ 試合を継続する
        </button>
      )}

{/* iPhoneだけ表示するチェック。ONでフォールバック開始、OFFで解除 */}
{isIOS && (
  <label className="mt-6 flex items-center gap-2 text-white/90">
    <input
      type="checkbox"
      checked={iosKeepAwake}
      onChange={(e) => {
        if (e.target.checked) {
          onEnableIOSAwake();
        } else {
          onDisableIOSAwake();
        }
      }}
    />
    <span>画面を暗くしない</span>
  </label>
)}

    </div>

    {/* バージョン（本体ラッパの外に出す） */}
    <div className="mt-8 text-white/60 text-sm select-none">
      Version: {APP_VERSION}
    </div>

    {showMenuHelpModal && (
      <div
        className="fixed inset-0 z-[1200]"
        role="dialog"
        aria-modal="true"
        aria-label="メニュー画面の使い方"
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={() => setShowMenuHelpModal(false)}
        />

        <div className="absolute inset-0 flex items-center justify-center p-4">
          <div
            className="w-full max-w-md max-h-[85vh] overflow-hidden rounded-2xl bg-white shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-gradient-to-r from-sky-600 to-cyan-600 text-white px-4 py-3 flex items-center justify-between">
              <h2 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
                <span>❓</span>
                <span>メニュー画面の使い方</span>
              </h2>

              <button
                type="button"
                onClick={() => setShowMenuHelpModal(false)}
                className="rounded-full w-9 h-9 flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/30 text-white text-lg"
                aria-label="閉じる"
                title="閉じる"
              >
                ×
              </button>
            </div>

            <div className="overflow-y-auto bg-slate-50 px-4 py-4 space-y-4 text-slate-800">
              <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 shadow-sm">
                <p className="text-lg font-extrabold leading-relaxed text-sky-900">
                  このアプリは、野球アナウンスをスムーズに行うための支援アプリです。
                </p>
                <div className="mt-3 rounded-xl bg-white/80 px-3 py-3 text-center shadow-sm">
                  <p className="text-sm font-bold text-slate-700">使い方はこの順番です</p>
                  <p className="mt-1 text-[13px] sm:text-sm font-extrabold text-red-600 whitespace-nowrap tracking-tight leading-none drop-shadow-[0_0_2px_rgba(0,0,0,0.3)]">
                    ①チーム・選手登録 ▸ ②試合作成 ▸ ③試合開始
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-emerald-300 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white font-extrabold">
                    1
                  </div>
                  <div className="font-extrabold text-emerald-700 text-lg">最初にやること</div>
                </div>
                <div className="font-extrabold text-slate-900 mb-2">【チーム・選手登録】</div>
                <div className="space-y-2 font-semibold leading-relaxed">
                  <p>最初に、チーム名と選手を登録します。</p>
                  <p>ふりがなや背番号もここで登録します。</p>
                  <p className="text-sm text-emerald-800">
                    ※ 一度登録すれば、その後は毎回入力する必要はありません。
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-blue-300 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-white font-extrabold">
                    2
                  </div>
                  <div className="font-extrabold text-blue-700 text-lg">次にやること</div>
                </div>
                <div className="font-extrabold text-slate-900 mb-2">【試合作成】</div>
                <div className="space-y-2 font-semibold leading-relaxed">
                  <p>次に、試合の情報を入力します。</p>
                  <p>大会名、対戦相手、先攻・後攻、スタメンなどを入力します。</p>
                </div>
              </div>

              <div className="rounded-2xl border-2 border-orange-300 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-orange-500 text-white font-extrabold">
                    3
                  </div>
                  <div className="font-extrabold text-orange-700 text-lg">最後にやること</div>
                </div>
                <div className="font-extrabold text-slate-900 mb-2">【試合開始】</div>
                <div className="space-y-2 font-semibold leading-relaxed">
                  <p>試合情報の入力が終わったら、【試合開始】を押します。</p>
                  <p>まず試合開始前アナウンスを行います。</p>
                  <p>試合開始前アナウンスが完了したら、試合を開始します。</p>
                </div>
              </div>

              <div className="rounded-2xl border border-violet-300 bg-violet-50 p-4 shadow-sm">
                <div className="font-extrabold text-violet-800 mb-2">途中から再開したいとき</div>
                <p className="font-semibold leading-relaxed">
                  【継続する】を押すと、途中で閉じた試合を続きから表示できます。
                </p>
              </div>

              <div className="rounded-2xl border-2 border-amber-300 bg-amber-50 p-4 shadow-sm">
                <div className="flex items-center gap-2 mb-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-500 text-white font-extrabold text-sm">
                    ⚙
                  </div>
                  <div className="font-extrabold text-amber-800 text-lg">
                    試合前に確認・設定すること
                  </div>
                </div>

                <div className="space-y-3 font-semibold leading-relaxed text-slate-800">
                  <p>
                    【運用設定】では、試合に関わる設定をまとめて行います。
                  </p>

                  <div className="rounded-xl bg-white/70 p-3 space-y-2 shadow-sm">
                    <p>・規定投球数,タイブレークルールの設定</p>
                    <p>・読み上げの速度などの設定</p>
                    <p>・リーグ（ポニー／ボーイズ）の選択</p>
                  </div>

                  <p className="text-sm text-amber-900">
                    ※ 試合開始前に一度確認しておくと安心です
                  </p>
                </div>
              </div>
            </div>

            <div className="border-t bg-white px-4 py-3">
              <button
                type="button"
                onClick={() => setShowMenuHelpModal(false)}
                className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 font-bold shadow"
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

};


const NotImplemented = ({ onBack }: { onBack: () => void }) => (
  <div className="min-h-screen flex flex-col items-center justify-center bg-gray-100 px-4">
    <p className="text-gray-700 text-xl mb-6">未実装の画面です</p>
    <button
      className="px-5 py-3 bg-gray-300 rounded-full shadow hover:bg-gray-400 transition"
      onClick={onBack}
    >
      ← メニューに戻る
    </button>
  </div>
);
 


const isTouchDevice = () => typeof window !== "undefined" && "ontouchstart" in window;

const AppWrapped = () => (
  <DndProvider
    backend={isTouchDevice() ? TouchBackend : HTML5Backend}
    options={
      isTouchDevice()
        ? {
            enableMouseEvents: true, // これを必ず追加！
          }
        : undefined
    }
  >
    <App />
  </DndProvider>
);
export default AppWrapped;