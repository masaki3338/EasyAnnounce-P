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
      // フィールド図（assignments参照）のDHも代打IDにする
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
        if (dhPlayer) setBattingReplacements((prev) => ({ ...prev, [dhSlotIndex]: dhPlayer }));
      }
    }
  }
}

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
  const s = new Set(
    Object.values(assignments).filter((v): v is number => typeof v === "number")
  );

  // ✅ DH(指) は守備配置(assignments)に残らない/古い場合があるので
  // フィールド図と同じく「打順のDHスロット」を onField 扱いに加える
  const orderSrc = (battingOrderDraft?.length ? battingOrderDraft : battingOrder) || [];

  const dhStarterId = initialAssignments?.["指"];
  const dhSlotIndex =
    typeof dhStarterId === "number"
      ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
      : -1;

  // ★追加：いまDHが有効なときだけ、DHスロットを onField 扱いに加える
  // → DH解除（assignments["指"] が null）ならフィールド図のDHを消したいので add しない
  const dhActiveNow = typeof assignments?.["指"] === "number";

  if (ohtaniRule && dhActiveNow && dhSlotIndex >= 0) {
    const dhId =
      battingReplacements?.[dhSlotIndex]?.id ??
      orderSrc?.[dhSlotIndex]?.id ??
      null;

    if (typeof dhId === "number") s.add(dhId);
  }


    // ★追加：フィールド図では「元ID」ではなく subId（代打/代走の実体）を表示することがある。
  // 出場済み/控えのリストと整合させるため、onFieldIds に「表示側の subId」も加える。
  // 例）二(蔵北=orig) に代打(浦野=sub) → フィールド表示は浦野だが assignments は蔵北のまま、だと浦野が「出場済み」に残ってしまう。
  const u = usedPlayerInfo as Record<number, { reason?: string; subId?: number }>;

  Object.values(assignments || {}).forEach((orig) => {
    if (typeof orig !== "number") return;

    const info = u?.[orig];
    const r = info?.reason;
    if (r === "代打" || r === "代走" || r === "臨時代走") {
      const latest = resolveLatestSubId(orig, u as any);
      if (typeof latest === "number") s.add(latest);
      else if (typeof info?.subId === "number") s.add(info.subId);
    }
  });

return s;
}, [assignments, battingOrder, battingOrderDraft, initialAssignments, ohtaniRule, usedPlayerInfo]);

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

// ===== 守備位置に表示・操作する「現在の選手ID」を取得 =====
const getDisplayedPlayerIdForPos = (pos: string): number | null => {
  // DH
  if (pos === "指") {
    return typeof dhDisplayId === "number" ? dhDisplayId : null;
  }

  // まだ手動で触ってないポジションは代走などを反映
  if (!touchedFieldPos.has(pos)) {
    for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
      if (!info) continue;

      const sym = (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
      if (sym !== pos) continue;

      // 代走・代打
      if (
        ["代走", "臨時代走", "代打"].includes(String((info as any).reason ?? "")) &&
        typeof (info as any).subId === "number"
      ) {
        return Number((info as any).subId);
      }

      // 再出場など含めた最終選手
      const origId = Number(origIdStr);
      const latest = resolveLatestSubId(origId, usedPlayerInfo as any);
      if (typeof latest === "number") return latest;
    }
  }

  // 通常
  return typeof assignments?.[pos] === "number"
    ? Number(assignments[pos])
    : null;
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
    const newAssignments = { ...prev };

    const dhActive = typeof prev["指"] === "number" && prev["指"] != null;
    const skipBattingSync = dhActive && toPos === "投";

    // 打順側（battingReplacements）同期
    if (!skipBattingSync) {
      // ✅ 守備位置に「見えている選手ID」を優先して打順スロットを特定する
      // 代走直後は assignments[toPos] ではなく usedPlayerInfo の subId（=代走選手）が
      // 実際の表示対象になっていることがあるため、その補正を入れる
      const displayedIdAtPos = (() => {
        const pinchRunnerInfo = Object.values(usedPlayerInfo || {}).find(
          (x: any) => {
            if (!x) return false;
            if (!["代走", "臨時代走"].includes(String(x.reason ?? ""))) return false;
            const sym = (posNameToSymbol as any)[x.fromPos] ?? x.fromPos;
            return sym === toPos && typeof x.subId === "number";
          }
        );

        if (pinchRunnerInfo && typeof (pinchRunnerInfo as any).subId === "number") {
          return Number((pinchRunnerInfo as any).subId);
        }

        if (typeof replacedId === "number") return replacedId;
        if (typeof assignments?.[toPos] === "number") return Number(assignments[toPos]);

        return null;
      })();

      if (typeof displayedIdAtPos === "number") {
        let orderIdx = battingOrder.findIndex((entry, idx) => {
          const displayId = battingReplacements[idx]?.id ?? entry.id;
          return Number(displayId) === Number(displayedIdAtPos);
        });

        // ✅ 念のため、表示IDで見つからない場合は
        // 「その守備位置の元スタメンの打順」を使って差し替える
        if (orderIdx < 0) {
          const starterIdAtPos = initialAssignments?.[toPos];
          if (typeof starterIdAtPos === "number") {
            orderIdx = startingOrderRef.current.findIndex(
              (e) => Number(e?.id) === Number(starterIdAtPos)
            );
          }
        }

        if (orderIdx >= 0) {
          setBattingReplacements((prevRep) => ({ ...prevRep, [orderIdx]: incoming }));
        }
      }
    }

    // 守備配置更新
    newAssignments[toPos] = playerId;

    // ログ
    if (typeof replacedId === "number") {
      updateLog(toPos, replacedId, toPos, playerId);
    } else {
      updateLog(toPos, null, toPos, playerId);
    }

    return newAssignments;
  });
  // ✅ この守備位置はユーザーが手で配置したので、代打優先表示を無効化する
  setTouchedFieldPos(prev => {
    const next = new Set(prev);
    next.add(toPos);
    return next;
  });

  // ベンチ整合（入った選手はベンチから消す・押し出された選手をベンチへ戻す等が必要ならここに追記）
  setBenchPlayers((prev) => {
    let next = prev.filter((p) => p.id !== playerId);
    if (typeof replacedId === "number" && replacedId !== playerId) {
      const rep = teamPlayers.find((p) => p.id === replacedId);
      if (rep && !next.some((p) => p.id === rep.id)) next = [...next, rep];
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
// ★ ベンチ→守備のときだけ、かつ「出場済みの元スタメン」を落としたときだけ実行
if (!fromIsField && toPos !== BENCH) {
  resetBlue?.();
  if (forceNormalSubOnce) {
    setForceNormalSubOnce(false);
  } else {
    // toId = ベンチから来た選手（あなたの現状ロジック）
    const origIdForTo = resolveOriginalStarterId(toId, usedPlayerInfo, initialAssignments);
    const wasStarter = origIdForTo !== null;

    // ✅ 出場済み判定（元スタメンはorigId、途中出場はtoId自身）
    const isUsedAlready =
      (wasStarter && !!(usedPlayerInfo as any)?.[Number(origIdForTo)]) ||
      (!!(usedPlayerInfo as any)?.[Number(toId)]);

    // ✅ 未出場（控え）ならリエントリー判定せず通常交代（モーダル無し）
    if (!isUsedAlready) {
      resetBlue?.();
    } else {
        const isOffField = !Object.values(assignments || {}).includes(Number(toId));
        // ★「自分の代替末端」を置き換えているか（ここが成立条件）
        const latestSubOfOrig =
          wasStarter ? resolveLatestSubId(Number(origIdForTo), (usedPlayerInfo as any) || {}) : null;
        const isReentryNow =
          wasStarter &&
          isOffField &&
          typeof latestSubOfOrig === "number" &&
          typeof fromId === "number" &&
          Number(fromId) === Number(latestSubOfOrig);

      if (isReentryNow) {
        // ✅ リエントリー対象（成立）→ モーダルは出さない
        setReentryPreviewIds(new Set([Number(toId)]));
      } else {
        // ✅ リエントリー対象外（不成立）→ ここでだけモーダル
        resetBlue?.();

        setPendingNonReentryDrop({
          toPos,
          playerId: Number(toId),
          replacedId: Number(fromId),
        });
        setShowNonReentryConfirm(true);

        setHoverPos(null);
        setDraggingFrom(null);
        return;
      }
    }
  }    
} else {
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
      if (fromPos === BENCH && toPos !== BENCH) {
        console.log("✅ BENCH DROP branch", { fromPos, toPos });

        const playerIdStr =
          e.dataTransfer.getData("playerId") || e.dataTransfer.getData("text/plain");
        if (!playerIdStr) return prev;

        const playerId = Number(playerIdStr);
        const replacedId = (typeof prev[toPos] === "number" ? (prev[toPos] as number) : null);

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

  // ✅ 大谷開始（投＝指）で「控え→投」は、DHスロットまで巻き込むので打順ドラフトの置換をしない
  const shouldSkipDraftSwap = isOhtaniStart && fromIsBench && toPos === "投";

  if (!shouldSkipDraftSwap && isNumber(toId) && isNumber(fromId)) {
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
  console.log("[DEBUG] confirm clicked", { assignments, battingReplacements });
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

// ✅ 確定時は「画面に表示されている守備選手」をそのまま保存する
for (const pos of positions) {
  if (pos === "指") continue;

  const displayedId = (() => {
    const assignedId =
      typeof assignments?.[pos] === "number" ? Number(assignments[pos]) : null;

    // 代走優先表示
    const pinchRunnerForPos = (() => {
      for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
        if (!info) continue;
        if (!["代走", "臨時代走"].includes(String((info as any).reason ?? ""))) continue;

        const sym = (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
        if (sym !== pos) continue;
        if (typeof (info as any).subId !== "number") continue;

        const origId = Number(origIdStr);

        if (
          assignedId === origId ||
          assignedId === Number((info as any).subId)
        ) {
          return Number((info as any).subId);
        }
      }
      return null;
    })();

    // 代打優先表示
    const pinchLatestForPos = (() => {
      for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
        if (!info) continue;
        if (!["代打"].includes(String((info as any).reason ?? ""))) continue;

        const sym = (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
        if (sym !== pos) continue;

        const origId = Number(origIdStr);
        const latest = resolveLatestSubId(origId, usedInfo as any);
        if (typeof latest === "number") return latest;

        if (typeof (info as any).subId === "number") {
          return Number((info as any).subId);
        }

        return null;
      }
      return null;
    })();

    // リエントリー済みなら元選手を優先
    for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
      if (!info) continue;

      const origId = Number(origIdStr);
      const sym = (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
      if (sym !== pos) continue;

      const hasReentered = !!(info as any).hasReentered;
      const subId =
        typeof (info as any).subId === "number" ? Number((info as any).subId) : null;

      if (hasReentered && subId != null && assignedId === subId) {
        return origId;
      }
    }

    if (typeof pinchRunnerForPos === "number") return pinchRunnerForPos;
    if (typeof pinchLatestForPos === "number") return pinchLatestForPos;
    return assignedId;
  })();

  if (typeof displayedId === "number") {
    finalAssignments[pos] = displayedId;
  }
}
console.log("[CONFIRM SYNC] finalAssignments after display sync", finalAssignments);

// ✅ 確定前に、守備画面で表示されている実際の選手IDを finalAssignments に同期する
for (const pos of positions) {
  // DH は今まで通り
  if (pos === "指") continue;

  const assignedId =
    typeof finalAssignments[pos] === "number" ? Number(finalAssignments[pos]) : null;

  let displayedId: number | null = assignedId;

  // 代打/代走/臨時代走の連鎖を見て、実際の表示選手を優先
  for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
    if (!info) continue;

    const sym =
      (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;
    if (sym !== pos) continue;

    const reason = String((info as any).reason ?? "");
    if (!["代打", "代走", "臨時代走"].includes(reason)) continue;

    const origId = Number(origIdStr);
    const subId =
      typeof (info as any).subId === "number"
        ? Number((info as any).subId)
        : null;

    const latest = resolveLatestSubId(origId, usedInfo as any);

    // assignments が元選手 or subId の系統なら、最新表示選手を採用
    if (
      assignedId === origId ||
      (subId != null && assignedId === subId)
    ) {
      if (typeof latest === "number") {
        displayedId = latest;
      } else if (subId != null) {
        displayedId = subId;
      }
    }
  }

  if (displayedId != null) {
    finalAssignments[pos] = displayedId;
  }
}

// ✅ 実際に交代した打順枠だけ反映
Object.entries(battingReplacements || {}).forEach(([idxStr, repl]: any) => {
  const idx = Number(idxStr);
  if (!repl || typeof repl.id !== "number") return;
  if (!finalBattingOrder[idx]) return;

  finalBattingOrder[idx] = {
    ...finalBattingOrder[idx],
    id: repl.id,
  };
});

// ✅ リエントリーで元選手が復帰しているなら、守備配置も元選手へ戻す
// ✅ リエントリーで元選手が復帰しているなら、守備配置も元選手へ戻す
for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
  if (!info) continue;

  const origId = Number(origIdStr);
  const reason = String((info as any).reason ?? "");
  const fromPosRaw = String((info as any).fromPos ?? "");
  const isPinchSource =
    ["代打", "代走", "臨時代走"].includes(reason) ||
    ["代打", "代走", "臨時代走"].includes(fromPosRaw);

  if (!isPinchSource) continue;

  const subId =
    typeof (info as any).subId === "number"
      ? Number((info as any).subId)
      : null;
  if (subId == null) continue;

  const pos =
    (posNameToSymbol as any)[fromPosRaw] ?? fromPosRaw;
  if (!positions.includes(pos)) continue;

  const assignedId =
    typeof finalAssignments[pos] === "number"
      ? Number(finalAssignments[pos])
      : null;

  const origVisible =
    finalBattingOrder.some((e) => Number(e?.id) === origId) ||
    (battingOrderDraft || []).some((e) => Number(e?.id) === origId) ||
    Object.values(battingReplacements || {}).some(
      (p: any) => Number(p?.id) === origId
    );

  if (assignedId === subId && origVisible) {
    console.log("[REENTRY FIX] finalAssignments revert", {
      pos,
      from: subId,
      to: origId,
    });

    finalAssignments[pos] = origId;

    (usedInfo as any)[origIdStr] = {
      ...(info as any),
      hasReentered: true,
    };
    delete (usedInfo as any)[origIdStr].reason;
    delete (usedInfo as any)[origIdStr].fromPos;
    delete (usedInfo as any)[origIdStr].subId;
  }
}

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

// ✅ 変更1：確定時に「DH枠の実体」を finalAssignments["指"] に同期する
// （大谷ルールでDHに代打しただけだと、フィールド(assignments)側に反映されず
//  「代打/代走の選手の守備位置を設定して下さい」判定に引っかかるのを防ぐ）
if (ohtaniRule && finalDhEnabledAtStart && !pendingDisableDH) {
  const dhStarterId =
    typeof initialAssignments?.["指"] === "number" ? Number(initialAssignments["指"]) : null;

  if (dhStarterId != null) {
    const dhNowId = resolveLatestSubId(dhStarterId, usedInfo) ?? dhStarterId;
    finalAssignments["指"] = dhNowId; // ★ここが本体
  }
}
  // 守備交代で usedInfo を更新（order/wasStarter を必ず書く）
  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];  // 元の選手（先発想定）
    const currentId = finalAssignments[pos];    // 現在の選手
    const playerChanged = initialId && currentId && initialId !== currentId;

    if (playerChanged) {
      const idxNow = battingOrder.findIndex((e) => e.id === initialId);
      const idxStart = startingOrder.findIndex((e) => e.id === initialId);
      const order: number | null =
        idxNow !== -1 ? idxNow + 1 :
        idxStart !== -1 ? idxStart + 1 :
        null;

      const wasStarter = idxStart !== -1;

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
        order,
        wasStarter,
      };
    }
  });

  // ✅ 確定時：その守備位置に別の選手が入っているなら、古い代走/代打/臨時代走の表示情報を消す
  for (const pos of positions) {
    const currentId =
      typeof finalAssignments?.[pos] === "number"
        ? Number(finalAssignments[pos])
        : null;

    for (const [origIdStr, info] of Object.entries(usedInfo || {})) {
      if (!info) continue;

      const reason = String((info as any).reason ?? "");
      const fromPosRaw = String((info as any).fromPos ?? "");
      const isPinchSource =
        ["代打", "代走", "臨時代走"].includes(reason) ||
        ["代打", "代走", "臨時代走"].includes(fromPosRaw);

      if (!isPinchSource) continue;

      const sym =
        (posNameToSymbol as any)[(info as any).fromPos] ?? (info as any).fromPos;

      if (sym !== pos) continue;

      const origId = Number(origIdStr);
      const subId =
        typeof (info as any).subId === "number"
          ? Number((info as any).subId)
          : null;

      if (
        currentId != null &&
        currentId !== origId &&
        currentId !== subId
      ) {
        delete (usedInfo as any)[origIdStr].reason;
        delete (usedInfo as any)[origIdStr].fromPos;
      }
    }
  }

console.log("[REENTRY CLEANUP] finalAssignments", finalAssignments);
console.log("[REENTRY CLEANUP] usedInfo before", structuredClone(usedInfo));
// 🆕 リエントリー確定した元選手(B)の代打/代走痕跡を掃除する
// 🆕 リエントリー確定した元選手(B)の代打/代走痕跡を掃除する
{
  const onFieldIds = new Set(
    Object.values(finalAssignments).filter(
      (v): v is number => typeof v === "number"
    )
  );

  for (const [origIdStr, info] of Object.entries(usedInfo)) {
    const origId = Number(origIdStr);
    const reason = String((info as any)?.reason ?? "");
    const fromPosRaw = String((info as any)?.fromPos ?? "");
    const isPinchSource =
      ["代打", "代走", "臨時代走"].includes(reason) ||
      ["代打", "代走", "臨時代走"].includes(fromPosRaw);

    if (isPinchSource && onFieldIds.has(origId)) {
      (usedInfo as any)[origIdStr] = {
        ...(info as any),
        hasReentered: true,
      };

      delete (usedInfo as any)[origIdStr].reason;
      delete (usedInfo as any)[origIdStr].fromPos;
      delete (usedInfo as any)[origIdStr].subId;
    }
  }
}
console.log("[REENTRY CLEANUP] usedInfo after", structuredClone(usedInfo));
// （この直後に既存の保存行が続く）
await localForage.setItem("usedPlayerInfo", usedInfo);
setUsedPlayerInfo(usedInfo); // ★ 追加（UI 側の分類を即時反映）

  console.log("✅ 守備交代で登録された usedPlayerInfo：", usedInfo);

  // ---- 打順は「並びを固定」する：入替や移動では一切並べ替えない ----
const updatedOrder = structuredClone(finalBattingOrder);

const onFieldIds = new Set(
  Object.values(finalAssignments).filter((v): v is number => typeof v === "number")
);

// ✅ 守備に就いた代打/代走/臨時代走は、usedInfo上の pinch 表示情報を消す
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

// usedInfo から「代打/代走/臨時代走」で出た選手IDを集める（あなたの構造に合わせて調整）
const pinchIds = Object.entries(usedInfo || {})
  .filter(([_, u]: any) => ["代打", "代走", "臨時代走"].includes(u?.fromPos))
  .map(([id]) => Number(id));

const missing = pinchIds.filter((id) => !onFieldIds.has(id));

console.log("[CONFIRM-CHECK] pinchIds", pinchIds);
console.log("[CONFIRM-CHECK] onFieldIds", [...onFieldIds]);
console.log("[CONFIRM-CHECK] missing", missing);
console.log("[CONFIRM-CHECK] finalAssignments", finalAssignments);

  // “打順に元から居る（＝先発 or 既に登録済み）選手”集合
  const startersOrRegistered = new Set(
    updatedOrder.map(e => e?.id).filter((id): id is number => typeof id === "number")
  );

  // 守備位置ごとに差分を確認（並びは一切変更しない）
  positions.forEach((pos) => {
    const initialId = initialAssignments[pos];
    const currentId = finalAssignments[pos];

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

  // ✅ 追加：代打/代走が「守備に就いていない」のに打順に残っている場合、
// その打順枠の“最終出場者”で置き換える（= 守備側に入った控えを打順に反映）
updatedOrder.forEach((entry, idx) => {
  if (!entry) return;

  const isPinch = ["代打", "代走", "臨時代走"].includes(entry.reason);
  if (!isPinch) return;

  // 代打本人が守備にいないなら不整合なので補正対象
  if (onFieldIds.has(entry.id)) return;

  // この打順枠の「試合開始時のID」を基準に、usedPlayerInfo の連鎖末端を取る
  const startId = startingOrder[idx]?.id;
  if (typeof startId !== "number") return;

  const latest = resolveLatestSubId(startId, usedInfo); // 末端subId
  if (typeof latest !== "number") return;

  // latest が守備側に居るなら、その選手をこの打順に確定反映
  if (onFieldIds.has(latest)) {
    updatedOrder[idx] = { id: latest, reason: "途中出場" };
    startersOrRegistered.add(latest);
  }
});



// ✅ 変更：確定時に「DH枠の実体」を finalAssignments["指"] に同期（大谷ルール時）
if (ohtaniRule) {
  const dhActiveNow = typeof finalAssignments?.["指"] === "number"; // DHが有効なときだけ
  const dhStarterId = initialAssignments?.["指"];
  const dhSlotIndex =
    typeof dhStarterId === "number"
      ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
      : -1;

  if (dhActiveNow && dhSlotIndex >= 0) {
    const orderSrc = (battingOrderDraft?.length ? battingOrderDraft : battingOrder) || [];
    const dhId =
      battingReplacements?.[dhSlotIndex]?.id ??
      orderSrc?.[dhSlotIndex]?.id ??
      null;

    if (typeof dhId === "number") {
      finalAssignments["指"] = dhId;
    }
  }
}

// --- 保存（代打赤字はクリアして保存） ---
await localForage.setItem("lineupAssignments", finalAssignments);
// ★ここを {} に固定する（非空は保存しない）
await localForage.setItem("battingReplacements", {});
await localForage.setItem("battingOrder", updatedOrder);
localStorage.setItem("battingOrderVersion", String(Date.now()));
await localForage.setItem("dhEnabledAtStart", finalDhEnabledAtStart);
await localForage.setItem("ohtaniRule", ohtaniRule);

// 画面状態もあわせて空にしておく
setBattingReplacements({});
setSubstitutionLogs([]);
setPairLocks({});

// ✅ まずモーダルを閉じる（これをやらないと「戻ったのに画面が残る」原因になる）
setShowSaveModal(false);
setShowLeaveConfirm(false);

// 保存完了：スナップショット更新＆クリーン化
snapshotRef.current = buildSnapshot();
setIsDirty(false);
// ✅ 確定後はこの画面内の“基準”を更新
setInitialAssignments(finalAssignments);
setAssignments(finalAssignments);
setBattingOrder(updatedOrder);
setBattingOrderDraft(updatedOrder);
setDhEnabledAtStart(finalDhEnabledAtStart);

// ✅ 親画面側（App.tsx）の遷移を実行
onConfirmed();

// ✅ ルートも戻す（履歴が無い場合に備えてフォールバック）
if (window.history.length > 1) {
  navigate(-1);
} else {
  // ここはあなたの「守備画面のルート」に置き換えてください（例: "/defense"）
  navigate("/defense", { replace: true });
}

console.log("✅ onConfirmed called");


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

  // ✅ swapの検証は swapRows だけにかける
// ✅ 1〜9チェック用
const isValidNum = (n: number) => Number.isInteger(n) && n >= 1 && n <= 9;
const hasDup = (arr: number[]) => new Set(arr).size !== arr.length;

// ✅ swapだけの「from=to禁止」は維持（replaceは同じ守備でもOKなので除外）
if (swapRows.some((r) => {
  if (r.from !== r.to) return false;

  // 同じ番号（例：1が1）の場合、
  // その守備にいる選手が代打/代走なら許可する

  const posSym = numberToPosSymbol[Number(r.from)];
  const currentId = posSym ? (assignments as any)?.[posSym] : null;

  if (!currentId) return true; // 通常エラー

  // battingOrder から reason を確認
  const direct = battingOrder?.find((e: any) => Number(e?.id) === Number(currentId))?.reason;

  if (["代打", "代走", "臨時代走"].includes(String(direct))) {
    return false; // OKにする
  }

  // usedPlayerInfo も確認
  const info = Object.values(usedPlayerInfo || {}).find(
    (x: any) => Number(x?.subId) === Number(currentId)
  );

  if (info && ["代打", "代走", "臨時代走"].includes(String(info.reason))) {
    return false; // OK
  }

  return true; // 通常はエラー
})) {
  setPosNumberError("同じ番号同士（例：1が1）は指定できません。");
  return;
}

// ✅ swap の数字チェック（toが空なら NaN になるので弾く）
if (
  swapRows.some((r) => !isValidNum(Number(r.from)) || !isValidNum(Number(r.to)))
) {
  setPosNumberError("守備番号は1〜9を選択してください。");
  return;
}

// ✅ replace の from は必須、to は任意（未選択なら同じ守備に入る扱い）
if (replaceRows.some((r) => !isValidNum(Number(r.from)))) {
  setPosNumberError("守備番号は1〜9を選択してください。");
  return;
}

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
const posNumberOptionsSimple = POS_NUMBERS.map((n) => {
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

const posNumberOptions = POS_NUMBERS.map((n) => {
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
        orderSrc?.[dhSlotIndex]?.id ??
        assignments["指"])
      : assignments["指"];


      // ✅ DHスロットの選手が「指以外」に配置されている場合は、フィールド図のDH表示を消す
const dhIsPlacedElsewhere =
  typeof dhCurrentId === "number" &&
  Object.entries(assignments || {}).some(
    ([sym, id]) => sym !== "指" && typeof id === "number" && id === dhCurrentId
  );

const dhDisplayId = dhIsPlacedElsewhere ? null : dhCurrentId;


// 代走がいる場合はその選手を優先表示
let displayId = assignments[pos];

const runnerEntry = Object.entries(usedPlayerInfo || {}).find(([origId, info]: any) => {
  return (
    info?.reason === "代走" &&
    info?.fromPos === pos &&
    typeof info?.subId === "number"
  );
});

if (runnerEntry) {
  displayId = runnerEntry[1].subId;
}

const allowPinchOverride = !touchedFieldPos.has(pos);

// 代打は補助表示用
const pinchLatestForPos = (() => {
  if (!allowPinchOverride) return null;

  for (const [origIdStr, info] of Object.entries(usedPlayerInfo || {})) {
    if (!info) continue;
    if (!["代打"].includes(String(info.reason ?? ""))) continue;

    const sym = (posNameToSymbol as any)[info.fromPos] ?? info.fromPos;
    if (sym !== pos) continue;

    const origId = Number(origIdStr);
    const subId = typeof info.subId === "number" ? info.subId : null;
    if (subId != null) return subId;

    return resolveLatestSubId(origId, usedPlayerInfo as any);
  }

  return null;
})();

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
const currentId = getDisplayedPlayerIdForPos(pos);


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
                // ✅ DHスロット（先発時に「指」を担っていた選手の打順 index）
                const dhStarterId = initialAssignments?.["指"];
                const dhSlotIndex =
                  typeof dhStarterId === "number"
                    ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
                    : -1;

                const dhActive = !!assignments["指"];

                const displayId = battingReplacements[index]?.id ?? entry.id;

                const starter = teamPlayers.find(p => p.id === entry.id);
                const player  = teamPlayers.find(p => p.id === displayId);
                if (!starter || !player) return null;

                let currentPos = getOrderDisplayPos(assignments, displayId);
                let initialPos = getOrderDisplayPos(initialAssignments, displayId);
                // 🔧 代打/代走は守備に就いていないため "-" になりがち
                // → subId === displayId の usedPlayerInfo から fromPos を拾う
                if (!currentPos || currentPos === "－") {
                    console.log("🔍IF currentPos=", currentPos);
                  const pinchInfo = Object.values(usedPlayerInfo || {}).find(
                    (info: any) =>
                      info?.subId === displayId &&
                      ["代打", "代走", "臨時代走"].includes(info?.reason)
                  );

                  if (pinchInfo?.fromPos) {
                    currentPos = posNameToSymbol[pinchInfo.fromPos] ?? pinchInfo.fromPos;
                    console.log("🔍CHANGE currentPos=", currentPos);
                  }
                }      

                // ✅ 代打がDHに入った場合でも、DHスロットは赤字「指」表示にする（大谷ルールONでも通常と同じ）
                if (dhActive && dhSlotIndex === index) {
                  currentPos = "指";
                  if (!initialPos || initialPos === "-") initialPos = "指";
}



                const playerChanged   = displayId !== entry.id;
                const positionChanged = currentPos !== initialPos;

                const isPinchHitter = entry.reason === "代打";
                const isPinchRunner = entry.reason === "代走";
                const isPinch = isPinchHitter || isPinchRunner;
                const pinchLabel = isPinchHitter ? "代打" : isPinchRunner ? "代走" : "";

                // ✅ 特別代打などで「代打本人が守備についていない」場合、assignments からは "-" になってしまう。
                // usedPlayerInfo は { [origStarterId]: { fromPos, subId, reason, ... } } の形なので、
                // subId === displayId を満たすレコードを探し、その fromPos（例: "二"）を表示に使う。
                if (isPinch && (!currentPos || currentPos === "-")) {
                  const info = Object.values(usedPlayerInfo || {}).find((x: any) => x?.subId === displayId && (x?.reason === "代打" || x?.reason === "代走" || x?.reason === "臨時代走"));
                  const fromPos = (info as any)?.fromPos as string | undefined;
                  if (fromPos) {
                    // fromPos が "セカンド" のようなフル名で入っている場合は "二" に寄せる
                    const sym = (posNameToSymbol as any)[fromPos] ?? fromPos;
                    currentPos = sym;
                  }
                }

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

                // ✅ DH（指名打者）が「どの打順スロットか」を特定（交代内容表示用）
                const dhStarterId = initialAssignments?.["指"];
                const dhSlotIndex =
                  typeof dhStarterId === "number"
                    ? startingOrderRef.current.findIndex(e => e.id === dhStarterId)
                    : -1;

                const changes = battingOrder.map((entry, index) => {
                  const starter = teamPlayers.find((p) => p.id === entry.id);
                  if (!starter) return null;

                  let replaced = battingReplacements[index] ?? teamPlayers.find(p => p.id === entry.id);
                  // ✅ DHスロットだけは、フィールド側(assignments["指"])が最新になっている場合があるのでそれを優先
                  if (index === dhSlotIndex) {
                    const dhStarterId = initialAssignments?.["指"];
                    const dhNowId = assignments?.["指"];

                    // 「DHがスターターのまま」の時（大谷ルール直後など）は上書きしない
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

                  const currentPos = getPositionName(assignments, currentId);
                  const initialPos = getPositionName(initialAssignments, entry.id);

                  const playerChanged = replaced && replaced.id !== entry.id;
                  const positionChanged = currentPos !== initialPos;
                  const isPinchHitter = entry.reason === "代打";
                  const isPinchRunner = entry.reason === "代走";
                  const isPinch = isPinchHitter || isPinchRunner;
                  const pinchReasons = ["代打", "代走", "臨時代走"] as const;

                  // subId(=代打で出た選手ID)から「どの守備位置(fromPos)の代打か」を逆引き
                  const resolvePinchFromPosSymBySubId = (subId: number): string => {
                    for (const info of Object.values(usedPlayerInfo || {})) {
                      if (!info) continue;
                      if (!pinchReasons.includes(String((info as any).reason) as any)) continue;
                      if ((info as any).subId !== subId) continue;

                      const fromPos = (info as any).fromPos as string | undefined;
                      if (!fromPos) return "";

                      // fromPos は "セカンド" の可能性があるので sym に寄せる
                      return (posNameToSymbol as any)[fromPos] ?? fromPos; // "二" など
                    }
                    return "";
                  };

                  if (isPinchHitter && replaced && !Object.values(assignments).includes(replaced.id)) {
                    // ✅ DHの打順スロットに代打を出したケースは「代打：選手 ➡ DH指名打者」にする
                    const isDhPinch = ohtaniRule && dhSlotIndex === index;

                    return {
                      key: `pinch-${index}`,
                      type: 1,
                      pos: isDhPinch ? "指" : "",
                      jsx: (
                        <li key={`pinch-${index}`}>
                          {isDhPinch ? (
                            <>
                              代打：{replaced.lastName}{replaced.firstName} #{replaced.number} ➡ {withFull("指")}
                            </>
                          ) : (
                            <>
                              {(() => {
                                const sym = resolvePinchFromPosSymBySubId(replaced.id);
                                return sym
                                  ? <>代打：{replaced.lastName}{replaced.firstName} #{replaced.number} ➡ {withFull(sym)}</>
                                  : <>代打：{replaced.lastName}{replaced.firstName} #{replaced.number}</>;
                              })()}
                            </>
                          )}
                        </li>
                      ),
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

const pinchRunnerCandidateId = currentPlayer?.id ?? entry.id;

const pinchRunnerInfo = Object.values(usedPlayerInfo || {}).find(
  (x: any) =>
    (x?.subId === entry.id || x?.subId === pinchRunnerCandidateId) &&
    (x?.reason === "代走" || x?.reason === "臨時代走")
);

const pinchRunnerPos = (() => {
  const fromPos = (pinchRunnerInfo as any)?.fromPos as string | undefined;
  if (!fromPos) return "";
  return (posNameToSymbol as any)[fromPos] ?? fromPos;
})();

if ((!currentPos || currentPos === "-") && pinchRunnerPos) {
  currentPos = pinchRunnerPos;
}

if (pinchRunnerInfo && replaced && pinchRunnerPos) {
  const pinchRunner =
    teamPlayers.find((p) => p.id === pinchRunnerCandidateId) ||
    teamPlayers.find((p) => p.id === entry.id);

  const replacedPlayer = replaced;
  const isSame = pinchRunner?.id === replacedPlayer?.id;

  return {
    key: `runner-${index}`,
    type: 2,
    pos: pinchRunnerPos,
    jsx: (
      <li key={`runner-${index}`}>
        代走：{pinchRunner?.lastName}{pinchRunner?.firstName} #{pinchRunner?.number}
        {" "}➡ {withFull(pinchRunnerPos)}
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

                  // ✅ 大谷ルールON時：投手交代に伴って出てしまう「投 → 指（DH）」のシフト表示は不要
                  const isOhtaniPitcherToDhNoise =
                    ohtaniRule &&
                    typeof initialAssignments?.["投"] === "number" &&
                    typeof initialAssignments?.["指"] === "number" &&
                    initialAssignments["投"] === initialAssignments["指"] &&           // 投手=DH（同一人物）で開始
                    typeof assignments?.["投"] === "number" &&
                    assignments["投"] !== initialAssignments["投"] &&                  // このターンで投手が交代している
                    starter.id === initialAssignments["投"] &&                         // その「投手=DH本人」の行だけ
                    initialPos === "投" &&
                    currentPos === "指";                                               // 「投 → 指」になってしまうやつ

                  // ノイズならこの行は交代内容に出さない
                  if (isOhtaniPitcherToDhNoise) return null;

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

                  // ✅ 大谷ルール開始（投＝指）だったか
                  const isOhtaniAtStart =
                    ohtaniRule &&
                    typeof initialAssignments?.["投"] === "number" &&
                    typeof initialAssignments?.["指"] === "number" &&
                    initialAssignments["投"] === initialAssignments["指"];

                  // ✅ このターンで投手が交代しているか（元投手 initP が投手ではなくなった）
                  const isPitcherReplacedThisTurn =
                    typeof assignments?.["投"] === "number" && assignments["投"] !== initP;

                  // ✅ 大谷ルールONで投手交代した時に出てしまう「投 → 指」はノイズなので交代内容に出さない
                  // （元投手が assignments 上は「指」に残ってしまうため）
                  const isOhtaniPitcherToDhNoiseExtra =
                    isOhtaniAtStart && isPitcherReplacedThisTurn && nowPos === "指";

                  if (isOhtaniPitcherToDhNoiseExtra) {
                    console.log("[DEBUG][CHANGE_LIST] skip pitcher-shift-extra (Ohtani noise)", {
                      initP,
                      nowPos,
                      curP: assignments?.["投"],
                      dh: assignments?.["指"],
                    });
                    return;
                  }

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

              // ✅ 次の1回だけリエントリー判定を無視して続行
              setForceNormalSubOnce(true);

              // ✅ ここは「交代処理を実行する関数」を呼ぶ必要がある
              // 現状はまだ無いので、次の手順4で applyDrop を作る
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
