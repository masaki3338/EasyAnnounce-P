import React, { useEffect, useState, useRef } from "react";
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useDrag } from "react-dnd";

import localForage from "localforage";
import { useNavigate } from "react-router-dom";
import { useMemo } from "react"; //
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

// 既存の import 群のすぐ下あたりに追記
// HTML要素からテキストを抽出、<ruby>タグは rt（ふりがな）優先で読む
function toReadable(root: HTMLElement): string {
  const clone = root.cloneNode(true) as HTMLElement;

  // ルビは「かな」を優先
  clone.querySelectorAll("ruby").forEach(ruby => {
    const rt = ruby.querySelector("rt");
    if (rt) {
      ruby.replaceWith(rt.textContent || "");
    } else {
      ruby.replaceWith(ruby.textContent || "");
    }
  });

  // テキスト化
  let text = clone.innerText || "";

  // ✅ 単独の「4番」だけを「よばん」に（14番/40番などは対象外）
  text = text.replace(/(^|[^0-9])4番(?![0-9])/g, "$1よばん");

  return text;
}


let ChangeFlg = 0; // 初期値

const getPlayerById = (players: Player[], id: number | null): Player | undefined => {
  if (id == null) return undefined;
  return players.find((p) => p.id === id);
};


type Player = {
  id: number;
  lastName?: string;
  firstName?: string;
  lastNameKana?: string;
  firstNameKana?: string; // ← 修正
  number: string;
  isFemale?: boolean;
};

type ChangeRecord =
  | {
      type: "replace";
      order: number;
      from: Player;
      to: Player;
      pos: string;
    }
  | {
      type: "shift";
      order: number;
      player: Player;
      fromPos: string;
      toPos: string;
    }
  | {
      type: "mixed";
      order: number;
      from: Player;
      to: Player;
      fromPos: string;
      toPos: string;
    };

const posNameToSymbol: Record<string, string> = {
  ピッチャー: "投",
  キャッチャー: "捕",
  ファースト: "一",
  セカンド: "二",
  サード: "三",
  ショート: "遊",
  レフト: "左",
  センター: "中",
  ライト: "右",
  指名打者: "指",
};

// ★ 最新ID(=いまフィールドに出る toId) から “元スタメンのID” を逆引き
// 最新ID (latestId) から“元スタメンのID”を逆引きする（型揃え & フォールバック強化版）
const resolveOriginalStarterId = (
  latestId: number,
  usedInfo: Record<string, any>,
  initialAssign: Record<string, number>
): number | null => {
  const latest = Number(latestId);

  // 1) 初期スタメン表そのものに含まれていれば元スタメン確定
  const starterSet = new Set(Object.values(initialAssign || {}).map((v) => Number(v)));
  if (starterSet.has(latest)) return latest;

  // 2) usedPlayerInfo の“キー”に latest が存在する場合も元スタメン確定（あなたのログのケース）
  if (usedInfo && Object.prototype.hasOwnProperty.call(usedInfo, String(latest))) {
    return latest;
  }

  // 3) 元ID→最新ID のチェーンを追跡して latest と一致するものを探す
  for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
    const orig = Number(origIdStr);

    // subId のチェーンを辿る（存在しなければ自分自身）
    let cur = Number((info as any)?.subId ?? orig);
    let guard = 20; // 無限ループ防止
    while (
      guard-- > 0 &&
      usedInfo[String(cur)] &&
      (usedInfo[String(cur)] as any)?.subId != null
    ) {
      cur = Number((usedInfo[String(cur)] as any).subId);
    }
    if (cur === latest) return orig;
  }

  return null;
};

// ─────────────────────────────────────────────
// 代打/代走の“連鎖”を末端まで辿って最終subIdを返す
// （先発 -> 代打A -> 代打B -> ... 最後のBを返す）
// ─────────────────────────────────────────────
const resolveLatestSubId = (
  startId: number,
  used: Record<number, { subId?: number }>
): number => {
  let cur = used[startId]?.subId;
  const seen = new Set<number>();
  while (cur && used[cur]?.subId && !seen.has(cur)) {
    seen.add(cur);
    cur = used[cur]!.subId;
  }
  // subが無ければ startId のまま（=入替なし）
  return cur ?? used[startId]?.subId ?? startId;
};


/* ===== 氏名＆敬称ヘルパー ===== */
const ruby = (kanji?: string, kana?: string): string =>
  kana ? `<ruby>${kanji}<rt>${kana}</rt></ruby>` : kanji ?? "";

/* 姓・名それぞれのルビ */
const lastRuby  = (p: Player): string => ruby(p.lastName,  p.lastNameKana);
const firstRuby = (p: Player): string => ruby(p.firstName, p.firstNameKana);

const honor = (p: Player): string => (p.isFemale ? "さん" : "くん");

/* 姓ルビ＋名ルビ（敬称なし） */
const fullName = (p: Player): string => `${nameRuby(p)}${firstRuby(p)}`;

/* 姓ルビ＋名ルビ＋敬称（控えから入る側） */
const fullNameHonor = (p: Player): string => `${fullName(p)}${honor(p)}`;

/* 姓ルビ＋敬称（移動／交代される側） */
const lastWithHonor = (p: Player): string => `${nameRuby(p)}${honor(p)}`;
// === NEW: 重複姓対応の名前ヘルパー ===============================
// window.__dupLastNames（上の useEffect で設定）を参照します
const isDupLast = (p?: Player) => {
  if (!p || !p.lastName) return false;
  const set: Set<string> | undefined = (window as any).__dupLastNames;
  return !!set && set.has(String(p.lastName));
};

/** 画面用：重複姓なら「姓ルビ＋名ルビ」、単独なら「姓ルビのみ」 */
const nameRuby = (p: Player): string => {
  return isDupLast(p) ? `${lastRuby(p)}${firstRuby(p)}` : lastRuby(p);
};

/** 本文用：重複姓ならフル（姓＋名）＋敬称、単独なら姓のみ＋敬称 */
const nameWithHonor = (p: Player): string => `${nameRuby(p)}${honor(p)}`;

/** 常にフル（姓＋名）＋敬称（控えが入る側などフル固定にしたい時用） */
const fullNameWithHonor = (p: Player): string => `${lastRuby(p)}${firstRuby(p)}${honor(p)}`;
// ================================================================

 /* ================================= */
// ✅ 「先ほど◯◯いたしました」を安全生成（未定義→代打にフォールバック）
const recentHead = (reason?: string) => {
  const kind =
    reason === "代走" ? "代走いたしました" :
    reason === "臨時代走" ? "臨時代走" :
    "代打いたしました"; // 既定は“代打”
  return `先ほど${kind}`;
};



/* =========================================================
   アナウンス文生成 ― テンプレート完全対応版
   (打順が欠落しない／一人交代時は「以上に代わります」を付けない)
========================================================= */
const generateAnnouncementText = (
  records: ChangeRecord[],
  teamName: string,
  battingOrder: { id: number; reason: string }[] = [],
  assignments: Record<string, number | null> = {},
  teamPlayers: Player[] = [],
  initialAssignments: Record<string, number | null> = {},
  usedPlayerInfo: Record<number, UsedPlayerInfo> = {},
  reentryPreviewIds: Set<number> = new Set(),   // ★ 追加
  reentryFixedIds:   Set<number> = new Set()    // ★ 追加
): string => {

   // ★ 追加：UIが青（preview or fixed）なら確定前でも「リエントリーで …」
    const isReentryBlue = (pid: number) =>
  reentryPreviewIds.has(pid) || reentryFixedIds.has(pid);

  /* ---------- 前処理 ---------- */
  const posJP: Record<string, string> = {
    投: "ピッチャー", 捕: "キャッチャー", 一: "ファースト", 二: "セカンド",
    三: "サード",   遊: "ショート",     左: "レフト",   中: "センター",  右: "ライト",   指: "指名打者", 
  };
  const reasonMap = Object.fromEntries(
    battingOrder.map(e => [e.id, e.reason])
  ) as Record<number, string>;
  
  // 打順一致リエントリー（深掘り版）: toIdの“元スタメン”を辿り、
// その最新sub（連鎖の末端）の打順が fromId の打順と一致（または末端が打順外=0）なら true
// 打順一致リエントリー（厳格版）:
// - toId は元スタメン本人であること（チェーンの起点そのもの）
// - 元スタメン系列の“最新sub（末端）”が fromId と同じ打順スロットを占めていること
const isReentryBySameOrderDeep = (
  fromId: number,
  toId: number,
  battingOrder: { id: number }[],
  used: Record<number, any>,
  initialAssignments: Record<string, number | null>
): boolean => {
  // 1) fromの打順（1-based）
  const fromIdx = battingOrder.findIndex(e => e.id === fromId);
  if (fromIdx < 0) return false;
  const fromOrder = fromIdx + 1;

  // 2) toId の“元スタメンID”を逆引き
  const toOrig = resolveOriginalStarterId(toId, used as any, initialAssignments as any);
  // 元スタメン本人でなければ不可
  if (toOrig == null || toOrig !== toId) return false;

  // 3) 元スタメン系列の最新sub（末端）
  const latest = resolveLatestSubId(toOrig, used as any);
  const latestIdx = battingOrder.findIndex(e => e.id === latest);
  if (latestIdx < 0) return false;          // ← ★ 末端が打順にいなければ不可（緩和しない）
  const latestOrder = latestIdx + 1;

  // 4) “同じ打順”のみOK
  return latestOrder === fromOrder;
};


  // ▼ 追加：usedPlayerInfo から「守備に入った代打/代走のID → 理由」を逆引き
  const pinchReasonById: Record<number, "代打" | "代走" | "臨時代走" | undefined> = {};
  Object.values(usedPlayerInfo || {}).forEach((info: any) => {
    if (!info) return;
    const r = info.reason as string | undefined;
    if ((r === "代打" || r === "代走" || r === "臨時代走") && typeof info.subId === "number") {
      pinchReasonById[info.subId] = r as any;
    }
  });

  const handledIds = new Set<number>();

  /* ---------- レコード分類 ---------- */
  let  replace = records.filter(r => r.type === "replace") as Extract<ChangeRecord, {type:"replace"}>[];
  let  shift    = records.filter(r => r.type === "shift")   as Extract<ChangeRecord, {type:"shift"}>[];
  let  mixed    = records.filter(r => r.type === "mixed")   as Extract<ChangeRecord, {type:"mixed"}>[];

  /* ---------- 文言生成用バッファ ---------- */
  const result: string[] = [];
  const lineupLines: {order:number; text:string}[] = [];
  let skipHeader = false;
  let reentryOccurred = false; // 🆕 このターンでリエントリー文を出したか
  const handledPlayerIds = new Set<number>();   // 👈 出力済みの選手ID
  const handledPositions = new Set<string>();   // 👈 出力済みの守備位置

  /* =================================================================
   🆕 特別処理: 代打選手に代わって控えが同じ守備位置に入ったケースを先に処理
               const handledIds = new Set<number>();
==================================================================== */
/* =================================================================
   🆕 SAME-POS-PINCH v2: usedPlayerInfo 駆動（“代打の代打”の連鎖にも対応）
   - 1 orig（元スタメン）につき 1 回だけ評価
   - 最新の代打ID = resolveLatestSubId(orig, usedPlayerInfo)
   - その守備(fromPos)に今いるのが控えなら「そのまま入り」
  ==================================================================== */
Object.entries(usedPlayerInfo || {}).forEach(([origIdStr, info]) => {
  if (!info || !["代打", "代走", "臨時代走"].includes(info.reason)) return;

  const origId = Number(origIdStr);
  const origPosName = info.fromPos as keyof typeof posJP;
  const posSym = (posNameToSymbol as any)[origPosName] ?? origPosName; // "サード"→"三"

  // ✅ 連鎖の末端（A→B→C…の C = 最新代打ID）を先に求める
  const latestPinchId = resolveLatestSubId(origId, usedPlayerInfo);
  if (!latestPinchId) return;

  // ✅ 打順 index を堅牢に取得（最新ID → 末端一致 → 元ID → 守備位置から逆引き）
  let ordIdx = battingOrder.findIndex(e => e.id === latestPinchId);
  if (ordIdx < 0) {
    ordIdx = battingOrder.findIndex(e => resolveLatestSubId(e.id, usedPlayerInfo) === latestPinchId);
  }
  if (ordIdx < 0) {
    ordIdx = battingOrder.findIndex(e => e.id === origId);
  }
  if (ordIdx < 0) {
    // 最終フォールバック：初期守備 → 打順スロットを逆引き
    ordIdx = battingOrder.findIndex(starter =>
      getPositionName(initialAssignments, starter.id) === posSym
    );
  }
  const orderPart = ordIdx >= 0 ? `${ordIdx + 1}番に ` : "";

  // いまその守備に入っている選手（控えが“そのまま入り”ならこのID）
  const currentId = assignments[posSym];

    // いま同守備に入っている currentId が「代打/代走 系」なら、
  // これは“代打本人が守備に就く”ケースなので SAME-POS-PINCH を使わずスキップする
  const currentIsPinch =
    ["代打", "代走", "臨時代走"].includes(
      (battingOrder.find(e => e.id === currentId)?.reason as any) || ""
    ) ||
    !!Object.values(usedPlayerInfo || {}).find(
      (x: any) => x?.subId === currentId && ["代打","代走","臨時代走"].includes(x.reason)
    );
  if (currentIsPinch) {
    console.log("[SAME-POS-PINCH] skip: current is pinch player", { currentId, posSym });
    return;
  }

    // ✅ 元スタメン復帰は “そのまま入り” から除外してリエントリールートへ回す
  const starterIds = new Set(Object.values(initialAssignments || {}).map(v => Number(v)));
  console.log("[SAME-POS-PINCH] guard", {
    currentId,
    isStarter: starterIds.has(Number(currentId)),
    posSym,
  });
// ✅ 元スタメンの“元ID”を逆引き（currentId が元スタメン本人なら origOfCurrent===currentId）
const origOfCurrent = resolveOriginalStarterId(
  Number(currentId),
  usedPlayerInfo as any,
  initialAssignments as any
);
const isOriginalStarter = Number(origOfCurrent) === Number(currentId);

// 参考：forEach 内で使っている元スタメンID（origId）と同一かどうか
const isBackToSameStarter = Number(currentId) === Number(origId);

console.log("[SAME-POS-PINCH] guard.v2", {
  currentId,
  origOfCurrent,
  isOriginalStarter,
  isBackToSameStarter,
  posSym,
});

// ✅ 元スタメン本人が戻る／元スタメンIDと一致 → リエントリールートに回す
if (isOriginalStarter || isBackToSameStarter) {
  console.log("[SAME-POS-PINCH] skip(v2): original starter reentry path");
  return;
}


  // 🛑 元スタメン（origId）が“どこかの守備”に戻っている → この特別処理は出さない
  if (Object.values(assignments).includes(origId)) {
    console.log("[SAME-POS-PINCH] skip: reentry already established (anywhere)", { origId });
    return;
  }


  if (!currentId) return;


  // 直前代打本人がまだ同守備にいるなら“控えが入った”ケースではない
  if (currentId === latestPinchId) return;

  // 直前代打本人が別守備に出ているならこの特別処理は不要
  const latestIsElsewhere = Object.entries(assignments)
    .some(([k, v]) => v === latestPinchId && k !== posSym);
  if (latestIsElsewhere) return;

  const subPlayer = teamPlayers.find(p => p.id === currentId);
  if (!subPlayer) return;

  // 元スタメンなら「控えがそのまま入り」ではない
  if (Object.values(initialAssignments).includes(subPlayer.id)) return;

  // 重複抑止
  if (handledPlayerIds.has(subPlayer.id) || handledPositions.has(posSym)) return;

  const latestPinchPlayer = teamPlayers.find(p => p.id === latestPinchId);
  if (!latestPinchPlayer) return;

// ★現在の理由（確定後はここが「途中出場」や空になる想定）を優先して見る
const currentReasonNow =
  (battingOrder?.find((e: any) => Number(e?.id) === Number(latestPinchId))?.reason) ??
  (reasonMap as any)?.[Number(latestPinchId)] ??
  "";

// ★フォールバック：過去理由（usedPlayerInfo/pinchReasonById）
const latestReasonPast = (pinchReasonById as any)?.[latestPinchId] || info.reason;

// 「直後」判定：いまも代打/代走扱いなら先ほど文言を出す
const isJustNowPinch = ["代打", "代走", "臨時代走"].includes(String(currentReasonNow).trim());

// 表示用の語尾
const reasonBase = (isJustNowPinch ? currentReasonNow : latestReasonPast);
const reasonText =
  String(reasonBase).trim() === "代打" ? "代打いたしました" :
  String(reasonBase).trim() === "臨時代走" ? "臨時代走" :
  "代走いたしました";

// ★デバッグ（確認用）
console.log("[SAME-POS-PINCH] reason check", {
  latestPinchId,
  currentReasonNow,
  latestReasonPast,
  isJustNowPinch,
  posSym,
});

// ---- 本文（末尾は後段で句点付与）----
if (isJustNowPinch) {
  // 直後だけ「先ほど…」
  result.push(
    `先ほど${reasonText}${nameWithHonor(latestPinchPlayer)}に代わりまして、` +
    `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
  );
} else {
  // 確定後は「指名打者の◯◯くんに代わりまして、」
  result.push(
    `${posJP[posSym]}の ${nameWithHonor(latestPinchPlayer)}に代わりまして、` +
    `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
  );
}


// ★ 打順は「代打/代走で入っていた打順枠（latestPinchId）」を使う
const pinchOrderIdx = battingOrder.findIndex(e => e.id === latestPinchId);
if (pinchOrderIdx >= 0) {
  const lineupOrder = pinchOrderIdx + 1;

  const text = `${lineupOrder}番 ${posJP[posSym]} ${fullNameWithHonor(subPlayer)} 背番号 ${subPlayer.number}`;

  if (!lineupLines.some(l => l.order === lineupOrder && l.text.includes(posJP[posSym]))) {
    lineupLines.push({ order: lineupOrder, text });
  }
}



  // ヘッダー抑止＆通常処理に回さない
  //skipHeader = true;
  handledPlayerIds.add(subPlayer.id);
  handledPositions.add(posSym);
});

  const skipShiftPairs = new Set<string>();


  let suppressTailClose = false; // 🆕 このターンは末尾に「に入ります。」を付けない
  // 🆕 リエントリー + 守備変更（ユーザー希望フォーマット）
Object.entries(usedPlayerInfo || {}).forEach(([origIdStr, info]) => {
  if (!info || (info.reason !== "代打" && info.reason !== "代走" && info.reason !== "臨時代走")) return;

  const origId = Number(origIdStr);          // B（元スタメン）
  // ★ Bが“今”入っている守備（略号）を探す（同守備/別守備の両対応）
  const posNowSym = Object.entries(assignments).find(([k, v]) => v === origId)?.[0];
  if (!posNowSym) return; // Bがフィールドに居ない → リエントリー未成立

  const B = teamPlayers.find(p => p.id === origId);
  const A = teamPlayers.find(p => p.id === info.subId);
  if (!A || !B) return;

  const posFull = posJP[posNowSym as keyof typeof posJP];
  const reasonText = info.reason === "代走" ? "代走" : "代打";


// 1行目：希望フォーマット（句点なし）
// ★★★ ここから置換 ★★★
{
  // ★ 元スタメンB（origId）が “今” 入っている守備
  const posNowSym2 = Object.entries(assignments).find(([k, v]) => v === origId)?.[0];
  if (!posNowSym2) return;

  const B2 = teamPlayers.find(p => p.id === origId);
  const A2 = teamPlayers.find(p => p.id === info.subId); // 代打/代走で一度入った選手（A）
  if (!A2 || !B2) return;

  const posFull2 = posJP[posNowSym2 as keyof typeof posJP];

  // ★ replace配列から「このポジでBが入ったとき、誰から代わったか」を拾う（最優先）
  const replacedRec = replace.find(r => r.pos === posNowSym2 && r.to.id === B2.id);
  const replaced = replacedRec?.from ?? null;

  // ★ Aにさらに代走Cが乗っていたかを usedPlayerInfo から末端まで追跡
  const latestId = resolveLatestSubId(Number(origId), usedPlayerInfo); // B→A→C... の末端ID
  const latestPlayer =
    latestId && latestId !== origId ? teamPlayers.find(p => p.id === latestId) : undefined;
  // subId→理由 の逆引き（上の方で作っているマップを再利用）
  const latestReason = latestPlayer ? (pinchReasonById[latestPlayer.id] ?? reasonMap[latestPlayer.id]) : undefined;

  // ★ “相手にする選手” と “先ほど◯◯いたしました” の文言を決定
  // 1) replaceから拾えた相手がA2と別人（= 直前はたとえばCだった）→ その人を採用
  // 2) それが拾えない・同一なら、usedPlayerInfoの末端（CがいればC、いなければA）を採用
  let refPlayer: Player | undefined;
  let refReason: "代打" | "代走" | "臨時代走" | undefined;

  if (replaced && (!A2 || replaced.id !== A2.id)) {
    refPlayer = replaced;
    refReason =
      (pinchReasonById[replaced.id] as any) ||
      (reasonMap[replaced.id] as any) ||
      undefined;
  } else if (latestPlayer) {
    refPlayer = latestPlayer;
    refReason =
      (latestReason as any) ||
      (info.reason as any); // 念のため
  } else {
    // フォールバック：Aを相手に
    refPlayer = A2;
    refReason = info.reason as any;
  }

  // 表現の統一：「代走」/「臨時代走」/「代打」
  const phrase =
    refReason === "代走" ? "代走" :
    refReason === "臨時代走" ? "臨時代走" :
    "代打";

// ▼ 追加：refPlayer の“現在”の理由を確認（直後かどうかの判定に使う）
const currentRefReason: string | undefined =
  refPlayer ? (reasonMap as any)?.[refPlayer.id] : undefined;

// 「代走/臨時代走」だったが、今は「途中出場」になっている ＝ 直後ではない
const useSimpleForm =
  (refReason === "代走" || refReason === "臨時代走") &&
  currentRefReason === "途中出場";

// 直後でなければ「先ほど〜いたしました」を使わず、位置付きの通常形にする
const firstLine = useSimpleForm
  ? `${posFull2} ${nameWithHonor(refPlayer)}に代わりまして、` +
    `${nameWithHonor(B2)}がリエントリーで ${posFull2}に入ります。`
  : `先ほど${phrase}いたしました${nameWithHonor(refPlayer)}に代わりまして、` +
    `${nameWithHonor(B2)}がリエントリーで ${posFull2}に入ります。`;

//result.push(firstLine);
console.log("[REENTRY-LINE]", useSimpleForm ? "simple" : "recent", {
  refId: refPlayer?.id, toId: B2?.id, posFull: posFull2
});


// ★ リエントリー選手（B2）の打順行も出す
// まずは B本人、だめなら “Bの最新subId”、さらにダメなら “今の打順の元スタメンがB” かで探す
const orderBIdx = (() => {
  // 1) B本人がそのまま打順にいる
  let idx = battingOrder.findIndex(e => e.id === B2.id);
  if (idx >= 0) return idx;

  // 2) Bの“最新代替（清水など）”が打順にいる
  const latestOfB = resolveLatestSubId(B2.id, usedPlayerInfo as any);
  if (latestOfB) {
    idx = battingOrder.findIndex(e => e.id === latestOfB);
    if (idx >= 0) return idx;
  }

  // 3) 打順エントリ側の“元スタメン”を逆引きして、それがBならそのスロットを採用
  idx = battingOrder.findIndex(e =>
    resolveOriginalStarterId(e.id, usedPlayerInfo as any, initialAssignments as any) === B2.id
  );
  return idx;
})();

const orderB = orderBIdx >= 0 ? orderBIdx + 1 : 0;

if (
  orderB > 0 &&
  !lineupLines.some(l =>
    l.order === orderB &&
    l.text.includes(posFull2) &&
    l.text.includes(nameRuby(B2))
  )
) {
  lineupLines.push({
    order: orderB,
    // リエントリーは背番号なしの体裁
    text: `${orderB}番 ${posFull2} ${nameWithHonor(B2)}`
  });
}


// デバッグログ（どちらの分岐を使ったか確認用）
console.log("[REENTRY-LINE]",
  useSimpleForm ? "simple" : "recent",
  {
    refId: refPlayer?.id,
    refReason,           // もともとの理由（代打/代走/臨時代走）
    currentRefReason,    // 現在の理由（途中出場なら直後ではない）
    toId: B2?.id,
    posFull: posFull2
  }
);


  result.push(firstLine);
    // ✅ このリエントリー分はここで完結（後続の mixed/shift による重複出力を抑止）
  handledPlayerIds.add(B.id);
  handledPositions.add(posNowSym);
  reentryOccurred = true;
  suppressTailClose = true;
  return; // ← この forEach の現在イテレーションを終わらせる

  console.log("[REENTRY-LINE] add", { from: refPlayer?.id, to: B2.id, pos: posNowSym2, phrase });


}
// ★★★ ここまで置換 ★★★




// 2行目：Bが入った位置（= posNowSym）に“元々いた選手”の処理 —— ★mixedを最優先★
const mixedR = mixed.find(m => m.fromPos === posNowSym && !handledPlayerIds.has(m.from.id));

if (mixedR) {
  // 例：「レフト 河村…に代わりまして 6番に 小池…が入り サード」
  const orderTo = battingOrder.findIndex(e => e.id === mixedR.to.id) + 1;
  const orderPart = orderTo > 0 ? `${orderTo}番に ` : "";
  result.push(
    `${posFull} ${nameWithHonor(mixedR.from)}に代わりまして` +
    `${orderPart}${fullNameWithHonor(mixedR.to)}が入り${posJP[mixedR.toPos]}、`
  );

  // 打順エリア（6番サード小池…）を必ず積む
  if (orderTo > 0 && !lineupLines.some(l => l.order === orderTo && l.text.includes(posJP[mixedR.toPos]))) {
    lineupLines.push({
      order: orderTo,
      text: `${orderTo}番 ${posJP[mixedR.toPos]} ${fullNameWithHonor(mixedR.to)} 背番号 ${mixedR.to.number}`,
    });
  }

  // 後続の通常出力に載らないようにブロック
  handledPlayerIds.add(mixedR.from.id);
  handledPlayerIds.add(mixedR.to.id);
  handledPositions.add(mixedR.fromPos);
} else {
  // フォールバック：純粋なシフト（元々いた選手が他守備へ動いた）だけのとき
  const move = shift.find(s => s.fromPos === posNowSym);
  if (move) {
    result.push(`${posFull}の${nameWithHonor(move.player)}が${posJP[move.toPos]}、`);
    skipShiftPairs.add(`${move.player.id}|${move.fromPos}|${move.toPos}`);

    const orderM = battingOrder.findIndex(e => e.id === move.player.id) + 1;
    if (orderM > 0 && !lineupLines.some(l => l.order === orderM && l.text.includes(posJP[move.toPos]))) {
      lineupLines.push({ order: orderM, text: `${orderM}番 ${posJP[move.toPos]} ${nameWithHonor(move.player)}` });
    }
  }
}


  // 後続の通常出力に載らないように最低限ブロック
  handledPlayerIds.add(B.id);
  handledPositions.add(posNowSym);

reentryOccurred = true; // 🆕 リエントリーを出した回であることを記録
  suppressTailClose = true;
});


  // ▼ リエントリー対象（＝代打/代走で一度退いた元のスタメンが、自分の元ポジに戻ってきた）
  const reentryToIds = new Set<number>();
  Object.entries(usedPlayerInfo || {}).forEach(([origIdStr, info]) => {
    if (info && (info.reason === "代打" || info.reason === "代走" || info.reason === "臨時代走")) {
      // 元いた守備の記号に正規化（"サード" → "三" など）
      const sym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos;
      const origId = Number(origIdStr);
      if (assignments[sym] === origId) {
        reentryToIds.add(origId);
      }
    }
  });

/* ============================================================
   ✅ 特別処理：代打退場 → 控えが別守備 → 元選手がシフト
   ※ ヒットしたら即 return で通常ロジックをスキップ
============================================================= */
/* ✅ 特別処理：代打退場 → 控えが別守備 → 元選手がシフト */
const specialResult = (() => {
  for (const [idx, entry] of battingOrder.entries()) {
    // ✅ 代打・代走 両方対象にする
    if (!["代打", "代走", "臨時代走"].includes(entry.reason)) continue;

    const pinch = teamPlayers.find(p => p.id === entry.id);
    if (!pinch) continue;

    // ✅ usedPlayerInfo から subId を元に検索（代打・代走両方）
    const pinchInfoPair = Object.entries(usedPlayerInfo)
      .find(([, info]) =>
         ["代打", "代走", "臨時代走"].includes(info.reason) && info.subId === entry.id
      );
    if (!pinchInfoPair) continue;

    const [origStarterIdStr, pinchInfo] = pinchInfoPair;
  const origPosName = pinchInfo.fromPos as keyof typeof posJP;
const origPosSym  = (posNameToSymbol as any)[origPosName] ?? origPosName;
const origStarterId = Number(origStarterIdStr);

// 🛑 B（元先発）が“どこかの守備に戻っている”＝リエントリー成立 → 特別処理は使わない
const isBOnField = Object.values(assignments).includes(origStarterId);
if (isBOnField) continue;



    // 現在守備にいない（退場している）ことが条件
    if (Object.values(assignments).includes(entry.id)) continue;

    const movedPlayerId = assignments[origPosSym];
    if (!movedPlayerId || movedPlayerId === entry.id) continue;
    const movedPlayer = teamPlayers.find(p => p.id === movedPlayerId)!;

    const movedFromPos = Object.entries(initialAssignments)
      .find(([p, id]) => id === movedPlayerId)?.[0] as keyof typeof posJP;
    if (!movedFromPos || movedFromPos === origPosSym) continue;

    const movedToPos = origPosSym;

    // ✅ movedFromPos を求めた後に subIn 決定
    const subInId = assignments[movedFromPos];
    if (
      !subInId ||
      Object.values(initialAssignments).includes(subInId) ||
      subInId === entry.id
    ) continue;

    const subInPos = movedFromPos;
    const subIn = teamPlayers.find(p => p.id === subInId)!;

    console.log("✅ 特別処理：代打／代走 → 控えが別守備 → 元選手がシフト");

    const lines: string[] = [];

    // ✅ 文言を切り替える
    const reasonText = entry.reason === "代打" ? "代打いたしました" : "代走いたしました";

    // 1行目：控えが別守備に入る（★打順は書かない）
    lines.push(
      `先ほど${reasonText}${nameWithHonor(pinch)}に代わりまして、` +
      `${fullNameWithHonor(subIn)}が入り${posJP[subInPos]}、`
    );


    // 2行目：実際にこの行で動くのは movedPlayer。
    //        その「最初に入った理由」を movedPlayer.id で判定する（entry/pinch ではなく！）
    const movedTrueReason =
      Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === movedPlayer.id)?.reason
      || (battingOrder.find(e => e.id === movedPlayer.id)?.reason);

    console.log("[SPECIAL] 2nd-line reason resolve (by movedPlayer)", {
      movedId: movedPlayer.id,
      reasonFromUsed: Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === movedPlayer.id)?.reason,
      reasonFromOrder: battingOrder.find(e => e.id === movedPlayer.id)?.reason,
      movedTrueReason
    });

    if (movedTrueReason === "代走" || movedTrueReason === "臨時代走") {
      // 代走で入った選手が守備へ → 専用文言（句点で締めて追加入力を防ぐ）
      lines.push(`先ほど代走いたしました${nameWithHonor(movedPlayer)}が ${posJP[movedToPos]}へ。`);
      console.log("[SPECIAL] 2nd-line as DAISO");
    } else if (movedTrueReason === "代打") {
      // 代打で入った選手が守備へ
      lines.push(`先ほど代打いたしました${nameWithHonor(movedPlayer)}が ${posJP[movedToPos]}へ。`);
      console.log("[SPECIAL] 2nd-line as DAIDA");
    } else {
      // 通常シフト
      lines.push(`${posJP[movedFromPos]}の${nameWithHonor(movedPlayer)}が ${posJP[movedToPos]}、`);
      console.log("[SPECIAL] 2nd-line as NORMAL");
    }

    // ✅ 重複抑止：この特別処理で出した “元選手のシフト” は後続の shift 出力から除外
    skipShiftPairs.add(`${movedPlayer.id}|${movedFromPos}|${movedToPos}`);

    // ✅ 重複抑止：この特別処理で出した “控え入場(replace相当)” は後続 replace から除外
    handledPlayerIds.add(subIn.id);
    handledPositions.add(subInPos as string);

    // ✅ 代打/代走本人は通常処理に回さない
    handledIds.add(entry.id);

// 打順行
// 打順行は lines ではなく lineupLines に積む（あとで一括出力）
const lineup: { order: number; txt: string }[] = [];

// ★ subIn（控え）の打順は「代打エントリ(entry.id)の打順」を使う
const pinchOrderIdx = battingOrder.findIndex(e => e.id === entry.id); // 例：6番なら 5
if (pinchOrderIdx >= 0) {
  lineup.push({
    order: pinchOrderIdx + 1,
    txt: `${pinchOrderIdx + 1}番 ${posJP[subInPos]} ${fullNameWithHonor(subIn)} 背番号 ${subIn.number}`,
  });
}

// ★ movedPlayer（元の5番など）は自分の打順のまま、移動後の守備を出す
const movedOrder = battingOrder.findIndex(e => e.id === movedPlayer.id);
if (movedOrder >= 0) {
  lineup.push({
    order: movedOrder + 1,
    txt: `${movedOrder + 1}番 ${posJP[movedToPos]} ${nameWithHonor(movedPlayer)}`,
  });
}


// ここで lineupLines に移す（重複防止つき）
lineup.forEach(l => {
  if (!lineupLines.some(x => x.order === l.order && x.text === l.txt)) {
    lineupLines.push({ order: l.order, text: l.txt });
  }
});

// ❌ 「以上に代わります。」は出さない
return lines; // ← lines には“文言（先ほど…／〜に入ります）”だけが入っている状態で return

  }
  return null;
})();

if (specialResult) {
  // 念のため：特別処理から「以上に代わります。」が来ても除去
  const filtered = specialResult.filter(l => !l.trim().endsWith("以上に代わります。"));
  result.push(...filtered);
  skipHeader = true;  // （必要なら）ヘッダー抑止
  // return しない：このまま通常の replace/mixed/shift へ続行
}







/* =================================================================
✅ 特化ブロック（代打 → 守備入り → 元守備選手が移動）
  ==================================================================== */
const pinchShiftLines: string[] = [];

/* =================================================================
   🆕 特別処理: 代打・代走 → 守備入り（相互入れ替え含む）まとめ処理
   ==================================================================== */
battingOrder.forEach((entry, idx) => {
  if (!["代打", "代走", "臨時代走"].includes(entry.reason)) return;
  if (handledIds.has(entry.id)) return;

  const pinchPlayer = teamPlayers.find(p => p.id === entry.id);
  if (!pinchPlayer) return;

  const pos = Object.entries(assignments)
    .find(([_, id]) => id === entry.id)?.[0] as keyof typeof posJP;
  if (!pos) return;

  const originalId = initialAssignments[pos];
  if (!originalId || originalId === entry.id) return;

  const movedPlayer = teamPlayers.find(p => p.id === originalId);
  if (!movedPlayer) return;

  const movedToPos = Object.entries(assignments)
    .find(([k, v]) => v === originalId)?.[0] as keyof typeof posJP;
  if (!movedToPos || movedToPos === pos) return;

// ★ 相互入れ替え（代打A⇄代打B）を usedPlayerInfo と assignments から検出する
//    A: entry.id。Aの「元いた守備」= fromA（usedPlayerInfo）／「今いる守備」= toA（assignments）
//    B: otherId。Bの「元いた守備」= fromB（=toA）／「今いる守備」= curPosB（=fromA）
const pinchFromPosById = new Map<number, string>();
Object.values(usedPlayerInfo || {}).forEach((info: any) => {
  if (!info) return;
  if (["代打","代走","臨時代走"].includes(info.reason) && typeof info.subId === "number") {
    const sym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos; // "サード"→"三" 等を正規化
    pinchFromPosById.set(info.subId, sym);
  }
});
const curPosOf = (id: number) =>
  Object.entries(assignments).find(([k, v]) => v === id)?.[0] as keyof typeof posJP | undefined;

// A側
const fromA = pinchFromPosById.get(entry.id);
const toA   = (Object.entries(assignments).find(([k, v]) => v === entry.id)?.[0] as keyof typeof posJP) || pos;

// Bを探索：「fromB===toA」かつ「curPosB===fromA」の代打/代走
const otherId = [...pinchFromPosById.entries()]
  .find(([id, fromB]) => id !== entry.id && fromB === toA && curPosOf(id) === fromA)?.[0];

if (fromA && toA && otherId) {
  const pinchPlayer = teamPlayers.find(p => p.id === entry.id)!;   // A
  const movedPlayer = teamPlayers.find(p => p.id === otherId)!;    // B

  const headById = (id: number) => {
    const r = ((usedPlayerInfo as any)[id]?.reason) || (pinchReasonById[id] || reasonMap[id]);
    return r === "代走" ? "代走いたしました" : r === "臨時代走" ? "臨時代走" : "代打いたしました";
  };


// ★ 2人分を“1エントリ”で必ず出す（後段の整形で消えないようにする）
const phraseA = headById(entry.id);
const phraseB = headById(otherId);
const prefixB = phraseA === phraseB ? "同じく先ほど" : "先ほど";

const combined =
  `先ほど${phraseA}${nameWithHonor(pinchPlayer)}が${posJP[toA]}、\n` +
  `${prefixB}${phraseB}${nameWithHonor(movedPlayer)}が${posJP[fromA]}に入ります。`;
result.push(combined);

  // 二重出力防止
  skipShiftPairs.add(`${pinchPlayer.id}|${fromA}|${toA}`);
  skipShiftPairs.add(`${movedPlayer.id}|${toA}|${fromA}`);
  handledIds.add(entry.id);
  handledIds.add(movedPlayer.id);
  handledPlayerIds.add(pinchPlayer.id);
  handledPlayerIds.add(movedPlayer.id);
  handledPositions.add(toA);
  handledPositions.add(fromA);

  // 打順行（重複防止付き）
  lineupLines.push({ order: idx + 1, text: `${idx + 1}番 ${posJP[toA]} ${nameWithHonor(pinchPlayer)}` });
  const movedOrder = battingOrder.findIndex(e => e.id === movedPlayer.id);
  if (movedOrder >= 0) {
    lineupLines.push({ order: movedOrder + 1, text: `${movedOrder + 1}番 ${posJP[fromA]} ${nameWithHonor(movedPlayer)}` });
  }
  return; // 通常分岐へ流さない
  
}


  // ★ 相手が通常選手の場合は従来通り
// ★ 相手が通常選手の場合は従来通り（2行に分割 + 重複スキップ登録）
result.push(`先ほど${entry.reason}いたしました${nameWithHonor(pinchPlayer)}が${posJP[pos]}、`);
result.push(`${posJP[pos]}の${nameWithHonor(movedPlayer)}が ${posJP[movedToPos]}、`);

// 以降の shift ループで同じ「movedPlayer のシフト」を出さない
skipShiftPairs.add(`${movedPlayer.id}|${pos}|${movedToPos}`);


  lineupLines.push({ order: idx + 1, text: `${idx + 1}番 ${posJP[pos]} ${nameWithHonor(pinchPlayer)}` });
  const movedOrder = battingOrder.findIndex(e => e.id === movedPlayer.id);
  if (movedOrder >= 0) {
    lineupLines.push({ order: movedOrder + 1, text: `${movedOrder + 1}番 ${posJP[movedToPos]} ${nameWithHonor(movedPlayer)}` });
  }

  handledIds.add(entry.id);
  handledIds.add(movedPlayer.id);
  handledPlayerIds.add(pinchPlayer.id);
  //handledPlayerIds.add(movedPlayer.id);
  handledPositions.add(pos);
  //handledPositions.add(movedToPos);
  handledPlayerIds.add(pinchPlayer.id); // 代打/代走本人だけ
  handledPositions.add(pos);            // 本人が入った守備位置だけ
});


if (pinchShiftLines.length > 0) {
  result.push(...pinchShiftLines);

  // 通常の交代（replace / mixed / shift）がなければ打順行を出力
  if (replace.length === 0 && mixed.length === 0 && shift.length === 0) {
    lineupLines
      .sort((a, b) => a.order - b.order)
      .forEach((l) => result.push(l.text));
  }

  // 「以上に代わります」はあとでまとめて判定されるのでここでは入れない
  skipHeader = true;
  // return はしない！
}

/* =========================================
  1) 代打・代走 → そのまま守備へ (samePosPinch)
========================================= */
type PinchLine = { reason: "代打" | "代走"| "臨時代走"; text: string };
const pinchInSamePos: PinchLine[] = [];

battingOrder.forEach((entry, idx) => {
  
  const player = teamPlayers.find(p => p.id === entry.id);
  if (!player) return;

  const pos = Object.entries(assignments).find(([_, id]) => id === entry.id)?.[0] as keyof typeof posJP | undefined;
  if (!pos) return;

  // すでに特別処理（相互入替えなど）で扱った選手/守備はここでは出さない
  if (handledPlayerIds.has(player.id) || handledPositions.has(pos)) return;

  const wasReplaced = !!usedPlayerInfo[entry.id];
  const origIdAtPos = initialAssignments[pos];
  const unchanged =
   assignments[pos] === entry.id &&
   origIdAtPos != null &&
   resolveLatestSubId(origIdAtPos, usedPlayerInfo) === entry.id;

  if ((entry.reason === "代打" || entry.reason === "代走" || entry.reason === "臨時代走") && !wasReplaced && unchanged) {
    const honor = player.isFemale ? "さん" : "くん";
    const ruby = `<ruby>${player.lastName}<rt>${player.lastNameKana ?? ""}</rt></ruby>${honor}`;

    // 直前の行と理由（代打/代走）が同じなら「同じく先ほど」
    // 違うなら毎回「先ほど」
    const prev = pinchInSamePos[pinchInSamePos.length - 1];
    const sameReason = prev ? prev.reason === entry.reason : false;
    const head = pinchInSamePos.length === 0 ? "先ほど" : (sameReason ? "同じく先ほど" : "先ほど");

    pinchInSamePos.push({
      reason: (entry.reason === "代打" ? "代打" : "代走"),
      text: `${head}${entry.reason}いたしました${ruby}がそのまま入り ${posJP[pos]}`
    });

    // 打順行は従来どおり
    lineupLines.push({
      order: idx + 1,
      text : `${idx + 1}番 ${posJP[pos]} ${ruby} `
    });    
    // 追加（重複出力を防ぐため、ここで処理済みにする）
    handledPlayerIds.add(player.id);
    handledPositions.add(pos);
  }
});

const pinchTexts = pinchInSamePos.map(p => p.text);
if (pinchTexts.length === 1) {
  result.push(pinchTexts[0]);
  //skipHeader = true;
} else if (pinchTexts.length > 1) {
  result.push(pinchTexts.join("、\n"));
  //skipHeader = true;
}

/* =========================================
  2) 代打・代走を含まない通常交代ロジック
　========================================= */
  const hasShift     = shift.length   > 0;
  const hasReplace   = replace.length > 0;
  const hasMixed     = mixed.length   > 0;
  const totalMoves   = shift.length + replace.length + mixed.length;

  /* ---- ヘッダー ---- */
  // ✅ 通常交代のヘッダー出力をスキップ可能にする
// （ヘッダー決定の直前に追加）


// ✅ リエントリーが1つでもあれば、最初に「選手の交代」を必ず付ける。
//    それ以外（通常のみ）のときは従来ルールのまま。
/* ---- ヘッダー ---- */
// ピンチ（代打/代走の「そのまま入り」）はこの時点で result に本文が入っている。
// 本文行が1つでもあれば、必ず「選手の交代…」を先頭に付ける（リエントリー含む）。
if (!skipHeader) {
  const hasBodyLinesAlready = result.length > 0;
  if (reentryOccurred || hasBodyLinesAlready) {
    const alreadyHasHeader = result.some(l => /お知らせいたします[。]$/.test(l.trim()));
    if (!alreadyHasHeader) {
      result.unshift(`${teamName}、選手の交代をお知らせいたします。`);
    }
  } else {
    if (hasMixed || (hasReplace && hasShift)) {
      result.push(`${teamName}、選手の交代並びにシートの変更をお知らせいたします。`);
    } else if (hasReplace) {
      result.push(`${teamName}、選手の交代をお知らせいたします。`);
    } else if (hasShift) {
      result.push(`${teamName}、シートの変更をお知らせいたします。`);
    }
  }
}



/* ---- 並べ替え：守備位置番号順に ---- */
const nextPosMap: Record<string, string> = { 二: "中", 中: "左", 左: "遊", 遊: "右" };

// 守備位置の表示順序（昇順）
const posOrder = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右", "指"];
const posIndex = (pos: string) => posOrder.indexOf(pos);

replace.sort((a, b) => posIndex(a.pos) - posIndex(b.pos));
mixed.sort((a, b) => posIndex(a.fromPos) - posIndex(b.fromPos));
shift.sort((a, b) => posIndex(a.fromPos) - posIndex(b.fromPos));

/* ---- replace / mixed ---- */
const addReplaceLine = (line: string, isLast: boolean) =>
  result.push(isLast ? line + "。" : line + "、");

const replaceLines: string[] = [];

// ✅ 特化ブロックで扱った選手・守備位置を除外
replace = replace.filter(r =>
  !handledPlayerIds.has(r.from.id) &&
  !handledPlayerIds.has(r.to.id) &&
  !handledPositions.has(r.pos)
);



replace.forEach((r) => {
  console.log("[ANN][REPLACE:start]", {
    fromId: r.from.id, toId: r.to.id, pos: r.pos, rOrder: r.order,
  });

    // ★ NEW: 深掘りした“打順一致”なら無条件でリエントリー確定（最優先）
  if (isReentryBySameOrderDeep(
        r.from.id, r.to.id, battingOrder, usedPlayerInfo as any, initialAssignments as any
      )) {

    replaceLines.push(
      `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、` +
      `${nameWithHonor(r.to)}がリエントリーで${posJP[r.pos]}`
    );

    // 打順行（重複防止）
    if (
      r.order > 0 &&
      !lineupLines.some(l =>
        l.order === r.order &&
        l.text.includes(posJP[r.pos]) &&
        l.text.includes(nameRuby(r.to))
      )
    ) {
      lineupLines.push({
        order: r.order,
        text: `${r.order}番 ${posJP[r.pos]} ${nameWithHonor(r.to)}`
      });
    }

    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.pos);
    reentryOccurred = true;
    return; // ← 以降の通常分岐へ進ませない
  }

  if (isReentryBlue(r.to.id)) {
    replaceLines.push(
      `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、` +
      `${nameWithHonor(r.to)}がリエントリーで${posJP[r.pos]}`
    );

    if (
        r.order > 0 &&
        !lineupLines.some(l =>
          l.order === r.order &&
          l.text.includes(posJP[r.pos]) &&
          l.text.includes(nameRuby(r.to))
        )
      ) {
        lineupLines.push({
          order: r.order,
          text: `${r.order}番 ${posJP[r.pos]} ${nameWithHonor(r.to)}`
        });
      }

    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.pos);
    reentryOccurred = true;
    return; // ← 通常の交代分岐へ進ませない
  }
  // === REENTRY（打順ベース）早期判定：必ず通常分岐より前に置く ===
{
  // r.to = 元スタメン候補（例：小池）
  const reentry_info = (usedPlayerInfo as any)?.[r.to.id];

  // いま r.from（例：百目鬼）が占めている打順番号（1-based / 0=無し）
  const reentry_fromOrder = (() => {
    const idx = battingOrder.findIndex(e => e.id === r.from.id);
    return idx >= 0 ? idx + 1 : 0;
  })();

  // 元スタメンの最新代替（清水など）→ その打順番号（居なければ 0）
  const reentry_latest = reentry_info ? resolveLatestSubId(r.to.id, usedPlayerInfo) : undefined;
  const reentry_latestOrder = (() => {
    if (!reentry_latest) return 0;
    const idx = battingOrder.findIndex(e => e.id === reentry_latest);
    return idx >= 0 ? idx + 1 : 0;
  })();

  // ★打順同一ならリエントリー（守備位置は問わない）
  const reentry_ok =
    !!reentry_info &&
    reentry_fromOrder > 0 &&
    (reentry_latestOrder === reentry_fromOrder || reentry_latestOrder === 0);

  console.log("[ANN][REPLACE:check-reentrySameOrder]", { from: r.from.id, to: r.to.id, pos: r.pos, rOrder: r.order });
  if (reentry_ok) {
    console.log("[ANN][REPLACE:fired-reentrySameOrder]", { from: r.from.id, to: r.to.id, pos: r.pos, rOrder: r.order });
    // 本文のみ。末尾の「に入ります。」は後段の整形で付与される
    replaceLines.push(
      `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、` +
      `${nameWithHonor(r.to)}がリエントリーで${posJP[r.pos]}`
    );

  if (
    r.order > 0 &&
    !lineupLines.some(l =>
      l.order === r.order &&
      l.text.includes(posJP[r.pos]) &&
      l.text.includes(nameRuby(r.to))
    )
  ) {
    lineupLines.push({
      order: r.order,
      text: `${r.order}番 ${posJP[r.pos]} ${nameWithHonor(r.to)}`
    });
  }

    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.pos);
    reentryOccurred = true;
    return; // ← 通常の交代分岐や打順行追加へ進ませない
  }
}

  // ★ 早期分岐：代打/代走の選手に代わって、同じ守備位置へ控えが入る → 「そのまま入り」
const pinchFromUsed = Object.values(usedPlayerInfo || {}).find(
  (x: any) => x?.subId === r.from.id && ["代打", "代走", "臨時代走"].includes(x.reason)
);
const isSamePosition = assignments[r.pos] === r.to.id;                 // 今その守備に入るのが to
const toWasStarter   = Object.values(initialAssignments || {}).includes(r.to.id); // 控え（to）が元スタメンかどうか
const toIsBenchEntry = !toWasStarter;                                   // 控え(=ベンチ)からの入場

// replace.forEach((r)=>{ ... }) の冒頭（「そのまま入り」分岐より前）
const infoForToEarly = (usedPlayerInfo as any)?.[r.to.id];
const latestSubIdForToEarly =
  infoForToEarly ? resolveLatestSubId(r.to.id, usedPlayerInfo) : undefined;
const toOrigPosSymEarly = infoForToEarly
  ? ((posNameToSymbol as any)[infoForToEarly.fromPos] ?? infoForToEarly.fromPos)
  : undefined;

const isReentryEarly =
  !!infoForToEarly &&
  latestSubIdForToEarly === r.from.id &&
  toOrigPosSymEarly === r.pos;   // ← r.order には依存しない

console.log("[ANN][REPLACE:check-reentryEarly]", { from: r.from.id, to: r.to.id, pos: r.pos });
if (isReentryEarly) {
  console.log("[ANN][REPLACE:fired-reentryEarly]", { from: r.from.id, to: r.to.id, pos: r.pos });
  replaceLines.push(
    `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、${nameWithHonor(r.to)}がリエントリーで${posJP[r.pos]}`
  );
  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  handledPositions.add(r.pos);
  reentryOccurred = true;
  return;  // 以降の通常分岐へは進まない
}

console.log("[ANN][REPLACE:check-samePosPinch]", {
  pinchFromUsed: !!pinchFromUsed,
  isSamePosition,
  toWasStarter,
  toIsBenchEntry,
});


if (pinchFromUsed && isSamePosition) {
  console.log("[ANN][REPLACE:fired-samePosPinch]", {
    fromId: r.from.id, toId: r.to.id, pos: r.pos, order: r.order,
  });
  const orderPart = r.order > 0 ? `${r.order}番に ` : "";
  const phrase =
    pinchFromUsed.reason === "代走" ? "代走" :
    pinchFromUsed.reason === "臨時代走" ? "臨時代走" :
    "代打";

  // ✅ 確定の一文（末尾はここでは句点なし：後段の終端調整で「。」を付与）
// いまこの選手が「現在」どんな理由になっているか（直後判定用）
const currentFromReasonNow: string | undefined =
  (battingOrder?.find((b: any) => Number(b?.id) === Number(r.from.id))?.reason as any) ??
  ((reasonMap as any)?.[Number(r.from.id)] as any);

const isStillJustPinch =
  ["代打", "代走", "臨時代走"].includes(String(currentFromReasonNow || "").trim());

// 直後でないなら「先ほど〜」を使わず通常形へ
if (!isStillJustPinch) {
  const head = buildFromHead(r.from.id, r.pos); // ←「指名打者の◯◯に代わりまして、」になる
  replaceLines.push(
    `${head}${orderPart}${fullNameWithHonor(r.to)}が入り ${posJP[r.pos]}`
  );
} else {
  // 従来通り「先ほど〜」を使う（直後だけ）
// ★ 直後判定：今この選手が「代打/代走扱いのまま」か？
const currentReasonNow =
  (battingOrder?.find((b: any) => Number(b?.id) === Number(r.from.id))?.reason) ??
  (reasonMap as any)?.[Number(r.from.id)];

const isJustNowPinch = ["代打", "代走", "臨時代走"].includes(String(currentReasonNow || "").trim());

// ✅ 確定の一文（末尾はここでは句点なし：後段の終端調整で「。」を付与）
if (isJustNowPinch) {
  // 「直後」だけ：先ほど文言あり
  replaceLines.push(
    `先ほど${phrase}いたしました${nameWithHonor(r.from)}に代わりまして、${orderPart}${fullNameWithHonor(r.to)}がそのまま入り${posJP[r.pos]}`
  );
} else {
  // 「一度確定した後」：通常文（あなたの理想）
  replaceLines.push(
    `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、${orderPart}${fullNameWithHonor(r.to)}が入り ${posJP[r.pos]}`
  );
}

return;

}



  // 重複抑止
  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  handledPositions.add(r.pos);

  // このケースではヘッダー不要
  //skipHeader = true;

  // この r は処理完了（通常分岐へは行かない）
  return;
}

  // ★ DH補完の「投手 replace(order:0)」は、同じ選手が mixed で「…→投」に入ってくるならスキップ
  if (r.order === 0 && r.pos === "投") {
    const hasMixedToSame = mixed.some(m => m.to.id === r.to.id && m.toPos === "投");
    if (hasMixedToSame) return;  // ← アナウンス行・重複管理の両方をここで回避
  }

// ★ リエントリー判定（打順や理由に依存しない）
const wasStarterTo = Object.values(initialAssignments || {}).includes(r.to.id);
const infoForTo = (usedPlayerInfo as any)?.[r.to.id];
// 「元スタメン(to)に、かつ、その元スタメンの subId が今の from（清水など）」
const isReentrySameOrder = !!wasStarterTo && !!infoForTo && infoForTo.subId === r.from.id;
// デバッグ（必要なら）
// console.debug("[REENTRY? replace]", { from: r.from.id, to: r.to.id, wasStarterTo, infoForTo, isReentrySameOrder });


// ★ 代打/代走の理由を堅牢に取得（usedPlayerInfo → battingOrder → reasonMap の順で拾う）
const getPinchReasonOf = (pid: number | string): string | undefined => {
  // 1) usedPlayerInfo の subId 一致を最優先（途中で battingOrder.reason が変わる場合があるため）
  const inUsed = Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === Number(pid));
  if (inUsed?.reason) return String(inUsed.reason).trim();

  // 2) battingOrder 由来（現時点の理由）
  const inOrder = battingOrder?.find((b: any) => b?.id === Number(pid));
  if (inOrder?.reason) return String(inOrder.reason).trim();

  // 3) 既存の逆引きマップ（あれば）
  const inMap = (reasonMap as any)?.[Number(pid)];
  return inMap ? String(inMap).trim() : undefined;
};

// === ここから各 r（= replace レコード）に対する処理 ===

// ★ まず「現在の打順（battingOrder）」の reason を優先して見る
const reasonNowInOrder = (() => {
  const inOrder = battingOrder?.find((b: any) => b?.id === Number(r.from.id));
  return inOrder?.reason ? String(inOrder.reason).trim() : "";
})();

// ★ battingOrder に reason があればそれを採用、なければ従来ロジック（usedPlayerInfo→reasonMap）へ
const reasonOfFrom = reasonNowInOrder || getPinchReasonOf(r.from.id);

// ★ 「先ほど代打/代走…」は、“現在のreasonが代打/代走系”の時だけ
const isPinchFrom = ["代打", "代走", "臨時代走"].includes((reasonOfFrom || "").trim());

// デバッグ（一時的）
// console.log("[REPLACE]", { fromId: r.from.id, reasonOfFrom, isPinchFrom, order: r.order, pos: r.pos });


// ★ ケース分岐：
let line: string;

if (isReentrySameOrder) {
  console.log("[REPLACE] REENTRY same-order", { from: r.from.id, to: r.to.id, pos: r.pos, order: r.order });
  line = `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、${nameWithHonor(r.to)}がリエントリーで${posJP[r.pos]}`;
} else if (isPinchFrom) {
  console.log("[ANN][PINCH:enter]", {
    fromId: r.from.id, toId: r.to.id, pos: r.pos, reasonOfFrom, rOrder: r.order,
  });

  // ★ 差し替え：代打/代走の「from」が持っていた打順スロットを厳密に逆引きする
  let orderIdxFrom = battingOrder.findIndex(e => e.id === r.from.id);
  console.log("[ANN][PINCH:orderIdxFrom#1]", orderIdxFrom);
  if (orderIdxFrom < 0) {
    // usedPlayerInfo の subId チェーンをたどって最新IDが from.id と一致するスロットを探す
    orderIdxFrom = battingOrder.findIndex(
      e => resolveLatestSubId(e.id, usedPlayerInfo as any) === r.from.id
    );
    console.log("[ANN][PINCH:orderIdxFrom#2(fallback latestSub)]", orderIdxFrom);
  }

  const orderNum = orderIdxFrom >= 0 ? orderIdxFrom + 1 : 0;
  const orderPart = orderNum > 0 ? `${orderNum}番に ` : "";

  // 「代打本人が守備に入る」ケースは別ブロックで処理済みなので、
  // ここは「代打に代わって控えが入る」専用にする
  line = `先ほど${reasonOfFrom}いたしました${nameWithHonor(r.from)}に代わりまして、` +
         `${orderPart}${fullNameWithHonor(r.to)}が入り ${posJP[r.pos]}`;
} else {
  line = `${posJP[r.pos]} ${nameWithHonor(r.from)}に代わりまして、${fullNameWithHonor(r.to)}`;
}

replaceLines.push(line);
console.log("[ANN][REPLACE:push]", line);
if (isReentrySameOrder) reentryOccurred = true; // ← 追加


  // ✅ 処理済み記録に追加
  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  handledPositions.add(r.pos);

// ✅ lineupLines 重複防止付き追加
if (r.order > 0 && !lineupLines.some(l =>
  l.order === r.order &&
  l.text.includes(posJP[r.pos])
)) {
  const isReentryTo = reentryToIds.has(r.to.id);
  lineupLines.push({
    order: r.order,
    text: isReentryTo
      ? `${r.order}番 ${posJP[r.pos]} ${nameWithHonor(r.to)}`
      : `${r.order}番 ${posJP[r.pos]} ${fullNameWithHonor(r.to)} 背番号 ${r.to.number}`
  });
}


});


// ✅ アナウンス出力（「そのまま入り …」は末尾を句点にする）
if (replaceLines.length === 1) {
  const base = replaceLines[0].trim();
  console.log("[DEBUG] replaceLines=1 base:", base)

  const POS_JA = "(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト|指名打者)";
  const isSonoMama     = new RegExp(`そのまま入り\\s*${POS_JA}\\s*$`).test(base);
  const isReentryBare  = new RegExp(`リエントリーで\\s*${POS_JA}\\s*$`).test(base);

  // ✅ 「…が入り ◯◯」「…が入り ◯◯へ／に」など“入り”を含む一文なら末尾に「入ります」を付けない
  const hasHairi = /入り/.test(base) ||
    new RegExp(`入り\\s*(?:${POS_JA})?(?:へ|に)?$`).test(base);

  const sentence = isSonoMama
    ? (shift.length > 0 ? base + "、" : base + "。")
    : isReentryBare
      ? (shift.length > 0 ? base + "に入ります、" : base + "に入ります。")
    : hasHairi
      ? (shift.length > 0 ? base + "、" : base + "。")
      : (shift.length > 0 ? base + "、" : base + "が入ります。");

  result.push(sentence);

} else if (replaceLines.length > 1) {
  const last = replaceLines.pop()!;
  console.log("[DEBUG] replaceLines>1 last:", last);
  const continuedLines = replaceLines.map(line => line + "、").join("\n");

  const POS_JA = "(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト|指名打者)";
  const lastIsSonoMama    = new RegExp(`そのまま入り\\s*${POS_JA}\\s*$`).test(last);
  const lastIsReentryBare = new RegExp(`リエントリーで\\s*${POS_JA}\\s*$`).test(last);

  // ✅ “入り”が含まれていれば末尾「入ります」を付けない（〜へ／〜に も対応）
  const hasHairiLast = /入り/.test(last) ||
    new RegExp(`入り\\s*(?:${POS_JA})?(?:へ|に)?$`).test(last);

  const lastLine = lastIsSonoMama
    ? (shift.length > 0 ? last + "、" : last + "。")
    : lastIsReentryBare
      ? (shift.length > 0 ? last + "に入ります、" : last + "に入ります。")
    : hasHairiLast
      ? (shift.length > 0 ? last + "、" : last + "。")
      : (shift.length > 0 ? last + "、" : last + "が入ります。");

 console.log("[DEBUG] 判定結果:", { lastIsSonoMama, lastIsReentryBare, hasHairiLast });

  result.push(`${continuedLines}\n${lastLine}`);

}


// ==== ヘルパー：mixed.forEach の直前に置く（同じ関数スコープ内！） ====

// その枠にいた選手(fromId)の「入場理由」を安全に逆引き（代打/代走/臨時代走 など）
const getEnterReason = (pid: number): string | undefined => {
  // usedPlayerInfo から subId 逆引き → battingOrder（reason） の順に拾う
  const inUsed = Object.values(usedPlayerInfo ?? {}).find((x: any) => x?.subId === pid)?.reason;
  if (inUsed) return String(inUsed).trim();
  const inOrder = battingOrder?.find((b: any) => b?.id === pid)?.reason;
  return inOrder ? String(inOrder).trim() : undefined;
};

// ヘッダー生成：代打/代走なら「先ほど◯◯いたしました清水くん に代わりまして、」
// それ以外（ベンチから守備で入っていた 等）は「〈守備〉の 清水くん に代わりまして、」
// ヘッダー生成：代打/代走なら「先ほど◯◯いたしました◯◯くんに代わりまして、」
// ただし “画面を開いた時点で既に出場中の選手” は、あとから交代しても「先ほど…」は使わない
const buildFromHead = (fromId: number, fromPosSym?: string) => {
  const p = teamPlayers.find(pp => Number(pp.id) === Number(fromId));
  const fromName = p ? nameWithHonor(p) : "";

  // ✅「この守備交代画面の基準（＝initialAssignments）に既に居るなら、もう“先ほど”ではない」
  const alreadyOnFieldWhenOpened = Object.values(initialAssignments ?? {}).some(
    (id) => Number(id) === Number(fromId)
  );

  const fromPosSymSafe = fromPosSym || "";
  const fromFull = fromPosSymSafe ? posJP[fromPosSymSafe as keyof typeof posJP] : "";

  // すでに出場中扱いなら、理由が代打/代走でも「指名打者の〜に代わりまして」に寄せる
  if (alreadyOnFieldWhenOpened) {
    return `${fromFull ? `${fromFull}の ` : ""}${fromName}に代わりまして、`;
  }

  const reason = getEnterReason(fromId);
  if (reason === "代打" || reason === "代走" || reason === "臨時代走") {
    const phrase =
      reason === "代走" ? "代走いたしました" :
      reason === "臨時代走" ? "臨時代走" :
      "代打いたしました";
    return `先ほど${phrase}${fromName}に代わりまして、`;
  }

  return `${fromFull ? `${fromFull}の ` : ""}${fromName}に代わりまして、`;
};



mixed.forEach((r, i) => {

    // ✅ まず重複防止（先に置く！）
  if (
    handledPlayerIds.has(r.from.id) ||
    handledPlayerIds.has(r.to.id)   ||
    handledPositions.has(r.toPos)
  ) return;

// >>> DIRECT REENTRY v2（代打→守備→元スタメンが戻る）を最優先で確定
{
  // r.to（入る側）の “元スタメンID” を逆引き
  const origIdTo = resolveOriginalStarterId(
    r.to.id,
    usedPlayerInfo as any,
    initialAssignments as any
  );
  const infoOrig = origIdTo ? (usedPlayerInfo as any)?.[origIdTo] : undefined;
  const latestSubOfOrig = origIdTo
    ? resolveLatestSubId(origIdTo, usedPlayerInfo as any)
    : undefined;

  // r.to が元スタメン系列で、かつ “その元スタメンの最新sub” が r.from ならリエントリー確定
  const isStarterChain =
    !!origIdTo &&
    !!infoOrig &&
    (origIdTo === r.to.id ||
     Object.values(initialAssignments || {}).some(id => Number(id) === Number(r.to.id)));

  const fromMatchesChain =
    !!latestSubOfOrig && Number(latestSubOfOrig) === Number(r.from.id);

  if (isStarterChain && fromMatchesChain) {
    const orderPart = r.order > 0 ? `${r.order}番に ` : "";
// ⛳ これを↓に置き換え（const orderPart行ごと削除）
// ✅ r.from（= 直前にその枠を占めていた“清水くん”等）の理由を安全に逆引き
const reasonOf = (pid: number): string | undefined => {
  const u = Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === pid);
  return (u?.reason as any) || (reasonMap as any)?.[pid]; // “代打/代走/臨時代走/途中出場…”
};
const head = buildFromHead(r.from.id, r.fromPos); // ← 代打/代走でなければ「〈守備〉の 清水くん…」
addReplaceLine(
  `${head}${nameWithHonor(r.to)}がリエントリーで入り ${posJP[r.toPos]}`,
  i === mixed.length - 1 && shift.length === 0
);


if (
  r.order > 0 &&
  !lineupLines.some(l => l.order === r.order && l.text.includes(posJP[r.toPos]) && l.text.includes(nameRuby(r.to)))
) {
  lineupLines.push({
    order: r.order,
    text: `${r.order}番 ${posJP[r.toPos]} ${nameWithHonor(r.to)}`
  });
}

    console.log("[MIXED] direct-reentry(v2) fired", {
      from: r.from.id,
      to: r.to.id,
      origIdTo,
      latestSubOfOrig,
      toPos: r.toPos
    });
    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.toPos);
    reentryOccurred = true;
    return; // ← 通常の「…が入り…へ」分岐に進ませない
  }
}
// <<< DIRECT REENTRY v2 END



    // ★ 追加：UIが青（preview or fixed）なら、確定前でも「リエントリーで …」
  if (isReentryBlue(r.to.id)) {
    const orderPart = r.order > 0 ? `${r.order}番に ` : "";
    // 例：「ライトの奥村くんに代わりまして、リエントリーで小池くんがライトへ」
    addReplaceLine(
      `${posJP[r.fromPos]}の ${nameWithHonor(r.from)}に代わりまして、` +
      `${orderPart}${nameWithHonor(r.to)}がリエントリーで ${posJP[r.toPos]}へ`,
      i === mixed.length - 1 && shift.length === 0
    );
  
    // 打順行（重複防止つき）
    if (
      r.order > 0 &&
      !lineupLines.some(l => l.order === r.order && l.text.includes(posJP[r.toPos]))
    ) {
      lineupLines.push({
        order: r.order,
        text: `${r.order}番 ${posJP[r.toPos]} ${nameWithHonor(r.to)}`
      });
    }

    // 後続の通常分岐に流さないための処理済みマーキング
    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.toPos);
    reentryOccurred = true;
    return; // ← ここで mixed の通常処理には進ませない
  }


// ✅ アナウンス文作成：from側の文言は buildFromHead に集約（確定後は“先ほど”禁止もここで効く）
const fromSym =
  r.fromPos ||
  (Object.entries(assignments)
    .find(([k, id]) => Number(id) === Number(r.from.id))?.[0] as any);

const head = buildFromHead(r.from.id, fromSym);

addReplaceLine(
  `${head}${r.order}番に${fullNameWithHonor(r.to)}が入り ${posJP[r.toPos]}へ`,
  i === mixed.length - 1 && shift.length === 0
);


// ✅ lineupLines（重複防止付き）
// 既存 if (...) { lineupLines.push(...) } の直前～直後を以下に置換
if (
  r.order > 0 &&
  !lineupLines.some(l => l.order === r.order && l.text.includes(posJP[r.toPos]))
) {
  // ── 追加: DH運用中の「投⇄捕」入替は打順欄には積まない（守備欄だけに出す）
  const dhActive = !!assignments?.["指"];
  const isPitcherCatcherSwap =
    dhActive &&
    ((r.fromPos === "投" && r.toPos === "捕") || (r.fromPos === "捕" && r.toPos === "投"));

  if (!isPitcherCatcherSwap) {
    const isReentryTo = reentryToIds.has(r.to.id);
    lineupLines.push({
      order: r.order,
      text: isReentryTo
        ? `${r.order}番 ${posJP[r.toPos]} ${nameWithHonor(r.to)}`
        : `${r.order}番 ${posJP[r.toPos]} ${fullNameWithHonor(r.to)} 背番号 ${r.to.number}`
    });
  }
}




  // ✅ 処理済みフラグ：選手IDは両方、ポジションは「移動先」だけ
  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  /* handledPositions.add(r.fromPos); ← これを削除 */
  handledPositions.add(r.toPos);
});


/* ---- shift ---- */
// 守備変更：連鎖構造に並べ替え
const buildShiftChain = (shifts: typeof shift): typeof shift[] => {
  const fromMap = new Map(shifts.map(s => [s.fromPos, s]));
  const toMap = new Map(shifts.map(s => [s.toPos, s]));

  const used = new Set<string>();
  const chains: typeof shift[] = [];

  shifts.forEach((s) => {
    if (used.has(s.fromPos)) return;

    const chain: typeof shift = [];
    let current: typeof s | undefined = s;

    while (current && !used.has(current.fromPos)) {
      chain.push(current);
      used.add(current.fromPos);
      current = fromMap.get(current.toPos);
    }

    chains.push(chain);
  });

  return chains;
};

// ✅ 実行して sortedShift を作る
const sortedShift = buildShiftChain(shift).flat();

sortedShift.forEach((s, i) => {
    // ▼ 特別処理で出したシフトはここでスキップ
  const dupKey = `${s.player.id}|${s.fromPos}|${s.toPos}`;
  if (skipShiftPairs.has(dupKey)) return;

// ✅ すでに処理済みならスキップ
// ただし「投手→他守備」のシフトは、同一ターンに投手交代（replace: 投）があっても表示する
const allowedPitcherShift =
  s.fromPos === "投" &&
  replace.some(r => r.pos === "投" && r.from.id === s.player.id);

if (
  (!allowedPitcherShift && handledPlayerIds.has(s.player.id)) ||
  handledPositions.has(s.toPos) // 移動先だけ重複防止
) return;


  const h = s.player.isFemale ? "さん" : "くん";
  const head = posJP[s.fromPos];
  const tail = posJP[s.toPos];
  const ends = "、";

// ↓↓↓ ここに置き換え（相互入れ替えは assignments + usedPlayerInfo で検出） ↓↓↓
// 「battingOrder.reason」だけでなく usedPlayerInfo（subId → reason）でも代打/代走を検知
const pinchInfoForShift = Object.values(usedPlayerInfo || {}).find(
  (x: any) => x?.subId === s.player.id && ["代打", "代走", "臨時代走"].includes(x.reason)
);
const pinchEntry =
  battingOrder.find(
    (e) => e.id === s.player.id && ["代打", "代走", "臨時代走"].includes(e.reason)
  ) ||
  (pinchInfoForShift ? ({ reason: pinchInfoForShift.reason } as any) : undefined);

// ★追加：この守備交代画面を開いた時点ですでに出場していた＝「先ほど」は不要
const alreadyOnFieldWhenOpened = Object.values(initialAssignments ?? {}).some(
  (id) => Number(id) === Number(s.player.id)
);

// ★ここを変更：確定後（alreadyOnFieldWhenOpened=true）は pinchEntry でも通常文に落とす
if (pinchEntry && !alreadyOnFieldWhenOpened) {
  // -------------- ここから下は「今までの pinchEntry ブロック」をそのまま残す --------------
  // 相互入替えの特別処理...
  // 相互入替えでなければ従来の単独出力
  const phrase =
    pinchEntry.reason === "代打"
      ? "代打いたしました"
      : pinchEntry.reason === "臨時代走"
      ? "臨時代走"
      : "代走いたしました";

  const hasPriorSame = result.some(
    (ln) => ln.includes(`先ほど${phrase}`) || ln.includes(`同じく先ほど${phrase}`)
  );
  const headText = hasPriorSame ? `同じく先ほど${phrase}` : `先ほど${phrase}`;

  result.push(`${headText}${nameWithHonor(s.player)}が ${tail}へ${ends}`);
} else {
  // ✅確定後はこちらに落ちる：普通に「指名打者の◯◯くんが 二塁、」など
  result.push(`${head}の${nameRuby(s.player)}${h}が ${tail} ${ends}`);
}




// ✅ lineupLines の重複防止付き追加
if (
  !lineupLines.some(l =>
    l.order === s.order && l.text.includes(tail) && l.text.includes(nameRuby(s.player))
  )
) {
  // ── 追加: DH運用中の「投⇄捕」入替は打順欄には積まない（守備欄だけに出す）
  const dhActive = !!assignments?.["指"];
  const isPitcherCatcherSwap =
    dhActive &&
    ((s.fromPos === "投" && s.toPos === "捕") || (s.fromPos === "捕" && s.toPos === "投"));

  if (!isPitcherCatcherSwap) {
    lineupLines.push({
      order: s.order,
      text: `${s.order}番 ${tail} ${nameRuby(s.player)}${h}`
    });
  }
}


  // ✅ この選手・ポジションを今後の処理から除外
  handledPlayerIds.add(s.player.id);
  // handledPositions.add(s.fromPos); ← これも外す
  handledPositions.add(s.toPos);
});

// 🆕 交代が「本文として1行だけ」なら、必ず「に入ります。」で閉じる（リエントリーでも）
{
  const bodyLines = result.filter((ln) => {
    const t = ln.trim();
    if (/^\d+番 /.test(t)) return false;                 // 打順行は除外
    if (t.endsWith("以上に代わります。")) return false; // しめの行は除外
    if (/お知らせいたします。$/.test(t)) return false;  // ヘッダーは除外
    return true;
  });
  if (bodyLines.length === 1) {
    // リエントリー処理で suppressTailClose=true にされていても解除する
    suppressTailClose = false;
  }
}

// 🆕 並べ替え：本文のうち「先ほど…／同じく先ほど…」(=代打/代走/臨時代走)を先に、その後に通常の交代文を並べる
{
  const isHeader = (t: string) => /お知らせいたします。$/.test(t.trim());
  const isLineup = (t: string) => /^\d+番 /.test(t.trim());
  const isClosing = (t: string) => t.trim().endsWith("以上に代わります。");
  const isBody = (t: string) => {
    const s = t.trim();
    return s.length > 0 && !isHeader(s) && !isLineup(s) && !isClosing(s);
  };
  const isPinchHead = (t: string) =>
    /^((同じく)?先ほど(代打|代走|臨時代走)(いたしました|に出ました))/.test(t.trim());

  // 既存 result を分類して並べ替え
  const headers: string[] = [];
  const bodyPinch: string[] = [];
  const bodyOther: string[] = [];
  const closings: string[] = []; // 「以上に代わります。」など（この時点では通常まだ無いが保険）

  for (const ln of result) {
    if (isHeader(ln)) headers.push(ln);
    else if (isLineup(ln)) {
      // 打順行はここでは触らない（この後で既存ロジックがまとめて追加/整形）
      bodyOther.push(ln); // 一時退避（位置は後段の打順出力で整う）
    } else if (isClosing(ln)) closings.push(ln);
    else if (isBody(ln)) (isPinchHead(ln) ? bodyPinch : bodyOther).push(ln);
    else bodyOther.push(ln);
  }

  // result を再構成（代打/代走系 → その他）
  result.splice(0, result.length, ...headers, ...bodyPinch, ...bodyOther, ...closings);
}

// 🆕 ポジション連結優先の並べ替え：直前行の “to（行き先）” と次行の “from（出発）” をつなぐ
{
  const POS_JA = "(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト|指名打者)";

  const isHeader  = (t: string) => /お知らせいたします。$/.test(t.trim());
  const isLineup  = (t: string) => /^\d+番 /.test(t.trim());
  const isClosing = (t: string) => t.trim().endsWith("以上に代わります。");
  const isBody    = (t: string) => {
    const s = t.trim();
    return s.length > 0 && !isHeader(s) && !isLineup(s) && !isClosing(s);
  };

  // 本文行だけを取り出す
  const headers: string[] = [];
  const lineups: string[] = [];
  const closings: string[] = [];
  const bodies: string[] = [];
  for (const ln of result) {
    if (isHeader(ln)) headers.push(ln);
    else if (isLineup(ln)) lineups.push(ln);
    else if (isClosing(ln)) closings.push(ln);
    else if (isBody(ln)) bodies.push(ln);
    else bodies.push(ln); // 念のため
  }

  // from/to を抽出
  const fromRe = new RegExp(`^${POS_JA}の\\s`);
  const toRe1  = new RegExp(`入り\\s*${POS_JA}`);         // …入り ◯◯へ/に
  const toRe2  = new RegExp(`リエントリーで\\s*${POS_JA}`); // …リエントリーで ◯◯
  const toRe3  = new RegExp(`が\\s*${POS_JA}\\s*(?:へ|に)?\\s*[、。]?$`); // …が ◯◯、

  type Node = { idx:number; text:string; from?:string; to?:string };
  const parsed: Node[] = bodies.map((t, i) => {
    let from: string | undefined;
    let to:   string | undefined;
    let m = t.match(fromRe); if (m) from = m[1];
    let m2 = t.match(toRe1) || t.match(toRe2) || t.match(toRe3); if (m2) to = m2[1];
    return { idx:i, text:t, from, to };
  });

  // 連結：Aの to と Bの from が同じポジなら B を直後に持ってくる
  const used = new Set<number>();
  const chained: string[] = [];
  for (let i = 0; i < parsed.length; i++) {
    if (used.has(i)) continue;

    // 起点を置く
    chained.push(parsed[i].text);
    used.add(i);

    // 末尾の to を手がかりに from を辿る
    let curTo = parsed[i].to;
    while (curTo) {
      const nextIdx = parsed.findIndex((p, j) => !used.has(j) && p.from === curTo);
      if (nextIdx === -1) break;
      chained.push(parsed[nextIdx].text);
      used.add(nextIdx);
      curTo = parsed[nextIdx].to;
    }
  }

  // 再構成：ヘッダー → 連結済み本文 → 打順行 → しめ
  result.splice(0, result.length, ...headers, ...chained, ...lineups, ...closings);
}

// 🆕 中間行の終端補正：このあとに“本文行”が続く場合は「…に入ります。」→「、」
{
  const isBody = (t: string) =>
    !/^\d+番 /.test(t) &&                 // 打順行は除外
    !/お知らせいたします。$/.test(t) &&   // ヘッダーは除外
    !/以上に代わります。$/.test(t) &&     // しめ行は除外
    t.trim().length > 0;

  for (let i = 0; i < result.length - 1; i++) {
    const cur = result[i].trim();
    if (!isBody(cur)) continue;

    // 次以降に“本文行”が1本でもあれば、この行は読点でつなぐ
    const hasBodyAfter = result.slice(i + 1).some((ln) => isBody(ln.trim()));
    if (!hasBodyAfter) continue;

    result[i] = cur
      // リエントリーの末尾「…リエントリーで サードに入ります。」→「…リエントリーで サード、」
      .replace(
        /リエントリーで\s*(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト)に入ります。$/,
        "リエントリーで $1、"
      )
      // 通常の締めを読点に
      .replace(/が\s*入ります。$/, "、")
      .replace(/に入ります。$/, "、")
      .replace(/へ入ります。$/, "、");
  }
}

// 🆕 「先ほど◯◯いたしました／に出ました」が連続するとき、後続行の先頭を「同じく先ほど◯◯…」に置換
{
  const isBody = (t: string) =>
    !/^\d+番 /.test(t) &&                // 打順行は除外
    !/お知らせいたします。$/.test(t) &&  // ヘッダーは除外
    !/以上に代わります。$/.test(t) &&    // しめ行は除外
    t.trim().length > 0;

  // 直前行の“理由”を覚えて、同じ理由が続いたら「同じく」を付加
  let lastReason: "代打" | "代走" | "臨時代走" | null = null;

  for (let i = 0; i < result.length; i++) {
    const line = result[i].trim();
    if (!isBody(line)) { lastReason = null; continue; }

    // 先頭が「先ほど◯◯いたしました…」または「先ほど◯◯に出ました…」かを判定
    const m = line.match(/^先ほど(代打|代走|臨時代走)(?:いたしました|に出ました)/);
    // 「先ほど…」以外の本文行が間に入っても、同じ理由の連続とみなす
    if (!m) { continue; }


    const reason = m[1] as "代打" | "代走" | "臨時代走";
    if (lastReason === reason) {
      // 2 行目以降：先頭を「同じく先ほど◯◯…」に置換
      result[i] = line.replace(
        /^先ほど(代打|代走|臨時代走)((?:いたしました|に出ました))/,
        (_all, r, suf) => `同じく先ほど${r}${suf}`
      );
    }
    lastReason = reason;
  }
}


// ==== 本文終端の統一：最後の1本だけを「に入ります。」で閉じる ====
// ・末尾が「…リエントリーで ポジション、」→「…リエントリーで ポジションに入ります。」
// ・末尾が「…が ポジション、/。」→「…が ポジションに入ります。」
// ・末尾が「…へ、/。」/「…に、/。」→「…へ入ります。」/「…に入ります。」
// ・それ以外で「、」なら「。」を付与
{
  const POS_JA = "(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト|指名打者)";

  // 末尾の“本文行”インデックスを取得（打順行・ヘッダー・「以上に代わります。」は除外）
  const lastBodyIndex = (() => {
    for (let i = result.length - 1; i >= 0; i--) {
      const t = result[i].trim();
      if (/^\d+番 /.test(t)) continue;                  // 打順行は除外
      if (t.endsWith("以上に代わります。")) continue;    // しめ行は除外
      if (/お知らせいたします。$/.test(t)) continue;     // ヘッダーは除外
      if (!t) continue;
      return i;
    }
    return -1;
  })();

  // リエントリー行が末尾なら、終端調整を必ず有効化（抑止フラグは無効化）
  const reentryTail =
    lastBodyIndex >= 0 &&
    new RegExp(`リエントリーで\\s*${POS_JA}\\s*[、。]?$`).test(result[lastBodyIndex].trim());
  if (reentryTail) suppressTailClose = false;

  if (!suppressTailClose && lastBodyIndex >= 0) {
    const line = result[lastBodyIndex].trim();

    console.log("[DEBUG] 終端調整 line:", line);

    // ★ 追加：文中に「入り」があれば、ここで末尾付加ロジックを完全スキップ
    if (/入り/.test(line)) {
      console.log("[DEBUG] → '入り' を含むので末尾付加を完全スキップ");
      // 読点で終わっていたら句点に整えるだけ
      result[lastBodyIndex] = line.replace(/、$/, "。");
    } else {
      // 1) 「…リエントリーで ◯◯、/。」→「…リエントリーで ◯◯に入ります。」
      const reentryPos = new RegExp(`リエントリーで\\s*${POS_JA}\\s*[、。]?$`);
      if (reentryPos.test(line)) {
        result[lastBodyIndex] = line.replace(
          reentryPos,
          (_m, pos) => `リエントリーで ${pos}に入ります。`
        );
      } else {
        // 2) 「…が ◯◯ 、/。」→「…が ◯◯に入ります。」
        const gaPos = new RegExp(`が\\s*${POS_JA}\\s*[、。]?$`);
        if (gaPos.test(line)) {
          result[lastBodyIndex] = line.replace(
            gaPos,
            (_m, pos) => `が ${pos}に入ります。`
          );
        } else {
          // 3) 「…(へ|に) 、/。」→「…(へ|に)入ります。」
          const toHeNi = /(へ|に)\s*[、。]?$/;
          if (toHeNi.test(line)) {
            result[lastBodyIndex] = line.replace(
              toHeNi,
              (_m, pp) => `${pp}入ります。`
            );
          } else {
            // 4) 末尾が読点だけなら句点
            result[lastBodyIndex] = line.replace(/、$/, "。");
          }
        }
      }
    }

  }
}






/* ---- 打順行を最後にまとめて追加 ---- */
const already = new Set(result);

lineupLines
  .filter(l => l.order > 0)       // ★ 0番は表示しない
  .sort((a, b) => a.order - b.order)
  .forEach((l) => {
    if (!already.has(l.text)) {
      result.push(l.text);
      already.add(l.text);
    }
  });


  /* ---- 「以上に代わります。」判定 ---- */
  const total = replace.length + shift.length + mixed.length;
  if ((total >= 2) || (lineupLines.length >= 2)) {
    result.push("以上に代わります。");
  }

  // ▼ 最初の「以上に代わります。」以降は出さない（特別処理が先に出していてもOK）
  const endAt = result.findIndex(l => l.trim().endsWith("以上に代わります。"));
  if (endAt !== -1) {
    return result.slice(0, endAt + 1).join("\n");
  }
  return result.join("\n");
};





const positionStyles: Record<string, React.CSSProperties> = {
  投: { top: "62%", left: "50%" },
  捕: { top: "91%", left: "50%" },
  一: { top: "65%", left: "82%" },
  二: { top: "44%", left: "66%" },
  三: { top: "65%", left: "18%" },
  遊: { top: "44%", left: "32%" },
  左: { top: "20%", left: "18%" },
  中: { top: "17%", left: "50%" },
  右: { top: "20%", left: "81%" },
  指: { top: "91%", left: "81%" },
};

const positions = Object.keys(positionStyles);
const BENCH = "控え";

const formatPlayerLabel = (player?: { id: number; number?: string | number; lastName?: string; firstName?: string }) => {
  if (!player) return "未設定";
  return `${player.lastName ?? ""}${player.firstName ?? ""} #${player.number ?? "-"}`;
};

const getPositionName = (assignments: Record<string, number | null>, playerId: number): string => {
  const entry = Object.entries(assignments).find(([_, id]) => id === playerId);
  return entry ? entry[0] : "－";
};

const formatLog = (pos: string, player?: Player | null): string => {
  const posFull: Record<string, string> = {
    "投": "ピッチャー",
    "捕": "キャッチャー",
    "一": "ファースト",
    "二": "セカンド",
    "三": "サード",
    "遊": "ショート",
    "左": "レフト",
    "中": "センター",
    "右": "ライト",
    [BENCH]: "控え",
  };
  const label = posFull[pos] ?? pos; // マッチしなければそのまま
  return `${label}：${formatPlayerLabel(player)}`;
};

type DefenseChangeProps = {
  onConfirmed: () => void;
};

const DefenseChange: React.FC<DefenseChangeProps> = ({ onConfirmed }) => {

  // ---- ここから: モーダル読み上げ用（DefenseChange 内） ----
const modalTextRef = useRef<HTMLDivElement | null>(null);
// 直前に外れた“元スタメン”の打順Index（例: レフトが外れた等）
const lastVacatedStarterIndex = useRef<number | null>(null);

// === Drag中のスクロールロック ===
const scrollLockDepthRef = useRef(0);
const preventRef = useRef<(e: Event) => void>();

  // === VOICEVOX 読み上げ制御用 ===
  const [speaking, setSpeaking] = useState(false);

  // 初回マウント時に VOICEVOX をウォームアップ
  useEffect(() => {
    void prewarmTTS();
  }, []);

  // アンマウント時に再生を止める
  useEffect(() => {
    return () => {
      ttsStop();
    };
  }, []);

const lockScroll = () => {
  if (++scrollLockDepthRef.current > 1) return;
  const prevent = (e: Event) => e.preventDefault();
  preventRef.current = prevent;
  // ページスクロールを抑止
  document.body.style.overflow = "hidden";
  // iOSのオーバースクロールを抑止
  document.documentElement.style.overscrollBehaviorY = "none";
  window.addEventListener("touchmove", prevent, { passive: false });
  window.addEventListener("wheel", prevent, { passive: false });
};

const unlockScroll = () => {
  if (--scrollLockDepthRef.current > 0) return;
  const prevent = preventRef.current;
  document.body.style.overflow = "";
  document.documentElement.style.overscrollBehaviorY = "";
  if (prevent) {
    window.removeEventListener("touchmove", prevent as any);
    window.removeEventListener("wheel", prevent as any);
  }
};

const speakVisibleAnnouncement = () => {
  const root = modalTextRef.current;
  if (!root) return;

  // 追加した toReadable をここで呼び出す
  let text = toReadable(root);

  // 正規化処理（既存の置換ルール）
  text = text
    .replace(/に入ります/g, "にはいります")
    .replace(/へ入ります/g, "へはいります")
    .replace(/が\s*入り/g, "がはいり")
    .replace(/へ\s*入り/g, "へはいり")
    .replace(/に\s*入り/g, "にはいり")
    .replace(/そのまま\s*入り/g, "そのままはいり");

  text = text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "。")
    .replace(/。。+/g, "。")
    .trim();

  if (text && !/[。！？]$/.test(text)) text += "。";

  ttsStop();
  setSpeaking(true);
  void (async () => {
    try {
      await ttsSpeak(text, { progressive: true, cache: true });
    } finally {
      setSpeaking(false);
    }
  })();
};




  const stopSpeaking  = () => ttsStop();
  const pauseSpeaking = () => speechSynthesis.pause();
  const resumeSpeaking = () => speechSynthesis.resume();
  // ---- ここまで ----

  const [teamName, setTeamName] = useState("自チーム");

  useEffect(() => {
    localForage.getItem("team").then((data) => {
      if (data && typeof data === "object" && "name" in data) {
        setTeamName(data.name as string);
      }
    });
  }, []);

  useEffect(() => {
  (async () => {
    const s = await localForage.getItem<{ id: number; reason?: string }[]>("startingBattingOrder");
    startingOrderRef.current = Array.isArray(s) ? s : [];
  })();
}, []);

  // 画面に入ったら永続化された履歴を読み込む（守備画面→戻ってきた時もOK）
useEffect(() => {
  let mounted = true;
  (async () => {
    const { hist, redoStk } = await loadHistoryFromStorage();
    if (!mounted) return;
    setHistory(hist);
    setRedo(redoStk);
  })();
  return () => { mounted = false; };
}, []);


  const [assignments, setAssignments] = useState<Record<string, number | null>>({});
  const hasDH = Boolean(assignments?.["指"]);
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [battingOrder, setBattingOrder] = useState<{ id: number; reason: string }[]>([]); // ✅ 攻撃画面の打順
  // ★ 打順：確定待ちでも即時に変わる“ドラフト”用
const [battingOrderDraft, setBattingOrderDraft] =
  useState<{ id: number; reason: string }[]>([]);

// ★ リエントリー可視化用：直前ドロップで青枠にする選手IDを保持
const [reentryPreviewIds, setReentryPreviewIds] = useState<Set<number>>(new Set());
// 🆕 青枠をリセットするユーティリティ
const resetBlue = () => {
  setReentryPreviewIds(new Set());
};

// ★ リエントリー可視化（永続）: 一度成立したら保持
const [reentryFixedIds, setReentryFixedIds] = useState<Set<number>>(new Set());
// 青枠＝プレビュー or 確定のどちらかに含まれていれば true
const isReentryBlueId = (id: number) => reentryPreviewIds.has(id) || reentryFixedIds.has(id);

// ★ スタメン時の打順（不変）を保持して即参照できるように
const startingOrderRef = useRef<{ id: number; reason?: string }[]>([]);

  const [benchPlayers, setBenchPlayers] = useState<Player[]>([]);
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);
  const [hoverPos, setHoverPos] = useState<string | null>(null);

  const [substitutionLogs, setSubstitutionLogs] = useState<string[]>([]);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [dhEnabledAtStart, setDhEnabledAtStart] = useState<boolean>(false);
  // DH解除を確定時にまとめて適用するための保留フラグ
  const [pendingDisableDH, setPendingDisableDH] = useState(false);
  const [dhDisableDirty, setDhDisableDirty] = useState(false);
  const [dhDisableSnapshot, setDhDisableSnapshot] =
  useState<{ dhId: number; pitcherId: number } | null>(null);
  const [battingReplacements, setBattingReplacements] = useState<{ [index: number]: Player }>({});
  const [previousPositions, setPreviousPositions] = useState<{ [playerId: number]: string }>({});
  const [initialAssignments, setInitialAssignments] = useState<Record<string, number | null>>({});

// ★ 追加：ドラッグ中のタッチ情報
const [touchDrag, setTouchDrag] = useState<{ playerId: number; fromPos?: string } | null>(null);
const lastTouchRef = React.useRef<{ x: number; y: number } | null>(null);
const hoverPosRef = React.useRef<string | null>(null);

// 変更検知用
const [isDirty, setIsDirty] = useState(false);
const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
const snapshotRef = useRef<string | null>(null);
// 初回の基準スナップショットを一度だけ作るためのフラグ
const initDoneRef = useRef(false);


// 🔽 これを追加
useEffect(() => {
  (window as any).__defenseChange_back = () => {
    if (isDirty) {
      setShowLeaveConfirm(true);   // 未保存あり → 確認モーダル表示
    } else {
      handleBackToDefense();       // 未保存なし → そのまま守備へ
    }
  };
  return () => {
    delete (window as any).__defenseChange_back;
  };
}, [isDirty]);

// ✅ 初回だけ基準化、それ以降は差分チェック
useEffect(() => {
  // 初回：十分な初期データが入るまで基準化を待つ
  if (!initDoneRef.current) {
    if (isInitialReady()) {
      snapshotRef.current = buildSnapshot();
      setIsDirty(false);
      initDoneRef.current = true;
      console.log("[DEBUG] baseline set after initial data");
    } else {
      console.log("[DEBUG] waiting initial data…", {
        orderLen: Array.isArray(battingOrder) ? battingOrder.length : -1,
        hasAnyAssign: assignments && Object.values(assignments).some((v) => v != null),
      });
    }
    return; // 基準化が済むまで差分判定しない
  }

  // 2回目以降：通常の差分判定
  const now = buildSnapshot();
  const changed = now !== snapshotRef.current;
  console.log("[DEBUG] dirty 判定", { changed });
  setIsDirty(changed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [assignments, battingOrder, pendingDisableDH, dhDisableSnapshot, dhEnabledAtStart]);





// 変更判定に使う“現在値のスナップショット”
const buildSnapshot = () =>
  JSON.stringify({
    assignments,
    battingOrder,
    pendingDisableDH,
    dhDisableSnapshot,
    dhEnabledAtStart,
  });

  // 初期データが十分に入ったら true
const isInitialReady = () => {
  const hasOrder = Array.isArray(battingOrder) && battingOrder.length > 0;
  const hasAssignments =
    assignments && Object.keys(assignments).some((k) => assignments[k] != null);
  // どちらか入っていれば初期化完了とみなす（必要なら両方必須にしてもOK）
  return hasOrder || hasAssignments;
};


// ★ 追加：dropEffect を毎回 "move" に（Androidの視覚安定）
const allowDrop = (e: React.DragEvent) => {
  e.preventDefault();
  try { e.dataTransfer!.dropEffect = "move"; } catch {}
};

  // 元の選手A -> 許可される相手B（確定まで有効）
  const [pairLocks, setPairLocks] = useState<Record<number, number>>({});
  // リエントリー専用：直近の「A⇄B（リエントリー）」情報を保持
type ReentryEntry = {
  originalId: number;           // B（元スタメン／退場中）
  pinchId: number;              // A（直前まで守っていた代打/代走）
  pos: string;                  // "捕" など
  reason: "代打" | "代走";
};

// ーーー Undo/Redo 用スナップショット型 ーーー
type DefenseSnapshot = {
  assignments: Record<string, number | null>;
  battingOrder: { id: number; reason: string }[];
  benchPlayers: Player[];
  substitutionLogs: string[];
  pairLocks: Record<number, number>;
  battingReplacements: { [index: number]: Player };
  pendingDisableDH: boolean;
  dhEnabledAtStart: boolean;
  initialAssignments: Record<string, number | null>;
  usedPlayerInfo: Record<number, any>;
};

const [history, setHistory] = useState<DefenseSnapshot[]>([]);
const [redo, setRedo] = useState<DefenseSnapshot[]>([]);
// ===== Undo/Redo 永続化（localForage） =====
// 試合ごとに分けたい場合は matchId を使ってサフィックス化
const getMatchSuffix = (mi?: any) => {
  const safe = mi?.id || mi?.opponentTeam || "default";
  return String(safe);
};
const HIST_KEY = (mi?: any) => `defHistory::${getMatchSuffix(mi)}`;
const REDO_KEY = (mi?: any) => `defRedo::${getMatchSuffix(mi)}`;

// 履歴の保存・読込
const saveHistoryToStorage = async (hist: DefenseSnapshot[], redoStk: DefenseSnapshot[]) => {
  const mi = await localForage.getItem("matchInfo");
  await localForage.setItem(HIST_KEY(mi), hist);
  await localForage.setItem(REDO_KEY(mi), redoStk);
};

const loadHistoryFromStorage = async (): Promise<{hist: DefenseSnapshot[]; redoStk: DefenseSnapshot[]}> => {
  const mi = await localForage.getItem("matchInfo");
  const hist = (await localForage.getItem(HIST_KEY(mi))) || [];
  const redoStk = (await localForage.getItem(REDO_KEY(mi))) || [];
  return { hist, redoStk };
};

// 現在の状態を丸ごとスナップショット
const snapshotNow = (): DefenseSnapshot => ({
  assignments: { ...assignments },
  battingOrder: [...battingOrder],
  benchPlayers: [...benchPlayers],
  substitutionLogs: [...substitutionLogs],
  pairLocks: { ...pairLocks },
  battingReplacements: { ...battingReplacements },
  pendingDisableDH,
  dhEnabledAtStart,
  initialAssignments: { ...initialAssignments },
  usedPlayerInfo: { ...usedPlayerInfo },
});

// スナップショットを復元（state + localForageも揃える）
const restoreSnapshot = async (s: DefenseSnapshot) => {
  setAssignments(s.assignments);
  setBattingOrder(s.battingOrder);
  setBenchPlayers(s.benchPlayers);
  setSubstitutionLogs(s.substitutionLogs);
  setPairLocks(s.pairLocks);
  setBattingReplacements(s.battingReplacements);
  setPendingDisableDH(s.pendingDisableDH);
  setDhDisableDirty(false);
  // initialAssignments は「画面オープン時のフィールド」を表すので通常は固定。
  // ただしスナップショットに含めたので画面表示を合わせる:
  setInitialAssignments(s.initialAssignments);

  await localForage.setItem("lineupAssignments", s.assignments);
  localStorage.setItem("assignmentsVersion", String(Date.now()));
  await localForage.setItem("battingOrder", s.battingOrder);
  localStorage.setItem("battingOrderVersion", String(Date.now()));
  await localForage.setItem("battingReplacements", {}); // 確定後は空で持つ運用
  await localForage.setItem("dhEnabledAtStart", s.dhEnabledAtStart);
  // ★ 追加：usedPlayerInfo の state と storage を同期
  if ("usedPlayerInfo" in s) {
    setUsedPlayerInfo(s.usedPlayerInfo || {});
    await localForage.setItem("usedPlayerInfo", s.usedPlayerInfo || {});
  }
};

// 新しい操作の前に履歴へ積む（永続化対応）
const pushHistory = async () => {
  const snap = snapshotNow();
  setHistory(h => {
    const next = [...h, snap];
    // ここで保存（Redoは新操作で破棄）
    saveHistoryToStorage(next, []);
    return next;
  });
  setRedo([]); // 新規操作で Redo は破棄
};

// 取消（永続化も更新）
const handleUndo = async () => {
  if (!history.length) return;
  const current = snapshotNow();
  const last = history[history.length - 1];
  const nextHist = history.slice(0, -1);
  const nextRedo = [...redo, current];

  setHistory(nextHist);
  setRedo(nextRedo);
  await restoreSnapshot(last);
  await saveHistoryToStorage(nextHist, nextRedo);
  ttsStop();
};

// やり直し（永続化も更新）
const handleRedo = async () => {
  if (!redo.length) return;
  const current = snapshotNow();
  const next = redo[redo.length - 1];
  const nextRedo = redo.slice(0, -1);
  const nextHist = [...history, current];

  setRedo(nextRedo);
  setHistory(nextHist);
  await restoreSnapshot(next);
  await saveHistoryToStorage(nextHist, nextRedo);
  ttsStop();
};

const [reentryInfos, setReentryInfos] = useState<ReentryEntry[]>([]);
const lastVacatedStarterIndexRef = useRef<number | null>(null);

  // 先発（画面オープン時にフィールドにいた）かどうか
  const isStarter = (playerId?: number | null) =>
    playerId != null && Object.values(initialAssignments || {}).includes(playerId);

useEffect(() => {
  (async () => {
    const stored = await localForage.getItem("dhEnabledAtStart");
    setDhEnabledAtStart(Boolean(stored));
  })();
}, []);

const handleDisableDH = async () => {
  const dhId = assignments?.["指"] ?? null;
  const pitcherId = assignments?.["投"] ?? null;

  if (!dhId) { window.alert("現在DHは使用していません。"); return; }
  if (!pitcherId) { window.alert("投手が未設定です。先に投手を設定してください。"); return; }

  // ✅ 押下時点のIDを保持（確定時の参照元）
  setDhDisableSnapshot({ dhId: Number(dhId), pitcherId: Number(pitcherId) });

  // DHが打順のどこにいるか
  const idx = battingOrder.findIndex(e => e.id === dhId);
  if (idx === -1) { window.alert("打順に指名打者が見つかりませんでした。"); return; }

  // ① UIは従来どおり「指」を空にして見せる（スナップがあるので確定時に困らない）
  setAssignments(prev => ({ ...prev, "指": null }));

// ② 解除は“保留”にする（UI上は『指』は引き続き有効：確定まではドロップOK）
setPendingDisableDH(true);
setDhDisableDirty(true);


  // ③ 打順は触らない！ 下段の赤字表示だけ作る（=投手を交代者として見せる）
  const p = teamPlayers.find(tp => tp.id === pitcherId);
  if (p) setBattingReplacements(prev => ({ ...prev, [idx]: p }));

  // ※ 保存(localForage)はここでは行わず、「交代を確定する」で反映
};




useEffect(() => {
  const setInitialAssignmentsFromSubs = async () => {
    const battingOrder = await localForage.getItem<{ id: number; reason: string }[]>("battingOrder");
    const assignments = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
    const usedPlayerInfo = await localForage.getItem<Record<number, {
      fromPos: string;
      subId: number;
      reason: "代打" | "代走" | "守備交代";
      order: number;
      wasStarter: boolean;
    }>>("usedPlayerInfo");

    if (!battingOrder || !assignments || !usedPlayerInfo) return;

// ⚠️ "代打" or "代走" 選手がいれば initialAssignments にも反映（末端まで辿る）
const updatedAssignments = { ...assignments };
Object.entries(usedPlayerInfo).forEach(([originalIdStr, info]) => {
  const { fromPos, reason } = info;
  if (!(reason === "代打" || reason === "代走")) return;
  if (!(fromPos in updatedAssignments)) return;

  const latest = resolveLatestSubId(Number(originalIdStr), usedPlayerInfo);
  if (latest) {
    // 念のため "ファースト" などが来ても略号に寄せてから反映
    const sym = (posNameToSymbol as any)[fromPos] ?? fromPos;
    updatedAssignments[sym] = latest;
  }
});

    setInitialAssignments(assignments);
  };

  setInitialAssignmentsFromSubs();
}, []);

useEffect(() => {
  console.log("✅ DefenseScreen mounted");
  const loadData = async () => {
    const [orderRaw, assignRaw, playersRaw, usedRaw] = await Promise.all([
      localForage.getItem("battingOrder"),
      localForage.getItem("lineupAssignments"),
      localForage.getItem("team"),
      localForage.getItem("usedPlayerInfo"),
    ]);

    const order = Array.isArray(orderRaw) ? orderRaw as { id: number; reason: string }[] : [];
    const originalAssignments = (assignRaw ?? {}) as Record<string, number | null>;
    const usedInfo = (usedRaw ?? {}) as Record<number, { fromPos: string; subId?: number }>;    
    const newAssignments: Record<string, number | null> = { ...originalAssignments };

    // チームプレイヤー取得
    let updatedTeamPlayers = Array.isArray(playersRaw?.players) ? [...playersRaw.players] : [];


// ✅ 代打・代走の割り当て（“連鎖”の末端まで辿る）
for (const [originalIdStr, info] of Object.entries(usedInfo)) {
   const { fromPos, reason } = info;
   if (!["代打", "代走", "臨時代走"].includes(reason)) continue;
   const sym = posNameToSymbol[fromPos ?? ""] ?? fromPos ?? "";
   if (!sym) continue;

   const origId  = Number(originalIdStr);
   const latest  = resolveLatestSubId(origId, usedInfo);
   if (!latest) continue;

   // 🔒 自動反映は「まだ何も確定していない素の状態」のときだけ
   const isOriginalStillHere = newAssignments[sym] === origId; // その守備が今も元選手のまま
   const isOriginalElsewhere = Object.entries(newAssignments)
     .some(([k, v]) => v === origId && k !== sym);             // 元選手が他守備へ移動済み？
   const isPinchOnField = Object.values(newAssignments).includes(latest); // 代打がどこかに既に入ってる？

   if (isOriginalStillHere && !isOriginalElsewhere && !isPinchOnField) {
     newAssignments[sym] = latest; // ← このときだけ自動で代打を同じ守備へ
     console.log(`[AUTO] 代打/代走 ${latest} を ${sym} に自動配置`);
   } else {
     console.log(`[SKIP] 自動配置せず（元or代打が他で確定済み） sym=${sym}`);
   }
 }

    // ステート更新
    setBattingOrder(order);          // ← 既存
    setBattingOrderDraft(order);     // ← 追加：確定前用も同じ値で初期化
    setInitialAssignments(originalAssignments);
    setUsedPlayerInfo(usedInfo);
    setAssignments(newAssignments);
    setTeamPlayers(updatedTeamPlayers);

    setIsLoading(false);

    // デバッグ出力
    console.log("[DEBUG] battingOrder:", order);
    console.log("[DEBUG] usedPlayerInfo:", usedInfo);
    console.log("[DEBUG] 最終 assignments:", newAssignments);
  };

  loadData();
}, []);


const [usedPlayerInfo, setUsedPlayerInfo] = useState<Record<number, { fromPos: string }>>({});
// --- ここから：控えを「未出場」と「出場済み」に分けるヘルパー ---
// ※ import は増やさず React.useMemo を使います
const onFieldIds = React.useMemo(() => {
  return new Set(
    Object.values(assignments).filter((v): v is number => typeof v === "number")
  );
}, [assignments]);

const playedIds = React.useMemo(() => {
  const s = new Set<number>();

  // ① いまフィールドに居る選手（“出場済み”扱いに含める）
  onFieldIds.forEach((id) => s.add(id));

  // ② 打順に載っている選手（先発・代打・代走・途中出場すべて）
  (battingOrder || []).forEach((e) => {
    if (e?.id != null) s.add(e.id);
  });

  // ③ usedPlayerInfo から “元選手（キー側）” と “subId（途中出場側）” の両方を加える
  const u = (usedPlayerInfo as unknown) as Record<number, { subId?: number }>;
  Object.entries(u || {}).forEach(([origIdStr, info]) => {
    const origId = Number(origIdStr);
    if (!Number.isNaN(origId)) s.add(origId);          // ← 代打を出された「元選手」を明示的に出場済みに含める
    if (typeof info?.subId === "number") s.add(info.subId); // ← 途中出場側も出場済み
  });

   // ④ 先発（初期守備）の全員も「出場済み」に含める（投手交代でベンチに下がっても出場済み扱い）
  Object.values(initialAssignments || {}).forEach((id) => {
    if (typeof id === "number") s.add(id);
  });
  
  return s;
}, [onFieldIds, battingOrder, usedPlayerInfo, initialAssignments]);

const benchNeverPlayed = React.useMemo(
  () => benchPlayers.filter((p) => !playedIds.has(p.id)),
  [benchPlayers, playedIds]
);

// ★ 試合開始時のスタメンID集合
const [starterIdsAtStart, setStarterIdsAtStart] = useState<Set<number>>(new Set());

useEffect(() => {
  (async () => {
    const startAssign =
      await localForage.getItem<Record<string, number | null>>("startingassignments");
    const s = new Set<number>();
    Object.values(startAssign || {}).forEach((v) => {
      if (typeof v === "number") s.add(v);
    });
    setStarterIdsAtStart(s);
  })();
}, []);

const benchPlayedOut = React.useMemo(
  () => benchPlayers.filter((p) => playedIds.has(p.id) && !onFieldIds.has(p.id)),
  [benchPlayers, playedIds, onFieldIds]
);

const [alwaysReentryIds, setAlwaysReentryIds] = useState<Set<number>>(new Set());
const capturedInitialPlayedOutRef = useRef(false);

useEffect(() => {
  if (capturedInitialPlayedOutRef.current) return;       // 初回だけ固定
  if (starterIdsAtStart.size === 0) return;              // スタメン未取得なら待つ
  if (benchPlayedOut.length === 0) return;               // ★ 追加：出場済みベンチが確定するまで待つ

  const ids = benchPlayedOut
    .filter(p => starterIdsAtStart.has(p.id))
    .map(p => p.id);

  setAlwaysReentryIds(new Set(ids));
  capturedInitialPlayedOutRef.current = true;
}, [benchPlayedOut, starterIdsAtStart]);



// --- ここまでヘルパー ---

  const [debugLogs, setDebugLogs] = useState<string[]>([]);





let battingLogsBuffer: string[][] = []; // 一時的なログ格納用（map中に使う）

  const navigate = useNavigate();

  const defensePositionMap: Record<string, string> = {
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
// フル表記（丸数字 + フル名）で表示する
const withFull = (pos: string) => {
  const full = defensePositionMap[pos] ?? pos; // 例: "捕" -> "キャッチャー"
  const mark = posNum[pos] ?? "";              // 例: "捕" -> "②"
  return `${mark}${full}`;                     // 例: "②キャッチャー"
};

const posNum: Record<string, string> = {
  "投": "①",
  "捕": "②",
  "一": "③",
  "二": "④",
  "三": "⑤",
  "遊": "⑥",
  "左": "⑦",
  "中": "⑧",
  "右": "⑨",
  "指": "DH",
};
const withMark = (pos: string) => `${posNum[pos] ?? ""}${pos}`;

const announcementText = useMemo(() => {

// --- リエントリー専用（複数件対応） ---
let reentryLines: string[] = [];

  const changes: ChangeRecord[] = [];

  battingOrder.forEach((entry, index) => {
    
    const starter = teamPlayers.find(p => p.id === entry.id);
    if (!starter) return;

    const replacement = battingReplacements[index];
    const originalPos = getPositionName(initialAssignments, starter.id);

    if (replacement) {
      const newPos = getPositionName(assignments, replacement.id);

      // ✅ 同じ選手かどうか
      if (replacement.id === starter.id) {
        if (originalPos !== newPos) {
          // ✅ 同一選手だがポジションが変わっている → shift 扱い
          changes.push({
            type: "shift",
            order: index + 1,
            player: starter,
            fromPos: originalPos,
            toPos: newPos,
          });
        } else {
          // ✅ 同一選手で守備位置も同じ → スキップ
          console.log(`[SKIP] ${starter.lastName}くん 同一守備位置に戻ったためスキップ`);
        }
        return; // これ以上の処理不要
      }


      if (originalPos === newPos) {
        changes.push({
          type: "replace",
          order: index + 1,
          from: starter,
          to: replacement,
          pos: originalPos,
        });
      } else {
        changes.push({
          type: "mixed",
          order: index + 1,
          from: starter,
          to: replacement,
          fromPos: originalPos,
          toPos: newPos,
        });
      }
    } else {
      const newPos = getPositionName(assignments, starter.id);
      if (originalPos !== newPos) {
        changes.push({
          type: "shift",
          order: index + 1,
          player: starter,
          fromPos: originalPos,
          toPos: newPos,
        });
      }
    }
  });

// --- 追加: 投手⇄投手の交代（DHで打順に投手がいないケースの補完）---
(() => {
  // ★ ここを追加：DHが有効のときだけ補完を走らせる
  const dhActiveNow = !!assignments?.["指"];
  if (!dhActiveNow) return;

  const initP = initialAssignments?.["投"];
  const curP  = assignments?.["投"];

  if (
    typeof initP === "number" &&
    typeof curP === "number" &&
    initP !== curP &&
    !changes.some(r => r.type === "replace" && r.pos === "投")
  ) {
    const from = teamPlayers.find(p => p.id === initP);
    const to   = teamPlayers.find(p => p.id === curP);
    if (from && to) {
      changes.push({
        type: "replace",
        order: 0,      // （DH運用中のみ）打順外として補完
        from,
        to,
        pos: "投",
      });
    }
  }
})();

// 追加: DH中に「元投手が他守備へ移動」した場合の shift 補完（アナウンス用）
(() => {
  const dhActiveNow = !!assignments?.["指"];
  if (!dhActiveNow) return;

  const initialPitcherId = initialAssignments?.["投"];
  if (typeof initialPitcherId !== "number") return;

  // 元投手が現在どこにいるか（投手以外に動いていれば捕捉）
  const movedToPos = Object.entries(assignments).find(([pos, pid]) => pid === initialPitcherId)?.[0];
  if (!movedToPos || movedToPos === "投") return;

  // 既に同じ shift を積んでいれば重複回避
  if (changes.some(r =>
    r.type === "shift" &&
    r.player.id === initialPitcherId &&
    r.fromPos === "投" &&
    r.toPos === movedToPos
  )) return;

  const p = teamPlayers.find(tp => tp.id === initialPitcherId);
  if (!p) return;

  changes.push({
    type: "shift",
    order: 0,               // 打順外（DH）
    player: p,
    fromPos: "投",
    toPos: movedToPos as any
  });
})();


// ▼ ここは既存の changes 構築（battingOrder を走査して replace/mixed/shift を埋める）をそのまま維持

// 既存：通常のアナウンス文
const normalText = generateAnnouncementText(  
  changes,
  teamName,
  battingOrder,
  assignments,
  teamPlayers,
  initialAssignments,
  usedPlayerInfo,
  reentryPreviewIds,     // ★ 追加
  reentryFixedIds        // ★ 追加
);

// ▼▼▼ ここから追加（generateAnnouncementText の先頭で宣言）▼▼▼
const isDup = (p: Player | undefined) =>
  !!p && !!p.lastName && dupLastNames.has(String(p.lastName));

/** 重複姓なら「姓＋名」をルビで返す。単独なら「姓のみ」をルビで返す */
const nameRuby = (p: Player | undefined): string => {
  if (!p) return "";
  return isDup(p)
    ? `<ruby>${p.lastName ?? ""}<rt>${p.lastNameKana ?? ""}</rt></ruby>` +
      `<ruby>${p.firstName ?? ""}<rt>${p.firstNameKana ?? ""}</rt></ruby>`
    : `<ruby>${p.lastName ?? ""}<rt>${p.lastNameKana ?? ""}</rt></ruby>`;
};

/** 重複姓なら「姓＋名＋敬称」、単独なら「姓＋敬称」 */
const nameWithHonor = (p: Player | undefined): string => {
  if (!p) return "";
  const honorific = p.isFemale ? "さん" : "くん";
  return isDup(p)
    ? `${nameRuby(p)}${honorific}`
    : `${nameRuby(p)}${honorific}`; // Rubyは同じ。重複時は姓＋名、単独時は姓のみ
};

/** いつでも「姓＋名＋敬称」（= フル固定。既存の fullNameHonor 相当） */
const fullNameWithHonor = (p: Player | undefined): string => {
  if (!p) return "";
  const honorific = p.isFemale ? "さん" : "くん";
  return `<ruby>${p.lastName ?? ""}<rt>${p.lastNameKana ?? ""}</rt></ruby>` +
         `<ruby>${p.firstName ?? ""}<rt>${p.firstNameKana ?? ""}</rt></ruby>` +
         `${honorific}`;
};
// ▲▲▲ ここまで追加 ▲▲▲

// ★ 追加：DH解除押下中は、ヘッダー行の「直後」に告知文を挿入する
const injectDhDisabledAfterHeader = (txt: string) => {
  if (!dhDisableDirty) return txt;

  const lines = txt.split("\n");
  // ヘッダー行（…お知らせいたします。／.）を探す
  const headerIdx = lines.findIndex((l) =>
    /お知らせいたします[。.]$/.test(l.trim())
  );
  if (headerIdx >= 0) {
    lines.splice(headerIdx + 1, 0, "ただいまより、指名打者制を解除します。");
    return lines.join("\n");
  }
  // ヘッダーが見つからなければ先頭に付ける（保険）
  return `ただいまより、指名打者制を解除します。\n${txt}`;
};

// ★ 追加：DH解除ボタン押下中は、先頭に告知文を付加する
const addDhDisabledHeader = (txt: string) =>
  dhDisableDirty ? `ただいまより、指名打者制を解除します。\n${txt}` : txt;

// 既存と合体（リエントリーなしなら通常だけ返す）
if (reentryLines.length === 0) {
  return injectDhDisabledAfterHeader(normalText);

}

// 1) 通常側のヘッダーは削除（リエントリー行ですでに案内済み）
const headerRegex = new RegExp(
  `^${teamName}、(?:選手の交代並びにシートの変更|選手の交代|シートの変更)をお知らせいたします。$`
);

let normalLines = normalText
  .split("\n")
  .filter((ln) => ln.trim().length > 0 && !headerRegex.test(ln.trim()));


// 2) 同一内容の重複行（リエントリーと同旨の通常行）を全ペア分削除
for (const { A, B, posJP } of reentryPairs) {
  const keyA = nameWithHonor(A).replace(/\s+/g, "");
  const keyB = fullNameWithHonor(B).replace(/\s+/g, "");
  normalLines = normalLines.filter((ln) => {
    const t = ln.replace(/\s+/g, "");
    const dup = t.includes(keyA) && t.includes(keyB) && t.includes(posJP);
    return !dup;
  });
}

// ▼ リエントリー対象（B）の“打順行だけ”を 苗字＋敬称／番号なし に統一
if (reentryPairs.length > 0 && normalLines.length > 0) {
  normalLines = normalLines.map((ln) => {
    for (const { B } of reentryPairs) {
      const full = fullNameWithHonor(B);      // 例: <ruby>米山<rt>よねやま</rt></ruby><ruby>碧人<rt>あおと</rt></ruby>くん
      const last = nameWithHonor(B);      // 例: <ruby>米山<rt>よねやま</rt></ruby>くん
      if (ln.includes(full)) {
        // フルネーム→苗字＋敬称 に置換
        ln = ln.replace(full, last);
        // 背番号を削除（もし付いていれば）
        ln = ln.replace(/\s*背番号\s*\d+/, "");
      } else if (ln.includes(last)) {
        // すでに苗字表記だが背番号だけ付いているケースを掃除
        ln = ln.replace(/\s*背番号\s*\d+/, "");
      }
    }
    return ln;
  });
}


// リエントリーの句点調整：続きがある行は「…に入ります。」→「…、」
if (reentryLines.length > 0) {
  // リエントリーが複数なら、最後以外はすべて「、」で終える
  for (let i = 0; i < reentryLines.length - 1; i++) {
    reentryLines[i] = reentryLines[i].replace(/に入ります。$/, "、");
  }
  // リエントリーの後ろに通常の交代アナウンスが続く場合、
  // リエントリー最後の行も「、」で繋ぐ
  if (normalLines.length > 0) {
    reentryLines[reentryLines.length - 1] =
      reentryLines[reentryLines.length - 1].replace(/に入ります。$/, "、");
  }
}

return normalText;


}, [battingOrder, assignments, initialAssignments, battingReplacements, teamName, teamPlayers,usedPlayerInfo]);

useEffect(() => {
  if (!battingOrder || !usedPlayerInfo) return;

  const updatedAssignments = { ...assignments };
  let changed = false;

  // 代打または代走として出場している選手を元の選手の位置に自動配置
  battingOrder.forEach((entry) => {
    const info = usedPlayerInfo[entry.id];
    if (info?.subId && (entry.reason === "代打" || entry.reason === "代走"|| entry.reason === "臨時代走")) {
      const pos = initialAssignments ? Object.entries(initialAssignments).find(([, pid]) => pid === entry.id)?.[0] : undefined;
      if (pos && updatedAssignments[pos] !== info.subId) {
        console.log(`[DEBUG] 代打/代走 ${info.subId} を ${pos} に配置`);
        updatedAssignments[pos] = info.subId;
        changed = true;
      }
    }
  });

  if (changed) {
    setAssignments(updatedAssignments);
  }
}, [battingOrder, usedPlayerInfo, initialAssignments]);


// 代打/代走を assignments に反映する useEffect の後

useEffect(() => {
  if (!battingOrder || !usedPlayerInfo) return;
  // ... 略 ...
}, [battingOrder, usedPlayerInfo, initialAssignments]);

// ★ ここにグローバルタッチ確定ハンドラの useEffect をコピペ

// ✅ ベンチは“常に最新の assignments”から再計算する
useEffect(() => {
  if (!teamPlayers || teamPlayers.length === 0) return;
  // ... 略 ...
}, [assignments, teamPlayers]);


// ✅ ベンチは“常に最新の assignments”から再計算する
useEffect(() => {
  if (!teamPlayers || teamPlayers.length === 0) return;

  const assignedIdsNow = Object.values(assignments)
    .filter((id): id is number => typeof id === "number");

  (async () => {
    // スタメン設定画面で指定したベンチ外のみを唯一の情報源にする
    const startingBenchOut =
      (await localForage.getItem<number[]>("startingBenchOutIds")) ?? [];

    const benchOutIds = Array.from(
      new Set(startingBenchOut.map(Number).filter(Number.isFinite))
    );

    // 控え候補＝「未割当の選手」−「ベンチ外（スタメン指定）」
    setBenchPlayers(
      teamPlayers.filter(
        (p) => !assignedIdsNow.includes(p.id) && !benchOutIds.includes(p.id)
      )
    );
  })();
}, [assignments, teamPlayers]);





// iOS Safari の transform 原点ズレ対策用 dragImage ゴースト作成
const makeDragGhost = (el: HTMLElement) => {
  const rect = el.getBoundingClientRect();
  const ghost = el.cloneNode(true) as HTMLElement;
  ghost.style.position = "fixed";
  ghost.style.top = `${rect.top}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.width = `${rect.width}px`;
  ghost.style.height = `${rect.height}px`;
  ghost.style.opacity = "0";           // 見えない
  ghost.style.pointerEvents = "none";
  ghost.style.transform = "none";      // 親の transform の影響を受けない
  document.body.appendChild(ghost);
  return { ghost, rect };
};

// ② 既存の handlePositionDragStart を差し替え
const handlePositionDragStart = (  
  e: React.DragEvent<HTMLDivElement>,
  pos: string
) => {
  lockScroll();
  e.dataTransfer.setData("fromPos", pos);
  e.dataTransfer.setData("text/plain", pos); // ← これを追加（Android必須）
  e.dataTransfer.effectAllowed = "move";
  setDraggingFrom(pos);

  // ★ イベントから切り離して保持
  const el = e.currentTarget as HTMLDivElement;

  const target =
    el.querySelector<HTMLElement>("div[draggable='true']") || el;

  const { ghost, rect } = makeDragGhost(target);
  e.dataTransfer.setDragImage(ghost, rect.width / 2, rect.height / 2);

  const onEnd = () => {
    try { ghost.remove(); } catch {}
    try { el.removeEventListener("dragend", onEnd); } catch {}
    window.removeEventListener("dragend", onEnd);
    window.removeEventListener("drop", onEnd);
    unlockScroll();
  };

  // once: true で二重解除を気にしない
  el.addEventListener("dragend", onEnd, { once: true });
  window.addEventListener("dragend", onEnd, { once: true });
  window.addEventListener("drop", onEnd, { once: true });
};



  const handleBenchDragStart = (e: React.DragEvent, playerId: number) => {
    lockScroll();
    e.dataTransfer.setData("playerId", playerId.toString());
    e.dataTransfer.setData("text/plain", playerId.toString()); // ★ Android 用
    e.dataTransfer.effectAllowed = "move";                     // ★ 視覚的にも安定
    setDraggingFrom(BENCH);
    const el = e.currentTarget as HTMLElement;
    const onEnd = () => {
      try { el.removeEventListener("dragend", onEnd); } catch {}
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
      unlockScroll();
    };
    el.addEventListener("dragend", onEnd, { once: true });
    window.addEventListener("dragend", onEnd, { once: true });
    window.addEventListener("drop", onEnd, { once: true });

  };

  const handleDrop = (toPos: string, e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
// ==== 入口ログ（必ず出る）====
let srcFrom = draggingFrom; // 以降は srcFrom を使う
let dt:any = null, dtFrom:string|undefined, dtPid:string|undefined;

try {
  dt = e?.dataTransfer || null;
  dtFrom = dt?.getData?.("fromPos") ?? dt?.getData?.("fromPosition");
  dtPid  = dt?.getData?.("playerId") || dt?.getData?.("text/plain");
  console.log("📥 handleDrop ENTER", {
    toPos,
    draggingFrom,
    hasDataTransfer: !!dt,
    dt: { fromPos: dtFrom, playerId: dtPid }
  });
} catch (err) {
  console.warn("📥 handleDrop ENTER (dt read error)", err);
}

// ==== draggingFrom の補完＆正規化（「控え」もベンチ扱いにする）====
const normalizeFrom = (s?: string | null) => {
  if (!s) return s;
  if (s === "控え" || s === "ベンチ" || s === "bench") return BENCH;
  return s;
};

srcFrom = normalizeFrom(srcFrom);
const dtFromNorm = normalizeFrom(dtFrom);

if (!srcFrom && dtFromNorm) srcFrom = dtFromNorm;              // DnD経由
if (!srcFrom && touchDrag?.fromPos) srcFrom = normalizeFrom(String(touchDrag.fromPos)); // タッチ経由
if (!srcFrom && dtPid) srcFrom = "ベンチ";                      // playerIdだけ来ている＝ベンチ発の可能性大

console.log("🧭 SOURCE RESOLVED", { srcFrom });

// ==== 判定プレチェック（ここで必ず toId / fromId を決める）====
// フィールド発かどうかは「assignments にキーが存在するか」で判定
const fromIsField = !!srcFrom && (srcFrom in assignments);

// ベンチ発なら dataTransfer の playerId、フィールド発なら assignments[srcFrom]
const toId =
  fromIsField
    ? (assignments[srcFrom as keyof typeof assignments] ?? null)
    : Number(dtPid);

const fromId = assignments[toPos] ?? null; // ここが null だと“空き枠ドロップ”

const isNumber = (v: any): v is number =>
  typeof v === "number" && !Number.isNaN(v);

console.log("🧾 判定プレチェック", {
  toPos,
  srcFrom,
  fromIsField,
  toId,
  fromId,
  note: fromId == null ? "fromId=null（空き枠へドロップ）→ リエントリー判定は未実施" : "fromIdあり（置き換え）"
});

// ==== v2 リエントリー判定 ====
// ★ ベンチ→守備のときだけ、かつ「出場済みの元スタメン」を落としたときだけ実行
if (!fromIsField && toPos !== BENCH) {
  resetBlue?.();



  let isReentryNow = false;

  if (isNumber(toId) && isNumber(fromId)) {
    // toId = ベンチから落とした選手
    const origIdForTo = resolveOriginalStarterId(toId, usedPlayerInfo, initialAssignments);

    // 「元スタメンか？」（＝リエントリー候補の素質）
    const wasStarter = origIdForTo !== null;

    // 「出場済みの記録（代打/代走など）があるか？」→ ここが無いなら未出場＝控え
    const hasUsedRecord =
      wasStarter && !!(usedPlayerInfo as any)?.[Number(origIdForTo)];

    // ★ 控え（未出場）はリエントリー判定をスキップして通常交代へ
    if (!hasUsedRecord) {
      resetBlue?.(); // 念のため青プレビューを消すだけ
      // ここでは何も return しない（通常フロー継続）
    } else {
      // ここから“出場済みの元スタメン”だけ厳格に判定
      const startIdx = wasStarter
        ? startingOrderRef.current.findIndex((e) => e.id === (origIdForTo as number))
        : -1;
      const fromOrderIdx = (battingOrderDraft ?? []).findIndex((e) => {
        const slotId = Number(e?.id);
        if (!Number.isFinite(slotId)) return false;

        const latest = resolveLatestSubId(slotId, (usedPlayerInfo as any) || {});
        return latest === Number(fromId) || slotId === Number(fromId);
      });

      const sameBattingSlot = startIdx >= 0 && fromOrderIdx >= 0 && fromOrderIdx === startIdx;
      const isOffField = !Object.values(assignments || {}).includes(Number(toId));

      isReentryNow = wasStarter && sameBattingSlot && hasUsedRecord && isOffField;

      if (isReentryNow) {
        setReentryPreviewIds(new Set([Number(toId)]));  // 厳格OKのときだけ青プレビュー
      } else {
        resetBlue?.();
        window.alert("リエントリー対象選手ではありません。");
        setHoverPos(null);
        setDraggingFrom(null);
        try { e.dataTransfer.dropEffect = "none"; } catch {}
        return; // ← これで真っ白画面は止まります
      }

    }
  }
} else {
  // 守備↔守備はリエントリー判定しない
  resetBlue?.();
}




// ↓↓↓ この後の既存処理（setAssignments など）は “上で算出した toId/fromId/srcFrom” を使う ↓↓↓


    // ---- ここまで追加（判定・青枠・ログ）----

    if (!srcFrom) return;

    // 『指』にドロップされたら、DH解除の保留を取り消す（＝DH継続に戻す）
    if (toPos === "指" && (dhDisableDirty || pendingDisableDH)) {
      setDhDisableDirty(false);
      setPendingDisableDH(false);
    }

    // ★ DHを他守備にドロップ → その瞬間にDH解除 & 退場 & 打順差し替え
    if (draggingFrom === "指" && toPos !== BENCH && toPos !== "指") {
      setAssignments((prev) => {
        const dhId = prev["指"];
        if (!dhId) return prev;

        const replacedId = prev[toPos] ?? null;

        // 1) 守備を更新（DH → toPos / 指は空に）
        const next = { ...prev, [toPos]: dhId, "指": null };

        // 2) DH解除のUIフラグ（既存ロジックを即時発火させる）
        setDhEnabledAtStart(false);
        setDhDisableDirty(true); // アナウンスに「DH解除」を差し込む


      // 4) 退場した選手の“打順”の表示：
      //    投手の重複を避けて「現在 1〜9番に入っていない“元スタメン”の野手」を優先して入れる。
      //    （該当者がいない場合のみ投手を採用）
      const nextAssignments = next; // この時点で next が最新配置
      const battingStarterIds = new Set(battingOrder.map(e => e.id));
      const starterIds = new Set(
        Object.values(initialAssignments).filter((v): v is number => typeof v === "number")
      );
      const currentPitcherId: number | null = (toPos === "投" ? dhId : prev["投"]) ?? null;

      // 今フィールドにいるID（nextベース）
      const onFieldIds = new Set(
        Object.values(nextAssignments).filter((v): v is number => typeof v === "number")
      );

      // 候補: “元スタメン”かつ “現在1〜9番に入っていない” かつ “今フィールドにいる” かつ “投手ではない”
      const nonPitcherNonBattingStarters = Array.from(starterIds).filter(id =>
        !battingStarterIds.has(id) &&
        onFieldIds.has(id) &&
        id !== currentPitcherId
      );

      // 置換を入れる打順スロット（退場した元先発のスロット）
      const idx = battingOrder.findIndex(e => e.id === replacedId);
      if (idx >= 0) {
        // 置換を入れる打順スロット（退場した元先発のスロット）
        const idx = battingOrder.findIndex(e => e.id === replacedId);
        if (idx >= 0) {
          const candidateId = currentPitcherId; // ← 常に投手を入れる（DH解除規則）
          if (typeof candidateId === "number") {
            const candidate = teamPlayers.find(tp => tp.id === candidateId);
            if (candidate) {
              setBattingReplacements(prevRep => ({ ...prevRep, [idx]: candidate }));
            }
          }
        }

      if (typeof candidateId === "number") {
        const candidate = teamPlayers.find(tp => tp.id === candidateId);
        if (candidate) {
          setBattingReplacements(prevRep => ({ ...prevRep, [idx]: candidate }));
        }
      }
    }



        // 5) ログ（視覚上の変更履歴）
        updateLog("指", dhId, toPos, replacedId);

        return next;
      });
      // ---- assignments 更新の直後に追加 ----
      if (isNumber(toId) && isNumber(fromId)) {
        setBattingOrderDraft((prev) => {
          const next = [...prev];
          const idx = next.findIndex((e) => e.id === fromId);
          if (idx >= 0) {
            next[idx] = { ...next[idx], id: toId };
            console.log("✍️ ドラフト打順更新", { slot: idx + 1, fromId, toId, next });
          }
          return next;
        });
      }
      setDraggingFrom(null);
      return;
    }

    setAssignments((prev) => {
      const newAssignments = { ...prev };

    if (draggingFrom !== BENCH && toPos !== BENCH && draggingFrom !== toPos) {
      const fromId = prev[draggingFrom];
      const toId = prev[toPos];

      // ▼ A(先発)にしかロックは効かせない
      if (fromId != null && isStarter(fromId)) {
        const expected = pairLocks[fromId];
        if (expected != null && toId !== expected) {
          window.alert("この元の選手は、最初に交代した相手以外とは交代できません。");
          return prev;
        }
      }
      if (toId != null && isStarter(toId)) {
        const expected = pairLocks[toId];
        if (expected != null && fromId !== expected) {
          window.alert("この元の選手は、最初に交代した相手以外とは交代できません。");
          return prev;
        }
      }
      // 🔒 どちらかの位置が空なら交代不可（控え扱いなので）
      if (fromId === null || toId === null) return prev;

      const newAssignments = { ...prev };
      newAssignments[draggingFrom] = toId;
      newAssignments[toPos] = fromId;

      // ★ DHありの状態で投手が別守備へ移動、または他守備が投手になる場合はDH解除
      //   ルール: 投手が「投」から外れた時点でDH解除。DHの打順に“元投手”が入る。
      //   ※ 確定時(confirmChange)に battingOrder を置換するため、ここで必ずスナップショットを残す。
      const dhId = prev["指"];
      const oldPitcherId = prev["投"]; // この入替の“直前”に投手だった選手

      const shouldDisableDH =
        toPos !== "指" &&
        draggingFrom !== "指" &&
        typeof dhId === "number" &&
        typeof oldPitcherId === "number" &&
        (
          // 元投手が「投」から別守備へ移動
          (draggingFrom === "投" && toPos !== "投") ||
          // 他守備の選手が「投」になり、元投手が別守備へ回る（=「投」が入替）
          (toPos === "投" && draggingFrom !== "投")
        );

      if (shouldDisableDH) {
        // ✅ DH解除に必要なIDを保持（これが無いと確定時にDHの打順を置換できない）
        setDhDisableSnapshot({ dhId, pitcherId: oldPitcherId });
        setPendingDisableDH(true);
        setDhDisableDirty(true);

        // DH枠は空に（=DH選手は退場扱い）
        newAssignments["指"] = null;

        // 画面上は「DHの打順」に“元投手”を赤字で差し込んで見えるようにする
        const dhIndex = battingOrder.findIndex((e) => e.id === dhId);
        if (dhIndex !== -1) {
          const p = teamPlayers.find((tp) => tp.id === oldPitcherId);
          if (p) {
            setBattingReplacements((prevRep) => ({ ...prevRep, [dhIndex]: p }));
          }
        }
      }

      // ✅ フィールド同士の A↔B 戻しが成立したら解除
      if (fromId != null && pairLocks[fromId] === toId ||
          toId   != null && pairLocks[toId]   === fromId) {
        setPairLocks((m) => {
          const copy = { ...m };
          // A側のロック解除
          if (fromId != null) delete copy[fromId];
          if (toId   != null) delete copy[toId];
          // 念のため：どこかのAが partner=B を参照していたら全消し
          for (const [aStr, partner] of Object.entries({ ...copy })) {
            if (partner === fromId || partner === toId) delete copy[Number(aStr)];
          }
          return copy;
        });
      }

      if (fromId !== null) {
        setPreviousPositions((prevMap) => ({ ...prevMap, [fromId]: draggingFrom }));
      }
      if (toId !== null) {
        setPreviousPositions((prevMap) => ({ ...prevMap, [toId]: toPos }));
      }
      // ★ この toPos から外れた“元スタメン”の打順Indexを記録（次のベンチ投入で使う）
      if (toId != null) {
        const idx = battingOrder.findIndex(e => e.id === toId);
        if (idx !== -1) lastVacatedStarterIndexRef.current = idx;
      }

      // ▼ 指名打者（DH）→守備 のときは、落とした先の“元スタメン”の打順枠に
// ▼ 指名打者（DH）→守備 のときは、落とした先の“元スタメン”の打順枠には【投手】を立てる
if (draggingFrom === "指" && fromId != null && toId != null) {
  const targetIndex = battingOrder.findIndex(e => e.id === toId); // 例: 秋本(8番)
  if (targetIndex !== -1) {
    const pitcherId =
      typeof prev["投"] === "number" ? prev["投"] :
      (typeof assignments?.["投"] === "number" ? assignments["投"] : null);
    const pitcher = pitcherId != null ? teamPlayers.find(p => p.id === pitcherId) : null;

    setBattingReplacements(prevRep => {
      const next = { ...prevRep };
      if (pitcher) next[targetIndex] = pitcher;   // 8番枠＝投手（百目鬼）を赤字に
      else delete next[targetIndex];
      return next;
    });
    lastVacatedStarterIndexRef.current = null;
  }
}


// ★ オンフィールド同士の入替では打順は触らない
//    影響しうる打順スロット（from/to の元スタメン）だけ置換を消す
if (fromId !== null && toId !== null) {
  battingOrder.forEach((starter, index) => {
    if (starter.id === fromId || starter.id === toId) {
      setBattingReplacements((prev) => {
        const next = { ...prev };
        delete next[index];
        return next;
      });
    }
  });
}

      updateLog(draggingFrom, fromId, toPos, toId);
      return newAssignments;
    }

    if (draggingFrom === BENCH && toPos !== BENCH) {
      const playerIdStr =
        e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
      if (!playerIdStr) return prev;
      const playerId = Number(playerIdStr);

      const replacedId = prev[toPos];  // 守備位置にいた選手

      // --- リエントリー判定（ベンチ→守備の“その位置”だけを入替） ---
    let allowDrop = true; // 🆕 不可ならこのターンの配置を中止
    (() => {
      // すでに場内にいる選手ならリエントリー判定をスキップ（守備位置移動だけ許可）
      const alreadyOnField = Object.values(prev).includes(playerId);
      if (alreadyOnField) {
        resetBlue?.();   // 青枠が残っていたらクリア
        return;          // この IIFE を終了（アラートは出さない）
      }

      // playerId はベンチから落とした選手
      const info: any = (usedPlayerInfo as any)?.[playerId]; // ← “元先発B”なら usedPlayerInfo に記録あり
      const reason = info?.reason as "代打" | "代走" | undefined;
      const isReentryCandidate = reason === "代打" || reason === "代走";

      // B の「元いた守備」を略号に正規化（例: "サード"→"三"）
      const fromSym = (posNameToSymbol as any)[info?.fromPos] ?? info?.fromPos;

      // 連鎖の末端まで辿って、B に対して実際に出ていた “代打/代走 A（最新）” を取得
      const latest = resolveLatestSubId(playerId, (usedPlayerInfo as any) || {});
      const isPinchAtThatPos =
        replacedId != null && (replacedId === latest || replacedId === info?.subId);

      if (isReentryCandidate) {
        // ✅ リエントリー成立条件（緩和版）:
        //  「自分に出ていた代打/代走（A最新）が、今このドロップ先にいる」なら OK
        const ok = isPinchAtThatPos;


        if (!ok) {
          // ✖ 条件を満たさない → この配置は行わない
          allowDrop = false;
          window.alert("リエントリー対象選手ではありません。");
          // 念のため、このBの古いリエントリー記録を掃除
          setReentryInfos((prev) => prev.filter((x) => x.originalId !== playerId));
          return;
        }
        
        // ✅ 正常なリエントリー：記録を積む（重複防止つき）
        setReentryInfos((prev) => {
          if (replacedId == null) return prev;
          const exists = prev.some(
            (x) => x.originalId === playerId && x.pinchId === replacedId && x.pos === toPos
          );
          return exists ? prev : [...prev, { originalId: playerId, pinchId: replacedId, pos: toPos, reason }];
        });
      } else {
        // 通常の控え選手：リエントリー記録が残っていたら消す
        setReentryInfos((prev) => prev.filter((x) => x.originalId !== playerId));
      }
    })();
    // 🛑 不成立ならこのドロップは無効（状態は一切変えない）
    if (!allowDrop) { e.dataTransfer.dropEffect = "none"; return prev; }

      // === 追加：Aの位置へCを入れた瞬間、Aのロック相手をB→Cに付け替える ===
    // toPos が「Aの元ポジ」かどうかを initialAssignments で判定
      const aIdAtThisPos = initialAssignments[toPos]; // ← A（元）のID（なければ undefined/ null）

    // === 追加：Aの位置へCを入れた瞬間、B→AロックをB→Cへ付け替えつつAを完全解除 ===
    // toPos が「元の先発(B)のポジション」かどうかを initialAssignments で判定
    const starterAtThisPos = initialAssignments[toPos]; // 元の先発 = B
    if (
      starterAtThisPos != null &&
      replacedId != null &&                      // 直前までそこにいたのが A
      pairLocks[starterAtThisPos] === replacedId // いま B→A のロックになっている
    ) {
      setPairLocks((m) => {
        const copy = { ...m };

        // 1) B→A を B→C に付け替え
        //    playerId はいま落とした C
        copy[starterAtThisPos] = playerId;

        // 2) A を完全に自由化（A をキーにしたロックも、値として参照されているロックも掃除）
        delete copy[replacedId]; // key = A のロックを削除
        for (const [k, v] of Object.entries(copy)) {
          if (v === replacedId) delete copy[Number(k)]; // partner = A を参照するエントリを掃除
        }

        return copy;
      });
    }



    // ====== 置き換え：A↔Bペア制約（bench→守備） ======
    // ここでは「ベンチから落とす選手が A 本人かどうか」で判断する
    // ・A を落とす→ その場所にいるのが B 以外なら拒否
    // ・A 以外（Cなど）を落とす→ 制約なし（許可）
    const lockPartner = pairLocks[playerId /* ← A かもしれない */];

    // (A本人) A にロックがあるのに、そこ（toPos）にいるのが B ではない → 拒否
    if (lockPartner != null && replacedId !== lockPartner) {
      window.alert("この元の選手は、最初に交代した相手の位置にしか戻せません。");
      return prev;
    }

    // 先発（画面を開いた時点でフィールドにいた選手）にだけロックを作る
    if (
      replacedId != null &&
      isStarter(replacedId) &&        // ★ これを追加
      pairLocks[replacedId] == null &&
      replacedId !== playerId         // 念のため：同一IDの自爆防止
    ) {
      setPairLocks((m) => ({ ...m, [replacedId]: playerId }));
    }


      newAssignments[toPos] = playerId;

        // ★ 戻し成立（Aを元ポジに戻した）なら、控えに下がったBを完全フリー化
      //   条件：この toPos の「元の先発」が A（= playerId）で、今いたのが B（= replcedId）
      if (initialAssignments[toPos] === playerId && replacedId != null) {
        setPairLocks((m) => {
          const copy = { ...m };
          // B をキーにしたロックが万一残っていても消す
          delete copy[replacedId];
          // A→B のように B を相手にしているロックも全て掃除
          for (const [aStr, partner] of Object.entries({ ...copy })) {
            if (partner === replacedId) delete copy[Number(aStr)];
          }
          return copy;
        });
      }

      // ✅ “B を A の位置へ落として戻した”場合でもロック解除（対称パターン）
    if (replacedId != null && pairLocks[replacedId] === playerId) {
      // replacedId = A, playerId = B
      setPairLocks((m) => {
        const copy = { ...m };
        delete copy[replacedId]; // A のロック解除
        return copy;
      });
    }


    // ✅ A↔B の戻しが成立したら、その場でロック解除
    if (pairLocks[playerId] != null && replacedId === pairLocks[playerId]) {
      // playerId = A を B の場所に落とした
      setPairLocks((m) => {
        const copy = { ...m };
        delete copy[playerId]; // A のロック解除
        return copy;
      });
    }

    // 🟡 元いた選手を控えに戻す（重複防止）
    if (replacedId) {
      setBenchPlayers((prev) => {
        if (prev.some((p) => p.id === replacedId)) return prev;
        const replacedPlayer = teamPlayers.find((p) => p.id === replacedId);
        if (!replacedPlayer) return prev;
        return [...prev, replacedPlayer];
      });
    }
    if (replacedId != null) {
      setPairLocks((m) => {
        let changed = false;
        const copy = { ...m };
        for (const [aStr, partner] of Object.entries(copy)) {
          if (partner === replacedId) {
            delete copy[Number(aStr)]; // A のロック解除
            changed = true;
          }
        }
        return changed ? copy : m;
      });
    }
    // 🔴 出た控え選手を控えリストから除去
    setBenchPlayers((prev) => prev.filter((p) => p.id !== playerId));


// 🟢（ベンチ → 先発 のときだけ）battingReplacements を更新
{
  // 打順スロット（index）を、まず「今そこに居る人」で探す
  let targetIndex = battingOrder.findIndex(e => e.id === replacedId);

  // 既存：let targetIndex = battingOrder.findIndex(e => e.id === replacedId);
// 既存：過去の置換テーブルから探す…（既存コードの直後に）👇を追加
if (targetIndex === -1 && toPos === "投" && lastVacatedStarterIndexRef.current != null) {
  targetIndex = lastVacatedStarterIndexRef.current;
}

  // 見つからなければ、過去の置換テーブルから探す（bench→bench の引継ぎ）
  if (targetIndex === -1 && replacedId != null) {
    const prevEntry = Object.entries(battingReplacements)
      .find(([, p]) => p.id === replacedId);
    if (prevEntry) targetIndex = Number(prevEntry[0]);
  }

  if (targetIndex !== -1) {
    const benchPlayer = teamPlayers.find((p) => p.id === playerId);
    if (benchPlayer && replacedId !== playerId) {
      // 置換として登録/更新 ←★ これが打順行の“order”になります
      setBattingReplacements((prev) => ({
        ...prev,
        [targetIndex]: benchPlayer,
      }));
    } else {
      // 同じ選手を戻すなどのケースでは、その枠の置換をクリア
      setBattingReplacements((prev) => {
        const next = { ...prev };
        delete next[targetIndex];
        return next;
      });
    }
  }
}


      // 🔄 交代取り消しのチェック（初期と一致していたら削除）
    // 🔄 交代取り消しのチェック（最小限の更新：既存の置換はフィールドに居る限り維持）
    setBattingReplacements((prev) => {
      const rebuilt: { [idx: number]: Player } = { ...prev };

      // 1) 既存の置換は、その選手がフィールドに“まだ居るなら”維持
      const onFieldIds = new Set(Object.values(newAssignments).filter((v): v is number => typeof v === "number"));
      for (const [idxStr, p] of Object.entries(prev)) {
        const idx = Number(idxStr);
        if (onFieldIds.has(p.id)) {
          rebuilt[idx] = p; // 維持
        } else {
          delete rebuilt[idx]; // 退場してたら削除
        }
      }

      // 2) 今回の操作で影響した“元の先発の打順”だけ再評価して更新
      //    toPos に元々いた選手（= replacedId）の打順を特定し、その枠だけ更新する
      //    ※ 上の処理で targetIndex を算出しているなら、それを使ってもOK
      const affectedStarterIndex = battingOrder.findIndex((starter) => {
        const starterPos = getPositionName(initialAssignments, starter.id);
        return starterPos === toPos; // toPos の元先発の打順
      });

if (affectedStarterIndex !== -1) {
  const starter = battingOrder[affectedStarterIndex];
  const starterPos = getPositionName(initialAssignments, starter.id);
  const assignedId = newAssignments[starterPos];

  const starterStillOnField = onFieldIds.has(starter.id);
  const isAssignedStarter =
    typeof assignedId === "number" && battingOrder.some(e => e.id === assignedId);

  // 🆕 直前のその守備(toPos)に居たのが DH だったか？（＝今回の bench→守備 で DH をどかした）
  const wasPrevDH = typeof replacedId === "number" && prev["指"] === replacedId;

  // 🆕 DH→守備の直後、そのDH（= replacedId）を控えでどかしたケース：
//   控えは DH の打順へ入れる。元守備の打順（投手が入る）は触らない。
if (wasPrevDH) {
  // DH の打順 index（= replacedId の元の打順）
  const dhIndex = battingOrder.findIndex(e => e.id === replacedId);
  // いま toPos に入った控え
  const subId = newAssignments[toPos];
  const sub = typeof subId === "number" ? teamPlayers.find(p => p.id === subId) : undefined;

  if (dhIndex !== -1 && sub) {
    rebuilt[dhIndex] = sub;           // 控えは DH の打順へ
  }
  return rebuilt;                      // ← 8番など“元守備”側は既存のまま（= 投手のまま）
}


  if (!starterStillOnField && assignedId && assignedId !== starter.id && !isAssignedStarter) {
    if (wasPrevDH) {
      // ★ このケースは「元スタメンの枠＝投手」を入れる（清水を入れない）
      const pitcherIdNow = newAssignments["投"];
      const pp = typeof pitcherIdNow === "number" ? teamPlayers.find(pl => pl.id === pitcherIdNow) : null;
      if (pp) rebuilt[affectedStarterIndex] = pp;
      else delete rebuilt[affectedStarterIndex];
    } else {
      // 従来どおり：通常の“元スタメン枠には現在そこに居る選手”を入れる
      const p = teamPlayers.find(pl => pl.id === assignedId);
      if (p) rebuilt[affectedStarterIndex] = p;
      else delete rebuilt[affectedStarterIndex];
    }
  } else {
    delete rebuilt[affectedStarterIndex];
  }
}


      return rebuilt;
    });



      updateLog(BENCH, playerId, toPos, replacedId);
      return newAssignments;
    }
      return prev;
    });
    // ---- assignments 更新の直後に追加 ----
    if (isNumber(toId) && isNumber(fromId)) {
      setBattingOrderDraft((prev) => {
        const next = [...prev];
        const idx = next.findIndex((e) => e.id === fromId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], id: toId };
          console.log("✍️ ドラフト打順更新", { slot: idx + 1, fromId, toId, next });
        }
        return next;
      });
    }

    setDraggingFrom(null);
  };

  const handleDropToBattingOrder = (index: number, e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
    const playerId = Number(idStr);
    const player = benchPlayers.find((p) => p.id === playerId);
    if (!player) return;

    setBattingReplacements((prev) => ({
      ...prev,
      [index]: player,
    }));

    setBenchPlayers((prev) => prev.filter((p) => p.id !== playerId));
  };

  const updateLog = (
    fromPos: string,
    fromId: number | null,
    toPos: string,
    toId: number | null
  ) => {
    const fromPlayer = teamPlayers.find((p) => p.id === fromId);
    const toPlayer = teamPlayers.find((p) => p.id === toId);

    if (!fromPlayer && !toPlayer) return;
    if (fromId !== null && toId !== null && fromId === toId) return;

    const newLog = `${formatLog(fromPos, fromPlayer)} ⇄ ${formatLog(toPos, toPlayer)}`;
    const reversedLog = `${formatLog(toPos, toPlayer)} ⇄ ${formatLog(fromPos, fromPlayer)}`;

    setSubstitutionLogs((prev) => {
      if (prev.includes(newLog)) return prev;
      if (prev.includes(reversedLog)) return prev.filter((log) => log !== reversedLog);
      return [...prev, newLog];
    });
  };

  const getEffectiveSubstitutionLogs = (logs: string[]): string[] => {
    const filteredLogs = [...logs];
    const toRemove = new Set<number>();

    for (let i = 0; i < filteredLogs.length; i++) {
      if (toRemove.has(i)) continue;
      const log = filteredLogs[i];
      const reversedLog = log.split(" ⇄ ").reverse().join(" ⇄ ");
      for (let j = i + 1; j < filteredLogs.length; j++) {
        if (filteredLogs[j] === reversedLog) {
          toRemove.add(i);
          toRemove.add(j);
          break;
        }
      }
    }

    return filteredLogs.filter((_, idx) => !toRemove.has(idx));
  };


  
//**************// 
//　確定ボタン　 //
//**************// 
const confirmChange = async () => {
  await pushHistory();  // ★確定直前スナップショットを永続化まで行う
  // usedInfo を読み出し
  const usedInfo: Record<
    number,
    {
      fromPos: string;
      subId: number;
      reason: "守備交代";
      order: number | null;     // ← number | null にしておくと安全
      wasStarter: boolean;
    }
  > = (await localForage.getItem("usedPlayerInfo")) || {};

    // ▼ ここから追加：確定時に最終状態を作る（DH解除をここで反映）
  let finalAssignments = { ...assignments };
  let finalBattingOrder = [...battingOrder];
  let finalDhEnabledAtStart = dhEnabledAtStart;

  if (pendingDisableDH) {
    // ✅ 「指」をUIで空にしていても、押下時スナップショットがあればそれを使う
    const dhId = dhDisableSnapshot?.dhId ?? finalAssignments["指"];
    const pitcherId = dhDisableSnapshot?.pitcherId ?? finalAssignments["投"];

    if (typeof dhId === "number" && typeof pitcherId === "number") {
      const idx = finalBattingOrder.findIndex(e => e.id === dhId);
      if (idx !== -1) {
        // 指名打者の打順を投手に置換
        finalBattingOrder[idx] = { id: pitcherId, reason: "スタメン" };
      }
    } else {
      window.alert("DH解除に必要な情報（指名打者 or 投手）が不足しています。");
      return; // 不整合は保存しない
    }

    // 守備の「指」を空にしてDHなしへ
    finalAssignments["指"] = null;
    finalDhEnabledAtStart = false; // 以後“指”へのD&Dは禁止・9番下の投手表示も出なくなる
    // 後始末
    setDhDisableSnapshot(null);
    setPendingDisableDH(false);
    setDhDisableDirty(false);
 }
  // ▲ ここまで追加

  // ★ ここで一度だけ取得（ループ内で await しない）
  const startingOrder: Array<{ id: number; reason?: string }> =
    (await localForage.getItem("startingBattingOrder")) || [];

  // 守備交代で usedInfo を更新（order/wasStarter を必ず書く）
  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];  // 元の選手（先発想定）
    const currentId = assignments[pos];         // 現在の選手
    const playerChanged = initialId && currentId && initialId !== currentId;

    if (playerChanged) {
      // 1) 打順 order（1始まり）：battingOrder → なければ startingOrder でフォールバック
      const idxNow = battingOrder.findIndex((e) => e.id === initialId);
      const idxStart = startingOrder.findIndex((e) => e.id === initialId);
      const order: number | null =
        idxNow !== -1 ? idxNow + 1 :
        idxStart !== -1 ? idxStart + 1 :
        null;

      // 2) wasStarter：開始スナップショットに居たら true
      const wasStarter = idxStart !== -1;

      // 3) fromPos：代打/代走で入っていたなら "代打"/"代走"
      const battingReasonNow = idxNow !== -1 ? battingOrder[idxNow]?.reason : undefined;
      const fromPos =
        battingReasonNow === "代打" ? "代打" :
        battingReasonNow === "代走" ? "代走" :
        battingReasonNow === "臨時代走" ? "臨時代走" :
        pos;

      usedInfo[initialId] = {
        fromPos,
        subId: currentId!,
        reason: "守備交代",
        order,        // ← null の可能性も許容
        wasStarter,
      };
      
    }
  });
await localForage.setItem("usedPlayerInfo", usedInfo);
  // 🆕 リエントリー確定した元選手(B)の代打/代走痕跡を掃除する
{
  // いまフィールドに出ている選手の集合（数値IDだけ）
  const onFieldIds = new Set(
    Object.values(assignments).filter(
      (v): v is number => typeof v === "number"
    )
  );

  // usedPlayerInfo の「元選手B（キー）」側に 代打/代走 が残っていて、
  // かつ B がフィールドに戻っている → リエントリー確定としてクリア
  for (const [origIdStr, info] of Object.entries(usedInfo)) {
    const origId = Number(origIdStr);
    const reason = (info as any)?.reason as string | undefined;
    if ((reason === "代打" || reason === "代走"|| reason === "臨時代走")  && onFieldIds.has(origId)) {
      const keepSubId = (info as any).subId; // 👈 subIdを保持
      (usedInfo as any)[origIdStr] = { ...(info as any), hasReentered: true, subId: keepSubId };
      delete (usedInfo as any)[origIdStr].reason;   // 自動配置/再リエントリー検出を止める
      delete (usedInfo as any)[origIdStr].fromPos;  // 参照しないなら消してOK
    }
  }
}
// （この直後に既存の保存行が続く）
await localForage.setItem("usedPlayerInfo", usedInfo);
setUsedPlayerInfo(usedInfo); // ★ 追加（UI 側の分類を即時反映）

  console.log("✅ 守備交代で登録された usedPlayerInfo：", usedInfo);

  // ---- 打順は「並びを固定」する：入替や移動では一切並べ替えない ----
  const updatedOrder = structuredClone(battingOrder);

  // フィールドに居る選手集合（数値のみ）
  const onFieldIds = new Set(
    Object.values(assignments).filter((v): v is number => typeof v === "number")
  );

  // “打順に元から居る（＝先発 or 既に登録済み）選手”集合
  const startersOrRegistered = new Set(
    updatedOrder.map(e => e?.id).filter((id): id is number => typeof id === "number")
  );

  // 守備位置ごとに差分を確認（並びは一切変更しない）
  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];
    const currentId = assignments[pos];

    if (!initialId || !currentId || initialId === currentId) return;

    const replacedIndex = updatedOrder.findIndex(e => e.id === initialId);
    if (replacedIndex === -1) return;

    const currentIsAlreadyInOrder = startersOrRegistered.has(currentId);
    const initialStillOnField     = onFieldIds.has(initialId);

    // A) 位置替えだけ → 触らない
    if (currentIsAlreadyInOrder && initialStillOnField) return;

    // B) 元の選手がベンチに下がり、今いる選手が“新規” → 途中出場で上書き
    if (!currentIsAlreadyInOrder && !initialStillOnField) {
      updatedOrder[replacedIndex] = { id: currentId, reason: "途中出場" };
      startersOrRegistered.add(currentId);
    }
    // C) それ以外 → 何もしない
  });

  // 代打が守備に就いたら理由だけ“途中出場”に補正
  updatedOrder.forEach((entry, index) => {
    if (["代打", "代走", "臨時代走"].includes(entry?.reason) && onFieldIds.has(entry.id)) {
      updatedOrder[index] = { ...entry, reason: "途中出場" };
    }
  });

  // battingReplacements を確定反映
  Object.entries(battingReplacements).forEach(([idxStr, repl]) => {
    const idx = Number(idxStr);
    const starterId = battingOrder[idx]?.id;
    if (starterId == null) return;

    const replacementId = repl.id;
    const starterStillOnField = onFieldIds.has(starterId);
    const replacementOnField  = onFieldIds.has(replacementId);

    if (!starterStillOnField && replacementOnField) {
      updatedOrder[idx] = { id: replacementId, reason: "途中出場" };
      startersOrRegistered.add(replacementId);
    }
  });

  // setPairLocks({});       // すでに後段で呼んでいるなら二重呼びは不要


// --- 保存（代打赤字はクリアして保存） ---
await localForage.setItem("lineupAssignments", assignments);
// ★ここを {} に固定する（非空は保存しない）
await localForage.setItem("battingReplacements", {});
await localForage.setItem("battingOrder", updatedOrder);
localStorage.setItem("battingOrderVersion", String(Date.now()));
await localForage.setItem("dhEnabledAtStart", dhEnabledAtStart);

// 画面状態もあわせて空にしておく
setBattingReplacements({});
setSubstitutionLogs([]);
setPairLocks({});

onConfirmed?.();

// 保存完了：スナップショット更新＆クリーン化
snapshotRef.current = buildSnapshot();
setIsDirty(false);
// ✅ 確定後はこの画面内の“基準”を更新（これで次の操作から「先ほど」にならない）
setInitialAssignments(finalAssignments);
setAssignments(finalAssignments);
setBattingOrder(updatedOrder);
setBattingOrderDraft(updatedOrder);
setDhEnabledAtStart(finalDhEnabledAtStart);

  console.log("✅ onConfirmed called");
};


  // 新たにアナウンス表示だけの関数を定義
  const showAnnouncement = () => {
    setShowSaveModal(true);
  };

  useEffect(() => {
  teamPlayers.slice(0, 9).forEach((player, index) => {
    const currentPos = getPositionName(assignments, player.id);
    const initialPos = getPositionName(initialAssignments, player.id);
    const initialPlayerId = initialAssignments[initialPos];
    const isSamePosition = currentPos === initialPos;
    const isSamePlayer = assignments[currentPos] === initialPlayerId;
    const isChanged = !(isSamePosition && isSamePlayer);    
    const playerLabel = formatPlayerLabel(player);
  });
}, [assignments, initialAssignments, teamPlayers]);

// === VOICEVOX 初期化・停止処理 ===
useEffect(() => {
  // 初回だけ VOICEVOX を温める（初回の待ち時間を短縮）
  void prewarmTTS();
}, []);

useEffect(() => {
  // コンポーネントがアンマウントされた時に確実に停止
  return () => {
    ttsStop();
  };
}, []);


// “戻る”が押されたとき：変更があれば確認、なければそのまま戻る
const handleBackClick = () => {
  if (isDirty) {
    setShowLeaveConfirm(true);
  } else {
    handleBackToDefense(); // 既存：App 左上の守備戻るボタンを実行
  }
};

// DefenseChange.tsx 内
const handleBackToDefense = () => {
  console.log("[DefenseChange] go defense via onConfirmed()");
  onConfirmed();   // ← App.tsx 側に渡されたコールバックで守備画面に遷移
};


const handleSpeak = async () => {
  const effectiveLogs = getEffectiveSubstitutionLogs(substitutionLogs);
  if (effectiveLogs.length === 0) return;

  const text = `守備交代をお知らせします。${effectiveLogs.join("、")}`;
  try {
    await ttsSpeak(text);   // VOICEVOX優先、失敗時は自動でWeb Speechにフォールバック
  } catch (e) {
    console.error("TTS failed:", e);
  }
};

  const handleStop = () => {
    ttsStop();
  };


  if (isLoading) {
    return <div className="text-center text-gray-500 mt-10">読み込み中...</div>;
  }
 

  const effectiveLogs = getEffectiveSubstitutionLogs(substitutionLogs);

  
  return (
    <div
      className="min-h-screen bg-slate-50 select-none"
      onContextMenu={(e) => e.preventDefault()}        // 長押しコピー/共有/印刷メニューを禁止
      onSelectStart={(e) => e.preventDefault()}         // テキスト選択禁止
      style={{
        WebkitTouchCallout: "none",  // iOS Safari の長押しメニュー禁止
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
    >

    {/* スマホ風ヘッダー */}
    <div className="sticky top-0 z-40 bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md">
      <div className="max-w-4xl mx-auto px-4">
        <div className="h-14 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-full w-9 h-9 flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/30 text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            aria-label="戻る"
            title="戻る"
          >

          </button>
          <div className="font-extrabold text-lg tracking-wide">🔀守備交代</div>
          <span className="w-9" />
        </div>
      </div>
    </div>

    {/* コンテンツカード（スマホ感のある白カード） */}
    <div className="max-w-4xl mx-auto px-4 py-4 pb-[calc(112px+env(safe-area-inset-bottom))] md:pb-4">
      <div className="p-0">
        {/* フィールド図 + 札（そのまま） */}
        <div className="relative mb-6 w-[100svw] -mx-4 md:mx-auto md:w-full md:max-w-2xl">
          <img
            src="/field.png"
            alt="フィールド図"
            className="w-full rounded-none md:rounded-xl shadow pointer-events-none select-none"
            draggable={false}
          />

          {/* 通常の描画（スタメンや通常交代） */}
{positions.map((pos) => {
  const currentId = assignments[pos];
  const initialId = initialAssignments[pos];

  const player = currentId ? teamPlayers.find((p) => p.id === currentId) ?? null : null;

  // 出場理由の補完（battingOrder or usedPlayerInfo）
  let reason: string | undefined;
  if (currentId) {
    const battingEntry = battingOrder.find(e => e.id === currentId);
    reason = battingEntry?.reason;

    if (!reason) {
      const entry = Object.entries(usedPlayerInfo).find(
        ([, info]) => info.subId === currentId
      );
      if (entry) {
        const originalId = Number(entry[0]);
        const originalReason = battingOrder.find(e => e.id === originalId)?.reason;
        reason = originalReason;
      }
      //console.warn(`[WARN] reasonが見つからない: currentId = ${currentId}`);
      //console.warn("usedPlayerInfo:", usedPlayerInfo);
      //console.warn("battingOrder:", battingOrder);
    }
  }

  const isChanged = currentId !== initialId;
  const isSub = reason === "代打" || reason === "臨時代走" || reason === "代走";

  // ★ 追加：リエントリー青枠フラグ（handleDropでセットしたIDを参照）
// 絶対条件のみで青枠にする
const isReentryBlue = player ? alwaysReentryIds.has(player.id) : false;

const canDropHere =
  pos !== "指" || dhEnabledAtStart || dhDisableDirty || !!player;

  return (
    <div
      key={pos}
      
      onDragEnter={() => setHoverPos(pos)}
      onDragLeave={() => setHoverPos((v) => (v === pos ? null : v))}
      onDragOver={(e) => {
        if (canDropHere) e.preventDefault();
      }}
      onDrop={(e) => {
        if (canDropHere) {
          console.log("🪂 onDrop→handleDrop 呼び出し", { pos });
          handleDrop(pos, e);
        } else {
          console.log("🪂 onDrop ブロック（DH禁止状態）", { pos, dhEnabledAtStart, dhDisableDirty });
        }
        setHoverPos(null);
      }}

      // ★ 外側は位置決め専用：bg/ring/shadow は付けない（内側で見せる）
      className="absolute whitespace-nowrap text-center cursor-move"
      style={{
        ...positionStyles[pos],
        transform: "translate(-50%, -50%)",
        zIndex: 10,
        minWidth: "64px",
      }}
    >
      {player ? (
        // ★ 内側チップに見た目を集約（青＞黄の優先でリング）
        <div
          draggable
          onDragStart={(e) => handlePositionDragStart(e, pos)}
          className={`text-base md:text-lg font-bold rounded px-2 py-1 leading-tight text-white ${
            draggingFrom === pos ? "bg-black/80" : "bg-black/80"
          } whitespace-nowrap
${(isReentryBlue) 
  ? "ring-2 ring-inset ring-blue-400"
  : (isSub || isChanged)
    ? "ring-2 ring-inset ring-yellow-400"
    : (hoverPos === pos)
      ? "ring-2 ring-inset ring-emerald-400"
      : ""}
`
          }
          style={{ minWidth: "78px", maxWidth: "38vw", touchAction: "none" }}
          title={`${player.lastName ?? ""}${player.firstName ?? ""} #${player.number ?? ""}`}
        >
          {player.lastName ?? ""}{player.firstName ?? ""} #{player.number}
        </div>
      ) : (
        <span className="text-gray-300 text-base inline-block" style={{ minWidth: "64px" }}>
          DHなし
        </span>
      )}
    </div>
  );
})}

        </div>

        {/* 控え選手（スマホっぽい見出しとタグ） */}
        <div className="mb-4">
          <div className="flex items-center mb-2">
            <h2 className="text-lg font-bold text-slate-900">控え選手</h2>
            <span className="ml-2 text-amber-600 text-sm inline-flex items-center whitespace-nowrap">
              ⚠️ 交代する選手にドロップ
            </span>
          </div>

          <div
            className="flex flex-col gap-2 mb-6"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleDrop(BENCH, e)}
          >
            {/* 未出場の控え */}
            {benchNeverPlayed.length === 0 ? (
              <div className="text-xs text-gray-400 mb-1">（なし）</div>
            ) : (
              <div className="flex flex-wrap gap-2 mb-2">
                {benchNeverPlayed.map((p) => (
                  <div
                    key={`bench-${p.id}`}
                    style={{ touchAction: "none" }}
                    draggable
                    onDragStart={(e) => handleBenchDragStart(e, p.id)}
                    className="px-3 py-1.5 text-sm bg-slate-100 hover:bg-slate-200 rounded-xl cursor-move select-none transition active:scale-[0.98]"
                  >
                    {formatPlayerLabel(p)}
                  </div>
                ))}
              </div>
            )}

            {/* 出場済み（いまはベンチ） */}
            <div className="text-xs font-semibold text-slate-600 mt-1">出場済み選手</div>
            {benchPlayedOut.length === 0 ? (
              <div className="text-xs text-gray-400">（なし）</div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {benchPlayedOut.map((p) => (
                  <div
                    key={`played-${p.id}`}
                    style={{ touchAction: "none" }}
                    draggable
                    onDragStart={(e) => handleBenchDragStart(e, p.id)}
                    className="px-3 py-1.5 text-sm bg-slate-50 text-slate-600 border border-slate-200 rounded-xl cursor-move select-none transition active:scale-[0.98]"
                    title="一度出場済みの選手"
                  >
                    {formatPlayerLabel(p)}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 2カラム（スマホでは縦積み） */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 打順一覧 */}
          <div className="flex-1">
            <h2 className="text-lg font-bold mb-2 text-slate-900">打順（1番〜9番）</h2>
            <ul className="space-y-1 text-sm border border-slate-200 rounded-xl bg-white p-2">
              {battingOrder.map((entry, index) => {
                const displayId = battingReplacements[index]?.id ?? entry.id;

                const starter = teamPlayers.find(p => p.id === entry.id);
                const player  = teamPlayers.find(p => p.id === displayId);
                if (!starter || !player) return null;

                const currentPos = getPositionName(assignments, displayId);
                const initialPos = getPositionName(initialAssignments, entry.id);

                const playerChanged   = displayId !== entry.id;
                const positionChanged = currentPos !== initialPos;

                const isPinchHitter = entry.reason === "代打";
                const isPinchRunner = entry.reason === "代走";
                const isPinch = isPinchHitter || isPinchRunner;
                const pinchLabel = isPinchHitter ? "代打" : isPinchRunner ? "代走" : "";

                return (
                  <li key={`${index}-${displayId}`} className="border border-slate-200 px-2 py-1 rounded bg-white">
                    <div className="flex items-start gap-2">
                      <span className="w-10 shrink-0 text-center">{index + 1}番</span>
                      <div className="min-w-0">
                        {isPinch && playerChanged ? (
                          <>
                            <div className="line-through text-gray-500 text-xs">
                              {pinchLabel} {starter.lastName}{starter.firstName} #{starter.number}
                            </div>
                            <div className="text-rose-600 font-bold">
                              {currentPos}　{player.lastName}{player.firstName} #{player.number}
                            </div>
                          </>
                        ) : isPinch ? (
                          <>
                            <div>
                              <span className="line-through">{pinchLabel}</span>&nbsp;
                              {starter.lastName}{starter.firstName} #{starter.number}
                            </div>
                            <div className="pl-0 text-rose-600 font-bold">
                              {currentPos}
                            </div>
                          </>
                        ) : playerChanged ? (
                          <>
                            <div className="line-through text-gray-500 text-xs">
                              {initialPos}　{starter.lastName}{starter.firstName} #{starter.number}
                            </div>
                            <div className="text-rose-600 font-bold">
                              {currentPos}　{player.lastName}{player.firstName} #{player.number}
                            </div>
                          </>
                        ) : positionChanged ? (
                          (() => {
                            const dhActive = !!assignments["指"];
                            const isOnlyDefSwap =
                              dhActive &&
                              ((initialPos === "捕" && currentPos === "投") ||
                               (initialPos === "投" && currentPos === "捕"));

                            if (isOnlyDefSwap) {
                              return (
                                <>
                                  <div>{initialPos}　{starter.lastName}{starter.firstName} #{starter.number}</div>
                                  <div className="text-rose-600 font-bold">{currentPos}</div>
                                </>
                              );
                            }

                            return (
                              <>
                                <div className="line-through text-gray-500 text-xs">{initialPos}</div>
                                <div>
                                  <span className="text-rose-600 font-bold">{currentPos}</span>　{starter.lastName}{starter.firstName} #{starter.number}
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          <div>{currentPos}　{starter.lastName}{starter.firstName} #{starter.number}</div>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}

              {(() => {
                // DHが使われていなければ出さない
                const dhActive = !!assignments["指"];
                if (!dhActive) return null;

                // 先発投手
                const starterPitcherId =
                  typeof initialAssignments?.["投"] === "number"
                    ? (initialAssignments["投"] as number)
                    : null;
                if (!starterPitcherId) return null;

                // 先発投手が打順に含まれているときは出さない（DH時のみ表示）
                const inBatting = battingOrder.some((e) => e.id === starterPitcherId);
                if (inBatting) return null;

                // 現在の投手
                const currentPitcherId =
                  typeof assignments?.["投"] === "number" ? (assignments["投"] as number) : null;

                const oldP = teamPlayers.find((p) => p.id === starterPitcherId);
                const newP = currentPitcherId
                  ? teamPlayers.find((p) => p.id === currentPitcherId)
                  : undefined;
                if (!oldP) return null;

                const replaced = !!newP && currentPitcherId !== starterPitcherId;

                return (
                  <li key="pitcher-under-9" className="border border-slate-200 px-2 py-1 rounded bg-white">
                    <div className="flex items-start gap-2">
                      <span className="w-10 shrink-0" />
                      <div className="min-w-0">
                        {replaced ? (
                          (() => {
                            const oldPosNow =
                              Object.entries(assignments).find(([k, v]) => v === oldP?.id)?.[0] ?? "投";
                            const isSwapWithFielder = oldPosNow !== "投";

                            if (!oldP) return null;

                            if (isSwapWithFielder) {
                              return (
                                <>
                                  <div>
                                    投　{oldP.lastName}{oldP.firstName} #{oldP.number}
                                  </div>
                                  <div className="text-rose-600 font-bold">{oldPosNow}</div>
                                </>
                              );
                            }

                            if (!newP) {
                              return (
                                <div>
                                  投　{oldP.lastName}{oldP.firstName} #{oldP.number}
                                </div>
                              );
                            }
                            return (
                              <>
                                <div className="line-through text-gray-500 text-xs">
                                  投　{oldP.lastName}{oldP.firstName} #{oldP.number}
                                </div>
                                <div className="text-rose-600 font-bold">
                                  投　{newP.lastName}{newP.firstName} #{newP.number}
                                </div>
                              </>
                            );
                          })()
                        ) : (
                          (() => {
                            if (!oldP) return null;
                            const posSym =
                              Object.entries(assignments).find(([k, v]) => v === oldP.id)?.[0] ?? "投";
                            return (
                              <div>
                                {posSym}　{oldP.lastName}{oldP.firstName} #{oldP.number}
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  </li>
                );
              })()}

            </ul>
          </div>

          {/* 交代内容（右） */}
          <div className="w-full">
            <h2 className="text-lg font-bold mb-2 text-slate-900">交代内容</h2>
            <ul className="text-sm border border-slate-200 p-3 rounded-xl bg-white space-y-1">
              {(() => {
                const posPriority = { "投": 1, "捕": 2, "一": 3, "二": 4, "三": 5, "遊": 6, "左": 7, "中": 8, "右": 9 };

                const changes = battingOrder.map((entry, index) => {
                  const starter = teamPlayers.find((p) => p.id === entry.id);
                  if (!starter) return null;

                  let replaced = battingReplacements[index] ?? teamPlayers.find(p => p.id === entry.id);
                  const currentId = replaced?.id ?? entry.id;
                  const currentPlayer = replaced ?? starter;

                  const currentPos = getPositionName(assignments, currentId);
                  const initialPos = getPositionName(initialAssignments, entry.id);

                  const playerChanged = replaced && replaced.id !== entry.id;
                  const positionChanged = currentPos !== initialPos;
                  const isPinchHitter = entry.reason === "代打";
                  const isPinchRunner = entry.reason === "代走";
                  const isPinch = isPinchHitter || isPinchRunner;

                  if (isPinchHitter && replaced && !Object.values(assignments).includes(replaced.id)) {
                    return {
                      key: `pinch-${index}`,
                      type: 1,
                      pos: "",
                      jsx: (
                        <li key={`pinch-${index}`}>
                          代打 ➡ {replaced.lastName}{replaced.firstName} #{replaced.number}
                        </li>
                      )
                    };
                  }

                  if (isPinchHitter && playerChanged && currentPos) {
                    const pinchPlayer = teamPlayers.find(p => p.id === entry.id);
                    const replacedPlayer = replaced;

                    return {
                      key: `pinch-replaced-${index}`,
                      type: 1,
                      pos: currentPos,
                      jsx: (
                        <li key={`pinch-replaced-${index}`}>
                          代打：{pinchPlayer?.lastName}{pinchPlayer?.firstName} #{pinchPlayer?.number} ➡ {withFull(currentPos)}：{replacedPlayer.lastName}{replacedPlayer.firstName} #{replacedPlayer.number}
                        </li>
                      )
                    };
                  }

                  if (isPinchHitter && currentPos) {
                    if (!replaced) {
                      replaced = teamPlayers.find(p => p.id === entry.id);
                    }
                    return {
                      key: `pinch-assigned-${index}`,
                      type: 1,
                      pos: currentPos,
                      jsx: (
                        <li key={`pinch-assigned-${index}`}>
                          代打：{replaced.lastName}{replaced.firstName} #{replaced.number} ➡ {withFull(currentPos)}
                        </li>
                      )
                    };
                  }

                  if (isPinchRunner && replaced && currentPos) {
                    // 左：代走で入っていた選手（例：伊藤 #11）
                    const pinchRunner = teamPlayers.find(p => p.id === entry.id);
                    // 右：今回その守備に入る選手（控え or 本人）
                    const replacedPlayer = replaced;

                    // ★ 同一人物なら右側は“守備位置のみ”
                    const isSame = pinchRunner?.id === replacedPlayer?.id;

                    return {
                      key: `runner-${index}`,
                      type: 2,
                      pos: currentPos,
                      jsx: (
                        <li key={`runner-${index}`}>
                          代走：{pinchRunner?.lastName}{pinchRunner?.firstName} #{pinchRunner?.number}
                          {" "}➡ {withFull(currentPos)}
                          {!isSame && (
                            <>：{replacedPlayer.lastName}{replacedPlayer.firstName} #{replacedPlayer.number}</>
                          )}
                        </li>
                      ),
                    };
                  }



                  if (playerChanged) {
                    return {
                      key: `replaced-${index}`,
                      type: 3,
                      pos: currentPos,
                      jsx: (
                        <li key={`replaced-${index}`}>
                          {withFull(initialPos)}：{starter.lastName}{starter.firstName} #{starter.number} ➡ {withFull(currentPos)}：
                          {currentPlayer.lastName}{currentPlayer.firstName} #{currentPlayer.number}
                        </li>
                      )
                    };
                  }

                  if (positionChanged) {
                    return {
                      key: `shift-${index}`,
                      type: 4,
                      pos: currentPos,
                      jsx: (
                        <li key={`shift-${index}`}>
                          {withFull(initialPos)}：{starter.lastName}{starter.firstName} #{starter.number} ➡ {withFull(currentPos)}
                        </li>
                      )
                    };
                  }

                  return null;
                }).filter(Boolean) as { key: string; type: number; pos: string; jsx: JSX.Element }[];

                // --- 追加: DHありで打順に投手が居ないケースでも投手交代を表示する ---
                // --- 追加: 先発投手が「投」以外の守備に就いている場合も1行出す ---
                (() => {
                  const initP = initialAssignments?.["投"];
                  if (typeof initP !== "number") return;

                  const nowPos =
                    Object.entries(assignments).find(([pos, id]) => id === initP)?.[0];

                  if (
                    nowPos &&
                    nowPos !== "投" &&
                    !changes.some(c => c.type === 4 && c.pos === nowPos) && // 既に同じshiftがある？
                    !changes.some(c => c.type === 2 && c.pos === nowPos)   // ★そのポジションに代走行があるなら抑止
                  ) {
                    const from = teamPlayers.find((p) => p.id === initP);
                    if (from) {
                      changes.push({
                        key: "pitcher-shift-extra",
                        type: 4,
                        pos: nowPos,
                        jsx: (
                          <li key="pitcher-shift-extra">
                            {withFull("投")}：{from.lastName}{from.firstName} #{from.number}
                            {" "}➡ {withFull(nowPos)}
                          </li>
                        ),
                      });
                    }
                  }
                })();

                (() => {
                  const initP = initialAssignments?.["投"];
                  const curP  = assignments?.["投"];

                  if (
                    typeof initP === "number" &&
                    typeof curP === "number" &&
                    initP !== curP &&
                    !changes.some(c => c.pos === "投")
                  ) {
                    const from = teamPlayers.find(p => p.id === initP);
                    const to   = teamPlayers.find(p => p.id === curP);
                    if (from && to) {
                      changes.push({
                        key: "pitcher-change-extra",
                        type: 3,
                        pos: "投",
                        jsx: (
                          <li key="pitcher-change-extra">
                            {withFull("投")}：{from.lastName}{from.firstName} #{from.number}
                            {" "}➡ {withFull("投")}：{to.lastName}{to.firstName} #{to.number}
                          </li>
                        ),
                      });
                    }
                  }
                })();

                // 優先順位に従ってソート
                changes.sort((a, b) => {
                  if (a.type !== b.type) return a.type - b.type;
                  const ap = posPriority[a.pos] ?? 99;
                  const bp = posPriority[b.pos] ?? 99;
                  return ap - bp;
                });

                return changes.map(c => c.jsx);
              })()}
            </ul>
          </div>
        </div>
      </div>
    </div>

{/* ↓ フッターに隠れないための底上げスペーサー（モバイルのみ） ↓ */}
<div className="md:hidden h-[calc(env(safe-area-inset-bottom)+72px)]" aria-hidden />

{/* スマホ風のフッターアクション（小画面で固定） */}
<div className="fixed inset-x-0 bottom-0 z-40 md:static md:mt-4">
  <div className="mx-auto max-w-4xl">
    <div className="bg-white/90 backdrop-blur supports-[backdrop-filter]:bg-white/70 border-t md:border-none shadow-[0_-8px_24px_rgba(0,0,0,.07)] px-4 py-3">
      
      {/* 上段：4つの操作ボタンを 2:2:4:2 で横並び */}
      <div className="grid grid-cols-10 gap-2 items-center">
        <button
          onClick={handleUndo}
          disabled={!history.length}
          className={`col-span-2 px-4 py-2 rounded-xl bg-slate-700 text-white active:scale-[0.98] transition ${history.length ? "" : "opacity-50 cursor-not-allowed"}`}
          title="Undo"
        >
          ↻
        </button>

        <button
          onClick={handleRedo}
          disabled={!redo.length}
          className={`col-span-2 px-4 py-2 rounded-xl bg-slate-700 text-white active:scale-[0.98] transition ${redo.length ? "" : "opacity-50 cursor-not-allowed"}`}
          title="Redo"
        >
          ↺
        </button>
<button
  onClick={confirmChange}
  className={`${hasDH ? "col-span-4" : "col-span-6"} px-5 py-2 rounded-xl
              bg-emerald-600 hover:bg-emerald-700 text-white shadow-md
              shadow-emerald-300/40 active:scale-[0.98] transition`}
>
  交代確定
</button>

{hasDH && (
  <button
    type="button"
    onClick={handleDisableDH}
    className="col-span-2 h-12 rounded-xl bg-slate-800 text-white
               inline-flex flex-col items-center justify-center
               active:scale-[0.98] transition"
    title="DH解除"
  >
    <span className="block leading-tight">DH</span>
    <span className="block leading-tight">解除</span>
  </button>
)}


      </div>

      {/* 下段：🎤表示ボタン（横いっぱい） */}
<div className="grid grid-cols-10 gap-2 my-4 w-full">
  {/* アナウンス表示：6/10 */}
  <button
    onClick={showAnnouncement}
    className="col-span-6 py-3 bg-rose-500 text-white rounded shadow hover:bg-rose-600 font-semibold"
  >
    🎤 アナウンス表示
  </button>

  {/* 戻る：4/10 */}
  <button
     onClick={handleBackClick}
    className="col-span-4 py-3 bg-gray-500 text-white rounded shadow hover:bg-gray-600 font-semibold"
  >
    ⬅️ 戻る
  </button>
</div>


    </div>
  </div>
</div>



{/* 🎤 アナウンス表示モーダル（常に中央表示） */}
{showSaveModal && (
  <div className="fixed inset-0 z-50">
    <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
    <div className="absolute inset-0 flex items-center justify-center p-4 overflow-hidden">
      <div
        className="
          bg-white shadow-2xl
          rounded-2xl
          w-full md:max-w-md
          max-h-[85vh]
          overflow-hidden flex flex-col
        "
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* ヘッダー */}
        <div className="sticky top-0 z-10 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
          <div className="h-5 flex items-center justify-center">
            <span className="mt-2 block h-1.5 w-12 rounded-full bg-white/60" />
          </div>
          <div className="px-4 py-3 flex items-center justify-between">
            <h3 className="text-lg font-extrabold tracking-wide flex items-center gap-2">
              <img src="/mic-red.png" alt="mic" className="w-6 h-6" />
              交代アナウンス
            </h3>
            <button
              onClick={() => { setShowSaveModal(false); navigate(-1); }}
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
        <div className="px-4 py-3 overflow-y-auto flex-1">
          {announcementText && (
            <div className="px-4 py-3 border border-red-500 bg-red-200 text-red-700 rounded-xl">
              <div
                ref={modalTextRef}
                className="text-rose-600 text-lg font-bold whitespace-pre-wrap"
                dangerouslySetInnerHTML={{ __html: announcementText }}
              />

              {/* 🔴 ボタンを赤枠内に配置 */}
              <div className="flex gap-4 mt-4 w-full">
                <button
                  onClick={speakVisibleAnnouncement}
                  className="flex-1 flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 rounded-xl shadow"
                >
                  {/* マイクアイコン */}    
                   <IconMic /> 読み上げ
                </button>

                <button
                  onClick={stopSpeaking}
                  className="flex-1 bg-red-600 hover:bg-red-700 text-white font-semibold py-2 rounded-xl shadow"
                >
                  停止
                </button>
              </div>
            </div>
          )}
        </div>

        {/* フッター：閉じるだけ残す */}
        <div className="px-4 pb-4">
          <button
            className="mt-3 w-full px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-md active:scale-[0.98] transition"
            onClick={() => {
              setShowSaveModal(false);
              navigate(-1);
            }}
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{/* 確認モーダル */}
{showLeaveConfirm && (
  <div
    className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    aria-labelledby="leave-confirm-title"
    onClick={() => setShowLeaveConfirm(false)} // 背景タップで閉じる
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      {/* ヘッダー：緑帯 */}
      <div className="bg-green-600 text-white text-center font-bold py-3">
        <h3 id="leave-confirm-title" className="text-base">確認</h3>
      </div>

      {/* 本文：くっきり太字 */}
      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold leading-relaxed">
          変更した内容を保存していませんが{"\n"}
          よろしいですか？
        </p>
      </div>

      {/* フッター：NO/YES を1行で半分ずつ・横いっぱい */}
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
            onClick={() => setShowLeaveConfirm(false)} // NO：残る
          >
            NO
          </button>
          <button
            className="col-span-1 py-3 font-semibold bg-green-600 text-white rounded-br-2xl hover:bg-green-700"
            onClick={() => {
              setShowLeaveConfirm(false);
              handleBackToDefense();
            }}

          >
            YES
          </button>

        </div>
      </div>
    </div>
  </div>
)}



  </div>
);

};


const isTouchDevice = () => typeof window !== "undefined" && "ontouchstart" in window;
const DefenseChangeWrapped: React.FC<DefenseChangeProps> = (props) => {
  return (
    <DndProvider
      backend={isTouchDevice() ? TouchBackend : HTML5Backend}
      options={isTouchDevice() ? {
        enableTouchEvents: true,
        enableMouseEvents: true,
        touchSlop: 10,
        delayTouchStart: 0,   // ★ 追加：長押し時間を短く
      } : undefined}
    >
      <DefenseChange {...props} />
    </DndProvider>

  );
};

export default DefenseChangeWrapped;