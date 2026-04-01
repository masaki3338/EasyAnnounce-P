import React, { useEffect, useMemo, useRef, useState } from "react";
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useDrag } from "react-dnd";

import localForage from "localforage";
import { useNavigate } from "react-router-dom";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";
import {
  deriveCurrentGameState,
  reenterPlayerToPosition,
  resolveCurrentPlayerId,
  type UsedPlayerInfoMap,
} from "./lib/gameState";
/**const posNameToSymbol
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

const normalizeFieldAssignments = (
  assignments: Record<string, number | null>,
  options?: { allowPitcherDhDuplicate?: boolean }
): Record<string, number | null> => {
  const next = { ...assignments };
  const placed = new Map<number, string>();

  for (const [pos, id] of Object.entries(next)) {
    if (typeof id !== "number") continue;

    const prevPos = placed.get(id);
    if (prevPos && prevPos !== pos) {
      const allowOhtaniDup =
        options?.allowPitcherDhDuplicate &&
        ((prevPos === "投" && pos === "指") || (prevPos === "指" && pos === "投"));

      if (!allowOhtaniDup) {
        next[prevPos] = null;
      }
    }

    placed.set(id, pos);
  }

  return next;
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
  let suppressTailClose = false; // ← ここ
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

  // ✅ 連鎖の末端（A→B→C…の C = 最新代打/代走ID）を先に求める
  const latestPinchId = resolveLatestSubId(origId, usedPlayerInfo);
  if (!latestPinchId) return;

  // ✅ 打順 index を堅牢に取得
  let ordIdx = battingOrder.findIndex(e => e.id === latestPinchId);
  if (ordIdx < 0) {
    ordIdx = battingOrder.findIndex(e => resolveLatestSubId(e.id, usedPlayerInfo) === latestPinchId);
  }
  if (ordIdx < 0) {
    ordIdx = battingOrder.findIndex(e => e.id === origId);
  }
  if (ordIdx < 0) {
    ordIdx = battingOrder.findIndex(starter =>
      getPositionName(initialAssignments, starter.id) === posSym
    );
  }
  const orderPart = ordIdx >= 0 ? `${ordIdx + 1}番に ` : "";

  // いまその守備に入っている選手
  const rawCurrentId = assignments[posSym];

  // ✅ 守備図で実際に表示されている選手IDを優先
  // 代走/臨時代走/代打で、assignments には元選手IDが残っていても
  // その守備の実体は subId / latestSubId 側なのでそちらを使う
  const currentId = (() => {
    if (typeof rawCurrentId !== "number") return null;

    for (const [oidStr, u] of Object.entries(usedPlayerInfo || {})) {
      if (!u) continue;

      const sym = (posNameToSymbol as any)[(u as any).fromPos] ?? (u as any).fromPos;
      if (sym !== posSym) continue;

      const reason = String((u as any).reason ?? "");
      if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

      const origId2 = Number(oidStr);
      const latest2 = resolveLatestSubId(origId2, usedPlayerInfo as any);
      const subId2 =
        typeof (u as any).subId === "number" ? Number((u as any).subId) : null;

      // assignments に元選手IDが残っている場合は、実際の表示選手へ補正
      if (rawCurrentId === origId2) {
        if (typeof latest2 === "number") return latest2;
        if (subId2 != null) return subId2;
      }
    }

    return rawCurrentId;
  })();

  console.log("[SAME-POS-PINCH] currentId resolve", {
    posSym,
    rawCurrentId,
    currentId,
    origId,
    latestPinchId,
  });

  if (!currentId) return;

  const latestPinchPlayer = teamPlayers.find(p => p.id === latestPinchId);
  if (!latestPinchPlayer) return;

  const currentMovedFromAnotherPosThisTurn =
  mixed.some(
    (m) =>
      Number(m.to.id) === Number(currentId) &&
      m.toPos === posSym &&
      m.fromPos !== posSym
  ) ||
  shift.some(
    (s) =>
      Number(s.player.id) === Number(currentId) &&
      s.toPos === posSym &&
      s.fromPos !== posSym
  );

  // このターンで別守備から移動してきた選手は
  // 「そのまま入り◯◯」ではなく通常の replace / mixed / shift で読む
  if (currentMovedFromAnotherPosThisTurn) {
    console.log("[SAME-POS-PINCH] skip: current moved from another pos this turn", {
      currentId,
      posSym,
    });
    return;
  }

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

  // ✅ ここが重要：
  // 「代打/代走本人がそのまま同守備に入る」ケースは、
  // currentIsPinch で弾く前にここで確定させる
  const originalStarterAlreadyReturned = Object.entries(assignments ?? {}).some(
  ([, id]) => Number(id) === Number(origId)
  );

  if (originalStarterAlreadyReturned) {
    console.log("[SAME-POS-PINCH] skip: original starter already returned", {
      origId,
      latestPinchId,
      posSym,
    });
    return;
  }
  if (Number(currentId) === Number(latestPinchId)) {
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

    const pinchOrderIdx = battingOrder.findIndex(
      e => Number(e.id) === Number(latestPinchId)
    );

    if (pinchOrderIdx >= 0) {
      const lineupOrder = pinchOrderIdx + 1;
      const text =
        `${lineupOrder}番 ${posJP[posSym]} ${fullNameWithHonor(latestPinchPlayer)}${backNoSuffix(latestPinchPlayer)}`;

      if (!lineupLines.some(l => l.order === lineupOrder && l.text.includes(posJP[posSym]))) {
        lineupLines.push({ order: lineupOrder, text });
      }
    }

    handledPlayerIds.add(latestPinchPlayer.id);
    handledPositions.add(posSym);
    suppressTailClose = true;

    console.log("[SAME-POS-PINCH] fired: current pinch stays same pos", {
      currentId,
      latestPinchId,
      posSym,
    });

    return;
  }

  const currentIsPinch =
    ["代打", "代走", "臨時代走"].includes(
      (battingOrder.find(e => e.id === currentId)?.reason as any) || ""
    ) ||
    !!Object.values(usedPlayerInfo || {}).find(
      (x: any) => x?.subId === currentId && ["代打", "代走", "臨時代走"].includes(x.reason)
    );

  // ✅ 元スタメン復帰は “そのまま入り” から除外してリエントリールートへ回す
  const starterIds = new Set(Object.values(initialAssignments || {}).map(v => Number(v)));
  console.log("[SAME-POS-PINCH] guard", {
    currentId,
    isStarter: starterIds.has(Number(currentId)),
    posSym,
  });

  const origOfCurrent = resolveOriginalStarterId(
    Number(currentId),
    usedPlayerInfo as any,
    initialAssignments as any
  );
  const isOriginalStarter = Number(origOfCurrent) === Number(currentId);
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

  // ✅ まだ pinch 選手なら別ルートへ回す
  if (currentIsPinch) {
    console.log("[SAME-POS-PINCH] skip: current is pinch player", { currentId, posSym });
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

  // ---- 本文（末尾は後段で句点付与）----
  const hasDupLast = (() => {
    const set: Set<string> | undefined = (window as any).__dupLastNames;
    return !!set && set.size > 0;
  })();

  const pinchName = hasDupLast
    ? fullNameWithHonor(latestPinchPlayer)
    : nameWithHonor(latestPinchPlayer);

  if (isJustNowPinch) {
    result.push(
      `先ほど${reasonText}${pinchName}に代わりまして、` +
      `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
    );
  } else {
    result.push(
      `${posJP[posSym]}の${pinchName}に代わりまして、` +
      `${fullNameWithHonor(subPlayer)}がそのまま入り${posJP[posSym]}、`
    );
  }

  const pinchOrderIdx = battingOrder.findIndex(e => e.id === latestPinchId);
  if (pinchOrderIdx >= 0) {
    const lineupOrder = pinchOrderIdx + 1;
    const text = `${lineupOrder}番 ${posJP[posSym]} ${fullNameWithHonor(subPlayer)}${backNoSuffix(subPlayer)}`;

    if (!lineupLines.some(l => l.order === lineupOrder && l.text.includes(posJP[posSym]))) {
      lineupLines.push({ order: lineupOrder, text });
    }
  }

  handledPlayerIds.add(subPlayer.id);
  handledPositions.add(posSym);
});

const skipShiftPairs = new Set<string>();


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
    Number(info.subId) === Number((assignments as any)[posNowSym])
) {
  const phrase =
    info.reason === "臨時代走" ? "臨時代走" : "代走いたしました";

  // B = 戻った元スタメン（加藤）
  // A = 直前までその枠にいた選手（奥村）
  result.push(
    `先ほど${phrase}${nameWithHonor(B)}がそのまま入り${posFull}`
  );

  const orderIdx = battingOrder.findIndex(
    e => Number(e.id) === Number(B.id)
  );

  if (
    orderIdx >= 0 &&
    !lineupLines.some(
      l =>
        l.order === orderIdx + 1 &&
        l.text.includes(posFull) &&
        l.text.includes(nameRuby(B))
    )
  ) {
    lineupLines.push({
      order: orderIdx + 1,
      text: `${orderIdx + 1}番 ${posFull} ${fullNameWithHonor(B)}${backNoSuffix(B)}`
    });
  }

  handledPlayerIds.add(A.id);
  handledPlayerIds.add(B.id);
  handledPositions.add(posNowSym);

  skipShiftPairs.add(`${B.id}|${fromSym}|${posNowSym}`);

  suppressTailClose = true;

  console.log("[RUNNER-REENTRY->SAMEPOS] FIXED", {
    returned: B.id,
    replaced: A.id,
  });

  return;
}
console.log("🔥 RUNNER REENTRY CHECK", {
  origId,
  subId: info.subId,
  posNowSym,
  fromSym,
  assignment: (assignments as any)[posNowSym],
});

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
    // ✅ 代打・代走 両方対象
    if (!["代打", "代走", "臨時代走"].includes(String(entry.reason ?? "").trim())) continue;

    const pinch = teamPlayers.find(p => Number(p.id) === Number(entry.id));
    if (!pinch) continue;

    // ✅ usedPlayerInfo から subId を元に検索（代打・代走両方）
    const pinchInfoPair = Object.entries(usedPlayerInfo || {}).find(
      ([, info]: any) =>
        ["代打", "代走", "臨時代走"].includes(String(info?.reason ?? "").trim()) &&
        Number(info?.subId) === Number(entry.id)
    );
    if (!pinchInfoPair) continue;

    const [origStarterIdStr, pinchInfo] = pinchInfoPair as [string, any];
    const origPosName = pinchInfo.fromPos as keyof typeof posJP;
    const origPosSym = (posNameToSymbol as any)[origPosName] ?? origPosName;
    const origStarterId = Number(origStarterIdStr);

    // 🛑 元先発がどこかに戻っている = リエントリー成立 → この特別処理は使わない
    const isBOnField = Object.values(assignments || {}).some(
      (id) => Number(id) === Number(origStarterId)
    );
    if (isBOnField) continue;

    // ✅ pinch 本人は現在もう守備にいないこと
    if (Object.values(assignments || {}).some((id) => Number(id) === Number(entry.id))) continue;

    // ✅ 元の守備位置に今いる選手（これが movedPlayer）
    const movedPlayerId = assignments?.[origPosSym];
    if (!movedPlayerId || Number(movedPlayerId) === Number(entry.id)) continue;

    const movedPlayer = teamPlayers.find(p => Number(p.id) === Number(movedPlayerId));
    if (!movedPlayer) continue;

    // ✅ movedPlayer が最初にいた守備位置
    const movedFromPos = Object.entries(initialAssignments || {}).find(
      ([, id]) => Number(id) === Number(movedPlayerId)
    )?.[0] as keyof typeof posJP | undefined;

    if (!movedFromPos || movedFromPos === origPosSym) continue;

    const movedToPos = origPosSym;

    // ✅ movedFromPos に新しく入った控え
    const subInId = assignments?.[movedFromPos];
    if (
      !subInId ||
      Object.values(initialAssignments || {}).some((id) => Number(id) === Number(subInId)) ||
      Number(subInId) === Number(entry.id)
    ) continue;

    const subInPos = movedFromPos;
    const subIn = teamPlayers.find(p => Number(p.id) === Number(subInId));
    if (!subIn) continue;

    console.log("✅ 特別処理：代打／代走 → 控えが別守備 → 元選手がシフト", {
      idx,
      pinchId: pinch.id,
      subInId: subIn.id,
      movedPlayerId: movedPlayer.id,
      origPosSym,
      subInPos,
      movedFromPos,
      movedToPos,
    });

    const lines: string[] = [];

    // ★ 守備位置は必ずシンボル化してから表示名へ
    const subInPosSym = (posNameToSymbol as any)[subInPos] ?? subInPos;
    const movedFromPosSym = (posNameToSymbol as any)[movedFromPos] ?? movedFromPos;
    const movedToPosSym = (posNameToSymbol as any)[movedToPos] ?? movedToPos;

    const subInPosLabel = posJP[subInPosSym as keyof typeof posJP] ?? subInPos;
    const movedFromPosLabel = posJP[movedFromPosSym as keyof typeof posJP] ?? movedFromPos;
    const movedToPosLabel = posJP[movedToPosSym as keyof typeof posJP] ?? movedToPos;

    // =========================================================
    // 1行目：
    // 代打/代走だった選手は、守備についていても buildFromHead() 側で
    // 「先ほど代打/代走いたしました～」を優先する
    // =========================================================
    const firstHead = buildFromHead(Number(pinch.id), String(subInPosSym));

    lines.push(
      `${firstHead}${fullNameWithHonor(subIn)}が入り${subInPosLabel}、`
    );

    // =========================================================
    // 2行目：
    // movedPlayer も「一度代打/代走だったら保持」
    // 直接 subId 一致ではなく getEnterReason() で統一判定
    // =========================================================
    const movedTrueReason = getEnterReason(Number(movedPlayer.id));

    console.log("[SPECIAL] 2nd-line reason resolve (persistent)", {
      movedId: movedPlayer.id,
      movedTrueReason,
      movedFromPos,
      movedToPos,
    });

    if (movedTrueReason === "代走" || movedTrueReason === "臨時代走") {
      lines.push(
        `${recentHead(movedTrueReason)}${nameWithHonor(movedPlayer)}が${movedToPosLabel}に入ります。`
      );
      console.log("[SPECIAL] 2nd-line as DAISO");
    } else if (movedTrueReason === "代打") {
      lines.push(
        `${recentHead(movedTrueReason)}${nameWithHonor(movedPlayer)}が${movedToPosLabel}に入ります。`
      );
      console.log("[SPECIAL] 2nd-line as DAIDA");
    } else {
      lines.push(
        `${movedFromPosLabel}の${nameWithHonor(movedPlayer)}が${movedToPosLabel}に入ります。`
      );
      console.log("[SPECIAL] 2nd-line as NORMAL");
    }

    // ✅ 重複抑止：この特別処理で出した shift は後続 shift 出力から除外
    skipShiftPairs.add(`${movedPlayer.id}|${movedFromPos}|${movedToPos}`);

    // ✅ 重複抑止：この特別処理で出した控え入場は後続 replace から除外
    handledPlayerIds.add(subIn.id);
    handledPositions.add(String(subInPos));

    // ✅ 代打/代走本人は通常処理に回さない
    handledIds.add(entry.id);

    // 打順行
    const lineup: { order: number; txt: string }[] = [];

    // ★ subIn（控え）の打順は pinch entry の打順を使う
    const pinchOrderIdx = battingOrder.findIndex(e => Number(e.id) === Number(entry.id));
    if (pinchOrderIdx >= 0) {
      lineup.push({
        order: pinchOrderIdx + 1,
        txt: `${pinchOrderIdx + 1}番 ${posJP[subInPosSym as keyof typeof posJP]} ${fullNameWithHonor(subIn)}${backNoSuffix(subIn)}`,
      });
    }

    // ★ movedPlayer は自分の打順のまま、移動後守備を出す
    const movedOrder = battingOrder.findIndex(e => Number(e.id) === Number(movedPlayer.id));
    if (movedOrder >= 0) {
      lineup.push({
        order: movedOrder + 1,
        txt: `${movedOrder + 1}番 ${posJP[movedToPosSym as keyof typeof posJP]} ${nameWithHonor(movedPlayer)}`,
      });
    }

    // lineupLines に移す（重複防止）
    lineup.forEach(l => {
      if (!lineupLines.some(x => x.order === l.order && x.text === l.txt)) {
        lineupLines.push({ order: l.order, text: l.txt });
      }
    });

    // ❌ 「以上に代わります。」はここでは出さない
    return lines;
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
/* =================================================================
   ✅ 特別処理：代打/代走本人が別守備へ移動し、
      その空いた元守備に別の交代選手が入るケース
   例：
   - スタメン中堅 秋山
   - 代打 矢野
   - 田村→堂林
   - 矢野が中→右、堂林が中
   => 「先ほど代打いたしました矢野君がライト、
       ライトの田村くんに代わりまして、4番に堂林君が入りセンターへ」
================================================================= */
battingOrder.forEach((entry, idx) => {
  if (!["代打", "代走", "臨時代走"].includes(entry.reason)) return;
  if (handledIds.has(entry.id)) return;

  const pinchPlayer = teamPlayers.find(p => p.id === entry.id);
  if (!pinchPlayer) return;

  // 代打/代走情報
  const pinchInfoPair = Object.entries(usedPlayerInfo || {}).find(
    ([, info]: any) =>
      ["代打", "代走", "臨時代走"].includes(String(info?.reason ?? "")) &&
      Number(info?.subId) === Number(entry.id)
  );
  if (!pinchInfoPair) return;

  const [, pinchInfo] = pinchInfoPair as [string, any];
  const origPosSym =
    (posNameToSymbol as any)[pinchInfo.fromPos] ?? pinchInfo.fromPos; // 代打前の元守備
  const curPosSym =
    Object.entries(assignments).find(([_, id]) => Number(id) === Number(entry.id))?.[0];

  // 今守備についていないなら対象外
  if (!curPosSym) return;

  // 同じ守備なら SAME-POS-PINCH 側に任せる
  if (curPosSym === origPosSym) return;

  // 今回、元守備(origPosSym)に別選手が mixed で入っているか
  const mixedIntoOrig = mixed.find(
    (m) =>
      m.toPos === origPosSym &&
      Number(m.from.id) !== Number(entry.id) &&
      !handledPlayerIds.has(m.to.id)
  );
  if (!mixedIntoOrig) return;

  const reasonText =
    entry.reason === "代走"
      ? "代走いたしました"
      : entry.reason === "臨時代走"
      ? "臨時代走"
      : "代打いたしました";

  // 1行目：代打/代走本人が別守備へ
  result.push(
    `先ほど${reasonText}${nameWithHonor(pinchPlayer)}が${posJP[curPosSym as keyof typeof posJP]}、`
  );

  // 2行目：その空いた元守備に別選手が入る
// 堂林の打順は「入る本人」ではなく「抜ける田村の打順」を引き継ぐ
const orderTo = (() => {
  const directIdx = battingOrder.findIndex(
    e => Number(e.id) === Number(mixedIntoOrig.to.id)
  );
  if (directIdx >= 0) return directIdx + 1;

  const inheritIdx = battingOrder.findIndex(
    e => Number(e.id) === Number(mixedIntoOrig.from.id)
  );
  if (inheritIdx >= 0) return inheritIdx + 1;

  return typeof mixedIntoOrig.order === "number" && mixedIntoOrig.order > 0
    ? mixedIntoOrig.order
    : 0;
})();

const orderPart = orderTo > 0 ? `${orderTo}番に` : "";

  result.push(
    `${posJP[mixedIntoOrig.fromPos as keyof typeof posJP]}の${nameWithHonor(mixedIntoOrig.from)}に代わりまして、` +
    `${orderPart}${fullNameWithHonor(mixedIntoOrig.to)}が入り${posJP[mixedIntoOrig.toPos as keyof typeof posJP]}へ`
  );

  // 打順行
  if (
    orderTo > 0 &&
    !lineupLines.some(
      l =>
        l.order === orderTo &&
        l.text.includes(posJP[mixedIntoOrig.toPos as keyof typeof posJP])
    )
  ) {
    lineupLines.push({
      order: orderTo,
      text:
        `${orderTo}番 ${posJP[mixedIntoOrig.toPos as keyof typeof posJP]} ` +
        `${fullNameWithHonor(mixedIntoOrig.to)}${backNoSuffix(mixedIntoOrig.to)}`
    });
  }

  const pinchOrder = idx + 1;
  if (
    !lineupLines.some(
      l =>
        l.order === pinchOrder &&
        l.text.includes(posJP[curPosSym as keyof typeof posJP]) &&
        l.text.includes(nameRuby(pinchPlayer))
    )
  ) {
    lineupLines.push({
      order: pinchOrder,
      text: `${pinchOrder}番 ${posJP[curPosSym as keyof typeof posJP]} ${nameWithHonor(pinchPlayer)}`
    });
  }

  // 後続の mixed / shift / replace で二重に読ませない
  handledIds.add(entry.id);
  handledPlayerIds.add(entry.id);
  handledPlayerIds.add(mixedIntoOrig.from.id);
  handledPlayerIds.add(mixedIntoOrig.to.id);
  handledPositions.add(curPosSym);
  handledPositions.add(origPosSym);

  // 矢野の shift を後段で再度出さない
  skipShiftPairs.add(`${entry.id}|${origPosSym}|${curPosSym}`);

  // 堂林の mixed を後段で再度出さない
  handledPositions.add(mixedIntoOrig.toPos);
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

function getEnterReason(pid: number): string | undefined {
  const targetId = Number(pid);

  // 1) battingOrder 上の現在理由
  const inOrder = battingOrder?.find((b: any) => Number(b?.id) === targetId)?.reason;
  if (inOrder && ["代打", "代走", "臨時代走"].includes(String(inOrder).trim())) {
    return String(inOrder).trim();
  }

  // 2) usedPlayerInfo の subId 直接一致
  const inUsed = Object.values(usedPlayerInfo ?? {}).find(
    (x: any) => Number(x?.subId) === targetId
  )?.reason;
  if (inUsed && ["代打", "代走", "臨時代走"].includes(String(inUsed).trim())) {
    return String(inUsed).trim();
  }

  // 3) 連鎖の末端一致
  for (const [origIdStr, info] of Object.entries(usedPlayerInfo ?? {})) {
    const reason = String((info as any)?.reason ?? "").trim();
    if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

    const latest = resolveLatestSubId(Number(origIdStr), usedPlayerInfo as any);
    if (Number(latest) === targetId) {
      return reason;
    }
  }

  // 4) その他
  return inOrder ? String(inOrder).trim() : undefined;
}

function buildFromHead(fromId: number, fromPosSym?: string) {
  const p = teamPlayers.find(pp => Number(pp.id) === Number(fromId));
  const fromName = p ? nameWithHonor(p) : "";

  const fromPosSymSafe = fromPosSym || "";
  const fromFull = fromPosSymSafe
    ? (posJP[fromPosSymSafe as keyof typeof posJP] ?? fromPosSymSafe)
    : "";

  const reason = getEnterReason(fromId);

  if (["代打", "代走", "臨時代走"].includes(String(reason ?? "").trim())) {
    const phrase =
      reason === "代走"
        ? "代走いたしました"
        : reason === "臨時代走"
        ? "臨時代走"
        : "代打いたしました";

    return `先ほど${phrase}${fromName}に代わりまして、`;
  }

  const alreadyOnFieldWhenOpened = Object.values(initialAssignments ?? {}).some(
    (id) => Number(id) === Number(fromId)
  );

  if (alreadyOnFieldWhenOpened) {
    return `${fromFull ? `${fromFull}の ` : ""}${fromName}に代わりまして、`;
  }

  return `${fromFull ? `${fromFull}の ` : ""}${fromName}に代わりまして、`;
}

// mixed の前あたり（同一スコープ）に追加
const handledMixedKeys = new Set<string>();

mixed.forEach((r, i) => {

  // ✅ mixed は「イベント単位」で重複防止（同一選手が別イベントに出るのは許可）
  const mixedKey = `${r.from.id}|${r.to.id}|${r.fromPos}|${r.toPos}|${r.order}`;
  if (handledMixedKeys.has(mixedKey) || handledPositions.has(r.toPos)) return;
handledMixedKeys.add(mixedKey);


// >>> DIRECT リエントリー v3（打順一致で判定）
{
  // r.to（入る側）の “元スタメンID” を逆引き
  const origIdTo = resolveOriginalStarterId(
    r.to.id,
    usedPlayerInfo as any,
    initialAssignments as any
  );
  const infoOrig = origIdTo ? (usedPlayerInfo as any)?.[origIdTo] : undefined;

  // r.to が元スタメン本人（リエントリー対象）か
  const isStarterChain =
    !!origIdTo &&
    !!infoOrig &&
    Number(origIdTo) === Number(r.to.id);

  // ★ 新仕様：
  // 「外される選手(r.from)が、その元スタメンの打順枠に現在入っているか」
  const fromMatchesSameOrder = isReentryBySameOrderDeep(
    r.from.id,
    r.to.id,
    battingOrder,
    usedPlayerInfo as any,
    initialAssignments as any
  );

  if (isStarterChain && fromMatchesSameOrder) {
    const reasonOf = (pid: number): string | undefined => {
      const u = Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === pid);
      return (u?.reason as any) || (reasonMap as any)?.[pid];
    };

    const fromReason = String(reasonOf(r.from.id) ?? "").trim();

    const head =
      ["代打", "代走", "臨時代走"].includes(fromReason)
        ? buildFromHead(r.from.id, r.fromPos)
        : `${posJP[r.fromPos]} ${nameWithHonor(r.from)}に代わりまして、`;

    addReplaceLine(
      `${head}${nameWithHonor(r.to)}がリエントリーで${posJP[r.toPos]}へ`,
      i === mixed.length - 1 && shift.length === 0
    );

    if (
      r.order > 0 &&
      !lineupLines.some(
        (l) =>
          l.order === r.order &&
          l.text.includes(posJP[r.toPos]) &&
          l.text.includes(nameRuby(r.to))
      )
    ) {
      lineupLines.push({
        order: r.order,
        text: `${r.order}番 ${posJP[r.toPos]} ${nameWithHonor(r.to)}`
      });
    }

    console.log("[MIXED] direct-reentry(v3) fired", {
      from: r.from.id,
      to: r.to.id,
      origIdTo,
      fromMatchesSameOrder,
      fromPos: r.fromPos,
      toPos: r.toPos,
    });

    handledPlayerIds.add(r.from.id);
    handledPlayerIds.add(r.to.id);
    handledPositions.add(r.toPos);
    reentryOccurred = true;
    return; // 通常の mixed 文へ落とさない
  }
}
// <<< DIRECT リエントリー v3 END



// ★ 追加：UIが青（プレビュー/確定）なら、確定前でも「リエントリーで …」
if (isReentryBlue(r.to.id)) {
  addReplaceLine(
    `${posJP[r.fromPos]} ${nameWithHonor(r.from)}に代わりまして、` +
    `${nameWithHonor(r.to)}がリエントリーで${posJP[r.toPos]}へ`,
    i === mixed.length - 1 && shift.length === 0
  );

  // 打順行（重複防止つき）
  if (
    r.order > 0 &&
    !lineupLines.some(
      l =>
        l.order === r.order &&
        l.text.includes(posJP[r.toPos]) &&
        l.text.includes(nameRuby(r.to))
    )
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
  return;
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

// >>> FALLBACK: リエントリー後にさらに守備位置を変えた場合でも
//               「◯◯に代わりまして、△△がリエントリーで◯◯へ」を残す
Object.entries(usedPlayerInfo || {}).forEach(([origIdStr, info]) => {
  if (!info) return;

  const origId = Number(origIdStr);
  const reason = String((info as any).reason ?? "").trim();

  // 代打/代走/臨時代走由来の元スタメンだけ対象
  if (!["代打", "代走", "臨時代走"].includes(reason)) return;

  // すでに他のリエントリー分岐で処理済みなら何もしない
  if (handledPlayerIds.has(origId)) return;

  // いま元スタメン本人がどこにいるか
  const posNowSym =
    Object.entries(assignments).find(([_, id]) => Number(id) === Number(origId))?.[0];
  if (!posNowSym) return;

  // その守備から誰かが shift で出ていくなら、
  // 「元スタメンがその位置へリエントリーした」文を補う
  const outgoingShift = shift.find(
    (s) =>
      s.fromPos === posNowSym &&
      !skipShiftPairs.has(`${s.player.id}|${s.fromPos}|${s.toPos}`)
  );
  if (!outgoingShift) return;

  const returned = teamPlayers.find((p) => Number(p.id) === Number(origId));
  if (!returned) return;

  // 直前までその打順枠にいた選手（例: 上田）を拾う
  const latestId = resolveLatestSubId(origId, usedPlayerInfo as any);
  const refId =
    typeof latestId === "number" && Number(latestId) !== Number(origId)
      ? Number(latestId)
      : typeof (info as any).subId === "number"
        ? Number((info as any).subId)
        : null;

  const refPlayer =
    refId != null ? teamPlayers.find((p) => Number(p.id) === Number(refId)) : undefined;
  if (!refPlayer) return;

  // 「上田」が画面を開いた時点でいた守備（例: 投）をヘッドに使う
  const refOpenedPos =
    Object.entries(initialAssignments).find(
      ([_, id]) => Number(id) === Number(refPlayer.id)
    )?.[0] ?? "";

  const fromReason =
    (pinchReasonById as any)?.[refPlayer.id] ??
    (reasonMap as any)?.[refPlayer.id] ??
    reason;

  const head =
    ["代打", "代走", "臨時代走"].includes(String(fromReason).trim())
      ? buildFromHead(refPlayer.id, refOpenedPos)
      : `${posJP[refOpenedPos as keyof typeof posJP] ?? refOpenedPos} ${nameWithHonor(refPlayer)}に代わりまして、`;

  addReplaceLine(
    `${head}${nameWithHonor(returned)}がリエントリーで${posJP[posNowSym as keyof typeof posJP]}へ`,
    false
  );

  // 打順行
  const orderIdx = battingOrder.findIndex(
    (e) =>
      Number(e.id) === Number(origId) ||
      resolveOriginalStarterId(
        Number(e.id),
        usedPlayerInfo as any,
        initialAssignments as any
      ) === Number(origId)
  );

  if (
    orderIdx >= 0 &&
    !lineupLines.some(
      (l) =>
        l.order === orderIdx + 1 &&
        l.text.includes(posJP[posNowSym as keyof typeof posJP]) &&
        l.text.includes(nameRuby(returned))
    )
  ) {
    lineupLines.push({
      order: orderIdx + 1,
      text: `${orderIdx + 1}番 ${posJP[posNowSym as keyof typeof posJP]} ${nameWithHonor(returned)}`
    });
  }

  console.log("[REENTRY FALLBACK] fired", {
    origId,
    refId,
    posNowSym,
    outgoingShiftFrom: outgoingShift.fromPos,
    outgoingShiftTo: outgoingShift.toPos,
  });

  handledPlayerIds.add(origId);
  handledPositions.add(posNowSym);
  reentryOccurred = true;
});
// <<< FALLBACK END

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
  (x: any) =>
    Number(x?.subId) === Number(s.player.id) &&
    ["代打", "代走", "臨時代走"].includes(String(x?.reason ?? ""))
) as any;

const pinchReasonForShift =
  (battingOrder.find(
    (e) =>
      Number(e.id) === Number(s.player.id) &&
      ["代打", "代走", "臨時代走"].includes(String(e.reason ?? ""))
  )?.reason as string | undefined) ??
  (pinchInfoForShift?.reason as string | undefined);

// ✅ 代打/代走由来の選手なら、initialAssignments に残っていても
//    「先ほど代打/代走いたしました…」を優先する
if (pinchReasonForShift) {
  const phrase =
    pinchReasonForShift === "代打"
      ? "代打いたしました"
      : pinchReasonForShift === "臨時代走"
      ? "臨時代走"
      : "代走いたしました";

  const hasPriorSame = result.some(
    (ln) => ln.includes(`先ほど${phrase}`) || ln.includes(`同じく先ほど${phrase}`)
  );
  const headText = hasPriorSame ? `同じく先ほど${phrase}` : `先ほど${phrase}`;

  result.push(`${headText}${nameWithHonor(s.player)}が${toLabel}、`);
} else {
  const suppressDhToPitcherLine =
    startedAsOhtani && fromSym === "指" && toSym === "投";

  if (!suppressDhToPitcherLine) {
    result.push(
      `${fromLabel}の${nameRuby(s.player)}${s.player.isFemale ? "さん" : "くん"}が${toLabel}、`
    );
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
  const fromRe = new RegExp(`^${POS_JA}の`);
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
  onConfirmed: (opts?: { goSeatIntroduction?: boolean }) => void | Promise<void>;
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
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [battingOrder, setBattingOrder] = useState<{ id: number; reason: string }[]>([]); // ✅ 攻撃画面の打順
  const [shouldGoSeatIntroductionAfterConfirm, setShouldGoSeatIntroductionAfterConfirm] =
  useState(false);
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

const markReentryBlue = (pid: number) => {
  setReentryPreviewIds((prev) => {
    const next = new Set(prev);
    next.add(Number(pid));
    return next;
  });

  setReentryFixedIds((prev) => {
    const next = new Set(prev);
    next.add(Number(pid));
    return next;
  });
};

// ★ YESで「通常交代として続行」した選手
const [forcedNormalSubIds, setForcedNormalSubIds] = useState<Set<number>>(new Set());

const markForcedNormalSub = (pid: number) => {
  const n = Number(pid);

  // 青枠対象から外す
  setReentryPreviewIds((prev) => {
    const next = new Set(prev);
    next.delete(n);
    return next;
  });

  setReentryFixedIds((prev) => {
    const next = new Set(prev);
    next.delete(n);
    return next;
  });

  // 通常交代扱いとして保持
  setForcedNormalSubIds((prev) => {
    const next = new Set(prev);
    next.add(n);
    return next;
  });
};

const isForcedNormalSubId = (id: number) => forcedNormalSubIds.has(Number(id));

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

// ✅ 実際に今DHがいるか、または開始時DHありで未解除ならDHあり扱い
const hasDH =
  (typeof assignments?.["指"] === "number" && Number(assignments["指"]) > 0) ||
  (dhEnabledAtStart && !pendingDisableDH);

// --- 守備番号（審判の「1が9」の入力用） ---
const POS_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
const posNumbersForModal = hasDH
  ? POS_NUMBERS
  : POS_NUMBERS.filter((n) => n !== 10);
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
  10: "指",
};
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
  if (!(reason === "代打" || reason === "代走" || reason === "臨時代走")) return;

  const origId = Number(originalIdStr);
  const rawSym = (posNameToSymbol as any)[fromPos] ?? fromPos;

  const p0 =
    typeof assignments?.["投"] === "number" ? Number(assignments["投"]) : null;
  const d0 =
    typeof assignments?.["指"] === "number" ? Number(assignments["指"]) : null;

  const startedAsOhtani = p0 != null && d0 != null && p0 === d0;

  const sym =
    startedAsOhtani && p0 != null && origId === p0
      ? "指"
      : rawSym;

  if (!(sym in updatedAssignments)) return;

  const latest = resolveLatestSubId(origId, usedPlayerInfo as any);
  if (latest) {
    updatedAssignments[sym] = latest;
  }
});

setInitialAssignments(updatedAssignments);
  };

  setInitialAssignmentsFromSubs();
}, []);

useEffect(() => {
  console.log("✅ DefenseScreen mounted");
  const loadData = async () => {
  const [orderRaw, assignRaw, playersRaw, usedRaw, ohtaniRaw] = await Promise.all([
    localForage.getItem("battingOrder"),
    localForage.getItem("lineupAssignments"),
    localForage.getItem("team"),
    localForage.getItem("usedPlayerInfo"),
    localForage.getItem<boolean>("ohtaniRule"), // ★追加
  ]);

  const initialOhtani = !!ohtaniRaw;
  setOhtaniRule(initialOhtani);
  ohtaniRuleAtOpenRef.current = initialOhtani; // ★「確定せず戻る」用に保持

    const order = Array.isArray(orderRaw) ? orderRaw as { id: number; reason: string }[] : [];
    const originalAssignments = (assignRaw ?? {}) as Record<string, number | null>;
    const usedInfo = (usedRaw ?? {}) as Record<number, { fromPos: string; subId?: number }>;    
    const newAssignments: Record<string, number | null> = { ...originalAssignments };

  // ✅ 大谷ルール自動解除：開始が投＝指（大谷）で、DHに代走（/代打）が入ったら
// その時点で以降は「通常DH」として扱う（DHを他守備に配置できる等）
let ohtaniNow = !!ohtaniRaw;

const p0 = typeof originalAssignments?.["投"] === "number" ? (originalAssignments["投"] as number) : null;
const d0 = typeof originalAssignments?.["指"] === "number" ? (originalAssignments["指"] as number) : null;
const startedAsOhtani0 = p0 != null && d0 != null && p0 === d0;

const dhUsed = d0 != null ? (usedInfo as any)?.[d0] : null;
const dhUsedFromSym = dhUsed?.fromPos ? (posNameToSymbol as any)[dhUsed.fromPos] ?? dhUsed.fromPos : null;

const isDhPinchRun =
  dhUsed &&
  (dhUsedFromSym === "指") &&
  ["代走", "臨時代走"].includes(String(dhUsed.reason ?? ""));

const isDhPinchHit =
  dhUsed &&
  (dhUsedFromSym === "指") &&
  ["代打"].includes(String(dhUsed.reason ?? ""));

// 「代走時点で解除」が要件なので代走だけでもOK（代打も一緒に解除したければ || isDhPinchHit を残す）
// ✅ DHに代打/代走が出たら、大谷ルールは解除（投手は投手として残り、DHは代打側を表示したい）
if (ohtaniNow && startedAsOhtani0 && (isDhPinchRun || isDhPinchHit)) {
  ohtaniNow = false;
  ohtaniRuleAtOpenRef.current = false; // 「確定せず戻る」で復活しないように
  await localForage.setItem("ohtaniRule", false); // 永続化
  console.log("[OHTANI] auto disabled by DH pinch (run/hit)", { dhUsed });
}

setOhtaniRule(ohtaniNow);

    // チームプレイヤー取得
    let updatedTeamPlayers = Array.isArray(playersRaw?.players) ? [...playersRaw.players] : [];


// ✅ 代打・代走の割り当て（“連鎖”の末端まで辿る）
for (const [originalIdStr, rawInfo] of Object.entries(usedInfo)) {
  const info = rawInfo as any;
  const reason = String(info?.reason ?? "").trim();
  if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

  const origId = Number(originalIdStr);
  const latest = resolveLatestSubId(origId, usedInfo as any);
  if (!latest) continue;

  const rawSym =
    (posNameToSymbol as any)[info?.fromPos ?? ""] ?? info?.fromPos ?? "";

  const p0 =
    typeof originalAssignments?.["投"] === "number"
      ? Number(originalAssignments["投"])
      : null;
  const d0 =
    typeof originalAssignments?.["指"] === "number"
      ? Number(originalAssignments["指"])
      : null;

  const startedAsOhtani = p0 != null && d0 != null && p0 === d0;

  // ★ここが本体
  const shouldTreatAsDhPinch =
    startedAsOhtani &&
    origId === p0;

  const sym = shouldTreatAsDhPinch ? "指" : rawSym;
  if (!sym) continue;

  // ★ 大谷開始の本人への直接代打/代走は、投手ではなくDHだけ差し替える
  if (shouldTreatAsDhPinch) {
    newAssignments["投"] = p0;
    newAssignments["指"] = latest;
    continue;
  }

  const isOriginalStillHere = newAssignments[sym] === origId;
  const isOriginalElsewhere = Object.entries(newAssignments)
    .some(([k, v]) => v === origId && k !== sym);
  const isPinchOnField = Object.values(newAssignments).includes(latest);

  if (isOriginalStillHere && !isOriginalElsewhere && !isPinchOnField) {
    newAssignments[sym] = latest;
  }
}

    // ステート更新
    setBattingOrder(order);          // ← 既存
    setBattingOrderDraft(order);     // ← 追加：確定前用も同じ値で初期化
    // ✅ 大谷ルールON：DHに代打が出ているなら、フィールド図が参照する draft 側も代打IDに同期する
// ✅ 開始が「投＝指」なら、大谷ルールが解除されていてもDH表示は代打に同期する
if (startedAsOhtani0) {
  const dhStarterId =
    typeof originalAssignments?.["指"] === "number"
      ? (originalAssignments["指"] as number)
      : null;

  if (dhStarterId != null) {
    const latestDhId = resolveLatestSubId(dhStarterId, usedInfo as any);

    if (latestDhId && latestDhId !== dhStarterId) {
      // ★追加：大谷開始時にDHへ代打/代走が出ても、投手は元のまま固定
      if (typeof originalAssignments?.["投"] === "number") {
        newAssignments["投"] = Number(originalAssignments["投"]);
      }

      // フィールド図（assignments参照）のDHも代打/代走IDにする
      newAssignments["指"] = latestDhId;

      let dhSlotIndex = startingOrderRef.current.findIndex((e) => e.id === dhStarterId);
      if (dhSlotIndex < 0) dhSlotIndex = order.findIndex((e) => e.id === dhStarterId);

      if (dhSlotIndex >= 0) {
        setBattingOrderDraft((prevDraft) => {
          const base = prevDraft?.length ? [...prevDraft] : [...order];
          if (base[dhSlotIndex]) base[dhSlotIndex] = { ...base[dhSlotIndex], id: latestDhId };
          return base;
        });

        const dhPlayer = updatedTeamPlayers.find((p) => p.id === latestDhId);
        if (dhPlayer) {
          setBattingReplacements((prev) => ({ ...prev, [dhSlotIndex]: dhPlayer }));
        }
      }
    }
  }
}

    setInitialAssignments(newAssignments);
    setUsedPlayerInfo(usedInfo);
    const match =
  (await localForage.getItem("matchInfo")) as
    | { inning?: number; isHome?: boolean }
    | null;

const inning = Number(match?.inning ?? 1);
const isVisitor = match?.isHome === false;

const hasPinchAtLoad = Object.values(usedInfo || {}).some((info: any) => {
  const reason = String(info?.reason ?? "").trim();
  return (
    reason === "代打" ||
    reason === "代走" ||
    reason === "臨時代走"
  );
});

setShouldGoSeatIntroductionAfterConfirm(
  isVisitor && inning === 1 && hasPinchAtLoad
);

console.log("[SEAT INTRO FLAG]", {
  inning,
  isVisitor,
  hasPinchAtLoad,
  shouldGo: isVisitor && inning === 1 && hasPinchAtLoad,
});
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

const previewState = React.useMemo(() => {
  const effectiveBattingOrder =
    battingOrderDraft?.length === 9 ? battingOrderDraft : battingOrder ?? [];

  return {
    battingOrder: effectiveBattingOrder,
    assignments: assignments ?? {},
    usedPlayerInfo: (usedPlayerInfo ?? {}) as UsedPlayerInfoMap,
  };
}, [battingOrder, battingOrderDraft, assignments, usedPlayerInfo]);

const currentGameState = React.useMemo(() => {
  return deriveCurrentGameState({
    battingOrder: previewState.battingOrder,
    assignments: previewState.assignments,
    usedPlayerInfo: previewState.usedPlayerInfo,
  });
}, [previewState]);

// --- ここから：控えを「未出場」と「出場済み」に分けるヘルパー ---
const onFieldIds = React.useMemo(() => {
  return new Set(currentGameState.onFieldPlayerIds);
}, [currentGameState]);


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
  () => benchPlayers.filter((p) => !playedIds.has(p.id) && !onFieldIds.has(p.id)),
  [benchPlayers, playedIds, onFieldIds]
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

const benchCandidates = React.useMemo(() => {
  const list = [...benchNeverPlayed, ...benchPlayedOut];
  const seen = new Set<string>();
  return list.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}, [benchNeverPlayed, benchPlayedOut]);

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

// ★打順表示用：大谷ルールONで「投手＝DH（同一人物）」のときは「指」表示にする
const getOrderDisplayPos = (as: Record<string, number | null>, pid: number | null) => {
  if (!pid) return "";
  if (ohtaniRule && as?.["投"] === pid && as?.["指"] === pid) return "指";
  return getPositionName(as, pid);
};

const announcementText = useMemo(() => {
// ★追加：交代アナウンスも「画面表示と同じ打順（draft優先）」を参照する
const orderSrc = (battingOrderDraft?.length ? battingOrderDraft : battingOrder) || [];

// --- リエントリー専用（複数件対応） ---
let reentryLines: string[] = [];

  const changes: ChangeRecord[] = [];

battingOrder.forEach((entry, index) => {
  const starter = teamPlayers.find(p => p.id === entry.id);
  if (!starter) return;

  // ★大谷ルール：投手=DH のときだけ、打順表示では「指」を優先
  function getOrderDisplayPos(
    as: Record<string, number | null> | undefined,
    pid: number | null,
    isOhtaniActive: boolean
  ) {
    if (!pid || !as) return "";
    if (isOhtaniActive && as["投"] === pid && as["指"] === pid) return "指";
    return getPositionName(as, pid);
  }

  // --- 元の守備位置（initialAssignments 基準） ---
  const isOhtaniInitial =
    typeof initialAssignments?.["投"] === "number" &&
    typeof initialAssignments?.["指"] === "number" &&
    initialAssignments["投"] === initialAssignments["指"];

  const originalPos = getOrderDisplayPos(
    initialAssignments,
    starter.id,
    isOhtaniInitial
  );

  const replacement = battingReplacements[index];

  const isOhtaniActive =
    typeof assignments?.["投"] === "number" &&
    typeof assignments?.["指"] === "number" &&
    assignments["投"] === assignments["指"];

if (replacement) {
  let newPos = getOrderDisplayPos(assignments, replacement.id, isOhtaniActive);

  // ✅ 大谷ルールありで「DHに代打」直後は、代打選手が守備に就いていないため
  // newPos が空になりやすい → その場合も「指」の交代として扱う
  if (isOhtaniInitial && isOhtaniActive && originalPos === "指" && !newPos) {
    newPos = "指";
  }

  // ✅ 同じ選手かどうか
  if (replacement.id === starter.id) {
    if (originalPos !== newPos) {
      // 同一選手だがポジションが変わっている → shift
      changes.push({
        type: "shift",
        order: index + 1,
        player: starter,
        fromPos: originalPos,
        toPos: newPos,
      });
    } else {
      // 同一選手・同一守備位置 → スキップ
      console.log(
        `[SKIP] ${starter.lastName}くん 同一守備位置に戻ったためスキップ`
      );
    }
    return;
  }

  // 交代
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
}

  else {
    // 守備位置変更のみ
    const newPos = getOrderDisplayPos(assignments, starter.id, isOhtaniActive);
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
  ohtaniRule, 
  reentryPreviewIds, 
  reentryFixedIds);


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
    //lines.splice(headerIdx + 1, 0, "ただいまより、指名打者制を解除します。");
    //return lines.join("\n");
  }
  // ヘッダーが見つからなければ先頭に付ける（保険）
  //return `ただいまより、指名打者制を解除します。\n${txt}`;
  return `${txt}`;
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


}, [battingOrder, assignments, initialAssignments, battingReplacements, teamName, teamPlayers,usedPlayerInfo,dupLastNamesTick]);

useEffect(() => {
  if (dirty) return; // ★手動で守備を触ったら、自動配置で上書きしない
  if (!battingOrder || !usedPlayerInfo) return;

  setAssignments((prev) => {
    const updatedAssignments = { ...prev };
    let changed = false;

    // 代打または代走として出場している選手を元の選手の位置に自動配置
    battingOrder.forEach((entry) => {
      const info: any = usedPlayerInfo[entry.id];
      if (
        info?.subId &&
        (entry.reason === "代打" || entry.reason === "代走" || entry.reason === "臨時代走")
      ) {
        const pos = initialAssignments
          ? Object.entries(initialAssignments).find(([, pid]) => pid === entry.id)?.[0]
          : undefined;

        if (pos && updatedAssignments[pos] !== info.subId) {
          updatedAssignments[pos] = info.subId;
          changed = true;
        }
      }
    });

    return changed ? updatedAssignments : prev;
  });
}, [battingOrder, usedPlayerInfo, initialAssignments, dirty]);


// 代打/代走を assignments に反映する useEffect の後
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

const getDisplayedPlayerIdForPos = (pos: string): number | null => {
  // DH は既存ロジック優先

  const assignedId =
    typeof assignments?.[pos] === "number" ? Number(assignments[pos]) : null;

  // その守備位置に紐づく pinch chain 情報
  const pinchInfoForPos = (() => {
    for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
      if (!info) continue;

      const reason = String((info as any).reason ?? "").trim();
      if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

      const sym =
        (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
      if (sym !== pos) continue;

      const origId = Number(origIdStr);
      const subId =
        typeof (info as any).subId === "number" ? Number((info as any).subId) : null;
      const latestId = resolveLatestSubId(origId, usedPlayerInfo as any);

      return { origId, subId, latestId, info };
    }
    return null;
  })();

  // pinch履歴が無ければ素直に assignments → currentGameState
  if (!pinchInfoForPos) {
    if (typeof assignedId === "number") return assignedId;

    const rawCurrent =
      typeof currentGameState?.fieldByPos?.[pos] === "number"
        ? Number(currentGameState.fieldByPos[pos])
        : null;

    return rawCurrent;
  }

  const { origId, subId, latestId } = pinchInfoForPos;

  const assignedIsOrig = typeof assignedId === "number" && Number(assignedId) === Number(origId);
  const assignedIsSub =
    typeof assignedId === "number" && subId != null && Number(assignedId) === Number(subId);
  const assignedIsLatest =
    typeof assignedId === "number" && Number(assignedId) === Number(latestId);

  const assignedIsStarter =
    typeof assignedId === "number" &&
    Object.values(initialAssignments || {}).some((id) => Number(id) === Number(assignedId));

  const assignedIsReentryBlue =
    typeof assignedId === "number" && isReentryBlueId(Number(assignedId));

  // ✅ 最優先:
  // 手でその守備を触って、そこに元スタメン(=リエントリー選手)を置いたなら
  // 旧代打/代走ではなく、その assignedId を表示する
  if (touchedFieldPos.has(pos) && typeof assignedId === "number") {
    if (assignedIsOrig || assignedIsStarter || assignedIsReentryBlue) {
      return assignedId;
    }
  }

  // ✅ まだ手で触っていない間だけ、pinch chain の末端を優先
  if (!touchedFieldPos.has(pos)) {
    if (typeof latestId === "number") return latestId;
    if (subId != null) return subId;
  }

  // ✅ 手で触った後でも、assignments に旧pinch側が残っているなら末端へ補正
  if (typeof assignedId === "number") {
    if (assignedIsSub || assignedIsLatest) {
      return latestId;
    }
    return assignedId;
  }

  // 最後のフォールバック
  const rawCurrent =
    typeof currentGameState?.fieldByPos?.[pos] === "number"
      ? Number(currentGameState.fieldByPos[pos])
      : null;

  return rawCurrent;
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

type BenchDropPayload = {
  toPos: string;
  playerId: number;        // ベンチから入る選手
  replacedId: number | null; // そこにいた選手
};

const applyBenchDropToField = ({ toPos, playerId, replacedId }: BenchDropPayload) => {
  const incoming = teamPlayers.find((p) => p.id === playerId) ?? null;
  if (!incoming) return;

  setAssignments((prev) => {
    let newAssignments = { ...prev };

    for (const pos of Object.keys(newAssignments)) {
      if (pos !== toPos && Number(newAssignments[pos]) === Number(playerId)) {
        newAssignments[pos] = null;
      }
    }

    const dhActive = typeof prev["指"] === "number" && prev["指"] != null;
    const skipBattingSync = dhActive && toPos === "投";

    if (!skipBattingSync) {
      const displayedIdAtPos = (() => {
        const pinchRunnerInfo = Object.values(usedPlayerInfo || {}).find((x: any) => {
          if (!x) return false;
          if (!["代走", "臨時代走"].includes(String(x.reason ?? ""))) return false;
          const sym = (posNameToSymbol as any)[x.fromPos] ?? x.fromPos;
          return sym === toPos && typeof x.subId === "number";
        });

        if (pinchRunnerInfo && typeof (pinchRunnerInfo as any).subId === "number") {
          return Number((pinchRunnerInfo as any).subId);
        }

        if (typeof replacedId === "number") return replacedId;
        if (typeof prev[toPos] === "number") return Number(prev[toPos]);

        return null;
      })();

      if (typeof displayedIdAtPos === "number") {
        let orderIdx = battingOrder.findIndex((entry, idx) => {
          const displayId = battingReplacements[idx]?.id ?? entry.id;
          return Number(displayId) === Number(displayedIdAtPos);
        });

        if (orderIdx < 0) {
          const starterIdAtPos = initialAssignments?.[toPos];
          if (typeof starterIdAtPos === "number") {
            orderIdx = startingOrderRef.current.findIndex(
              (e) => Number(e?.id) === Number(starterIdAtPos)
            );
          }
        }

        if (orderIdx >= 0) {
          setBattingReplacements((prevRep) => ({
            ...prevRep,
            [orderIdx]: incoming,
          }));
        }
      }
    }

newAssignments[toPos] = playerId;

const allowPitcherDhDuplicate =
  typeof newAssignments["投"] === "number" &&
  typeof newAssignments["指"] === "number" &&
  typeof initialAssignments?.["投"] === "number" &&
  typeof initialAssignments?.["指"] === "number" &&
  Number(initialAssignments["投"]) === Number(initialAssignments["指"]) &&
  Number(newAssignments["投"]) === Number(newAssignments["指"]);

newAssignments = normalizeFieldAssignments(newAssignments, {
  allowPitcherDhDuplicate,
});

    if (typeof replacedId === "number") {
      updateLog(toPos, replacedId, toPos, playerId);
    } else {
      updateLog(toPos, null, toPos, playerId);
    }

    return newAssignments;
  });

  setTouchedFieldPos((prev) => {
    const next = new Set(prev);
    next.add(toPos);
    return next;
  });

  setBenchPlayers((prev) => {
    let next = prev.filter((p) => p.id !== playerId);

    if (typeof replacedId === "number" && replacedId !== playerId) {
      const rep = teamPlayers.find((p) => p.id === replacedId);
      if (rep && !next.some((p) => p.id === rep.id)) {
        next = [...next, rep];
      }
    }

    return next;
  });

  setHoverPos(null);
  setDraggingFrom(null);
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

// ✅ 大谷ルールON：DH（指）の選手は他の守備位置へ移動禁止（指→他守備をブロック）
// ✅ 大谷ルール：この操作の時点で有効か？を毎回再計算する
// 「DHに代走(代打)が入った時点で大谷ルール解除」→ 以後は通常DH扱いにする
let ohtaniEffective = ohtaniRule;

if (ohtaniEffective) {
  const p0 = typeof initialAssignments?.["投"] === "number" ? Number(initialAssignments["投"]) : null;
  const d0 = typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;
  const startedAsOhtani = p0 != null && d0 != null && p0 === d0;

  if (startedAsOhtani && d0 != null) {
    const info = (usedPlayerInfo as any)?.[d0]; // DHスターター（=投手）に紐づく代走/代打記録
    const fromSym =
      info?.fromPos ? ((posNameToSymbol as any)[info.fromPos] ?? info.fromPos) : null;

    const isDhPinch =
      !!info &&
      fromSym === "指" &&
      ["代走", "臨時代走", "代打"].includes(String(info.reason ?? ""));

    if (isDhPinch) {
      ohtaniEffective = false;

      // 次の操作でも確実に通常DHになるように state/永続化も落とす
      setOhtaniRule(false);
      ohtaniRuleAtOpenRef.current = false;
      void localForage.setItem("ohtaniRule", false);

      console.log("[OHTANI] auto disabled (DH pinch detected)", { d0, info });
    }
  }
}

// ✅ 大谷ルールが“まだ有効”な場合だけ、指→他守備をブロック
// ✅ 大谷ルール：今この瞬間に「投＝指」か？＋DHに代走/代打が入ったら解除（通常DH化）
const pitcherNowId = assignments?.["投"];
const dhNowId = assignments?.["指"];
const dhOrigId =
  typeof initialAssignments?.["指"] === "number"
    ? Number(initialAssignments["指"])
    : null;

// DHに代走/代打が入っているか（= 大谷ルール解除条件）
const hasDhPinch = (() => {
  const isPinchReason = (r: any) =>
    ["代走", "臨時代走", "代打"].includes(String(r ?? ""));

  // 1) DHスターターIDで直接引けるケース
  if (dhOrigId != null) {
    const info = (usedPlayerInfo as any)?.[dhOrigId];
    if (info) {
      const fromSym = info?.fromPos
        ? ((posNameToSymbol as any)[info.fromPos] ?? info.fromPos)
        : null;
      if (fromSym === "指" && isPinchReason(info?.reason)) return true;
    }
  }

  // 2) キーが別IDになっているケースもあるので全走査
  try {
    const vals = Object.values((usedPlayerInfo as any) || {});
    return vals.some((info: any) => {
      const fromSym = info?.fromPos
        ? ((posNameToSymbol as any)[info.fromPos] ?? info.fromPos)
        : null;
      return fromSym === "指" && isPinchReason(info?.reason);
    });
  } catch {
    return false;
  }
})();

// 「本当に大谷状態」= 投手IDとDH IDが一致、かつDHに代走/代打が入っていない
const isOhtaniNow =
  ohtaniRule &&
  typeof pitcherNowId === "number" &&
  typeof dhNowId === "number" &&
  pitcherNowId === dhNowId &&
  !hasDhPinch;

// 指→他守備のブロックは「本当に大谷状態」のときだけ
if (ohtaniRule && srcFrom === "指" && toPos !== "指") {
  if (!isOhtaniNow) {
    // ✅ ここが要件：DHに代走が入った時点で「通常DH」へ（永続的に解除）
    console.log("[OHTANI] auto disabled (DH pinch detected => normal DH)", {
      pitcherNowId,
      dhNowId,
      dhOrigId,
      hasDhPinch,
    });
    setOhtaniRule(false);
    try {
      ohtaniRuleAtOpenRef.current = false;
    } catch {}
    void localForage.setItem("ohtaniRule", false);
    // returnしない（= 通常DHとして処理を続行）
  } else {
    window.alert(
      "大谷ルール中は、指名打者（DH）の選手を他の守備位置へ配置できません。"
    );
    setHoverPos(null);
    setDraggingFrom(null);
    return;
  }
}


// ✅ ルール：DH（指）へ配置できるのは「控え（ベンチ）」からだけ
// フィールド上（投/捕/一/二/三/遊/左/中/右）から指へは移動禁止
if (toPos === "指" && srcFrom !== "控え") {
  window.alert("DH（指名打者）へ配置できるのは控え選手のみです。");
  setHoverPos(null);
  setDraggingFrom(null);
  return;
}

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
// ★ すでに成立したリエントリーは、この画面内では保持する
const keepExistingReentryBlue =
  toPos !== BENCH && reentryFixedIds.size > 0;

// ★ ベンチ→守備のときだけ、新規リエントリー成立判定を行う
// ==== v2 リエントリー判定 ====
if (!fromIsField && toPos !== BENCH) {
  const ok = checkReentryForBenchToField({
    toPos,
    toId: Number(toId),
    fromId: Number(fromId),
  });
  if (!ok) return;
} else {
  const keepExistingReentryBlue =
    toPos !== BENCH && reentryFixedIds.size > 0;

  if (!keepExistingReentryBlue) {
    resetBlue?.();
  }
}




// ↓↓↓ この後の既存処理（setAssignments など）は “上で算出した toId/fromId/srcFrom” を使う ↓↓↓


    // ---- ここまで追加（判定・青枠・ログ）----

    if (!srcFrom) return;

    // 『指』にドロップされたら、DH解除の保留を取り消す（＝DH継続に戻す）
    if (toPos === "指" && (dhDisableDirty || pendingDisableDH)) {
      setDhDisableDirty(false);
      setPendingDisableDH(false);
    }
    // ✅ 大谷ルールON：フィールド図の「指」ドロップは assignments["指"] を触らず
    // 「打順のDHスロット」を入れ替える（＝DH表示と一致させる）
    if (toPos === "指" && ohtaniRule) {
      const dhStarterId = initialAssignments?.["指"];
      const dhSlotIndex =
        typeof dhStarterId === "number"
          ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
          : -1;

      // DHスロットが特定できないなら従来処理へ
      if (dhSlotIndex >= 0) {
        const idStr =
          e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
        const playerId = Number(idStr);
        const player = teamPlayers.find(p => p.id === playerId);
        if (!player) return;

        // 今DHに入っている選手（打順側）
        const currentDhId =
          (battingReplacements[dhSlotIndex]?.id ??
            (battingOrderDraft?.[dhSlotIndex]?.id ?? battingOrder[dhSlotIndex]?.id)) ?? null;

        // 打順側を差し替え（表示用）
        setBattingReplacements(prev => ({ ...prev, [dhSlotIndex]: player }));

        // フィールド図が battingOrderDraft を見ているため、draftも更新して一致させる
        setBattingOrderDraft(prev => {
          const base = (prev?.length ? [...prev] : [...battingOrder]);
          if (base[dhSlotIndex]) {
            base[dhSlotIndex] = { ...base[dhSlotIndex], id: playerId };
          }
          return base;
        });

        // ベンチ表示の整合：入った選手はベンチから消し、元DHはベンチへ戻す
        setBenchPlayers(prev => {
          let next = prev.filter(p => p.id !== playerId);
          if (typeof currentDhId === "number" && currentDhId !== playerId) {
            const prevDh = teamPlayers.find(p => p.id === currentDhId);
            if (prevDh && !next.some(p => p.id === prevDh.id)) {
              next = [...next, prevDh];
            }
          }
          return next;
        });

        // ログ（任意）
        updateLog(BENCH, playerId, "指", typeof currentDhId === "number" ? currentDhId : null);

        setDraggingFrom(null);
        // ✅ アナウンス連動のため「現在のDH」を assignments にも同期する
        setAssignments(prev => ({
          ...prev,
          ["指"]: playerId,
        }));

        // ✅ DHに代打が入った瞬間に「大谷ルール」を解除して通常DHへ
        setOhtaniRule(false);

        
        return; // ✅ ここで通常の assignments 分岐へ行かない
      }
    }

    // ★ 投手（投）を他守備にドロップ → DH解除 ＆ 指名打者の打順に投手を入れる
    // （大谷ルールでも通常DHでも同じ扱いにする）
    if (srcFrom === "投" && toPos !== BENCH && toPos !== "投" && assignments?.["指"]) {
      setAssignments((prev) => {
        setOhtaniRule(false);

        const pitcherId = prev["投"];
        if (typeof pitcherId !== "number") return prev;

        const replacedId = prev[toPos] ?? null; // 移動先にいた選手（いなければnull）
        const next: any = { ...prev };

        // 1) 守備：投手を toPos へ、投の枠には移動先の選手（or null）を入れる（入替）
        next[toPos] = pitcherId;
        next["投"] = replacedId;

        // 2) DH解除：指名打者を消す（DH枠は空に）
        next["指"] = null;

        // ✅ 追加：大谷ルール時は「フィールド図が打順側DHスロットを見る」ので、そこも空にする
        if (ohtaniRule) {
          const dhStarterId =
            typeof initialAssignments?.["指"] === "number" ? (initialAssignments["指"] as number) : null;

          let dhSlotIndex = -1;
          if (dhStarterId != null) {
            dhSlotIndex = startingOrderRef.current.findIndex((e) => e.id === dhStarterId);
            if (dhSlotIndex < 0) dhSlotIndex = battingOrder.findIndex((e) => e.id === dhStarterId);
          }

          if (dhSlotIndex >= 0) {
            // フィールド図に使っている draft を空にしてDH表示を確実に消す
            setBattingOrderDraft((prevDraft) => {
              const base = (prevDraft?.length ? [...prevDraft] : [...battingOrder]);
              if (base[dhSlotIndex]) base[dhSlotIndex] = { ...base[dhSlotIndex], id: 0 };
              return base;
            });

            // 表示ブレ防止：DH枠の置換も消す（※この後で投手を入れるなら、ここで消してOK）
            setBattingReplacements((prevRep) => {
              const n = { ...prevRep } as any;
              delete n[dhSlotIndex];
              return n;
            });
          }
        }

        // 3) DH解除フラグ（既存の流れに合わせる）
        setDhEnabledAtStart(false);
        setDhDisableDirty(true);
        setPendingDisableDH(false);
        if (ohtaniRule) setOhtaniRule(false);

        // 4) 「指名打者の打順」に投手を入れる
        //    DHの打順スロット＝ initialAssignments["指"] の選手がいた打順
        const dhStarterId =
          typeof initialAssignments?.["指"] === "number" ? (initialAssignments["指"] as number) : null;

        let dhSlotIndex = -1;
        if (dhStarterId != null) {
          dhSlotIndex = startingOrderRef.current.findIndex((e) => e.id === dhStarterId);
          if (dhSlotIndex < 0) dhSlotIndex = battingOrder.findIndex((e) => e.id === dhStarterId);
        }
        const pitcherPlayer = teamPlayers.find((p) => p.id === pitcherId);
        if (pitcherPlayer && dhSlotIndex >= 0) {
          setBattingReplacements((prevRep) => ({
            ...prevRep,
            [dhSlotIndex]: pitcherPlayer,
          }));
        }

        // 5) ログ
        updateLog("投", pitcherId, toPos, replacedId);

        return next;
      });

      setHoverPos(null);
      setDraggingFrom(null);
      return;
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
      const draftInsertId =
        srcFrom === "指" && toPos !== "指" && typeof assignments?.["投"] === "number"
          ? Number(assignments["投"])
          : Number(toId);

      next[idx] = { ...next[idx], id: draftInsertId };
      console.log("✍️ ドラフト打順更新", {
        slot: idx + 1,
        fromId,
        toId,
        draftInsertId,
        next,
      });
    }
    return next;
  });
}

      setDraggingFrom(null);
      return;
    }
      setAssignments((prev) => {
      const newAssignments = { ...prev };

      // ✅ ここが重要：draggingFrom をベンチ表記ゆれ込みで正規化
      const fromPos = normalizeFrom(draggingFrom) as any;

      // ===== フィールド ↔ フィールド（入替/移動）=====
      if (fromPos !== BENCH && toPos !== BENCH && fromPos !== toPos) {
        const fromId = getDisplayedPlayerIdForPos(fromPos);
        const toId = getDisplayedPlayerIdForPos(toPos);



        // ▼ A(先発)にしかロックは効かせない
        if (fromId != null && isStarter(fromId)) {
          const expected = pairLocks[fromId];
          if (expected != null && expected !== toId) {
            window.alert("先発選手の交代はロック中です（先に相手を元の位置へ戻してください）。");
            return prev;
          }
        }

        // ✅ 入替/移動
        newAssignments[toPos] = fromId ?? null;
        newAssignments[fromPos] = toId ?? null;

        // ✅ 大谷ルールON：投手（投）を他守備に動かしたらDH解除扱いにして「指」を空にする
        //   ＝ フィールド図のDH選手を無しにする（大谷ルールなしと同じ動きに寄せる）
        const dhActive = typeof prev["指"] === "number" && prev["指"] != null;

        if (ohtaniRule && dhActive && fromPos === "投" && toPos !== "投") {
          // フィールド図：DHを空に
          newAssignments["指"] = null;

          // 解除状態フラグ（既存のDH解除ボタンと同じ扱い）
          setPendingDisableDH(false);
          setDhDisableDirty(true);
          setDhEnabledAtStart(false);

          // （任意）大谷ルール時にフィールド図が打順側DHスロットを見てしまう場合の保険
          // → DH表示を確実に消したいなら併用
          const dhStarterId = initialAssignments?.["指"];
          const dhSlotIndex =
            typeof dhStarterId === "number"
              ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
              : -1;

          if (dhSlotIndex >= 0) {
            setBattingOrderDraft(prevDraft => {
              const base = (prevDraft?.length ? [...prevDraft] : [...battingOrder]);
              if (base[dhSlotIndex]) base[dhSlotIndex] = { ...base[dhSlotIndex], id: 0 }; // 0=空扱い
              return base;
            });
          }
        }

        // （この下に既存のDH解除判定などが続く想定）
        // ※ ここで使っている draggingFrom を fromPos に置き換えるのがポイント

        // 例：以前位置保存（ここも fromPos）
        if (fromId != null) {
          setPreviousPositions((prevMap) => ({ ...prevMap, [fromId]: fromPos }));
        }

        // ▼ 指名打者（DH）→守備 のときは…（ここも fromPos）
        if (fromPos === "指" && fromId != null && toId != null) {
          const targetIndex = battingOrder.findIndex(e => e.id === toId);
          if (targetIndex !== -1) {
            const pitcherId =
              typeof prev["投"] === "number" ? prev["投"] :
              (typeof assignments?.["投"] === "number" ? assignments["投"] : null);
            const pitcher = pitcherId != null ? teamPlayers.find(p => p.id === pitcherId) : null;

            setBattingReplacements(prevRep => {
              const next = { ...prevRep };
              if (pitcher) next[targetIndex] = pitcher;
              return next;
            });
          }
        }

        // ✅ フィールド↔フィールドを触った位置は「代打優先表示」を無効化する（両方）
        setTouchedFieldPos(prevSet => {
          const next = new Set(prevSet);
          next.add(fromPos);
          next.add(toPos);
          return next;
        });

        updateLog(fromPos, fromId, toPos, toId);
        return newAssignments;
      }

      // ===== ベンチ → フィールド（配置）=====
// ===== ベンチ → フィールド（配置）=====
if (fromPos === BENCH && toPos !== BENCH) {
  console.log("✅ BENCH DROP branch", { fromPos, toPos });

  const playerIdStr =
    e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
  if (!playerIdStr) return prev;

  const playerId = Number(playerIdStr);

  // ✅ 画面に実際に表示されている選手IDを使う
  const replacedId = getDisplayedPlayerIdForPos(toPos);

  // ✅ 本体処理は共通関数へ
  applyBenchDropToField({ toPos, playerId, replacedId });

  // ここでは prev を返す（更新は applyBenchDropToField 内の setAssignments で行う）
  return prev;
}



      // ※ ここから下は元のコードの続き（return newAssignments / return prev など）を残してください
      return prev;
    });

    // ---- assignments 更新の直後に追加 ----
      const isOhtaniStart =
      ohtaniRule &&
      typeof initialAssignments?.["投"] === "number" &&
      typeof initialAssignments?.["指"] === "number" &&
      Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

    // srcFrom は上で normalizeFrom 済みだが、dtPid だけ来た場合に "ベンチ" 文字が入る分岐もあるため両対応
    const fromIsBench = srcFrom === BENCH || srcFrom === "ベンチ";

    // 大谷開始（投＝指）で「控え→投」は、DHスロットまで巻き込むので打順ドラフトの置換をしない
    const shouldSkipDraftSwap = isOhtaniStart && fromIsBench && toPos === "投";

    // 打順更新してよいのは「控え→守備」のときだけ
    const shouldUpdateDraftBattingOrder =
      fromIsBench && !shouldSkipDraftSwap && isNumber(toId) && isNumber(fromId);

    if (shouldUpdateDraftBattingOrder) {
      setBattingOrderDraft((prev) => {
        const next = [...prev];
        const idx = next.findIndex((e) => e.id === fromId);
        if (idx >= 0) {
          next[idx] = { ...next[idx], id: toId };
          console.log("✍️ ドラフト打順更新", { slot: idx + 1, fromId, toId, next });
        }
        return next;
      });
    } else if (fromIsField) {
      console.log("↔️ 守備位置交換のため打順更新しない", {
        srcFrom,
        fromId,
        toId,
        toPos,
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
  console.log("[DEBUG] confirm clicked", { assignments, battingReplacements });

  await pushHistory(); // ★確定直前スナップショットを永続化まで行う

  let usedInfo: Record<
    number,
    {
      fromPos: string;
      subId: number;
      reason: "守備交代";
      order: number | null;
      wasStarter: boolean;
      hasReentered?: boolean;
    } & Record<string, any>
  > = ((await localForage.getItem("usedPlayerInfo")) || {}) as any;

  let finalAssignments = { ...assignments };
  let finalBattingOrder = [...battingOrder];
  let finalDhEnabledAtStart = dhEnabledAtStart;



  // =========================================================
  // 1) 画面に表示されている守備選手を finalAssignments に同期
  // =========================================================
for (const pos of positions) {
  if (pos === "指") continue;

  const assignedId =
    typeof assignments?.[pos] === "number" ? Number(assignments[pos]) : null;

  // 守備位置は UI の最終配置を正とする
  const displayedId: number | null = assignedId;

  if (typeof displayedId === "number") {
    finalAssignments[pos] = displayedId;
  }
}

  console.log("[CONFIRM SYNC] finalAssignments after display sync", finalAssignments);

  // ★ ここで一度だけ作る。以後これを使い回す
  const finalOnFieldIds = new Set<number>(
    Object.values(finalAssignments).filter((v): v is number => typeof v === "number")
  );
  console.log("[STEP] finalOnFieldIds created", [...finalOnFieldIds]);

  const refreshedOnFieldIds = finalOnFieldIds;


  // =========================================================
  // 3) battingReplacements の確定反映
  // =========================================================
  Object.entries(battingReplacements || {}).forEach(([idxStr, repl]: any) => {
    const idx = Number(idxStr);
    if (!repl || typeof repl.id !== "number") return;
    if (!finalBattingOrder[idx]) return;

    finalBattingOrder[idx] = {
      ...finalBattingOrder[idx],
      id: repl.id,
    };
  });



  // =========================================================
  // 5) DH解除
  // =========================================================
  if (pendingDisableDH) {
    const dhId = dhDisableSnapshot?.dhId ?? finalAssignments["指"];
    const pitcherId = dhDisableSnapshot?.pitcherId ?? finalAssignments["投"];

    if (typeof dhId === "number" && typeof pitcherId === "number") {
      const idx = finalBattingOrder.findIndex((e) => e.id === dhId);
      if (idx !== -1) {
        finalBattingOrder[idx] = { id: pitcherId, reason: "スタメン" };
      }
    } else {
      window.alert("DH解除に必要な情報（指名打者 or 投手）が不足しています。");
      return;
    }

    finalAssignments["指"] = null;
    finalDhEnabledAtStart = false;

    setDhDisableSnapshot(null);
    setPendingDisableDH(false);
    setDhDisableDirty(false);
  }

  // =========================================================
  // 6) 開始時打順取得
  // =========================================================
  const startingOrder: Array<{ id: number; reason?: string }> =
    ((await localForage.getItem("startingBattingOrder")) || []) as any;

  // =========================================================
  // 7) 大谷ルール時、DH枠の実体を同期
  // =========================================================
  if (ohtaniRule && finalDhEnabledAtStart && !pendingDisableDH) {
    const dhStarterId =
      typeof initialAssignments?.["指"] === "number"
        ? Number(initialAssignments["指"])
        : null;

    if (dhStarterId != null) {
      const dhNowId = resolveLatestSubId(dhStarterId, usedInfo) ?? dhStarterId;
      finalAssignments["指"] = dhNowId;
    }
  }

  // =========================================================
  // 8) 守備交代で usedInfo を更新
  // =========================================================
  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];
    const currentId = finalAssignments[pos];
    const playerChanged = initialId && currentId && initialId !== currentId;

    if (!playerChanged) return;

    const idxNow = battingOrder.findIndex((e) => e.id === initialId);
    const idxStart = startingOrder.findIndex((e) => e.id === initialId);
    const order: number | null =
      idxNow !== -1 ? idxNow + 1 : idxStart !== -1 ? idxStart + 1 : null;

    const wasStarter = idxStart !== -1;

    const battingReasonNow = idxNow !== -1 ? battingOrder[idxNow]?.reason : undefined;
    const fromPos =
      battingReasonNow === "代打"
        ? "代打"
        : battingReasonNow === "代走"
        ? "代走"
        : battingReasonNow === "臨時代走"
        ? "臨時代走"
        : pos;

    usedInfo[initialId] = {
      fromPos,
      subId: currentId!,
      reason: "守備交代",
      order,
      wasStarter,
    } as any;
  });

  // =========================================================
  // 9) 守備に就いた代打/代走/臨時代走の痕跡を掃除
  //    → 以後「先ほど代走いたしました」を出さない
  // =========================================================
  console.log("[REENTRY CLEANUP] finalAssignments", finalAssignments);
  console.log("[REENTRY CLEANUP] usedInfo before", structuredClone(usedInfo));

  for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
    if (!info) continue;

    const origId = Number(origIdStr);
    const reason = String((info as any)?.reason ?? "");
    const fromPosRaw = String((info as any)?.fromPos ?? "");
    const isPinchSource =
      ["代打", "代走", "臨時代走"].includes(reason) ||
      ["代打", "代走", "臨時代走"].includes(fromPosRaw);

    if (!isPinchSource) continue;

    const subId =
      typeof (info as any)?.subId === "number"
        ? Number((info as any).subId)
        : null;

    const latestId = resolveLatestSubId(origId, usedInfo as any);
    const settledId =
      typeof latestId === "number" ? latestId : subId != null ? subId : null;

    if (
      refreshedOnFieldIds.has(origId) ||
      (settledId != null && refreshedOnFieldIds.has(settledId))
    ) {
      (usedInfo as any)[origIdStr] = {
        ...(usedInfo as any)[origIdStr],
        hasReentered: true,
      };

      delete (usedInfo as any)[origIdStr].reason;
      delete (usedInfo as any)[origIdStr].fromPos;
      delete (usedInfo as any)[origIdStr].subId;
    }
  }

  console.log("[REENTRY CLEANUP] usedInfo after", structuredClone(usedInfo));

  // 代走モーダル由来の一時フラグも掃除
  {
    const tempRunnerByOrder =
      ((await localForage.getItem("tempRunnerByOrder")) || {}) as Record<number, number>;
    const prevReasonByOrder =
      ((await localForage.getItem("prevReasonByOrder")) || {}) as Record<number, string | null>;

    let tempChanged = false;
    let prevChanged = false;

    Object.entries(tempRunnerByOrder).forEach(([orderStr, playerId]) => {
      if (refreshedOnFieldIds.has(Number(playerId))) {
        delete tempRunnerByOrder[Number(orderStr)];
        tempChanged = true;

        if (orderStr in prevReasonByOrder) {
          delete prevReasonByOrder[Number(orderStr)];
          prevChanged = true;
        }
      }
    });

    if (tempChanged) {
      await localForage.setItem("tempRunnerByOrder", tempRunnerByOrder);
    }
    if (prevChanged) {
      await localForage.setItem("prevReasonByOrder", prevReasonByOrder);
    }
  }

  await localForage.setItem("usedPlayerInfo", usedInfo);
  setUsedPlayerInfo({ ...(usedInfo as any) });

  console.log("✅ 守備交代で登録された usedPlayerInfo：", usedInfo);

  // =========================================================
  // 10) 打順を固定しつつ補正
  // =========================================================
const updatedOrder = structuredClone(finalBattingOrder);

// ✅ assignments の生値ではなく、usedPlayerInfo を反映した「実際に守備にいる選手ID」を使う
const effectiveSavedState = deriveCurrentGameState({
  battingOrder: updatedOrder,
  assignments: finalAssignments,
  usedPlayerInfo: (usedInfo ?? {}) as UsedPlayerInfoMap,
});

const onFieldIds = new Set<number>(effectiveSavedState.onFieldPlayerIds);

  // 守備に就いた代打/代走/臨時代走は pinch 表示情報を消す
  for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
    if (!info) continue;

    const subId =
      typeof (info as any).subId === "number" ? Number((info as any).subId) : null;
    const reason = String((info as any).reason ?? "");

    if (
      subId != null &&
      ["代打", "代走", "臨時代走"].includes(reason) &&
      onFieldIds.has(subId)
    ) {
      delete (usedInfo as any)[origIdStr].reason;
      delete (usedInfo as any)[origIdStr].fromPos;
    }
  }

  const pinchIds = Object.entries(usedInfo || {})
    .filter(([_, u]: any) => ["代打", "代走", "臨時代走"].includes(u?.fromPos))
    .map(([id]) => Number(id));

const hadPinchAtConfirmStart = pinchIds.length > 0;
console.log("[CONFIRM-CHECK] hadPinchAtConfirmStart", hadPinchAtConfirmStart);

  const missing = pinchIds.filter((id) => !onFieldIds.has(id));

  console.log("[CONFIRM-CHECK] pinchIds", pinchIds);
  console.log("[CONFIRM-CHECK] onFieldIds", [...onFieldIds]);
  console.log("[CONFIRM-CHECK] missing", missing);
  console.log("[CONFIRM-CHECK] finalAssignments", finalAssignments);

  const startersOrRegistered = new Set(
    updatedOrder.map((e) => e?.id).filter((id): id is number => typeof id === "number")
  );

  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];
    const currentId = finalAssignments[pos];

    if (!initialId || !currentId || initialId === currentId) return;

    const replacedIndex = updatedOrder.findIndex((e) => e.id === initialId);
    if (replacedIndex === -1) return;

    const currentIsAlreadyInOrder = startersOrRegistered.has(currentId);
    const initialStillOnField = onFieldIds.has(initialId);

    if (currentIsAlreadyInOrder && initialStillOnField) return;

    if (!currentIsAlreadyInOrder && !initialStillOnField) {
      updatedOrder[replacedIndex] = { id: currentId, reason: "途中出場" };
      startersOrRegistered.add(currentId);
    }
  });

  updatedOrder.forEach((entry, index) => {
    if (["代打", "代走", "臨時代走"].includes(entry?.reason) && onFieldIds.has(entry.id)) {
      updatedOrder[index] = { ...entry, reason: "途中出場" };
    }
  });

  updatedOrder.forEach((entry, idx) => {
    if (!entry) return;

    const isPinch = ["代打", "代走", "臨時代走"].includes(entry.reason);
    if (!isPinch) return;

    if (onFieldIds.has(entry.id)) return;

    const startId = startingOrder[idx]?.id;
    if (typeof startId !== "number") return;

    const latest = resolveLatestSubId(startId, usedInfo);
    if (typeof latest !== "number") return;

    if (onFieldIds.has(latest)) {
      updatedOrder[idx] = { id: latest, reason: "途中出場" };
      startersOrRegistered.add(latest);
    }
  });

  // =========================================================
  // 11) 大谷ルール時にDH枠の実体を再同期
  // =========================================================
  if (ohtaniRule) {
    const dhActiveNow = typeof finalAssignments?.["指"] === "number";
    const dhStarterId = initialAssignments?.["指"];
    const dhSlotIndex =
      typeof dhStarterId === "number"
        ? startingOrderRef.current.findIndex((e) => e.id === dhStarterId)
        : -1;

    if (dhActiveNow && dhSlotIndex >= 0) {
      const orderSrc = (battingOrderDraft?.length ? battingOrderDraft : battingOrder) || [];
      const dhId =
        battingReplacements?.[dhSlotIndex]?.id ?? orderSrc?.[dhSlotIndex]?.id ?? null;

      if (typeof dhId === "number") {
        finalAssignments["指"] = dhId;
      }
    }
  }

 const committedUsedInfo = Object.fromEntries(
  Object.entries(usedInfo || {}).map(([k, v]) => {
    const x = { ...(v as any) };

    // ✅ 次回の交代表示に持ち越してはいけない“今回だけの表示用情報”を消す
    delete x.reason;
    delete x.fromPos;
    delete x.toPos;
    delete x.subId;

    return [k, x];
  })
);

const committedOrder = updatedOrder.map((entry: any) => ({
  ...entry,
  reason:
    entry?.reason === "代打" ||
    entry?.reason === "代走" ||
    entry?.reason === "臨時代走"
      ? "途中出場"
      : entry?.reason ?? "",
}));

// =========================================================
// 12) 保存
// =========================================================
const prevPitchCounts =
  (await localForage.getItem<{
    current: number;
    total: number;
    pitcherId?: number | null;
  }>("pitchCounts")) || {
    current: 0,
    total: 0,
    pitcherId: null,
  };

const newPitcherId =
  typeof finalAssignments["投"] === "number" ? Number(finalAssignments["投"]) : null;

const prevPitcherId =
  typeof prevPitchCounts.pitcherId === "number"
    ? Number(prevPitchCounts.pitcherId)
    : null;

const pitcherTotalsMap =
  (await localForage.getItem<Record<number, number>>("pitcherTotals")) || {};

// ✅ 前投手がいなくても、新投手IDが変わったら投手交代とみなす
const didPitcherChange =
  newPitcherId !== prevPitcherId;

// ✅ 投手交代なら新投手の累計も 0 から始める
if (didPitcherChange && newPitcherId != null) {
  pitcherTotalsMap[newPitcherId] = 0;
  await localForage.setItem("pitcherTotals", pitcherTotalsMap);
}

const newCurrentPitchCount = didPitcherChange
  ? 0
  : Number(prevPitchCounts.current ?? 0);

const newTotalPitchCount = didPitcherChange
  ? 0
  : Number(prevPitchCounts.total ?? 0);

await localForage.setItem("pitchCounts", {
  current: newCurrentPitchCount,
  total: newTotalPitchCount,
  pitcherId: newPitcherId,
});

await localForage.setItem("lineupAssignments", finalAssignments);
await localForage.setItem("battingReplacements", {});
await localForage.setItem("battingOrder", committedOrder);
localStorage.setItem("battingOrderVersion", String(Date.now()));
await localForage.setItem("dhEnabledAtStart", finalDhEnabledAtStart);
await localForage.setItem("ohtaniRule", ohtaniRule);
await localForage.setItem("usedPlayerInfo", committedUsedInfo);

setBattingReplacements({});
setSubstitutionLogs([]);
setPairLocks({});

setShowSaveModal(false);
setShowLeaveConfirm(false);

setInitialAssignments(finalAssignments);
setAssignments(finalAssignments);

console.log("[SAVE CHECK] committedOrder =", committedOrder);
console.log("[SAVE CHECK] finalAssignments =", finalAssignments);
console.log("[SAVE CHECK] 2番 =", committedOrder[1]);

setBattingOrder(committedOrder);
setBattingOrderDraft(committedOrder);
setDhEnabledAtStart(finalDhEnabledAtStart);
setUsedPlayerInfo({ ...(committedUsedInfo as any) });

// 差分表示を終了
setTouchedFieldPos(new Set());
setReentryPreviewIds(new Set());
setReentryFixedIds(new Set());

// ✅ 保存後の確定状態を baseline にする
snapshotRef.current = JSON.stringify({
  assignments: finalAssignments,
  battingOrder: committedOrder,
  pendingDisableDH: false,
  dhDisableSnapshot: null,
  dhEnabledAtStart: finalDhEnabledAtStart,
});
setIsDirty(false);

// =========================================================
// 1回表・先攻チームで、代打/代走/臨時代走が入っている場合は
// 守備交代確定後にシート紹介画面へ進める
// =========================================================
const match =
  (await localForage.getItem("matchInfo")) as
    | { inning?: number; isTop?: boolean; isHome?: boolean }
    | null;

const inning = Number(match?.inning ?? 1);
const isVisitor = match?.isHome === false;

// ★ 保存後の committed～ ではなく、掃除前の updatedOrder / usedInfo を使って判定
const goSeatIntroduction = shouldGoSeatIntroductionAfterConfirm;

console.log("[SAVE CHECK] goSeatIntroduction =", goSeatIntroduction);
console.log("[SAVE CHECK] shouldGoSeatIntroductionAfterConfirm =", shouldGoSeatIntroductionAfterConfirm);

// ✅ 画面遷移は App.tsx 側に一本化
await onConfirmed({ goSeatIntroduction });

console.log("✅ onConfirmed called", { goSeatIntroduction });
return;
};

  // 新たにアナウンス表示だけの関数を定義
  const showAnnouncement = () => {
    setShowSaveModal(true);
  };
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
  console.log("[DefenseChange] back to defense (no commit)");

  // 「確定せずに戻る」場合は、画面オープン時点の大谷ルールへ戻す（storage も復元）
  if (ohtaniRule !== ohtaniRuleAtOpenRef.current) {
    setOhtaniRule(ohtaniRuleAtOpenRef.current);
    void localForage
      .setItem("ohtaniRule", ohtaniRuleAtOpenRef.current)
      .catch((e) => console.warn("failed to restore ohtaniRule on back", e));
  }

  // ✅ 守備画面へ戻すのは App.tsx 側の画面遷移（setScreen）で行う
  onConfirmed();
};

const checkReentryForBenchToField = ({
  toPos,
  toId,
  fromId,
}: {
  toPos: string;
  toId: number;
  fromId: number;
}): boolean => {
  // ★ すでに成立したリエントリーは、この画面内では保持する
  const keepExistingReentryBlue =
    toPos !== BENCH && reentryFixedIds.size > 0;

  if (!keepExistingReentryBlue) {
    resetBlue?.();
  }

  if (forceNormalSubOnce) {
    setForceNormalSubOnce(false);
    return true;
  }

  // toId = ベンチから来た選手
  const origIdForTo = resolveOriginalStarterId(toId, usedPlayerInfo, initialAssignments);
  const wasStarter = origIdForTo !== null;

  // ✅ 出場済み判定（元スタメンはorigId、途中出場はtoId自身）
  const isUsedAlready =
    (wasStarter && !!(usedPlayerInfo as any)?.[Number(origIdForTo)]) ||
    (!!(usedPlayerInfo as any)?.[Number(toId)]);

  // ✅ 未出場（控え）ならリエントリー判定せず通常交代
  if (!isUsedAlready) {
    if (!keepExistingReentryBlue) {
      resetBlue?.();
    }
    return true;
  }

  const isOffField = !Object.values(assignments || {}).includes(Number(toId));

  // ★ 元の打順：スタメン時点の打順を使う
  const originalOrderSource =
    startingOrderRef.current?.length === 9
      ? startingOrderRef.current
      : battingOrder;

  // ★ 現在の打順：確定前の見た目に合わせて draft を優先
  const currentOrderSource =
    battingOrderDraft?.length === 9
      ? battingOrderDraft
      : battingOrder;

  // ★ 戻そうとしている元スタメンの「当初の打順」
  const originalOrderIndex =
    wasStarter && origIdForTo != null
      ? originalOrderSource.findIndex(
          (e) => Number(e.id) === Number(origIdForTo)
        )
      : -1;

  // ★ 今、交代される選手(fromId)が入っている「現在の打順」
  const currentOrderIndexOfFrom =
    typeof fromId === "number"
      ? currentOrderSource.findIndex(
          (e) => Number(e.id) === Number(fromId)
        )
      : -1;

  const isReentryNow =
    wasStarter &&
    isOffField &&
    originalOrderIndex >= 0 &&
    currentOrderIndexOfFrom >= 0 &&
    originalOrderIndex === currentOrderIndexOfFrom;

  console.log("[REENTRY CHECK same-order][modal/common]", {
    toId,
    fromId,
    toPos,
    origIdForTo,
    wasStarter,
    isUsedAlready,
    isOffField,
    originalOrderIndex,
    currentOrderIndexOfFrom,
    originalOrderSource,
    currentOrderSource,
    isReentryNow,
  });

  if (isReentryNow) {
    markReentryBlue(Number(toId));
    return true;
  }

  if (!keepExistingReentryBlue) {
    resetBlue?.();
  }

  setPendingNonReentryDrop({
    toPos,
    playerId: Number(toId),
    replacedId: Number(fromId),
  });
  setShowNonReentryConfirm(true);
  setHoverPos(null);
  setDraggingFrom(null);
  return false;
};

// --- 守備番号で交代（●が● / ●に代わって）を反映する ---
const applyPosNumberChanges = () => {
  setDirty(true); 
  setPosNumberError(null);

  const rows = posNumberRows
    .map((r) => ({
      from: r.from.trim(),
      mode: r.mode,
      to: (r.to ?? "").trim(),
      benchPlayerId: (r.benchPlayerId ?? "").trim(),
    }))
    .filter((r) => r.from && (r.mode === "swap" ? r.to : r.benchPlayerId));

  const swapRows = rows.filter((r) => r.mode === "swap");
  const replaceRows = rows.filter((r) => r.mode === "replace");

  if (rows.length === 0) {
    setPosNumberError("1行以上入力してください。");
    return;
  }

// ✅ 1〜10チェック用（10 = 指名打者）
const isValidNum = (n: number) => Number.isInteger(n) && n >= 1 && n <= 10;
const hasDup = (arr: number[]) => new Set(arr).size !== arr.length;

// ✅ 全体の「出ていく集合」と「入る集合」を作る
//  - swap: from -> to
//  - replace: out(from) -> in(toがあればto、なければfrom)
const allFromNums: number[] = [];
const allToNums: number[] = [];

// swap分
swapRows.forEach((r) => {
  allFromNums.push(Number(r.from));
  allToNums.push(Number(r.to));
});

// replace分
replaceRows.forEach((r) => {
  const outNum = Number(r.from);
  const inNum = r.to && String(r.to).trim() ? Number(r.to) : outNum; // 未選択＝同じ守備
  allFromNums.push(outNum);
  allToNums.push(inNum);
});

// ✅ 全体として矛盾する重複はNG（同じ守備を2回いじらない）
if (hasDup(allFromNums) || hasDup(allToNums)) {
  setPosNumberError("左側（守備番号）/右側（入る守備）それぞれで同じ番号は重複できません。");
  return;
}

// ✅ 守備番号モーダルでも、出場済み選手の「控え→守備」は
//    フィールド図ドロップと同じリエントリー判定を通す
for (const r of replaceRows) {
  const fromNum = Number(r.from);
  const toNum = r.to && String(r.to).trim() ? Number(r.to) : fromNum;

  const toPos = numberToPosSymbol[toNum];
  const incomingId = Number(r.benchPlayerId);
  const replacedId = assignments?.[toPos];

  if (
    typeof incomingId === "number" &&
    !Number.isNaN(incomingId) &&
    typeof replacedId === "number"
  ) {
    const ok = checkReentryForBenchToField({
      toPos,
      toId: incomingId,
      fromId: Number(replacedId),
    });

    if (!ok) {
      // 非リエントリー確認モーダルを出したので、ここで中断
      return;
    }
  }
}

// ✅ swap+replace 全体で「出る番号集合」と「入る番号集合」が一致しているならOK
// これにより「別守備に入る交代 + 他行の守備位置変更」の組み合わせでもエラーを出さない
const fromSet = new Set(allFromNums);
const toSet = new Set(allToNums);
const sameSetAll = fromSet.size === toSet.size && [...fromSet].every((n) => toSet.has(n));

if (!sameSetAll) {
  setPosNumberError(
    "交代の指定は、左側と右側で同じ番号の組み合わせになるように入力してください。\n" +
      "（例：1が9、9が5、5が1 / 1に代わり控えが5、5が1 など）"
  );
  return;
}

  // ✅ replace側の最低限チェック
  if (replaceRows.some((r) => !r.benchPlayerId)) {
    setPosNumberError("「に代わって」を選んだ行は、控え選手を選択してください。");
    return;
  }

  const DEF_KEYS = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右"] as const;
  type DefKey = (typeof DEF_KEYS)[number];

  const benchAll = [...benchNeverPlayed, ...benchPlayedOut];

  // ✅ 先に「打順の差し替え」を確定させる（setAssignments内でpushしない）
  // outgoingId（交代される側） -> incomingId（入る側）
  const orderReplaceMap = new Map<number, number>();

  replaceRows.forEach(({ from, benchPlayerId }) => {
    const pos = numberToPosSymbol[Number(from)] as DefKey | undefined;
    if (!pos) return;

    const incoming = benchAll.find((p) => String(p.id) === String(benchPlayerId));
    if (!incoming) return;

    const outgoingId = getDisplayedIdForPositionNumberModal(pos);
    if (typeof outgoingId === "number") {
      orderReplaceMap.set(outgoingId, incoming.id);
    }

  });

    // ✅ 守備番号モーダル経由でも、リエントリー成立なら保持する
  {
    const originalOrderSource =
      startingOrderRef.current?.length === 9
        ? startingOrderRef.current
        : battingOrder;

    const currentOrderSource =
      battingOrderDraft?.length === 9
        ? battingOrderDraft
        : battingOrder;

    replaceRows.forEach(({ from, benchPlayerId }) => {
      const outPos = numberToPosSymbol[Number(from)] as DefKey | undefined;
      if (!outPos) return;

      const incoming = benchAll.find((p) => String(p.id) === String(benchPlayerId));
      if (!incoming) return;

      const outgoingId = getDisplayedIdForPositionNumberModal(outPos);
      if (typeof outgoingId !== "number") return;

      const origIdForTo = resolveOriginalStarterId(
        incoming.id,
        usedPlayerInfo as any,
        initialAssignments as any
      );
      const wasStarter = origIdForTo !== null;

      const isUsedAlready =
        (wasStarter && !!(usedPlayerInfo as any)?.[Number(origIdForTo)]) ||
        (!!(usedPlayerInfo as any)?.[Number(incoming.id)]);

      if (!isUsedAlready) return;

      const isOffField = !Object.values(assignments || {}).includes(Number(incoming.id));

      const originalOrderIndex =
        wasStarter && origIdForTo != null
          ? originalOrderSource.findIndex(
              (e) => Number(e.id) === Number(origIdForTo)
            )
          : -1;

      const currentOrderIndexOfFrom =
        currentOrderSource.findIndex(
          (e) => Number(e.id) === Number(outgoingId)
        );

      const isReentryNow =
        wasStarter &&
        isOffField &&
        originalOrderIndex >= 0 &&
        currentOrderIndexOfFrom >= 0 &&
        originalOrderIndex === currentOrderIndexOfFrom;

      if (isReentryNow) {
        markReentryBlue(Number(incoming.id));
      }
    });
  }
  
  // ✅ 1) 守備（assignments）を更新（守備9枠だけ）
setAssignments((prev) => {
  const baseDef: Partial<Record<DefKey, number | null>> = {};
  DEF_KEYS.forEach((k) => {
    baseDef[k] = getDisplayedIdForPositionNumberModal(k) ?? null;
  });

  const nextDef: Partial<Record<DefKey, number | null>> = { ...baseDef };

  // ★この更新で「埋まる守備」を先に集計（outを空ける判定で使う）
  const filled = new Set<DefKey>();

  // --- swap（守備位置入替）: baseDef を元に同時反映 ---
  swapRows.forEach(({ from, to }) => {
    const fromPos = numberToPosSymbol[Number(from)] as DefKey | undefined;
    const toPos = numberToPosSymbol[Number(to)] as DefKey | undefined;
    if (!fromPos || !toPos) return;

    const movingId = baseDef[fromPos] ?? null;
    if (movingId == null) return;

    nextDef[toPos] = movingId;
    filled.add(toPos);
  });

  // --- replace（選手交代）: out(from) -> in(to or from) ---
  replaceRows.forEach(({ from, to, benchPlayerId }) => {
    const outPos = numberToPosSymbol[Number(from)] as DefKey | undefined;
    // ★入る守備：to が空なら同じ守備に入る（従来互換）
    const inNum = to && String(to).trim() ? Number(to) : Number(from);
    const inPos = numberToPosSymbol[inNum] as DefKey | undefined;

    if (!outPos || !inPos) return;

    const incoming = benchAll.find((p) => String(p.id) === String(benchPlayerId));
    if (!incoming) return;

    // ★入る守備に控えを配置
    nextDef[inPos] = incoming.id;
    filled.add(inPos);

    // ★別守備に入るなら、交代元(outPos)は「誰も埋めない場合だけ」空ける
    //   （今回の例：5が1 で outPos=投 は埋まるので空けない）
    if (inPos !== outPos) {
      const willBeFilled =
        filled.has(outPos) ||
        // swapのtoで埋まるケース（filledに入るはずだが保険）
        swapRows.some((r) => numberToPosSymbol[Number(r.to)] === outPos) ||
        // replaceのinで埋まるケース
        replaceRows.some((r) => {
          const n = r.to && String(r.to).trim() ? Number(r.to) : Number(r.from);
          return numberToPosSymbol[n] === outPos;
        });

      if (!willBeFilled) {
        nextDef[outPos] = null;
      }
    }
  });

  // DHなど他キーは prev を保持
  return { ...(prev as any), ...nextDef };
});

  // ✅ 2) 打順（battingReplacements）を更新（表示がこれを見ている）
if (orderReplaceMap.size > 0) {
  setBattingReplacements((prev: any) => {
    // ✅ prev が配列じゃない（undefined/null/オブジェクト）でも落ちないようにする
    const baseArr = Array.isArray(prev) ? prev : [];

    // 9枠ぶん確保（prevが短い/空でもOK）
    const next = Array.from({ length: battingOrder.length }, (_, i) => baseArr[i]);

    orderReplaceMap.forEach((incomingId, outgoingId) => {
      const idx = battingOrder.findIndex((e) => e.id === outgoingId);
      if (idx < 0) return;

      const incomingPlayer = teamPlayers.find((p) => p.id === incomingId);
      if (!incomingPlayer) return;

      next[idx] = incomingPlayer;
    });

    return next;
  });
}

const touched = new Set<string>();

swapRows.forEach(({ from, to }) => {
  const fromPos = numberToPosSymbol[Number(from)];
  const toPos = numberToPosSymbol[Number(to)];
  if (fromPos) touched.add(fromPos);
  if (toPos) touched.add(toPos);
});

replaceRows.forEach(({ from, to }) => {
  const outPos = numberToPosSymbol[Number(from)];
  const inNum = to && String(to).trim() ? Number(to) : Number(from);
  const inPos = numberToPosSymbol[inNum];

  if (outPos) touched.add(outPos);
  if (inPos) touched.add(inPos);
});

setTouchedFieldPos((prev) => {
  const next = new Set(prev);
  touched.forEach((p) => next.add(p));
  return next;
});

  setShowPosNumberModal(false);

  setPosNumberRows(
    Array.from({ length: 9 }, () => ({ from: "", mode: "swap", to: "", benchPlayerId: "" }))
  );

  setBattingOrderDraft((prevDraft) => {
    const base =
      prevDraft?.length ? [...prevDraft] : [...battingOrder];

    orderReplaceMap.forEach((incomingId, outgoingId) => {
      const idx = base.findIndex((e) => Number(e?.id) === Number(outgoingId));
      if (idx >= 0) {
        base[idx] = { ...base[idx], id: incomingId };
      }
    });

    return base;
  });

};

// 右側（swap用）守備番号リスト：番号＋守備位置名（※選手名なし）
const posNumberOptionsSimple = posNumbersForModal.map((n) => {
  const posSym = numberToPosSymbol[Number(n)];

  const posName =
    posSym === "投" ? "(ピッチャー)" :
    posSym === "捕" ? "(キャッチャー)" :
    posSym === "一" ? "(ファースト)" :
    posSym === "二" ? "(セカンド)" :
    posSym === "三" ? "(サード)" :
    posSym === "遊" ? "(ショート)" :
    posSym === "左" ? "(レフト)" :
    posSym === "中" ? "(センター)" :
    posSym === "右" ? "(ライト)" :
    posSym === "指" ? "(指名打者)" :
    String(posSym ?? "");

  return {
    n: String(n),
    label: `【${n}】${posName}`,
  };
});
// 守備番号セレクト表示用（番号＋守備位置名＋選手）
// ※assignments[pos] は「選手ID」を入れている前提
// 代打/代走タグ取得（表示用）
const getPinchTag = (playerId: number | null | undefined): string => {
  if (!playerId) return "";

  const direct = battingOrder?.find((e: any) => Number(e?.id) === Number(playerId))?.reason;
  if (direct && ["代打", "代走", "臨時代走"].includes(String(direct))) return String(direct);

  const info = Object.values(usedPlayerInfo || {}).find(
    (x: any) => Number(x?.subId) === Number(playerId)
  );
  const r = info?.reason;
  if (r && ["代打", "代走", "臨時代走"].includes(String(r))) return String(r);

  return "";
};

const getDisplayedIdForPositionNumberModal = (posSym: string): number | null => {
  const assignedId =
    typeof (assignments as any)?.[posSym] === "number"
      ? Number((assignments as any)[posSym])
      : null;

  // その守備位置に対する代打/代走/臨時代走の最新subIdを優先
  for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
    if (!info) continue;

    const sym = (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
    if (sym !== posSym) continue;

    const reason = String((info as any).reason ?? "");
    if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

    const latest = resolveLatestSubId(Number(origIdStr), usedPlayerInfo as any);
    if (typeof latest === "number") {
      // まだその守備が元選手 or 途中出場選手の系統なら最新subIdを表示
      if (
        assignedId == null ||
        assignedId === Number(origIdStr) ||
        assignedId === Number((info as any).subId)
      ) {
        return latest;
      }
    }

    if (typeof (info as any).subId === "number") {
      if (
        assignedId == null ||
        assignedId === Number(origIdStr) ||
        assignedId === Number((info as any).subId)
      ) {
        return Number((info as any).subId);
      }
    }
  }

  return assignedId;
};

const posNumberOptions = posNumbersForModal.map((n) => {
  const posSym = numberToPosSymbol[Number(n)];

  const posName =
    (posSym === "投") ? "(ピッチャー)" :
    (posSym === "捕") ? "(キャッチャー)" :
    (posSym === "一") ? "(ファースト)" :
    (posSym === "二") ? "(セカンド)" :
    (posSym === "三") ? "(サード)" :
    (posSym === "遊") ? "(ショート)" :
    (posSym === "左") ? "(レフト)" :
    (posSym === "中") ? "(センター)" :
    (posSym === "右") ? "(ライト)" :
    String(posSym ?? "");

const id = posSym ? getDisplayedIdForPositionNumberModal(posSym) : null;
const p = typeof id === "number" ? teamPlayers.find((x) => x.id === id) : null;

  // ===== ここから追加 =====
  let pinchTag = "";

  if (id) {
    // battingOrder から reason を確認
    const direct = battingOrder?.find((e: any) => Number(e?.id) === Number(id))?.reason;

    if (["代打", "代走", "臨時代走"].includes(String(direct))) {
      pinchTag = String(direct);
    } else {
      // usedPlayerInfo からも確認
      const info = Object.values(usedPlayerInfo || {}).find(
        (x: any) => Number(x?.subId) === Number(id)
      );
      if (info && ["代打", "代走", "臨時代走"].includes(String(info.reason))) {
        pinchTag = String(info.reason);
      }
    }
  }
  // ===== ここまで追加 =====

  // 通常表示
  const normalLabel = p ? `${posName} ${p.lastName} #${p.number}` : `${posName} —`;

  // ★代打/代走なら表示を変更
  const label = pinchTag && p
    ? `${pinchTag} ${p.lastName} #${p.number}`
    : `【${n}】${normalLabel}`;

  return {
    n: String(n),
    label,
  };
});

  if (isLoading) {
    return <div className="text-center text-gray-500 mt-10">読み込み中...</div>;
  }
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
            onClick={handleBackClick}
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

<div className="max-w-4xl mx-auto px-4 mt-4">
  <button
    onClick={() => {
      setPosNumberError(null);
      setShowPosNumberModal(true);
    }}
    className="w-full bg-indigo-600 text-white px-4 py-3 rounded-lg font-semibold active:scale-95 transition"
  >
    守備番号で交代（●が●）
  </button>


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
  // ✅ 表示用：DH(指) は守備配置(assignments)ではなく「打順のDH枠」を優先（特に大谷ルール＋DH代打）
  const orderSrc = (battingOrderDraft?.length ? battingOrderDraft : battingOrder);

  // DH枠（スタメン時に「指」を担っていた選手ID）
  const dhStarterId = initialAssignments?.["指"];
  const dhSlotIndex =
    typeof dhStarterId === "number"
      ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
      : -1;

  // 現在のDH（打順の同じスロットにいる選手）
  // ✅ 代打後は battingReplacements に乗ることがあるので最優先で拾う
const dhCurrentId =
  dhSlotIndex >= 0
    ? (battingReplacements?.[dhSlotIndex]?.id ??
      currentGameState.battingOrder9?.[dhSlotIndex]?.currentId ??
      currentGameState.fieldByPos["指"] ??
      null)
    : (currentGameState.fieldByPos["指"] ?? null);


      // ✅ DHスロットの選手が「指以外」に配置されている場合は、フィールド図のDH表示を消す
const isOhtaniSharedDhPitcher =
  ohtaniRule &&
  typeof dhCurrentId === "number" &&
  typeof assignments?.["投"] === "number" &&
  Number(assignments["投"]) === Number(dhCurrentId) &&
  typeof initialAssignments?.["投"] === "number" &&
  typeof initialAssignments?.["指"] === "number" &&
  Number(initialAssignments["投"]) === Number(initialAssignments["指"]);

const dhIsPlacedElsewhere =
  typeof dhCurrentId === "number" &&
  Object.entries(assignments || {}).some(([sym, id]) => {
    if (sym === "指") return false;
    if (typeof id !== "number") return false;
    if (Number(id) !== Number(dhCurrentId)) return false;

    // 大谷ルール中は「投」に同じ選手がいてもDHは消さない
    if (isOhtaniSharedDhPitcher && sym === "投") return false;

    return true;
  });

const dhDisplayId = dhIsPlacedElsewhere ? null : dhCurrentId;


// ✅ フィールド図の表示IDは「その守備にひもづく元選手(origId)の連鎖末端」を優先する
const allowPinchOverride = !touchedFieldPos.has(pos);

let displayId = currentGameState.fieldByPos[pos] ?? null;

const latestPinchForPos = (() => {
  if (!allowPinchOverride) return null;

  for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
    if (!info) continue;

    const reason = String((info as any).reason ?? "").trim();
    if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

    const sym =
      (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
    if (sym !== pos) continue;

    const origId = Number(origIdStr);
    const latestId = resolveLatestSubId(origId, usedPlayerInfo as any);

    if (typeof latestId === "number") {
      return latestId;
    }

    if (typeof (info as any).subId === "number") {
      return Number((info as any).subId);
    }
  }

  return null;
})();

// ✅ 守備図だけは「最初のsubId」ではなく、必ず連鎖の末端を表示
if (latestPinchForPos != null) {
  displayId = latestPinchForPos;
}

// 代走は assignments より usedPlayerInfo の subId を優先して表示
const pinchRunnerForPos = (() => {
  for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
    if (!info) continue;
    if (!["代走", "臨時代走"].includes(String(info.reason ?? ""))) continue;

    const sym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos;
    if (sym !== pos) continue;
    if (typeof info.subId !== "number") continue;

    const origId = Number(origIdStr);
    const assignedId = assignments?.[pos];

    // ✅ まだその守備位置が
    // 「元の選手のまま」または「代走選手本人のまま」のときだけ
    // 代走選手を優先表示する
    //
    // すでに別の選手へ守備交代しているなら、
    // assignments[pos] をそのまま表示する
    if (
      Number(assignedId) === Number(origId) ||
      Number(assignedId) === Number(info.subId)
    ) {
      return Number(info.subId);
    }

    // 例：
    // 元スタメン = 吉田
    // 代走 = 折原
    // その後 守備交代で 伊藤 がセンター
    // → assignments["中"] = 伊藤 なので、ここでは override しない
  }

  return null;
})();



// ✅ まだその守備位置を手で触っていない間は、代走選手を最優先表示
// ✅ 守備交代でその位置を触った後だけ assignments を優先
const currentId =
  pos === "指"
    ? dhDisplayId
    : getDisplayedPlayerIdForPos(pos);


  const initialId =
    (pos === "指" && ohtaniRule && typeof dhStarterId === "number")
      ? dhStarterId
      : initialAssignments[pos];

  const player = currentId ? teamPlayers.find((p) => p.id === currentId) ?? null : null;

  // 出場理由の補完（battingOrder or usedPlayerInfo）
  let reason: string | undefined;
  if (currentId) {
    const battingEntry = orderSrc.find(e => e.id === currentId);
    reason = battingEntry?.reason;

    if (!reason) {
      const entry = Object.entries(usedPlayerInfo).find(
        ([, info]) => info.subId === currentId
      );
      if (entry) {
        const originalId = Number(entry[0]);
        const originalReason = orderSrc.find(e => e.id === originalId)?.reason;
        reason = originalReason;
      }
      //console.warn(`[WARN] reasonが見つからない: currentId = ${currentId}`);
    }
  }

  const isChanged = currentId !== initialId;
  const isSub = reason === "代打" || reason === "臨時代走" || reason === "代走";

  // ★ 追加：リエントリー青枠フラグ（handleDropでセットしたIDを参照）
// 絶対条件のみで青枠にする
const isReentryBlue = player ? alwaysReentryIds.has(player.id) : false;
const isForcedNormal = player ? isForcedNormalSubId(player.id) : false;
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

${isForcedNormal
  ? "ring-2 ring-inset ring-yellow-400"
  : (isReentryBlue)
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
          {pos === "指" ? "DHなし" : "未設定"}
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

  {(() => {
    const orderViewBaseAssignments = isDirty ? initialAssignments : assignments;
    const orderViewReplacements = isDirty ? battingReplacements : {};
    const orderViewOrder =
      isDirty && battingOrderDraft?.length === 9 ? battingOrderDraft : battingOrder;

    return (
      <ul className="space-y-1 text-sm border border-slate-200 rounded-xl bg-white p-2">
        {orderViewOrder.map((slot, index) => {
          const dhStarterId = initialAssignments?.["指"];
          const dhSlotIndex =
            typeof dhStarterId === "number"
              ? battingOrder.findIndex((e) => e.id === dhStarterId)
              : -1;

          const dhActive = !!assignments["指"];

const displayId = slot.id;

// 取消線用の「交代前選手」は、この画面を開いた時点の battingOrder を基準にする
const beforeEntry = battingOrder[index];
const beforeId = beforeEntry?.id ?? slot.id;

const starter = teamPlayers.find((p) => p.id === beforeId); // 旧表示用
const player =
  (orderViewReplacements as any)[index]
    ? (orderViewReplacements as any)[index]
    : teamPlayers.find((p) => p.id === displayId); // 新表示用
if (!starter || !player) return null;

// ★ 実際に表示している選手IDを使う
const currentDisplayId =
  typeof player?.id === "number" ? Number(player.id) : Number(displayId);

let currentPos = getOrderDisplayPos(assignments, currentDisplayId);
let initialPos = getOrderDisplayPos(orderViewBaseAssignments, beforeId);

// ① 代打/代走でまだ守備位置解決できないときは fromPos を使う
if (!currentPos || currentPos === "-" || currentPos === "－") {
  const pinchInfo = Object.values(usedPlayerInfo || {}).find(
    (info: any) =>
      Number(info?.subId) === Number(currentDisplayId) &&
      ["代打", "代走", "臨時代走"].includes(String(info?.reason ?? ""))
  );

  if (pinchInfo?.fromPos) {
    currentPos = posNameToSymbol[pinchInfo.fromPos] ?? pinchInfo.fromPos;
  }
}

// ② リエントリー済みの元スタメンなら、元の守備位置を表示
if (!currentPos || currentPos === "-" || currentPos === "－") {
  const usedEntry = (usedPlayerInfo as any)?.[currentDisplayId];

  if (usedEntry?.hasReentered) {
    const reentryPos = getOrderDisplayPos(initialAssignments, currentDisplayId);
    if (reentryPos && reentryPos !== "-" && reentryPos !== "－") {
      currentPos = reentryPos;
    }
  }
}

// ③ まだ取れない場合は、元の打順選手の初期守備位置を最後の保険に使う
if (!currentPos || currentPos === "-" || currentPos === "－") {
  if (initialPos && initialPos !== "-" && initialPos !== "－") {
    currentPos = initialPos;
  }
}

if (dhActive && dhSlotIndex === index) {
  currentPos = "指";
  if (!initialPos || initialPos === "-") initialPos = "指";
}

const playerChanged = currentDisplayId !== beforeId;
const positionChanged = currentPos !== initialPos;

          const isPinchHitter = slot.reason === "代打";
          const isPinchRunner = slot.reason === "代走";
          const isTempPinchRunner = slot.reason === "臨時代走";
          const isPinch = isPinchHitter || isPinchRunner || isTempPinchRunner;
          const pinchLabel = isPinchHitter
            ? "代打"
            : isPinchRunner
            ? "代走"
            : isTempPinchRunner
            ? "臨時代走"
            : "";

          const shouldShowPinchBadge = isPinch;
          const shouldHighlightPlayer = isDirty && (playerChanged || isPinch);

          return (
            <li key={index} className="py-1 px-2 border-b last:border-b-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-slate-500 w-8">{index + 1}番</span>

                {playerChanged ? (
                  <>
                    <span className="line-through text-gray-400">
                      {withMark(initialPos)}{" "}
                      <ruby>
                        {starter.lastName}
                        {starter.firstName}
                        <rt>
                          {starter.lastNameKana}
                          {starter.firstNameKana}
                        </rt>
                      </ruby>
                      {starter.number ? ` #${starter.number}` : ""}
                    </span>

                    <span className="text-gray-400">→</span>

                    <span className="text-red-600 font-bold">
                      {withMark(currentPos)}{" "}
                      <ruby>
                        {player.lastName}
                        {player.firstName}
                        <rt>
                          {player.lastNameKana}
                          {player.firstNameKana}
                        </rt>
                      </ruby>
                      {player.number ? ` #${player.number}` : ""}
                    </span>

                    {shouldShowPinchBadge && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                        {pinchLabel}
                      </span>
                    )}
                  </>
                ) : positionChanged ? (
                  <>
                    <span className="text-slate-800">
                      <span className="text-gray-400">{withMark(initialPos)}</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="text-red-600 font-bold">{withMark(currentPos)}</span>{" "}
                      <span className={shouldHighlightPlayer ? "text-red-600 font-bold" : ""}>
                        <ruby>
                          {player.lastName}
                          {player.firstName}
                          <rt>
                            {player.lastNameKana}
                            {player.firstNameKana}
                          </rt>
                        </ruby>
                        {player.number ? ` #${player.number}` : ""}
                      </span>
                    </span>

                    {shouldShowPinchBadge && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                        {pinchLabel}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    <span className={shouldHighlightPlayer ? "text-red-600 font-bold" : "text-slate-800"}>
                      {withMark(currentPos)}{" "}
                      <ruby>
                        {player.lastName}
                        {player.firstName}
                        <rt>
                          {player.lastNameKana}
                          {player.firstNameKana}
                        </rt>
                      </ruby>
                      {player.number ? ` #${player.number}` : ""}
                    </span>

                    {shouldShowPinchBadge && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 text-red-600 border border-red-200">
                        {pinchLabel}
                      </span>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  })()}
</div>

{/* 交代内容（右） */}
<div className="w-full">
  <h2 className="text-lg font-bold mb-2 text-slate-900">交代内容</h2>

  {!isDirty ? (
    <div className="text-sm border border-slate-200 p-3 rounded-xl bg-white text-slate-400">
      なし
    </div>
  ) : (
    <ul className="text-sm border border-slate-200 p-3 rounded-xl bg-white space-y-1">
      {(() => {
        const posPriority = { "投": 1, "捕": 2, "一": 3, "二": 4, "三": 5, "遊": 6, "左": 7, "中": 8, "右": 9 };

        const dhStarterId = initialAssignments?.["指"];
        const dhSlotIndex =
          typeof dhStarterId === "number"
            ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
            : -1;

        const changes = battingOrder.map((entry, index) => {
          const starter = teamPlayers.find((p) => p.id === entry.id);
          if (!starter) return null;

          let replaced = battingReplacements[index] ?? teamPlayers.find(p => p.id === entry.id);

          if (index === dhSlotIndex) {
            const dhStarterId = initialAssignments?.["指"];
            const dhNowId = assignments?.["指"];

            if (
              typeof dhNowId === "number" &&
              typeof dhStarterId === "number" &&
              dhNowId !== dhStarterId
            ) {
              const dhNowPlayer = teamPlayers.find(p => p.id === dhNowId);
              if (dhNowPlayer) replaced = dhNowPlayer;
            }
          }

          const currentId = replaced?.id ?? entry.id;
          const currentPlayer = replaced ?? starter;

          let currentPos = getPositionName(assignments, currentId);
          const initialPos = getPositionName(initialAssignments, entry.id);

          const playerChanged = !!replaced && replaced.id !== entry.id;
          const positionChanged = currentPos !== initialPos;
          const isPinchHitter = entry.reason === "代打";
          const isPinchRunner = entry.reason === "代走";
          const pinchReasons = ["代打", "代走", "臨時代走"] as const;

          const resolvePinchFromPosSymBySubId = (subId: number): string => {
            for (const info of Object.values(usedPlayerInfo || {})) {
              if (!info) continue;
              if (!pinchReasons.includes(String((info as any).reason) as any)) continue;
              if ((info as any).subId !== subId) continue;

              const fromPos = (info as any).fromPos as string | undefined;
              if (!fromPos) return "";
              return (posNameToSymbol as any)[fromPos] ?? fromPos;
            }
            return "";
          };

          if (!playerChanged && !positionChanged && !isPinchHitter && !isPinchRunner) {
            return null;
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
                  代打：{replaced?.lastName}{replaced?.firstName} #{replaced?.number} ➡ {withFull(currentPos)}
                </li>
              )
            };
          }

          if (isPinchRunner && currentPos) {
            if (!replaced) {
              replaced = teamPlayers.find(p => p.id === entry.id);
            }
            return {
              key: `runner-assigned-${index}`,
              type: 2,
              pos: currentPos,
              jsx: (
                <li key={`runner-assigned-${index}`}>
                  代走：{replaced?.lastName}{replaced?.firstName} #{replaced?.number} ➡ {withFull(currentPos)}
                </li>
              )
            };
          }

          if (playerChanged) {
            return {
              key: `replaced-${index}`,
              type: 3,
              pos: currentPos,
              jsx: (
                <li key={`replaced-${index}`}>
                  {withFull(initialPos)}：{starter.lastName}{starter.firstName} #{starter.number}
                  {" "}➡{" "}
                  {withFull(currentPos)}：{currentPlayer.lastName}{currentPlayer.firstName} #{currentPlayer.number}
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
                  {starter.lastName}{starter.firstName} #{starter.number}
                  {" "}➡{" "}
                  {withFull(currentPos)}
                </li>
              )
            };
          }

          return null;
        })
          .filter(Boolean)
          .sort((a: any, b: any) => {
            const pa = posPriority[a?.pos as keyof typeof posPriority] ?? 99;
            const pb = posPriority[b?.pos as keyof typeof posPriority] ?? 99;
            if (pa !== pb) return pa - pb;
            return (a?.type ?? 99) - (b?.type ?? 99);
          });

        if (!changes.length) {
          return <li className="text-slate-400">なし</li>;
        }

        return changes.map((c: any) => c.jsx);
      })()}
    </ul>
  )}
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


{/* 追加：守備番号で交代（●が● / ●に代わって）モーダル */}
{showPosNumberModal && (
  <div
    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-2 sm:p-4"
    role="dialog"
    aria-modal="true"
    aria-label="守備番号で交代"
  >
    {/* overlay */}
    <button
      type="button"
      className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
      onClick={() => setShowPosNumberModal(false)}
      aria-label="閉じる（背景）"
    />

    {/* panel */}
    <div className="relative w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-black/10 overflow-hidden">
      {/* header */}
      <div className="sticky top-0 bg-slate-50/95 backdrop-blur border-b border-slate-100 px-4 pt-4 pb-3">
  <div className="relative flex flex-col items-center justify-center text-center">
  {/* タイトル行 */}
  <div className="flex items-center justify-center gap-3">
    <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 text-xl shadow-sm">
      🔁
    </span>
    <h2 className="text-xl sm:text-2xl font-extrabold tracking-wide text-slate-900">
      守備番号で交代
    </h2>
  </div>

  {/* サブ説明 */}
  <p className="mt-2 text-sm text-slate-600">
    「1 が 9」「1 に代わり ○○」のように入力できます
  </p>

  {/* 右上 × ボタン */}
  <button
    type="button"
    onClick={() => setShowPosNumberModal(false)}
    className="absolute right-0 top-0 inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-300 hover:bg-slate-400 active:bg-slate-500 text-slate-800 font-bold shadow-sm"
    aria-label="閉じる"
    title="閉じる"
  >
    ✕
  </button>
</div>

        {/* error */}
        {posNumberError && (
          <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 whitespace-pre-line">
            {posNumberError}
          </div>
        )}
      </div>

      {/* body */}
      <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
        <MiniScribblePad
          value={posNumberMemoDataUrl}
          onChange={setPosNumberMemoDataUrl}
        />
         <div className="space-y-3">
{posNumberRows.map((row, i) => {
  // 交代が何も入ってない行は薄く（任意）
  const isFilled =
    !!row.from && (row.mode === "swap" ? !!row.to : !!row.benchPlayerId);

  // 枠色（交代っぽく見せる）：行番号で色味を変える（循環）
  const ringPalette = [
    "ring-emerald-200 border-emerald-200 bg-emerald-50/30",
    "ring-sky-200 border-sky-200 bg-sky-50/30",
    "ring-indigo-200 border-indigo-200 bg-indigo-50/30",
    "ring-amber-200 border-amber-200 bg-amber-50/30",
    "ring-rose-200 border-rose-200 bg-rose-50/30",
    "ring-teal-200 border-teal-200 bg-teal-50/30",
    "ring-violet-200 border-violet-200 bg-violet-50/30",
    "ring-lime-200 border-lime-200 bg-lime-50/30",
    "ring-cyan-200 border-cyan-200 bg-cyan-50/30",
  ];
  const tone = ringPalette[i % ringPalette.length];

  return (
    <div
      key={i}
      className={[
        "rounded-2xl border shadow-sm ring-1 p-3",
        tone,
        isFilled ? "" : "opacity-90",
      ].join(" ")}
    >
      {/* ①②のバッジ */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-full bg-slate-900 text-white text-xs font-extrabold px-2">
            {i + 1}
          </span>
          <span className="text-xs font-semibold text-slate-600">
            {row.mode === "swap" ? "守備位置変更" : "選手交代"}
          </span>
        </div>

        {/* 行クリア */}
        <button
          type="button"
          onClick={() => {
            setPosNumberRows((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, from: "", to: "", benchPlayerId: "" } : r
              )
            );
          }}
          className="text-xs font-semibold text-slate-500 hover:text-slate-700"
        >
          クリア
        </button>
      </div>

      {/* ▼ swap：1行で完結（ラベルも1行） */}
      {row.mode === "swap" ? (
        <>
      {/* ラベル行（1行） */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-[11px] text-slate-500 font-semibold mb-2">
        <div className="text-left">（守備番号）</div>
        <div className="text-center">（交代）</div>
        <div className="text-left">（入替守備）</div>
      </div>

      {/* 入力行（1行） */}
      <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-center">
        {/* 守備番号 */}
        <select
          value={row.from}
          onChange={(e) => {
            const v = e.target.value;
            setPosNumberRows((prev) =>
              prev.map((r, idx) => (idx === i ? { ...r, from: v } : r))
            );
          }}
          className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-base shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
        >
          <option value="">選択</option>
          {posNumberOptions.map((opt) => (
            <option key={opt.n} value={opt.n}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* 交代 */}
        <select
          value={row.mode}
          onChange={(e) => {
            const mode = e.target.value as "swap" | "replace";
            setPosNumberRows((prev) =>
              prev.map((r, idx) =>
                idx === i ? { ...r, mode, to: "", benchPlayerId: "" } : r
              )
            );
          }}
          className="min-w-[90px] h-11 rounded-xl border border-emerald-400 bg-white px-2 text-sm font-bold text-center shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-400"
        >
          <option value="swap">が</option>
          <option value="replace">に代わり</option>
        </select>

        {/* 入替守備 */}
        <select
          value={row.to}
          onChange={(e) => {
            const v = e.target.value;
            setPosNumberRows((prev) =>
              prev.map((r, idx) => (idx === i ? { ...r, to: v } : r))
            );
          }}
          className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-base shadow-sm
                    focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
        >
          <option value="">選択</option>
          {posNumberOptionsSimple.map((opt) => (
            <option key={opt.n} value={opt.n}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
        </>
      ) : (
        /* ▼ replace：今まで通り2行（2行目に「控えが入る守備」） */
        <>
          {/* 1行目：守備番号＋に代わり */}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <div className="text-[11px] text-slate-500 mb-1">（守備番号）</div>
              <select
                value={row.from}
                onChange={(e) => {
                  const v = e.target.value;
                  setPosNumberRows((prev) =>
                    prev.map((r, idx) => (idx === i ? { ...r, from: v } : r))
                  );
                }}
                className="w-full h-11 rounded-xl border border-slate-300 bg-white px-3 text-base shadow-sm
                           focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
              >
                <option value="">選択</option>
                {posNumberOptions.map((opt) => (
                  <option key={opt.n} value={opt.n}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="w-[9rem]">
              <div className="text-[11px] text-slate-500 mb-1">（交代）</div>
              <select
                value={row.mode}
                onChange={(e) => {
                  const mode = e.target.value as "swap" | "replace";
                  setPosNumberRows((prev) =>
                    prev.map((r, idx) =>
                      idx === i ? { ...r, mode, to: "", benchPlayerId: "" } : r
                    )
                  );
                }}
                className="w-full h-11 rounded-xl border border-emerald-400 bg-white px-2 text-sm font-bold text-center shadow-sm
                           focus:outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="swap">が</option>
                <option value="replace">に代わり</option>
              </select>
            </div>
          </div>

          {/* 2行目：控え選手 が 入る守備 */}
          <div className="mt-3">
            <div className="text-[11px] text-slate-500 mb-1">（交代内容）</div>
            <div className="flex items-center gap-2">
              <select
                value={row.benchPlayerId}
                onChange={(e) => {
                  const v = e.target.value;
                  setPosNumberRows((prev) =>
                    prev.map((r, idx) =>
                      idx === i ? { ...r, benchPlayerId: v } : r
                    )
                  );
                }}
                className="flex-1 h-11 rounded-xl border border-slate-300 bg-white px-3 text-base shadow-sm
                           focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
              >
                <option value="">控え選手</option>

                {benchNeverPlayed.length > 0 && (
                  <optgroup label="未出場">
                    {benchNeverPlayed.map((p) => (
                      <option key={`never-${p.id}`} value={p.id}>
                        {formatPlayerLabel(p)}
                      </option>
                    ))}
                  </optgroup>
                )}

                {benchPlayedOut.length > 0 && (
                  <optgroup label="出場済み">
                    {benchPlayedOut.map((p) => (
                      <option key={`played-${p.id}`} value={p.id}>
                        {formatPlayerLabel(p)}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>

              <span className="text-sm font-extrabold text-slate-600">が</span>

              <select
                value={row.to}
                onChange={(e) => {
                  const v = e.target.value;
                  setPosNumberRows((prev) =>
                    prev.map((r, idx) => (idx === i ? { ...r, to: v } : r))
                  );
                }}
                className="flex-1 h-11 rounded-xl border border-slate-300 bg-white px-3 text-base shadow-sm
                           focus:outline-none focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400"
              >
                
                <option value="">入る守備</option>
                {posNumberOptionsSimple.map((opt) => (
                  <option key={opt.n} value={opt.n}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </>
      )}
    </div>
  );
})}
        </div>
      </div>

      {/* footer */}
      <div className="sticky bottom-0 border-t border-slate-100 bg-white/95 backdrop-blur px-4 py-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setShowPosNumberModal(false)}
            className="flex-1 rounded-xl bg-slate-500 px-4 py-3 text-sm font-bold text-white hover:bg-slate-600 active:bg-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={applyPosNumberChanges}
            className="flex-1 rounded-xl bg-emerald-600 px-4 py-3 text-sm font-extrabold text-white shadow hover:bg-emerald-700 active:bg-emerald-800"
          >
            反映
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

{/* 非リエントリー確認モーダル */}
{showNonReentryConfirm && (
  <div
    className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    aria-labelledby="nonreentry-confirm-title"
    onClick={() => {
      setShowNonReentryConfirm(false);
      setPendingNonReentryDrop(null);
    }}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-green-600 text-white text-center font-bold py-3">
        <h3 id="nonreentry-confirm-title" className="text-base">確認</h3>
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold leading-relaxed">
          リエントリー対象選手ではありません。{"\n"}
          交代しますか？
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-slate-200 text-gray-900 font-semibold hover:bg-slate-300 active:bg-slate-400"
            onClick={() => {
              setShowNonReentryConfirm(false);
              setPendingNonReentryDrop(null);
            }}
          >
            NO
          </button>

<button
  className="w-full py-3 rounded-full bg-green-600 text-white font-semibold hover:bg-green-700 active:bg-green-800"
  onClick={() => {
    const p = pendingNonReentryDrop;
    setShowNonReentryConfirm(false);
    setPendingNonReentryDrop(null);
    if (!p) return;

    // ✅ 次の1回だけリエントリー判定を無視
    setForceNormalSubOnce(true);

    // ✅ この選手は「リエントリーではなく通常交代」
    markForcedNormalSub(p.playerId);

    applyBenchDropToField({
      toPos: p.toPos,
      playerId: p.playerId,
      replacedId: p.replacedId,
    });
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

    // ─────────────────────────────────────────────
    // JSX（画面の見た目）
    // ─────────────────────────────────────────────

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
