import React, { useEffect, useMemo, useRef, useState } from "react";
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useDrag } from "react-dnd";

import localForage from "localforage";
import { useNavigate } from "react-router-dom";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";

/**
 * 守備交代（DefenseChange）画面
 * - 画面デザイン／機能を変えずに、コードの区分け・命名・コメント整理を行った版です。
 * - コメントは日本語で統一しています（変数名などの英字はそのまま使用）。
 */


const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

// 既存の import 群のすぐ下あたりに追記
// HTML要素からテキストを抽出、<ruby>タグは rt（ふりがな）優先で読む
// ─────────────────────────────────────────────
// 文字列（読み上げ用）ユーティリティ
// ─────────────────────────────────────────────

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



const getPlayerById = (players: Player[], id: number | null): Player | undefined => {
  if (id == null) return undefined;
  return players.find((p) => p.id === id);
};


// ─────────────────────────────────────────────
// 型定義
// ─────────────────────────────────────────────

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

// ─────────────────────────────────────────────
// 交代情報（usedPlayerInfo）解析ユーティリティ
// ─────────────────────────────────────────────

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
  used: Record<number, any>
): number => {
  const first = used[startId];

  if (!first || typeof first.subId !== "number") {
    return startId;
  }

  let cur = first.subId;
  const seen = new Set<number>([startId]);

  while (
    typeof cur === "number" &&
    !seen.has(cur)
  ) {
    const info = used[cur];

    // 次ノードが無い
    if (!info || typeof info.subId !== "number") break;

    // すでにリエントリー済みの古い履歴は、ここで chain を止める
    if (info.hasReentered) break;

    // 現在有効な「代打/代走/臨時代走」の連鎖だけ追う
    const reason = String(info.reason ?? "").trim();
    const isActivePinch =
      reason === "代打" || reason === "代走" || reason === "臨時代走";

    if (!isActivePinch) break;

    seen.add(cur);
    cur = info.subId;
  }

  return cur;
};

const findLatestRunnerEntryForPlayer = (
  playerId: number,
  used: Record<number, any>
) => {
  if (!playerId || !used) return null;

  const hit = Object.entries(used).find(([_, info]) => {
    return (
      Number(info?.subId) === Number(playerId) &&
      (info?.reason === "代走" || info?.reason === "臨時代走")
    );
  });

  if (!hit) return null;

  const [fromIdStr, info] = hit;
  return {
    fromId: Number(fromIdStr),
    ...info,
  };
};

/* ===== 氏名＆敬称ヘルパー ===== */
const ruby = (kanji?: string, kana?: string): string =>
  kana ? `<ruby>${kanji}<rt>${kana}</rt></ruby>` : kanji ?? "";

/* 姓・名それぞれのルビ：部分Playerでも roster から補完 */
const resolvePlayer = (p: Player): Player => {
  const roster: Player[] | undefined = (window as any).__teamPlayers;
  const base = roster?.find(tp => Number(tp.id) === Number(p.id));
  if (!base) return p;

  const pick = (v: any, fallback: any) => {
    const s = typeof v === "string" ? v.trim() : v;
    return s ? v : fallback; // "" や "   " も欠け扱い
  };

  return {
    ...base,
    ...p,
    lastName: pick(p.lastName, base.lastName),
    firstName: pick(p.firstName, base.firstName),
    lastNameKana: pick(p.lastNameKana, base.lastNameKana),
    firstNameKana: pick(p.firstNameKana, base.firstNameKana),
  };
};

const lastRuby = (p: Player): string => {
  const q = resolvePlayer(p);
  return ruby(q.lastName, q.lastNameKana);
};

const firstRuby = (p: Player): string => {
  const q = resolvePlayer(p);
  return ruby(q.firstName, q.firstNameKana);
};

const honor = (p: Player): string => {
  const q = resolvePlayer(p);
  return q.isFemale ? "さん" : "くん";
};

// 同一姓（この選手の姓が重複対象か？）
const isDupLast = (p?: Player) => {
  if (!p) return false;
  const q = typeof resolvePlayer === "function" ? resolvePlayer(p) : p;
  const ln = String(q.lastName ?? "").trim();
  const set: Set<string> | undefined = (window as any).__dupLastNames;
  return !!set && !!ln && set.has(ln);
};

// 画面/本文共通：重複姓の選手だけ「姓+名」、それ以外は「姓のみ」
const nameRuby = (p: Player): string =>
  isDupLast(p) ? `${lastRuby(p)}${firstRuby(p)}` : lastRuby(p);

// 常にフル（姓+名）
const fullName = (p: Player): string => `${lastRuby(p)}${firstRuby(p)}`;

// 本文用：重複姓の選手だけフル + 敬称
const nameWithHonor = (p: Player): string => `${nameRuby(p)}${honor(p)}`;


/** 常にフル＋敬称（控えが入る側など） */
const fullNameWithHonor = (p: Player): string => `${fullName(p)}${honor(p)}`;

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
  usedPlayerInfo: Record<string, any>,
  ohtaniRule: boolean,              // ← 追加
  reentryPreviewIds: Set<number> = new Set(),   // ★ 追加
  reentryFixedIds:   Set<number> = new Set()    // ★ 追加
): string => {

 (window as any).__teamPlayers = teamPlayers;
   // ★ 追加：UIが青（プレビュー/確定）なら確定前でも「リエントリーで …」
    const isReentryBlue = (pid: number) =>
  reentryPreviewIds.has(pid) || reentryFixedIds.has(pid);

  /* ---------- 前処理 ---------- */
  const backNoSuffix = (p?: { number?: string | number }) => {
    const no = String((p as any)?.number ?? "").trim();
    return no ? ` 背番号 ${no}` : "";
  };

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
  // 1) fromの打順（1始まり）
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
// ✅ 追加：代打/代走本人がそのまま同守備に入ったケース
if (currentId === latestPinchId) {
  const hasAnyDup = (() => {
    const set: Set<string> | undefined = (window as any).__dupLastNames;
    return !!set && set.size > 0;
  })();

  const pinchName = hasAnyDup
    ? fullNameWithHonor(latestPinchPlayer)
    : nameWithHonor(latestPinchPlayer);

  result.push(
    `先ほど${reasonText}${pinchName}がそのまま入り${posJP[posSym]}、`
  );

  // 打順行もこの選手本人で出す
  const pinchOrderIdx = battingOrder.findIndex(e => e.id === latestPinchId);
  if (pinchOrderIdx >= 0) {
    const lineupOrder = pinchOrderIdx + 1;
    const text = `${lineupOrder}番 ${posJP[posSym]} ${fullNameWithHonor(latestPinchPlayer)}${backNoSuffix(latestPinchPlayer)}`;

    if (!lineupLines.some(l => l.order === lineupOrder && l.text.includes(posJP[posSym]))) {
      lineupLines.push({ order: lineupOrder, text });
    }
  }

  handledPlayerIds.add(latestPinchPlayer.id);
  handledPositions.add(posSym);
  suppressTailClose = true;
  return;
}

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
const hasDupLast = (() => {
  const set: Set<string> | undefined = (window as any).__dupLastNames;
  return !!set && set.size > 0; // 同一姓が1組でもいれば true
})();

const pinchName = hasDupLast
  ? fullNameWithHonor(latestPinchPlayer)
  : nameWithHonor(latestPinchPlayer);

if (isJustNowPinch) {
  // 直後だけ「先ほど…」
  result.push(
    `先ほど${reasonText}${pinchName}に代わりまして、` +
    `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
  );
} else {
  // 確定後は「指名打者の◯◯くんに代わりまして、」
  result.push(
    `${posJP[posSym]}の ${pinchName}に代わりまして、` +
    `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
  );
}


// ★ 打順は「代打/代走で入っていた打順枠（latestPinchId）」を使う
const pinchOrderIdx = battingOrder.findIndex(e => e.id === latestPinchId);
if (pinchOrderIdx >= 0) {
  const lineupOrder = pinchOrderIdx + 1;

  const text = `${lineupOrder}番 ${posJP[posSym]} ${fullNameWithHonor(subPlayer)}${backNoSuffix(subPlayer)}`;


  if (!lineupLines.some(l => l.order === lineupOrder && l.text.includes(posJP[posSym]))) {
    lineupLines.push({ order: lineupOrder, text });
  }
}



  // ヘッダー抑止＆通常処理に回さない
  //スキップHeader = true;
  handledPlayerIds.add(subPlayer.id);
  handledPositions.add(posSym);
});

  const skipShiftPairs = new Set<string>();


  let suppressTailClose = false; // 🆕 このターンは末尾に「に入ります。」を付けない
  // 🆕 リエントリー + 守備変更（ユーザー希望フォーマット）
Object.entries(usedPlayerInfo || {}).forEach(([origIdStr, info]) => {
  if (!info || (info.reason !== "代打" && info.reason !== "代走" && info.reason !== "臨時代走")) return;

  const origId = Number(origIdStr);          // B（元スタメン）

  // ✅ 元スタメンBが「今も守備にいる」時だけ、このリエントリー系ブロックを有効にする
  const bIsOnField = Object.values(assignments || {}).some(
    (id) => Number(id) === Number(origId)
  );
  if (!bIsOnField) {
    // すでに今回の交代で外れているので、古いリエントリー文は出さない
    return;
  }

  // ★ Bが“今”入っている守備（略号）を探す（同守備/別守備の両対応）
  const posNowSym = Object.entries(assignments).find(([k, v]) => v === origId)?.[0];
  if (!posNowSym) return; // Bがフィールドに居ない → リエントリー未成立

  const B = teamPlayers.find(p => p.id === origId);
  const A = teamPlayers.find(p => p.id === info.subId);
  if (!A || !B) return;

  const posFull = posJP[posNowSym as keyof typeof posJP];
  const reasonText = info.reason === "代走" ? "代走" : "代打";
const fromSym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos;

if (
  (info.reason === "代走" || info.reason === "臨時代走") &&
  posNowSym === fromSym &&
  Number(origId) === Number((assignments as any)[posNowSym])
) {
  const phrase =
    info.reason === "臨時代走" ? "臨時代走" : "代走いたしました";

  // A = 加藤（戻った選手）
  // B = 奥村（代走されていた選手）

  result.push(
    `先ほど${phrase}${nameWithHonor(A)}がそのまま入り${posFull}。`
  );

  const orderIdx = battingOrder.findIndex(
    e => Number(e.id) === Number(A.id)
  );

  if (
    orderIdx >= 0 &&
    !lineupLines.some(
      l =>
        l.order === orderIdx + 1 &&
        l.text.includes(posFull) &&
        l.text.includes(nameRuby(A))
    )
  ) {
    lineupLines.push({
      order: orderIdx + 1,
      text: `${orderIdx + 1}番 ${posFull} ${fullNameWithHonor(A)}${backNoSuffix(A)}`
    });
  }

  handledPlayerIds.add(A.id);
  handledPlayerIds.add(B.id);
  handledPositions.add(posNowSym);

  // ★ これ重要（余計な「ファーストの加藤くんがー、」を消す）
  skipShiftPairs.add(`${A.id}|${fromSym}|${posNowSym}`);

  suppressTailClose = true;

  console.log("[RUNNER-REENTRY->SAMEPOS] FIXED", {
    A: A.id,
    B: B.id,
  });

  return;
}

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

// ✅追加：このターンで「投（投手）」を一切触っていないのに、
// usedPlayerInfo 由来で「リエントリーでピッチャー」を作るのは誤りなので抑止する。
const hasPitcherOp =
  replace.some(r => r.pos === "投") ||
  mixed.some(m => m.fromPos === "投" || m.toPos === "投") ||
  shift.some(s => s.fromPos === "投" || s.toPos === "投");

// 先に fromSym2 を作る（この行を if の前に追加）
const fromSym2 = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos;

// 大谷ルールで「指」からの代打/代走なら、ここで return してはいけない（後段の特別処理に回す）
const isOhtaniDhPinch =
  ohtaniRule &&
  fromSym2 === "指" &&
  ["代打", "代走", "臨時代走"].includes(String(info.reason ?? ""));

if (posNowSym2 === "投" && !hasPitcherOp && !isOhtaniDhPinch) {
  console.log("[REENTRY-LINE] skip: no pitcher op in this action", {
    origId,
    subId: info.subId,
    reason: info.reason,
  });
  return;
}

  // ★ replace配列から「このポジでBが入ったとき、誰から代わったか」を拾う（最優先）
  const replacedRec = replace.find(r => r.pos === posNowSym2 && r.to.id === B2.id);
  const replaced = replacedRec?.from ?? null;

// ✅ 大谷ルールON：DHに代打を出しても「投手が守備から退いた」わけではない。
// このケースで出る「投手リエントリー」文は誤りなので、
// 「代打の選手がそのままDHに入る」文に置き換える。


const startedAsOhtani2 =
  typeof initialAssignments?.["投"] === "number" &&
  typeof initialAssignments?.["指"] === "number" &&
  Number(initialAssignments["投"]) === Number(initialAssignments["指"]);


const pitcherStillSame2 =
  startedAsOhtani2 &&
  Number(initialAssignments["投"]) === Number(origId) &&
  Number(assignments?.["投"]) === Number(origId);

// 「DH（指）に代打」かつ「投手はずっと同じ」かつ「投手ポジにreplaceが無い」＝守備退場してない
const isDhPinchWhilePitcherNeverLeft =
  pitcherStillSame2 &&
  posNowSym2 === "投";


if (isDhPinchWhilePitcherNeverLeft) {
  const dhFull2 = posJP["指"]; // 指名打者
  const pinch = A2;           // 代打で入った選手（A）


// ★ 現在DH(指)に入っている選手（= DHスターターの末端ID）
// 大谷ルール時は assignments["指"] が投手のまま残るケースがあるため、usedPlayerInfo から辿る
const dhStarterId2 =
  typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;

// ★優先順位：守備図の「指」(assignments["指"]) → それが投手のままなら usedPlayerInfo
const dhNowId = (() => {
  const direct =
    typeof assignments?.["指"] === "number" ? Number(assignments["指"]) : null;

  // 守備図で「指」に誰か置かれていて、かつそれが“スターター(=投手)”とは違うなら、それが現在DH
  if (direct != null && dhStarterId2 != null && direct !== dhStarterId2) return direct;

  // まだ「指」が投手のまま残る運用（=大谷ルール初期状態など）の場合は usedPlayerInfo を辿る
  if (dhStarterId2 != null) return resolveLatestSubId(dhStarterId2, usedPlayerInfo) ?? dhStarterId2;

  return null;
})();



  // ✅ (1) まだDHが「代打Aのまま」なら、「Aがそのまま指名打者」だけを出して終了
// ✅ (1) dhNowId が代打Aを指していても、Aが今「指」に居るとは限らない（他守備へ移動している場合がある）
if (dhNowId != null && dhNowId === pinch.id) {
  const reasonForDH =
    (reasonMap as any)?.[pinch.id] ??
    (pinchReasonById as any)?.[pinch.id] ??
    info.reason;

  // ★ 代打Aが現在いる守備位置（assignments上）を探す
  const pinchNowPosSym =
    Object.entries(assignments ?? {}).find(
      ([, id]) => Number(id) === Number(pinch.id)
    )?.[0] ?? undefined;

  // ✅ 代打Aが「指」以外に居るなら、「そのまま指名打者」は誤りなので守備位置で言う
  if (pinchNowPosSym && pinchNowPosSym !== "指") {
    const posLabel = posJP[pinchNowPosSym as keyof typeof posJP] ?? pinchNowPosSym;
    result.push(`${recentHead(reasonForDH)}${nameWithHonor(pinch)}が${posLabel}。`);

    handledPlayerIds.add(pinch.id);
    handledPositions.add(pinchNowPosSym);
    suppressTailClose = true;
    return;
  }

  // ✅ 代打Aが本当にDH（指）に居るときだけ従来文
  result.push(`${recentHead(reasonForDH)}${nameWithHonor(pinch)}がそのまま入り${dhFull2}。`);

  handledPlayerIds.add(pinch.id);
  handledPositions.add("指");
  suppressTailClose = true;
  return;
}


  // ✅ (2) DHがすでに別の控え（◎◎）に変わっているなら、
  //      これは「投手リエントリー」ではないので、この usedPlayerInfo 由来の投手文は一切出さない。
  //      （DHの交代文は後段の replace(pos:"指") が通常DHと同じ形で作ってくれる）
  return;
}



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

  // ✅ 大谷開始（投＝指）で DHに代走/代打が入った直後、投手は守備から退いていない。
// なので「リエントリーでピッチャー」は誤り → 「そのまま指名打者」だけ出してREENTRY-LINEを止める
if (pitcherStillSame2 && posNowSym2 === "投") {
  const hasPitcherOp =
    replace.some(r => r.pos === "投") ||
    mixed.some(m => m.fromPos === "投" || m.toPos === "投") ||
    shift.some(s => s.fromPos === "投" || s.toPos === "投");

  const dhFull2 = posJP["指"]; // 指名打者
  const dhStarterId2 =
    typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;

  const dhNowId = (() => {
    const direct = typeof assignments?.["指"] === "number" ? Number(assignments["指"]) : null;
    if (direct != null && dhStarterId2 != null && direct !== dhStarterId2) return direct;
    if (dhStarterId2 != null) return resolveLatestSubId(dhStarterId2, usedPlayerInfo) ?? dhStarterId2;
    return null;
  })();

// ✅ 投手操作が一切ないのに「投手リエントリー」を作ろうとしている場合は誤判定なので何も出さない
// ただし「大谷ルール + 指(=DH)から代打/代走」は、この後段で「そのまま指名打者」を出すので return しない
if (!hasPitcherOp) {
  const fromSym =
    info?.fromPos ? ((posNameToSymbol as any)[info.fromPos] ?? info.fromPos) : null;

  const isDhPinch =
    fromSym === "指" && ["代走", "臨時代走", "代打"].includes(String(refReason || ""));

  if (!isDhPinch) {
    if (dhNowId == null) return;            // DHが取れないなら、この投手リエントリーは採用しない
    if (refPlayer?.id !== dhNowId) return;  // DHが別の控えに変わっている → 投手リエントリー文は不要
  }
}


  // refPlayer が “いまDHにいる代走/代打本人” なら、「そのまま指名打者」だけ出して終了
  if (
    dhNowId != null &&
    refPlayer?.id === dhNowId &&
    ["代走", "臨時代走", "代打"].includes(String(refReason || ""))
  ) {
    result.push(`${recentHead(refReason)}${nameWithHonor(refPlayer)}がそのまま入り${dhFull2}。`);

    const dhIdx = battingOrder.findIndex(e => e.id === refPlayer!.id);
    if (dhIdx >= 0) {
      const order = dhIdx + 1;
      const text = `${order}番 ${dhFull2} ${nameWithHonor(refPlayer!)}`;
      if (!lineupLines.some(l => l.order === order && l.text.includes(dhFull2))) {
        lineupLines.push({ order, text });
      }
    }

    handledPlayerIds.add(refPlayer.id);
    handledPositions.add("指");
    suppressTailClose = true;
    return;
  }
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

  // ✅【追加】DH(指)に代走/臨時代走が入った直後に、なぜか「リエントリーでピッチャー」を作る誤判定を抑止
// refPlayer が “いま指(DH)” に居るなら、このREENTRY-LINE(ピッチャー)は出さない
const refNowPosSym =
  refPlayer?.id != null
    ? Object.entries(assignments ?? {}).find(([sym, id]) => id === refPlayer.id)?.[0]
    : undefined;

if (
  refNowPosSym === "指" &&
  (refReason === "代走" || refReason === "臨時代走") &&
  posFull2 === "ピッチャー"
) {
  // ここでは投手リエントリー文を出さない（DH側の文だけにする）
  const dhFull2 = posJP["指"]; // 指名打者

  // 本文（理想の1行）
  result.push(`${recentHead(refReason)}${nameWithHonor(refPlayer)}がそのまま入り${dhFull2}。`);

  // 打順行（理想の「9番 指名打者 ●●くん」）
  const dhIdx = battingOrder.findIndex(e => e.id === refPlayer!.id);
  if (dhIdx >= 0) {
    const order = dhIdx + 1;
    const text = `${order}番 ${dhFull2} ${nameWithHonor(refPlayer!)}`;
    if (!lineupLines.some(l => l.order === order && l.text.includes(dhFull2))) {
      lineupLines.push({ order, text });
    }
  }

  handledPlayerIds.add(refPlayer.id);
  handledPositions.add("指");
  suppressTailClose = true;
  return; // ✅ ここで firstLine を作らせない（= [REENTRY-LINE] ログも消える）
}

// ✅【追加】大谷開始（投＝指）で、DHに代走が入っただけのケースは
// 投手は守備から一度も退いていないので「リエントリーでピッチャー」を作らない
const pitcherStarterId =
  typeof initialAssignments?.["投"] === "number" ? Number(initialAssignments["投"]) : null;
const dhStarterId =
  typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;

const startedAsOhtani = pitcherStarterId != null && dhStarterId != null && pitcherStarterId === dhStarterId;

if (
  startedAsOhtani &&
  pitcherStillSame2 &&
  posFull2 === "ピッチャー" &&
  (refReason === "代走" || refReason === "臨時代走")
) {
  // ここでREENTRY-LINE自体を出さない（DH側の文だけ残す）
  return;
}
// ✅【追加】大谷開始（投＝指）でDHに代走/代打が入っただけなら
// 投手は守備から退いていないので「リエントリーでピッチャー」を出さず
// 「そのまま指名打者」だけを出してここで終了する
if (
  pitcherStillSame2 &&
  posNowSym2 === "投" &&
  (refReason === "代走" || refReason === "臨時代走" || refReason === "代打")
) {
  const dhFull2 = posJP["指"]; // 指名打者
  const dhStarterId2 =
    typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;

  // 守備図の「指」→それが投手のままなら usedPlayerInfo 末端を辿る
  const dhNowId = (() => {
    const direct =
      typeof assignments?.["指"] === "number" ? Number(assignments["指"]) : null;

    if (direct != null && dhStarterId2 != null && direct !== dhStarterId2) return direct;
    if (dhStarterId2 != null) return resolveLatestSubId(dhStarterId2, usedPlayerInfo) ?? dhStarterId2;
    return null;
  })();

  // いま「DHにいるのが refPlayer（代走本人）」なら、投手リエントリー文を抑止
  if (dhNowId != null && refPlayer?.id === dhNowId) {
    result.push(`${recentHead(refReason)}${nameWithHonor(refPlayer)}がそのまま入り${dhFull2}。`);

    // 打順行（DH）も出す
    const dhIdx = battingOrder.findIndex(e => e.id === refPlayer!.id);
    if (dhIdx >= 0) {
      const order = dhIdx + 1;
      const text = `${order}番 ${dhFull2} ${nameWithHonor(refPlayer!)}`;
      if (!lineupLines.some(l => l.order === order && l.text.includes(dhFull2))) {
        lineupLines.push({ order, text });
      }
    }

    handledPlayerIds.add(refPlayer.id);
    handledPositions.add("指");
    suppressTailClose = true;
    return; // ✅ ここでREENTRY-LINE（リエントリーでピッチャー）を作らせない
  }
}

// 直後でなければ「先ほど〜いたしました」を使わず、位置付きの通常形にする
const firstLine = useSimpleForm
  ? `${posFull2} ${nameWithHonor(refPlayer)}に代わりまして、` +
    `${nameWithHonor(B2)}がリエントリーで ${posFull2}に入ります。`
  : `先ほど${phrase}いたしました${nameWithHonor(refPlayer)}に代わりまして、` +
    `${nameWithHonor(B2)}がリエントリーで ${posFull2}に入ります。`;

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
    text: `${orderB}番 ${posFull2} ${fullNameWithHonor(B2)} 背番号 ${B2.number}`
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
      text: `${orderTo}番 ${posJP[mixedR.toPos]} ${fullNameWithHonor(mixedR.to)}${backNoSuffix(mixedR.to)}`,

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
    // ✅ 大谷開始（投＝指）の場合、「指→投」は同一選手の見かけ上の移動なので喋らない
    const isOhtaniStart =
      ohtaniRule &&
      typeof initialAssignments?.["投"] === "number" &&
      typeof initialAssignments?.["指"] === "number" &&
      Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

    const isPseudoDhToPitcherShift =
      isOhtaniStart &&
      move.fromPos === "指" &&
      move.toPos === "投" &&
      typeof initialAssignments?.["投"] === "number" &&
      Number(move.player.id) === Number(initialAssignments["投"]);

    if (!isPseudoDhToPitcherShift) {
      result.push(`${posFull}の${nameWithHonor(move.player)}が${posJP[move.toPos]}、`);
    }

    // 重複抑止は入れておく（後段で同じ shift を出さないため）
    skipShiftPairs.add(`${move.player.id}|${move.fromPos}|${move.toPos}`);
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

// ★ 守備位置を必ずシンボル化してから表示名に変換
const subInPosSym = (posNameToSymbol as any)[subInPos] ?? subInPos;
const movedFromPosSym = (posNameToSymbol as any)[movedFromPos] ?? movedFromPos;
const movedToPosSym = (posNameToSymbol as any)[movedToPos] ?? movedToPos;

const subInPosLabel = posJP[subInPosSym as keyof typeof posJP] ?? subInPos;
const movedFromPosLabel = posJP[movedFromPosSym as keyof typeof posJP] ?? movedFromPos;
const movedToPosLabel = posJP[movedToPosSym as keyof typeof posJP] ?? movedToPos;

// ✅ 文言を切り替える
const reasonText =
  entry.reason === "代打" ? "代打いたしました" : "代走いたしました";

// 1行目：控えが別守備に入る（★打順は書かない）
lines.push(
  `先ほど${reasonText}${nameWithHonor(pinch)}に代わりまして、` +
  `${fullNameWithHonor(subIn)}が入り${subInPosLabel}、`
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
  // 代走で入った選手が守備へ
  lines.push(`先ほど代走いたしました${nameWithHonor(movedPlayer)}が${movedToPosLabel}に入ります。`);
  console.log("[SPECIAL] 2nd-line as DAISO");
} else if (movedTrueReason === "代打") {
  // 代打で入った選手が守備へ
  lines.push(`先ほど代打いたしました${nameWithHonor(movedPlayer)}が${movedToPosLabel}に入ります。`);
  console.log("[SPECIAL] 2nd-line as DAIDA");
} else {
  // 通常シフト
  lines.push(`${movedFromPosLabel}の${nameWithHonor(movedPlayer)}が${movedToPosLabel}、`);
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
    txt: `${pinchOrderIdx + 1}番 ${posJP[subInPos]} ${fullNameWithHonor(subIn)}${backNoSuffix(subIn)}`,
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

// ★ 相互入れ替え判定用：代打/代走の「元いた守備」を subId -> 守備シンボル にして持つ
const pinchFromPosById = new Map<number, string>();
Object.values(usedPlayerInfo || {}).forEach((info: any) => {
  if (!info) return;
  if (["代打","代走","臨時代走"].includes(info.reason) && typeof info.subId === "number") {
    const sym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos; // "サード"→"三" 等
    pinchFromPosById.set(info.subId, sym);
  }
});

// ★ 現在守備（assignments）から、指定idがいる守備シンボルを引く
const curPosOf = (id: number) =>
  Object.entries(assignments).find(([k, v]) => v === id)?.[0] as keyof typeof posJP | undefined;

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

  // =====================================================
  // ① ここに「相互入れ替え（代打A⇄代打B）」判定を置く（先に判定）
  //    ※ originalId / movedToPos より前に実行する
  // =====================================================

  // A側
  const fromA = pinchFromPosById.get(entry.id);
  const toA   = pos; // entry.id は今 pos にいるのでこれでOK（既存コードの toA 計算より安全）

  // B探索：「fromB === toA」かつ「curPosB === fromA」
  const otherId = fromA
    ? [...pinchFromPosById.entries()]
        .find(([id, fromB]) => id !== entry.id && fromB === toA && curPosOf(id) === fromA)?.[0]
    : undefined;

  if (fromA && otherId) {
    const A = pinchPlayer;                         // A = entry.id
    const B = teamPlayers.find(p => p.id === otherId);
    if (!B) return;

    // 「先ほど代打/代走…」の文言
    const headById = (id: number) => {
      const r = pinchReasonById[id] || reasonMap[id] || "代打";
      return r === "代走" ? "代走いたしました" : r === "臨時代走" ? "臨時代走" : "代打いたしました";
    };

    const phraseA = headById(entry.id);
    const phraseB = headById(otherId);
    const prefixB = phraseA === phraseB ? "同じく先ほど" : "先ほど";

    result.push(
      `先ほど${phraseA}${nameWithHonor(A)}が${posJP[toA]}へ\n` +
      `${prefixB}${phraseB}${nameWithHonor(B)}が${posJP[fromA]}へ入ります。`
    );

    // 二重出力防止
    handledIds.add(entry.id);
    handledIds.add(otherId);
    handledPlayerIds.add(entry.id);
    handledPlayerIds.add(otherId);
    handledPositions.add(toA);
    handledPositions.add(fromA);

    // 打順行
    lineupLines.push({ order: idx + 1, text: `${idx + 1}番 ${posJP[toA]} ${nameWithHonor(A)}` });
    const bOrder = battingOrder.findIndex(e => e.id === otherId);
    if (bOrder >= 0) {
      lineupLines.push({ order: bOrder + 1, text: `${bOrder + 1}番 ${posJP[fromA]} ${nameWithHonor(B)}` });
    }

    return; // ← 相互入れ替えはここで完結
  }

  // =====================================================
  // ② 相互入れ替えでなかった場合だけ「元の先発がどこへ動いたか」処理へ
  // =====================================================

  const originalId = initialAssignments[pos];
  if (!originalId || originalId === entry.id) return;

  const movedPlayer = teamPlayers.find(p => p.id === originalId);
  if (!movedPlayer) return;

  const movedToPos = Object.entries(assignments)
    .find(([k, v]) => v === originalId)?.[0] as keyof typeof posJP;
  if (!movedToPos || movedToPos === pos) return;

  // （ここから下は既存の通常処理をそのまま）
  result.push(`先ほど${entry.reason}いたしました${nameWithHonor(pinchPlayer)}が${posJP[pos]}、`);
  // ...（以下略：既存コード継続）
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

    // ★ 変更：この選手の姓が重複しているか？
    const set: Set<string> | undefined = (window as any).__dupLastNames;
    const isDupLastName =
      !!set &&
      !!player.lastName &&
      set.has(String(player.lastName).trim());

    // last/first のルビ
    const lastRuby  = `<ruby>${player.lastName}<rt>${player.lastNameKana ?? ""}</rt></ruby>`;
    const firstRuby = `<ruby>${player.firstName ?? ""}<rt>${player.firstNameKana ?? ""}</rt></ruby>`;

    // ★ 重複している選手だけフル（姓＋名）、それ以外は姓のみ
    const nameRuby = isDupLastName ? `${lastRuby}${firstRuby}` : lastRuby;

    const ruby = `${nameRuby}${honor}`;



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
  //スキップHeader = true;
} else if (pinchTexts.length > 1) {
  result.push(pinchTexts.join("、\n"));
  //スキップHeader = true;
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
      // --- 前置き文（交代のみ / 交代＋シート変更）を切り替える ---

      // 大谷ルール時に発生する「投⇄指だけ」の shift はシート変更として数えない
      const isOhtaniDhOnlyShift =
        ohtaniRule &&
        shift.length > 0 &&
        shift.every(s =>
          (s.fromPos === "投" && s.toPos === "指") ||
          (s.fromPos === "指" && s.toPos === "投")
        );

      // 実質シート変更があるか？（mixed は確実にシート変更。shift も原則シート変更）
      const hasSeatChange =
        mixed.length > 0 ||
        (shift.length > 0 && !isOhtaniDhOnlyShift);

      // 前置き文を決定
      const head = hasSeatChange
        ? `${teamName}、選手の交代並びにシートの変更をお知らせいたします。`
        : `${teamName}、選手の交代をお知らせいたします。`;

      result.push(head);

    } else if (hasReplace) {
      result.push(`${teamName}、選手の交代をお知らせいたします。`);
    } else if (hasShift) {
      result.push(`${teamName}、シートの変更をお知らせいたします。`);
    }
  }
}



/* ---- 並べ替え：守備位置番号順に ---- */
const nextPosMap: Record<string, string> = { 二: "中", 中: "左", 左: "遊", 遊: "右" };

// shift を「守備位置の繋がり」優先で並べ替える
// 依存: Y.toPos === X.fromPos なら Y を先に読む（Y -> X）
const sortShiftByChain = (
  shift: Extract<ChangeRecord, { type: "shift" }>[]
) => {
  const n = shift.length;
  if (n <= 1) return shift;

  // tie-break 用（最終的に安定させる）
  const key = (s: any) => `${posIndex(s.fromPos)}_${posIndex(s.toPos)}_${s.player?.id ?? 0}`;

  // ノード index を作る
  const nodes = shift.map((s, i) => ({ s, i }));

  // 依存グラフ（producer -> consumer）
  const out: number[][] = Array.from({ length: n }, () => []);
  const indeg: number[] = Array.from({ length: n }, () => 0);

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const A = shift[i]; // producer候補
      const B = shift[j]; // consumer候補
      // A.toPos が B.fromPos を埋めるなら、A を先に読むべき
      if (A.toPos === B.fromPos) {
        out[i].push(j);
        indeg[j]++;
      }
    }
  }

  // Kahn（indeg=0 から）
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indeg[i] === 0) queue.push(i);

  // 安定化：queue は fromPos順などで整列して取り出す
  const sortQueue = () => queue.sort((a, b) => (key(shift[a]) < key(shift[b]) ? -1 : 1));

  const orderedIdx: number[] = [];
  while (queue.length) {
    sortQueue();
    const v = queue.shift()!;
    orderedIdx.push(v);
    for (const nx of out[v]) {
      indeg[nx]--;
      if (indeg[nx] === 0) queue.push(nx);
    }
  }

  // サイクル（例：二人がポジション入替）などで取り切れない場合は残りを従来順で後ろに足す
  if (orderedIdx.length !== n) {
    const rest = [];
    const used = new Set(orderedIdx);
    for (let i = 0; i < n; i++) if (!used.has(i)) rest.push(i);
    rest.sort((a, b) => posIndex(shift[a].fromPos) - posIndex(shift[b].fromPos));
    orderedIdx.push(...rest);
  }

  return orderedIdx.map(i => shift[i]);
};

// 守備位置の表示順序（昇順）
const posOrder = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右", "指"];
const posIndex = (pos: string) => posOrder.indexOf(pos);

replace.sort((a, b) => posIndex(a.pos) - posIndex(b.pos));
mixed.sort((a, b) => posIndex(a.fromPos) - posIndex(b.fromPos));
shift = sortShiftByChain(shift);

/* ---- replace / mixed ---- */
const addReplaceLine = (line: string, isLast: boolean) =>
  result.push(isLast ? line + "。" : line + "、");

const replaceLines: string[] = [];

const isOhtaniActive =
  typeof assignments?.["投"] === "number" &&
  typeof assignments?.["指"] === "number" &&
  assignments["投"] === assignments["指"];

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

// ✅ “開始時点で投=指だったか” は「現在のohtaniRule」ではなく initialAssignments だけで判定する
const startedAsOhtani =
  typeof initialAssignments?.["投"] === "number" &&
  typeof initialAssignments?.["指"] === "number" &&
  Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

const pitcherUnchangedThisTurn =
  startedAsOhtani &&
  typeof initialAssignments?.["投"] === "number" &&
  typeof assignments?.["投"] === "number" &&
  Number(initialAssignments["投"]) === Number(assignments["投"]);

  if (pitcherUnchangedThisTurn && r.pos === "投") {
    // 投手は触っていないので、このターンの投手リエントリー扱いはノイズ
    return;
  }
  
    // ★ 新規: 深掘りした“打順一致”なら無条件でリエントリー確定（最優先）
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
    if (r.pos === "投" && r.order <= 0) {
      // 打順が無くても投手は別行で出す（スタメン発表の「ピッチャーは…」と同じ扱い）
      if (!lineupLines.some(l => l.text.includes("ピッチャー") && l.text.includes(nameRuby(r.to)))) {
        lineupLines.push({
          order: 999, // 末尾に回す
          text: `ピッチャー ${fullNameWithHonor(r.to)}${backNoSuffix(r.to)}`
        });
      }
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
  // === リエントリー（打順ベース）早期判定：必ず通常分岐より前に置く ===
{
  // r.to = 元スタメン候補（例：小池）
  const reentry_info = (usedPlayerInfo as any)?.[r.to.id];

  // いま r.from（例：百目鬼）が占めている打順番号（1始まり / 0=無し）
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
    fromId: r.from.id,
    toId: r.to.id,
    pos: r.pos,
    order: r.order,
  });

  const phrase =
    pinchFromUsed.reason === "代走" ? "代走" :
    pinchFromUsed.reason === "臨時代走" ? "臨時代走" :
    "代打";

  // 守備位置は r.pos が不安定なことがあるので usedPlayerInfo.fromPos を優先
  const posSym =
    ((posNameToSymbol as any)[pinchFromUsed.fromPos] ?? pinchFromUsed.fromPos ?? r.pos);

  const posLabel =
    (posJP as any)[posSym] ?? posSym ?? "";

  // ✅ ここでは「先ほど○○いたしました△△くんに代わりまして、□ □くんがそのまま入り◯◯」
  replaceLines.push(
    `先ほど${phrase}いたしました${nameWithHonor(r.from)}に代わりまして、` +
    `${fullNameWithHonor(r.to)}がそのまま入り${posLabel}`
  );

  // ✅ 同じ打順の古い行（例: 5番 - 加藤くん）を全部消してから、今の選手で入れ直す
  if (r.order > 0) {
    const text = `${r.order}番 ${posLabel} ${fullNameWithHonor(r.to)}${backNoSuffix(r.to)}`;

    for (let i = lineupLines.length - 1; i >= 0; i--) {
      if (lineupLines[i].order === r.order) {
        lineupLines.splice(i, 1);
      }
    }

    lineupLines.push({ order: r.order, text });
  }

  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  handledPositions.add(posSym);

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
// console.debug("[リエントリー? replace]", { from: r.from.id, to: r.to.id, wasStarterTo, infoForTo, isReentrySameOrder });


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
// ✅ 大谷ルールON：指名打者に代打 → 「投手リエントリー」扱いを禁止し
// 「代打の選手がそのまま指名打者に入る」に読み替える
const isOhtaniDhPinchHitFix =
  ohtaniRule &&
  isPinchFrom &&
  r.pos === "投" && // 現状はここが「投手リエントリー」扱いになっている
  typeof initialAssignments?.["投"] === "number" &&
  typeof initialAssignments?.["指"] === "number" &&
  initialAssignments["投"] === initialAssignments["指"] && // 先発時点で 投手=DH（大谷状態）
  r.to.id === initialAssignments["投"]; // “リエントリー扱いされている側”が元の投手（=DH）

if (isOhtaniDhPinchHitFix) {
  const dhSym = "指";
  const dhLabel = posJP[dhSym as keyof typeof posJP];

  // ✅ 代打（r.from）が「今どこの守備にいるか」を見る（指以外なら理想文にする）
  const pinchNowPosSym = (Object.keys(assignments || {}) as any[]).find(
    (sym) => Number((assignments as any)[sym]) === Number(r.from.id)
  ) as string | undefined;

  // ✅ いま実際にDH（指）にいる選手
  const currentDhId =
    typeof assignments?.["指"] === "number" ? (assignments["指"] as number) : null;

  const currentDhPlayer = currentDhId
    ? teamPlayers.find((p) => Number(p.id) === Number(currentDhId))
    : null;

  // ✅ 「代打がそのままDH」なのか、「代打に代わって控えがDH」なのかを判定
  const replacedAfterPinch =
    !!currentDhPlayer && Number(currentDhPlayer.id) !== Number(r.from.id);

  // 表示対象（DHにいる方を出す）
  const dhPlayer = replacedAfterPinch ? currentDhPlayer! : r.from;

  // ✅ 1行目：代打本人がDHにいない（＝別守備に置いた）なら、その守備位置で言う
  if (pinchNowPosSym && pinchNowPosSym !== "指") {
    const posLabel = posJP[pinchNowPosSym as keyof typeof posJP] ?? pinchNowPosSym;

    // 例：先ほど代打いたしました堂林くんがファースト。
    replaceLines.push(
      `先ほど代打いたしました${nameWithHonor(r.from)}が${posLabel}。`
    );

    console.log("[ANN][OHTANI][DH_PINCH_FIX:pinch_moved]", {
      pinchNowPosSym,
      fromId: r.from.id,
    });

    // ✅ この r の通常処理（誤った投手リエントリー扱い）を止める
    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(pinchNowPosSym);
    return;
  }

  const hasDup = (() => {
    const set: Set<string> | undefined = (window as any).__dupLastNames;
    return !!set && set.size > 0; // 同一姓が1組でもいれば true（仕様どおり）
  })();

  const fromP =
    teamPlayers.find(p => Number(p.id) === Number(r.from.id)) ?? r.from;

  const fromName = hasDup ? fullNameWithHonor(fromP) : nameWithHonor(fromP);

  // ✅ 代打本人がDHのままなら、従来どおり「そのまま指名打者」
  const fixLine = replacedAfterPinch
    ? `先ほど代打いたしました${nameWithHonor(r.from)}に代わりまして、${fullNameWithHonor(
        dhPlayer
      )}がそのまま入り ${dhLabel}`
    : `先ほど代打いたしました${fromName}がそのまま入り ${dhLabel}`;


  replaceLines.push(fixLine);

  console.log("[ANN][OHTANI][DH_PINCH_FIX:push]", {
    fixLine,
    replacedAfterPinch,
    fromId: r.from.id,
    dhId: dhPlayer.id,
  });

  // 2行目：打順行（●番 指名打者 ●●くん）→ “いまDHにいる選手” のIDで探す
  const orderNum =
    r.order > 0
      ? r.order
      : (() => {
          const idx = battingOrder.findIndex(
            (e) => Number(e.id) === Number(dhPlayer.id)
          );
          return idx >= 0 ? idx + 1 : 0;
        })();

  if (
    orderNum > 0 &&
    !lineupLines.some(
      (l) => l.order === orderNum && l.text.includes(dhLabel) && l.text.includes(nameRuby(dhPlayer))
    )
  ) {
    lineupLines.push({
      order: orderNum,
      text: `${orderNum}番 ${dhLabel} ${nameWithHonor(dhPlayer)}`,
    });
  }

  // ✅ この r の通常処理（リエントリー投手＆投手打順行）を止める
  handledPlayerIds.add(r.from.id);
  handledPlayerIds.add(r.to.id);
  if (replacedAfterPinch) handledPlayerIds.add(dhPlayer.id);
  handledPositions.add(dhSym);
  return;
}




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


// ✅ lineupLines：同じ打順＋守備（例：9番 指名打者）が既にある場合は「上書き」する
if (r.order > 0) {
  const isReentryTo = reentryToIds.has(r.to.id);

  // 背番号の表記：希望どおり「背番号22」形式（スペース無し）
  const num = (r.to as any)?.number ?? "";
  const text = isReentryTo
    ? `${r.order}番 ${posJP[r.pos]} ${nameWithHonor(r.to)}`
    : `${r.order}番 ${posJP[r.pos]} ${fullNameWithHonor(r.to)}${backNoSuffix(r.to)}`;

    const idx = lineupLines.findIndex(
    l => l.order === r.order && l.text.includes(posJP[r.pos])
  );

  if (idx >= 0) {
    lineupLines[idx] = { order: r.order, text }; // ★上書き更新
  } else {
    lineupLines.push({ order: r.order, text });
  }
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

  const ohtaniActive =
    ohtaniRule ||
    (Number(assignments?.["投"]) > 0 &&
      assignments?.["投"] === assignments?.["指"]);

const isPitcherReplaceOnly =
  replaceLines.length === 1 && /^ピッチャー/.test(base);
  
const sentence = isSonoMama
  ? (shift.length > 0 ? base + "、" : base + "。")
  : isReentryBare
    ? (shift.length > 0 ? base + "に入ります、" : base + "に入ります。")
  : hasHairi
    ? (shift.length > 0 ? base + "、" : base + "。")
  : (ohtaniActive && isPitcherReplaceOnly)
      ? base + "が入ります。"
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


// mixed の前あたり（同一スコープ）に追加
const handledMixedKeys = new Set<string>();

mixed.forEach((r, i) => {

  // ✅ mixed は「イベント単位」で重複防止（同一選手が別イベントに出るのは許可）
  const mixedKey = `${r.from.id}|${r.to.id}|${r.fromPos}|${r.toPos}|${r.order}`;
  if (handledMixedKeys.has(mixedKey) || handledPositions.has(r.toPos)) return;
handledMixedKeys.add(mixedKey);


// >>> DIRECT リエントリー v2（代打→守備→元スタメンが戻る）を最優先で確定
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
// <<< DIRECT リエントリー v2 END



    // ★ 追加：UIが青（プレビュー/確定）なら、確定前でも「リエントリーで …」
  if (isReentryBlue(r.to.id)) {
    const orderPart = r.order > 0 ? `${r.order}番に ` : "";
    // 例：「ライトの奥村くんに代わりまして、リエントリーで小池くんがライトへ」
    addReplaceLine(
      `${posJP[r.fromPos]}の ${nameWithHonor(r.from)}に代わりまして、` +
      `${orderPart}${nameWithHonor(r.to)}がリエントリーで9 ${posJP[r.toPos]}へ`,
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
        : `${r.order}番 ${posJP[r.toPos]} ${fullNameWithHonor(r.to)}${backNoSuffix(r.to)}`
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
  const dupKey = `${s.player.id}|${s.fromPos}|${s.toPos}`;
  if (skipShiftPairs.has(dupKey)) return;

  const startedAsOhtani =
    typeof initialAssignments?.["投"] === "number" &&
    typeof initialAssignments?.["指"] === "number" &&
    Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

  const pitcherUnchangedThisTurn =
    startedAsOhtani &&
    typeof assignments?.["投"] === "number" &&
    Number(assignments["投"]) === Number(initialAssignments["投"]);

  if (pitcherUnchangedThisTurn && s.toPos === "投") return;

  const allowedPitcherShift =
    s.fromPos === "投" &&
    replace.some(r => r.pos === "投" && r.from.id === s.player.id);

  if (
    (!allowedPitcherShift && handledPlayerIds.has(s.player.id)) ||
    handledPositions.has(s.toPos)
  ) return;

  // ★追加: 守備位置を必ず正規化
  const fromSym = (posNameToSymbol as any)[s.fromPos] ?? s.fromPos;
  const toSym   = (posNameToSymbol as any)[s.toPos] ?? s.toPos;

  const fromLabel = posJP[fromSym as keyof typeof posJP] ?? s.fromPos;
  const toLabel   = posJP[toSym as keyof typeof posJP] ?? s.toPos;

  const alreadyMentionedSameTo = result.some(
    (ln) => ln.includes(nameWithHonor(s.player)) && ln.includes(toLabel)
  );
  if (alreadyMentionedSameTo) return;

  const pinchInfoForShift = Object.values(usedPlayerInfo || {}).find(
    (x: any) => x?.subId === s.player.id && ["代打", "代走", "臨時代走"].includes(x.reason)
  );
  const pinchEntry =
    battingOrder.find(
      (e) => e.id === s.player.id && ["代打", "代走", "臨時代走"].includes(e.reason)
    ) ||
    (pinchInfoForShift ? ({ reason: pinchInfoForShift.reason } as any) : undefined);

  const alreadyOnFieldWhenOpened = Object.values(initialAssignments ?? {}).some(
    (id) => Number(id) === Number(s.player.id)
  );

  if (pinchEntry && !alreadyOnFieldWhenOpened) {
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

    // ★修正: 「へ」ではなく「に入ります」
    result.push(`${headText}${nameWithHonor(s.player)}が${toLabel}に入ります。`);
  } else {
    const suppressDhToPitcherLine =
      startedAsOhtani && fromSym === "指" && toSym === "投";

    if (!suppressDhToPitcherLine) {
      result.push(`${fromLabel}の${nameRuby(s.player)}${s.player.isFemale ? "さん" : "くん"}が${toLabel}、`);
    }
  }

  if (
    !lineupLines.some(l =>
      l.order === s.order && l.text.includes(toLabel) && l.text.includes(nameRuby(s.player))
    )
  ) {
    const dhActive = !!assignments?.["指"];
    const isPitcherCatcherSwap =
      dhActive &&
      ((fromSym === "投" && toSym === "捕") || (fromSym === "捕" && toSym === "投"));

    if (!isPitcherCatcherSwap) {
      lineupLines.push({
        order: s.order,
        text: `${s.order}番 ${toLabel} ${nameRuby(s.player)}${s.player.isFemale ? "さん" : "くん"}`
      });
    }
  }

  handledPlayerIds.add(s.player.id);
  handledPositions.add(toSym);
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

// ✅ 大谷開始（投＝指）で「控え→投」をやった時、
// 「ピッチャーの◯◯が 指名打者に入ります。」は冗長なので削除する
{
  const isOhtaniStart =
    ohtaniRule &&
    typeof initialAssignments?.["投"] === "number" &&
    typeof initialAssignments?.["指"] === "number" &&
    Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

  if (isOhtaniStart) {
    for (let i = result.length - 1; i >= 0; i--) {
      const t = result[i].trim();
      // 例: 「ピッチャーの<ruby>上田...</ruby>くんが 指名打者 、」のような行を消す
      if (/^ピッチャーの.*が\s*指名打者\s*[、。]?$/.test(t)) {
        result.splice(i, 1);
      }
    }
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

// =====================================================
// 代打/代走選手が「守備に就いた」場合の打順行補完
// （守備位置を変えたケースで「◯番 ◯◯ Aくん」が欠けるのを防ぐ）
// =====================================================
battingOrder.forEach((entry, idx) => {
  if (!["代打", "代走", "臨時代走"].includes(entry.reason)) return;

  // 今この選手が就いている守備位置（投/捕/一...）を assignments から引く
  const posSym = Object.entries(assignments).find(([_, id]) => id === entry.id)?.[0] as
    | keyof typeof posJP
    | undefined;
  if (!posSym) return; // 守備についていない（=表示不要）

  const order = idx + 1;
  const p = teamPlayers.find(tp => tp.id === entry.id);
  if (!p) return;

  const expectedText = `${order}番 ${posJP[posSym]} ${nameWithHonor(p)}`;

  // 既に同じ打順行があれば更新/追加しない（別位置で入っていた場合は更新）
  const existsIdx = lineupLines.findIndex(l => l.order === order);
  if (existsIdx >= 0) {
    if (lineupLines[existsIdx].text !== expectedText) {
      lineupLines[existsIdx] = { order, text: expectedText };
    }
  } else {
    lineupLines.push({ order, text: expectedText });
  }
});

/* ---- 打順行を最後にまとめて追加 ---- */

// 交代件数
const total = replace.length + shift.length + mixed.length;

// 投手の replace（これがある＝投手交代）
const pitcherReplace = replace.find(r => r.pos === "投");

// 「投⇄指」の shift だけなら“大谷ルール由来のズレ”として無視したい
const isOhtaniDhOnlyShift =
  !!pitcherReplace &&
  shift.length >= 1 &&
  shift.every(s => {
    const posOk =
      (s.fromPos === "投" && s.toPos === "指") ||
      (s.fromPos === "指" && s.toPos === "投");

    const pid = s.player?.id;
    const samePlayer =
      pid === pitcherReplace.from?.id || pid === pitcherReplace.to?.id;

    return posOk && samePlayer;
  });

// 「新しく入る選手」が1人だけか（投＝指で2件扱いになっても“1人”判定にする）
const entrantIds = new Set<number>();
replace.forEach(r => entrantIds.add(r.to.id));
mixed.forEach(r => entrantIds.add(r.to.id));

// ✅ 大谷ルールON ＆ 投手交代あり ＆ 入る選手が1人だけ ＆
// shift が無い もしくは “投⇄指だけ” のとき → 特別扱い
const isOhtaniSinglePitcherPlayerChange =
  ohtaniRule &&
  !!pitcherReplace &&
  mixed.length === 0 &&
  entrantIds.size === 1 &&
  entrantIds.has(pitcherReplace.to.id) &&
  (shift.length === 0 || isOhtaniDhOnlyShift);

if (isOhtaniSinglePitcherPlayerChange) {
  // ✅ このケースは「以上に代わります。」も「打順行」も付けない
  const newPitcher = pitcherReplace.to;
  const no = (newPitcher as any).number ?? "";
  result.push(`ピッチャー　${nameWithHonor(newPitcher)}　背番号${no}`);
} else {
  // 通常：打順行を追加
  const already = new Set(result);

  lineupLines
    .filter(l => l.order > 0) // ★ 0番は表示しない
    .sort((a, b) => a.order - b.order)
    .forEach((l) => {
      if (!already.has(l.text)) {
        result.push(l.text);
        already.add(l.text);
      }
    });

  /* ---- 「以上に代わります。」判定 ---- */
  if ((total >= 2) || (lineupLines.length >= 2)) {
    result.push("以上に代わります。");
  }
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

// --- 守備番号（審判の「1が9」の入力用） ---
const POS_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const numberToPosSymbol: Record<number, string> = {
  1: "投",
  2: "捕",
  3: "一",
  4: "二",
  5: "三",
  6: "遊",
  7: "左",
  8: "中",
  9: "右",
};

// --- 手書きメモ（保存しない・書く/消すだけ） ---
type MiniScribblePadProps = {
  value: string;                 // dataURL
  onChange: (next: string) => void;
};

const MiniScribblePad: React.FC<MiniScribblePadProps> = ({ value, onChange }) => {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const drawingRef = React.useRef(false);
  const lastRef = React.useRef<{ x: number; y: number } | null>(null);
  const [isEraser, setIsEraser] = React.useState(false);

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const applyPenStyle = (ctx: CanvasRenderingContext2D) => {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (isEraser) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 16;
    } else {
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 3;
    }
  };

  const saveToParent = React.useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const url = canvas.toDataURL("image/png");
      onChange(url);
    } catch {
      // 念のため（iOSの制限など）
    }
  }, [onChange]);

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawingRef.current = true;
    canvas.setPointerCapture(e.pointerId);

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    applyPenStyle(ctx);
    const { x, y } = getPos(e);
    lastRef.current = { x, y };

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    applyPenStyle(ctx);

    const { x, y } = getPos(e);
    const last = lastRef.current;
    if (!last) return;

    ctx.lineTo(x, y);
    ctx.stroke();
    lastRef.current = { x, y };
  };

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastRef.current = null;

    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    }

    // ★描き終わったタイミングで保存（モーダル閉じても残る）
    saveToParent();
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    onChange(""); // ★親も空に
  };

  // Retina対策（リサイズで内容は消える＝直後に value から復元する）
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const cssW = canvas.clientWidth;
      const cssH = canvas.clientHeight;

      const nextW = Math.floor(cssW * dpr);
      const nextH = Math.floor(cssH * dpr);
      if (canvas.width === nextW && canvas.height === nextH) return;

      canvas.width = nextW;
      canvas.height = nextH;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ★value（dataURL）が来たら復元
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!value) return;
    const img = new Image();
    img.onload = () => {
      // CSS座標系で描ける状態になっている（setTransform済み）
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.drawImage(img, 0, 0, w, h);
    };
    img.src = value;
  }, [value]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="text-xs font-bold text-slate-700">✍️ 手書きメモ</div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setIsEraser(false)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              isEraser
                ? "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                : "bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700"
            }`}
          >
            ✏️
          </button>
          <button
            type="button"
            onClick={() => setIsEraser(true)}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold border ${
              isEraser
                ? "bg-indigo-600 text-white border-indigo-600 hover:bg-indigo-700"
                : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
            }`}
          >
            🧽
          </button>
          <button
            type="button"
            onClick={clear}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-xs font-bold hover:bg-slate-800 active:bg-slate-900"
          >
            消去
          </button>
        </div>
      </div>
            
      <canvas
        ref={canvasRef}
        className="w-full h-40 rounded-xl bg-slate-50 border border-slate-200 touch-none"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
};

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


// ─────────────────────────────────────────────
// 画面コンポーネント本体
// ─────────────────────────────────────────────

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

const [touchedFieldPos, setTouchedFieldPos] = useState<Set<string>>(new Set());
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
  const [ohtaniRule, setOhtaniRule] = useState(false);
  // 大谷ルール：この画面を開いた時点の値（「確定しないで戻る」場合に復元する）
  const ohtaniRuleAtOpenRef = useRef<boolean>(false);


// ←★ このあたりが目印

  // DH解除を確定時にまとめて適用するための保留フラグ
  const [pendingDisableDH, setPendingDisableDH] = useState(false);
  const [dhDisableDirty, setDhDisableDirty] = useState(false);
  const [dhDisableSnapshot, setDhDisableSnapshot] =
  useState<{ dhId: number; pitcherId: number } | null>(null);
  const [battingReplacements, setBattingReplacements] = useState<{ [index: number]: Player }>({});
  // 同姓判定セット更新をアナウンス再計算へ反映させるためのトリガ
  const [dupLastNamesTick, setDupLastNamesTick] = useState(0);
  // 同一姓セットを「出場＋控え＋代打（battingReplacements）」から算出して共有
  useEffect(() => {
    const ids = new Set<number>();

    // 打順（出場）
    (battingOrder ?? []).forEach(e => {
      if (e?.id != null) ids.add(Number(e.id));
    });

    // 守備配置（出場）
    Object.values(assignments ?? {}).forEach(v => {
      if (v != null) ids.add(Number(v));
    });

    // 控え
    (benchPlayers ?? []).forEach(p => {
      if (p?.id != null) ids.add(Number(p.id));
    });

    // 代打/代走（battingReplacements 側にいるケースを拾う）
    Object.values(battingReplacements ?? {}).forEach(p => {
      if (p?.id != null) ids.add(Number(p.id));
    });

    // id -> Player
    const players = Array.from(ids)
      .map(id => teamPlayers.find(tp => Number(tp.id) === Number(id)))
      .filter(Boolean) as Player[];

    // 姓の出現回数を数える
    const count = new Map<string, number>();
    for (const p of players) {
      const ln = String(p.lastName ?? "").trim();
      if (!ln) continue;
      count.set(ln, (count.get(ln) ?? 0) + 1);
    }

    const dups = Array.from(count.entries())
      .filter(([, c]) => c >= 2)
      .map(([ln]) => ln);

    (window as any).__dupLastNames = new Set<string>(dups);
    void localForage.setItem("duplicateLastNames", dups);

    // 重要：グローバル更新だけだとアナウンスuseMemoが再計算されないのでトリガを踏む
    setDupLastNamesTick(t => t + 1);
  }, [battingOrder, assignments, benchPlayers, battingReplacements, teamPlayers]);

  const [previousPositions, setPreviousPositions] = useState<{ [playerId: number]: string }>({});
  const [initialAssignments, setInitialAssignments] = useState<Record<string, number | null>>({});

  // --- 守備番号で交代（●が●）モーダル ---
type PositionNumberChangeRow = {
  from: string;            // 1〜9
  mode: "swap" | "replace"; // "swap"=●が●, "replace"=●に代わって
  to: string;              // swapのときは 1〜9
  benchPlayerId: string;   // replaceのときに控え選手ID
};
const [showPosNumberModal, setShowPosNumberModal] = useState(false);
// 手書きメモ（モーダルを閉じても保持、交代確定で消す）
const [posNumberMemoDataUrl, setPosNumberMemoDataUrl] = useState<string>("");
const [dirty, setDirty] = useState(false);
const [posNumberRows, setPosNumberRows] = useState<PositionNumberChangeRow[]>(
  Array.from({ length: 9 }, () => ({ from: "", mode: "swap", to: "", benchPlayerId: "" }))
);
const [posNumberError, setPosNumberError] = useState<string | null>(null);

// ★ 追加：ドラッグ中のタッチ情報
const [touchDrag, setTouchDrag] = useState<{ playerId: number; fromPos?: string } | null>(null);
const lastTouchRef = React.useRef<{ x: number; y: number } | null>(null);
const hoverPosRef = React.useRef<string | null>(null);

// 変更検知用
const [isDirty, setIsDirty] = useState(false);
const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
const snapshotRef = useRef<string | null>(null);
//非リエントリー時の確認モーダル
type PendingNonReentryDrop = {
  toPos: string;      // 守備位置シンボル（"捕"など）
  playerId: number;   // 入る選手
  replacedId: number; // 代わる選手
};

const [pendingNonReentryDrop, setPendingNonReentryDrop] =
  useState<PendingNonReentryDrop | null>(null);

const [showNonReentryConfirm, setShowNonReentryConfirm] = useState(false);

// ✅ YES時に「次の1回だけリエントリー判定を無視する」フラグ
const [forceNormalSubOnce, setForceNormalSubOnce] = useState(false);

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


const getEffectivePlayerId = (playerId: number | null | undefined) => {
  if (!playerId) return null;

  let effectiveId = playerId;

  for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
    const origId = Number(origIdStr);
    const latestId =
      Number(
        (info as any).currentPlayerId ??
        (info as any).latestPlayerId ??
        (info as any).playerId ??
        origId
      ) || origId;

    if (effectiveId === origId) {
      effectiveId = latestId;
    }
  }

  return effectiveId;
};


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

  // ✅ 大谷ルールON時：フィールド図が打順側DHスロットを見ているため、表示も空にする
  if (ohtaniRule) {
    const dhStarterId = initialAssignments?.["指"];
    const dhSlotIndex =
      typeof dhStarterId === "number"
        ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
        : -1;

    if (dhSlotIndex >= 0) {
      // DH枠の表示に使っている draft を「空」にする（フィールド図からDHが消える）
      setBattingOrderDraft(prevDraft => {
        const base = (prevDraft?.length ? [...prevDraft] : [...battingOrder]);
        if (base[dhSlotIndex]) base[dhSlotIndex] = { ...base[dhSlotIndex], id: 0 };
        return base;
      });

      // ついでに DH枠の置換も消しておく（表示ブレ防止）
      setBattingReplacements(prevRep => {
        const next = { ...prevRep };
        delete (next as any)[dhSlotIndex];
        return next;
      });
    }
  }

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
