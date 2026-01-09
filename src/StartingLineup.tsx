import React, { useState, useEffect } from "react";
import localForage from "localforage";
import { DndProvider } from 'react-dnd';
import { HTML5Backend } from 'react-dnd-html5-backend';
import { TouchBackend } from 'react-dnd-touch-backend';
import { useNavigate } from "react-router-dom";

// ▼ 見た目だけのミニSVG
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


const positions = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右"];
// ▼ 追加（フィールド上の守備位置に含めないDHキー）
const DH = "指"; // 守備位置キー
const allSlots = [...positions, DH]; // 守備割当マップはDHも含めて扱う
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

type Player = {
  id: number;
  lastName: string;
  firstName: string;
  number: string;
};

const StartingLineup = () => {
  // ▼ 未保存チェック用
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const snapshotRef = React.useRef<string | null>(null);
  const initDoneRef = React.useRef(false);

  // 現在の編集中状態をスナップショット化（比較用）
  const buildSnapshot = () =>
    JSON.stringify({
      assignments,
      battingOrder,
      benchOutIds,
    });

    const navigate = useNavigate();
  // 試合情報画面（MatchCreate）のパスに合わせて調整して下さい
// ★ MatchCreate の実ルート名に合わせて！例: "/MatchCreate" or "/match-create"
const MATCH_CREATE_PATH = "/MatchCreate";

// ← これを StartingLineup.tsx の handleBack にそのままコピペ
const handleBack = () => {
  // 1) App.tsx が描画している「← 試合情報に戻る」ボタンを探す
  const buttons = Array.from(document.querySelectorAll("button"));
  const appBackBtn = buttons.find((b) =>
    (b.textContent || "").includes("← 試合情報に戻る")
  ) as HTMLButtonElement | undefined;

  if (appBackBtn) {
    console.log("[StartingLineup] trigger App back button click");
    appBackBtn.click();                 // ← App 側の onClick（setScreen('matchCreate')）を発火
    return;
  }

  // 2) 念のための保険：見つからない場合はメニュー→試合情報の導線に合わせて遷移（任意）
  // window.location.href = "/"; // もしメニューが '/' で、そこから試合情報に行けるなら使う
  console.warn("[StartingLineup] App back button not found.");
};


  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [assignments, setAssignments] = useState<{ [pos: string]: number | null }>(
    Object.fromEntries(allSlots.map((p) => [p, null]))
  );
  const [battingOrder, setBattingOrder] = useState<
    { id: number; reason: "スタメン" }[]
  >([]);

  // タッチ（スマホ）用：選手選択を保持
const [touchDrag, setTouchDrag] = useState<{ playerId: number; fromPos?: string } | null>(null);
// ドラッグ中の選手ID／ホバー中のターゲット
const [draggingPlayerId, setDraggingPlayerId] = useState<number | null>(null);
const [hoverPosKey, setHoverPosKey] = useState<string | null>(null);        // フィールドの各ポジション用
const [hoverOrderPlayerId, setHoverOrderPlayerId] = useState<number | null>(null); // 打順行の選手用
// いま何のドラッグか：守備ラベル入替 (swapPos) / 打順入替 (order)
const [dragKind, setDragKind] = useState<"swapPos" | "order" | null>(null);

const [touchDragBattingId, setTouchDragBattingId] = useState<number | null>(null);


// タッチの最終座標（フォールバック用）
const lastTouchRef = React.useRef<{ x: number; y: number } | null>(null);
const hoverTargetRef = React.useRef<number | null>(null);

// 既存の handleDrop... を流用するためのダミーDragEvent
const makeFakeDragEvent = (payload: Record<string, string>) =>
  ({
    preventDefault: () => {},
    dataTransfer: {
      getData: (key: string) => payload[key] ?? "",
    },
  } as unknown as React.DragEvent<HTMLDivElement>);


  const [benchOutIds, setBenchOutIds] = useState<number[]>([]);

  const [showConfirm, setShowConfirm] = useState(false);
  const onClearClick = () => setShowConfirm(true);
  const proceedClear = async () => {
    setShowConfirm(false);
    await clearAssignments(); // 既存のクリア処理を実行
  };

useEffect(() => {
  const buttons = Array.from(document.querySelectorAll("button"));
  const appBackBtn = buttons.find((b) =>
    (b.textContent || "").includes("← 試合情報に戻る")
  ) as HTMLButtonElement | undefined;

  if (appBackBtn) {
    // 元のクリック動作を退避
    const origHandler = appBackBtn.onclick;
    appBackBtn.onclick = (e) => {
      e.preventDefault();
      if (isDirty) {
        setShowLeaveConfirm(true); // ← 既に作ったモーダルを再利用
      } else {
        // dirty でなければ元の動作（setScreen("matchCreate")）を実行
        origHandler?.call(appBackBtn, e);
      }
    };
  }
}, [isDirty]);

  // 保存先キー：startingassignments / startingBattingOrder を正として扱う
  useEffect(() => {
    (async () => {
      // ① まず専用領域から読む
      const a = await localForage.getItem<Record<string, number|null>>("startingassignments");
      const o = await localForage.getItem<Array<{id:number; reason?:string}>>("startingBattingOrder");

      if (a && o?.length) {
        setAssignments(a);
        setBattingOrder(o);
        return;
      }

      // ② 専用領域が無ければ、既存の全体設定から初期化して専用領域に保存
      const globalA = await localForage.getItem<Record<string, number|null>>("lineupAssignments");
      const globalO = await localForage.getItem<Array<{id:number; reason?:string}>>("battingOrder");

      let baseA = globalA ?? Object.fromEntries([...positions, DH].map(p => [p, null])) as Record<string, number|null>;
      let baseO = globalO ?? [];

      // 打順が無ければ守備から暫定生成（DH考慮：投手を外してDHを入れる）
      if (baseO.length === 0) {
        const dhId = baseA[DH] ?? null;
        const orderPositions = dhId ? [...positions.filter(p => p !== "投"), DH] : [...positions];
        const ids = orderPositions.map(p => baseA[p]).filter((id): id is number => typeof id === "number");
        baseO = ids.slice(0, 9).map(id => ({ id, reason: "スタメン" }));
      }

      setAssignments(baseA);
      setBattingOrder(baseO);
      // 専用領域を作成
      await localForage.setItem("startingassignments", baseA);
      await localForage.setItem("startingBattingOrder", baseO);
    })();
  }, []);


  useEffect(() => {
    localForage.getItem<{ players: Player[] }>("team").then((team) => {
      setTeamPlayers(team?.players || []);
    });
    
  }, []);

  // 初回：ロード後に“現在値”を基準化。以降は差分で dirty 判定
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


  // iOS判定 & 透明1pxゴースト画像
const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
const ghostImgRef = React.useRef<HTMLImageElement | null>(null);
// ★ 追加：入替の一意トークン管理（重複ドロップ防止）
const swapSourceIdRef = React.useRef<number | null>(null);  // 既に追加済みなら再追加不要
const swapTokenRef = React.useRef<string | null>(null);
const handledSwapTokensRef = React.useRef<Set<string>>(new Set());

// === Drag中のスクロールロック ===
const scrollLockDepthRef = React.useRef(0);
const preventRef = React.useRef<(e: Event) => void>();



const lockScroll = () => {
  if (++scrollLockDepthRef.current > 1) return;
  const prevent = (e: Event) => e.preventDefault();
  preventRef.current = prevent;
  document.body.style.overflow = "hidden";
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


useEffect(() => {
  if (!ghostImgRef.current) {
    const img = new Image();
    // 1x1完全透明PNG
    img.src =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=";
    ghostImgRef.current = img;
  }
}, []);


// ★ 追加：ドラフト（未保存でも StartGame で拾えるようにする）
useEffect(() => {
  localForage.setItem("startingassignments_draft", assignments);
}, [assignments]);

useEffect(() => {
  localForage.setItem("startingBattingOrder_draft", battingOrder);
}, [battingOrder]);

useEffect(() => {
  localForage.setItem("startingBenchOutIds_draft", benchOutIds);
}, [benchOutIds]);

// 👉 グローバル touchend：指を離した位置の守備ラベルを自動検出して入替
useEffect(() => {
  const dropTo = (targetPlayerId: number) => {
    if (!touchDrag || !targetPlayerId) { setTouchDrag(null); return; }
    const fake = {
      preventDefault: () => {},
      stopPropagation: () => {},
      dataTransfer: {
        getData: (key: string) => {
          if (key === "dragKind") return "swapPos";
          if (key === "swapSourceId" || key === "text/plain") return String(touchDrag.playerId);
          if (key === "swapToken") return swapTokenRef.current || ""; // ★ 追加：トークンも供給
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
    const t = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as HTMLElement | null;
    const pid = t ? Number(t.getAttribute('data-player-id')) : 0;
    if (pid) dropTo(pid); else setTouchDrag(null);
  };

  // 指の移動で座標とホバー先を更新
  const onTouchMove = (ev: TouchEvent) => {
    const t = ev.touches && ev.touches[0];
    if (!t) return;
    lastTouchRef.current = { x: t.clientX, y: t.clientY };
    const el = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
    const h = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as HTMLElement | null;
    const pid = h ? Number(h.getAttribute('data-player-id')) : 0;
    if (pid) hoverTargetRef.current = pid;
  };

  // 通常：touchend → まずホバー記録、無ければ座標で確定
  const onTouchEnd = (ev: TouchEvent) => {
    if (!touchDrag) return;
    const pid = hoverTargetRef.current;
    if (pid) return dropTo(pid);

    const t = ev.changedTouches && ev.changedTouches[0];
    if (!t) return setTouchDrag(null);

    // ★ 追加：描画確定を2フレーム待ってから命中判定（即ドロップのズレ抑制）
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pickByPoint(t.clientX, t.clientY);
      });
    });
  };


  // 変換ケース：dragend → まずホバー記録、無ければ最後の座標
  const onDragEnd = (_ev: DragEvent) => {
    if (!touchDrag) return;
    const pid = hoverTargetRef.current;
    if (pid) return dropTo(pid);
    const p = lastTouchRef.current;
    if (p) pickByPoint(p.x, p.y); else setTouchDrag(null);
  };

  window.addEventListener('touchmove', onTouchMove, { passive: true,  capture: true });
  window.addEventListener('touchend',  onTouchEnd,  { passive: false, capture: true });
  window.addEventListener('dragend',   onDragEnd,   { passive: true,  capture: true });
  return () => {
    window.removeEventListener('touchmove', onTouchMove, true);
    window.removeEventListener('touchend',  onTouchEnd,  true);
    window.removeEventListener('dragend',   onDragEnd,   true);
  };
}, [touchDrag]);




useEffect(() => {
  const loadInitialData = async () => {
    const team = await localForage.getItem<{ players: Player[] }>("team");
    setTeamPlayers(team?.players || []);

    const savedBenchOut = await localForage.getItem<number[]>("startingBenchOutIds");
    if (savedBenchOut) setBenchOutIds(savedBenchOut);

    // ★ 追加：保存が無ければ初期状態は「全員ベンチ外」
    if (!savedBenchOut) {
      const ids = (team?.players || []).map(p => p.id);
      setBenchOutIds(ids);
      // 任意：初期状態を保存しておく（次回起動でも維持したい場合）
      await localForage.setItem("startingBenchOutIds", ids);
    }

    // ✅ まず保存済みの完全な守備配置/打順から復元
    const savedAssignments =
      await localForage.getItem<{ [pos: string]: number | null }>("startingassignments");
    const savedBattingOrder =
      await localForage.getItem<{ id: number; reason: "スタメン" }[]>("startingBattingOrder");

    if (savedAssignments) {
      // 欠けたキーに備えて全スロットを初期化してからマージ
      const base = Object.fromEntries(allSlots.map((p) => [p, null])) as {
        [pos: string]: number | null;
      };
      const merged = { ...base, ...savedAssignments };
      setAssignments(merged);

      if (savedBattingOrder && savedBattingOrder.length) {
        setBattingOrder(savedBattingOrder.slice(0, 9));
      }
      return; // ← フォールバック不要
    }

    // ↙ フォールバック：初回保存時の初期記録から復元
// ↙ フォールバック：スタメン画面“専用”の初期記録から復元
const initialOrder = await localForage.getItem<
  { id: number; order: number; position: string }[]
>("startingInitialSnapshot");

if (initialOrder && initialOrder.length > 0) {
  const newAssignments: { [pos: string]: number | null } =
    Object.fromEntries(allSlots.map((p) => [p, null]));
  const newBattingOrder: { id: number; reason: "スタメン" }[] = [];

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





const saveAssignments = async () => {
    // ✅ 先頭に “打順が9人いるか” をチェック
  const uniqueIds = Array.from(
    new Set(battingOrder.map((e) => e?.id).filter(Boolean))
  );
  if (uniqueIds.length < 9) {
    alert("スタメン9人を設定して下さい");
    return; // 保存しない
  }
  await localForage.setItem("startingBenchOutIds", benchOutIds);
  await localForage.setItem("startingassignments", assignments);
  await localForage.setItem("startingBattingOrder", battingOrder);

  // ✅ 初期記録は専用の参考情報としてのみ保持（必要なら）
  const initialOrder = battingOrder.map((entry, index) => {
    const position = Object.entries(assignments).find(([_, id]) => id === entry.id)?.[0] ?? "－";
    return { id: entry.id, order: index + 1, position };
  });
  await localForage.setItem("startingInitialSnapshot", initialOrder); // ← new（参照用）

  await localForage.setItem("lineupAssignments", assignments); // ← ミラー保存
  await localForage.setItem("battingOrder", battingOrder);     // ← ミラー保存

  // 保存＝確定。以後は未保存扱いにしない
  snapshotRef.current = buildSnapshot();
  setIsDirty(false);

  alert("スタメンを保存しました！");
};


const clearAssignments = async () => {
  // 全スロット空に
  const emptyAssignments = Object.fromEntries(allSlots.map((p) => [p, null]));
  setAssignments(emptyAssignments);
  setBattingOrder([]);

  // ★ ここがポイント：チーム全員をベンチ外に
  const team = await localForage.getItem<{ players: Player[] }>("team");
  const allIds = (team?.players || []).map(p => p.id);
  setBenchOutIds(allIds);

  // 保存状態もリセット＋ベンチ外だけは“全員”として保存
  await localForage.setItem("startingassignments", emptyAssignments);
  await localForage.setItem("startingBattingOrder", []);
  await localForage.setItem("startingBenchOutIds", allIds);

  // 参照用スナップショットやミラーも空に
  await localForage.setItem("startingInitialSnapshot", []);
  await localForage.setItem("lineupAssignments", emptyAssignments);
  await localForage.setItem("battingOrder", []);

  alert("スタメンをクリアし、全員を出場しない選手にしました！");
};


  const allowDrop = (e: React.DragEvent) => {
    e.preventDefault();
    try { e.dataTransfer!.dropEffect = "move"; } catch {}
  };

const handleDragStart = (
  e: React.DragEvent<HTMLDivElement>,
  playerId: number,
  fromPos?: string
) => {
  setDraggingPlayerId(playerId);

  e.dataTransfer.setData("playerId", String(playerId));
  e.dataTransfer.setData("text/plain", String(playerId)); // Android 補完
  if (fromPos) e.dataTransfer.setData("fromPosition", fromPos);
  e.dataTransfer.effectAllowed = "move";

  try {
if (isIOS && e.dataTransfer.setDragImage) {
  const p = teamPlayers.find(pp => pp.id === playerId);
  const label = p ? `${p.lastName}${p.firstName} #${p.number}` : (e.currentTarget as HTMLElement).innerText || `#${playerId}`;

  const ghost = document.createElement("div");
  ghost.textContent = label;
  Object.assign(ghost.style, {
    position: "fixed",
    top: "0", left: "0",
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
  // 指の中央やや上に来るようオフセット（好みに応じて 0.55〜0.7 で微調整可）
  e.dataTransfer.setDragImage(ghost, r.width * 0.5, r.height * 0.6);

  const cleanup = () => { try { document.body.removeChild(ghost); } catch {} 
                          setDraggingPlayerId(null); };
  window.addEventListener("dragend", cleanup, { once: true });
  window.addEventListener("drop", cleanup, { once: true });
  (e.currentTarget as HTMLElement).addEventListener("dragend", cleanup, { once: true });

  return; // ★ これを追加（通常の target を setDragImage しない）
}

    // それ以外は要素自身をゴーストに（中央基準）
    const target = e.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(target, rect.width / 2, rect.height / 2);
    }
  } catch {}

  // 終了時のクリーンアップ
  const el = e.currentTarget as HTMLElement;
  const onEnd = () => {
    try { el.removeEventListener("dragend", onEnd); } catch {}
    window.removeEventListener("dragend", onEnd);
    window.removeEventListener("drop", onEnd);
    setDraggingPlayerId(null);
  };
  el.addEventListener("dragend", onEnd, { once: true });
  window.addEventListener("dragend", onEnd, { once: true });
  window.addEventListener("drop", onEnd, { once: true });
};



const handleDropToPosition = (e: React.DragEvent<HTMLDivElement>, toPos: string) => {
  e.preventDefault();

  const playerIdStr =
    e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
  const playerId = Number(playerIdStr);

  // fromPosが取れない端末用フォールバック
  let fromPos = e.dataTransfer.getData("fromPosition");
  if (!fromPos) {
    fromPos = Object.entries(assignments).find(([, id]) => id === playerId)?.[0] ?? "";
  }

  const prevPlayerIdAtTo = assignments[toPos] ?? null;

  // 次状態を先に組み立てて、打順更新にも使う
  const next: { [pos: string]: number | null } = { ...assignments };

  // 交換（from→to）
  if (fromPos && fromPos !== toPos) {
    next[fromPos] = prevPlayerIdAtTo; // 交換なのでtoに居た人をfromへ
  }

  // toPosがDHなら、同一選手が他の守備に入っていたら外す（重複禁止）
  if (toPos === DH) {
    for (const p of positions) {
      if (next[p] === playerId) next[p] = null;
    }
  }

  // toPosが守備位置なら、もし同一選手がDHに入っていたらDHを外す（重複禁止）
  if (toPos !== DH && next[DH] === playerId) {
    next[DH] = null;
  }

  // 最終的にtoへ配置
  next[toPos] = playerId;

  setAssignments(next);


  // 打順の更新：仕様（理想）
  // ✅ DHなし：投手に置いたら投手も打順(1〜9)に入る
  // ✅ DHあり：DHを置いた瞬間に投手は打順から外れ、後ろが繰り上がる（＝投手を“削除”）
  setBattingOrder((prev) => {
    let updated = [...prev];

    const dhId = next[DH] ?? null;
    const pitcherId = next["投"] ?? null;

    // まず、今回動かした選手がリストに居なければ追加
    // ※DHへの移動はここでは追加しない（後段の整合処理で入れる）
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

    // ここから「DHの有無」で打順を整合させる
    const fieldIds = positions
      .map((pos) => next[pos])
      .filter((id): id is number => typeof id === "number");

    const fieldSet = new Set(fieldIds);

    if (!dhId) {
      // -------------------------
      // ✅ DHなし：打順＝フィールド9人（投手含む）
      // -------------------------

      // フィールド外の選手が打順に混ざっていたら除去（これで「9人埋まってて投手が入らない」を防ぐ）
      updated = updated.filter((e) => fieldSet.has(e.id));

      // フィールドにいるのに打順にいない選手（投手含む）を末尾に補完
      for (const id of fieldIds) {
        if (!updated.some((e) => e.id === id)) {
          updated.push({ id, reason: "スタメン" });
        }
      }
    } else {
      // -------------------------
      // ✅ DHあり：打順＝（投手を除くフィールド8人）＋DH
      //    → DHを置いた瞬間に投手は打順から外れる（繰り上げ）
      // -------------------------

      // ① まず投手が打順にいたら削除（＝後ろが繰り上がる）
      if (pitcherId) {
        updated = updated.filter((e) => e.id !== pitcherId);
      }

      // ② 打順に残してよい集合：フィールド（投手以外）＋DH
      const fieldNoPitcherSet = new Set(
        fieldIds.filter((id) => id !== pitcherId)
      );

      updated = updated.filter(
        (e) => fieldNoPitcherSet.has(e.id) || e.id === dhId
      );

      // ③ フィールド（投手以外）にいるのに打順にいない選手を補完（最大9まで）
      for (const id of fieldIds) {
        if (id === pitcherId) continue;
        if (updated.length >= 9) break;
        if (!updated.some((e) => e.id === id)) {
          updated.push({ id, reason: "スタメン" });
        }
      }

      // ④ DHを打順へ入れる（DHに置かれた時点で必ず入る）
      if (!updated.some((e) => e.id === dhId)) {
        if (updated.length < 9) {
          updated.push({ id: dhId, reason: "スタメン" });
        } else {
          // 念のため：9人埋まってたら最後をDHにする（基本ここには来ない想定）
          updated[updated.length - 1] = { id: dhId, reason: "スタメン" };
        }
      }
    }

    // 重複除去 & 9人制限（元の処理を維持）
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


   // ★ フィールドに入ったら「出場しない選手」から外す
  setBenchOutIds((prev) => prev.filter((id) => id !== playerId));
  // ★ ドロップ完了時はハイライトを確実に解除
  setDraggingPlayerId(null), setHoverPosKey(null);
};


  const getPositionOfPlayer = (playerId: number) => {
    return Object.entries(assignments).find(([_, id]) => id === playerId)?.[0];
  };

const handleBattingOrderDragStart = (
  e: React.DragEvent<HTMLDivElement>,
  playerId: number
) => {
  e.dataTransfer.setData("battingPlayerId", String(playerId));
  e.dataTransfer.setData("text/plain", String(playerId));

  // ★ 追加：今は“打順入替”モード
  setDragKind("order");

  // ★ 任意：終了時は解放
  const cleanup = () => setDragKind(null);
  window.addEventListener("dragend", cleanup, { once: true });
  window.addEventListener("drop", cleanup, { once: true });
};


const handleDropToBenchOut = (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();

  const playerIdStr =
    e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
  const playerId = Number(playerIdStr);
  if (!playerId) return;

  // ① ベンチ外リストに追加（重複防止）
  setBenchOutIds((prev) => (prev.includes(playerId) ? prev : [...prev, playerId]));

  // ② 守備配置から完全に外す（DH含む、同一選手がどこに居てもnullへ）
  //    ※後で投手IDを参照したいので、next をここで作って setAssignments する
  const oldDhId = assignments[DH] ?? null;

  const next = { ...assignments };
  for (const k of Object.keys(next)) {
    if (next[k] === playerId) next[k] = null;
  }
  setAssignments(next);

  // ③ 打順更新：
  //    - まずその選手を打順から外す
  //    - もし「外した選手がDHだった」なら、DHなしに戻るので投手を打順へ追加して9人に戻す
  setBattingOrder((prev) => {
    let updated = prev.filter((e) => e.id !== playerId);

    // ✅ DH→出場しない に戻した場合：投手を打順へ戻す
    if (oldDhId === playerId) {
      const pitcherId = next["投"] ?? null;
      // 投手が存在し、かつ打順にいなければ追加（末尾に追加＝簡単で事故が少ない）
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

const handleDropToBench = (e: React.DragEvent<HTMLDivElement>) => {
  e.preventDefault();

  const playerId = Number(
    e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain")
  );
  if (!playerId) return;

  // 端末によって fromPosition が来ないことがあるのでフォールバック
  const fromPosRaw = e.dataTransfer.getData("fromPosition") || "";
  const fromPos =
    fromPosRaw ||
    (Object.entries(assignments).find(([, id]) => id === playerId)?.[0] ?? "");

  // ① ベンチ外 → 控え（従来どおり）
  setBenchOutIds((prev) => prev.filter((id) => id !== playerId));

  // ② フィールド → 控え は「DH」だけ許可
  if (fromPos !== DH) return;

  // ③ DH を守備から外す
  const oldDhId = assignments[DH] ?? null;
  const next = { ...assignments, [DH]: null };
  setAssignments(next);

  // ④ 打順：DHを控えに戻したら、DHを打順から外して「投手を打順へ戻す」
  setBattingOrder((prev) => {
    let updated = [...prev];

    // 1) DHだった選手を打順から除去（8人になる原因はここまでしかやってないこと）
    if (oldDhId) {
      updated = updated.filter((e) => e.id !== oldDhId);
    }

    // 2) ✅ DHなしになるので、投手を打順に追加（すでにいれば追加しない）
    const pitcherId = next["投"] ?? null;
    if (pitcherId && !updated.some((e) => e.id === pitcherId)) {
      updated.push({ id: pitcherId, reason: "スタメン" }); // ← ここで 8→9 に戻る
    }

    // 3) 重複除去 & 9人制限（いつものやつ）
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


// 2選手の“現在の守備”を入替える（打順は触らない）
const swapPositionsByPlayers = (idA: number, idB: number) => {
  if (!idA || !idB || idA === idB) return;

  const posA = Object.entries(assignments).find(([, v]) => v === idA)?.[0] as string | undefined;
  const posB = Object.entries(assignments).find(([, v]) => v === idB)?.[0] as string | undefined;
  if (!posA || !posB) return;

  const next = { ...assignments };
  next[posA] = idB;
  next[posB] = idA;

  // DH 二重登録の解消
  const DH = "指";
  if (posA !== DH && next[DH] === idB) next[DH] = null;
  if (posB !== DH && next[DH] === idA) next[DH] = null;

  setAssignments(next);
};

// 守備ラベルからドラッグ開始（“守備だけ入替”モード）
const handlePosDragStart = (e: React.DragEvent<HTMLSpanElement>, playerId: number) => {
  e.stopPropagation();

  // ★ 交換元の記録（Android フォールバック）
  swapSourceIdRef.current = playerId;

  // ★ 一意トークンを発行（時間＋ID）
  const token = `${Date.now()}-${playerId}`;
  swapTokenRef.current = token;

  try {
    e.dataTransfer.setData("dragKind", "swapPos");
    e.dataTransfer.setData("swapSourceId", String(playerId));
    e.dataTransfer.setData("swapToken", token);              // ← 追加
    e.dataTransfer.setData("text/plain", String(playerId));
    e.dataTransfer.setData("text", `swapPos:${playerId}:${token}`); // ← 追加
  } catch {}

  setTouchDrag((prev) => prev ?? { playerId });
  setDragKind("swapPos");

  const cleanup = () => {
    setDragKind(null);
    // ★ cleanup時に token は消さない（ドロップ側の重複検知に使う）
    swapSourceIdRef.current = null;
  };
  window.addEventListener("dragend", cleanup, { once: true });
  window.addEventListener("drop", cleanup, { once: true });
};


// 守備ラベルへドロップ
// 守備ラベルへドロップ
const handleDropToPosSpan = (e: React.DragEvent<HTMLSpanElement>, targetPlayerIdProp: number) => {
  e.preventDefault();
  e.stopPropagation();

  // ★ まず coords からドロップ先を再判定（即ドロップのズレ対策）
  let targetPlayerId = targetPlayerIdProp;
  const cx = (e as any).clientX ?? (e as any).pageX ?? null;
  const cy = (e as any).clientY ?? (e as any).pageY ?? null;
  if (typeof cx === "number" && typeof cy === "number") {
    const el = document.elementFromPoint(cx, cy) as HTMLElement | null;
    const hit = el?.closest('[data-role="poslabel"], [data-role="posrow"]') as HTMLElement | null;
    const pid = hit ? Number(hit.getAttribute("data-player-id")) : 0;
    if (pid) targetPlayerId = pid;
  }

  const textAny = (e.dataTransfer.getData("text") || "").trim(); // 例: "swapPos:12:1695...-12"
  const inferredKind = textAny.startsWith("swapPos:") ? "swapPos" : "";
  const kind =
    e.dataTransfer.getData("dragKind") ||
    inferredKind ||
    (dragKind ?? "");

  if (kind !== "swapPos") return;

  // ★ トークン復元（dataTransfer → text → ref）
  let token = e.dataTransfer.getData("swapToken") || "";
  if (!token && textAny.startsWith("swapPos:")) {
    const parts = textAny.split(":"); // ["swapPos","12","1695...-12"]
    token = parts[2] || "";
  }
  if (!token) token = swapTokenRef.current || "";

  if (token) {
    if (handledSwapTokensRef.current.has(token)) return;
    handledSwapTokensRef.current.add(token);
  }

  // 交換元IDの復元
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




const handleDropToBattingOrder = (
  e: React.DragEvent<HTMLDivElement>,
  targetPlayerId: number
) => {
  e.preventDefault();

  // ★ kind を多段フォールバックで取得
  const textAny = (e.dataTransfer.getData("text") || "").trim();
  const inferredKind = textAny.startsWith("swapPos:") ? "swapPos" : "";
  const kind =
    e.dataTransfer.getData("dragKind") ||
    inferredKind ||
    (dragKind ?? "");

  if (kind === "swapPos") {
    // ★ 交換元IDの復元（dataTransfer → text → ref）
    let srcStr =
      e.dataTransfer.getData("swapSourceId") ||
      e.dataTransfer.getData("battingPlayerId") ||
      e.dataTransfer.getData("text/plain") ||
      "";
    if (!srcStr && textAny.startsWith("swapPos:")) {
      srcStr = textAny.split(":")[1] || "";
    }

    let srcId = Number(srcStr);
    if (!srcId) srcId = swapSourceIdRef.current ?? 0; // ← 追加

    if (srcId && srcId !== targetPlayerId) {
      swapPositionsByPlayers(srcId, targetPlayerId);
    }

    // ★ 後始末
    swapSourceIdRef.current = null;
    setDragKind(null);
    return;
  }

  // ↓↓ 打順入替（既存ロジック） ↓↓
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



  const assignedIds = Object.values(assignments).filter(Boolean) as number[];
  const availablePlayers = teamPlayers.filter((p) => !assignedIds.includes(p.id));
  const benchOutPlayers = teamPlayers.filter((p) => benchOutIds.includes(p.id));

return (
 <div
   className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6 select-none"
   style={{
     paddingTop: "max(16px, env(safe-area-inset-top))",
     paddingBottom: "max(16px, env(safe-area-inset-bottom))",
     WebkitTouchCallout: "none",  // ← 追加
     WebkitUserSelect: "none",    // ← 追加
     userSelect: "none",          // ← 追加
   }}
   onContextMenu={(e) => e.preventDefault()} // ← 追加
   onSelectStart={(e) => e.preventDefault()} // ← 追加
 >

 <div className="mt-3 text-center select-none mb-2">
   <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-wide leading-tight">
     <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden><path d="M3 5h18v2H3V5zm0 6h18v2H3v-2zm0 6h10v2H3v-2z"/></svg>
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
       {/* フィールドアイコン（見た目だけ） */}
       <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden><path d="M12 2L2 12l10 10 10-10L12 2zm0 4l6 6-6 6-6-6 6-6z"/></svg>
     </span>
     <h2 className="font-semibold text-white">フィールド配置</h2>
   </div>
   <div className="relative">
    <img
      src="/field.png"
      alt="フィールド図"
      draggable={false}   // ← 追加
      className="w-full h-auto md:rounded shadow select-none pointer-events-none" />

      {allSlots.map((pos) => {
        const playerId = assignments[pos];
        const player = teamPlayers.find((p) => p.id === playerId);
        return (
          <div
            key={pos}
            draggable={!!player}
            onDragStart={(e) => player && handleDragStart(e,       // ← これを追加
              player.id, pos)}
            onDragEnter={() => setHoverPosKey(pos)}
            onDragLeave={() => setHoverPosKey((v) => (v === pos ? null : v))}  
            onDragOver={allowDrop}
            onDrop={(e) => { handleDropToPosition(e, pos); setHoverPosKey(null); }}
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
                // iOSの長押し誤動作を抑えるなら WebkitUserDrag は "none" のままでもOK
                style={{ WebkitUserDrag: "none", touchAction: "none" }}

                className={
                  `relative w-full h-full flex items-center justify-center font-semibold
                  whitespace-nowrap overflow-hidden text-ellipsis text-sm sm:text-base
                  leading-none select-none rounded-lg
                  ${draggingPlayerId === player.id ? "bg-amber-500 text-white ring-4 ring-amber-300" : ""}`
                }
              >
                {player.lastName}{player.firstName} #{player.number}
              </div>


            ) : (
              <div className="text-gray-500">{pos === DH ? "DHなし" : "空き"}</div>
            )}
          </div>
        );
      })}

      </div>
      </section>

      {/* 打順と控えを横並びに表示 */}
      {/* 控え選手 + 打順を縦並びに表示し、スマホでも最適化 */}
      <div className="flex flex-col gap-6">

        {/* 🔼 控え選手（登録済みで未使用の選手） */}
        <div>
          <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
            <span className="inline-flex w-9 h-9 rounded-xl bg-white/15 border border-white/20 items-center justify-center">
              <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor"><path d="M4 15h16v2H4zm2-4h12v2H6zm2-4h8v2H8z"/></svg>
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

      {/* 🔽 ベンチ外選手（横並び表示） */}
      <div>
        <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
          <span className="inline-flex w-9 h-9 rounded-xl bg-rose-400/25 border border-rose-300/50 items-center justify-center"><IconOut /></span>
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
                {p.lastName}{p.firstName} #{p.number}
              </div>
            ))
          )}
        </div>
      </div>



      <div>
        <h2 className="text-xl font-semibold mb-2 flex items-center gap-2">
          <span className="inline-flex w-9 h-9 rounded-xl bg-white/15 border border-white/20 items-center justify-center"><IconOrder /></span>
          打順（1～9番）
          <span className="ml-2 text-[11px] px-2 py-0.5 rounded-full bg-white/10 border border-white/10">ドラッグ＆ドロップで変更</span>
        </h2>
        <div className="space-y-2">
          {battingOrder.map((entry, i) => {
            const player = teamPlayers.find((p) => p.id === entry.id);
            if (!player) return null;
            const pos = getPositionOfPlayer(entry.id);

            return (
              <div
                key={entry.id}
                data-role="posrow"
                data-player-id={entry.id}
                className={`rounded-xl bg-sky-400/15 border border-sky-300/40 p-2 shadow cursor-move select-none
                  ${hoverOrderPlayerId === entry.id && dragKind !== "swapPos" ? "ring-2 ring-emerald-400" : ""}`}
                draggable
                onDragStart={(e) => {
                  // 守備ラベル（poslabel）からのドラッグは “swapPos” 用 → 親のドラッグ開始は抑止
                  const t = e.target as HTMLElement;
                  if (t && t.closest('[data-role="poslabel"]')) return;
                  handleBattingOrderDragStart(e, entry.id);
                }}
                onDrop={(e) => { handleDropToBattingOrder(e, entry.id); setHoverOrderPlayerId(null); }}
                onDragOver={(e) => { allowDrop(e); setHoverOrderPlayerId(entry.id); }}
                onDragEnter={(e) => { allowDrop(e); setHoverOrderPlayerId(entry.id); }}
                onDragLeave={() => setHoverOrderPlayerId((v) => (v === entry.id ? null : v))}
              >

              <div className="flex items-center gap-2 flex-nowrap">
                <span className="w-10 font-bold">{i + 1}番</span>
                <span
                  data-role="poslabel"
                  data-player-id={entry.id}
                  className={`w-28 md:w-24 px-1 rounded cursor-move select-none text-center whitespace-nowrap shrink-0 touch-none
                    ${
                      hoverOrderPlayerId === entry.id && dragKind === "swapPos"
                        ? "ring-2 ring-emerald-400 bg-emerald-500/20" // ← ラベルだけ強調
                        : "bg-white/10 border border-white/10"
                    }`}

                  title={pos ? "この守備を他の行と入替" : "守備なし"}
                  draggable={!!pos}
                  onDragStart={(e) => handlePosDragStart(e, entry.id)}
                  onDragOver={(e) => { allowDrop(e); setHoverOrderPlayerId(entry.id); }}
                  onDrop={(e) => { handleDropToPosSpan(e, entry.id); setHoverOrderPlayerId(null); }}
                  onDragEnter={(e) => { allowDrop(e); setHoverOrderPlayerId(entry.id); }}
                  onDragLeave={() => setHoverOrderPlayerId((v) => (v === entry.id ? null : v))}
                  onTouchStart={(ev) => { ev.stopPropagation(); pos && setTouchDrag({ playerId: entry.id }); }}
                >

                {pos ? positionNames[pos] : "控え"}
                </span>

                  {/* 選手名 → 右にずらす */}
                <span className="ml-4 whitespace-nowrap">
                  {player.lastName}{player.firstName}
                </span>
                <span className="w-12">#{player.number}</span>
              </div>
              </div>
            );
          })}
        </div>
      </div>


      </div>



<div className="mt-6 flex w-full gap-4">
  <button
    className="flex-[3] bg-red-500 text-white py-3 rounded font-semibold"
    onClick={onClearClick}
  >
    クリア
  </button>
  <button
    className="flex-[7] bg-blue-600 text-white py-3 rounded font-semibold"
    onClick={saveAssignments}
  >
    保存する
  </button>
</div>

{/* ← 戻るボタン（横いっぱい、画面下部に追加） */}
<div className="mt-4 w-full">
  <button
    className="w-full bg-gray-700 text-white py-3 rounded font-semibold hover:bg-gray-600 active:bg-gray-800"
    onClick={() => { isDirty ? setShowLeaveConfirm(true) : handleBack(); }}
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
      {/* ヘッダー：緑帯 */}
      <div className="bg-green-600 text-white text-center font-bold py-3">
        確認
      </div>

      {/* 本文 */}
      <div className="px-6 py-5 text-center text-[15px] leading-relaxed">
        <p className="whitespace-pre-line font-bold text-gray-800">
          スタメン、ベンチ入りの選手がクリアされて{"\n"}
          全員が出場しない選手になります。{"\n"}
          よろしいですか？
        </p>
      </div>

      {/* フッター：ボタン */}
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

{/* 保存確認モーダル */}
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
      {/* ヘッダー：緑帯 */}
      <div className="bg-green-600 text-white text-center font-bold py-3">
        確認
      </div>

      {/* 本文（太字でくっきり） */}
      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          変更した内容を保存していませんが{"\n"}
          よろしいですか？
        </p>
      </div>

      {/* フッター：YES/NOを横いっぱい半分ずつ */}
      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
            onClick={() => setShowLeaveConfirm(false)} // NO＝そのまま残る
          >
            NO
          </button>
          <button
            className="w-full py-3 rounded-full bg-green-600 text-white font-semibold hover:bg-green-700 active:bg-green-800"
            onClick={() => {
              setShowLeaveConfirm(false);
              handleBack(); // YES＝保存せず戻る（App側戻るボタンをトリガ）
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
const StartingLineupWrapped = () => {
  return (
    <DndProvider
      backend={isTouchDevice() ? TouchBackend : HTML5Backend}
      options={
        isTouchDevice()
          ? {
              enableTouchEvents: true,
              enableMouseEvents: true,
              touchSlop: 10,      // ドラッグ開始の“遊び幅”（px）
              delayTouchStart: 10 // 長押し待ち時間（ms）←短く
            }
          : undefined
      }
    >
      <StartingLineup />
    </DndProvider>
  );
};


export default StartingLineupWrapped;