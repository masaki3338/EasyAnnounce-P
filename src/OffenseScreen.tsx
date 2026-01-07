import React, { useState, useEffect, useRef, useMemo } from "react";

import localForage from "localforage";

import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { useDrag, useDrop } from "react-dnd";
import { useNavigate } from "react-router-dom";
import { speak, stop } from "./lib/tts";

// "15:40" や "15：40" → "15時40分"
// "15:40〜17:00" → "15時40分から17時00分"
function normalizeJapaneseTime(text: string): string {
  if (!text) return text;

  // 時刻範囲（〜, -, − なども許容）
  text = text.replace(
    /(\d{1,2})[:：](\d{2})\s*[~〜\-−]\s*(\d{1,2})[:：](\d{2})/g,
    (_, h1, m1, h2, m2) => {
      const H1 = String(parseInt(h1, 10));
      const M1 = String(parseInt(m1, 10));
      const H2 = String(parseInt(h2, 10));
      const M2 = String(parseInt(m2, 10));
      return `${H1}時${M1}分から${H2}時${M2}分`;
    }
  );

  // 単独の時刻
  text = text.replace(
    /(\d{1,2})[:：](\d{2})(?!\d)/g,
    (_, h, m) => {
      const H = String(parseInt(h, 10));
      const M = String(parseInt(m, 10));
      return `${H}時${M}分`;
    }
  );

  return text;
}

// 表示用HTML => 読み上げ用テキストに変換（<ruby>は rt 優先、<br> は改行）
function htmlToTtsText(html: string): string {
  if (!html) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // rubyは rt(ふりがな) を優先。無ければベース文字を読む
  doc.querySelectorAll("ruby").forEach(ruby => {
    const rt = ruby.querySelector("rt")?.textContent?.trim();
    const rb = ruby.querySelector("rb");
    const base = (rb?.textContent ?? ruby.childNodes[0]?.textContent ?? "").trim();
    const spoken = rt && rt.length > 0 ? rt : base;
    const span = doc.createElement("span");
    span.textContent = spoken;
    ruby.replaceWith(span);
  });

  // <br> → 改行
  doc.querySelectorAll("br").forEach(br => br.replaceWith(doc.createTextNode("\n")));

  // テキスト抽出＆整形
  let text = doc.body.textContent || "";
  text = text
    .replace(/[ \t\u3000]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  // ✅ 「回表／回裏」を TTS 用に読み替え
  text = text.replace(/回表/g, "回おもて");

  // ✅ ルビ → かな（TTS用）
  text = text
    .replace(/<ruby>\s*([^<]*)\s*<rt>\s*([^<]*)\s*<\/rt>\s*<\/ruby>/g, "$2")
    .replace(/<rt>\s*<\/rt>/g, "");

  // ✅ 「回表／回裏」→「回おもて／回うら」
  text = text.replace(/回表/g, "回おもて").replace(/回裏/g, "回うら");
  
  // ✅ 「4番」→「よばん」（14番/40番などは変更しない）
  text = text.replace(/(^|[^0-9])4番(?![0-9])/g, "$1よばん");

  return text;
}

// 「アナウンス文言エリア」に現在表示されている内容を読ませる
async function speakFromAnnouncementArea(
  announcementHTMLOverrideStr?: string,
  announcementHTMLStr?: string,
) {
  const html = announcementHTMLOverrideStr || announcementHTMLStr || "";
  let text = htmlToTtsText(html);
  text = normalizeJapaneseTime(text); // ← 追加：時刻の読み上げを「時・分」に直す
  if (!text) return;
  await speak(text); // VOICEVOX優先（失敗時 Web Speech）
}

// === TIEBREAK OFFENSE ANNO: helpers start ===
const TBA_POS_JP: Record<string, string> = {
  "投": "ピッチャー", "捕": "キャッチャー", "一": "ファースト", "二": "セカンド",
  "三": "サード", "遊": "ショート", "左": "レフト", "中": "センター",
  "右": "ライト", "指": "指名打者",
};
const tbaHonor = (p: any) => (p?.isFemale ? "さん" : "くん");
const tbaGetPos = (assignments: Record<string, number|null>, pid: number) => {
  const hit = Object.entries(assignments || {}).find(([, v]) => v === pid);
  if (!hit) return "（守備未設定）";
  const key = hit[0];
  return TBA_POS_JP[key] ?? key;
};
const tbaSafeIdArray = (order: any[]): number[] =>
  (order || []).map((e: any) => (typeof e === "number" ? e : e?.id)).filter((x: any) => Number.isFinite(x));
// === TIEBREAK OFFENSE ANNO: helpers end ===


const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

type OffenseScreenProps = {
  onSwitchToDefense: () => void;
  onGoToSeatIntroduction: () => void;
  onBack?: () => void;
};


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


// 例: "09:30" / "9:30" / "2025-09-12T09:30" / Date を想定
const formatJaTime = (t: string | Date | undefined | null): string => {
  if (!t) return "—";
  if (t instanceof Date) {
    const h = t.getHours();
    const m = t.getMinutes();
    return `${h}時${String(m).padStart(2, "0")}分`;
  }
  // "HH:mm" or "H:mm" or "HH:mm:ss"
  const m1 = t.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m1) {
    const h = parseInt(m1[1], 10);
    const m = m1[2]; // 分は先頭0保持
    return `${h}時${m}分`;
  }
  // ISOっぽい文字列も許容
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) {
    const h = d.getHours();
    const m = d.getMinutes();
    return `${h}時${String(m).padStart(2, "0")}分`;
  }
  // どうしても解釈できなければ原文
  return t;
};

const formatNumberBadge = (num?: string | number) => {
  // null/undefined/空文字は「#」のみ
  if (num === undefined || num === null || `${num}`.trim() === "") return "#";
  return `#${num}`;
};

const hasNumber = (num?: string | number) =>
  !(num === undefined || num === null || `${num}`.trim() === "");

const DraggablePlayer = ({ player }: { player: any }) => {
  const [, drag] = useDrag({
    type: "player",
    item: { player },
  });
  return (
    <div
      ref={drag}
      className="cursor-pointer hover:bg-gray-100 border p-2 rounded bg-white"
    >
      {player.lastName} {player.firstName} #{player.number}
    </div>
  );
};

// ⬇️ ドロップ先（1塁・2塁・3塁ランナー）
const DropTarget = ({ base, runnerAssignments, replacedRunners, setRunnerAssignments, setReplacedRunners }: any) => {
  const [, drop] = useDrop({
    accept: "player",
    drop: (item: any) => {
      const replaced = runnerAssignments[base];
      setRunnerAssignments((prev: any) => ({ ...prev, [base]: item.player }));
      setReplacedRunners((prev: any) => ({ ...prev, [base]: replaced || null }));
    },
  });

  const runner = runnerAssignments[base];
  const replaced = replacedRunners[base];

  return (
    <div ref={drop} className="p-2 border rounded bg-gray-100 min-h-[60px]">
      <div className="text-lg font-bold text-red-600">{base}ランナー</div>
      {replaced && (
        <div className="line-through text-black">
          {replaced.lastName} {replaced.firstName} #{replaced.number}
        </div>
      )}
      {runner && (
        <div className="text-red-600">
          {runner.lastName} {runner.firstName} #{runner.number}
        </div>
      )}
    </div>
  );
};

const positionNames: { [key: string]: string } = {
  "投": "ピッチャー",
  "捕": "キャッチャー",
  "一": "ファースト",
  "二": "セカンド",
  "三": "サード",
  "遊": "ショート",
  "左": "レフト",
  "中": "センター",
  "右": "ライト",
  "指": "指名打者",  
};

// 先頭付近（型エラー防止）
declare global { interface Window { prefetchTTS?: (t: string) => void } }




//const OffenseScreen: React.FC<OffenseScreenProps> = ({ onSwitchToDefense, onBack }) => {
const OffenseScreen: React.FC<OffenseScreenProps> = ({
  onSwitchToDefense,
  onGoToSeatIntroduction, // ← 追加！！
  matchInfo,
}) => {  
  const [players, setPlayers] = useState<any[]>([]);
  const [allPlayers, setAllPlayers] = useState<any[]>([]);
  const [battingOrder, setBattingOrder] = useState<
    { id: number; reason: string }[]
  >([]);
  const [assignments, setAssignments] = useState<{ [pos: string]: number | null }>({});
  const [currentBatterIndex, setCurrentBatterIndex] = useState(0);
  const [announcement, setAnnouncement] = useState<React.ReactNode>(null);
  const [announcementOverride, setAnnouncementOverride] = useState<React.ReactNode | null>(null);
  const [scores, setScores] = useState<{ [inning: number]: { top: number; bottom: number } }>({});
  const [isLeadingBatter, setIsLeadingBatter] = useState(true);
  const [announcedPlayerIds, setAnnouncedPlayerIds] = useState<number[]>([]);
  const [substitutedIndices, setSubstitutedIndices] = useState<number[]>([]);
  const [selectedRunnerIndex, setSelectedRunnerIndex] = useState<number | null>(null);
  const [selectedSubRunner, setSelectedSubRunner] = useState<any | null>(null);
  const [selectedBase, setSelectedBase] = useState<"1塁" | "2塁" | "3塁" | null>(null);
  const [teamName, setTeamName] = useState("");
  const [opponentTeam, setOpponentTeam] = useState("");
  const [inning, setInning] = useState(1);
  const [isTop, setIsTop] = useState(true);
  const [isHome, setIsHome] = useState(false); // 自チームが後攻かどうか
  const [showGroundPopup, setShowGroundPopup] = useState(false);
  const [pendingGroundPopup, setPendingGroundPopup] = useState(false);
  const [announcementHTMLStr, setAnnouncementHTMLStr] = useState<string>("");
  const [announcementHTMLOverrideStr, setAnnouncementHTMLOverrideStr] = useState<string>("");
  const [tiebreakAnno, setTiebreakAnno] = useState<string | null>(null);
  const [scoreOverwrite, setScoreOverwrite] = useState(true);

  // 🔒 読み上げ連打ロック
  const [speaking, setSpeaking] = useState(false);
  const isSpeakingRef = useRef(false);

  // 🔸 DH解除モーダル表示フラグ
  const [showDhDisableModal, setShowDhDisableModal] = useState(false);
  // 現在DHが有効？
  const dhActive = Boolean(assignments?.["指"]);
  // 現在の投手ID
  const pitcherId = typeof assignments?.["投"] === "number" ? (assignments["投"] as number) : null;
  // DH選手ID
  const dhBatterId = typeof assignments?.["指"] === "number" ? (assignments["指"] as number) : null;
  // DHの打順インデックス
  const dhOrderIndex = useMemo(
    () => (dhBatterId != null ? battingOrder.findIndex(e => e.id === dhBatterId) : -1),
    [battingOrder, dhBatterId]
  );
  // 「今の打者がDH本人か？」
  const isDhTurn = dhActive && dhOrderIndex !== -1 && currentBatterIndex === dhOrderIndex;
  const [startTime, setStartTime] = useState<string | null>(null);
  // ▼ 3回裏のメンバー交換アナウンス表示用
  const [showMemberExchangeModal, setShowMemberExchangeModal] = useState(false);
  const [memberExchangeText, setMemberExchangeText] = useState("");

  // 真偽の型ブレ対応（true/"true"/1 → true）
  const isTruthy = (v: any) => {
    if (v === true) return true;
    if (typeof v === "string") return ["true", "1", "yes", "on"].includes(v.toLowerCase());
    if (typeof v === "number") return v === 1;
    return false;
  };
  // 3回裏 × 「次の試合なし」= NO のとき、得点入力のあとにアナウンスを出すフラグ
  const [pendingMemberExchange, setPendingMemberExchange] = useState(false);
  // アナウンス後に何をするか（得点ポップアップ／グランド整備／守備へ等）
  const [afterMemberExchange, setAfterMemberExchange] = useState<
    "scorePopup" | "groundPopup" | "switchDefense" | "seatIntro" | null
  >(null);

  // 🔸 リエントリー用 state
  const [showReEntryModal, setShowReEntryModal] = useState(false);
  const [reEntryFromPlayer, setReEntryFromPlayer] = useState<any|null>(null); // Aくん（今いる選手）
  const [reEntryTargetPlayer, setReEntryTargetPlayer] = useState<any|null>(null); // Bくん（戻す元スタメン）
  const [reEntryOrder1, setReEntryOrder1] = useState<number|null>(null); // 1始まりの打順
  const [noReEntryMessage, setNoReEntryMessage] = useState<string>("");

  // 🔸 ルビ整形
// 苗字と名前の間に全角スペースを追加（読み上げ時も区切りやすくする）
const rubyFull = (p: any) =>
  `<ruby>${p?.lastName ?? ""}<rt>${p?.lastNameKana ?? ""}</rt></ruby> ` +  // ← 半角スペース追加
  `<ruby>${p?.firstName ?? ""}<rt>${p?.firstNameKana ?? ""}</rt></ruby>`;

  const rubyLast = (p: any) =>
    `<ruby>${p?.lastName ?? ""}<rt>${p?.lastNameKana ?? ""}</rt></ruby>`;
  const rubyFirst = (p: any) =>
    `<ruby>${p?.firstName ?? ""}<rt>${p?.firstNameKana ?? ""}</rt></ruby>`;

  // === NEW: 苗字重複を考慮した名前整形 ==========================
const [dupLastNames, setDupLastNames] = useState<Set<string>>(new Set());

useEffect(() => {
  (async () => {
    const list = (await localForage.getItem<string[]>("duplicateLastNames")) ?? [];
    setDupLastNames(new Set(list.map(s => String(s))));
  })();
}, []);

// preferLastOnly=true: 「苗字のみ」指定を尊重。ただし重複姓ならフルネームを強制
const formatNameForAnnounce = (p: any, preferLastOnly: boolean) => {
  if (!p) return "";
  const ln = String(p.lastName ?? "");
  const forceFull = ln && dupLastNames.has(ln);
  if (forceFull) return rubyFull(p);       // 同姓が複数 → フルネーム（ルビ付）
  return preferLastOnly ? rubyLast(p) : rubyFull(p);
};
// =============================================================
// 苗字のみ指定でも、重複姓ならフルを返す formatNameForAnnounce をそのまま使う描画ヘルパ
const RenderName = ({ p, preferLastOnly }: { p: any; preferLastOnly: boolean }) => (
  <span dangerouslySetInnerHTML={{ __html: formatNameForAnnounce(p, preferLastOnly) }} />
);


  const headAnnounceKeyRef = useRef<string>("");

  // 直前に終了した回情報（得点モーダル表示中に inning/isTop は“次回”へ変わるため）
  const lastEndedHalfRef = useRef<{ inning: number; isTop: boolean } | null>(null);


  // TTS用にHTMLをプレーンテキスト化（rubyは<rt>だけ残す）
  const normalizeForTTS = (input: string) => {
    if (!input) return "";
    let t = input;
    // 典型: <ruby>山田<rt>やまだ</rt></ruby> → やまだ
    t = t.replace(/<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/gms, "$2");
    // rbタグ（使っていれば）: <rb>山田</rb><rt>やまだ</rt> の保険
    t = t.replace(/<\/?rb>/g, "").replace(/<\/?rt>/g, "");
    // 残ったタグは全除去
    t = t.replace(/<[^>]+>/g, "");
    // 連続空白を1つに
    t = t.replace(/\s+/g, " ").trim();
    // 読み固定が必要な語（必要に応じて追加）
    t = t.replace(/投球数/g, "とうきゅうすう");
    // ✅ 回数の読み補正（数字や漢数字 → 読みがな）
    const inningMap: Record<string,string> = {
      "1":"いっかい","一":"いっかい",
      "2":"にかい","二":"にかい",
      "3":"さんかい","三":"さんかい",
      "4":"よんかい","四":"よんかい",
      "5":"ごかい","五":"ごかい",
      "6":"ろっかい","六":"ろっかい",
      "7":"ななかい","七":"ななかい",
      "8":"はちかい","八":"はちかい",
      "9":"きゅうかい","九":"きゅうかい",
      "10":"じゅっかい","十":"じゅっかい",
    };
    // 「○回表／○回裏」をまとめて補正
    t = t.replace(/([0-9一二三四五六七八九十]+)回表/g, (m, p1) => {
      const yomi = inningMap[p1] ?? `${p1}かい`;
      return `${yomi}おもて`;
    });
    t = t.replace(/([0-9一二三四五六七八九十]+)回裏/g, (m, p1) => {
      const yomi = inningMap[p1] ?? `${p1}かい`;
      return `${yomi}うら`;
    });

  // ✅ ルビ → かな（TTS用）
  t = t
    .replace(/<ruby>\s*([^<]*)\s*<rt>\s*([^<]*)\s*<\/rt>\s*<\/ruby>/g, "$2")
    .replace(/<rt>\s*<\/rt>/g, "");

    return t;
  };

  // 代打モーダルのプレビューをそのまま読み上げ
// 代打モーダルのプレビューをそのまま読み上げ（ふりがな優先）
const speakPinchModal = async () => {
  const el = document.getElementById("pinch-preview");
  if (!el) return;

  const raw = el.innerHTML || "";

  // ✅ ルビ → かな（<ruby>漢字<rt>かな</rt></ruby> → かな）
  //   - <rt> が空のルビは無視
  //   - 2語連結（姓・名）の <ruby>…</ruby><ruby>…</ruby> にも対応
  let text = raw
    .replace(/<ruby>\s*([^<]*)\s*<rt>\s*([^<]*)\s*<\/rt>\s*<\/ruby>/g, "$2")
    .replace(/<rt>\s*<\/rt>/g, "")      // 空の rt は除去
    .replace(/<br\s*\/?>/gi, "\n")      // 改行
    .replace(/<[^>]+>/g, " ")           // 残りのタグはスペースに
    .replace(/[ \t\u3000]+/g, " ")      // 連続空白を1つに
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  text = text.replace(/([ぁ-んァ-ヶーｧ-ﾝﾞﾟ一-龥A-Za-z0-9]+)\s+(さん|くん)/g, "$1$2");

  // ✅ 「回表／回裏」は “おもて／うら” と読ませる
  text = text.replace(/回表/g, "回おもて").replace(/回裏/g, "回うら");

  // ✅ 「4番」→「よばん」（14番/40番などは変更しない）
  text = text.replace(/(^|[^0-9])4番(?![0-9])/g, "$1よばん");

  await speak(text, { progressive: true });
};




// 🔸 現在の打順に対してリエントリー対象（元スタメンで退場中）を探す
// 🔍 リエントリー候補の詳細デバッグ版
// 現在の打順に対してリエントリー対象（元スタメンで退場中）を探す
// 現在の打順に対してリエントリー対象（元スタメンで退場中）を探す（厳密版）
const findReentryCandidateForCurrentSpot = async () => {
  console.log("🔍 リエントリー対象判定 ====================");

  // 現在の打順（1始まり/0始まり）
  const order1 = (currentBatterIndex % battingOrder.length) + 1;
  const order0 = currentBatterIndex;
  console.log("現在の打順: 1始まり=", order1, " / 0始まり=", order0);

  // A＝今その枠にいる選手
  const currentEntry = battingOrder[currentBatterIndex];
  const A = currentEntry ? getPlayer(currentEntry.id) : null;
  console.log("A（現在の枠の選手）:", A, "entry:", currentEntry);

  // 現状
  console.log("battingOrder IDs:", battingOrder.map(e => e?.id));
  console.log("assignments:", assignments);

  const isInBatting = (pid: number) => (battingOrder || []).some(e => e?.id === pid);
  const isInDefense = (pid: number) => Object.values(assignments || {}).some(id => Number(id) === Number(pid));


  // 1) 一次ソース：startingBattingOrder の “この打順” の元スタメンを優先
  const startingOrder: Array<{ id: number }> =
    (await localForage.getItem("startingBattingOrder")) || [];
  const starterId = startingOrder[order0]?.id;
  const starter = starterId ? getPlayer(starterId) : null;
  console.log("startingBattingOrder[", order1, "] =", starterId, starter);

  if (starterId) {
    const inBat = isInBatting(starterId);
    const inDef = isInDefense(starterId);
    console.log("元スタメンの現在: inBat=", inBat, " inDef=", inDef);

    if (!inBat && !inDef) {
      console.log("✅ 候補B: startingBattingOrder から採用");
      return { A, B: getPlayer(starterId), order1 };
    }
    // ★ 元スタメンが出場中 → この打順はリエントリー不可。ここで確定的に終わる（fallback 不可）
    console.warn("⛔ 元スタメンが出場中のため、fallback は禁止。アラート経路へ。");
    return { A, B: null, order1 };
  }

  // 2) 二次ソース：starting に記録が無い“レガシー”ケースのみ、usedPlayerInfo で補う
  const upi = (usedPlayerInfo as Record<number, { wasStarter?: boolean; order?: number }>) || {};
  const upiRows = Object.entries(upi).map(([starterId2, info]) => {
    const p = getPlayer(Number(starterId2));
    return {
      starterId: Number(starterId2),
      name: p ? `${p.lastName}${p.firstName}` : "(不明)",
      wasStarter: !!info?.wasStarter,
      infoOrder: info?.order,
    };
  });
  console.table(upiRows);

  // ⚠ order は 1 始まりのみ採用（0/1混在許容はやめる）
  let fallbackId: number | null = null;
  Object.entries(upi).forEach(([starterId2, info]) => {
    if (info?.wasStarter && Number(info?.order) === order1) {
      fallbackId = Number(starterId2);
    }
  });

  if (fallbackId) {
    const inBat = isInBatting(fallbackId);
    const inDef = isInDefense(fallbackId);
    console.log("fallback 候補:", fallbackId, " inBat=", inBat, " inDef=", inDef);
    if (!inBat && !inDef) {
      console.log("✅ 候補B: usedPlayerInfo（保険）から採用");
      return { A, B: getPlayer(fallbackId), order1 };
    }
  }

  console.log("⛔ リエントリー対象なし（アラート経路）");
  return { A, B: null, order1 };
};



// Offense → SeatIntroduction へ行くときの共通ナビ（保存してから遷移）
const goSeatIntroFromOffense = async () => {
  await localForage.setItem("lastScreen", "offense");
  const mi = (await localForage.getItem<any>("matchInfo")) || {};
  // 攻撃中フラグを明示（SeatIntroduction 側の保険にも効かせる）
  if (mi.isDefense !== false) {
    await localForage.setItem("matchInfo", { ...mi, isDefense: false });
  }
  onGoToSeatIntroduction();
};

  const handleStartGame = () => {
    const now = new Date();
    const timeString = now.toLocaleTimeString("ja-JP", { hour: '2-digit', minute: '2-digit' });
    setStartTime(timeString);
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
// 初回アラートを1度だけ出すためのフラグ
const firstOpenAlertShownRef = useRef(false);



  const [gameStartTime, setGameStartTime] = useState<string | null>(null);
  const [showStartTimePopup, setShowStartTimePopup] = useState(false);

  const [announcedIds, setAnnouncedIds] = useState<number[]>([]);

  const [lastPinchAnnouncement, setLastPinchAnnouncement] = useState<React.ReactNode | null>(null);

  // 🔹 通常アナウンスでは 代打/代走 を非表示にする
const displayReasonForLive = (reason?: string) =>
  (reason === "代打" || reason === "代走") ? "" : (reason ?? "");

const [selectedReturnPlayer, setSelectedReturnPlayer] = useState<any|null>(null);

// 初期読み込み（初回レンダリング時）
useEffect(() => {
  localForage.getItem<number[]>("announcedIds").then((saved) => {
    if (Array.isArray(saved)) {
      setAnnouncedIds(saved);
    }
  });
}, []);

// ★ 初回表示から横スクロールを完全禁止
useEffect(() => {
  const html = document.documentElement;
  const body = document.body;

  // 既存値を退避
  const prevHtmlOverflowX = html.style.overflowX;
  const prevBodyOverflowX = body.style.overflowX;
  const prevHtmlOverscrollX = (html.style as any).overscrollBehaviorX;
  const prevBodyOverscrollX = (body.style as any).overscrollBehaviorX;

  // 横スクロール禁止 + 横方向のオーバースクロールも禁止
  html.style.overflowX = "hidden";
  body.style.overflowX = "hidden";
  (html.style as any).overscrollBehaviorX = "none";
  (body.style as any).overscrollBehaviorX = "none";

  return () => {
    // アンマウント時に元へ戻す
    html.style.overflowX = prevHtmlOverflowX;
    body.style.overflowX = prevBodyOverflowX;
    (html.style as any).overscrollBehaviorX = prevHtmlOverscrollX || "";
    (body.style as any).overscrollBehaviorX = prevBodyOverscrollX || "";
  };
}, []);

// タイブレークの塁設定を LocalForage から読み出して [1..3] の数値配列に正規化
// 受理する値の例：
//  - 文字列: "1塁", "2塁", "3塁", "1,2塁", "2,3塁", "満塁", "1・2", "1,2,3"
//  - 配列:   [1,2], [2,3], [1,2,3]
const loadTiebreakBases = async (): Promise<number[]> => {
  // ① 新UIの保存形式を最優先で読む
  const cfg = (await localForage.getItem<{ outs?: string; bases?: string }>("tiebreakConfig")) || null;
  const fromCfg = (() => {
    if (!cfg?.bases) return null;
    const s = String(cfg.bases);
    if (s.includes("満塁")) return [1, 2, 3];
    const m = s.match(/[123]/g);
    if (m) return [...new Set(m.map((n) => Number(n)))].filter((x) => x >= 1 && x <= 3).sort();
    return null;
  })();
  if (fromCfg && fromCfg.length) return fromCfg;

  // ② 旧キー互換
  const raw =
    (await localForage.getItem<any>("tiebreak:bases")) ??
    (await localForage.getItem<any>("tiebreak:setting")) ??
    (await localForage.getItem<any>("tiebreak")) ??
    null;

  const norm = (v: any): number[] => {
    if (Array.isArray(v)) {
      return [...new Set(v.map(Number))].filter((x) => x === 1 || x === 2 || x === 3).sort();
    }
    if (typeof v === "string") {
      const s = v.trim();
      if (s.includes("満塁")) return [1, 2, 3];
      const m = s.match(/[123]/g);
      if (m) return [...new Set(m.map((n) => Number(n)))].filter((x) => x >= 1 && x <= 3).sort();
    }
    if (typeof v === "number" && [1, 2, 3].includes(v)) return [v];
    // 何もなければ後方互換で 1・2塁
    return [1, 2];
  };

  return norm(raw);
};

// クリックされた打順indexからTB文言を作る
// クリックされた打順indexからTB文言を作る
const buildTiebreakTextForIndex = async (idx: number): Promise<string> => {
  // players / battingOrder / assignments / matchInfo は state が未整備でも拾えるようにLFから補完
  const team = (Array.isArray(players) && players.length)
    ? { players }
    : ((await localForage.getItem("team")) as any) || { players: [] };

  const orderIds =
    (Array.isArray(battingOrder) && battingOrder.length)
      ? tbaSafeIdArray(battingOrder as any)
      : (await localForage.getItem<number[]>("battingOrder")) || [];

  const assign =
    (assignments && Object.keys(assignments).length)
      ? assignments
      : ((await localForage.getItem("assignments")) as Record<string, number|null>) || {};

  const match = ((await localForage.getItem("matchInfo")) as any) || {};
  const inningNo = Number(match?.inning) || 0;
  const top = !!match?.isTop;

  const n = orderIds.length || 0;
  if (n === 0) return "";

  // ── 打者と「1人前/2人前/3人前」を取得（循環）
  const idBatter = orderIds[(idx + 0 + n) % n];
  const idR1     = orderIds[(idx - 1 + n) % n]; // 1人前
  const idR2     = orderIds[(idx - 2 + n) % n]; // 2人前
  const idR3     = orderIds[(idx - 3 + n) % n]; // 3人前

  const P = (id: number) => team.players.find((p: any) => p?.id === id);

  const batter = P(idBatter);
  const r1     = P(idR1);
  const r2     = P(idR2);
  const r3     = P(idR3);

  const honor = (p: any) => (p?.isFemale ? "さん" : "くん");
  const inningText = `${inningNo}回の${top ? "表" : "裏"}の攻撃は、`;

  const r1Text = r1
    ? `${(r1.lastName ?? "")}${honor(r1)}、背番号${r1.number ?? "－"}`
    : "（未設定）";
  const r2Text = r2
    ? `${(r2.lastName ?? "")}${honor(r2)}、背番号${r2.number ?? "－"}`
    : "（未設定）";
  const r3Text = r3
    ? `${(r3.lastName ?? "")}${honor(r3)}、背番号${r3.number ?? "－"}`
    : "（未設定）";

  const batterOrderNo = idx + 1;
  const batterPos = batter ? tbaGetPos(assign, batter.id) : "（守備未設定）";
  const batterText = batter
    ? `${batterOrderNo}番、${batterPos}、${(batter.lastName ?? "")}${honor(batter)}`
    : `${batterOrderNo}番、（未設定）`;

  // ── ここから塁の構成を設定に合わせて可変化 ─────────────────────
  const bases = await loadTiebreakBases(); // 例：[1], [2], [3], [1,2], [2,3], [1,2,3]
  const lines: string[] = [];

  // 改行は whitespace-pre-line 前提で先頭に全角スペースを入れる
  if (bases.includes(1)) lines.push(`　ファーストランナーは${r1Text}`);
  if (bases.includes(2)) lines.push(`　セカンドランナーは${r2Text}`);
  if (bases.includes(3)) lines.push(`　サードランナーは${r3Text}`);

  // 旧仕様の固定文面から、設定に応じた行だけ出す
  const runnersPart = lines.join("\n");

  return `${inningText}\n${runnersPart}\n　バッターは${batterText}`;
};



// ✅ 試合開始トークンを検知してチェック類をリセット
useEffect(() => {
  const resetOnGameStart = async () => {
    const token = await localForage.getItem("gameStartToken");
    if (token != null) {
      setCheckedIds([]);
      setAnnouncedIds([]);
      setUsedPlayerInfo({});
      await localForage.removeItem("checkedIds");
      await localForage.removeItem("announcedIds");
      await localForage.removeItem("usedPlayerInfo");
      // リセット済みの合図を消す（次回の再読込でまた動くように）
      await localForage.removeItem("gameStartToken");
    }
  };
  resetOnGameStart();
}, []);


const [hydrated, setHydrated] = useState(false);
const toggleAnnounced = (id: number) => {
  setAnnouncedIds((prev) => {
    const updated = prev.includes(id)
      ? prev.filter((i) => i !== id)
      : [...prev, id];
    localForage.setItem("announcedIds", updated); // 永続化
    return updated;
  });
};
const [checkedIds, setCheckedIds] = useState<number[]>([]);
// ✅ チェック状態を初期読み込み
useEffect(() => {
  localForage.getItem<number[]>("checkedIds").then((saved) => {
    if (Array.isArray(saved)) {
      setCheckedIds(saved);
    }
  });
}, []);

// ✅ チェック状態を切り替えて永続化
const toggleChecked = (id: number) => {
  setCheckedIds((prev) => {
    const updated = prev.includes(id)
      ? prev.filter((x) => x !== id)
      : [...prev, id];
    localForage.setItem("checkedIds", updated); // 永続化
    return updated;
  });
};


// コンポーネント関数内に以下を追加
const handleFoulRead = async () => {
  await speak("ファウルボールの行方には十分ご注意ください");
};
const handleFoulStop = () => {
  stop();
};

  const [usedPlayerInfo, setUsedPlayerInfo] = useState<Record<number, any>>({});
    useEffect(() => {
    const loadUsedInfo = async () => {
      const info = await localForage.getItem<Record<number, any>>("usedPlayerInfo");
      if (info) {
        setUsedPlayerInfo(info);
        console.log("✅ 読み込んだ usedPlayerInfo:", info);
      }
    };
    loadUsedInfo();
  }, []);

  const [showDefensePrompt, setShowDefensePrompt] = useState(false);

  useEffect(() => {
    localForage.setItem("lastGameScreen", "offense");
    const loadData = async () => {
      const team = await localForage.getItem("team");
      let order  = await localForage.getItem<{ id:number; reason?:string }[]>("battingOrder");
      let lineup = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
      const matchInfo = await localForage.getItem<MatchInfo>("matchInfo");
    
      // ★ スタメン最優先：未初期化なら starting* で初期化
      const startingOrder =
        (await localForage.getItem<{ id:number; reason?:string }[]>("startingBattingOrder")) || [];
      const startingAssign =
        (await localForage.getItem<Record<string, number | null>>("startingassignments")) || {};

      if (!order || !Array.isArray(order) || order.length === 0) {
        order = startingOrder.slice(0, 9);                 // 念のため9人に制限
        if (order.length) await localForage.setItem("battingOrder", order);
      }
      if (!lineup || Object.keys(lineup).length === 0) {
        lineup = { ...startingAssign };
        if (Object.keys(lineup).length) await localForage.setItem("lineupAssignments", lineup);
}

      const loadBattingOrder = async () => {
        const order = await localForage.getItem<number[]>("battingOrder");
        if (order) setBattingOrder(order);    
      };
    //loadBattingOrder();

      if (team && typeof team === "object") {
        const all = (team as any).players || [];
        setAllPlayers(all);
        setPlayers(all);
        setTeamName((team as any).name || "");

        // 打順に載っている9人
        const starterIds = new Set(
          (order as { id: number; reason: string }[]).map(e => e.id)
        );

        // ✅ DH稼働中なら「投手」もスタメン扱いに含める
        const dhActive = Boolean((lineup as any)?.["指"]);
        const pitcherStarterId = (lineup as any)?.["投"];
        if (dhActive && typeof pitcherStarterId === "number") {
          starterIds.add(pitcherStarterId);
        }

      // ✅ 代打候補の“控え”はスタメン画面の指定のみを正とする
      const startingBenchOut =
        (await localForage.getItem<number[]>("startingBenchOutIds")) ?? [];

      // 数値に正規化（重複はそもそも無いはずだが保険）
      const benchOutIds = Array.from(
        new Set(startingBenchOut.map((v) => Number(v)).filter(Number.isFinite))
      );

      // 控え＝「全選手 −（スタメン集合 or DHで含めた投手） −（スタメンが指定したベンチ外）」
      const bench = all.filter((p: any) => !starterIds.has(p.id) && !benchOutIds.includes(p.id));
      setBenchPlayers(bench);
// bench を setBenchPlayers(bench) した直後に追記
{
  const starterList = all.filter((p: any) => starterIds.has(p.id));
  const pool = [...starterList, ...bench];

  const cnt = new Map<string, number>();
  pool.forEach((p) => {
    const ln = String(p?.lastName ?? "").trim();
    if (!ln) return;
    cnt.set(ln, (cnt.get(ln) ?? 0) + 1);
  });

  const dups = [...cnt.entries()]
    .filter(([, n]) => n >= 2)
    .map(([ln]) => ln);

  setDupLastNames(new Set(dups));
  await localForage.setItem("duplicateLastNames", dups);
}


      }      
      if (order && Array.isArray(order)) {
        setBattingOrder(order as { id: number; reason: string }[]);

        // ✅ 前回の打者を取得して次の先頭打者に設定
        const lastBatter = await localForage.getItem<number>("lastBatterIndex");
        if (lastBatter !== null && typeof lastBatter === "number" && order.length > 0) {
          const nextBatterIndex = (lastBatter) % order.length;
          setCurrentBatterIndex(nextBatterIndex);
          setIsLeadingBatter(true); // 先頭打者として認識
        }
      }
      if (lineup && typeof lineup === "object") {
        setAssignments(lineup as { [pos: string]: number | null });
      }
      if (matchInfo) {
        setOpponentTeam(matchInfo.opponentTeam || "");
        setInning(matchInfo.inning || 1);
        setIsTop(matchInfo.isTop ?? true);
        setIsHome(matchInfo.isHome ?? false);
      }  

      const savedScores = await localForage.getItem("scores");
      if (savedScores && typeof savedScores === "object") {
        setScores(savedScores as any);
      }
      const savedAnnouncedIds = await localForage.getItem<number[]>("announcedPlayerIds");
      if (savedAnnouncedIds) setAnnouncedPlayerIds(savedAnnouncedIds);
    };
    setHydrated(true);
    loadData();
  }, []);

const [showModal, setShowModal] = useState(false);
const [showScorePopup, setShowScorePopup] = useState(false);
const [shouldNavigateAfterPopup, setShouldNavigateAfterPopup] = useState(false);
const [popupMessage, setPopupMessage] = useState("");
const [inputScore, setInputScore] = useState("");
const [editInning, setEditInning] = useState<number | null>(null);
const [editTopBottom, setEditTopBottom] = useState<"top" | "bottom" | null>(null);
const [showSubModal, setShowSubModal] = useState(false);
const [selectedSubPlayer, setSelectedSubPlayer] = useState<any | null>(null);
const [benchPlayers, setBenchPlayers] = useState<any[]>([]);
// いま守備に就いている選手IDの集合
const onFieldIds = useMemo(() => {
  return new Set(
    Object.values(assignments).filter((v): v is number => typeof v === "number")
  );
}, [assignments]);

// 現在出場中（守備に就いている/指名打者）の選手だけ
const onFieldPlayers = useMemo(
  () => players.filter((p) => onFieldIds.has(p.id)),
  [players, onFieldIds]
);

// 例）onFieldPlayers 定義のすぐ下に貼る
const orderByBattingFromPrev = (list: any[], runnerIdx: number) => {
  const N = battingOrder.length || 0;
  if (!N || !Array.isArray(list) || list.length === 0) return list;

  const start = (runnerIdx - 1 + N) % N; // 「代走される選手の1つ前」から始める
  const dist = (pid: number) => {
    const i = battingOrder.findIndex(e => e?.id === pid);
    return i >= 0 ? ((start - i + N) % N) : N + 999; // ← これで 1,9,8,7...
  };


  // 同順位の並びを安定化（背番号→姓）
  return [...list].sort((a, b) => {
    const da = dist(a.id), db = dist(b.id);
    if (da !== db) return da - db;
    const na = Number(a.number ?? 9999), nb = Number(b.number ?? 9999);
    if (na !== nb) return na - nb;
    return String(a.lastName ?? "").localeCompare(String(b.lastName ?? ""));
  });
};

// 「出場済み」と見なす選手IDの集合（守備に就いている・打順に載っている・代打/代走も含む）
const playedIds = useMemo(() => {
  const s = new Set<number>();
  onFieldIds.forEach((id) => s.add(id));                 // 守備で出場中
  (battingOrder || []).forEach((e) => e?.id != null && s.add(e.id)); // 打順に載っている
  const u = (usedPlayerInfo as Record<number, { subId?: number }>) || {};
  Object.entries(u).forEach(([origIdStr, info]) => {     // 代打を出された元選手＆途中出場側も出場済みに
    const origId = Number(origIdStr);
    if (!Number.isNaN(origId)) s.add(origId);
    if (typeof info?.subId === "number") s.add(info.subId);
  });
  return s;
}, [onFieldIds, battingOrder, usedPlayerInfo]);

// ベンチ選手を「出場可能」と「出場済み」に分割
// ベンチ選手を「出場可能」と「出場済み」に分割（出場経験/現在出場中を考慮）
const { activeBench, retiredBench } = useMemo(() => {
  const active: any[] = [];
  const retired: any[] = [];
  benchPlayers.forEach((p) => {
    const nowInBatting = (battingOrder || []).some(e => e?.id === p.id);
    const nowOnField   = onFieldIds.has(p.id);
    const hasPlayed    = playedIds.has(p.id) || nowInBatting || nowOnField;
    (hasPlayed ? retired : active).push(p);
  });
  return { activeBench: active, retiredBench: retired };
}, [benchPlayers, playedIds, onFieldIds, battingOrder]);


const [showRunnerModal, setShowRunnerModal] = useState(false);
const [isRunnerConfirmed, setIsRunnerConfirmed] = useState(false);
const [runnerAnnouncement, setRunnerAnnouncement] = useState<string[]>([]);
const [runnerAssignments, setRunnerAssignments] = useState<{ [base: string]: any | null }>({
  "1塁": null,
  "2塁": null,
  "3塁": null,
});
const [replacedRunners, setReplacedRunners] = useState<{ [base: string]: any | null }>({});
// どの塁で「臨時代走」チェックが入っているかを記録
const [tempRunnerFlags, setTempRunnerFlags] = useState<Record<string, boolean>>({});
// Step3 で選んだ代走候補（塁ごと）
const [selectedRunnerByBase, setSelectedRunnerByBase] = useState<Record<string, Player | null>>({});
// アナウンスの「元ランナー名」（塁ごと） ex: "山田やまだ太郎たろうくん"
const [fromNameByBase, setFromNameByBase] = useState<Record<string, string>>({});

// ーーー Undo/Redo 用スナップショット型 ーーー
type OffenseSnapshot = {
  battingOrder: { id: number; reason?: string }[];
  assignments: { [pos: string]: number | null };
  usedPlayerInfo: Record<number, any>;
  benchPlayers: any[];
  runnerAssignments: { [base: string]: any | null };
  replacedRunners: { [base: string]: any | null };
  tempRunnerFlags: Record<string, boolean>;
  selectedRunnerByBase: Record<string, any | null>;
  inning: number;
  isTop: boolean;
  isHome: boolean;
};

// ーーー Undo/Redo のスタック ーーー
const [history, setHistory] = useState<OffenseSnapshot[]>([]);
const [redo, setRedo] = useState<OffenseSnapshot[]>([]);

// 現在の状態を丸ごと保存
const snapshotNow = (): OffenseSnapshot => ({
  battingOrder: [...battingOrder],
  assignments: { ...assignments },
  usedPlayerInfo: { ...(usedPlayerInfo || {}) },
  benchPlayers: [...benchPlayers],
  runnerAssignments: { ...runnerAssignments },
  replacedRunners: { ...replacedRunners },
  tempRunnerFlags: { ...tempRunnerFlags },
  selectedRunnerByBase: { ...selectedRunnerByBase },
  inning,
  isTop,
  isHome,
});

// スナップショットを画面へ反映 + 永続化も揃える
const restoreSnapshot = async (s: OffenseSnapshot) => {
  setBattingOrder(s.battingOrder);
  setAssignments(s.assignments);
  setUsedPlayerInfo(s.usedPlayerInfo);
  setBenchPlayers(s.benchPlayers);
  setRunnerAssignments(s.runnerAssignments);
  setReplacedRunners(s.replacedRunners);
  setTempRunnerFlags(s.tempRunnerFlags);
  setSelectedRunnerByBase(s.selectedRunnerByBase);
  setInning(s.inning);
  setIsTop(s.isTop);
  setIsHome(s.isHome);

  await localForage.setItem("battingOrder", s.battingOrder);
  await localForage.setItem("lineupAssignments", s.assignments);
  await localForage.setItem("usedPlayerInfo", s.usedPlayerInfo);
  await localForage.setItem("runnerAssignments", s.runnerAssignments);
  await localForage.setItem("replacedRunners", s.replacedRunners);
  await localForage.setItem("tempRunnerFlags", s.tempRunnerFlags);
  await localForage.setItem("selectedRunnerByBase", s.selectedRunnerByBase);
  await saveMatchInfo({
    inning,        // or nextInning
    isTop: false,  // or true（分岐に応じて）
    isHome,        // 既存値を維持
  });

};

// 変更前に履歴へ積む
const pushHistory = () => {
  setHistory(h => [...h, snapshotNow()]);
  setRedo([]); // 新規操作で Redo は破棄
};

// 取消（直前の状態へ）
const handleUndo = async () => {
  if (!history.length) return;
  const current = snapshotNow();
  const last = history[history.length - 1];
  setHistory(h => h.slice(0, -1));
  setRedo(r => [...r, current]);
  await restoreSnapshot(last);
  stop();
};

// やり直し（取り消しを戻す）
const handleRedo = async () => {
  if (!redo.length) return;
  const current = snapshotNow();
  const next = redo[redo.length - 1];
  setRedo(r => r.slice(0, -1));
  setHistory(h => [...h, current]);
  await restoreSnapshot(next);
  stop();
};


// base: "1塁"/"2塁"/"3塁" など、fromName: "〇〇くん" or ""、to: 代走に入る選手
const makeRunnerAnnounce = (base: string, fromName: string, to: Player | null, isTemp: boolean): string => {
  if (!to) return "";
  const toNameFull = `${to.lastName} ${to.firstName}くん`;
  const toNameLast = `${to.lastName}くん`;
  const baseKanji = base.replace("1", "一").replace("2", "二").replace("3", "三");
  const prefix = `${baseKanji}ランナー`;

  const num = (to.number ?? "").trim();

  if (isTemp) {
    // 例）「一塁ランナー〇〇くんに代わりまして 臨時代走、▲▲君、臨時代走は▲▲君。」
    return `${prefix}${fromName ? fromName + "に" : ""}代わりまして 臨時代走、${toNameLast}、臨時代走は ${toNameLast}。`;
  }

  // 通常代走（背番号がある時だけ付ける）
  return `${prefix}${fromName ? fromName + "に" : ""}代わりまして、${toNameFull}、${prefix}は ${toNameLast}${
    num ? `、背番号 ${num}。` : "。"
  }`;

};

const handleScoreInput = (digit: string) => {
  setInputScore(prev => {
    // 1回目は上書き（初期値を置き換える）
    if (scoreOverwrite) return digit;

    // 2回目以降は追記（最大2桁）
    if ((prev ?? "").length >= 2) return prev;
    if (prev === "0") return digit; // 0の後に押したら 05 ではなく 5 にしたい場合

    return (prev ?? "") + digit;
  });
  // 1回押したら次から追記モード
  setScoreOverwrite(false);
};


// HTML文字列を通常アナウンス欄へ出す
const setAnnouncementHTML = (html: string) => {
  const node = <span dangerouslySetInnerHTML={{ __html: html }} />;
  setAnnouncement(node);
  setAnnouncementOverride(node);
  // ★ 読み上げ用にHTML文字列も保持
  setAnnouncementHTMLStr(html);
  setAnnouncementHTMLOverrideStr(html);
};




const confirmScore = async () => {
  // ★ ここを追加：モーダル表示前に「終わった回」を確定
  lastEndedHalfRef.current = { inning, isTop };
  const score = parseInt(inputScore || "0", 10);
  const updatedScores = { ...scores };

  // ✅ 編集モード時
  if (editInning !== null && editTopBottom !== null) {
    // （バリデーション直後あたりで）
    lastEndedHalfRef.current = { inning, isTop };

    const index = editInning - 1;
    if (!updatedScores[index]) {
      updatedScores[index] = { top: 0, bottom: 0 };
    }
    updatedScores[index][editTopBottom] = score;

    await localForage.setItem("scores", updatedScores);
    setScores(updatedScores);
    setInputScore("");
    setShowModal(false);
    setEditInning(null);
    setEditTopBottom(null);
    return;
  }

  // ✅ 通常モード（イニング終了処理）
  const index = inning - 1;
  if (!updatedScores[index]) {
    updatedScores[index] = { top: 0, bottom: 0 };
  }

  if (!isHome) {
    updatedScores[index].top = score;
  } else {
    updatedScores[index].bottom = score;
  }

  await localForage.setItem("scores", updatedScores);
  setScores(updatedScores);
  setInputScore("");
  setShowModal(false);
  await localForage.setItem("lastBatterIndex", currentBatterIndex);

// ★ 次の状態を計算してから、1回だけ saveMatchInfo する
const nextIsTop = !isTop;
const nextInning = isTop ? inning : inning + 1;

// 次の状態で自チームが守備か？（相手が攻撃なら守備）
// 先攻: isHome=false → 表=攻撃/裏=守備
// 後攻: isHome=true  → 表=守備/裏=攻撃
const willBeDefense = (nextIsTop && isHome) || (!nextIsTop && !isHome);

// 画面の内部状態も更新
setIsTop(nextIsTop);
if (!isTop) setInning(nextInning);

// 正しい「次の状態」を保存（←ここが重要）
await saveMatchInfo({
  inning: nextInning,
  isTop: nextIsTop,
  isHome,
  isDefense: willBeDefense,
});


  if (score > 0) {
   setPopupMessage(`${teamName}、この回の得点は${score}点です。`);
    if (isHome && inning === 4 && !isTop) setPendingGroundPopup(true);

    // ★ 得点あり：まず得点モーダルを表示
    //    → メンバー交換モーダルは「得点モーダルのOK」側で pendingMemberExchange を見て後出しします
    setShowScorePopup(true);
  } else {
    // ★ 無得点でも 3回裏 ×「次の試合なし」= NO のときは、
    //    得点入力の直後にメンバー交換モーダルを表示してから本来の遷移を行う
    if (pendingMemberExchange) {
      const mi = await localForage.getItem<any>("matchInfo");
      const currentGame = Number(mi?.matchNumber) || 1;
      const nextGame = currentGame + 1;

      const txt =
        `本日の第${nextGame}試合の両チームは、4回終了後、メンバー交換を行います。\n` +
        `両チームのキャプテンと全てのベンチ入り指導者は、ボール3個とメンバー表とピッチングレコードを持って本部席付近にお集まりください。\n` +
        `ベンチ入りのスコアラー、審判員、球場責任者、EasyScore担当、公式記録員、アナウンスもお集まりください。\n` +
        `メンバーチェックと道具チェックはシートノックの間に行います。`;

      setMemberExchangeText(txt);

      // このあと行くはずだった遷移を記録
      if (isHome && inning === 4 && !isTop) {
        setAfterMemberExchange("groundPopup");
      }
      else if (lastEndedHalfRef.current?.inning === 1 && lastEndedHalfRef.current?.isTop) {
        const order =
          (await localForage.getItem<{ id:number; reason?:string }[]>("battingOrder")) || [];
        const hasPending = order.some(e =>
          e?.reason === "代打" || e?.reason === "代走" || e?.reason === "臨時代走"
        );
        setAfterMemberExchange(hasPending ? "switchDefense" : "seatIntro");
      } else {
        setAfterMemberExchange("switchDefense");
      }

      setPendingMemberExchange(false);   // フラグ消費
      setShowMemberExchangeModal(true);  // ← 表示
      return;                            // 後続はモーダルOKで実行
    }

    // （従来どおりの無得点時フロー）
    if (isHome && inning === 4 && !isTop) {
      setShowGroundPopup(true);
    } else if (inning === 1 && isTop) {
      // ★ 1回表は必ずシート紹介を先に表示する（代打/代走が残っていても）
        await localForage.setItem("postDefenseSeatIntro", { enabled: false });
        await localForage.setItem("seatIntroLock", false);
        await goSeatIntroFromOffense();
    } else {
      onSwitchToDefense();
    }
  }

};





const getPlayer = (id: number) =>
  players.find((p) => p.id === id) || allPlayers.find((p) => p.id === id);
    // 位置ラベル（守備・代打・(臨時)代走）を一元判定
// 位置ラベル（守備・代打・(臨時)代走）を一元判定
// 守備位置 or 代打/代走/臨時代走 の表示用
// 守備位置 or 代打/代走/臨時代走 の表示用
// 守備位置 or 代打/代走/臨時代走 の表示用
const getPosition = (id: number): string | null => {
  // 1) 純粋な守備割当（IDは数値化して比較：保存時に文字列化していても拾える）
  const posFromDefense =
    Object.keys(assignments).find(
      (k) => Number((assignments as any)[k]) === Number(id)
    ) ?? null;

  // 2) いま塁上に「代走として」出ているか
  // runnerAssignments は { base: Player } なので v?.id で比較する
  const isRunnerNow = Object.values(runnerAssignments || {}).some(
    (v: any) => v?.id === id
  );
  if (isRunnerNow) {
    // usedPlayerInfo で理由を確認（臨時代走を最優先）
    const info = Object.values(usedPlayerInfo as any).find(
      (x: any) =>
        x?.subId === id && (x?.reason === "臨時代走" || x?.reason === "代走")
    ) as any | undefined;
    return info?.reason === "臨時代走" ? "臨時代走" : "代走";
  }

  // 3) 打順側の理由で表示（ここに "臨時代走" 分岐を追加）
  const reasonInOrder = battingOrder.find((e) => e.id === id)?.reason;
  if (reasonInOrder === "代打") return "代打";
  if (reasonInOrder === "臨時代走") return "臨時代走";
  if (reasonInOrder === "代走") {
    // usedPlayerInfo に「臨時代走」があれば上書き
    const info = Object.values(usedPlayerInfo as any).find(
      (x: any) => x?.subId === id && x?.reason === "臨時代走"
    );
    return info ? "臨時代走" : "代走";
  }

  // 4) どれでもなければ守備位置
  return posFromDefense;
};


const getFullName = (player: Player) => {
  return `${player.lastName ?? ""} ${player.firstName ?? ""}`;
};

const getAnnouncementName = (player: Player) => {
  return announcedIds.includes(player.id)
    ? player.lastName ?? ""
    : `${player.lastName ?? ""} ${player.firstName ?? ""}`;
};

const announce = async (text: string | string[]) => {
  const joined = Array.isArray(text) ? text.join("、") : text;
  const plain = normalizeForTTS(joined); // ruby→かな & タグ除去
  await speak(plain);
};

const handleNext = () => {  
  setTiebreakAnno(null);          // ← 追加：通常表示に戻す
  setAnnouncementOverride(null);
  const next = (currentBatterIndex + 1) % battingOrder.length;
// ✅ 2人目の打者の前かつ未表示ならポップアップを表示
  if (next === 1 && gameStartTime && !hasShownStartTimePopup.current) {
    setShowStartTimePopup(true);
    hasShownStartTimePopup.current = true; // ✅ 表示済みに設定
  }

  setCurrentBatterIndex(next);
  setIsLeadingBatter(false);

  const currentEntry = battingOrder[currentBatterIndex];
  if (currentEntry) {
    if (!checkedIds.includes(currentEntry.id)) {
      toggleChecked(currentEntry.id); // 未チェックの時だけチェックを追加
    }
  }

  const nextIndex = (currentBatterIndex + 1) % battingOrder.length;
  setCurrentBatterIndex(nextIndex);
  setIsLeadingBatter(false);
};


const handlePrev = () => {
  setTiebreakAnno(null);
  setAnnouncementOverride(null);
  const prev = (currentBatterIndex - 1 + battingOrder.length) % battingOrder.length;
  setCurrentBatterIndex(prev);
  setIsLeadingBatter(false); // ⬅ 追加
};

const updateAnnouncement = () => {
  const entry = battingOrder[currentBatterIndex];
  const player = getPlayer(entry?.id);
  const pos = getPosition(entry?.id);

  if (!player || !pos) {
    setAnnouncement("");
    setAnnouncementHTMLStr("");
    setAnnouncementHTMLOverrideStr("");
    return;
  }

  const number = player.number;
  const honorific = player?.isFemale ? "さん" : "くん";
  const rawPosName = positionNames[pos] ?? pos;
  const posNameForAnnounce = (pos === "代打" || pos === "代走") ? "" : rawPosName;
  const posPrefix = posNameForAnnounce ? `${posNameForAnnounce} ` : "";

  const lines: string[] = [];
  if (isLeadingBatter) {
    lines.push(`${inning}回${isTop ? "表" : "裏"}、${teamName}の攻撃は、<br />`);
  }
  const isChecked = checkedIds.includes(player.id);


// 既存の rubyLast / rubyFirst は残してOK（posPrefix 等もそのまま使用）
const nameHTML = isChecked
  ? formatNameForAnnounce(player, true)    // 「苗字のみ」指定。ただし重複姓ならフル
  : formatNameForAnnounce(player, false);  // フルネーム

const num = (number ?? "").trim(); // ★追加：背番号判定用

if (!isChecked) {
  lines.push(
    `${currentBatterIndex + 1}番 ${posPrefix}${nameHTML}${honorific}、<br />` +
    // 2行目：背番号がある時だけ付ける
    `${posPrefix}${formatNameForAnnounce(player, true)}${honorific}` +
    `${num ? `、背番号 ${num}。` : "。"}`
  );
} else {
  lines.push(
    `${currentBatterIndex + 1}番 ${posPrefix}${nameHTML}${honorific}` +
    `${num ? `、背番号 ${num}。` : "。"}`
  );
}


  const html = lines.join("");
  setAnnouncement(<span dangerouslySetInnerHTML={{ __html: html }} />);
  setAnnouncementOverride(null);
  setAnnouncementHTMLStr(html);
  setAnnouncementHTMLOverrideStr(""); // 通常はオーバーライド無し
};


// クリック直前に現在の文面を温める
const prefetchCurrent = () => {
  const text = (announcementOverride || announcement || "").trim(); // ← その画面の“読み上げ文”に合わせて
  window.prefetchTTS?.(text);
};

// 「アナウンス文言エリア」を読み上げ（連打ロック付き）
const handleRead = async () => {
  // すでに再生中なら無視（再押下不可）
  if (isSpeakingRef.current) return;

  // ロック開始
  isSpeakingRef.current = true;
  setSpeaking(true);

  // 表示中の文面（tiebreak表示を優先）を確定して読み上げ
  const htmlFallback = tiebreakAnno ? tiebreakAnno.replace(/\n/g, "<br />") : "";

  const release = () => {
    isSpeakingRef.current = false;
    setSpeaking(false);
  };

  try {
    await speakFromAnnouncementArea(
      announcementHTMLOverrideStr || htmlFallback,
      announcementHTMLStr       || htmlFallback
    );
  } finally {
    // 停止ボタン or 再生完了のいずれでも Promise が抜けた時点で解除
    release();
  }
};

// 停止でロック解除
const handleStop = () => {
  try {
    stop(); // ← あなたの停止関数名に合わせて（例: stop / ttsStop / stopSpeechAll）
  } finally {
    // ★ 停止押下と同時にロック解除（読み上げボタンを即押せる）
    isSpeakingRef.current = false;
    setSpeaking(false);
  }
};





// 音声読み上げ（統一）
const speakText = async (text: string) => { await speak(text); };
const stopSpeech = () => { stop(); };


useEffect(() => {
  if (
    players.length > 0 &&
    battingOrder.length > 0 &&
    assignments &&
    teamName !== ""
  ) {
    updateAnnouncement();
  }
}, [
  currentBatterIndex,   // 打者番号が変わったとき
  isLeadingBatter,      // ★ 先頭打者フラグの切替時
  inning,               // ★ 回が変わったとき
  isTop,                // ★ 表/裏が変わったとき
  players,
  battingOrder,
  assignments,
  teamName,
  checkedIds            // ★ 苗字のみ/フル表示の切替時
]);


   const status = (isHome && !isTop) || (!isHome && isTop) ? "攻撃中" : "守備中";

  return (
<DndProvider backend={HTML5Backend}>

  <div className="flex justify-end mb-2">


</div>
      <div
        className="max-w-4xl mx-auto p-4 select-none overflow-x-hidden"
        onContextMenu={(e) => e.preventDefault()}        // 右クリック/長押しのメニュー抑止
        onSelectStart={(e) => e.preventDefault()}         // テキスト選択開始を抑止
        onPointerDown={(e) => {
          // 入力系だけは許可（必要なければこの if ごと消してOK）
          const el = e.target as HTMLElement;
          if (el.closest('input, textarea, [contenteditable="true"]')) return;
        }}
        style={{
          WebkitTouchCallout: "none",  // iOSの長押し呼び出し抑止
          WebkitUserSelect: "none",
          userSelect: "none",
        }}
      >
      <h2 className="text-base font-bold mb-2 inline-flex items-center gap-2 whitespace-nowrap overflow-hidden min-w-0">
        <img
          src="/Ofence.png"   // ← public/Ofence.png に置く
          alt=""
          width={24}
          height={24}
          className="w-6 h-6 object-contain align-middle select-none"
          loading="lazy"
          decoding="async"
          draggable="false"
        />
        <span className="px-2 py-1 rounded bg-blue-600 text-white whitespace-nowrap flex-shrink-0">
          攻撃中
        </span>
        <div className="flex flex-wrap justify-center gap-x-1 text-center">
  <span className="whitespace-nowrap">
    {teamName || "自チーム"}
  </span>
  <span className="whitespace-normal break-words">
    🆚{opponentTeam || "対戦相手"}
  </span>
</div>
      </h2>
        <div className="flex justify-between items-center mb-2">
          <div className="flex items-center gap-2">
            <select value={inning} onChange={(e) => setInning(Number(e.target.value))}>
              {[...Array(9)].map((_, i) => (
                <option key={i} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <span>回 {isTop ? "表" : "裏"}</span>

          </div>
            {/* 試合開始ボタン */}
            {inning === 1 && isTop && !isHome && (
              <button
               className="px-3 py-1 bg-green-500 text-white rounded hover:bg-green-600"
                onClick={handleStartGame}
              >
                <span className="break-keep leading-tight">試合<wbr/>開始</span>
              </button>
            )}
            <div className="flex items-center gap-2 mr-2">
              <button
                onClick={handleUndo}
                disabled={!history.length}
                className={`px-3 py-1 rounded ${history.length ? "bg-gray-700 text-white" : "bg-gray-300 text-gray-500 cursor-not-allowed"}`}
                title="直前の確定を取り消す"
              >
                ↻
              </button>
              <button
                onClick={handleRedo}
                disabled={!redo.length}
                className={`px-3 py-1 rounded ${redo.length ? "bg-gray-700 text-white" : "bg-gray-300 text-gray-500 cursor-not-allowed"}`}
                title="取り消しをやり直す"
              >
                ↺
              </button>
            </div>





        </div>


 <table className="w-full border border-gray-400 text-center text-sm mb-6"> 
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
      { name: teamName || "自チーム", isMyTeam: true },
      { name: opponentTeam || "対戦相手", isMyTeam: false },
    ]
      /* 先攻／後攻で並び順を統一 */
      .sort((a, b) => {
        if (isHome) return a.isMyTeam ? 1 : -1;   // 後攻なら自チームを下段
        else        return a.isMyTeam ? -1 : 1;   // 先攻なら上段
      })
      .map((row, rowIdx) => (
        <tr key={rowIdx} className={row.isMyTeam ? "bg-gray-100" : ""}>
          <td className={`border ${row.isMyTeam ? "text-red-600 font-bold" : ""}`}>
            <span className="block max-w-[120px] truncate" title={row.name}>
              {row.name}
            </span>
          </td>

          {[...Array(9).keys()].map(i => {
            /* 表裏に応じてスコアを取り出す */
            const val = row.isMyTeam
              ? isHome ? scores[i]?.bottom : scores[i]?.top
              : isHome ? scores[i]?.top    : scores[i]?.bottom;

            /* 現在の回＋攻撃側セルをハイライト */
            const target = row.isMyTeam
              ? isHome ? "bottom" : "top"
              : isHome ? "top"    : "bottom";
            const isNow =
              i + 1 === inning && target === (isTop ? "top" : "bottom");

            return (
              <td
                key={i}
                className={`border text-center cursor-pointer hover:bg-gray-200 ${
                  isNow ? "bg-yellow-300 font-bold border-2 border-yellow-500" : ""
                }`}
                onClick={() => {
                  const clickedInning = i + 1;
                  const clickedHalf: "top" | "bottom" = target as "top" | "bottom";

                  // 半回の序列: 表=0, 裏=1
                  const currentHalfIndex = isTop ? 0 : 1;
                  const clickedHalfIndex = clickedHalf === "top" ? 0 : 1;

                  // いま進行中の半回は編集禁止
                  const isCurrentHalf =
                    clickedInning === Number(inning) && clickedHalfIndex === currentHalfIndex;

                  // 未来（現在より後）の半回は編集禁止
                  const isFuture =
                    clickedInning > Number(inning) ||
                    (clickedInning === Number(inning) && clickedHalfIndex > currentHalfIndex);

                  if (isCurrentHalf || isFuture) return;

                  // ここまで来たら「過去の半回」= 編集OK
                  setEditInning(clickedInning);
                  setEditTopBottom(clickedHalf);

                  // ★ scores は 0始まりなので -1
                  const existing = scores[clickedInning - 1]?.[clickedHalf];
                  setInputScore(existing !== undefined ? String(existing) : "");

                  setShowModal(true);
                }}
              >
                {(() => {
                  const nInning = Number(inning);

                  // 未来の回は空
                  if (i + 1 > nInning) return "";

                  // 同じ回でも「未来の半回」（例: 表のときの裏）は空
                  const currentHalf: "top" | "bottom" = isTop ? "top" : "bottom";
                  if (i + 1 === nInning && target !== currentHalf) return "";

                  // 表示値（現在の黄色セルも含めて表示）
                  const v = val ?? "";

                  // 0 を空にしたいなら↓を有効化（好み）
                  // if (v === 0) return "";

                  return v;
                })()}
              </td>

            );
          })}
          {/* ── 計 ── */}
          <td className="border font-bold">
            {Object.values(scores).reduce((sum, s) => {
              const v = row.isMyTeam
                ? isHome ? s.bottom ?? 0 : s.top ?? 0
                : isHome ? s.top ?? 0    : s.bottom ?? 0;
              return sum + v;
            }, 0)}
          </td>
        </tr>
      ))}
  </tbody>
</table>





    
<div className="space-y-1 text-sm font-bold text-gray-800">
{battingOrder.map((entry, idx) => {
  const player = getPlayer(entry.id);
  const isCurrent = idx === currentBatterIndex;
  const position = getPosition(entry.id);
  const positionLabel = position ?? "";
<input
  type="checkbox"
  checked={checkedIds.includes(entry.id)}
  onChange={() => toggleChecked(entry.id)}
  className="mr-2"
/>

  return (
    <div
      key={entry.id}
      onClick={async () => {
        if (idx === currentBatterIndex) {
          // すでに選択中の行をタップ → トグル
          if (isLeadingBatter) {
            // 「次の打者」ボタンと同じ：非表示にする
            setTiebreakAnno(null);
            setAnnouncementOverride(null);
            setIsLeadingBatter(false);
          } else {
            // 非表示 → 表示に戻す
            setIsLeadingBatter(true);
            const tbEnabled = Boolean(await localForage.getItem("tiebreak:enabled"));
            if (tbEnabled) {
              const text = await buildTiebreakTextForIndex(idx);
              setTiebreakAnno(text);
            } else {
              setTiebreakAnno(null);
            }
          }
        } else {
          // 別の行をタップ → その行を選択し、表示ON
          setCurrentBatterIndex(idx);
          setIsLeadingBatter(true);
          const tbEnabled = Boolean(await localForage.getItem("tiebreak:enabled"));
          if (tbEnabled) {
            const text = await buildTiebreakTextForIndex(idx);
            setTiebreakAnno(text);
          } else {
            setTiebreakAnno(null);
          }
        }
      }}


      className={`px-2 py-0.5 border-b cursor-pointer ${
        isCurrent ? "bg-yellow-200" : ""
      }`}
    >
<div className="grid grid-cols-[50px_100px_150px_60px] items-center gap-2">
  <div>{idx + 1}番</div>
  <div>{positionLabel}</div>

  <div className="flex items-center gap-1">
    <input
      type="checkbox"
      checked={checkedIds.includes(entry.id)}
      onChange={() => toggleChecked(entry.id)}
      className="mr-2"
    />

    {/* 姓（必ず表示） */}
    <ruby>
      {player?.lastName ?? ""}
      {player?.lastNameKana && <rt>{player.lastNameKana}</rt>}
    </ruby>

    {/* 名（ある時だけ表示） */}
    {player?.firstName?.trim() ? (
      <ruby>
        {player.firstName}
        {player.firstNameKana && <rt>{player.firstNameKana}</rt>}
      </ruby>
    ) : null}
  </div>

  <div>{formatNumberBadge(player?.number)}</div>
</div>

    </div>
  );
})}

</div>

<div className="w-full grid grid-cols-3 gap-2 my-2">
  <button
    onClick={handlePrev}
    className="col-span-1 w-full h-10 rounded bg-green-500 text-white"
  >
    ⬅ 前の打者
  </button>
  <button
    onClick={handleNext}
    className="col-span-2 w-full h-10 rounded bg-green-500 text-white"
  >
    ➡️ 次の打者
  </button>
</div>



{/* ⚠️ ファウルボール注意文（常時表示） */}

<div className="border border-red-500 bg-red-200 text-red-700 p-4 rounded relative text-left">
  <div className="flex items-center mb-2">

    <span className="text-red-600 font-bold whitespace-pre-line">
      ファウルボールの行方には十分ご注意ください
    </span>
  </div>

  {/* ボタンを左寄せ */}
    <div className="mt-3 w-full flex gap-2">
      <button
        onClick={handleFoulRead}
        className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 shadow-md"
        title="読み上げ"
      >
        <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap leading-none">読み上げ</span>
      </button>

      <button
        onClick={handleStop}
        className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center justify-center shadow-md"
        title="停止"
      >
        <span className="whitespace-nowrap leading-none">停止</span>
      </button>
    </div>
</div>



  {isLeadingBatter && (
    <div className="flex items-center text-blue-600 font-bold mb-0">
      <div className="bg-yellow-100 text-yellow-800 bord最初er-l-4 border-yellw-500 px-4 py-2 text-sm font-semibold text-left">
        <span className="mr-2 text-lg">⚠️</span>攻撃回最初のバッター紹介は、キャッチャー2塁送球後 
      </div>
    </div>
  )}

  <div className="border border-red-500 bg-red-200 text-red-700 p-4 rounded relative text-left">
    <div className="flex items-center mb-2">

        <span className="text-red-600 font-bold whitespace-pre-line">
          {tiebreakAnno ?? announcementOverride ?? announcement ?? ""}
        </span>

    </div>
    {/* 🔊 打順アナウンス：読み上げ／停止（横いっぱい・半分ずつ） */}
    <div className="mt-3 w-full flex gap-2">
     <button
        onMouseDown={prefetchCurrent}
        onTouchStart={prefetchCurrent}
        onClick={handleRead}
	      disabled={isSpeakingRef.current || speaking}
        className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 shadow-md"
        title="読み上げ"
      >
        <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
        <span className="whitespace-nowrap leading-none">読み上げ</span>
      </button>

      <button
        onClick={handleStop}
        className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center justify-center shadow-md"
        title="停止"
      >
        <span className="whitespace-nowrap leading-none">停止</span>
      </button>
    </div>
  </div>

{/* 一番下のイニング終了ボタン（左に 得点-1 / 得点+1 を追加） */}
<div className="mt-6 flex gap-2">
  {/* 得点 -1 */}
  <button
    type="button"
    onClick={async () => {
      try {
        const idx = Number(inning) - 1;                 // ★ scores は 0始まり
        const half: "top" | "bottom" = isTop ? "top" : "bottom";

        const current = scores?.[idx]?.[half] ?? 0;
        const nextVal = Math.max(0, current - 1);

        const nextScores = {
          ...scores,
          [idx]: {
            ...(scores?.[idx] ?? {}),
            [half]: nextVal,
          },
        };

        setScores(nextScores);
        await localForage.setItem("scores", nextScores);
      } catch (e) {
        console.error("score -1 error", e);
      }
    }}
    className="
      flex-1 h-14
      bg-red-600 hover:bg-red-700
      text-white font-extrabold text-lg
      rounded-xl shadow-lg
      flex items-center justify-center
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
      ring-4 ring-red-400/40
    "
  >
    得点 −1
  </button>

  {/* 得点 +1 */}
  <button
    type="button"
    onClick={async () => {
      try {
        const idx = Number(inning) - 1;                 // ★ scores は 0始まり
        const half: "top" | "bottom" = isTop ? "top" : "bottom";

        const current = scores?.[idx]?.[half] ?? 0;
        const nextVal = current + 1;

        const nextScores = {
          ...scores,
          [idx]: {
            ...(scores?.[idx] ?? {}),
            [half]: nextVal,
          },
        };

        setScores(nextScores);
        await localForage.setItem("scores", nextScores);
      } catch (e) {
        console.error("score +1 error", e);
      }
    }}
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
    得点 ＋1
  </button>

  {/* イニング終了（既存処理そのまま） */}
  <button
    type="button"
    onClick={async () => {
      const currentInning = Number(inning);
      const currentHalf: "top" | "bottom" = isTop ? "top" : "bottom";
      // ★ 黄色表示の得点を取得（scores は 0始まり）
      const currentScore =
        scores[currentInning - 1]?.[currentHalf] ?? 0;
      // ★ モーダル初期値としてセット
      setInputScore(String(currentScore));        
      setScoreOverwrite(true);

      // 既存のイニング終了ボタンと同じ処理
      const isThirdBottom = (Number(inning) === 3 && isTop === false);

      if (isThirdBottom) {
        const mi = await localForage.getItem<any>("matchInfo");
        const noNextGame =
          (mi?.noNextGame === true) || (mi?.noNextGame === "true");
        if (!noNextGame) {
          setPendingMemberExchange(true);
        }
      }

      setShowModal(true);
    }}
    className="
      flex-[1.2] h-14
      bg-black hover:bg-gray-900
      text-white font-extrabold text-lg tracking-wider
      rounded-xl shadow-lg
      flex items-center justify-center gap-2
      transform hover:scale-[1.02] active:scale-[0.97]
      transition-all duration-150
      ring-4 ring-gray-400/40
    "
  >
    ⚾ イニング終了 ⚾
  </button>
</div>




  {/* 操作ボタン（横いっぱい・等幅・固定順：DH解除 → リエントリー → 代走 → 代打） */}
  <div className="w-full grid grid-cols-4 gap-2 mt-4">
    {/* DH解除（常に表示。条件を満たさない時は disabled） */}
    <button
      onClick={() => setShowDhDisableModal(true)}
      disabled={!isDhTurn || !dhActive || !pitcherId}
      className="w-full h-10 rounded bg-gray-800 text-white px-2
                inline-flex items-center justify-center
                disabled:bg-gray-300 disabled:text-white disabled:cursor-not-allowed"
      title="DH解除"
    >
      <span className="whitespace-nowrap leading-none tracking-tight
                      text-[clamp(10px,3.2vw,16px)]">
        DH解除
      </span>
    </button>


    {/* リエントリー */}
  <button
onClick={async () => {
  console.log("▶ リエントリーボタン押下");
  const { A, B, order1 } = await findReentryCandidateForCurrentSpot(); // ← await に変更
  console.log("find結果:", { A, B, order1 });

  if (!B) {
    console.warn("→ アラート表示: この打順にリエントリー可能な選手はいません。");
    setNoReEntryMessage("この打順にリエントリー可能な選手はいません。");
    alert("この打順にリエントリー可能な選手はいません。");
    return;
  }
  setReEntryFromPlayer(A || null);
  setReEntryTargetPlayer(B);
  setReEntryOrder1(order1);
  setShowReEntryModal(true);
}}

    className="w-full h-10 rounded bg-purple-600 text-white px-2
              inline-flex items-center justify-center"  // ← 横並び中央
    title="リエントリー"
  >
    <span className="whitespace-nowrap leading-none
                    text-[clamp(12px,3.6vw,16px)] tracking-tight">
      リエントリー
    </span>
  </button>


    {/* 代走 */}
    <button
      onClick={() => setShowRunnerModal(true)}
      className="w-full h-10 rounded bg-orange-600 text-white"
      title="代走"
    >
      🏃‍♂️代走
    </button>

    {/* 代打 */}
    <button
      onClick={() => setShowSubModal(true)}
      className="w-full h-10 rounded bg-orange-600 text-white"
      title="代打"
    >
      🏏代打
    </button>
  </div>


{/* ✅ DH解除のポップアップ */}
{showDhDisableModal && (() => {
  if (!dhActive || dhOrderIndex === -1 || !pitcherId) return null;

  const order1 = dhOrderIndex + 1;
  const p = getPlayer(pitcherId);
  if (!p) return null;

 const honor = p.isFemale ? "さん" : "くん";
const line1 = "ただいまより、指名打者制を解除します。";

const num = (p.number ?? "").trim(); // ★追加：背番号

// ★ 表示用（従来どおり・漢字）
const line2 =
  `${order1}番　ピッチャー　${p.lastName} ${p.firstName}${honor}　` +
  `ピッチャー${p.lastName}${honor}` +
  `${num ? `　背番号 ${num}` : ""}`;

// ★ 読み上げ用（ふりがな優先：rubyタグを付ける）
const line2Html =
  `${order1}番　ピッチャー　${rubyFull(p)}${honor}　` +
  `ピッチャー${rubyLast(p)}${honor}` +
  `${num ? `　背番号 ${num}` : ""}`;

// ★ 読み上げ：モーダルの見た目はそのまま、TTSには ruby を渡してかな化
const speak = async () => {
  await speakFromAnnouncementArea(
    `${line1}<br/>${line2Html}`,
    undefined
  );
};


  const stop  = () => speechSynthesis.cancel();

  const confirmDisableDH = async () => {
    pushHistory(); // ← 追加（DH解除の確定前に退避）

    // 1) 打順：DHの枠を「現在の投手」に置換
    const newOrder = [...battingOrder];
    newOrder[dhOrderIndex] = { id: pitcherId!, reason: "DH解除" };

    // 2) 守備：指名打者を無効化（=DHなし）
    const newAssignments = { ...assignments, 指: null };

    // 3) 反映＆保存（この画面で完結）
    setBattingOrder(newOrder);
    setAssignments(newAssignments);
    await localForage.setItem("battingOrder", newOrder);
    await localForage.setItem("lineupAssignments", newAssignments);
    await localForage.setItem("dhEnabledAtStart", false); // 守備画面でも“指”不可に

    // 4) ベンチ再計算（DH解除後は投手をスタメン集合に含めない）
    const all = allPlayers.length ? allPlayers : players;
    const starterIds = new Set(newOrder.map(e => e.id));
    // ✅ スタメン画面の指定を唯一の情報源にする
    const benchOutIds: number[] =
      (await localForage.getItem<number[]>("startingBenchOutIds")) || [];
    const newBench = all.filter((pp: any) => !starterIds.has(pp.id) && !benchOutIds.includes(pp.id));
    setBenchPlayers(newBench);

    setShowDhDisableModal(false);

    // もし今がDHの打席中なら、置換後の打者表示を最新化
    setCurrentBatterIndex(dhOrderIndex);
    setIsLeadingBatter(true);
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* 背景オーバーレイ */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* 画面中央にカードを配置 */}
      <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
        <div
          className="
            bg-white shadow-2xl
            rounded-2xl
            w-full md:max-w-md
            max-h-[75vh]
            overflow-hidden
            flex flex-col
          "
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          {/* 固定ヘッダー（他モーダルと統一） */}
          <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                          bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
            <h2 className="text-lg font-extrabold tracking-wide">DH解除</h2>
            <button
              onClick={() => setShowDhDisableModal(false)}
              aria-label="閉じる"
              className="rounded-full w-9 h-9 flex items-center justify-center
                         bg-white/15 hover:bg-white/25 active:bg-white/30
                         text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              ×
            </button>
          </div>

          {/* 本文（スクロール領域） */}
          <div className="px-4 py-4 space-y-4 overflow-y-auto">
            {/* アナウンス文言エリア（薄い赤・読み上げは青） */}
            <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm shadow-red-800/30">
              <div className="flex items-start gap-2 mb-3">
                <img src="/mic-red.png" alt="mic" className="w-5 h-5 translate-y-0.5" />
                <div className="whitespace-pre-line text-base font-bold text-red-700 leading-relaxed">
                  {line1}
                  {"\n"}
                  {line2}
                </div>
              </div>

              {/* 読み上げ・停止 */}
              <div className="mt-3 flex gap-2">
                <button
                  onClick={speak}
                  disabled={isSpeakingRef.current || speaking}
                  className="flex-1 h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center justify-center gap-2 shadow-md"
                  title="読み上げ"
                >
                  <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap leading-none">読み上げ</span>
                </button>

                <button
                  onClick={() => {
                    stop();                 // その場でTTS停止
                    isSpeakingRef.current = false; // 連打ロック解除（保険）
                    setSpeaking(false);
                  }}
                  className="flex-1 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white inline-flex items-center justify-center shadow-md"
                  title="停止"
                >
                  <span className="whitespace-nowrap leading-none">停止</span>
                </button>
              </div>

            </div>
          </div>

          {/* 固定フッター（確定／キャンセル） */}
          <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={confirmDisableDH}
                className="h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md"
              >
                確定
              </button>
              <button
                onClick={() => setShowDhDisableModal(false)}
                className="h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-md"
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
  );
})()}


{/* ✅ 得点入力時のポップアップ（中央モーダル・機能そのまま） */}
{showModal && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 画面中央に配置 */}
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
        {/* 固定ヘッダー（他モーダルと統一） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold tracking-wide">この回の得点を入力してください</h2>
          <div className="w-9 h-9" />
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          {/* 現在入力中のスコア表示 */}
          <div className="mx-auto w-full max-w-[220px]">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-6 py-4 text-center shadow-sm">
              <div className="text-4xl md:text-5xl font-extrabold tabular-nums tracking-wider text-slate-900">
                {inputScore || "0"}
              </div>
            </div>
          </div>

          {/* 数字キー（3列グリッド／0は横長） */}
          <div className="grid grid-cols-3 gap-2">
            {[..."1234567890"].map((digit) => (
              <button
                key={digit}
                onClick={() => handleScoreInput(digit)}
                aria-label={`数字${digit}`}
                className={[
                  "h-14 md:h-16 rounded-xl text-xl font-bold text-white",
                  "bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] transition shadow-md",
                  digit === "0" ? "col-span-3" : ""
                ].join(" ")}
              >
                {digit}
              </button>
            ))}
          </div>
        </div>

        {/* 固定フッター操作（OK / クリア / キャンセル） */}
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
              }}
              className="h-12 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-semibold shadow-md"
            >
              キャンセル
            </button>
          </div>
          <div className="h-[max(env(safe-area-inset-bottom),8px)]" />
        </div>
      </div>
    </div>
  </div>
)}


{/* ✅ 得点入った時のポップアップ（中央モーダル版・機能そのまま） */}
{showScorePopup && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 画面中央に配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full max-w-md
          max-h-[70vh]
          overflow-hidden
          flex flex-col
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 固定ヘッダー */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <div className="flex items-center gap-2">
            <img
              src="/mic-red.png"
              alt="mic"
              width={28}
              height={28}
              className="w-7 h-7 object-contain select-none drop-shadow"
              loading="lazy"
              decoding="async"
              draggable="false"
            />
            <h2 className="text-xl font-extrabold tracking-wide">得点</h2>
          </div>
          <div className="w-9 h-9" />
        </div>

        {/* 本文（スクロール領域） */}
        <div className="px-4 py-4 space-y-4 overflow-y-auto">
          {/* アナウンス文言エリア（薄い赤） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm shadow-red-800/30">
            <div className="flex items-center gap-2 mb-2">

            </div>
              {(() => {
                const BK = "この回の得点は";
                const idx = popupMessage.indexOf(BK);
                const head = idx >= 0 ? popupMessage.slice(0, idx) : popupMessage; // 例: 「○○チーム、」
                const tail = idx >= 0 ? popupMessage.slice(idx) : "";               // 例: 「この回の得点は3点です。」

                return (
                  <p className="text-xl font-bold text-red-700 text-center break-keep">
                    {head}
                    {idx >= 0 && <><wbr />{"\u200B"}</>}
                    {tail}
                  </p>
                );
              })()}

              {/* 読み上げ・停止（横いっぱい・等幅） */}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={async () => {
                    await speak(popupMessage);   // VOICEVOX優先、失敗時 Web Speech
                  }}
                  className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                            inline-flex items-center justify-center gap-2"
                >
                  <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap leading-none">読み上げ</span>
                </button>

                <button
                  onClick={() => stop()}
                  className="w-full h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white
                            inline-flex items-center justify-center"
                >
                  停止
                </button>
              </div>
          </div>
        </div>

        {/* 固定フッター（OKはアナウンス枠の外） */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
onClick={async () => {
  setShowScorePopup(false);

  if (pendingMemberExchange) {
    // 本日の“次の試合番号”で文面を作成
    const mi = await localForage.getItem<any>("matchInfo");
    const currentGame = Number(mi?.matchNumber) || 1;
    const nextGame = currentGame + 1;

    const txt =
      `本日の第${nextGame}試合の両チームは、4回終了後、メンバー交換を行います。\n` +
      `両チームのキャプテンと全てのベンチ入り指導者は、ボール3個とメンバー表とピッチングレコードを持って本部席付近にお集まりください。\n` +
      `ベンチ入りのスコアラー、審判員、球場責任者、EasyScore担当、公式記録員、アナウンスもお集まりください。\n` +
      `メンバーチェックと道具チェックはシートノックの間に行います。`;

    setMemberExchangeText(txt);

    // OK 後にどこへ進むかを記録
    if (pendingGroundPopup) {
      setAfterMemberExchange("groundPopup");
      setPendingGroundPopup(false); // 消費
    }  
    else if (lastEndedHalfRef.current?.inning === 1 && lastEndedHalfRef.current?.isTop) {
      setAfterMemberExchange("seatIntro");
    } else {
      setAfterMemberExchange("switchDefense");
    }
    setPendingMemberExchange(false); // 消費
    setShowMemberExchangeModal(true); // ★ ここでメンバー交換モーダルを後出し
    return; // 以降の通常フローは、モーダルのOKで実行
  }

  // ※メンバー交換なしの場合は従来通り
  if (pendingGroundPopup) {
    setPendingGroundPopup(false);
    setShowGroundPopup(true);
  }  
  else if (lastEndedHalfRef.current?.inning === 1 && lastEndedHalfRef.current?.isTop) {
    await goSeatIntroFromOffense();
  } else {
    onSwitchToDefense();
  }
}}

            className="w-full bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
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

{/* ✅ 代打、代走があった時のポップアップ */}
{showDefensePrompt && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div className="bg-white p-6 rounded-xl shadow-xl text-center space-y-4 max-w-sm w-full">
      <h2 className="text-lg font-bold text-red-600">守備位置の設定</h2>
      <p>代打／代走で出場した選手の守備位置を設定してください。</p>
      <button
        className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
        onClick={() => {
          setShowDefensePrompt(false);
          onChangeDefense(); // モーダル経由で守備画面へ
        }}
      >
        OK
      </button>
    </div>
  </div>
)}

{/* ✅ リエントリーモーダル（中央配置・スマホ風・機能は既存のまま） */}
{showReEntryModal && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 画面中央に配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full max-w-md
          max-h-[85vh]
          overflow-y-auto
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 固定ヘッダー（グラデ＋白文字） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <div className="flex items-center gap-2">
            <img
              src="/mic-red.png"
              alt="mic"
              width={24}
              height={24}
              className="w-6 h-6 object-contain select-none drop-shadow"
              loading="lazy"
              decoding="async"
              draggable="false"
            />
            <h2 className="text-xl font-extrabold tracking-wide">リエントリー</h2>
          </div>
          <button
            onClick={() => {
              setShowReEntryModal(false);
            }}
            aria-label="閉じる"
            className="rounded-full w-9 h-9 flex items-center justify-center
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4">
          {/* アナウンス表示（薄い赤背景・rtも赤） */}
          <div className="mb-3 rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm shadow-red-800/30">
            <div className="mb-3 flex items-start gap-2">
              <img src="/mic-red.png" alt="mic" className="w-5 h-5 translate-y-0.5" />
              <span
                className="space-y-1 font-bold text-red-700 leading-relaxed [&_rt]:text-red-700"
                dangerouslySetInnerHTML={{
                  __html: `
                    ${teamName || "自チーム"}、選手の交代をお知らせいたします。<br/>
                    ${reEntryOrder1 ?? "?"}番
                    ${reEntryFromPlayer ? rubyLast(reEntryFromPlayer) : ""}${reEntryFromPlayer?.isFemale ? "さん" : "くん"}に代わりまして
                    ${reEntryTargetPlayer ? rubyLast(reEntryTargetPlayer) : ""}${reEntryTargetPlayer?.isFemale ? "さん" : "くん"}がリエントリーで戻ります。<br/>
                    バッターは ${reEntryTargetPlayer ? rubyLast(reEntryTargetPlayer) : ""}${reEntryTargetPlayer?.isFemale ? "さん" : "くん"}。
                  `.trim()
                }}
              />
            </div>

{/* 読み上げ・停止（1行横並び／アイコン右に文字） */}
<div className="grid grid-cols-2 gap-2">
  <button
    onClick={() => {
      if (!reEntryTargetPlayer || reEntryOrder1 == null || !reEntryFromPlayer) return;
      const honorA = reEntryFromPlayer.isFemale ? "さん" : "くん";
      const honorB = reEntryTargetPlayer.isFemale ? "さん" : "くん";
      const kanaALast = reEntryFromPlayer.lastNameKana || reEntryFromPlayer.lastName || "";
      const kanaBLast = reEntryTargetPlayer.lastNameKana || reEntryTargetPlayer.lastName || "";
      announce(
        `${teamName || "自チーム"}、選手の交代をお知らせいたします。` +
        `${reEntryOrder1}番 ${kanaALast}${honorA}に代わりまして ` +
        `${kanaBLast}${honorB} がリエントリーで戻ります。` +
        `バッターは ${kanaBLast}${honorB}。`
      );
    }}
    className="w-full h-12 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md inline-flex items-center justify-center gap-2"
  >
    <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
    <span className="whitespace-nowrap">読み上げ</span>
  </button>

  <button
    onClick={() => stop()}
    className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-semibold shadow-md"
  >
    停止
  </button>
</div>



          </div>

          {/* 確定／キャンセル（1行に半分ずつ） */}
          <div className="grid grid-cols-2 gap-2 mt-4">
            <button
              onClick={async () => {
                // 既存の確定処理そのまま
                pushHistory();
                if (!reEntryTargetPlayer || reEntryOrder1 == null) return;
                const idx = reEntryOrder1 - 1;

                const newOrder = [...battingOrder];
                newOrder[idx] = { id: reEntryTargetPlayer.id, reason: "リエントリー" };
                setBattingOrder(newOrder);
                await localForage.setItem("battingOrder", newOrder);

                const curAssignments =
                  (await localForage.getItem<Record<string, number | null>>("lineupAssignments")) ||
                  assignments || {};
                const newAssignments = { ...curAssignments };

                const posOfA = Object.entries(newAssignments)
                  .find(([, id]) => Number(id) === Number(reEntryFromPlayer?.id))?.[0];

                for (const [pos, id] of Object.entries(newAssignments)) {
                  if (Number(id) === Number(reEntryTargetPlayer.id)) newAssignments[pos] = null;
                }

                if (posOfA) {
                  newAssignments[posOfA] = reEntryTargetPlayer.id;
                } else {
                  const fromPos = (usedPlayerInfo?.[reEntryTargetPlayer.id]?.fromPos) as string | undefined;
                  if (fromPos) newAssignments[fromPos] = reEntryTargetPlayer.id;
                }

                setAssignments(newAssignments);
                await localForage.setItem("lineupAssignments", newAssignments);

                const newUsed = { ...(usedPlayerInfo || {}) };
                const prevB = (usedPlayerInfo || {})[reEntryTargetPlayer.id] as
                  | { fromPos?: string; order?: number; subId?: number; wasStarter?: boolean }
                  | undefined;

                const fromPosForA =
                  prevB?.fromPos ||
                  (Object.entries(newAssignments).find(([, id]) => id === reEntryFromPlayer?.id)?.[0] ?? "");

                if (reEntryFromPlayer) {
                  (newUsed as any)[reEntryFromPlayer.id] = {
                    fromPos: fromPosForA,
                    subId: reEntryTargetPlayer.id,
                    reason: "リエントリー",
                    order: reEntryOrder1,
                    wasStarter: false,
                  };
                }

                delete (newUsed as any)[reEntryTargetPlayer.id];

                setUsedPlayerInfo(newUsed);
                await localForage.setItem("usedPlayerInfo", newUsed);

                if (!players.some(p => p.id === reEntryTargetPlayer.id)) {
                  setPlayers(prev => [...prev, reEntryTargetPlayer]);
                }

                setBenchPlayers(prev => {
                  const withoutB = prev.filter(p => p.id !== reEntryTargetPlayer.id);
                  if (reEntryFromPlayer && !withoutB.some(p => p.id === reEntryFromPlayer.id)) {
                    return [...withoutB, reEntryFromPlayer];
                  }
                  return withoutB;
                });

                setShowReEntryModal(false);
                setReEntryFromPlayer(null);
                setReEntryTargetPlayer(null);
                setReEntryOrder1(null);
              }}
              className="w-full h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-md"
            >
              確定
            </button>

            <button
              onClick={() => {
                setShowReEntryModal(false);
                setReEntryFromPlayer(null);
                setReEntryTargetPlayer(null);
                setReEntryOrder1(null);
              }}
              className="w-full h-12 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-semibold shadow-md"
            >
              キャンセル
            </button>
          </div>

        </div>

        {/* セーフエリア確保（iPhone下部） */}
        <div className="h-[max(env(safe-area-inset-bottom),12px)]" />
      </div>
    </div>
  </div>
)}



{/* ✅ 代打モーダル（スマホ風・中央配置・機能は既存のまま） */}
{showSubModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 画面中央に配置（全ブレイクポイントで中央） */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full max-w-3xl
          max-h-[85vh]
          overflow-y-auto
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 固定ヘッダー（代走と同系色のグラデ） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <div className="flex items-center gap-2">
            <img
              src="/Ofence.png"  // ← 代打用PNG。ファイル名が違う場合は調整
              alt="代打アイコン"
              width={28}
              height={28}
              className="w-7 h-7 object-contain select-none drop-shadow"
              loading="lazy"
              decoding="async"
              draggable="false"
            />
            <h2 className="text-xl font-extrabold tracking-wide">代打</h2>
          </div>
          <button
            onClick={() => setShowSubModal(false)}
            aria-label="閉じる"
            className="rounded-full w-9 h-9 flex items-center justify-center
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-4">

          {/* 現打者（カード表示） */}
          <div className="px-4 py-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 font-bold text-center">
            {currentBatterIndex + 1}番{" "}
            {getPlayer(battingOrder[currentBatterIndex]?.id)?.lastName}{" "}
            {getPlayer(battingOrder[currentBatterIndex]?.id)?.firstName}{" "}
            <span className="whitespace-nowrap">#
              {getPlayer(battingOrder[currentBatterIndex]?.id)?.number}
            </span>
          </div>

          {/* ベンチ（出場可能） */}
          <div>
            <div className="text-sm font-bold text-slate-700 mb-2">控え選手（出場可能）</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-40 overflow-y-auto">
              {activeBench.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setSelectedSubPlayer(p)}
                  className={[
                    "w-full text-sm px-3 py-2 rounded-xl border text-left",
                    "active:scale-[0.99] transition shadow-sm",
                    selectedSubPlayer?.id === p.id
                      ? "bg-emerald-50 ring-2 ring-emerald-500 border-emerald-200 font-bold"
                      : "bg-white hover:bg-emerald-50 border-slate-200"
                  ].join(" ")}
                >
                  {/* 名前は省略（truncate）・背番号は改行しない */}
                  <span className="flex items-baseline gap-2 min-w-0">
                    <span className="truncate">{p.lastName} {p.firstName}</span>
                    <span className="text-xs text-slate-600 shrink-0 whitespace-nowrap">#{p.number}</span>
                  </span>
                </button>
              ))}
              {activeBench.length === 0 && (
                <div className="text-sm text-slate-500 col-span-full text-center py-3">
                  出場可能なベンチ選手がいません
                </div>
              )}
            </div>
          </div>

          {/* 出場済み選手（出場不可） */}
          {retiredBench.length > 0 && (
            <div>
              <div className="text-sm font-bold text-slate-700 mb-2">出場済み選手（出場不可）</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto">
                {retiredBench.map((p) => (
                  <div
                    key={p.id}
                    className="w-full text-sm px-3 py-2 rounded-xl border text-left
                               bg-slate-200 text-slate-500 border-slate-200 cursor-not-allowed"
                    title="出場済みのため選択不可"
                  >
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="truncate">{p.lastName} {p.firstName}</span>
                      <span className="text-xs shrink-0 whitespace-nowrap">#{p.number}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* アナウンス文（枠内＝赤／アイコンは反転なし／読み上げ＝青） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm shadow-red-800/30">
            <div className="flex items-start gap-2 mb-2">
              <img
                src="/mic-red.png"
                alt="mic"
                className="w-5 h-5 translate-y-0.5"
              />
              <span id="pinch-preview" className="whitespace-pre-line text-base font-bold text-red-700 leading-relaxed block">
                {/* 先頭打者なら通常アナウンスの前置きを追加 */}
                {isLeadingBatter && (
                  <>
                    {`${inning}回${isTop ? "表" : "裏"}、${teamName}の攻撃は、`}
                    <br />
                  </>
                )}

                {currentBatterIndex + 1}番{" "}
                {/* 元打者は「苗字のみ」指定だが、重複姓なら自動でフル */}
                <RenderName p={getPlayer(battingOrder[currentBatterIndex]?.id)} preferLastOnly={true} />
                {(getPlayer(battingOrder[currentBatterIndex]?.id)?.isFemale ? "さん" : "くん")}に代わりまして

                {/* 代打選手の最初の紹介はフルで見せる */}
                <RenderName p={selectedSubPlayer} preferLastOnly={false} />
                {(selectedSubPlayer?.isFemale ? "さん" : "くん")}、
                <br />

                バッターは{" "}
                {/* ここは「苗字のみ」指定だが、重複姓なら自動でフル */}
                <RenderName p={selectedSubPlayer} preferLastOnly={true} />
                {(selectedSubPlayer?.isFemale ? "さん" : "くん")}
                {(() => {
                  const num = (selectedSubPlayer?.number ?? "").trim();
                  return num ? `、背番号 ${num}` : "、";
                })()}

              </span>

            </div>

            {/* 読み上げ・停止 */}
            {/* 読み上げ／停止（横いっぱい・等幅） */}
            <div className="grid grid-cols-2 gap-2">
              <button
              onClick={speakPinchModal}

                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                          inline-flex items-center justify-center gap-2 shadow-md ring-1 ring-white/40"
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap leading-none">読み上げ</span>
              </button>

              <button
                onClick={() => stop()}
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                          inline-flex items-center justify-center shadow-md ring-1 ring-white/25"
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>

          </div>

          {/* 下部の確定・キャンセルボタン（色は代走と統一） */}
          {/* 確定／キャンセル（横いっぱい・等幅） */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={async () => {
                // 既存ロジック（変更なし）
                pushHistory();

                const replacedId = battingOrder[currentBatterIndex].id;
                const replaced = getPlayer(replacedId);
                const isStarter = battingOrder.find(e => e.id === replacedId)?.reason === "スタメン";

                if (replaced && selectedSubPlayer) {
                  const usedInfo: Record<number, { fromPos: string; subId: number; reason: "代打" | "代走" | "守備交代"; order: number; wasStarter: boolean; }>
                    = (await localForage.getItem("usedPlayerInfo")) || {};

                  const posMap: Record<string, string> = {
                    "ピッチャー": "投", "キャッチャー": "捕", "ファースト": "一",
                    "セカンド": "二", "サード": "三", "ショート": "遊",
                    "レフト": "左", "センター": "中", "ライト": "右",
                    "投": "投", "捕": "捕", "一": "一", "二": "二", "三": "三",
                    "遊": "遊", "左": "左", "中": "中", "右": "右",
                  };

                  const fullFromPos = getPosition(replaced.id);
                  const fromPos = posMap[fullFromPos ?? ""] ?? fullFromPos ?? "";

                  usedInfo[replaced.id] = {
                    fromPos,
                    subId: selectedSubPlayer.id,
                    reason: "代打",
                    order: currentBatterIndex + 1,
                    wasStarter: isStarter,
                  };

                  await localForage.setItem("usedPlayerInfo", usedInfo);
                  setUsedPlayerInfo(usedInfo);
                }

                if (selectedSubPlayer) {
                  const newOrder = [...battingOrder];
                  newOrder[currentBatterIndex] = { id: selectedSubPlayer.id, reason: "代打" };
                  setBattingOrder(newOrder);
                  await localForage.setItem("battingOrder", newOrder);

                  if (!players.some(p => p.id === selectedSubPlayer.id)) setPlayers(prev => [...prev, selectedSubPlayer]);
                  if (!allPlayers.some(p => p.id === selectedSubPlayer.id)) setAllPlayers(prev => [...prev, selectedSubPlayer]);
                  if (!substitutedIndices.includes(currentBatterIndex)) setSubstitutedIndices(prev => [...prev, currentBatterIndex]);

                  const replaced2 = getPlayer(battingOrder[currentBatterIndex]?.id);
                  const sub2 = selectedSubPlayer;
                  if (replaced2 && sub2) {
                    const honorBef = replaced2.isFemale ? "さん" : "くん";
                    const honorSub = sub2.isFemale ? "さん" : "くん";
                    const prefix = isLeadingBatter
                      ? `${inning}回${isTop ? "表" : "裏"}、${teamName}の攻撃は、<br/>`
                      : "";

                    const num = (sub2.number ?? "").trim(); // ★追加：背番号
                    const first = (sub2.firstName ?? "").trim(); // ★追加：名（空判定）

                    // 名がある時だけ「名」を入れる
                    const subNameHtml = first
                      ? `${rubyLast(sub2)} ${rubyFirst(sub2)}`
                      : `${rubyLast(sub2)}`;

                    const html =
                      `${prefix}${currentBatterIndex + 1}番 ` +
                      `${rubyLast(replaced2)} ${honorBef}に代わりまして ` +
                      `${subNameHtml} ${honorSub}、` +
                      `バッターは ${rubyLast(sub2)} ${honorSub}` +
                      `${num ? `、背番号 ${num}` : ""}。`;

                    setAnnouncementHTML(html);
                  }


                  setShowSubModal(false);
                }
              }}
              className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white
                        shadow-md shadow-emerald-300/40 focus:outline-none focus-visible:ring-2
                        focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
            >
              確定
            </button>

            <button
              onClick={() => setShowSubModal(false)}
              className="w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white
                        shadow-md shadow-amber-300/40"
            >
              キャンセル
            </button>
          </div>

        </div>

        {/* セーフエリア確保（iPhone下部） */}
        <div className="h-[max(env(safe-area-inset-bottom),12px)]" />
      </div>
    </div>
  </div>
)}


{/* ✅ 代走モーダル（中央配置・カラフル・背番号は改行しない） */}
{showRunnerModal && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 全デバイスで中央配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full md:max-w-md
          max-h-[85vh] md:max-h-[80vh]
          overflow-y-auto
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* 固定ヘッダー（グラデ＋白文字） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <div className="flex items-center gap-2">
            <img
              src="/Runner.png"
              alt="ランナー"
              width={28}
              height={28}
              className="w-7 h-7 object-contain select-none drop-shadow"
              loading="lazy"
              decoding="async"
              draggable="false"
            />
            <h2 className="text-xl font-extrabold tracking-wide">代走</h2>
          </div>
          <button
            onClick={() => {
              setShowRunnerModal(false);
            }}
            aria-label="閉じる"
            className="rounded-full w-9 h-9 flex items-center justify-center
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="px-4 py-3 space-y-4">

          {/* === STEP 1: 対象ランナー選択 === */}
          {selectedRunnerIndex === null && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-center text-slate-900">代走対象のランナーを選択</h3>

              <div className="space-y-2">
                {battingOrder.map((entry, index) => {
                  const player = getPlayer(entry.id);
                  const isUsed = Object.values(replacedRunners).some(r => r?.id === player?.id);
                  if (!player) return null;
                  const selected = selectedRunnerIndex === index;

                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onClick={() => !isUsed && setSelectedRunnerIndex(index)}
                      disabled={isUsed}
                      className={[
                        "w-full text-left border rounded-2xl px-4 py-3",
                        "flex items-center justify-between",
                        "active:scale-[0.99] transition shadow-sm",
                        isUsed
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed border-slate-200"
                          : selected
                            ? "bg-emerald-50 ring-2 ring-emerald-500 border-emerald-200"
                            : "bg-white hover:bg-emerald-50 border-slate-200"
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-emerald-100 text-emerald-900 font-bold shrink-0">
                          {index + 1}
                        </span>

                        {/* ★ 名前=省略、番号=改行禁止 */}
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span className="font-bold text-slate-900 truncate">
                            {player.lastName} {player.firstName}
                          </span>
                          <span className="text-xs text-slate-600 shrink-0 whitespace-nowrap">
                            #{player.number}
                          </span>
                        </div>
                      </div>
                      <span className="text-emerald-600">›</span>
                    </button>
                  );
                })}
              </div>

              {/* キャンセル（目立つアンバー） */}
              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setShowRunnerModal(false);
                    setSelectedRunnerIndex(null);
                    setSelectedBase(null);
                    setSelectedSubRunner(null);
                    setRunnerAssignments({ "1塁": null, "2塁": null, "3塁": null });
                    setReplacedRunners({ "1塁": null, "2塁": null, "3塁": null });
                    setRunnerAnnouncement([]);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white
                             shadow-md shadow-amber-300/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* === STEP 2: 塁の選択 === */}
          {selectedRunnerIndex !== null && selectedBase === null && (
            <div className="space-y-4">
              <h3 className="text-base font-semibold text-center text-slate-900">ランナーはどの塁にいますか？</h3>
              <div className="grid grid-cols-3 gap-2">
                {["1塁", "2塁", "3塁"].map((base) => (
                  <button
                    key={base}
                    disabled={runnerAssignments[base] !== null}
                    onClick={() => setSelectedBase(base as "1塁" | "2塁" | "3塁")}
                    className={[
                      "px-4 py-3 rounded-2xl border text-center font-bold transition active:scale-[0.99]",
                      runnerAssignments[base]
                        ? "bg-slate-200 cursor-not-allowed text-slate-500 border-slate-200"
                        : "bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 shadow-sm"
                    ].join(" ")}
                  >
                    {base}
                  </button>
                ))}
              </div>

              <div className="flex justify-end">
                <button
                  onClick={() => {
                    setShowRunnerModal(false);
                    setSelectedRunnerIndex(null);
                    setSelectedBase(null);
                    setSelectedSubRunner(null);
                    setRunnerAssignments({ "1塁": null, "2塁": null, "3塁": null });
                    setReplacedRunners({ "1塁": null, "2塁": null, "3塁": null });
                    setRunnerAnnouncement([]);
                  }}
                  className="px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white
                             shadow-md shadow-amber-300/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2"
                >
                  キャンセル
                </button>
              </div>
            </div>
          )}

          {/* === STEP 3: トグル＋内容・選手選択 === */}
          {selectedBase && (
            <div className="space-y-4"> 
              {/* 臨時代走トグル（アンバーチップ） */}
              <div className="flex items-center justify-center">
                <label className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-amber-100 text-amber-900 border border-amber-200">
                  <input
                    type="checkbox"
                    className="scale-110 accent-amber-600"
                    checked={!!tempRunnerFlags[selectedBase]}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      const base = selectedBase!;
                      setTempRunnerFlags(prev => ({ ...prev, [base]: checked }));

                      // 以降：既存ロジック維持（プレビュー更新）
                      const runnerId = selectedRunnerIndex != null ? battingOrder[selectedRunnerIndex]?.id : undefined;
                      const replaced = runnerId ? getPlayer(runnerId) : null;
                      const sub = runnerAssignments[base];

                      setRunnerAnnouncement(prev => {
                        const prefix = `${base}ランナー`;
                        const updated = prev.filter((msg) => !msg.startsWith(prefix));
                        if (!sub) return updated;

                        // ★ 敬称
                        const honorificFrom = replaced?.isFemale ? "さん" : "くん";
                        const honorificTo = sub?.isFemale ? "さん" : "くん";

                        // ★ フル/苗字は formatNameForAnnounce に委譲（重複姓ならフルに自動昇格）
                        const fromName = replaced ? `${formatNameForAnnounce(replaced, true)}${honorificFrom}` : "";
                        const toNameFull = `${formatNameForAnnounce(sub, false)}${honorificTo}`;
                        const toNameLast = `${formatNameForAnnounce(sub, true)}${honorificTo}`;

                        const num = (sub.number ?? "").trim();

                        const basePrefix = fromName
                          ? `${prefix} ${fromName}に代わりまして、`
                          : `${prefix}に代わりまして、`;

                        const text = checked
                          ? (
                              // 臨時代走
                              basePrefix +
                              `臨時代走、${toNameLast}、臨時代走は ${toNameLast}` +
                              `${num ? `、背番号 ${num}。` : "。"}`
                            )
                          : (
                              // 通常代走
                              basePrefix +
                              `${toNameFull}、${prefix}は ${toNameLast}` +
                              `${num ? `、背番号 ${num}。` : "。"}`
                            );


                        setAnnouncementHTML(text);
                        return [...updated, text];
                      });

                    }}
                  />
                  <span className="font-bold">臨時代走</span>
                </label>
              </div>
            </div>
          )}

          {/* === 以降：元の STEP3 本文（見た目のみカラー変更） === */}
          {selectedRunnerIndex !== null && selectedBase !== null && (
            <>
              <h3 className="text-lg font-bold text-slate-900">代走設定内容</h3>
<div className="text-md mb-2">
  {(() => {
    const runner = getPlayer(battingOrder[selectedRunnerIndex].id);
    const sub = runnerAssignments[selectedBase];
    const isTemp = !!tempRunnerFlags[selectedBase];

    const formatBadge = (n?: string) => {
      const v = (n ?? "").trim();
      return v ? `#${v}` : "#";
    };

    // ★ 名がある時だけ付ける（undefined対策）
    const formatName = (p?: { lastName?: string; firstName?: string }) => {
      const ln = (p?.lastName ?? "").trim();
      const fn = (p?.firstName ?? "").trim();
      return fn ? `${ln}${fn}` : ln;
    };

    const fromText = runner
      ? `${formatName(runner)} ${formatBadge(runner.number)}`
      : "";

    const toText = sub
      ? `➡ ${isTemp ? "（" : ""}${formatName(sub)} ${formatBadge(sub.number)}${isTemp ? "）" : ""}`
      : "➡";

    return (
      <p className="px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900">
        {selectedBase}：{fromText} {toText}
      </p>
    );
  })()}
</div>


              <h3 className="text-lg font-bold text-slate-900">代走として出す選手を選択</h3>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {orderByBattingFromPrev(
                  tempRunnerFlags[selectedBase]
                    ? onFieldPlayers.filter((p) => p.id !== (battingOrder[selectedRunnerIndex!]?.id))
                    : activeBench,
                  (selectedRunnerIndex ?? 0) + battingOrder.length
                ).map((player) => {
                  const isUsedElsewhere = Object.entries(runnerAssignments)
                    .some(([b, p]) => p?.id === player.id && b !== selectedBase);
                  const isSelected = runnerAssignments[selectedBase!]?.id === player.id;

                  return (
                    <button
                      key={player.id}
                      type="button"
                      disabled={isUsedElsewhere}
                      aria-pressed={isSelected}
onClick={() => {
  const base = selectedBase!;
  // 代走される元ランナー（打順側）
  const runnerId = selectedRunnerIndex != null ? battingOrder[selectedRunnerIndex].id : null;
  const replaced = runnerId ? getPlayer(runnerId) : null;

  // 選択反映
  setRunnerAssignments(prev => ({ ...prev, [base]: player }));
  setReplacedRunners(prev => ({ ...prev, [base]: replaced || null }));
  setSelectedRunnerByBase(prev => ({ ...prev, [base]: player }));

  // 表示用
  const isTemp = !!tempRunnerFlags[base];
  const baseKanji = base.replace("1","一").replace("2","二").replace("3","三");
  const prefix = `${baseKanji}ランナー`;

  // 敬称
  const honorificFrom = replaced?.isFemale ? "さん" : "くん";
  const honorificTo   = player.isFemale ? "さん" : "くん";

  // ★重複姓対応：formatNameForAnnounce(person, preferLastOnly)
  //   preferLastOnly=true → 基本は苗字のみ、同姓重複なら自動でフル（ルビ付）
  //   preferLastOnly=false → 常にフル（ルビ付）
  const fromName   = replaced ? `${formatNameForAnnounce(replaced, true)}${honorificFrom}` : "";
  const toNameFull = `${formatNameForAnnounce(player, false)}${honorificTo}`;
  const toNameLast = `${formatNameForAnnounce(player,  true)}${honorificTo}`;

  // 文言（HTML）
  const num = (player.number ?? "").trim();

  const text = isTemp
    ? ((fromName ? `${prefix} ${fromName}に代わりまして、` : `${prefix}に代わりまして、`) +
        `臨時代走、${toNameLast}、臨時代走は ${toNameLast}。`)
    : ((fromName ? `${prefix} ${fromName}に代わりまして、` : `${prefix}に代わりまして、`) +
        `${toNameFull}、${prefix}は ${toNameLast}` +
        (num ? `、背番号 ${num}。` : "。"));


  // 同じ塁の既存テキストを置き換え
  setRunnerAnnouncement(prev => {
    const updated = prev.filter(msg =>
      !msg.startsWith(`${base}ランナー`) && !msg.startsWith(`${baseKanji}ランナー`)
    );
    return [...updated, text];
  });
}}

                      className={[
                        "text-sm px-3 py-2 rounded-xl border text-center transition active:scale-[0.99]",
                        isUsedElsewhere
                          ? "bg-slate-200 text-slate-500 cursor-not-allowed border-slate-200"
                          : isSelected
                            ? "bg-emerald-50 ring-2 ring-emerald-500 border-emerald-200 font-bold"
                            : "bg-white hover:bg-emerald-50 border-slate-200"
                      ].join(" ")}
                      title={isUsedElsewhere ? "他の塁で選択済み" : ""}
                    >
                      {/* ★ 1行配置：名前は省略、背番号は改行禁止 */}
                      <span className="flex items-center justify-between w-full gap-2 min-w-0">
                        <span className="truncate">{player.lastName} {player.firstName}</span>
                        <span className="shrink-0 whitespace-nowrap">#{player.number}</span>
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* アナウンス文言エリア（枠内＝赤／読み上げ＝青） */}
              {runnerAnnouncement && runnerAnnouncement.length > 0 && (
                <div className="mb-3 rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm shadow-red-800/30">
                  <div className="mb-3 flex items-start gap-2">
                    <img
                        src="/mic-red.png"
                        alt="mic"
                        className="w-5 h-5 translate-y-0.5"
                      />
                    <div className="space-y-1 font-bold text-red-600 [&_rt]:text-red-700">
                      {["1塁", "2塁", "3塁"].map((base) => {
                        const kanji = base.replace("1", "一").replace("2", "二").replace("3", "三");
                        return runnerAnnouncement
                          .filter(
                            (msg) =>
                              msg.startsWith(`${base}ランナー`) ||
                              msg.startsWith(`${kanji}ランナー`)
                          )
                          .map((msg, idx) => (
                            <div key={`${base}-${idx}`} dangerouslySetInnerHTML={{ __html: msg }} />
                          ));
                      })}
                    </div>
                  </div>

{/* 読み上げ／停止（横いっぱい・等幅） */}
<div className="grid grid-cols-2 gap-2">
  {/* 読み上げ＝青 */}
  <button
    onClick={() =>
      announce(
        ["1塁", "2塁", "3塁"]
          .map((base) => {
            const kanji = base.replace("1", "一").replace("2", "二").replace("3", "三");
            return runnerAnnouncement.find(
              (msg) =>
                msg.startsWith(`${base}ランナー`) ||
                msg.startsWith(`${kanji}ランナー`)
            );
          })
          .filter(Boolean)
          .join("、")
      )
    }
    className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
               inline-flex items-center justify-center gap-2 shadow-md ring-1 ring-white/40"
  >
    <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
    <span className="whitespace-nowrap leading-none">読み上げ</span>
  </button>

  {/* 停止＝赤 */}
  <button
    onClick={() => stop()}
    className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
               inline-flex items-center justify-center shadow-md ring-1 ring-white/25"
  >
    <span className="whitespace-nowrap leading-none">停止</span>
  </button>
</div>

                </div>
              )}

              {/* 操作ボタン行（色をしっかり差別化） */}
{/* もう1人／キャンセル／確定（横いっぱい・等幅） */}
<div className="sticky bottom-0 grid grid-cols-3 gap-2">
  <button
    onClick={() => {
      setSelectedSubRunner(null);
      setSelectedRunnerIndex(null);
      setSelectedBase(null);
    }}
    className="w-full h-10 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white
               shadow-md shadow-indigo-300/40"
  >
    もう1人
  </button>

  <button
    onClick={() => {
      setShowRunnerModal(false);
      setSelectedRunnerIndex(null);
      setSelectedBase(null);
      setSelectedSubRunner(null);
      setRunnerAssignments({ "1塁": null, "2塁": null, "3塁": null });
      setReplacedRunners({ "1塁": null, "2塁": null, "3塁": null });
      setRunnerAnnouncement([]);
    }}
    className="w-full h-10 rounded-xl bg-amber-500 hover:bg-amber-600 text-white
               shadow-md shadow-amber-300/40"
  >
    キャンセル
  </button>

  {/* 確定（Primary=Emerald） */}
  <button
    onClick={async () => {
      // 既存ロジック（変更なし）
      pushHistory();

      const newOrder = [...battingOrder];
      const newUsed: Record<number, any> =
        (await localForage.getItem("usedPlayerInfo")) || {};
      const lineup: Record<string, number | null> =
        (await localForage.getItem("lineupAssignments")) || {};
      const wasStarterMap: Record<number, boolean> =
        (await localForage.getItem("wasStarterMap")) || {};
      let teamPlayerList = [...players];

      for (const [base, sub] of Object.entries(runnerAssignments)) {
        const replaced = replacedRunners[base as "1塁" | "2塁" | "3塁"];
        if (!sub || !replaced) continue;

        const idx = battingOrder.findIndex((e) => e.id === replaced.id);
        if (idx === -1) continue;

        const isTemp = !!tempRunnerFlags[base as "1塁" | "2塁" | "3塁"];
        if (isTemp) {
          const key = "tempRunnerByOrder";
          const tempMap =
            (await localForage.getItem<Record<number, number>>(key)) || {};
          tempMap[idx] = sub.id;
          await localForage.setItem(key, tempMap);
const isTemp = !!tempRunnerFlags[base as "1塁" | "2塁" | "3塁"];
if (isTemp) {
  // ① もともとの reason を保存
  const prevKey = "prevReasonByOrder";
  const prevMap =
    (await localForage.getItem<Record<number, string | null>>(prevKey)) || {};
  prevMap[idx] = battingOrder[idx]?.reason ?? null;
  await localForage.setItem(prevKey, prevMap);

  // ② 臨時代走の紐付け
  const key = "tempRunnerByOrder";
  const tempMap =
    (await localForage.getItem<Record<number, number>>(key)) || {};
  tempMap[idx] = sub.id;
  await localForage.setItem(key, tempMap);

  // ③ 表示上はその枠を「臨時代走」に
  newOrder[idx] = { id: replaced.id, reason: "臨時代走" };
  continue;
}

          continue;
        }

        newOrder[idx] = { id: sub.id, reason: "代走" };

        const posNameToSymbol: Record<string, string> = {
          "ピッチャー": "投", "キャッチャー": "捕", "ファースト": "一", "セカンド": "二",
          "サード": "三", "ショート": "遊", "レフト": "左", "センター": "中", "ライト": "右", "指名打者": "指",
        };

        const fullFrom = getPosition(replaced.id);
        const fromPos =
          (posNameToSymbol as any)[fullFrom ?? ""] ??
          (fullFrom && "投捕一二三遊左中右指".includes(fullFrom) ? fullFrom : "");

        newUsed[replaced.id] = {
          fromPos: fromPos || "",
          subId: sub.id,
          reason: "代走",
          order: idx + 1,
          wasStarter: !!wasStarterMap[replaced.id],
        };

        if (fromPos && lineup[fromPos] === replaced.id) {
          lineup[fromPos] = sub.id;
        }

        if (!teamPlayerList.some((p) => p.id === sub.id)) {
          teamPlayerList = [...teamPlayerList, sub];
        }
      }

      setBattingOrder(newOrder);
      await localForage.setItem("battingOrder", newOrder);

      setAssignments(lineup);
      await localForage.setItem("lineupAssignments", lineup);

      setUsedPlayerInfo(newUsed);
      await localForage.setItem("usedPlayerInfo", newUsed);

      setPlayers(teamPlayerList);
      const teamRaw = (await localForage.getItem("team")) as any;
      await localForage.setItem("team", { ...(teamRaw || {}), players: teamPlayerList });

      {
        const orderedMsgs = ["1塁", "2塁", "3塁"]
          .map((base) => {
            const kanji = base.replace("1","一").replace("2","二").replace("3","三");
            return runnerAnnouncement.find(
              (msg) =>
                msg.startsWith(`${base}ランナー`) ||
                msg.startsWith(`${kanji}ランナー`)
            );
          })
          .filter(Boolean) as string[];

        if (orderedMsgs.length > 0) {
          setAnnouncementHTML(orderedMsgs.join("<br/>"));
        }
      }

      setShowRunnerModal(false);
      setRunnerAssignments({ "1塁": null, "2塁": null, "3塁": null });
      setReplacedRunners({ "1塁": null, "2塁": null, "3塁": null });
      setRunnerAnnouncement([]);
      setSelectedRunnerIndex(null);
      setSelectedBase(null);
    }}
    className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white
               shadow-md shadow-emerald-300/40 focus:outline-none focus-visible:ring-2
               focus-visible:ring-emerald-400 focus-visible:ring-offset-2"
  >
    確定
  </button>
</div>

            </>
          )}
        </div>

        {/* セーフエリア確保（iPhone下部） */}
        <div className="h-[max(env(safe-area-inset-bottom),12px)]" />
      </div>
    </div>
  </div>
)}


{/* ✅ グラウンド整備モーダル（スマホ風・薄赤背景・読み上げは青／中央配置） */}
{showGroundPopup && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* ★ 全デバイスで中央配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full md:max-w-md
          max-h-[85vh] md:max-h-[80vh]
          overflow-y-auto
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-xl font-extrabold tracking-wide">グラウンド整備</h2>
          <button
            onClick={() => { stop(); setShowGroundPopup(false); }}
            aria-label="閉じる"
            className="rounded-full w-9 h-9 flex items-center justify-center
                       bg-white/15 hover:bg-white/25 active:bg-white/30
                       text-white text-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          >
            ×
          </button>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-6">

          {/* 上段：お願い */}
          <div className="space-y-3">
            {/* 注意チップ */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                            bg-amber-100 text-amber-900 border border-amber-200">
              <span className="text-xl">⚠️</span>
              <span>4回終了後🎤</span>
            </div>

            {/* アナウンス文言エリア（薄い赤） */}
            <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
              <div className="flex items-start gap-2">
                <p className="text-red-700 font-bold">
                  両チームはグランド整備をお願いします。
                </p>
              </div>
              {/* 読み上げ／停止（横いっぱい・等幅、改行なし） */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={() => speakText("両チームはグランド整備をお願いします。")}
                  className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                            inline-flex items-center justify-center gap-2 shadow-md"
                >
                  <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap leading-none">読み上げ</span>
                </button>

                <button
                  onClick={handleStop}
                  className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                            inline-flex items-center justify-center"
                >
                  <span className="whitespace-nowrap leading-none">停止</span>
                </button>
              </div>

            </div>
          </div>

          {/* 下段：お礼 */}
          <div className="space-y-3">
            {/* 注意チップ */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full
                            bg-amber-100 text-amber-900 border border-amber-200">
              <span className="text-xl">⚠️</span>
              <span>整備終了後🎤</span>
            </div>

            {/* アナウンス文言エリア（薄い赤） */}
            <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
              <div className="flex items-start gap-2">
                <p className="text-red-700 font-bold">
                  グランド整備、ありがとうございました。
                </p>
              </div>
              {/* 読み上げ／停止（横いっぱい・等幅、改行なし） */}
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  onClick={async () => { await speak("グランド整備、ありがとうございました。"); }}
                  className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                            inline-flex items-center justify-center gap-2 shadow-md"
                >
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

          {/* OKボタン */}
          <div className="pt-1">
            <button
              onClick={() => {
                stop();
                setShowGroundPopup(false);
                onSwitchToDefense(); // ✅ 守備画面へ
              }}
              className="w-full h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md"
            >
              OK
            </button>
          </div>

        </div>

        {/* セーフエリア */}
        <div className="h-[max(env(safe-area-inset-bottom),12px)]" />
      </div>
    </div>
  </div>
)}

{/* ✅ 開始時刻モーダル（スマホ風・機能そのまま／中央配置） */}
{showStartTimePopup && (
  <div className="fixed inset-0 z-50">
    {/* 背景オーバーレイ */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

    {/* 画面中央に配置 */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full md:max-w-md
          max-h-[75vh] md:max-h-[70vh]
          overflow-hidden flex flex-col
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        role="dialog"
        aria-modal="true"
        aria-label="開始時刻"
      >
        {/* 固定ヘッダー（マイク画像は削除して文言エリアへ移動） */}
        <div className="sticky top-0 z-10 px-4 py-3 flex items-center justify-between
                        bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
          <h2 className="text-xl font-extrabold tracking-wide">開始時刻</h2>
          <button
            onClick={() => setShowStartTimePopup(false)}
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
          {/* 注意チップ（そのまま） */}
          <div className="flex items-center gap-2">
            <div className="bg-amber-100 text-amber-900 border border-amber-200 px-3 py-1.5 text-sm font-semibold inline-flex items-center gap-2 rounded-full">
              <span className="text-xl">⚠️</span>
              <span>2番バッター紹介前に🎤</span>
            </div>
          </div>

          {/* 🔴 アナウンス文言エリア（ここにマイク画像・読み上げ／停止ボタンを内包） */}
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
            {/* 見出し（マイク画像をここへ移動） */}

            {/* 文言 */}
            <p className="text-lg font-bold text-red-700 text-center">
              この試合の開始時刻は {formatJaTime(gameStartTime)} です。
            </p>

            {/* 読み上げ／停止（横いっぱい・等幅、アイコン右に文言で改行なし） */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                           inline-flex items-center justify-center gap-2 shadow-md"
                onClick={async () => {
                  await speak(normalizeJapaneseTime(`この試合の開始時刻は${gameStartTime}です。`));
                }}
              >
                <IconMic className="w-5 h-5 shrink-0" aria-hidden="true" />
                <span className="whitespace-nowrap leading-none">読み上げ</span>
              </button>

              <button
                className="w-full h-10 rounded-xl bg-rose-600 hover:bg-rose-700 text-white
                           inline-flex items-center justify-center"
                onClick={() => stop()}
              >
                <span className="whitespace-nowrap leading-none">停止</span>
              </button>
            </div>
          </div>
        </div>

        {/* （任意）フッターにOK をまとめたい場合 */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={() => setShowStartTimePopup(false)}
            className="w-full bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-3 rounded-xl shadow-md font-semibold"
          >
            OK
          </button>
          <div className="h-[max(env(safe-area-inset-bottom),12px)]" />
        </div>
      </div>
    </div>
  </div>
)}

{/* ✅ メンバー交換モーダル */}
{showMemberExchangeModal && (
  <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
    {/* 背景 */}
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
    {/* カード */}
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="bg-white shadow-2xl rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 px-4 py-3 bg-gradient-to-r from-rose-600 to-pink-600 text-white shadow-md">
          <h2 className="text-lg font-extrabold text-center">メンバー交換（案内）</h2>
        </div>

        {/* 本文 */}
        <div className="px-4 py-4 space-y-3 overflow-y-auto">
          <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">

            <p className="whitespace-pre-wrap text-red-700 font-bold">
              {memberExchangeText}
            </p>

            {/* 読み上げ／停止（横いっぱい・等幅） */}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await speak(memberExchangeText);
                }}
                className="w-full h-10 rounded-xl bg-blue-600 hover:bg-blue-700 text-white
                          inline-flex items-center justify-center gap-2"
              >
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

        {/* フッター：OK → 従来の得点入力へ */}
        <div className="sticky bottom-0 inset-x-0 bg-white/95 backdrop-blur border-t px-4 py-3">
          <button
            onClick={async () => {
  setShowMemberExchangeModal(false);
  // 記録しておいた後続アクションを実行
  if (afterMemberExchange === "groundPopup") {
    setShowGroundPopup(true);
  } else if (afterMemberExchange === "seatIntro") {
    await goSeatIntroFromOffense();
  } else {
    // "switchDefense" ほかデフォルト
    onSwitchToDefense();
  }
  setAfterMemberExchange(null);
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


    </div>
     </DndProvider>
  );
};

export default OffenseScreen;
