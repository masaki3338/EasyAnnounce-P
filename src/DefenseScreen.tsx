/**
 * DefenseScreen.tsx
 * ------------------------------------------------------------
 * 【整理方針】
 * - 画面デザイン（JSXの構造/クラス/文言）と機能は変更しない
 * - ロジックは同一のまま、読みやすいように日本語コメントを追加する
 * - データ保存は localForage の既存キーを維持する
 * ------------------------------------------------------------
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import localForage from 'localforage';
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

// --- マージ保存ヘルパー ---
type MatchInfo = {
  tournamentName?: string;
  matchNumber?: number;
  opponentTeam?: string;
  opponentTeamFurigana?: string;
  isHome?: boolean;
  benchSide?: string;
  umpires?: { role: string; name: string; furigana: string }[];
  inning?: number;
  isTop?: boolean;
  isDefense?: boolean;
  teamName?: string;
};

const saveMatchInfo = async (patch: Partial<MatchInfo>) => {
  const prev = (await localForage.getItem<MatchInfo>("matchInfo")) || {};
  const next = { ...prev, ...patch };
  await localForage.setItem("matchInfo", next);
  return next;
};


type Player = {
  id: number;
  lastName?: string;
  firstName?: string;
  number: string;
  name?: string; // フルネームも可能
  lastNameKana?: boolean;
  isFemale?: boolean;
};

const positionStyles: { [key: string]: React.CSSProperties } = {
  投: { top: '62%', left: '50%' },
  捕: { top: '91%', left: '50%' },
  一: { top: '65%', left: '80%' },
  二: { top: '44%', left: '66%' },
  三: { top: '65%', left: '17%' },
  遊: { top: '44%', left: '32%' },
  左: { top: '20%', left: '17%' },
  中: { top: '16%', left: '50%' },
  右: { top: '20%', left: '80%' },
  指: { top: '91%', left: '80%' },
};

const positions = Object.keys(positionStyles);



type Scores = {
  [inning: number]: { top?: number; bottom?: number };
};


type DefenseScreenProps = {
  onChangeDefense: () => void;
  onSwitchToOffense: () => void; // ✅ 追加
  onBack?: () => void; // ✅ 任意として追加
  onGoToSeatIntroduction?: () => void; // ★ 追加
};





/**
 * 守備画面コンポーネント本体
 */
const DefenseScreen: React.FC<DefenseScreenProps> = ({ onChangeDefense, onSwitchToOffense,onGoToSeatIntroduction,}) => {  
  const [showModal, setShowModal] = useState(false);
  const [inputScore, setInputScore] = useState("");
  const [editInning, setEditInning] = useState<number | null>(null);
  const [editTopBottom, setEditTopBottom] = useState<"top" | "bottom" | null>(null);
  const [myTeamName, setMyTeamName] = useState('');
  const [opponentTeamName, setOpponentTeamName] = useState('');
  const [assignments, setAssignments] = useState<{ [pos: string]: number | null }>({});
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [currentPitchCount, setCurrentPitchCount] = useState(0);
  const [totalPitchCount, setTotalPitchCount] = useState(0);
  const [scores, setScores] = useState<Scores>({});
  const trimScoresAfterInning = (all: Scores, keepThroughInning: number) => {
  const next: Scores = {};
    Object.entries(all).forEach(([k, v]) => {
      const inningNo = Number(k) + 1; // scoresは 0=1回
      if (inningNo <= keepThroughInning) next[Number(k)] = v;
    });
    return next;
  };

  const [inning, setInning] = useState(1);
  const [isTop, setIsTop] = useState(true);
  const [pitchLimitSelected, setPitchLimitSelected] = useState<number>(75);
  const [showTotalPitchModal, setShowTotalPitchModal] = useState(false);
  const [totalPitchInput, setTotalPitchInput] = useState<string>(""); // 入力中の文字列
  const openTotalPitchModal = (currentTotal: number) => {
    setTotalPitchInput(String(currentTotal ?? 0));
    setShowTotalPitchModal(true);
  };

  // ★ 追加：見出しが収まらない時に小さくする判定用
  const [isNarrow, setIsNarrow] = useState(false);
  const titleRef = useRef<HTMLHeadingElement | null>(null);


 const handleStartGame = () => {
      const now = new Date();
      const timeString = now.toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
      setGameStartTime(timeString);
      localForage.setItem("startTime", timeString);
      setGameStartTime(timeString);
      alert(`試合開始時間を記録しました: ${timeString}`);
    };
    const handleGameStart = () => {
      const now = new Date();
      const formatted = `${now.getHours()}時${now.getMinutes()}分`;
      setGameStartTime(formatted);
      localForage.setItem("gameStartTime", formatted);
    };
    const hasShownStartTimePopup = useRef(false);

    const [gameStartTime, setGameStartTime] = useState<string | null>(null);
    const [showStartTimePopup, setShowStartTimePopup] = useState(false);
  const [isDefense, setIsDefense] = useState(true);
  const [isHome, setIsHome] = useState(false); // 自チームが後攻かどうか
  const [announceMessages, setAnnounceMessages] = useState<string[]>([]);
   const [pitchLimitMessages, setPitchLimitMessages] = useState<string[]>([]);
  const [showPitchLimitModal, setShowPitchLimitModal] = useState(false);
  const synthRef = useRef(window.speechSynthesis);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [scoreOverwrite, setScoreOverwrite] = useState(true);
  const handleScoreInput = (digit: string) => {
    setInputScore(prev => {
      const p = String(prev ?? "");
      // 最初の1回は上書き
      if (scoreOverwrite) return digit;
      // 2桁まで
      if (p.length >= 2) return p;
      // 0 → 2 のとき "02" にしない
      if (p === "0") return digit;
      return p + digit;
    });
    setScoreOverwrite(false);
  };
  // 臨時代走が居るときの「先出し」モーダル
  const [showTempReentryModal, setShowTempReentryModal] = useState(false);

// ▼リエントリー用 state と関数を追加
// ★ 試合開始時の打順スナップショット（表示用）
const [startingOrder, setStartingOrder] = useState<{ id: number; reason?: string }[]>([]);
// 打順（代打・代走の「今の担い手」が入る）
const [battingOrder, setBattingOrder] = useState<Array<{ id: number; reason?: string }>>([]);

 // TR（臨時代走）情報：打順index → 走者ID
const [tempRunnerByOrder, setTempRunnerByOrder] = useState<Record<number, number>>({});
// 臨時代走が残っている打順は、元スタメンの位置に「代打選手」を仮表示（見た目だけ）
const assignmentsForDisplay = useMemo(() => {
  const disp: Record<string, number | null> = { ...assignments };
  const bo = Array.isArray(battingOrder) ? battingOrder : [];

  // ※ 数値/文字列の不一致に強い一致関数
  const findPosById = (id?: number | null) =>
    Object.keys(disp).find((p) => {
      const v = disp[p];
      return v != null && id != null && Number(v) === Number(id);
    });

  bo.forEach((e, i) => {
    // 条件を拡張：① reason が「臨時代走」 または ② TR マップにエントリがある
    const isTR = e?.reason === "臨時代走" || tempRunnerByOrder[i] != null;
    if (!e || !isTR) return;

    // 「代打出された選手」の現在位置を、まずは startingOrder[i] のIDで逆引き
    const starterId = startingOrder?.[i]?.id;
    const pos = findPosById(starterId);
    if (!pos) return; // 途中で通常交代があって見つからない場合はスキップ

    // その位置に “代打（battingOrder[i].id）” を仮表示
    disp[pos] = e.id ?? null;
  });

  return disp;
}, [assignments, battingOrder, startingOrder, tempRunnerByOrder]);


const [reEntryTarget, setReEntryTarget] = useState<{ id: number; fromPos: string; index?: number } | null>(null);
const [reEntryMessage, setReEntryMessage] = useState("");

// 投手IDごとの累計球数（例: { 12: 63, 18: 23 }）
const [pitcherTotals, setPitcherTotals] = useState<Record<number, number>>({});

// プレイヤー取得の安全版
const getPlayerSafe = (id: number) => {
  // getPlayer があれば優先
  // @ts-ignore
  if (typeof getPlayer === "function") {
    // @ts-ignore
    const p = getPlayer(id);
    if (p) return p;
  }
  // teamPlayers から検索
  // @ts-ignore
  return (Array.isArray(teamPlayers) ? teamPlayers.find((tp:any)=>tp.id===id) : null) || null;
};

// 表示名（姓名 → カナ → ID の順でフォールバック、背番号もあれば付与）
/*const playerLabel = (id: number) => {
  const p: any = getPlayerSafe(id);
  if (!p) return `ID:${id}`;
  const last = p.lastName ?? p.familyName ?? p.last_name ?? "";
  const first = p.firstName ?? p.givenName ?? p.first_name ?? "";
  const lastKana = p.lastNameKana ?? p.last_name_kana ?? "";
  const firstKana = p.firstNameKana ?? p.first_name_kana ?? "";
  const number = p.number ? `（${p.number}）` : "";
  const name =
    (last || first) ? `${last}${first}` :
    (lastKana || firstKana) ? `${lastKana}${firstKana}` :
    `ID:${id}`;
  return `${name}${number}`;
};*/
const playerLabel = (id: number) => {
  const p: any = getPlayerSafe(id);
  if (!p) return `ID:${id}`;
  const last = p.lastName ?? p.familyName ?? p.last_name ?? "";
  const lastKana = p.lastNameKana ?? p.last_name_kana ?? "";
  const name =
    (last ) ? `${last}` :
    (lastKana ) ? `${lastKana}` :
    `ID:${id}`;
  return `${name}`;
};

// 敬称（名前が取れないときは付けない）
const honor = (id: number) => {
  const p: any = getPlayerSafe(id);
  if (!p) return "";
  return p.isFemale ? "さん" : "くん";
};

// 🔸 同姓（苗字）重複セット
const [dupLastNames, setDupLastNames] = useState<Set<string>>(new Set());
useEffect(() => {
  (async () => {
    const list = (await localForage.getItem<string[]>("duplicateLastNames")) ?? [];
    setDupLastNames(new Set(list.map(String)));
  })();
}, []);

// 🔸 アナウンス用氏名（重複姓ならフルネーム／カナもフル）
const getAnnounceNameParts = (p: any) => {
  const ln = String(p?.lastName ?? "").trim();
  const fn = String(p?.firstName ?? "").trim();
  const lnKana = String(p?.lastNameKana ?? "").trim();
  const fnKana = String(p?.firstNameKana ?? "").trim();

  const forceFull = ln && dupLastNames.has(ln);

  if (forceFull) {
    return {
      name: fn ? `${ln}${fn}` : ln,                 // 名が無ければ付けない
      kana: (lnKana || fnKana) ? `${lnKana}${fnKana}` : "" // かな無ければ空
    };
  }

  return {
    name: ln,          // ← "投手" にしない
    kana: lnKana       // ← "とうしゅ" にしない
  };
};

// 🔸 画面用の <ruby>…</ruby>（重複姓なら「姓」「名」別ルビ）
const nameRubyHTML = (p: any) => {
  const ln = String(p?.lastName ?? "").trim();
  const fn = String(p?.firstName ?? "").trim();
  const lnKana = String(p?.lastNameKana ?? "").trim();
  const fnKana = String(p?.firstNameKana ?? "").trim();

  const forceFull = ln && dupLastNames.has(ln);

  const ruby = (txt: string, kana: string) =>
    kana ? `<ruby>${txt}<rt>${kana}</rt></ruby>` : `<ruby>${txt}</ruby>`;

  if (forceFull) {
    const lastPart = ln ? ruby(ln, lnKana) : "";
    const firstPart = fn ? ruby(fn, fnKana) : "";
    return (firstPart ? `${lastPart}${firstPart}` : lastPart) || "";
  }

  // 重複姓でない場合：姓だけ（かなが無ければ rt なし）
  return ln ? ruby(ln, lnKana) : "";
};




// 代打/代走ポップアップ内の「リエントリー」ボタンから呼ばれる
const handleReentryCheck = async () => {
  // 表示の初期化
  setReEntryMessage("");
  setReEntryTarget(null);

  // 現在の打順 & 試合開始時の打順スナップショット
  const battingOrder: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];
  const startingOrder: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("startingBattingOrder")) || [];

  // 「代打 or 代走」で入っている最初の打順枠を拾う
  const pinchIdx = battingOrder.findIndex(e => e?.reason === "代打" || e?.reason === "代走");
  if (pinchIdx === -1) { setReEntryMessage("対象選手なし"); return; }

  // A=代打/代走で出ている選手, B=その打順の元スタメン
  const pinchId = battingOrder[pinchIdx]?.id;
  const starterId = startingOrder[pinchIdx]?.id;
  if (!pinchId || !starterId) { setReEntryMessage("対象選手なし"); return; }

  // B の“元守備位置”を現在の守備配置から逆引き
  const assignmentsNow: Record<string, number | null> =
    (await localForage.getItem("lineupAssignments")) || {};
  const fromPos = Object.keys(assignmentsNow).find(pos => assignmentsNow[pos] === starterId);
  if (!fromPos) { setReEntryMessage("対象選手なし"); return; }

  // 文面（名前欠落しないようにヘルパー使用）
  const team: { name?: string } = (await localForage.getItem("team")) || {};
  const teamName = team?.name || "東京武蔵ポニー";
  const aReason = battingOrder[pinchIdx]?.reason || "代打";
  const posJP: Record<string, string> = {
    "投":"ピッチャー","捕":"キャッチャー","一":"ファースト","二":"セカンド",
    "三":"サード","遊":"ショート","左":"レフト","中":"センター","右":"ライト","指":"指名打者"
  };

  const aLabel = playerLabel(pinchId);
  const bLabel = playerLabel(starterId);
  const aHonor = honor(pinchId);
  const bHonor = honor(starterId);

  const msg =
    `${teamName}、選手の交代をお知らせいたします。\n` +
    `先ほど${aReason}いたしました ${aLabel}${aHonor} に代わりまして ` +
    `${bLabel}${bHonor} がリエントリーで ${posJP[fromPos] ?? fromPos} に入ります。`;

  setReEntryTarget({ id: starterId, fromPos });
  setReEntryMessage(msg);

  // デバッグ（必要なら）
  console.log("[RE] pinchIdx:", pinchIdx, "A:", pinchId, "B:", starterId, "fromPos:", fromPos);
};

// ★ 臨時代走を最優先で拾い、文面とターゲットをセット
// ★ 臨時代走を最優先で拾い、文面とターゲットをセット（B=代打）
const handleTempReentryCheck = async () => {
  setReEntryMessage("");
  setReEntryTarget(null);

  const battingOrder: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];
  const startingOrder: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("startingBattingOrder")) || [];

  // 「臨時代走」の打順インデックス
  const pinchIdx = battingOrder.findIndex((e) => e?.reason === "臨時代走");
  if (pinchIdx === -1) return;

  // A＝臨時代走で走った選手（攻撃画面が保存した tempRunner を優先）
  const tempMap: Record<number, number> =
    (await localForage.getItem("tempRunnerByOrder")) || {};
  const pinchId = tempMap[pinchIdx] ?? battingOrder[pinchIdx]?.id;

  // B＝代打で出ていた選手（battingOrder に残っているのは代打）
  const batterId = battingOrder[pinchIdx]?.id;

  // B の元守備位置（現在の assignments から、元スタメンIDで逆引き）
  const assignmentsNow: Record<string, number | null> =
    (await localForage.getItem("lineupAssignments")) || {};
  const starterIdForPos = startingOrder[pinchIdx]?.id;
  if (!pinchId || !batterId || !starterIdForPos) return;

  const fromPos = Object.keys(assignmentsNow).find((pos) => assignmentsNow[pos] === starterIdForPos);
  if (!fromPos) return;

  const posJP: Record<string, string> = {
    "投":"ピッチャー","捕":"キャッチャー","一":"ファースト","二":"セカンド",
    "三":"サード","遊":"ショート","左":"レフト","中":"センター","右":"ライト","指":"指名打者"
  };

  const aLabel = playerLabel(pinchId);
  const aHonor = honor(pinchId);
  const bLabel = playerLabel(batterId);
  const bHonor = honor(batterId);

  const msg =
    `先ほど臨時代走いたしました ${aLabel}${aHonor} に代わりまして` +
    ` ${bLabel}${bHonor} が ${posJP[fromPos] ?? fromPos} に戻ります。`;

  // ★ ターゲットも “代打選手”
  setReEntryTarget({ id: batterId, fromPos, index: pinchIdx });
  setReEntryMessage(msg);
};


// ★ 追加：h2 の幅を監視して文字サイズを自動調整
useEffect(() => {
  const el = titleRef.current;
  if (!el) return;

  const checkWidth = () => {
    const overflow = el.scrollWidth > el.clientWidth;
    setIsNarrow(overflow);
  };

  checkWidth();
  window.addEventListener("resize", checkWidth);
  return () => window.removeEventListener("resize", checkWidth);
}, [myTeamName, opponentTeamName]);



// 臨時代走モーダルが開いたら、文面とターゲットを準備
useEffect(() => {
  if (!showTempReentryModal) return;
  (async () => {
    await handleTempReentryCheck();
  })();
}, [showTempReentryModal]);


/**
   * 初期読込：localForage から状態を復元
   * - lineupAssignments / team / matchInfo / scores / pitchCounts 等
   * - 代打/代走/臨時代走の有無で確認モーダルを表示
   */
  useEffect(() => {

  localForage.setItem("lastGameScreen", "defense");
  const loadData = async () => {
    const savedAssignments = await localForage.getItem<{ [pos: string]: number | null }>('lineupAssignments');
    const savedTeam = (await localForage.getItem<{ name: string; players: Player[] }>('team')) || { name: '', players: [] };
    const savedMatchInfo = (await localForage.getItem<{
      opponentTeam: string;
      inning?: number;
      isTop?: boolean;
      isDefense?: boolean;
      isHome?: boolean;
    }>('matchInfo')) || {
      opponentTeam: '',
      inning: 1,
      isTop: true,
      isDefense: true,
      isHome: false
    };
    const savedScores = (await localForage.getItem<Scores>('scores')) || {};
    const savedPitchCount = (await localForage.getItem<{ current: number; total: number; pitcherId?: number }>('pitchCounts')) || { current: 0, total: 0 };

    const savedSelected = await localForage.getItem<number>("rule.pitchLimit.selected");
    setPitchLimitSelected(typeof savedSelected === "number" ? savedSelected : 75);

    const post = await localForage.getItem<{enabled?:boolean}>("postDefenseSeatIntro");
const savedBattingOrder =
  (await localForage.getItem<{ id: number; reason: string }[]>("battingOrder")) || [];
setBattingOrder(savedBattingOrder);
// ★ スタメン打順も読み込んで保持
const savedStartingOrder =
  (await localForage.getItem<{ id: number; reason?: string }[]>("startingBattingOrder")) || [];
setStartingOrder(savedStartingOrder);
// ★ 臨時代走マップも読み込む
const savedTempMap = (await localForage.getItem<Record<number, number>>("tempRunnerByOrder")) || {};
setTempRunnerByOrder(savedTempMap);


// ✅ まず基礎データを反映してから…
if (savedAssignments) setAssignments(savedAssignments);
if (savedTeam.name) setMyTeamName(savedTeam.name);
if (savedTeam.players) setTeamPlayers(savedTeam.players);
if (savedScores) setScores(savedScores);
setInning(savedMatchInfo.inning ?? 1);
setIsTop(savedMatchInfo.isTop ?? true);
setIsDefense(savedMatchInfo.isDefense ?? true);
setIsHome(savedMatchInfo.isHome ?? false);

// 既存：savedBattingOrder は上で set 済み
const hasTempRunner = savedBattingOrder.some((e) => e.reason === "臨時代走");
const hasOtherSubs  = savedBattingOrder.some((e) => e.reason === "代打" || e.reason === "代走");

// 分岐：臨時代走がいれば“先出しモーダル”を優先
if (hasTempRunner) {
  setShowTempReentryModal(true);
} else if (hasOtherSubs) {
  setShowConfirmModal(true);
}



    if (savedMatchInfo.opponentTeam) setOpponentTeamName(savedMatchInfo.opponentTeam);
    if (savedScores) setScores(savedScores);
    setInning(savedMatchInfo.inning ?? 1);
    setIsTop(savedMatchInfo.isTop ?? true);
    setIsDefense(savedMatchInfo.isDefense ?? true);
    setIsHome(savedMatchInfo.isHome ?? false);

    const savedPitcherTotals =
  (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};
setPitcherTotals(savedPitcherTotals);

// 🟡 ピッチャー交代チェック
const currentPitcherId = savedAssignments?.['投'];
const previousPitcherId = savedPitchCount.pitcherId;
const pitcher = savedTeam.players.find(p => p.id === currentPitcherId);
const pitcherName = pitcher?.lastName ?? "投手";
const pitcherKana = pitcher?.lastNameKana ?? "とうしゅ";
const pitcherSuffix = pitcher?.isFemale ? "さん" : "くん";
const pitcherRuby = nameRubyHTML(pitcher); // ★ ルビは重複姓でフルに

let current = 0;
let total = savedPitchCount.total ?? 0;

// ✅ イニングの変化を判定
const isSameInning = savedMatchInfo.inning === inning && savedMatchInfo.isTop === isTop;

if (currentPitcherId !== undefined && currentPitcherId === previousPitcherId) {
  // 🟢 同じ投手
  current = savedPitchCount.current ?? 0;
  total = savedPitchCount.total ?? 0;

  const msgs = [
    `ピッチャー${pitcherRuby}${pitcherSuffix}、この回の投球数は${current}球です`
  ];

 
  if (!isSameInning) {
    msgs.push(`トータル${total}球です`);
  }
  setAnnounceMessages(msgs);
} else {
  // 🔄 投手交代：この回は0から、通算は「投手IDごとの累計」を優先
  const perPitcherTotal =
    ((await localForage.getItem<Record<number, number>>("pitcherTotals")) || {})[
      currentPitcherId as number
    ] ?? 0;

  current = 0;
  total   = perPitcherTotal;

  const msgs = [
    `ピッチャー<ruby>${pitcherName}<rt>${pitcherKana}</rt></ruby>${pitcherSuffix}、`,
    `この回の投球数は0球です`,
    `トータル${total}球です`
  ];
  setAnnounceMessages(msgs);
}


// 状態更新
setCurrentPitchCount(current);
setTotalPitchCount(total);
await localForage.setItem("pitchCounts", {
  current,
  total,
  pitcherId: currentPitcherId ?? null
});


    setCurrentPitchCount(current);
    setTotalPitchCount(total);

    // 保存
    await localForage.setItem('pitchCounts', {
      current,
      total,
      pitcherId: currentPitcherId ?? null
    });


  };

  loadData();
}, []);

 // 初回だけ VOICEVOX を温めて初回の待ち時間を短縮
 useEffect(() => { void prewarmTTS(); }, []);

 // 画面離脱時は必ず停止
 useEffect(() => () => { ttsStop(); }, []);
  
const addPitch = async () => {
  const pitcherId = assignments["投"];

  const newCurrent = currentPitchCount + 1;

  // ★ まず pitcherTotals（唯一の正）を更新して newTotal を決める
  let newTotal = totalPitchCount; // fallback
  if (typeof pitcherId === "number") {
    const map =
      (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};
    const next = (map[pitcherId] ?? 0) + 1;
    map[pitcherId] = next;

    await localForage.setItem("pitcherTotals", map);
    setPitcherTotals({ ...map });

    newTotal = next;              // ★これが累計の正
    setTotalPitchCount(newTotal); // ★画面表示もこれに揃える
  } else {
    // pitcherId が取れない時は累計をいじらない（または +1 したいなら要件次第）
    setTotalPitchCount(totalPitchCount);
  }

  // この回の投球数
  setCurrentPitchCount(newCurrent);

  // 保存（pitchCounts.total も newTotal に揃える）
  await localForage.setItem("pitchCounts", {
    current: newCurrent,
    total: newTotal,
    pitcherId: pitcherId ?? null,
  });

  // --- アナウンス作成（あなたの既存ロジックは newCurrent/newTotal を使うだけ） ---
  const pitcher = teamPlayers.find((p) => p.id === pitcherId);
  if (!pitcher) return;

  const pitcherSuffix = pitcher.isFemale ? "さん" : "くん";
  const pitcherRuby = nameRubyHTML(pitcher);

  const newMessages: string[] = [];
  newMessages.push(`ピッチャー${pitcherRuby}${pitcherSuffix}、この回の投球数は${newCurrent}球です`);

  if (newCurrent !== newTotal) {
    newMessages.push(`トータル${newTotal}球です`);
  }

  // ★ 警告判定も newTotal を基準にする（そのまま）
  const warn1 = Math.max(0, pitchLimitSelected - 10);
  const warn2 = pitchLimitSelected;

  if (newTotal === warn1 || newTotal === warn2) {
    const pitcherParts = getAnnounceNameParts(pitcher);
    const specialMsg =
      newTotal === warn2
        ? `ピッチャー${pitcherParts.name}${pitcherSuffix}、ただいまの投球で${newTotal}球に到達しました。`
        : `ピッチャー${pitcherParts.name}${pitcherSuffix}、ただいまの投球で${newTotal}球です。`;

    setPitchLimitMessages([specialMsg]);
    setShowPitchLimitModal(true);
  }

  setAnnounceMessages(newMessages);
};
const subtractPitch = async () => {
  const pitcherId = assignments["投"];

  const newCurrent = Math.max(currentPitchCount - 1, 0);

  // ★ pitcherTotals（唯一の正）を更新して newTotal を決める
  let newTotal = totalPitchCount; // fallback
  if (typeof pitcherId === "number") {
    const map =
      (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};
    const next = Math.max((map[pitcherId] ?? 0) - 1, 0);
    map[pitcherId] = next;

    await localForage.setItem("pitcherTotals", map);
    setPitcherTotals({ ...map });

    newTotal = next;
    setTotalPitchCount(newTotal);
  } else {
    setTotalPitchCount(totalPitchCount);
  }

  setCurrentPitchCount(newCurrent);

  await localForage.setItem("pitchCounts", {
    current: newCurrent,
    total: newTotal,
    pitcherId: pitcherId ?? null,
  });

  const pitcher = teamPlayers.find((p) => p.id === pitcherId);
  if (!pitcher) return;

  const suffix = pitcher.isFemale ? "さん" : "くん";
  const pitcherRuby = nameRubyHTML(pitcher);

  const newMessages: string[] = [];
  newMessages.push(`ピッチャー${pitcherRuby}${suffix}、この回の投球数は${newCurrent}球です`);

  if (newCurrent !== newTotal) {
    newMessages.push(`トータル${newTotal}球です`);
  }

  setAnnounceMessages(newMessages);
};


 // 日本語音声の優先選択
 const pickJaVoice = () => {
   const s = window.speechSynthesis;
   const voices = s.getVoices();
   // 環境により名称は異なるので候補を複数用意
   const preferred = ["Google 日本語", "Kyoko", "Microsoft Haruka", "Microsoft Ayumi", "Otoya", "Mizuki"];
   return (
     voices.find(v => v.lang === "ja-JP" && preferred.some(name => (v.name || "").includes(name))) ||
     voices.find(v => v.lang === "ja-JP") ||
     null
   );
 };


  const addScore = async (inningIndex: number, topOrBottom: 'top' | 'bottom') => {
    if (inningIndex + 1 > inning) return;
    const currentScore = scores[inningIndex] || { top: 0, bottom: 0 };
    const newScore = { ...currentScore };
    topOrBottom === 'top' ? newScore.top++ : newScore.bottom++;
    const newScores = { ...scores, [inningIndex]: newScore };
    setScores(newScores);
    await localForage.setItem('scores', newScores);
  };

  const changeRun = async (delta: number) => {
  try {
    const idx = Number(inning) - 1;                 // ★ scoresは0始まり（0=1回）
    const half: "top" | "bottom" = isTop ? "top" : "bottom";

    const prevHalfVal = scores?.[idx]?.[half] ?? 0;
    const nextVal = Math.max(0, prevHalfVal + delta);

    const nextScores: Scores = {
      ...scores,
      [idx]: {
        ...(scores?.[idx] ?? {}),
        [half]: nextVal,
      },
    };

    setScores(nextScores);
    await localForage.setItem("scores", nextScores);
  } catch (e) {
    console.error("changeRun error", e);
  }
};

const confirmScore = async () => {
  const score = parseInt(inputScore || "0", 10);
  const updatedScores = { ...scores };

  // ✅ 編集モード
  if (editInning !== null && editTopBottom !== null) {
    const index = editInning - 1;
    if (!updatedScores[index]) {
      updatedScores[index] = { top: 0, bottom: 0 };
    }
    updatedScores[index][editTopBottom] = score;

    await localForage.setItem("scores", updatedScores);
    setScores(updatedScores);
    setInputScore("");
    setEditInning(null);
    setEditTopBottom(null);
    setShowModal(false);
    return;
  }

  // ✅ 通常モード（イニング終了）
  const index = inning - 1;
  if (!updatedScores[index]) {
    updatedScores[index] = { top: 0, bottom: 0 };
  }

  if (isTop) {
    updatedScores[index].top = score;
  } else {
    updatedScores[index].bottom = score;
  }

  await localForage.setItem("scores", updatedScores);
  setScores(updatedScores);
  setInputScore("");
  setShowModal(false);

  // 🟡 次の状態を定義
  const nextIsTop = !isTop;
  const nextInning = isTop ? inning : inning + 1;

  // 🟡 matchInfo 更新
// 🟡 最新の matchInfo から isHome を堅牢に取得（初回OKで未反映を防ぐ）
const mi = (await localForage.getItem<MatchInfo>("matchInfo")) || {};
const home = typeof mi?.isHome === "boolean" ? mi.isHome : isHome;

// 🟡 次が攻撃回か？（先攻=top、後攻=bottom）
const willSwitchToOffense  = (nextIsTop && !home) || (!nextIsTop && home);

// 🟡 マージ保存（ふりがな等の既存フィールドを保持）
await saveMatchInfo({
  // opponentTeam は書かなくてもOK（ opponentTeamFurigana も維持される）
  inning: nextInning,
  isTop: nextIsTop,
  isDefense: !willSwitchToOffense , // ← 攻撃に回るタイミングでは false に
  isHome: home,
});


  setIsTop(nextIsTop);
  if (!isTop) setInning(nextInning);

   // 🟢 イニング変化時に投球数リセット
  const pitcherId = assignments["投"];
  const updatedPitchCounts = {
    current: 0,
    total: totalPitchCount,
    pitcherId: pitcherId ?? null,
  };
  await localForage.setItem("pitchCounts", updatedPitchCounts);
  setCurrentPitchCount(0);


  // ✅ 攻撃に切り替わるタイミングで攻撃画面に遷移
  const isNextOffense = (nextIsTop && !isHome) || (!nextIsTop && isHome);
  if (isNextOffense) {
    onSwitchToOffense();
  }
};



const totalRuns = () => {
  let myTeamTotal = 0;
  let oppTotal = 0;
  Object.entries(scores).forEach(([inningStr, s]) => {
    if (!s) return;

    if (isHome) {
      myTeamTotal += s.bottom;
      oppTotal += s.top;
    } else {
      myTeamTotal += s.top;
      oppTotal += s.bottom;
    }
  });
  return { myTeamTotal, oppTotal };
};


const getPlayerNameNumber = (id: number | null) => {
  if (id === null) return null;

  const p = teamPlayers.find(pl => pl.id === id);
  if (!p) return null;

  const ln = (p.lastName ?? "").trim();
  const fn = (p.firstName ?? "").trim();
  const num = (p.number ?? "").trim();

  const name = fn ? `${ln}${fn}` : ln;
  const badge = num ? `#${num}` : "#";

  return `${name} ${badge}`;
};


  // ★ TTS用にテキストを整形（ふりがな優先＆用語の読みを固定）
const normalizeForTTS = (input: string) => {
  if (!input) return "";
  let t = input;

  // <ruby>表示</ruby> → 読み（かな）に置換
  t = t.replace(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g, "$2");

  // 残りのタグは除去
  t = t.replace(/<[^>]+>/g, "");

  // 読みを固定したい語を差し替え
  t = t.replace(/投球数/g, "とうきゅうすう");

  return t;
};


 const handleSpeak = () => {
   if (announceMessages.length === 0) return;
   const text = normalizeForTTS(announceMessages.join("。"));
   // UIは待たせない＋先頭文を先に鳴らす
   void ttsSpeak(text, { progressive: true, cache: true });
 };

 const handlePitchLimitSpeak = () => {
   if (pitchLimitMessages.length === 0) return;
   const text = normalizeForTTS(pitchLimitMessages.join("。"));
   void ttsSpeak(text, { progressive: true, cache: true });
 };


const handleStop = () => { ttsStop(); };

    return (    
      <div
        className="max-w-4xl mx-auto p-4 select-none"
        onContextMenu={(e) => e.preventDefault()}        // 右クリック/長押しのメニュー抑止
        onSelectStart={(e) => e.preventDefault()}         // テキスト選択開始を抑止
        style={{
          WebkitTouchCallout: "none",   // iOSの長押し呼び出し抑止
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >

      <section className="mb-4">
<h2
  ref={titleRef}
  className={`font-bold mb-2 inline-flex items-center gap-2 whitespace-nowrap overflow-hidden ${
    isNarrow ? "text-base" : "text-base"
  }`}
>
  <img
    src="/Defence.png"
    alt=""
    width={24}
    height={24}
    className="w-6 h-6 object-contain align-middle select-none flex-shrink-0"
    loading="lazy"
    decoding="async"
    draggable="false"
  />
  <span className="px-2 py-1 rounded bg-orange-500 text-white whitespace-nowrap flex-shrink-0">
    守備中
  </span>
<div className="flex flex-wrap justify-center gap-x-1 text-center">
  <span className="whitespace-nowrap">
    {myTeamName || "自チーム"} 
  </span>
  <span className="whitespace-normal break-words">
    🆚{opponentTeamName || "対戦相手"}
  </span>
</div>


</h2>



      <div className="mb-2">
        <div className="flex items-center gap-2 flex-nowrap overflow-x-auto">
          {/* 左：状態（縮む・折り返さない） */}
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <select
              value={inning}
              onChange={async (e) => {
                const nextInning = Number(e.target.value);

                // 戻した時だけ、以降イニングをクリア
                if (nextInning < inning) {
                  const trimmed = trimScoresAfterInning(scores, nextInning);
                  setScores(trimmed);
                  await localForage.setItem("scores", trimmed);
                }

                setInning(nextInning);

                // matchInfoも合わせておく（任意だがおすすめ）
                await saveMatchInfo({ inning: nextInning });
              }}
            >

              {[...Array(9)].map((_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <span className="whitespace-nowrap">回 {isTop ? "表" : "裏"}</span>

          </div>

          {/* 右：ボタン群（縮ませない・折り返さない） */}
          <div className="flex items-center gap-2 shrink-0">
            {inning === 1 && isTop && isHome && (
              <button
                onClick={handleStartGame}
                className="inline-flex items-center justify-center h-8 sm:h-10 px-3 sm:px-4 bg-green-500 text-white font-bold rounded hover:bg-green-600 text-xs sm:text-sm whitespace-nowrap"
              >
                試合開始
              </button>
            )}

          </div>
        </div>
      </div>


        <table className="w-full border border-gray-400 text-center text-sm">
          <colgroup>
            {/* チーム名列： */}
            <col className="w-40" />
            {/* 9回分のスコア列：40pxずつ */}
            {[...Array(9)].map((_, i) => (
              <col key={i} className="w-10" />
            ))}
            {/* 計列：48px */}
            <col className="w-12" />
          </colgroup>
          <thead>
            <tr>
              <th className="border">回</th>
              {[...Array(9).keys()].map(i => (
                <th key={i} className="border">{i + 1}</th>
              ))}
              <th className="border">計</th>
            </tr>
          </thead>
          <tbody>
  {[
    { name: myTeamName || "自チーム", isMyTeam: true },
    { name: opponentTeamName || "対戦相手", isMyTeam: false },
  ]
    .sort((a, b) => {
      // 先攻（isHome=false）なら自チームを上に、後攻（isHome=true）なら下に
      if (isHome) return a.isMyTeam ? 1 : -1;
      else return a.isMyTeam ? -1 : 1;
    })
    .map((row, rowIndex) => {
      return (
        <tr key={rowIndex} className={row.isMyTeam ? "bg-gray-100" : ""}>
        <td className={`border ${row.isMyTeam ? "text-red-600 font-bold" : ""}`}>
          <span className="block max-w-[120px] truncate" title={row.name}>
            {row.name}
          </span>
        </td>


          {[...Array(9).keys()].map((i) => {
            const value = row.isMyTeam
              ? isHome
                ? scores[i]?.bottom
                : scores[i]?.top
              : isHome
              ? scores[i]?.top
              : scores[i]?.bottom;

            const target = row.isMyTeam
              ? isHome
                ? "bottom"
                : "top"
              : isHome
              ? "top"
              : "bottom";

            const isHighlight = i + 1 === inning && target === (isTop ? "top" : "bottom");
            const display = isHighlight && value === 0 ? "" : value ?? "";

            return (
            <td
              key={i}
              className={`border cursor-pointer text-center hover:bg-gray-200 ${
                isHighlight ? "bg-yellow-300 font-bold border-2 border-yellow-500" : ""
              }`}
              onClick={() => {
                const clickedInning = i + 1;

                // そのセルが表/裏どちらか（この行＋ホーム/ビジターから既に算出済みの target を使う）
                const clickedHalf: "top" | "bottom" = target as "top" | "bottom";

                // 半回の序列: 表=0, 裏=1
                const currentHalfIndex = isTop ? 0 : 1;
                const clickedHalfIndex = clickedHalf === "top" ? 0 : 1;

                // いま進行中の半回は編集禁止
                const isCurrentHalf =
                  clickedInning === inning && clickedHalfIndex === currentHalfIndex;

                // 未来（現在より後）の半回は編集禁止
                const isFuture =
                  clickedInning > inning ||
                  (clickedInning === inning && clickedHalfIndex > currentHalfIndex);

                if (isCurrentHalf || isFuture) return;

                // ここまで来たら「過去の半回」= 編集OK（同回のもう片方もOK）
                setEditInning(clickedInning);
                setEditTopBottom(clickedHalf);
                const existing = scores[i]?.[clickedHalf];
                setInputScore(existing !== undefined ? String(existing) : "");
                setShowModal(true);
              }}
            >
              {i + 1 > inning ? "" : display}
            </td>
            );
          })}
          <td className="border font-bold text-center">
            {(() => {
              const nInning = Number(inning);

              const rowHalf: "top" | "bottom" = row.isMyTeam
                ? (isHome ? "bottom" : "top")
                : (isHome ? "top" : "bottom");

              return Object.values(scores).reduce((sum, s, idx) => {
                const inningNo = idx + 1;
                if (inningNo > nInning) return sum; // ★選択回より先は足さない
                return sum + (s?.[rowHalf] ?? 0);
              }, 0);
            })()}
          </td>

        </tr>
      );
    })}
  </tbody>
        </table>
      </section>
      <div className="relative w-full max-w-2xl mx-auto my-6">
        <img src="/field.png" alt="フィールド図" className="w-full rounded shadow" />
        {positions.map(pos => {
          const playerId = assignmentsForDisplay[pos]; // ★ 表示用に差し替え
          const playerNameNum = getPlayerNameNumber(playerId);
          return (            
          <div
            key={pos}
            className="absolute text-base font-bold text-white bg-black bg-opacity-60 rounded px-1 py-0.5 whitespace-nowrap text-center"
            style={{ 
              ...positionStyles[pos], 
              transform: 'translate(-50%, -50%)', 
              minWidth: '80px' 
            }}
          >
            {playerNameNum ?? <span className="text-gray-300">DHなし</span>}
          </div>
          );
        })}
      </div>

{/* 投球数（左=－1｜中央=表示｜右=＋1）  ※ボタン比率 1:1 */}
<div className="w-full grid grid-cols-12 items-center gap-2 sm:gap-3 my-2">
  {/* －1（4/12） */}
  <button
    onClick={subtractPitch}
    className="col-span-4 w-full h-10 rounded bg-yellow-500 text-white hover:bg-yellow-600 whitespace-nowrap"
  >
    ⚾︎投球数－１
  </button>

  {/* 中央表示（4/12） */}
<div className="col-span-4 min-w-0 text-center leading-tight">
  {/* この回の投球数 */}
  <p className="whitespace-nowrap leading-none tracking-tight text-[clamp(13px,3.6vw,18px)]">
    <span className="font-semibold align-middle">この回の投球数:</span>{" "}
    <strong className="tabular-nums align-middle text-[clamp(14px,4.2vw,20px)]">
      {currentPitchCount}
    </strong>
  </p>

{/* 累計投球数（タップで変更） */}
<button
  type="button"
  onClick={() => openTotalPitchModal(totalPitchCount)}
  className="
    mt-1 inline-flex items-center gap-2
    rounded-full bg-emerald-600 text-white
    px-3 py-1.5
    shadow-md
    active:scale-[0.97]
    focus:outline-none
  "
>
  <span className="text-xs opacity-90">累計投球数</span>
  <span className="font-bold tabular-nums text-base">
    {totalPitchCount}
  </span>
  <span className="text-xs opacity-80">球</span>
</button>


</div>


  {/* ＋1（4/12） */}
  <button
    onClick={addPitch}
    className="col-span-4 w-full h-10 rounded bg-green-500 text-white hover:bg-green-600 whitespace-nowrap"
  >
    ⚾️投球数＋１
  </button>
</div>





{/* 🔽 マイクアイコン付きアナウンスエリア */}
{announceMessages.length > 0 && (
  <div className="border border-red-500 bg-red-200 text-red-700 p-4 rounded relative text-left">
    {/* 🔴 上段：マイクアイコン + 注意書き */}
    <div className="flex items-start gap-2">
      <img src="/mic-red.png" alt="mic" className="w-6 h-6 mt-[-2px]" />
      <div className="bg-yellow-100 text-yellow-800 border-l-4 border-yellow-500 px-4 py-0.5 text-sm font-semibold whitespace-nowrap leading-tight mt-[-2px]">
        <span className="mr-2 text-2xl">⚠️</span> 守備回終了時に🎤
      </div>
    </div>

    {/* 🔽 下段：アナウンスメッセージとボタン（縦に表示） */}
    <div className="flex flex-col text-red-600 text-lg font-bold space-y-1 mt-2 leading-tight">
      {announceMessages.map((msg, index) => (
        <p
          key={index}
          className="leading-tight"
          dangerouslySetInnerHTML={{ __html: msg }}
        />
      ))}

      {/* ボタン（横並び） */}
      {/* 読み上げ／停止（横いっぱい・等幅、改行なし） */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          onClick={handleSpeak}
          className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                    inline-flex items-center justify-center gap-2"
        >
          <span className="inline-flex items-center gap-2 whitespace-nowrap align-middle">
            <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
            <span className="leading-none">読み上げ</span>
          </span>

        </button>

        <button
          onClick={handleStop}
          className="w-full h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white
                    inline-flex items-center justify-center"
        >
          <span className="whitespace-nowrap leading-none">停止</span>
        </button>
      </div>

    </div>
  </div>
)}

{/* 🔽 守備交代 + 得点±1 + イニング終了（1行固定） */}
<div className="my-6 flex gap-2">
  {/* 守備交代 */}
  <button
    type="button"
    onClick={onChangeDefense}
    className="
      flex-1 h-14
      bg-orange-500 hover:bg-orange-600
      text-white font-bold
      rounded-xl shadow-lg
      flex items-center justify-center
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
    "
  >
    🔀守備交代
  </button>

  {/* 得点 -1 */}
  <button
    type="button"
    onClick={() => changeRun(-1)}
    className="
      flex-[0.6] h-14 min-w-0
      bg-red-600 hover:bg-red-700
      text-white font-extrabold
      text-[clamp(12px,3.5vw,16px)]
      rounded-xl shadow-lg
      flex items-center justify-center
      whitespace-nowrap leading-none
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
      ring-4 ring-red-400/40
    "
  >
    得点−1
  </button>


  {/* 得点 +1 */}
  <button
    type="button"
    onClick={() => changeRun(+1)}
    className="
      flex-1 h-14
      bg-blue-600 hover:bg-blue-700
      text-white font-extrabold text-lg
      rounded-xl shadow-lg
      flex items-center justify-center
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
      ring-4 ring-blue-400/40
    "
  >
    得点＋1
  </button>

  {/* イニング終了（右端） */}
  <button
    type="button"
    onClick={async () => {
      const idx = Number(inning) - 1;
      const half: "top" | "bottom" = isTop ? "top" : "bottom";
      const currentScore = scores?.[idx]?.[half] ?? 0;

      setInputScore(String(currentScore));
      setScoreOverwrite(true);
      setEditInning(null);
      setEditTopBottom(null);
      setShowModal(true);
    }}
    className="
      flex-[1.4] h-14 min-w-0
      bg-black hover:bg-gray-900
      text-white font-extrabold
      text-[clamp(13px,3.6vw,18px)]
      tracking-wider
      rounded-xl shadow-lg
      flex items-center justify-center gap-2
      whitespace-nowrap leading-none
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
      ring-4 ring-gray-400/40
    "
  >
    ⚾イニング終了
  </button>

</div>



{/* ✅ 臨時代走確認モーダル（スマホ風・中央表示・機能そのまま） */}
{showTempReentryModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 画面中央カード */}
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
        aria-label="臨時代走の戻り"
      >
        {/* ヘッダー（グラデ＋白） */}
        <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold tracking-wide text-center">臨時代走の戻り</h2>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          {/* 🎤 マイクアイコン + 文言エリア（薄赤） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-start gap-2">

              <div className="whitespace-pre-wrap text-left min-h-[64px] font-bold text-red-700">
                {reEntryMessage || "対象選手なし"}
              </div>
            </div>

            {/* 読み上げ・停止（横いっぱい 1/2ずつ） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              {/* 読み上げ（左） */}
              <button
                type="button"
                onClick={() => { if (reEntryMessage) void ttsSpeak(reEntryMessage, { progressive:true, cache:true }); }}
                className="w-full px-3 py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-semibold
                          shadow active:scale-95 inline-flex items-center justify-center gap-2"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="leading-none">読み上げ</span>
              </button>

  {/* 停止（右） */}
  <button
    type="button"
    onClick={() => ttsStop()}
    className="w-full px-3 py-3 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-semibold
               shadow active:scale-95"
  >
    停止
  </button>
</div>

          </div>
        </div>

        {/* フッター（確定／キャンセル） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <div className="grid grid-cols-2 gap-2">
            <button
              className="px-3 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
              onClick={async () => {
                // ▼臨時代走フラグを消す（既存ロジックのまま）
// ▼臨時代走フラグを消す（既存）
const key = "tempRunnerByOrder";
const map = (await localForage.getItem<Record<number, number>>(key)) || {};

if (typeof reEntryTarget?.index === "number") {
  delete map[reEntryTarget.index];
  await localForage.setItem(key, map);

  // ▼battingOrder の reason を保存値で復元（"代打" 固定はやめる）
  const prevKey = "prevReasonByOrder";
  const prevMap =
    (await localForage.getItem<Record<number, string | null>>(prevKey)) || {};

  const order: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];

  if (order[reEntryTarget.index]) {
    const prev = prevMap[reEntryTarget.index];
    order[reEntryTarget.index] =
      prev ? { id: order[reEntryTarget.index].id, reason: prev }
           : { id: order[reEntryTarget.index].id };

    await localForage.setItem("battingOrder", order);
    setBattingOrder(order);

    // 復元したので prev を片付け
    delete prevMap[reEntryTarget.index];
    await localForage.setItem(prevKey, prevMap);
  }
} else {
  //（該当インデックス不明時は「臨時代走」全枠に対して復元）
  const prevKey = "prevReasonByOrder";
  const prevMap =
    (await localForage.getItem<Record<number, string | null>>(prevKey)) || {};

  const order: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];

  let changed = false;
  order.forEach((e, i) => {
    if (e?.reason === "臨時代走") {
      const prev = prevMap[i];
      order[i] = prev ? { id: e.id, reason: prev } : { id: e.id };
      delete map[i];
      delete prevMap[i];
      changed = true;
    }
  });

  await localForage.setItem(key, map);
  await localForage.setItem(prevKey, prevMap);
  if (changed) {
    await localForage.setItem("battingOrder", order);
    setBattingOrder(order);
  }
}

// （以降の共通片付けや showConfirmModal 分岐は既存のままでOK）


                // ▼共通の後片付け
                setReEntryMessage("");
                setReEntryTarget(null);
                window.speechSynthesis?.cancel();
                setShowTempReentryModal(false);

                // ★ 分岐：他に「代打／代走」が残っていれば確認モーダル、無ければ守備交代画面へ
                const orderNow: Array<{ id: number; reason?: string }> =
                  (await localForage.getItem("battingOrder")) || [];
                const hasOtherSubs = orderNow.some(
                  (e) => e?.reason === "代打" || e?.reason === "代走"
                );

                if (hasOtherSubs) {
                  setShowConfirmModal(true);
                } else {
                  setShowConfirmModal(false);  // → そのまま守備“画面”に留まる（遷移しない）
                }
              }}
            >
              確定
            </button>

            <button
              className="px-3 py-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold"
              // （臨時代走モーダル内）キャンセル
              onClick={async () => {
                // ▼ 臨時代走の記憶をクリア
const key = "tempRunnerByOrder";
const map = (await localForage.getItem<Record<number, number>>(key)) || {};
if (typeof reEntryTarget?.index === "number") {
  delete map[reEntryTarget.index];
  await localForage.setItem(key, map);

  // ▼ battingOrder.reason を保存値で復元
  const prevKey = "prevReasonByOrder";
  const prevMap =
    (await localForage.getItem<Record<number, string | null>>(prevKey)) || {};

  const order: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];

  if (order[reEntryTarget.index]?.reason === "臨時代走") {
    const prev = prevMap[reEntryTarget.index];
    order[reEntryTarget.index] =
      prev ? { id: order[reEntryTarget.index].id, reason: prev }
           : { id: order[reEntryTarget.index].id };

    await localForage.setItem("battingOrder", order);
    setBattingOrder(order);

    delete prevMap[reEntryTarget.index];
    await localForage.setItem(prevKey, prevMap);
  }
} else {
  // インデックス不明時の保険（全枠スキャン）
  const prevKey = "prevReasonByOrder";
  const prevMap =
    (await localForage.getItem<Record<number, string | null>>(prevKey)) || {};

  const order: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("battingOrder")) || [];

  let changed = false;
  order.forEach((e, i) => {
    if (e?.reason === "臨時代走") {
      const prev = prevMap[i];
      order[i] = prev ? { id: e.id, reason: prev } : { id: e.id };
      delete map[i];
      delete prevMap[i];
      changed = true;
    }
  });

  await localForage.setItem(key, map);
  await localForage.setItem(prevKey, prevMap);
  if (changed) {
    await localForage.setItem("battingOrder", order);
    setBattingOrder(order);
  }
}
                // ▼既存の閉じ動作
                setReEntryMessage("");
                setReEntryTarget(null);
                window.speechSynthesis?.cancel();
                setShowTempReentryModal(false);
                setShowConfirmModal(true);
              }}
            >
              キャンセル
            </button>
          </div>
          {/* iPhone セーフエリア */}
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* ✅ 代打/代走確認モーダル（スマホ風・中央表示・機能そのまま） */}
{showConfirmModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ（タップでは閉じない＝機能そのまま） */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 画面中央カード */}
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
        aria-label="代打・代走 守備位置設定の確認"
      >
        {/* ヘッダー（グラデ＋白） */}
        <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold tracking-wide text-center">守備位置の設定</h2>
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          <h3 className="text-xl font-bold text-red-600 leading-tight text-center">
            <span>代打/代走の選手の守備位置を</span>{" "}
            <span className="whitespace-nowrap">設定して下さい</span>
          </h3>

          {/* ▼ ここに結果をその場表示（機能は既存のまま） */}
          {reEntryMessage && (
            <div className="mt-1 space-y-3">
              {(!reEntryTarget || reEntryMessage === "対象選手なし") ? (
                <div className="text-sm text-slate-700 border rounded-xl p-3 bg-slate-50 text-center">
                  対象選手なし
                </div>
              ) : (
                <>
                  <div className="whitespace-pre-wrap text-left border rounded-xl p-3 bg-slate-50">
                    {reEntryMessage}
                  </div>
                  <div className="flex flex-wrap gap-2 justify-center">
                    <button
                      className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
                      onClick={() => { if (reEntryMessage) void ttsSpeak(reEntryMessage, { progressive:true, cache:true }); }}
                    >
                     
                       読み上げ
                    </button>
                    <button
                      className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
                      onClick={() => ttsStop()}
                    >
                      停止
                    </button>
                    <button
                      className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white"
                      onClick={async () => {
                        if (!reEntryTarget) return;
                        if (reEntryTarget.fromPos === "投") {
                          alert("投手は投手としてのリエントリーはできません。守備位置を調整してください。");
                          return;
                        }
                        const curAssign: Record<string, number | null> =
                          (await localForage.getItem("lineupAssignments")) || assignments || {};
                        const nextAssign = { ...curAssign };
                        nextAssign[reEntryTarget.fromPos] = reEntryTarget.id;
                        setAssignments(nextAssign);
                        await localForage.setItem("lineupAssignments", nextAssign);

                        const usedNow: Record<number, any> =
                          (await localForage.getItem("usedPlayerInfo")) || {};
                        usedNow[reEntryTarget.id] = {
                          ...(usedNow[reEntryTarget.id] || {}),
                          hasReentered: true,
                        };
                        await localForage.setItem("usedPlayerInfo", usedNow);

                        // 閉じる処理（この確認モーダルは用途次第で閉じてもOK）
                        setReEntryMessage("");
                        setReEntryTarget(null);
                        window.speechSynthesis?.cancel();
                      }}
                    >
                      確定
                    </button>
                    <button
                      className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white"
                      onClick={() => {
                        setReEntryMessage("");
                        setReEntryTarget(null);
                        window.speechSynthesis?.cancel();
                      }}
                    >
                      キャンセル
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* フッター（OK＝守備交代へ） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => {
              setShowConfirmModal(false);
              onChangeDefense(); // モーダル経由で守備画面へ
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl shadow-md font-semibold"
          >
            ＯＫ
          </button>
          {/* iPhone セーフエリア */}
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* ✅ 投球制限数のお知らせ（スマホ風・中央表示・機能変更なし） */}
{showPitchLimitModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 画面中央カード */}
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
        aria-label="投球制限数のお知らせ"
      >
        {/* ヘッダー（グラデ＋白） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold tracking-wide">投球制限数のお知らせ</h2>
          <button
            onClick={() => { setShowPitchLimitModal(false); setPitchLimitMessages([]); }}
            aria-label="閉じる"
            className="rounded-full w-9 h-9 flex items-center justify-center
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          {/* アナウンス枠（薄い赤） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            <div className="flex items-start gap-2 mb-2">
              <img src="/mic-red.png" alt="mic" className="w-5 h-5 translate-y-0.5" />
              <span className="text-sm font-semibold text-red-700">アナウンス</span>
            </div>

            <div className="text-red-700 text-base font-bold space-y-2">
              {pitchLimitMessages.map((msg, idx) => (
                <p key={idx}>{msg}</p>
              ))}
            </div>

            {/* 読み上げ／停止（横いっぱい・等幅、改行なし） */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                onClick={handlePitchLimitSpeak}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                          inline-flex items-center justify-center gap-2 shadow-md"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap leading-none">読み上げ</span>
              </button>

              <button
                onClick={handleStop}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                          inline-flex items-center justify-center shadow-md"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>

          </div>
        </div>

        {/* フッター（OKは枠の外） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => {
              setShowPitchLimitModal(false);
              setPitchLimitMessages([]);
            }}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          {/* iPhone セーフエリア */}
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* ✅ 得点入力時のポップアップ（スマホ風・中央配置・機能そのまま） */}
{showModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 画面中央にカード配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full max-w-sm
          max-h-[80vh]
          overflow-hidden
          flex flex-col
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 固定ヘッダー（他モーダルと統一トーン） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold tracking-wide">この回の得点を入力してください</h2>
          {/* ×は置かず機能据え置き */}
          <div className="w-9 h-9" />
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          {/* 現在入力中のスコア表示 */}
          <div className="mx-auto w-full max-w-[220px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-center shadow-sm">
              <div className="text-4xl font-extrabold tabular-nums tracking-wider text-slate-900">
                {inputScore || "0"}
              </div>
            </div>
          </div>

          {/* 数字キー（3列／0は横長） */}
          <div className="grid grid-cols-3 gap-2">
            {[..."1234567890"].map((digit) => (
              <button
                key={digit}
                onClick={() => handleScoreInput(digit)}   // ★ ここが唯一の変更点
                aria-label={`数字${digit}`}
                className={[
                  "h-14 rounded-xl text-xl font-bold text-white",
                  "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] transition shadow-md",
                  digit === "0" ? "col-span-3" : ""
                ].join(" ")}
              >
                {digit}
              </button>
            ))}
          </div>

        </div>

        {/* 固定フッター（OK / クリア / キャンセル） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={confirmScore}
              className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md"
            >
              OK
            </button>
            <button
              onClick={() => setInputScore("")}
              className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-md"
            >
              クリア
            </button>
            <button
              onClick={() => {
                setInputScore("");
                setShowModal(false);
                setEditInning(null);
                setEditTopBottom(null);
              }}
              className="h-12 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-semibold shadow-md"
            >
              キャンセル
            </button>
          </div>
          {/* iPhone セーフエリア */}
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{/* ✅ 累計投球数入力時のポップアップ（スマホ風・中央配置・機能そのまま） */}
{showTotalPitchModal && (
  <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
    {/* 背景 */}
    <div
      className="absolute inset-0 bg-black/50"
      onClick={() => setShowTotalPitchModal(false)}
    />

    {/* モーダル本体 */}
    <div
      className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-4 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      {/* ヘッダー：タイトル中央、閉じる右 */}
      <div className="relative flex items-center justify-center">
        <div className="text-lg font-semibold">累計投球数を変更</div>
        <button
          type="button"
          className="absolute right-0 px-3 py-2 rounded-lg bg-slate-100 text-slate-700"
          onClick={() => setShowTotalPitchModal(false)}
        >
          閉じる
        </button>
      </div>

      {/* 現在値ボックス */}
      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4 text-center">
        <div className="text-sm text-slate-500">現在の累計投球数</div>
        <div className="mt-2 text-4xl font-bold tabular-nums">
          {totalPitchInput?.trim() ? totalPitchInput : "0"}
        </div>
      </div>

      {/* -1 / クリア / +1 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        <button
          type="button"
          className="py-3 rounded-xl bg-red-600 text-white font-semibold active:scale-[0.99]"
          onClick={() => {
            const n = Number(totalPitchInput || "0");
            const next = Number.isFinite(n) ? Math.max(0, Math.floor(n) - 1) : 0;
            setTotalPitchInput(String(next));
          }}
        >
          −1球
        </button>

        <button
          type="button"
          className="py-3 rounded-xl bg-slate-900 text-white font-semibold active:scale-[0.99]"
          onClick={() => setTotalPitchInput("")}
        >
          クリア
        </button>

        <button
          type="button"
          className="py-3 rounded-xl bg-blue-600 text-white font-semibold active:scale-[0.99]"
          onClick={() => {
            const n = Number(totalPitchInput || "0");
            const next = Number.isFinite(n) ? Math.max(0, Math.floor(n) + 1) : 1;
            setTotalPitchInput(String(next));
          }}
        >
          ＋1球
        </button>
      </div>

      {/* 10キー＋確定 */}
      <div className="mt-4 grid grid-cols-3 gap-3">
        {["1","2","3","4","5","6","7","8","9"].map((d) => (
          <button
            key={d}
            type="button"
            className="py-5 rounded-2xl bg-slate-200 text-2xl font-semibold active:scale-[0.99]"
            onClick={() => {
              setTotalPitchInput((prev) => {
                const next = ((prev ?? "") + d).replace(/^0+(?=\d)/, "");
                return next.slice(0, 4); // 上限4桁（必要なら変更）
              });
            }}
          >
            {d}
          </button>
        ))}

        {/* 0（左下） */}
        <button
          type="button"
          className="py-5 rounded-2xl bg-slate-200 text-2xl font-semibold active:scale-[0.99]"
          onClick={() => setTotalPitchInput((prev) => (prev ? prev + "0" : "0"))}
        >
          0
        </button>

        {/* 確定（右下：2列分） */}
        <button
          type="button"
          className="col-span-2 py-5 rounded-2xl bg-emerald-600 text-white text-2xl font-semibold active:scale-[0.99]"
          onClick={async () => {
            const n = Number(totalPitchInput || "0");
            const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;

            const pitcherId = assignments["投"];
            if (typeof pitcherId !== "number") {
              setShowTotalPitchModal(false);
              return;
            }

            // ① まず state（唯一の正）を更新
            setPitcherTotals((prev) => ({ ...prev, [pitcherId]: safe }));
            // ② 表示用 totalPitchCount を残すなら揃える（派生にできるなら不要）
            setTotalPitchCount(safe);
            // ③ localForage に保存（その他モーダルと一致させる）
            const map =
              (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};
            map[pitcherId] = safe;
            await localForage.setItem("pitcherTotals", map);
            // ④ pitchCounts.total も揃える（守備画面再読込でも一致）
            await localForage.setItem("pitchCounts", {
              current: currentPitchCount, // この回の投球数はそのまま
              total: safe,
              pitcherId,
            });

            // --- アナウンス更新（確定時） ---
            const pitcher = teamPlayers.find((p) => p.id === pitcherId);

            if (pitcher) {
              const suffix = pitcher.isFemale ? "さん" : "くん";
              const pitcherRuby = nameRubyHTML(pitcher); // ふりがなルビ（名なしなら姓だけになる実装にしている前提）

              const msgs: string[] = [];
              msgs.push(`ピッチャー${pitcherRuby}${suffix}、この回の投球数は${currentPitchCount}球です`);
              msgs.push(`トータル${safe}球です`);

              setAnnounceMessages(msgs);
            }

            setShowTotalPitchModal(false);
          }}
        >
          確定
        </button>

      </div>
    </div>
  </div>
)}



    </div>
  );
};

export default DefenseScreen;
