import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { TouchBackend } from "react-dnd-touch-backend";
import { useNavigate } from "react-router-dom";

/* =========================================================
 *  見た目だけのミニSVG（UIは変えない）
 * ======================================================= */
const IconField = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M12 2L2 12l10 10 10-10L12 2zm0 4l6 6-6 6-6-6 6-6z" />
  </svg>
);
const IconBench = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M4 15h16v2H4zm2-4h12v2H6zm2-4h8v2H8z" />
  </svg>
);
const IconOut = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M12 2a10 10 0 1010 10A10 10 0 0012 2zm4.24 12.83l-1.41 1.41L12 13.41l-2.83 2.83-1.41-1.41L10.59 12 7.76 9.17l1.41-1.41L12 10.59l2.83-2.83 1.41 1.41L13.41 12z" />
  </svg>
);
const IconOrder = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M7 5h10v2H7zm0 6h10v2H7zm0 6h10v2H7z" />
  </svg>
);

/* =========================================================
 *  定数・型（ここは「意味」をまとめるだけ）
 * ======================================================= */

// 守備位置（フィールドの9ポジション）
const positions = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右"] as const;

// DH（守備位置としてはフィールドに描かないが割当Mapには入れる）
const DH = "指"; // 守備位置キー
const allSlots = [...positions, DH] as const;

// 表示用の守備名称
const positionNames: { [key: string]: string } = {
  投: "ピッチャー",
  捕: "キャッチャー",
  一: "ファースト",
  二: "セカンド",
  三: "サード",
  遊: "ショート",
  左: "レフト",
  中: "センター",
  右: "ライト",
  指: "DH",
};

// フィールド図上のラベル配置位置（UI変更禁止のため数値は維持）
const positionStyles: { [key: string]: React.CSSProperties } = {
  投: { top: "63%", left: "50%" },
  捕: { top: "91%", left: "50%" },
  一: { top: "65%", left: "82%" },
  二: { top: "44%", left: "66%" },
  三: { top: "65%", left: "18%" },
  遊: { top: "44%", left: "32%" },
  左: { top: "22%", left: "18%" },
  中: { top: "18%", left: "50%" },
  右: { top: "22%", left: "81%" },
  指: { top: "91%", left: "82%" },
};

// 選手情報（teamPlayersの要素）
type Player = {
  id: number;
  lastName: string;
  firstName: string;
  number: string;
};

// 打順要素（理由は現状「スタメン」固定で使用）
type BattingEntry = { id: number; reason: "スタメン" };

// assignmentsの型（守備位置→選手ID or null）
type Assignments = { [pos: string]: number | null };

/* =========================================================
 *  ユーティリティ（既存ロジックを“そのまま”呼びやすくする）
 * ======================================================= */

// タッチ端末判定（DndProviderのbackend切替で使用）
const isTouchDevice = () => typeof window !== "undefined" && "ontouchstart" in window;

/**
 * 既存の handleDrop... を流用するためのダミーDragEventを生成
 * ※UI/挙動維持のため、元実装と同じ形を保つ
 */
const makeFakeDragEvent = (payload: Record<string, string>) =>
  ({
    preventDefault: () => {},
    dataTransfer: {
      getData: (key: string) => payload[key] ?? "",
    },
  } as unknown as React.DragEvent<HTMLDivElement>);

/**
 * assignmentsの初期（全スロットnull）を作る
 * ※毎回同じ式が出るので見通し目的で関数化（挙動は同じ）
 */
const createEmptyAssignments = (): Assignments =>
  Object.fromEntries(allSlots.map((p) => [p, null])) as Assignments;

/* =========================================================
 *  メインコンポーネント
 * ======================================================= */
const StartingLineup = () => {
  /* -----------------------------
   *  未保存チェック（dirty判定）
   * --------------------------- */
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const snapshotRef = React.useRef<string | null>(null);
  const initDoneRef = React.useRef(false);

  /**
   * 現在の編集中状態をスナップショット化（比較用）
   * ※比較対象は元コードと同じキー
   */
  const buildSnapshot = () =>
    JSON.stringify({
      assignments,
      battingOrder,
      benchOutIds,
      ohtaniRule,
    });

  /* -----------------------------
   *  画面遷移関連（戻るボタン）
   * --------------------------- */
  const navigate = useNavigate(); // ※現状未使用だが元コードを維持（将来用/副作用回避）
  // 試合情報画面（MatchCreate）のパス（現状は参照のみ）
  const MATCH_CREATE_PATH = "/MatchCreate";

  /**
   * 「App.tsx側の戻るボタン」を探してクリックし、App側の画面制御を発火させる
   * ※元の仕様を変えないため、この実装のまま
   */
  const handleBack = () => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const appBackBtn = buttons.find((b) =>
      (b.textContent || "").includes("← 試合情報に戻る")
    ) as HTMLButtonElement | undefined;

    if (appBackBtn) {
      console.log("[StartingLineup] trigger App back button click");
      appBackBtn.click();
      return;
    }

    console.warn("[StartingLineup] App back button not found.");
  };

  /* -----------------------------
   *  状態（データ）
   * --------------------------- */
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);

  // 守備割当（DH含む）
  const [assignments, setAssignments] = useState<Assignments>(createEmptyAssignments());

  // 打順（1～9）
  const [battingOrder, setBattingOrder] = useState<BattingEntry[]>([]);

  // 出場しない選手（ベンチ外）
  const [benchOutIds, setBenchOutIds] = useState<number[]>([]);

  // 大谷ルール（投手=DHの追従）
  const [ohtaniRule, setOhtaniRule] = useState(false);
  const prevDhIdRef = React.useRef<number | null>(null);

  /* -----------------------------
   *  UI補助状態（DnD / Touch）
   * --------------------------- */

  // タッチ（スマホ）用：ドラッグ対象保持
  const [touchDrag, setTouchDrag] = useState<{ playerId: number; fromPos?: string } | null>(
    null
  );

  // ドラッグ中の選手ID／ホバー中のターゲット
  const [draggingPlayerId, setDraggingPlayerId] = useState<number | null>(null);
  const [hoverPosKey, setHoverPosKey] = useState<string | null>(null); // フィールド各ポジション用
  const [hoverOrderPlayerId, setHoverOrderPlayerId] = useState<number | null>(null); // 打順行の選手用

  // いま何のドラッグか：守備ラベル入替(swapPos) / 打順入替(order)
  const [dragKind, setDragKind] = useState<"swapPos" | "order" | null>(null);

  // タッチ打順（現状未使用だが元を維持）
  const [touchDragBattingId, setTouchDragBattingId] = useState<number | null>(null);

  // タッチ最終座標（フォールバック用）
  const lastTouchRef = React.useRef<{ x: number; y: number } | null>(null);
  const hoverTargetRef = React.useRef<number | null>(null);

  // iOS判定 & 透明ゴースト画像（ドラッグの見え方安定用）
  const isIOS =
    typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
  const ghostImgRef = React.useRef<HTMLImageElement | null>(null);

  // 入替重複防止用（swapPosの多重発火を抑制）
  const swapSourceIdRef = React.useRef<number | null>(null);
  const swapTokenRef = React.useRef<string | null>(null);
  const handledSwapTokensRef = React.useRef<Set<string>>(new Set());

  /* -----------------------------
   *  クリア確認モーダル
   * --------------------------- */
  const [showConfirm, setShowConfirm] = useState(false);
  const onClearClick = () => setShowConfirm(true);

  /* =========================================================
   *  共通：DnDのdrop許可
   * ======================================================= */
  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try {
      e.dataTransfer!.dropEffect = "move";
    } catch {}
  };

  /* =========================================================
   *  保存・クリア（LocalForage）
   * ======================================================= */

  /**
   * スタメン保存
   * - 9人そろっていない場合は保存しない（元仕様）
   * - starting*** 系へ保存し、lineupAssignments/battingOrderにもミラー保存（元仕様）
   * - 保存後はdirty解除（元仕様）
   */
  const saveAssignments = async () => {
    // ✅ 先頭に “打順が9人いるか” をチェック
    const uniqueIds = Array.from(new Set(battingOrder.map((e) => e?.id).filter(Boolean)));
    if (uniqueIds.length < 9) {
      alert("スタメン9人を設定して下さい");
      return;
    }

    await localForage.setItem("startingBenchOutIds", benchOutIds);
    await localForage.setItem("startingassignments", assignments);
    await localForage.setItem("startingBattingOrder", battingOrder);

    // ✅ 初期記録（参照用）
    const initialOrder = battingOrder.map((entry, index) => {
      const position =
        Object.entries(assignments).find(([_, id]) => id === entry.id)?.[0] ?? "－";
      return { id: entry.id, order: index + 1, position };
    });
    await localForage.setItem("startingInitialSnapshot", initialOrder);

    // ✅ ミラー保存（既存の他画面が参照している可能性があるため維持）
    await localForage.setItem("lineupAssignments", assignments);
    await localForage.setItem("battingOrder", battingOrder);

    // ✅ 保存＝確定 → 未保存扱い解除
    snapshotRef.current = buildSnapshot();
    setIsDirty(false);

    alert("スタメンを保存しました！");
  };

  /**
   * スタメンをクリア
   * - 全スロット空に
   * - 全員を「出場しない選手」にする（元仕様）
   * - 保存データもリセット（元仕様）
   */
  const clearAssignments = async () => {
    const emptyAssignments = createEmptyAssignments();
    setAssignments(emptyAssignments);
    setBattingOrder([]);

    // ★ チーム全員をベンチ外へ
    const team = await localForage.getItem<{ players: Player[] }>("team");
    const allIds = (team?.players || []).map((p) => p.id);
    setBenchOutIds(allIds);

    // 保存状態もリセット
    await localForage.setItem("startingassignments", emptyAssignments);
    await localForage.setItem("startingBattingOrder", []);
    await localForage.setItem("startingBenchOutIds", allIds);

    // 参照用・ミラーも空に
    await localForage.setItem("startingInitialSnapshot", []);
    await localForage.setItem("lineupAssignments", emptyAssignments);
    await localForage.setItem("battingOrder", []);

    alert("スタメンをクリアし、全員を出場しない選手にしました！");
  };

  /**
   * クリア確認→実行
   */
  const proceedClear = async () => {
    setShowConfirm(false);
    await clearAssignments();
  };

  /* =========================================================
   *  ドラッグ開始（共通：選手カード）
   * ======================================================= */

  /**
   * 選手カードのドラッグ開始
   * - DataTransferへ playerId/fromPosition などを詰める（元仕様）
   * - iOSはゴースト表示を独自生成（元仕様）
   */
  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    playerId: number,
    fromPos?: string
  ) => {
    setDraggingPlayerId(playerId);

    e.dataTransfer.setData("playerId", String(playerId));
    e.dataTransfer.setData("text/plain", String(playerId)); // Android補完
    if (fromPos) e.dataTransfer.setData("fromPosition", fromPos);
    e.dataTransfer.effectAllowed = "move";

    try {
      // iOSのドラッグゴーストを“文字”にして視認性を安定させる
      if (isIOS && e.dataTransfer.setDragImage) {
        const p = teamPlayers.find((pp) => pp.id === playerId);
        const label = p
          ? `${p.lastName}${p.firstName} #${p.number}`
          : (e.currentTarget as HTMLElement).innerText || `#${playerId}`;

        const ghost = document.createElement("div");
        ghost.textContent = label;
        Object.assign(ghost.style, {
          position: "fixed",
          top: "0",
          left: "0",
          transform: "translate(-9999px,-9999px)",
          padding: "6px 10px",
          background: "rgba(0,0,0,0.85)",
          color: "#fff",
          borderRadius: "12px",
          fontWeight: "600",
          fontSize: "14px",
          lineHeight: "1",
          whiteSpace: "nowrap",
          boxShadow: "0 6px 16px rgba(0,0,0,0.3)",
          pointerEvents: "none",
          zIndex: "99999",
        } as CSSStyleDeclaration);

        document.body.appendChild(ghost);
        const r = ghost.getBoundingClientRect();
        e.dataTransfer.setDragImage(ghost, r.width * 0.5, r.height * 0.6);

        const cleanup = () => {
          try {
            document.body.removeChild(ghost);
          } catch {}
          setDraggingPlayerId(null);
        };
        window.addEventListener("dragend", cleanup, { once: true });
        window.addEventListener("drop", cleanup, { once: true });
        (e.currentTarget as HTMLElement).addEventListener("dragend", cleanup, { once: true });

        return; // iOS分岐ではここで終了（元コード通り）
      }

      // iOS以外：要素自身をゴーストに
      const target = e.currentTarget as HTMLElement;
      const rect = target.getBoundingClientRect();
      if (e.dataTransfer.setDragImage) {
        e.dataTransfer.setDragImage(target, rect.width / 2, rect.height / 2);
      }
    } catch {}

    // ドラッグ終了時の後始末
    const el = e.currentTarget as HTMLElement;
    const onEnd = () => {
      try {
        el.removeEventListener("dragend", onEnd);
      } catch {}
      window.removeEventListener("dragend", onEnd);
      window.removeEventListener("drop", onEnd);
      setDraggingPlayerId(null);
    };
    el.addEventListener("dragend", onEnd, { once: true });
    window.addEventListener("dragend", onEnd, { once: true });
    window.addEventListener("drop", onEnd, { once: true });
  };

  /* =========================================================
   *  ドロップ：フィールド（守備位置へ）
   * ======================================================= */

  /**
   * フィールドの守備位置へドロップ
   * - fromPosが取れない端末は assignments から逆引き（元仕様）
   * - DH重複禁止（元仕様）
   * - 打順整合（DHあり/なし）（元仕様）
   * - フィールドに入ったら benchOut から外す（元仕様）
   */
  const handleDropToPosition = (e: React.DragEvent<HTMLDivElement>, toPos: string) => {
    e.preventDefault();

    const playerIdStr =
      e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
    const playerId = Number(playerIdStr);

    // fromPosが取れない端末用フォールバック
    let fromPos = e.dataTransfer.getData("fromPosition");
    if (!fromPos) {
      fromPos =
        Object.entries(assignments).find(([, id]) => id === playerId)?.[0] ?? "";
    }

    const prevPlayerIdAtTo = assignments[toPos] ?? null;

    // 次状態を先に組み立てて、打順更新にも使う（元仕様）
    const next: Assignments = { ...assignments };

    // 交換（from→to）
    if (fromPos && fromPos !== toPos) {
      next[fromPos] = prevPlayerIdAtTo; // toにいた人をfromへ
    }

    // toPosがDHなら、同一選手が他の守備に入っていたら外す（重複禁止）
    if (toPos === DH) {
      for (const p of positions) {
        if (next[p] === playerId) next[p] = null;
      }
    }

    // toPosが守備位置なら、同一選手がDHに入っていたらDHを外す（重複禁止）
    if (toPos !== DH && next[DH] === playerId) {
      next[DH] = null;
    }

    // 最終的にtoへ配置
    next[toPos] = playerId;

    setAssignments(next);

    // 打順更新：DHあり/なしの整合（元仕様）
    setBattingOrder((prev) => {
      let updated = [...prev];

      const dhId = next[DH] ?? null;
      const pitcherId = next["投"] ?? null;

      // 今回動かした選手が打順に居なければ追加（ただしDH移動は例外扱い：元仕様）
      const isDHMove = toPos === DH || fromPos === DH;
      if (!isDHMove && !updated.some((e) => e.id === playerId)) {
        if (prevPlayerIdAtTo !== null) {
          const idx = updated.findIndex((e) => e.id === prevPlayerIdAtTo);
          if (idx !== -1) updated[idx] = { id: playerId, reason: "スタメン" };
          else updated.push({ id: playerId, reason: "スタメン" });
        } else {
          updated.push({ id: playerId, reason: "スタメン" });
        }
      }

      // フィールドのID一覧（投手含む9）
      const fieldIds = positions
        .map((pos) => next[pos])
        .filter((id): id is number => typeof id === "number");

      const fieldSet = new Set(fieldIds);

      if (!dhId) {
        // ✅ DHなし：打順＝フィールド9人（投手含む）
        updated = updated.filter((e) => fieldSet.has(e.id));
        for (const id of fieldIds) {
          if (!updated.some((e) => e.id === id)) {
            updated.push({ id, reason: "スタメン" });
          }
        }
      } else {
        // ✅ DHあり：打順＝（投手を除くフィールド8人）＋DH
        if (pitcherId) {
          updated = updated.filter((e) => e.id !== pitcherId);
        }

        const fieldNoPitcherSet = new Set(fieldIds.filter((id) => id !== pitcherId));
        updated = updated.filter((e) => fieldNoPitcherSet.has(e.id) || e.id === dhId);

        for (const id of fieldIds) {
          if (id === pitcherId) continue;
          if (updated.length >= 9) break;
          if (!updated.some((e) => e.id === id)) {
            updated.push({ id, reason: "スタメン" });
          }
        }

        // DHを必ず打順に入れる（元仕様）
        if (!updated.some((e) => e.id === dhId)) {
          if (updated.length < 9) {
            updated.push({ id: dhId, reason: "スタメン" });
          } else {
            updated[updated.length - 1] = { id: dhId, reason: "スタメン" };
          }
        }
      }

      // 重複除去 & 9人制限（元仕様）
      const seen = new Set<number>();
      updated = updated
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .slice(0, 9);

      return updated;
    });

    // フィールドに入ったら「出場しない選手」から外す（元仕様）
    setBenchOutIds((prev) => prev.filter((id) => id !== playerId));

    // ドロップ完了時のハイライト解除（元仕様）
    setDraggingPlayerId(null);
    setHoverPosKey(null);
  };

  /* =========================================================
   *  ドロップ：ベンチ外（出場しない選手）
   * ======================================================= */

  /**
   * 出場しない選手にドロップ
   * - ベンチ外へ追加（重複防止）
   * - 守備配置から完全に外す（DH含む）
   * - 打順から外す
   * - もし外したのがDHなら「DHなし」に戻るので投手を打順へ戻す（元仕様）
   */
  const handleDropToBenchOut = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const playerIdStr =
      e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
    const playerId = Number(playerIdStr);
    if (!playerId) return;

    // ① ベンチ外リストに追加（重複防止）
    setBenchOutIds((prev) => (prev.includes(playerId) ? prev : [...prev, playerId]));

    // ② 守備配置から完全に外す（DH含む）
    const oldDhId = assignments[DH] ?? null;

    const next = { ...assignments };
    for (const k of Object.keys(next)) {
      if (next[k] === playerId) next[k] = null;
    }
    setAssignments(next);

    // ③ 打順更新
    setBattingOrder((prev) => {
      let updated = prev.filter((e) => e.id !== playerId);

      // ✅ DH→出場しない に戻した場合：投手を打順へ戻す
      if (oldDhId === playerId) {
        const pitcherId = next["投"] ?? null;
        if (pitcherId && !updated.some((e) => e.id === pitcherId)) {
          updated.push({ id: pitcherId, reason: "スタメン" });
        }
      }

      // 重複除去 & 9人制限
      const seen = new Set<number>();
      updated = updated
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .slice(0, 9);

      return updated;
    });
  };

  /* =========================================================
   *  ドロップ：控え（ベンチ入り選手）
   * ======================================================= */

  /**
   * ベンチ入り選手（控え）へドロップ
   * - ベンチ外→控え：従来通り
   * - フィールド→控え は「DH」だけ許可（元仕様）
   * - DHを外したらDHなしに戻るので投手を打順へ戻す（元仕様）
   */
  const handleDropToBench = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();

    const playerId = Number(
      e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain")
    );
    if (!playerId) return;

    // fromPosition が取れない端末のフォールバック（元仕様）
    const fromPosRaw = e.dataTransfer.getData("fromPosition") || "";
    const fromPos =
      fromPosRaw ||
      (Object.entries(assignments).find(([, id]) => id === playerId)?.[0] ?? "");

    // ① ベンチ外 → 控え
    setBenchOutIds((prev) => prev.filter((id) => id !== playerId));

    // ② フィールド → 控え は「DH」だけ許可
    if (fromPos !== DH) return;

    // ③ DHを守備から外す
    const oldDhId = assignments[DH] ?? null;
    const next = { ...assignments, [DH]: null };
    setAssignments(next);

    // ④ 打順：DHを外したら投手を打順へ戻して9人に（元仕様）
    setBattingOrder((prev) => {
      let updated = [...prev];

      // DHだった選手を打順から除去
      if (oldDhId) {
        updated = updated.filter((e) => e.id !== oldDhId);
      }

      // ✅ DHなし → 投手を打順へ追加（いなければ）
      const pitcherId = next["投"] ?? null;
      if (pitcherId && !updated.some((e) => e.id === pitcherId)) {
        updated.push({ id: pitcherId, reason: "スタメン" });
      }

      // 重複除去 & 9人制限
      const seen = new Set<number>();
      updated = updated
        .filter((e) => {
          if (seen.has(e.id)) return false;
          seen.add(e.id);
          return true;
        })
        .slice(0, 9);

      return updated;
    });
  };

  /* =========================================================
   *  守備ラベル入替（swapPos）
   * ======================================================= */

  /**
   * 2選手の“現在の守備”を入替える（打順は触らない）
   * ※元仕様：守備位置のみスワップ
   */
  const swapPositionsByPlayers = (idA: number, idB: number) => {
    if (!idA || !idB || idA === idB) return;

    const posA = Object.entries(assignments).find(([, v]) => v === idA)?.[0] as
      | string
      | undefined;
    const posB = Object.entries(assignments).find(([, v]) => v === idB)?.[0] as
      | string
      | undefined;
    if (!posA || !posB) return;

    const next = { ...assignments };
    next[posA] = idB;
    next[posB] = idA;

    // DH二重登録の解消（元仕様）
    const DH_LOCAL = "指";
    if (posA !== DH_LOCAL && next[DH_LOCAL] === idB) next[DH_LOCAL] = null;
    if (posB !== DH_LOCAL && next[DH_LOCAL] === idA) next[DH_LOCAL] = null;

    setAssignments(next);
  };

  /**
   * 守備ラベルからドラッグ開始（swapPosモード）
   * - swapTokenで多重処理を抑止（元仕様）
   */
  const handlePosDragStart = (e: React.DragEvent<HTMLSpanElement>, playerId: number) => {
    e.stopPropagation();

    // 交換元の記録（Androidフォールバック）
    swapSourceIdRef.current = playerId;

    // 一意トークン発行
    const token = `${Date.now()}-${playerId}`;
    swapTokenRef.current = token;

    try {
      e.dataTransfer.setData("dragKind", "swapPos");
      e.dataTransfer.setData("swapSourceId", String(playerId));
      e.dataTransfer.setData("swapToken", token);
      e.dataTransfer.setData("text/plain", String(playerId));
      e.dataTransfer.setData("text", `swapPos:${playerId}:${token}`);
    } catch {}

    setTouchDrag((prev) => prev ?? { playerId });
    setDragKind("swapPos");

    const cleanup = () => {
      setDragKind(null);
      // tokenは残す（重複検知で使用）
      swapSourceIdRef.current = null;
    };
    window.addEventListener("dragend", cleanup, { once: true });
    window.addEventListener("drop", cleanup, { once: true });
  };

  /**
   * 守備ラベルへドロップ（swapPos成立）
   * - 即ドロップのズレ対策で elementFromPoint 再判定（元仕様）
   * - tokenで多重発火抑止（元仕様）
   */
  const handleDropToPosSpan = (
    e: React.DragEvent<HTMLSpanElement>,
    targetPlayerIdProp: number
  ) => {
    e.preventDefault();
    e.stopPropagation();

    // coordsからドロップ先を再判定（ズレ対策）
    let targetPlayerId = targetPlayerIdProp;
    const cx = (e as any).clientX ?? (e as any).pageX ?? null;
    const cy = (e as any).clientY ?? (e as any).pageY ?? null;
    if (typeof cx === "number" && typeof cy === "number") {
      const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
      const hit = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as
        | HTMLElement
        | null;
      const pid = hit ? Number(hit.getAttribute("data-player-id")) : 0;
      if (pid) targetPlayerId = pid;
    }

    const textAny = (e.dataTransfer.getData("text") || "").trim();
    const inferredKind = textAny.startsWith("swapPos:") ? "swapPos" : "";
    const kind = e.dataTransfer.getData("dragKind") || inferredKind || (dragKind ?? "");

    if (kind !== "swapPos") return;

    // token復元（dataTransfer → text → ref）
    let token = e.dataTransfer.getData("swapToken") || "";
    if (!token && textAny.startsWith("swapPos:")) {
      const parts = textAny.split(":");
      token = parts[2] || "";
    }
    if (!token) token = swapTokenRef.current || "";

    // 既に処理済みtokenは無視
    if (token) {
      if (handledSwapTokensRef.current.has(token)) return;
      handledSwapTokensRef.current.add(token);
    }

    // 交換元ID復元
    let srcStr =
      e.dataTransfer.getData("swapSourceId") ||
      e.dataTransfer.getData("text/plain") ||
      "";
    if (!srcStr && textAny.startsWith("swapPos:")) {
      const parts = textAny.split(":");
      srcStr = parts[1] || "";
    }

    let srcId = Number(srcStr);
    if (!srcId) srcId = swapSourceIdRef.current ?? 0;
    if (!srcId || !targetPlayerId) return;

    swapPositionsByPlayers(srcId, targetPlayerId);

    swapSourceIdRef.current = null;
    setDragKind(null);
  };

  /* =========================================================
   *  打順入替（order）
   * ======================================================= */

  /**
   * 打順行のドラッグ開始
   * - dragKindをorderに（元仕様）
   */
  const handleBattingOrderDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    playerId: number
  ) => {
    e.dataTransfer.setData("battingPlayerId", String(playerId));
    e.dataTransfer.setData("text/plain", String(playerId));

    setDragKind("order");

    const cleanup = () => setDragKind(null);
    window.addEventListener("dragend", cleanup, { once: true });
    window.addEventListener("drop", cleanup, { once: true });
  };

  /**
   * 打順行へのドロップ
   * - swapPosの場合は「守備入替」として処理（元仕様）
   * - orderの場合は「打順入替」として処理（元仕様）
   */
  const handleDropToBattingOrder = (
    e: React.DragEvent<HTMLDivElement>,
    targetPlayerId: number
  ) => {
    e.preventDefault();

    const textAny = (e.dataTransfer.getData("text") || "").trim();
    const inferredKind = textAny.startsWith("swapPos:") ? "swapPos" : "";
    const kind = e.dataTransfer.getData("dragKind") || inferredKind || (dragKind ?? "");

    if (kind === "swapPos") {
      // 交換元ID復元（dataTransfer → text → ref）
      let srcStr =
        e.dataTransfer.getData("swapSourceId") ||
        e.dataTransfer.getData("battingPlayerId") ||
        e.dataTransfer.getData("text/plain") ||
        "";
      if (!srcStr && textAny.startsWith("swapPos:")) {
        srcStr = textAny.split(":")[1] || "";
      }

      let srcId = Number(srcStr);
      if (!srcId) srcId = swapSourceIdRef.current ?? 0;

      if (srcId && srcId !== targetPlayerId) {
        swapPositionsByPlayers(srcId, targetPlayerId);
      }

      swapSourceIdRef.current = null;
      setDragKind(null);
      return;
    }

    // ↓↓ 打順入替（元ロジック） ↓↓
    const draggedStr =
      e.dataTransfer.getData("battingPlayerId") || e.dataTransfer.getData("text/plain");
    const draggedPlayerId = Number(draggedStr);

    setBattingOrder((prev) => {
      const fromIndex = prev.findIndex((entry) => entry.id === draggedPlayerId);
      const toIndex = prev.findIndex((entry) => entry.id === targetPlayerId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const updated = [...prev];
      [updated[fromIndex], updated[toIndex]] = [updated[toIndex], updated[fromIndex]];
      return updated;
    });
  };

  /* =========================================================
   *  参照系：選手の現在守備位置を逆引き
   * ======================================================= */
  const getPositionOfPlayer = (playerId: number) => {
    return Object.entries(assignments).find(([_, id]) => id === playerId)?.[0];
  };

  /* =========================================================
   *  useEffect群（副作用は上から「意味順」に整理）
   * ======================================================= */

  // 透明1x1ゴースト画像（初回だけ生成）
  useEffect(() => {
    if (!ghostImgRef.current) {
      const img = new Image();
      img.src =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
      ghostImgRef.current = img;
    }
  }, []);

  // 大谷ルールの保存値ロード（起動時）
  useEffect(() => {
    (async () => {
      const saved = await localForage.getItem<boolean>("ohtaniRule");
      if (typeof saved === "boolean") {
        setOhtaniRule(saved);
        return;
      }
      // 保存がない場合は、投=指 なら大谷ONとみなす（保険：元仕様）
      setOhtaniRule(
        typeof assignments["投"] === "number" && assignments["投"] === assignments["指"]
      );
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ スタメン設定：投手とDHが同一なら大谷ルールを自動ON（チェックON）
useEffect(() => {
  const p = assignments["投"];
  const d = assignments["指"];

  // 両方がセットされ、かつ同一IDならON
  if (typeof p === "number" && typeof d === "number" && p === d) {
    if (!ohtaniRule) {
      console.log("[OHTANI] auto ON (P=DH detected)", { pitcherId: p });
      setOhtaniRule(true);
      void localForage.setItem("ohtaniRule", true);
    }
  }
}, [assignments["投"], assignments["指"], ohtaniRule]);

  // 大谷ルールON時：指＝投 を同期し、打順も同期（元仕様）
  useEffect(() => {
    if (!ohtaniRule) return;

    const newPitcherId = assignments["投"] ?? null;
    const oldDhId = assignments["指"] ?? null;

    if (!newPitcherId) return;

    // ① 守備配置：指＝投 を同期
    setAssignments((prev) => {
      const p = prev["投"] ?? null;
      if (prev["指"] === p) return prev;
      return { ...prev, ["指"]: p };
    });

    // ② 打順：旧DH枠を新投手に差し替え
    setBattingOrder((prev) => {
      let updated = [...prev];

      // 新投手が既に打順にいたら重複防止で消す
      updated = updated.filter((e) => e.id !== newPitcherId);

      const idx = updated.findIndex((e) => e.id === oldDhId);
      if (idx !== -1) {
        updated[idx] = { id: newPitcherId, reason: "スタメン" };
      } else if (!updated.some((e) => e.id === newPitcherId)) {
        updated.push({ id: newPitcherId, reason: "スタメン" });
      }

      // 重複排除＆9人制限
      const seen = new Set<number>();
      updated = updated
        .filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)))
        .slice(0, 9);

      return updated;
    });
  }, [ohtaniRule, assignments["投"]]);

  // App側「← 試合情報に戻る」ボタンに未保存確認を噛ませる（元仕様）
  useEffect(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const appBackBtn = buttons.find((b) =>
      (b.textContent || "").includes("← 試合情報に戻る")
    ) as HTMLButtonElement | undefined;

    if (appBackBtn) {
      const origHandler = appBackBtn.onclick;
      appBackBtn.onclick = (e) => {
        e.preventDefault();
        if (isDirty) {
          setShowLeaveConfirm(true);
        } else {
          origHandler?.call(appBackBtn, e);
        }
      };
    }
  }, [isDirty]);

  // 保存先キー：startingassignments / startingBattingOrder を正として扱う（元仕様）
  useEffect(() => {
    (async () => {
      // ① 専用領域から読む
      const a = await localForage.getItem<Record<string, number | null>>("startingassignments");
      const o = await localForage.getItem<Array<{ id: number; reason?: string }>>(
        "startingBattingOrder"
      );

      if (a && o?.length) {
        setAssignments(a);
        setBattingOrder(o as BattingEntry[]);
        return;
      }

      // ② 専用領域が無ければ、既存の全体設定から初期化して専用領域に保存（元仕様）
      const globalA = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
      const globalO = await localForage.getItem<Array<{ id: number; reason?: string }>>(
        "battingOrder"
      );

      let baseA =
        globalA ??
        (Object.fromEntries([...positions, DH].map((p) => [p, null])) as Record<
          string,
          number | null
        >);
      let baseO = globalO ?? [];

      // 打順が無ければ守備から暫定生成（DH考慮：投手を外してDHを入れる）
      if (baseO.length === 0) {
        const dhId = baseA[DH] ?? null;
        const orderPositions = dhId
          ? [...positions.filter((p) => p !== "投"), DH]
          : [...positions];
        const ids = orderPositions
          .map((p) => baseA[p])
          .filter((id): id is number => typeof id === "number");
        baseO = ids.slice(0, 9).map((id) => ({ id, reason: "スタメン" }));
      }

      setAssignments(baseA);
      setBattingOrder(baseO as BattingEntry[]);
      await localForage.setItem("startingassignments", baseA);
      await localForage.setItem("startingBattingOrder", baseO);
    })();
  }, []);

  // teamPlayersロード（元仕様）
  useEffect(() => {
    localForage.getItem<{ players: Player[] }>("team").then((team) => {
      setTeamPlayers(team?.players || []);
    });
  }, []);

  // 初回ロード後にdirty判定の基準を固定（元仕様）
  useEffect(() => {
    if (!initDoneRef.current) {
      snapshotRef.current = buildSnapshot();
      setIsDirty(false);
      initDoneRef.current = true;
      return;
    }
    setIsDirty(buildSnapshot() !== snapshotRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignments, battingOrder, benchOutIds]);

  // draft保存（Start: StartGame等が拾えるように）（元仕様）
  useEffect(() => {
    localForage.setItem("startingassignments_draft", assignments);
  }, [assignments]);
  useEffect(() => {
    localForage.setItem("startingBattingOrder_draft", battingOrder);
  }, [battingOrder]);
  useEffect(() => {
    localForage.setItem("startingBenchOutIds_draft", benchOutIds);
  }, [benchOutIds]);

  /**
   * グローバルtouchend：
   * 指を離した位置の守備ラベルを自動検出して入替（swapPos）
   * ※元仕様をそのまま維持
   */
  useEffect(() => {
    const dropTo = (targetPlayerId: number) => {
      if (!touchDrag || !targetPlayerId) {
        setTouchDrag(null);
        return;
      }
      const fake = {
        preventDefault: () => {},
        stopPropagation: () => {},
        dataTransfer: {
          getData: (key: string) => {
            if (key === "dragKind") return "swapPos";
            if (key === "swapSourceId" || key === "text/plain")
              return String(touchDrag.playerId);
            if (key === "swapToken") return swapTokenRef.current || "";
            return "";
          },
        },
      } as unknown as React.DragEvent<HTMLSpanElement>;

      handleDropToPosSpan(fake, targetPlayerId);
      hoverTargetRef.current = null;
      setTouchDrag(null);
    };

    const pickByPoint = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      const t = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as
        | HTMLElement
        | null;
      const pid = t ? Number(t.getAttribute("data-player-id")) : 0;
      if (pid) dropTo(pid);
      else setTouchDrag(null);
    };

    const onTouchMove = (ev: TouchEvent) => {
      const t = ev.touches && ev.touches[0];
      if (!t) return;
      lastTouchRef.current = { x: t.clientX, y: t.clientY };
      const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
      const h = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as
        | HTMLElement
        | null;
      const pid = h ? Number(h.getAttribute("data-player-id")) : 0;
      if (pid) hoverTargetRef.current = pid;
    };

    const onTouchEnd = (ev: TouchEvent) => {
      if (!touchDrag) return;
      const pid = hoverTargetRef.current;
      if (pid) return dropTo(pid);

      const t = ev.changedTouches && ev.changedTouches[0];
      if (!t) return setTouchDrag(null);

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pickByPoint(t.clientX, t.clientY);
        });
      });
    };

    const onDragEnd = (_ev: DragEvent) => {
      if (!touchDrag) return;
      const pid = hoverTargetRef.current;
      if (pid) return dropTo(pid);
      const p = lastTouchRef.current;
      if (p) pickByPoint(p.x, p.y);
      else setTouchDrag(null);
    };

    window.addEventListener("touchmove", onTouchMove, { passive: true, capture: true });
    window.addEventListener("touchend", onTouchEnd, { passive: false, capture: true });
    window.addEventListener("dragend", onDragEnd, { passive: true, capture: true });
    return () => {
      window.removeEventListener("touchmove", onTouchMove, true);
      window.removeEventListener("touchend", onTouchEnd, true);
      window.removeEventListener("dragend", onDragEnd, true);
    };
  }, [touchDrag]);

  /**
   * 初期データロード（starting***優先 → フォールバック）
   * - benchOutIdsは保存が無ければ「全員ベンチ外」に初期化（元仕様）
   */
  useEffect(() => {
    const loadInitialData = async () => {
      const team = await localForage.getItem<{ players: Player[] }>("team");
      setTeamPlayers(team?.players || []);

      const savedBenchOut = await localForage.getItem<number[]>("startingBenchOutIds");
      if (savedBenchOut) setBenchOutIds(savedBenchOut);

      // 保存が無ければ初期状態は「全員ベンチ外」（元仕様）
      if (!savedBenchOut) {
        const ids = (team?.players || []).map((p) => p.id);
        setBenchOutIds(ids);
        await localForage.setItem("startingBenchOutIds", ids);
      }

      // 保存済みの完全な守備配置/打順から復元（元仕様）
      const savedAssignments = await localForage.getItem<Assignments>("startingassignments");
      const savedBattingOrder = await localForage.getItem<BattingEntry[]>("startingBattingOrder");

      if (savedAssignments) {
        // 欠けたキーに備えて全スロットを初期化してからマージ（元仕様）
        const base = createEmptyAssignments();
        const merged = { ...base, ...savedAssignments };
        setAssignments(merged);

        if (savedBattingOrder && savedBattingOrder.length) {
          setBattingOrder(savedBattingOrder.slice(0, 9));
        }
        return;
      }

      // フォールバック：専用の初期記録から復元（元仕様）
      const initialOrder = await localForage.getItem<
        { id: number; order: number; position: string }[]
      >("startingInitialSnapshot");

      if (initialOrder && initialOrder.length > 0) {
        const newAssignments: Assignments = createEmptyAssignments();
        const newBattingOrder: BattingEntry[] = [];

        for (const entry of initialOrder) {
          newAssignments[entry.position] = entry.id;
          newBattingOrder[entry.order - 1] = { id: entry.id, reason: "スタメン" };
        }
        setAssignments(newAssignments);
        setBattingOrder(newBattingOrder.slice(0, 9));
      }
    };

    loadInitialData();
  }, []);

  // 右クリック等を抑止（スマホ誤操作防止：元仕様）
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener("contextmenu", block, { capture: true });
    document.addEventListener("selectstart", block, { capture: true });
    document.addEventListener("gesturestart", block as any, { capture: true });

    return () => {
      document.removeEventListener("contextmenu", block, true);
      document.removeEventListener("selectstart", block, true);
      document.removeEventListener("gesturestart", block as any, true);
    };
  }, []);

  /* =========================================================
   *  画面表示用の派生データ（UIに使う）
   * ======================================================= */
  const assignedIds = Object.values(assignments).filter(Boolean) as number[];
  const availablePlayers = teamPlayers.filter((p) => !assignedIds.includes(p.id));
  const benchOutPlayers = teamPlayers.filter((p) => benchOutIds.includes(p.id));

  /* =========================================================
   *  JSX（UIは変えない：元の構造/クラス/文言を維持）
   * ======================================================= */
  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6 select-none"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
      }}
      onContextMenu={(e) => e.preventDefault()}
      onSelectStart={(e) => e.preventDefault()}
    >
      <div className="mt-3 text-center select-none mb-2">
        <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-wide leading-tight">
          <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
            <path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h10v2H3v-2z" />
          </svg>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
            スタメン設定
          </span>
        </h1>
        <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
        <div className="mt-3 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-100 border border-red-300">
          <span className="text-sm font-extrabold text-red-600">
            ドラッグ＆ドロップで打順通り配置してください
          </span>
        </div>
      </div>

      {/* フィールド配置（カード） */}
      <section
        className="
     mb-6
     w-[100svw] -mx-6 md:mx-auto md:w-full md:max-w-2xl
     p-3 md:p-4
     bg-white/5 md:bg-white/10
     border-x-0 md:border md:border-white/10
     rounded-none md:rounded-2xl
     ring-0 md:ring-1 md:ring-inset md:ring-white/10
     shadow
   "
      >
        <div className="flex items-center gap-2 mb-3">
          <span className="w-9 h-9 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
              <path d="M12 2L2 12l10 10 10-10L12 2zm0 4l6 6-6 6-6-6 6-6z" />
            </svg>
          </span>
          <h2 className="font-semibold text-white">フィールド配置</h2>
        </div>

        <div className="relative">
          {/* ✅ DH / 大谷ルール（フィールド右下固定） */}
          <div className="absolute left-3 bottom-2 z-30 flex items-center gap-3">
            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-yellow-400/20 border border-yellow-300/50">
              <input
                type="checkbox"
                className="w-5 h-5 accent-yellow-400"
                checked={ohtaniRule}
                onChange={(e) => {
                  const next = e.target.checked;

                  // 切替前の状態を捕まえる（元仕様）
                  const pitcherIdNow = assignments["投"] ?? null;
                  const dhIdNow = assignments["指"] ?? null;

                  setOhtaniRule(next);
                  localForage.setItem("ohtaniRule", next);

                  if (next) {
                    // ===== 大谷ルール ON：DH = 投手 =====
                    prevDhIdRef.current = dhIdNow;

                    setAssignments((prev) => {
                      const pitcherId = prev["投"] ?? null;
                      return { ...prev, ["指"]: pitcherId };
                    });

                    // 打順：旧DH枠を投手へ差し替え（元仕様）
                    setBattingOrder((prev) => {
                      let updated = [...prev];
                      const pitcherId = pitcherIdNow;
                      const oldDhId = dhIdNow;

                      if (pitcherId) {
                        updated = updated.filter((e) => e.id !== pitcherId);

                        if (oldDhId) {
                          const dIdx = updated.findIndex((e) => e.id === oldDhId);
                          if (dIdx !== -1) {
                            updated[dIdx] = { id: pitcherId, reason: "スタメン" };
                          } else {
                            updated.push({ id: pitcherId, reason: "スタメン" });
                          }
                        } else {
                          updated.push({ id: pitcherId, reason: "スタメン" });
                        }
                      }

                      const seen = new Set<number>();
                      updated = updated
                        .filter((x) => {
                          if (seen.has(x.id)) return false;
                          seen.add(x.id);
                          return true;
                        })
                        .slice(0, 9);

                      return updated;
                    });
                  } else {
                    // ===== 大谷ルール OFF：DHを元に戻す =====
                    const restoreDhId = prevDhIdRef.current ?? null;

                    setAssignments((prev) => {
                      return { ...prev, ["指"]: restoreDhId };
                    });

                    // 打順を戻す（元仕様）
                    setBattingOrder((prev) => {
                      let updated = [...prev];
                      const pitcherId = pitcherIdNow;
                      const dhId = restoreDhId;

                      if (pitcherId && dhId) {
                        const pIdx = updated.findIndex((e) => e.id === pitcherId);
                        if (pIdx !== -1) {
                          updated[pIdx] = { id: dhId, reason: "スタメン" };
                        } else if (!updated.some((e) => e.id === dhId)) {
                          updated.push({ id: dhId, reason: "スタメン" });
                        }
                        updated = updated.filter((e) => e.id !== pitcherId);
                      } else if (pitcherId && !dhId) {
                        if (!updated.some((e) => e.id === pitcherId)) {
                          updated.push({ id: pitcherId, reason: "スタメン" });
                        }
                      } else if (!pitcherId && dhId) {
                        if (!updated.some((e) => e.id === dhId)) {
                          updated.push({ id: dhId, reason: "スタメン" });
                        }
                      }

                      const seen = new Set<number>();
                      updated = updated
                        .filter((x) => {
                          if (seen.has(x.id)) return false;
                          seen.add(x.id);
                          return true;
                        })
                        .slice(0, 9);

                      return updated;
                    });
                  }
                }}
              />
              <span className="font-bold text-yellow-100 whitespace-nowrap">大谷ルール</span>
            </label>
          </div>

          <img
            src="/field.png"
            alt="フィールド図"
            draggable={false}
            className="w-full h-auto md:rounded shadow select-none pointer-events-none"
          />

          {allSlots.map((pos) => {
            const playerId = assignments[pos];
            const player = teamPlayers.find((p) => p.id === playerId);
            return (
              <div
                key={pos}
                draggable={!!player}
                onDragStart={(e) => player && handleDragStart(e, player.id, pos)}
                onDragEnter={() => setHoverPosKey(pos)}
                onDragLeave={() => setHoverPosKey((v) => (v === pos ? null : v))}
                onDragOver={allowDrop}
                onDrop={(e) => {
                  handleDropToPosition(e, pos);
                  setHoverPosKey(null);
                }}
                onTouchStart={() => player && setTouchDrag({ playerId: player.id, fromPos: pos })}
                onTouchEnd={() => {
                  if (!touchDrag) return;
                  const fake = makeFakeDragEvent({
                    playerId: String(touchDrag.playerId),
                    "text/plain": String(touchDrag.playerId),
                    fromPosition: touchDrag.fromPos ?? "",
                  });
                  handleDropToPosition(fake, pos);
                  setTouchDrag(null);
                }}
                style={{
                  ...positionStyles[pos],
                  position: "absolute",
                  transform: "translate(-50%, -50%)",
                  cursor: player ? "move" : "default",
                }}
                className={`z-10 min-w-[72px] sm:min-w-[96px] max-w-[40vw] sm:max-w-[160px]
                  px-2 sm:px-2.5 h-8 sm:h-9
                  rounded-xl bg-white/90 text-gray-900 shadow border border-white/70
                  ${hoverPosKey === pos ? "ring-4 ring-emerald-400" : ""}
                  backdrop-blur-[2px] text-center
                  flex items-center justify-center select-none touch-none`}
              >
                {player ? (
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, player.id, pos)}
                    style={{ WebkitUserDrag: "none", touchAction: "none" }}
                    className={`relative w-full h-full flex items-center justify-center font-semibold
                  whitespace-nowrap overflow-hidden text-ellipsis text-sm sm:text-base
                  leading-none select-none rounded-lg
                  ${
                    draggingPlayerId === player.id
                      ? "bg-amber-500 text-white ring-4 ring-amber-300"
                      : ""
                  }`}
                  >
                    {player.lastName}
                    {player.firstName} #{player.number}
                  </div>
                ) : (
                  <div className="text-gray-500">{pos === DH ? "DHなし" : "空き"}</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* 控え＋打順（縦並び） */}
      <div className="flex flex-col gap-6">
        {/* 控え選手 */}
        <div>
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <span className="inline-flex w-9 h-9 rounded-xl bg-white/15 border border-white/20 items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor">
                <path d="M4 15h16v2H4zm2-4h12v2H6zm2-4h8v2H8z" />
              </svg>
            </span>
            ベンチ入り選手
          </h2>
          <div
            className="flex flex-wrap gap-2 min-h-[60px] p-2 bg-white/10 border border-white/10 rounded-xl ring-1 ring-inset ring-white/10"
            onDragOver={allowDrop}
            onDrop={handleDropToBench}
            onTouchEnd={() => {
              if (!touchDrag) return;
              const fake = makeFakeDragEvent({
                playerId: String(touchDrag.playerId),
                "text/plain": String(touchDrag.playerId),
                fromPosition: touchDrag.fromPos ?? "",
              });
              handleDropToBench(fake);
              setTouchDrag(null);
            }}
          >
            {teamPlayers
              .filter((p) => !assignedIds.includes(p.id) && !benchOutIds.includes(p.id))
              .map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  onTouchStart={() => setTouchDrag({ playerId: p.id })}
                  style={{ touchAction: "none" }}
                  className={`px-2.5 py-1.5 bg-white/85 text-gray-900 border border-rose-200 rounded-lg cursor-move select-none shadow-sm
                                ${draggingPlayerId === p.id ? "ring-4 ring-amber-400 bg-amber-100" : ""}`}
                >
                  {p.lastName}
                  {p.firstName} #{p.number}
                </div>
              ))}
          </div>
        </div>

        {/* ベンチ外選手 */}
        <div>
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <span className="inline-flex w-9 h-9 rounded-xl bg-rose-400/25 border border-rose-300/50 items-center justify-center">
              <IconOut />
            </span>
            出場しない選手
          </h2>
          <div
            className="flex flex-wrap gap-2 min-h-[60px] p-2
              rounded-2xl border ring-1 ring-inset
              border-rose-600/90 ring-rose-600/60
              bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25"
            onDragOver={allowDrop}
            onDrop={handleDropToBenchOut}
          >
            {benchOutPlayers.length === 0 ? (
              <div className="text-gray-400">出場しない選手はいません</div>
            ) : (
              benchOutPlayers.map((p) => (
                <div
                  key={p.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, p.id)}
                  className="px-2.5 py-1.5 bg-white/85 text-gray-900 border border-rose-200 rounded-lg cursor-move select-none shadow-sm"
                >
                  {p.lastName}
                  {p.firstName} #{p.number}
                </div>
              ))
            )}
          </div>
        </div>

        {/* 打順 */}
        <div>
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <span className="inline-flex w-9 h-9 rounded-xl bg-white/15 border border-white/20 items-center justify-center">
              <IconOrder />
            </span>
            打順（1～9番）
            <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10">
              ドラッグ＆ドロップで変更
            </span>
          </h2>

          <div className="space-y-2">
            {battingOrder.map((entry, i) => {
              const player = teamPlayers.find((p) => p.id === entry.id);
              if (!player) return null;

              const pos = getPositionOfPlayer(entry.id);

              // 表示だけ：大谷ルールON中は「投手＝DH表示」（元仕様）
              const displayPos = ohtaniRule && assignments["投"] === entry.id ? "指" : pos;

              return (
                <div
                  key={entry.id}
                  data-role="posrow"
                  data-player-id={entry.id}
                  className={`rounded-xl bg-sky-400/15 border border-sky-300/40 p-2 shadow cursor-move select-none
                  ${
                    hoverOrderPlayerId === entry.id && dragKind !== "swapPos"
                      ? "ring-2 ring-emerald-400"
                      : ""
                  }`}
                  draggable
                  onDragStart={(e) => {
                    const t = e.target as HTMLElement;
                    if (t && t.closest('[data-role="poslabel"]')) return;
                    handleBattingOrderDragStart(e, entry.id);
                  }}
                  onDrop={(e) => {
                    handleDropToBattingOrder(e, entry.id);
                    setHoverOrderPlayerId(null);
                  }}
                  onDragOver={(e) => {
                    allowDrop(e);
                    setHoverOrderPlayerId(entry.id);
                  }}
                  onDragEnter={(e) => {
                    allowDrop(e);
                    setHoverOrderPlayerId(entry.id);
                  }}
                  onDragLeave={() =>
                    setHoverOrderPlayerId((v) => (v === entry.id ? null : v))
                  }
                >
                  <div className="flex items-center gap-2 flex-nowrap">
                    <span className="w-10 font-bold">{i + 1}番</span>
                    <span
                      data-role="poslabel"
                      data-player-id={entry.id}
                      className={`w-28 md:w-24 px-1 rounded cursor-move select-none text-center whitespace-nowrap shrink-0 touch-none
                    ${
                      hoverOrderPlayerId === entry.id && dragKind === "swapPos"
                        ? "ring-2 ring-emerald-400 bg-emerald-500/20"
                        : "bg-white/10 border border-white/10"
                    }`}
                      title={pos ? "この守備を他の行と入替" : "守備なし"}
                      draggable={!!pos}
                      onDragStart={(e) => handlePosDragStart(e, entry.id)}
                      onDragOver={(e) => {
                        allowDrop(e);
                        setHoverOrderPlayerId(entry.id);
                      }}
                      onDrop={(e) => {
                        handleDropToPosSpan(e, entry.id);
                        setHoverOrderPlayerId(null);
                      }}
                      onDragEnter={(e) => {
                        allowDrop(e);
                        setHoverOrderPlayerId(entry.id);
                      }}
                      onDragLeave={() =>
                        setHoverOrderPlayerId((v) => (v === entry.id ? null : v))
                      }
                      onTouchStart={(ev) => {
                        ev.stopPropagation();
                        pos && setTouchDrag({ playerId: entry.id });
                      }}
                    >
                      {displayPos ? positionNames[displayPos] : "控え"}
                    </span>

                    <span className="ml-4 whitespace-nowrap">
                      {player.lastName}
                      {player.firstName}
                    </span>
                    <span className="w-12">#{player.number}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* 操作ボタン群 */}
      <div className="mt-6 flex w-full gap-4">
        <button className="flex-[3] bg-red-500 text-white py-3 rounded font-semibold" onClick={onClearClick}>
          クリア
        </button>
        <button className="flex-[7] bg-blue-600 text-white py-3 rounded font-semibold" onClick={saveAssignments}>
          保存する
        </button>
      </div>

      {/* 戻る */}
      <div className="mt-4 w-full">
        <button
          className="w-full bg-gray-700 text-white py-3 rounded font-semibold hover:bg-gray-600 active:bg-gray-800"
          onClick={() => {
            isDirty ? setShowLeaveConfirm(true) : handleBack();
          }}
        >
          ← 戻る
        </button>
      </div>

      {/* クリア確認モーダル */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 px-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="bg-green-600 text-white text-center font-bold py-3">確認</div>
            <div className="px-6 py-5 text-center text-[15px] leading-relaxed">
              <p className="whitespace-pre-line font-bold text-gray-800">
                スタメン、ベンチ入りの選手がクリアされて{"\n"}
                全員が出場しない選手になります。{"\n"}
                よろしいですか？
              </p>
            </div>
            <div className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  className="w-full py-3 rounded-full bg-red-600 text-white font-semibold
                       hover:bg-red-700 active:bg-red-800"
                  onClick={() => setShowConfirm(false)}
                >
                  NO
                </button>
                <button
                  className="w-full py-3 rounded-full bg-green-600 text-white font-semibold
                       hover:bg-green-700 active:bg-green-800"
                  onClick={proceedClear}
                >
                  YES
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 未保存確認モーダル */}
      {showLeaveConfirm && (
        <div
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 px-6"
          role="dialog"
          aria-modal="true"
          onClick={() => setShowLeaveConfirm(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            <div className="bg-green-600 text-white text-center font-bold py-3">確認</div>
            <div className="px-6 py-5 text-center">
              <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
                変更した内容を保存していませんが{"\n"}
                よろしいですか？
              </p>
            </div>
            <div className="px-5 pb-5">
              <div className="grid grid-cols-2 gap-3">
                <button
                  className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
                  onClick={() => setShowLeaveConfirm(false)}
                >
                  NO
                </button>
                <button
                  className="w-full py-3 rounded-full bg-green-600 text-white font-semibold hover:bg-green-700 active:bg-green-800"
                  onClick={() => {
                    setShowLeaveConfirm(false);
                    handleBack();
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

/* =========================================================
 *  DndProviderラッパ（スマホ/PCでbackend切替）
 * ======================================================= */
const StartingLineupWrapped = () => {
  return (
    <DndProvider
      backend={isTouchDevice() ? TouchBackend : HTML5Backend}
      options={
        isTouchDevice()
          ? {
              enableTouchEvents: true,
              enableMouseEvents: true,
              touchSlop: 10, // ドラッグ開始の遊び（px）
              delayTouchStart: 10, // 長押し待ち時間（ms）
            }
          : undefined
      }
    >
      <StartingLineup />
    </DndProvider>
  );
};

export default StartingLineupWrapped;
