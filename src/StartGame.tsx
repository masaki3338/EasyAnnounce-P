import React, { useEffect, useState } from "react";
import localForage from "localforage";

type BattingEntry = {
  id: number;
  reason?: string;
};

type ExtraPositionMap = Record<number, string | null>;

const MIN_STARTERS = 9;
const MAX_BATTING_ORDER = 15;


// --- ミニSVGアイコン（依存なし） ---
const IconPlay = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M8 5v14l11-7z" />
  </svg>
);
const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);
const IconInfo = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M11 17h2v-6h-2v6zm0-8h2V7h-2v2zm1-7a10 10 0 100 20 10 10 0 000-20z"/>
  </svg>
);
const IconUsers = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M16 11a4 4 0 10-8 0 4 4 0 008 0zm-9 7a6 6 0 1112 0v2H7v-2z"/>
  </svg>
);
const IconVs = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M7 7h4l-4 10H3L7 7zm14 0l-5 10h-4l5-10h4z"/>
  </svg>
);
const IconUmpire = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 2a4 4 0 110 8 4 4 0 010-8zM5 20a7 7 0 0114 0v2H5v-2z"/>
  </svg>
);



const resetAnnouncedIds = () => {
  setAnnouncedIds([]);
  localForage.removeItem("announcedIds");
};

async function clearUndoRedoHistory() {
  const prefixReg = /^(defHistory::|defRedo::|history:|undo:|redo:)/;
  const suffixReg = /(history|undo|redo)$/;

  await localForage.iterate((value, key) => {
    if (prefixReg.test(String(key)) || suffixReg.test(String(key))) {
      localForage.removeItem(String(key));
    }
  });
}


const StartGame = ({
  onStart,
  onShowAnnouncement,
}: {
  onStart: (isFirstAttack: boolean) => void;
  onShowAnnouncement: () => void;
}) => {
  const [teamName, setTeamName] = useState("");
  const [opponentName, setOpponentName] = useState("");
  const [firstBaseSide, setFirstBaseSide] = useState<"1塁側" | "3塁側">("1塁側");
  const [isFirstAttack, setIsFirstAttack] = useState(true);
  const [umpires, setUmpires] = useState<{ [key: string]: string }>({});
  const [isTwoUmpires, setIsTwoUmpires] = useState<boolean>(false);
  const [players, setPlayers] = useState<{ id: number; number: string | number; name: string }[]>([]);
  const [assignments, setAssignments] = useState<{ [pos: string]: number | null }>({});
  const [battingOrder, setBattingOrder] = useState<BattingEntry[]>([]);
  const [extraPositionMap, setExtraPositionMap] = useState<ExtraPositionMap>({});

  const [benchOutIds, setBenchOutIds] = useState<number[]>([]); // 🆕

  // 「試合開始」押下時に出す案内モーダルの表示フラグ
  const [showStartHint, setShowStartHint] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showLineupErrorModal, setShowLineupErrorModal] = useState(false);


useEffect(() => {
  const loadData = async () => {
    const matchInfo = await localForage.getItem("matchInfo");

    // ▼▼▼ ここから置換：assign / order / benchOutIds を draft 優先で取得 ▼▼▼
    const assign =
      (await localForage.getItem<Record<string, number | null>>("startingassignments_draft")) ??
      (await localForage.getItem<Record<string, number | null>>("startingassignments")) ??
      (await localForage.getItem<Record<string, number | null>>("lineupAssignments"));

    const order =
      (await localForage.getItem<BattingEntry[]>("startingBattingOrder_draft")) ??
      (await localForage.getItem<BattingEntry[]>("startingBattingOrder")) ??
      (await localForage.getItem<BattingEntry[]>("battingOrder"));

    const extraPos =
      (await localForage.getItem<ExtraPositionMap>("startingExtraPositionMap_draft")) ??
      (await localForage.getItem<ExtraPositionMap>("startingExtraPositionMap")) ??
      {};

    const sb = await localForage.getItem<number[]>("startingBenchOutIds_draft");
    const fb = await localForage.getItem<number[]>("startingBenchOutIds"); // 従来保存
    const ob = await localForage.getItem<number[]>("benchOutIds");         // 旧フォールバック
    const raw = Array.isArray(sb) ? sb : Array.isArray(fb) ? fb : Array.isArray(ob) ? ob : [];
    const normalizedBenchOut = [...new Set(raw.map((v) => Number(v)).filter((v) => Number.isFinite(v)))];
    setBenchOutIds(normalizedBenchOut);
    // ▲▲▲ ここまで置換 ▲▲▲

    const team = await localForage.getItem("team");
    if (team && typeof team === "object") {
      setTeamName((team as any).name || "");
      const playersWithName = (team as any).players.map((p: any) => ({
        id: Number(p.id),
        number: p.number,
        name: `${p.lastName ?? ""}${p.firstName ?? ""}`,
      }));
      setPlayers(playersWithName);
    }

    if (matchInfo && typeof matchInfo === "object") {
      const mi = matchInfo as any;
      setOpponentName(mi.opponentTeam || "");
      setFirstBaseSide(mi.benchSide === "3塁側" ? "3塁側" : "1塁側");
      setIsFirstAttack(mi.isHome === false);
      setIsTwoUmpires(Boolean(mi.twoUmpires));
      if (Array.isArray(mi.umpires)) {
        const umpireMap: { [key: string]: string } = {};
        mi.umpires.forEach((u: { role: string; name: string }) => {
          umpireMap[u.role] = u.name || "";
        });
        setUmpires(umpireMap);
      }
    }

    if (assign && typeof assign === "object") {
      const normalizedAssign: { [pos: string]: number | null } = {};
      Object.entries(assign).forEach(([pos, id]) => {
        normalizedAssign[pos] = id !== null ? Number(id) : null;
      });
      setAssignments(normalizedAssign);
    }

    if (Array.isArray(order)) {
      setBattingOrder(order as BattingEntry[]);
    }

    if (extraPos && typeof extraPos === "object") {
      const normalizedExtraPos: ExtraPositionMap = {};
      Object.entries(extraPos).forEach(([id, pos]) => {
        const n = Number(id);
        if (Number.isFinite(n)) {
          normalizedExtraPos[n] = pos ?? null;
        }
      });
      setExtraPositionMap(normalizedExtraPos);
    }
  };

  loadData();
}, []);


  const getPlayer = (id: number | null) => {
    if (id === null || isNaN(id)) return undefined;
    return players.find((p) => Number(p.id) === id);
  };

  // スタメン人数を判定するヘルパー（開始条件は9人以上）
const getStartingMemberCount = () => {
  const idsFromOrder = Array.isArray(battingOrder)
    ? battingOrder
        .map((e: any) => Number(e?.id ?? e))
        .filter((id: number) => Number.isFinite(id))
    : [];

  const uniqOrder = [...new Set(idsFromOrder)];
  if (uniqOrder.length > 0) return uniqOrder.length;

  const pos9 = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右"];
  const hasDH = assignments && assignments["指"] != null;
  const orderPos = hasDH ? [...pos9.filter((p) => p !== "投"), "指"] : pos9;

  const idsFromAssign = orderPos
    .map((p) => assignments?.[p])
    .filter((v) => v != null)
    .map((v) => Number(v))
    .filter((id) => Number.isFinite(id));

  return [...new Set(idsFromAssign)].length;
};

// 1) ボタン押下時はモーダルを開くだけ
const handleStart = async () => {
  const count = getStartingMemberCount();
  if (count < MIN_STARTERS) {
    setShowLineupErrorModal(true);
    return;
  }

  // 問題なければ開始確認モーダルへ
  setShowStartHint(true);
};

// 2) モーダルの「OK」で本当に開始（元の handleStart の中身をこちらへ）
const proceedStart = async () => {
  const isHome = !isFirstAttack;

  // （↓↓ここからは、元の handleStart 内の“アラート以外の処理”をそのまま↓）
  // ★ 先攻×初回のみ：… というalertブロックは削除してOK（モーダルに置換したため）

  // 🧹 各種リセット
  await localForage.setItem("tiebreak:enabled", false); 
  await localForage.removeItem("announcedPlayerIds");
  await localForage.removeItem("runnerInfo");
  await localForage.removeItem("pitchCounts");
  await localForage.removeItem("pitcherTotals");
  await localForage.removeItem("pitcherOrder");
  await localForage.removeItem("scores");
  await localForage.removeItem("lastBatterIndex");
  await localForage.removeItem("nextBatterIndex");
  await localForage.removeItem("usedBatterIds");
  await localForage.removeItem("benchReactivatedIds");
  await localForage.removeItem("startTime");
  await localForage.removeItem("gameStartTime");

  // 打順チェックボックスをクリア
  await localForage.removeItem("checkedIds");
  // アナウンス済みチェックをクリア
  await localForage.removeItem("announcedIds");
  // 出場済み（リエントリー判定などに使う）をクリア
  await localForage.removeItem("usedPlayerInfo");
   // 🧹 守備交代の取消／やり直し履歴も完全クリア（前試合の残骸を消す）
  await clearUndoRedoHistory();

// === スタメンを「保存した状態」にする（StartingLineupの保存と同等） ===

// 1) 採用する元データ（draft > saved > state > old）
const draftA = await localForage.getItem<Record<string, number | null>>("startingassignments_draft");
const savedA = await localForage.getItem<Record<string, number | null>>("startingassignments");
const stateA = assignments; // ← StartGame画面に表示されているもの
const oldA   = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
const adoptA = draftA ?? savedA ?? stateA ?? oldA ?? {};
const normA: Record<string, number | null> = Object.fromEntries(
  Object.entries(adoptA).map(([k, v]) => [k, v == null ? null : Number(v)])
);
// ✅ 試合開始時：投手(投) と DH(指) が同一なら「大谷ルールあり」をONにする
{
  const p = normA["投"];
  const d = normA["指"];
  if (typeof p === "number" && typeof d === "number" && p === d) {
    await localForage.setItem("ohtaniRule", true);
    console.log("[OHTANI] auto ON at game start (P=DH)", { pitcherId: p });
  }
}

const draftO = await localForage.getItem<BattingEntry[]>("startingBattingOrder_draft");
const savedO = await localForage.getItem<BattingEntry[]>("startingBattingOrder");
const stateO = battingOrder; // ← StartGame画面に表示されている打順
const oldO   = await localForage.getItem<BattingEntry[]>("battingOrder");
let adoptO = draftO ?? savedO ?? stateO ?? oldO ?? [];

const draftExtraPos = await localForage.getItem<ExtraPositionMap>("startingExtraPositionMap_draft");
const savedExtraPos = await localForage.getItem<ExtraPositionMap>("startingExtraPositionMap");
const adoptExtraPos: ExtraPositionMap =
  (draftExtraPos && typeof draftExtraPos === "object")
    ? draftExtraPos
    : (savedExtraPos && typeof savedExtraPos === "object")
      ? savedExtraPos
      : extraPositionMap;

// 打順が空なら守備から暫定生成（DH考慮：投手を外してDHを入れる）
if (!Array.isArray(adoptO) || adoptO.length === 0) {
  const DH = "指";
  const positions = ["投","捕","一","二","三","遊","左","中","右"];
  const dhId = normA[DH] ?? null;
  const orderPositions = dhId ? [...positions.filter(p => p !== "投"), DH] : [...positions];
  const ids = orderPositions
    .map(p => normA[p])
    .filter((id): id is number => typeof id === "number");
  adoptO = ids.slice(0, MAX_BATTING_ORDER).map(id => ({ id, reason: "スタメン" }));
}

// ベンチ外
const draftB = await localForage.getItem<number[]>("startingBenchOutIds_draft");
const savedB = await localForage.getItem<number[]>("startingBenchOutIds");
const adoptB = Array.isArray(draftB) ? draftB : Array.isArray(savedB) ? savedB : Array.isArray(benchOutIds) ? benchOutIds : [];

// 2) 「スタメン保存」と同じキーに確定保存（StartingLineup.tsxのsaveAssignments相当）
await localForage.setItem("startingassignments",    normA);
await localForage.setItem("startingBattingOrder",   adoptO);
await localForage.setItem("startingExtraPositionMap", adoptExtraPos);
await localForage.setItem("startingBenchOutIds",    adoptB);

// 3) ミラー（他画面が確実に読む“公式キー”）
await localForage.setItem("lineupAssignments",      normA);
await localForage.setItem("battingOrder",           adoptO);
await localForage.setItem("startingExtraPositionMap", adoptExtraPos);
await localForage.setItem("benchOutIds",            adoptB);

// 4) 使い終わったドラフトは掃除（任意）
await localForage.removeItem("startingassignments_draft");
await localForage.removeItem("startingBattingOrder_draft");
await localForage.removeItem("startingExtraPositionMap_draft");
await localForage.removeItem("startingBenchOutIds_draft");
// === NEW: 同姓（苗字）重複チェック → LocalForage 保存 =================
{
  const team: any = await localForage.getItem("team");
  const allPlayers: any[] = Array.isArray(team?.players) ? team.players : [];

  const benchOut: number[] = (await localForage.getItem<number[]>("startingBenchOutIds")) ?? [];

  const benchInPlayers = allPlayers.filter(p => !benchOut.includes(Number(p?.id)));

  const counter = new Map<string, number>();
  for (const p of benchInPlayers) {
    const ln = String(p?.lastName ?? "").trim();
    if (!ln) continue;
    counter.set(ln, (counter.get(ln) ?? 0) + 1);
  }

  const duplicateLastNames = [...counter.entries()]
    .filter(([, count]) => count >= 2)
    .map(([ln]) => ln);

  await localForage.setItem("duplicateLastNames", duplicateLastNames);
}
// =======================================================================


  // ★ 相手チーム名など既存の情報は残しつつ、回・表裏・攻守だけ初期化
  const prev = (await localForage.getItem("matchInfo")) || {};
  const nextMatchInfo = {
    ...prev,
    inning: 1,
    isTop: true,        // 常に1回表
    isHome,             // 後攻なら true
    isDefense: isHome,  // 後攻=守備から / 先攻=攻撃から
  };
  await localForage.setItem("matchInfo", nextMatchInfo);


  // 🏁 画面遷移
  onStart(isFirstAttack);

  // 閉じる
  setShowStartHint(false);
};



  // 守備に就いている選手（投・捕・一…・指）
  const assignedIds = Object.values(assignments)
    .filter((v) => v !== null)
    .map((v) => Number(v));

  const dhId = (assignments as any)["指"] ?? null; // DHが使われているか
  const pitcherId = (assignments as any)["投"] ?? null;
  const pitcher = pitcherId ? players.find((p) => Number(p.id) === Number(pitcherId)) : undefined;

  // 表示用ポジション（大谷ルール対応）
  // - 打順表示は「指」を優先（投手とDHが同一IDでも「指」と表示）
  const getDisplayPos = (playerId: number | null | undefined) => {
    const n = Number(playerId);
    if (!Number.isFinite(n)) return "—";

    // まずフィールド配置(assignments)を見る
    const posFromAssignments = Object.keys(assignments || {}).find(
      (p) => Number((assignments as any)?.[p]) === n
    );
    if (posFromAssignments) return posFromAssignments;

    // 追加打順の守備位置（DH含む）を見る
    const posFromExtra = extraPositionMap[n];
    if (posFromExtra) return posFromExtra;

    return "—";
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
{/* ヘッダー：中央大タイトル＋細ライン */}
<header className="w-full max-w-md text-center select-none mt-1">
  <div className="inline-flex items-center gap-2">
    <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
      <span className="text-2xl md:text-3xl">🏁</span>
      <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-blue-400 drop-shadow">
        試合開始
      </span>
    </h1>

    <button
      type="button"
      onClick={() => setShowHelpModal(true)}
      className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-lg shadow active:scale-95"
      aria-label="試合開始画面の使い方"
    >
      ？
    </button>
  </div>

  <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
</header>

    {/* 本体：カード群 */}
    <main className="w-full max-w-md md:max-w-none mt-5 space-y-5">
      {/* 試合情報 */}
      <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IconInfo />
            <div className="font-semibold">試合情報</div>
          </div>
          <div className="text-sm md:text-base font-semibold text-white px-2 py-0.5 bg-blue-800/30 rounded">
            {isFirstAttack ? "先攻" : "後攻"} / ベンチ：{firstBaseSide}
          </div>

        </div>

        <div className="mt-3 grid grid-cols-1 gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10">
              <span className="font-medium truncate max-w-[12rem]">{teamName || "未設定"}</span>
            </span>
            <IconVs />
            <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10">
              <span className="font-medium truncate max-w-[12rem]">{opponentName || "未設定"}</span>
            </span>
          </div>
        </div>
      </section>

      {/* 審判（2審制なら右隣に表示＋球審・1塁審のみ） */}
      <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <IconUmpire />
          <div className="font-semibold">審判</div>
          {isTwoUmpires && (
            <span className="ml-3 text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/10">
              2審制
            </span>
          )}
        </div>
        {isTwoUmpires ? (
          <ul className="text-sm text-white/90 grid grid-cols-2 gap-x-4 gap-y-1">
            <li>球審：<span className="font-medium">{umpires["球審"] || "未設定"}</span></li>
            <li>1塁審：<span className="font-medium">{umpires["1塁審"] || "未設定"}</span></li>
          </ul>
        ) : (
          <ul className="text-sm text-white/90 grid grid-cols-2 gap-x-4 gap-y-1">
            <li>球審：<span className="font-medium">{umpires["球審"] || "未設定"}</span></li>
            <li>1塁審：<span className="font-medium">{umpires["1塁審"] || "未設定"}</span></li>
            <li>2塁審：<span className="font-medium">{umpires["2塁審"] || "未設定"}</span></li>
            <li>3塁審：<span className="font-medium">{umpires["3塁審"] || "未設定"}</span></li>
          </ul>
        )}
      </section>

      {/* スタメン */}
      <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <IconUsers />
          <div className="font-semibold">スターティングメンバー</div>
        </div>

        <div className="text-sm leading-tight space-y-1">
          {battingOrder.slice(0, MAX_BATTING_ORDER).map((entry, index) => {
            const pos = getDisplayPos(entry?.id);
            const player = getPlayer(entry.id);
            return (
              <div key={entry.id ?? index} className="flex items-center gap-2">
                <span className="inline-flex items-center justify-center w-9 h-6 rounded-full bg-white/10 border border-white/10">
                  {index + 1}番
                </span>
                <span className="w-10 text-white/90">{pos}</span>
                <span className="flex-1 font-medium truncate">{player?.name ?? "未設定"}</span>
                <span className="opacity-90">#{player?.number ?? "-"}</span>
              </div>
            );
          })}

          {/* DH時の投手名を追記（元コード踏襲） */}
          {dhId && pitcher && (
            <div className="flex items-center gap-2 mt-1">
              <span className="inline-flex items-center justify-center w-9 h-6 rounded-full bg-white/10 border border-white/10">
                投
              </span>
              <span className="flex-1 font-medium truncate">{pitcher.name}</span>
              <span className="opacity-90">#{(pitcher as any).number}</span>
            </div>
          )}
        </div>
      </section>

      {/* 控え選手 */}
      <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
        <div className="flex items-center gap-2 mb-2">
          <IconUsers />
          <div className="font-semibold">控え選手</div>
        </div>
        <div className="text-sm leading-tight grid grid-cols-1 gap-1">
          {players
            .filter(
              (p) =>
                !battingOrder.some((e) => e.id === p.id) &&
                !Object.values(assignments).filter((v) => v !== null).map(Number).includes(p.id) &&
                !benchOutIds.includes(p.id)
            )
            .map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="flex-1 truncate">{p.name}</span>
                <span className="opacity-90">#{p.number}</span>
              </div>
            ))}
          {/* 0人のとき */}
          {players.filter(
            (p) =>
              !battingOrder.some((e) => e.id === p.id) &&
              !Object.values(assignments).filter((v) => v !== null).map(Number).includes(p.id) &&
              !benchOutIds.includes(p.id)
          ).length === 0 && (
            <div className="text-white/70">（該当なし）</div>
          )}
        </div>
      </section>

    </main>

    {/* ← フッターと重ならないためのスペーサー */}
    <div aria-hidden className="h-36" />

    {/* 固定フッター操作カード */}
    <footer
      className="fixed bottom-0 inset-x-0 z-40 px-4"
      style={{ paddingBottom: "max(env(safe-area-inset-bottom), 12px)" }}
    >
      <div className="w-full max-w-md md:max-w-none mx-auto rounded-2xl bg-white/10 border border-white/10 shadow-xl p-4 grid gap-3">
        <button
          onClick={onShowAnnouncement}
          className="w-full px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-base font-semibold shadow inline-flex items-center justify-center gap-2"
        >
          <IconMic /> 試合前アナウンス
        </button>
        <button
          onClick={handleStart}
          className="w-full px-6 py-3 rounded-xl bg-green-600 hover:bg-green-700 active:scale-95 text-white text-base font-semibold shadow inline-flex items-center justify-center gap-2"
        >
          <IconPlay /> 試合を開始する
        </button>
      </div>
    </footer>

    {/* ====== 開始時の案内モーダル ====== */}
    {showStartHint && (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        {/* 背景の薄暗幕 */}
        <div
          className="absolute inset-0 bg-black/60"
          onClick={() => setShowStartHint(false)}
        />
        {/* 本体カード */}
        <div className="relative mx-6 w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden">
          {/* タイトル帯 */}
          <div className="bg-green-600 text-white text-lg font-bold text-center py-3">
            試合開始時刻の取得
          </div>
          <div className="p-5 text-center space-y-4">
            <p className="text-sm leading-relaxed">
              球審の”プレイ”で<br />
              <img
                src="/GameStartBTN.png"
                alt="試合開始ボタン"
                className="inline-block h-6 md:h-8 align-middle"
              />
                 ボタンを押してください
            </p>

            <button
              onClick={proceedStart}
              className="w-full py-3 rounded-xl bg-green-600 text-white font-semibold active:scale-95"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    )}

{/* ====== 使い方モーダル ====== */}
{showHelpModal && (
  <div
    className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-3 py-3"
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
            試合開始画面の使い方
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
              この画面では、試合作成で入力した内容を確認して試合開始へ進みます。
            </p>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                使い方はこの順番です
              </div>
              <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                ①内容を確認 → ②【試合前アナウンス】→ ③【試合を開始する】
              </div>
            </div>
          </div>

          {/* 1 */}
          <div className="rounded-[16px] border border-emerald-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-bold text-white shadow-sm">
                1
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-emerald-700">
                  試合情報を確認
                </h3>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                  試合作成で入力した内容が表示されます。
                </p>
                <p className="mt-1 text-[13px] leading-5 text-slate-700">
                  大会名、相手チーム名、先攻／後攻などに間違いがないか確認してください。
                </p>
              </div>
            </div>
          </div>

          {/* 2 */}
          <div className="rounded-[16px] border border-sky-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white shadow-sm">
                2
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-sky-700">
                  試合前アナウンスへ進む
                </h3>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                  内容に問題がなければ、
                  <span className="font-bold text-sky-700">
                    【試合前アナウンス】
                  </span>
                  ボタンを押します。
                </p>
                <p className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                  → 試合前アナウンス画面へ進みます
                </p>
              </div>
            </div>
          </div>

          {/* 3 */}
          <div className="rounded-[16px] border border-violet-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500 text-[12px] font-bold text-white shadow-sm">
                3
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-violet-700">
                  試合を開始する
                </h3>
                <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                  試合前アナウンスが終わったら、
                  <span className="font-bold text-emerald-700">
                    【試合を開始する】
                  </span>
                  ボタンを押します。
                </p>
                <p className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                  → 試合が開始されます
                </p>
              </div>
            </div>
          </div>

          {/* 補足 */}
          <div className="rounded-[16px] border border-amber-200 bg-amber-50 px-3 py-3">
            <p className="text-[12.5px] font-semibold leading-5 text-amber-800">
              まずは内容を確認し、その後
              <span className="font-bold">【試合前アナウンス】</span>
              を行ってから
              <span className="font-bold">【試合を開始する】</span>
              を押してください。
            </p>
          </div>
        </div>
      </div>

      {/* フッター */}
      <div className="bg-white px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => setShowHelpModal(false)}
          className="w-full rounded-2xl bg-emerald-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* ====== エラーモーダル ====== */}
{showLineupErrorModal && (
  <div
    className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-4"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowLineupErrorModal(false)}
  >
    <div
      className="w-full max-w-[420px] overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-rose-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-[18px] leading-none">⚠️</span>
          <h2 className="text-[18px] font-extrabold leading-tight tracking-[0.01em]">
            スタメン未設定
          </h2>
        </div>
      </div>

      <div className="bg-white px-4 py-5">
        <p className="text-[15px] font-bold leading-6 text-slate-800">
          スターティングメンバーを9人設定してください
        </p>
      </div>

      <div className="bg-white px-4 pb-4 pt-1">
        <button
          type="button"
          onClick={() => setShowLineupErrorModal(false)}
          className="w-full rounded-2xl bg-rose-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-rose-700 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

  </div>
);


};

export default StartGame;
