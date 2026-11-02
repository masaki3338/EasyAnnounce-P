import React, { useEffect, useState } from "react";
import localForage from "localforage";

// リトルシニア専用。既存のポニー／ボーイズのファイルは変更しない。
// App.tsx 側で senior* 画面IDを追加してから接続する。
type Target =
  | "seniorStartTime"
  | "seniorMemberExchange"
  | "seniorWarmup"
  | "seniorSheetKnock"
  | "seniorStartingLineup"
  | "seniorGroundMaintenance"
  | "seniorStartGreeting"
  | "seniorSeatIntroduction"
  | "seniorKnockLineup";

type Props = { onNavigate: (screen: Target) => void; onBack: () => void };
const WARMUP_KEY = "senior:warmupEnabled";
type Step = { id: Target; title: string; note: string; icon: string; role?: "home" | "visitor"; enabled: boolean };

const SeniorPreGameAnnouncement: React.FC<Props> = ({ onNavigate, onBack }) => {
  const [warmupEnabled, setWarmupEnabled] = useState(true);
  const [mode, setMode] = useState<"normal" | "single">("normal");
  const [isHome, setIsHome] = useState(true);
  const [homeName, setHomeName] = useState("後攻チーム");
  const [visitorName, setVisitorName] = useState("先攻チーム");
  const [pending, setPending] = useState<Step | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [enabled, mi, team, store] = await Promise.all([
        localForage.getItem<boolean>(WARMUP_KEY),
        localForage.getItem<any>("matchInfo"),
        localForage.getItem<any>("team"),
        localForage.getItem<any>("teamRegisterStore"),
      ]);
      if (!alive) return;
      if (typeof enabled === "boolean") setWarmupEnabled(enabled);
      setMode(mi?.announcementMode === "single" ? "single" : "normal");
      setIsHome(mi?.isHome === true || mi?.isHome === "後攻");
      if (mi?.announcementMode === "single") {
        const find = (id: unknown) => store?.teams?.find((t: any) => String(t.id) === String(id));
        const first = find(mi?.firstBaseTeamId);
        const third = find(mi?.thirdBaseTeamId);
        const firstName = mi?.firstBaseTeamName || first?.team?.name || first?.name || "1塁側チーム";
        const thirdName = mi?.thirdBaseTeamName || third?.team?.name || third?.name || "3塁側チーム";
        const thirdFirst = mi?.battingFirstSide === "third";
        setVisitorName(thirdFirst ? thirdName : firstName);
        setHomeName(thirdFirst ? firstName : thirdName);
      } else {
        const selfName = team?.name || "自チーム";
        const otherName = mi?.opponentTeam || mi?.opponentTeamName || "相手チーム";
        const home = mi?.isHome === true || mi?.isHome === "後攻";
        setHomeName(home ? selfName : otherName);
        setVisitorName(home ? otherName : selfName);
      }
    })();
    return () => { alive = false; };
  }, []);

  const changeWarmup = async (enabled: boolean) => {
    setWarmupEnabled(enabled);
    await localForage.setItem(WARMUP_KEY, enabled);
  };
  const all = mode === "single";
  const steps: Step[] = [
    { id: "seniorStartTime", title: "開始予定時間案内", note: "担当：相手チームと話し合い", icon: "🕒", enabled: true },
    { id: "seniorMemberExchange", title: "メンバー交換案内", note: "担当：相手チームと話し合い", icon: "👥", enabled: true },
    ...(warmupEnabled ? [{ id: "seniorWarmup" as const, title: "ウォーミングアップ", note: "担当：相手チームと話し合い", icon: "🏃", enabled: true }] : []),
    // 通常モードで先攻を担当する場合、後攻チーム向けの2項目は表示しない。
    // 1人アナウンスモードでは両チームを担当するため従来どおり表示する。
    ...((all || isHome) ? [
      { id: "seniorSheetKnock" as const, title: `シートノック　後攻 ${homeName}`, note: "後攻から開始・既存の時間設定を利用", icon: "⚾", role: "home" as const, enabled: true },
      ...(!all ? [{ id: "seniorStartingLineup" as const, title: "スタメン発表", note: `後攻 ${homeName} のスタメン発表`, icon: "🎤", role: "home" as const, enabled: true }] : []),
    ] : []),
    ...((all || !isHome) ? [{ id: "seniorSheetKnock" as const, title: "シートノック/スタメン発表", note: `先攻 ${visitorName}／途中でスタメン発表画面を開けます（タイマー継続）`, icon: "⚾", role: "visitor" as const, enabled: true }] : []),
    { id: "seniorGroundMaintenance", title: "グラウンド整備", note: "整備依頼・終了のお礼", icon: "🧹", enabled: all || isHome },
    { id: "seniorStartGreeting", title: "試合開始挨拶", note: "整列・礼の終了後", icon: "👥", enabled: all || isHome },
    { id: "seniorSeatIntroduction", title: `シート紹介　後攻 ${homeName}`, note: "1回表の守備紹介", icon: "🎤", enabled: all || isHome },
  ];

  const go = async (step: Step) => {
    if (!step.enabled) { setPending(step); return; }
    if (step.role) {
      const mi = (await localForage.getItem<any>("matchInfo")) ?? {};
      await localForage.setItem("matchInfo", {
        ...mi,
        ...((step.id === "seniorSheetKnock" || step.id === "seniorKnockLineup") ? { sheetKnockSide: step.role } : {}),
        ...((step.id === "seniorStartingLineup" || step.id === "seniorKnockLineup") ? { startingLineupSide: step.role } : {}),
      });
    }
    onNavigate(step.id);
  };

  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-4 sm:px-6 py-5" style={{ paddingBottom: "max(24px, env(safe-area-inset-bottom))" }}>
      <div className="w-full max-w-2xl mx-auto">
        <header className="text-center mb-5">
          <h1 className="text-2xl sm:text-3xl font-extrabold">🎤 試合前アナウンス</h1>
          <p className="text-sky-200 text-sm mt-2">リトルシニア／関東連盟基準</p>
          <p className="text-xs mt-2 opacity-80">上から順番に実施 ／ 担当：{all ? "両チーム" : isHome ? "後攻" : "先攻"}</p>
        </header>
        <section className="rounded-2xl bg-white/10 border border-white/15 p-4 mb-5">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <span><span className="font-semibold block">ウォーミングアップ</span><span className="text-xs text-white/75">トスバッティング・キャッチボール</span></span>
            <select aria-label="ウォーミングアップ実施" value={warmupEnabled ? "yes" : "no"} onChange={e => void changeWarmup(e.target.value === "yes")} className="bg-white text-gray-900 rounded-lg p-2 font-semibold">
              <option value="yes">実施する</option><option value="no">実施しない</option>
            </select>
          </label>
        </section>
        <main className="space-y-3">
          {steps.map((s, i) => (
            <div key={`${s.id}:${s.role || "general"}`} className="grid grid-cols-[30px,1fr] gap-2 items-start">
              <div className={`w-8 h-8 rounded-full grid place-items-center text-sm font-bold ${s.enabled ? "bg-sky-500" : "bg-gray-500"}`}>{i + 1}</div>
              <button onClick={() => void go(s)} className={`min-h-[78px] w-full rounded-2xl border p-3 flex items-center gap-3 text-left active:scale-[0.98] ${s.enabled ? "bg-sky-500/20 border-sky-300/60" : "bg-gray-300/75 border-gray-300 text-gray-700"}`}>
                <span className="text-2xl shrink-0">{s.icon}</span>
                <span className="min-w-0 flex-1"><strong className="block text-sm sm:text-base">{s.title}</strong><span className="block text-xs mt-1 opacity-80">{s.note}</span>{!s.enabled && <span className="text-xs font-bold">担当外</span>}</span>
                <span aria-hidden>›</span>
              </button>
            </div>
          ))}
        </main>
        <button onClick={onBack} className="mt-6 w-full rounded-2xl bg-white text-gray-900 py-4 font-bold">← 試合開始画面に戻る</button>
      </div>
      {pending && <div className="fixed inset-0 z-50 bg-black/70 grid place-items-center p-4"><section className="bg-white text-gray-900 rounded-2xl p-5 w-full max-w-sm space-y-3"><h2 className="font-bold">担当外のアナウンス</h2><p>{pending.title}を開きますか？</p><div className="grid grid-cols-2 gap-2"><button className="bg-gray-200 rounded-lg py-3" onClick={() => setPending(null)}>キャンセル</button><button className="bg-blue-600 text-white rounded-lg py-3" onClick={() => { const p = pending; setPending(null); void (async () => { if (p.role) { const mi = (await localForage.getItem<any>("matchInfo")) ?? {}; await localForage.setItem("matchInfo", { ...mi, ...((p.id === "seniorSheetKnock" || p.id === "seniorKnockLineup") ? { sheetKnockSide: p.role } : {}), ...((p.id === "seniorStartingLineup" || p.id === "seniorKnockLineup") ? { startingLineupSide: p.role } : {}) }); } onNavigate(p.id); })(); }}>開く</button></div></section></div>}
    </div>
  );
};
export default SeniorPreGameAnnouncement;
