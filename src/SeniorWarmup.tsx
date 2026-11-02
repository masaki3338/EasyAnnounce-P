import React, { useEffect, useRef, useState } from "react";
import localForage from "localforage";
import { speak, stop, prefetchTTS } from "./lib/tts";

// 関東連盟：1回目 1塁キャッチボール／3塁トス、2回目は交代。各7分・残り${noticeMinutes}分。
// 既存Warmup.tsxに一切手を加えずリトルシニア専用にする。
type TeamInfo = { name: string; reading: string };
const emptyTeam: TeamInfo = { name: "チーム未登録", reading: "チーム未登録" };
const SETTINGS_KEY = "senior:warmupTimerSettings";
type Phase = 1 | 2;

const Mic = () => <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden><path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/></svg>;

function Announcement({ display, spoken, id, active, onSpeak, onStop }: {display:string;spoken:string;id:string;active:string|null;onSpeak:(id:string, text:string)=>void;onStop:()=>void}) {
  return <div className="rounded-2xl p-4 border border-rose-500/80 bg-gradient-to-br from-rose-600/45 to-rose-400/25 shadow-lg">
    <p className="whitespace-pre-wrap text-white font-semibold leading-relaxed">{display}</p>
    <div className="grid grid-cols-2 gap-2 mt-3">
      <button onClick={() => onSpeak(id, spoken)} className={`rounded-lg py-3 text-white font-bold flex items-center justify-center gap-2 ${active === id ? "bg-green-600" : "bg-blue-600"}`}><Mic/> 読み上げ</button>
      <button onClick={onStop} disabled={active !== id} className="rounded-lg py-3 bg-gray-600 text-white font-bold disabled:opacity-40">停止</button>
    </div>
  </div>;
}

function useClock(duration:number, notice:number) {
  const [remaining, setRemaining] = useState(duration);
  const [running, setRunning] = useState(false);
  const [noticeShown, setNoticeShown] = useState(false);
  const [endShown, setEndShown] = useState(false);
  const deadline = useRef<number | null>(null);
  const remainingRef = useRef(duration);
  const last = useRef(duration);
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const r = Math.max(0, Math.ceil(((deadline.current ?? Date.now()) - Date.now()) / 1000));
      setRemaining(r); remainingRef.current = r;
      if (notice > 0 && last.current > notice && r <= notice && r > 0) setNoticeShown(true);
      if (last.current > 0 && r === 0) { setEndShown(true); setRunning(false); deadline.current = null; }
      last.current = r;
    };
    const timer = window.setInterval(tick, 250);
    tick();
    return () => window.clearInterval(timer);
  }, [running]);
  return {
    remaining, running, noticeShown, endShown,
    start: () => { deadline.current = Date.now() + remainingRef.current * 1000; last.current = remainingRef.current; setRunning(true); },
    pause: () => { if (deadline.current) { const v = Math.max(0, Math.ceil((deadline.current - Date.now())/1000)); remainingRef.current=v; setRemaining(v); } deadline.current=null; setRunning(false); },
    reset: () => { deadline.current=null; remainingRef.current=duration; last.current=duration; setRemaining(duration); setRunning(false); setNoticeShown(false); setEndShown(false); },
    clearNotice: () => setNoticeShown(false), clearEnd: () => setEndShown(false),
  };
}
const format = (time:number) => `${Math.floor(time/60)}:${String(time%60).padStart(2,"0")}`;

const SeniorWarmup: React.FC<{onBack:()=>void}> = ({onBack}) => {
  const [first,setFirst] = useState<TeamInfo>(emptyTeam);
  const [third,setThird] = useState<TeamInfo>(emptyTeam);
  const [active,setActive] = useState<string|null>(null);
  const session = useRef(0);
  const [warmupMinutes,setWarmupMinutes] = useState(7);
  const [noticeMinutes,setNoticeMinutes] = useState(2);
  // 入力値とタイマーへ反映した値を分離（反映ボタンを押すまでタイマーは変更しない）
  const [appliedMinutes,setAppliedMinutes] = useState(7);
  const [appliedNotice,setAppliedNotice] = useState(2);
  const clock1 = useClock(appliedMinutes*60,appliedNotice*60);
  const clock2 = useClock(appliedMinutes*60,appliedNotice*60);
  useEffect(()=>{void localForage.getItem<{warmupMinutes:number;noticeMinutes:number}>(SETTINGS_KEY).then(v=>{
    if(!v)return;
    const minutes = Math.max(1,Math.min(30,v.warmupMinutes||7));
    const notice = Math.max(0,Math.min(minutes,v.noticeMinutes??2));
    setWarmupMinutes(minutes); setNoticeMinutes(notice);
    setAppliedMinutes(minutes); setAppliedNotice(notice);
  });},[]);
  const applySettings=async()=>{
    const minutes = Math.max(1,Math.min(30,warmupMinutes));
    const notice = Math.max(0,Math.min(minutes,noticeMinutes));
    setWarmupMinutes(minutes); setNoticeMinutes(notice);
    setAppliedMinutes(minutes); setAppliedNotice(notice);
    await localForage.setItem(SETTINGS_KEY,{warmupMinutes:minutes,noticeMinutes:notice});
  };
  // 反映済み時間に合わせて両方のタイマーをリセット
  useEffect(() => { clock1.reset(); clock2.reset(); }, [appliedMinutes, appliedNotice]);
  useEffect(() => {
    let alive = true;
    (async () => {
      const [mi, team, store] = await Promise.all([localForage.getItem<any>("matchInfo"),localForage.getItem<any>("team"),localForage.getItem<any>("teamRegisterStore")]);
      const fromFolder = (id:any) => {
        const folder = store?.teams?.find((t:any)=>String(t.id)===String(id));
        return {name:folder?.team?.name || folder?.teamName || folder?.name || "",reading:folder?.team?.furigana || folder?.team?.nameKana || folder?.furigana || ""};
      };
      let one:TeamInfo, three:TeamInfo;
      if (mi?.announcementMode === "single") {
        const f=fromFolder(mi.firstBaseTeamId), t=fromFolder(mi.thirdBaseTeamId);
        one={name:mi.firstBaseTeamName || f.name || "1塁側チーム",reading:f.reading || mi.firstBaseTeamName || f.name || "1塁側チーム"};
        three={name:mi.thirdBaseTeamName || t.name || "3塁側チーム",reading:t.reading || mi.thirdBaseTeamName || t.name || "3塁側チーム"};
      } else {
        const self={name:team?.name || "自チーム",reading:team?.furigana || team?.nameKana || team?.name || "自チーム"};
        const other={name:mi?.opponentTeam || mi?.opponentTeamName || "相手チーム",reading:mi?.opponentTeamFurigana || mi?.opponentTeam || mi?.opponentTeamName || "相手チーム"};
        one=mi?.benchSide === "3塁側" ? other : self;
        three=mi?.benchSide === "3塁側" ? self : other;
      }
      if (alive) {setFirst(one);setThird(three);}
    })();
    return () => {alive=false; session.current+=1;stop();};
  }, []);
  const say = (id:string,text:string) => {
    stop(); const n=++session.current; setActive(id);
    void speak(text,{progressive:true,cache:true}).finally(()=>{if(session.current===n) setActive(null);});
  };
  const stopVoice=()=>{++session.current;stop();setActive(null);};
  const phases = [
    {n:1 as Phase, clock:clock1, display:`1塁側${first.name}はキャッチボールを、\n3塁側${third.name}はトスバッティングを開始してください。\n時間は${appliedMinutes}分以内です。`,spoken:`1塁側${first.reading}はキャッチボールを、3塁側${third.reading}はトスバッティングを開始してください。時間は${appliedMinutes}分以内です。`},
    {n:2 as Phase, clock:clock2, display:`1塁側${first.name}はトスバッティングを、\n3塁側${third.name}はキャッチボールを開始してください。\n時間は${appliedMinutes}分以内です。`,spoken:`1塁側${first.reading}はトスバッティングを、3塁側${third.reading}はキャッチボールを開始してください。時間は${appliedMinutes}分以内です。`},
  ];
  useEffect(()=>{if(first.name === "チーム未登録" || third.name === "チーム未登録")return; phases.forEach(p=>{void prefetchTTS(p.spoken).catch(()=>{});});},[first,third]);
  const card=(p:typeof phases[number])=><section key={p.n} className="rounded-2xl border border-sky-300/40 bg-sky-400/10 p-4 space-y-3">
    <h2 className="font-bold text-lg">{p.n}回目</h2>
    <Announcement display={p.display} spoken={p.spoken} id={`start${p.n}`} active={active} onSpeak={say} onStop={stopVoice}/>
    <div className="rounded-xl bg-white/10 p-3">
      <p className="text-sm opacity-80">タイマー（{appliedMinutes}分）</p>
      <p className="text-4xl font-black tabular-nums my-2">{format(p.clock.remaining)}</p>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={p.clock.running?p.clock.pause:p.clock.start} className={`rounded-lg py-3 font-bold ${p.clock.running?"bg-amber-600":"bg-green-600"}`}>{p.clock.running?"一時停止":"START"}</button>
        <button onClick={p.clock.reset} className="bg-gray-600 rounded-lg py-3 font-bold">RESET</button>
      </div>
    </div>
    <Announcement display={`残り時間${appliedNotice}分です。`} spoken={`残り時間${appliedNotice}分です。`} id={`manual-notice${p.n}`} active={active} onSpeak={say} onStop={stopVoice}/>
    <Announcement display="終了してください。" spoken="終了してください。" id={`manual-end${p.n}`} active={active} onSpeak={say} onStop={stopVoice}/>
  </section>;
  // シートノックの通知と共通の赤系アナウンスデザイン
  const modal = (clock:ReturnType<typeof useClock>, id:string, end:boolean) => {
    const message = end ? "終了してください。" : `残り時間${appliedNotice}分です。`;
    const dismiss = () => { stopVoice(); end ? clock.clearEnd() : clock.clearNotice(); };
    return <div className="fixed inset-0 z-50 bg-black/75 grid place-items-center p-3 sm:p-4" role="dialog" aria-modal="true" aria-label={end ? "終了のお知らせ" : "残り時間のお知らせ"}>
      <div className="relative w-full max-w-lg rounded-2xl border border-rose-500 bg-gradient-to-br from-rose-600/45 to-rose-400/25 p-4 shadow-xl text-white">
        <button type="button" onClick={dismiss} aria-label="通知を閉じる" className="absolute right-2 top-2 rounded-full px-2 py-1 text-white/80 hover:bg-white/15">×</button>
        <p className="pr-8 font-semibold leading-relaxed">{message}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={()=>say(id,message)} className="flex min-h-12 items-center justify-center gap-2 rounded-lg bg-blue-600 py-3 font-bold"><Mic/>読み上げ</button>
          <button type="button" disabled={active!==id} onClick={stopVoice} className="min-h-12 rounded-lg bg-gray-600 py-3 font-bold disabled:opacity-40">停止</button>
        </div>
      </div>
    </div>;
  };
  return <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white p-4 sm:p-6" style={{paddingBottom:"max(20px,env(safe-area-inset-bottom))"}}><div className="max-w-2xl mx-auto space-y-4">
    <header className="text-center"><h1 className="text-2xl sm:text-3xl font-extrabold">🏃 ウォーミングアップ</h1><p className="text-sm opacity-80 mt-2">リトルシニア／関東連盟基準</p></header>
    <div className="rounded-2xl border border-amber-300/50 bg-amber-400/10 p-4 text-sm">1塁側・3塁側でキャッチボールとトスバッティングを交代で実施。各{appliedMinutes}分、残り{appliedNotice}分で案内します。</div>
    <section className="rounded-2xl border border-slate-500/70 bg-slate-700/80 p-3 space-y-3 shadow-lg">
      <h2 className="flex items-center gap-2 text-sm sm:text-base font-bold"><span className="grid h-9 w-9 place-items-center rounded-xl border border-white/20 bg-white/10 text-xl" aria-hidden="true">⏱</span> タイマー時間設定</h2>
      <div className="grid grid-cols-2 gap-2">
        {([
          {label:"ウォーミングアップ時間", value:warmupMinutes, change:(value:number)=>{setWarmupMinutes(value);setNoticeMinutes(current=>Math.min(current,value));}, min:1, max:30},
          {label:"お知らせ残り時間", value:noticeMinutes, change:setNoticeMinutes, min:0, max:warmupMinutes},
        ] as const).map(item=><div key={item.label} className="min-w-0 rounded-xl bg-slate-900/55 px-1.5 py-2 text-center">
          <p className="text-[10px] sm:text-xs font-semibold whitespace-nowrap">{item.label}</p>
          <div className="mt-1 flex items-center justify-center gap-1 sm:gap-2">
            <button type="button" aria-label={`${item.label}を1分減らす`} disabled={clock1.running||clock2.running||item.value<=item.min} onClick={()=>item.change(Math.max(item.min,item.value-1))} className="h-9 w-8 shrink-0 rounded-lg border border-white/25 bg-white/15 text-lg disabled:opacity-35">－</button>
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-gray-900 font-extrabold tabular-nums">{item.value}</span>
            <button type="button" aria-label={`${item.label}を1分増やす`} disabled={clock1.running||clock2.running||item.value>=item.max} onClick={()=>item.change(Math.min(item.max,item.value+1))} className="h-9 w-8 shrink-0 rounded-lg border border-white/25 bg-white/15 text-lg disabled:opacity-35">＋</button>
            <span className="text-sm font-bold">分</span>
          </div>
        </div>)}
      </div>
      <button type="button" className="w-full rounded-xl bg-emerald-500 py-3 font-bold text-white disabled:opacity-40" onClick={()=>void applySettings()} disabled={clock1.running||clock2.running}>反映</button>
    </section>
    {phases.map(card)}
    <button className="w-full py-4 rounded-xl bg-white text-gray-900 font-bold" onClick={()=>{stopVoice();onBack();}}>← 試合前アナウンスに戻る</button>
  </div>
  {clock1.noticeShown && modal(clock1,"noticeModal1",false)}
  {clock1.endShown && modal(clock1,"endModal1",true)}
  {clock2.noticeShown && modal(clock2,"noticeModal2",false)}
  {clock2.endShown && modal(clock2,"endModal2",true)}
  </div>;
};
export default SeniorWarmup;
