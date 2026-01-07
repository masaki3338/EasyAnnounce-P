import React, { useEffect, useState } from "react";
import localForage from "localforage";


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
  const [battingOrder, setBattingOrder] = useState<
    { id: number; reason: string }[]
  >([]);

  const [benchOutIds, setBenchOutIds] = useState<number[]>([]); // 🆕

  // 「試合開始」押下時に出す案内モーダルの表示フラグ
  const [showStartHint, setShowStartHint] = useState(false);



useEffect(() => {
  const loadData = async () => {
    const matchInfo = await localForage.getItem("matchInfo");

    // ▼▼▼ ここから置換：assign / order / benchOutIds を draft 優先で取得 ▼▼▼
    const assign =
      (await localForage.getItem<Record<string, number | null>>("startingassignments_draft")) ??
      (await localForage.getItem<Record<string, number | null>>("startingassignments")) ??
      (await localForage.getItem<Record<string, number | null>>("lineupAssignments"));

    const order =
      (await localForage.getItem<Array<{ id: number; reason?: string }>>("startingBattingOrder_draft")) ??
      (await localForage.getItem<Array<{ id: number; reason?: string }>>("startingBattingOrder")) ??
      (await localForage.getItem<Array<{ id: number; reason?: string }>>("battingOrder"));

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
      setBattingOrder(order as { id: number; reason: string }[]);
    }
  };

  loadData();
}, []);


  const getPlayer = (id: number | null) => {
    if (id === null || isNaN(id)) return undefined;
    return players.find((p) => Number(p.id) === id);
  };

  // スタメンが9人そろっているかを判定するヘルパー
const getStartingNineCount = () => {
  // まず打順リストを優先（存在すればそれで判定）
  const idsFromOrder =
    Array.isArray(battingOrder)
      ? battingOrder
          .map((e: any) => Number(e?.id ?? e)) // e.id でも e が数値でも対応
          .filter((id: number) => Number.isFinite(id))
      : [];

  if (idsFromOrder.length >= 9) return 9;

  // 打順が未設定/不足時は守備配置から補完（DH考慮）
  const pos9 = ["投","捕","一","二","三","遊","左","中","右"];
  const hasDH = assignments && assignments["指"] != null;
  const orderPos = hasDH ? [...pos9.filter(p => p !== "投"), "指"] : pos9;

  const idsFromAssign =
    orderPos
      .map((p) => assignments?.[p])
      .filter((v) => v != null)
      .map((v) => Number(v))
      .filter((id) => Number.isFinite(id));

  // 重複除去してカウント
  const uniq = [...new Set(idsFromAssign)].slice(0, 9);
  return uniq.length;
};

// 1) ボタン押下時はモーダルを開くだけ
const handleStart = async () => {
   const count = getStartingNineCount();
   if (count < 9) {
     alert("スターティングメンバーを9人設定してください");
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

const draftO = await localForage.getItem<Array<{ id: number; reason?: string }>>("startingBattingOrder_draft");
const savedO = await localForage.getItem<Array<{ id: number; reason?: string }>>("startingBattingOrder");
const stateO = battingOrder; // ← StartGame画面に表示されている打順
const oldO   = await localForage.getItem<Array<{ id: number; reason?: string }>>("battingOrder");
let adoptO = draftO ?? savedO ?? stateO ?? oldO ?? [];

// 打順が空なら守備から暫定生成（DH考慮：投手を外してDHを入れる）
if (!Array.isArray(adoptO) || adoptO.length === 0) {
  const DH = "指";
  const positions = ["投","捕","一","二","三","遊","左","中","右"];
  const dhId = normA[DH] ?? null;
  const orderPositions = dhId ? [...positions.filter(p => p !== "投"), DH] : [...positions];
  const ids = orderPositions
    .map(p => normA[p])
    .filter((id): id is number => typeof id === "number");
  adoptO = ids.slice(0, 9).map(id => ({ id, reason: "スタメン" }));
}

// ベンチ外
const draftB = await localForage.getItem<number[]>("startingBenchOutIds_draft");
const savedB = await localForage.getItem<number[]>("startingBenchOutIds");
const adoptB = Array.isArray(draftB) ? draftB : Array.isArray(savedB) ? savedB : Array.isArray(benchOutIds) ? benchOutIds : [];

// 2) 「スタメン保存」と同じキーに確定保存（StartingLineup.tsxのsaveAssignments相当）
await localForage.setItem("startingassignments",    normA);
await localForage.setItem("startingBattingOrder",   adoptO);
await localForage.setItem("startingBenchOutIds",    adoptB);

// 3) ミラー（他画面が確実に読む“公式キー”）
await localForage.setItem("lineupAssignments",      normA);
await localForage.setItem("battingOrder",           adoptO);
await localForage.setItem("benchOutIds",            adoptB);

// 4) 使い終わったドラフトは掃除（任意）
await localForage.removeItem("startingassignments_draft");
await localForage.removeItem("startingBattingOrder_draft");
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


return (
  <div
    className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
    style={{
      paddingTop: "max(16px, env(safe-area-inset-top))",
      paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      WebkitTouchCallout: "none", // iOS Safariの長押しメニュー禁止
      WebkitUserSelect: "none",   // iOS/Android テキスト選択禁止
      userSelect: "none",         // 全体で禁止
    }}
  >
    {/* ヘッダー：中央大タイトル＋細ライン */}
    <header className="w-full max-w-md text-center select-none mt-1">
      <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
        <span className="text-2xl md:text-3xl">🏁</span>
        <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-blue-100 to-blue-400 drop-shadow">
          試合開始
        </span>
      </h1>
      <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
    </header>

    {/* 本体：カード群 */}
    <main className="w-full max-w-md mt-5 space-y-5">
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
          {battingOrder.slice(0, 9).map((entry, index) => {
            const pos = Object.keys(assignments).find((p) => assignments[p] === entry.id) ?? "—";
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
    <footer className="fixed bottom-0 inset-x-0 z-40 px-4 pb-4">
      <div className="max-w-md mx-auto rounded-2xl bg-white/10 border border-white/10 shadow-xl p-4 grid gap-3">
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


  </div>
);


};

export default StartGame;
