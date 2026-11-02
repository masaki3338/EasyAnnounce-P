import React, { useCallback, useEffect, useRef, useState } from "react";
import localForage from "localforage";
import { speak, stop, prefetchTTS } from "./lib/tts";
import SeniorStartingLineup from "./SeniorStartingLineup";

type Side = "home" | "visitor";
type TimerState = { side: Side; durationSeconds: number; noticeMinutes: number; remainingSeconds: number; endAt: number | null };
const STATE_KEY = "senior:knockLineupTimer:v1";
const SETTINGS_KEY = "senior:knockLineupSettings:v1";
const DEFAULT_SECONDS = 7 * 60;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const formatClock = (n: number) => `${Math.floor(n / 60).toString().padStart(2, "0")}:${(n % 60).toString().padStart(2, "0")}`;
const resolveRemaining = (s: TimerState) => s.endAt === null ? s.remainingSeconds : Math.max(0, Math.ceil((s.endAt - Date.now()) / 1000));

/** リトルシニア専用。スタメン音声中には時間案内を自動再生しない。 */
const SeniorKnockLineup: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [side, setSide] = useState<Side>("visitor");
  const [durationMinutes, setDurationMinutes] = useState(7);
  const [noticeMinutes, setNoticeMinutes] = useState(2);
  const [timeLeft, setTimeLeft] = useState(DEFAULT_SECONDS);
  const [running, setRunning] = useState(false);
  const [expired, setExpired] = useState(false);
  const [noticeDue, setNoticeDue] = useState(false);
  const [lineupSpeaking, setLineupSpeaking] = useState(false);
  const [announcementSpeaking, setAnnouncementSpeaking] = useState(false);
  const [ready, setReady] = useState(false);
  const [lineupKey, setLineupKey] = useState(0);
  const stateRef = useRef<TimerState>({side:"visitor", durationSeconds:DEFAULT_SECONDS, noticeMinutes:2, remainingSeconds:DEFAULT_SECONDS, endAt:null});
  const playbackSession = useRef(0);
  const speakingRef = useRef(false);
  const prevRemainingRef = useRef(DEFAULT_SECONDS);

  const refresh = useCallback(() => {
    const s = stateRef.current;
    const seconds = resolveRemaining(s);
    setTimeLeft(seconds);
    setRunning(s.endAt !== null && seconds > 0);
    setExpired(seconds === 0);
    if (s.noticeMinutes > 0 && prevRemainingRef.current > s.noticeMinutes * 60 && seconds <= s.noticeMinutes * 60 && seconds > 0) {
      setNoticeDue(true);
    }
    prevRemainingRef.current = seconds;
    if (seconds === 0 && s.endAt !== null) {
      stateRef.current = {...s, endAt:null, remainingSeconds:0};
      void localForage.setItem(STATE_KEY, stateRef.current);
    }
  }, []);
  const save = (next: TimerState) => {
    stateRef.current = next;
    prevRemainingRef.current = resolveRemaining(next);
    void localForage.setItem(STATE_KEY, next);
    refresh();
  };
  useEffect(() => {
    let alive = true;
    (async () => {
      const [saved, settings, mi] = await Promise.all([
        localForage.getItem<TimerState>(STATE_KEY),
        localForage.getItem<{ durationMinutes?: number; noticeMinutes?: number }>(SETTINGS_KEY),
        localForage.getItem<any>("matchInfo"),
      ]);
      if (!alive) return;
      const minutes = clamp(Number(settings?.durationMinutes || 7), 1, 30);
      const warn = clamp(Number(settings?.noticeMinutes ?? 2), 0, minutes);
      const chosenSide: Side = mi?.sheetKnockSide === "home" ? "home" : "visitor";
      const valid = saved && (saved.side === "home" || saved.side === "visitor");
      const state: TimerState = valid ? saved : {side:chosenSide, durationSeconds:minutes*60, noticeMinutes:warn, remainingSeconds:minutes*60, endAt:null};
      stateRef.current = state;
      setSide(state.side);
      setDurationMinutes(state.durationSeconds/60);
      setNoticeMinutes(state.noticeMinutes);
      prevRemainingRef.current = state.durationSeconds;
      refresh();
      setReady(true);
    })();
    return () => { alive = false; ++playbackSession.current; stop(); };
  }, [refresh]);
  useEffect(() => {
    if (!ready) return;
    const id = window.setInterval(refresh, 250);
    return () => window.clearInterval(id);
  }, [ready, refresh]);
  useEffect(() => {
    if (!ready) return;
    const text = ["ノック時間、残り2分です。", "ノックを終了してください。"];
    text.forEach(t => void prefetchTTS(t).catch(() => {}));
  }, [ready]);

  const changeSide = async (next: Side) => {
    if (next === side) return;
    if (lineupSpeaking || announcementSpeaking) { window.alert("読み上げを停止してから切り替えてください。"); return; }
    // チームごとに別タイマー。切替前の時計は一旦停止して保持する。
    const previous = stateRef.current;
    save({...previous, remainingSeconds:resolveRemaining(previous), endAt:null});
    const mi = (await localForage.getItem<any>("matchInfo")) || {};
    await localForage.setItem("matchInfo", {...mi, startingLineupSide:next, sheetKnockSide:next});
    setSide(next);
    setNoticeDue(false);
    save({side:next,durationSeconds:durationMinutes*60, noticeMinutes,remainingSeconds:durationMinutes*60,endAt:null});
    setLineupKey(n=>n+1);
  };
  const updateDuration = (n: number) => {
    if (running) return;
    const minutes = clamp(n,1,30);
    const warn = Math.min(noticeMinutes,minutes);
    setDurationMinutes(minutes);
    setNoticeMinutes(warn);
    setNoticeDue(false);
    save({ ...stateRef.current, durationSeconds:minutes*60, remainingSeconds:minutes*60, noticeMinutes:warn, endAt:null });
    void localForage.setItem(SETTINGS_KEY,{ durationMinutes:minutes,noticeMinutes:warn });
  };
  const updateNotice = (n: number) => {
    const warn=clamp(n,0,durationMinutes);
    setNoticeMinutes(warn);
    setNoticeDue(false);
    save({...stateRef.current,noticeMinutes:warn});
    void localForage.setItem(SETTINGS_KEY,{durationMinutes,noticeMinutes:warn});
  };
  const startPause = () => {
    const s=stateRef.current;
    if (s.endAt !== null) save({...s,remainingSeconds:resolveRemaining(s),endAt:null});
    else save({...s, remainingSeconds:s.remainingSeconds || s.durationSeconds, endAt:Date.now()+(s.remainingSeconds||s.durationSeconds)*1000});
  };
  const reset = () => { setNoticeDue(false); save({...stateRef.current,endAt:null,remainingSeconds:stateRef.current.durationSeconds}); };
  const say = async (message:string) => {
    if (lineupSpeaking || speakingRef.current) { window.alert("スタメン発表中は時間案内を割り込ませません。"); return; }
    speakingRef.current=true;
    const session=++playbackSession.current;
    setAnnouncementSpeaking(true);
    try { await speak(message,{progressive:false,cache:true}); }
    catch(err) { console.error("[SeniorKnockLineup] 音声エラー",err); }
    finally {if(session===playbackSession.current){speakingRef.current=false;setAnnouncementSpeaking(false);}}
  };
  const halt = () => {++playbackSession.current; speakingRef.current=false; stop();setAnnouncementSpeaking(false);};
  const remainingNotice = `ノック時間、残り${Math.ceil(timeLeft/60)}分です。`;
  const noticeAvailable = timeLeft>0 && timeLeft<=noticeMinutes*60 && noticeMinutes>0;
  return <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-2 sm:px-4 pb-8">
    <div className="mx-auto max-w-2xl">
      <div className="sticky top-0 z-20 bg-gray-900/95 backdrop-blur border-b border-white/20 px-2 py-3 space-y-2 shadow-lg">
        <h1 className="text-center font-extrabold text-lg">⚾ リトルシニア シートノック＋スタメン発表</h1>
        <div className="grid grid-cols-2 gap-2">
          <button className={`rounded-lg py-2 font-bold ${side==="visitor"?"bg-sky-600":"bg-gray-600"}`} onClick={()=>void changeSide("visitor")}>先攻チーム</button>
          <button className={`rounded-lg py-2 font-bold ${side==="home"?"bg-sky-600":"bg-gray-600"}`} onClick={()=>void changeSide("home")}>後攻チーム</button>
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div><span className="text-xs text-white/75">シートノック残り</span><div className={`text-4xl font-mono font-extrabold tabular-nums ${expired?"text-red-400":noticeAvailable?"text-amber-300":"text-white"}`}>{formatClock(timeLeft)}</div></div>
          <div className="flex gap-2">
            <button onClick={startPause} className="rounded-xl bg-blue-600 px-4 py-3 font-bold">{running?"一時停止":"開始・再開"}</button>
            <button onClick={reset} className="rounded-xl bg-gray-600 px-4 py-3 font-bold">リセット</button>
          </div>
        </div>
        {!running && <div className="flex flex-wrap gap-3 text-sm items-center">
          <label>ノック時間 <select className="bg-white text-gray-900 p-2 rounded" value={durationMinutes} onChange={e=>updateDuration(Number(e.target.value))}>{Array.from({length:30},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}分</option>)}</select></label>
          <label>残り案内 <select className="bg-white text-gray-900 p-2 rounded" value={noticeMinutes} onChange={e=>updateNotice(Number(e.target.value))}>{Array.from({length:durationMinutes+1},(_,i)=>i).map(n=><option key={n} value={n}>{n===0?"なし":`${n}分`}</option>)}</select></label>
        </div>}
        {(expired||noticeDue) && <p role="status" className="bg-amber-300 text-gray-950 rounded-lg p-2 font-bold text-sm">{expired?"ノック時間が終了しました。実際のノックを確認して終了案内をしてください。":"残り時間の案内タイミングです（スタメン発表には割り込みません）。"}</p>}
        <div className="grid grid-cols-2 gap-2">
          <button disabled={!noticeAvailable||lineupSpeaking||announcementSpeaking} onClick={()=>{setNoticeDue(false);void say(remainingNotice)}} className="bg-rose-700 py-2 rounded-lg font-bold disabled:opacity-40">🎤 残り{noticeMinutes}分</button>
          <button disabled={lineupSpeaking||announcementSpeaking} onClick={()=>void say("ノックを終了してください。") } className="bg-rose-700 py-2 rounded-lg font-bold disabled:opacity-40">🎤 終了案内</button>
        </div>
        <button onClick={halt} disabled={!announcementSpeaking} className="w-full py-2 rounded-lg bg-gray-600 font-bold disabled:opacity-40">時間案内の停止</button>
      </div>
      <div className="pt-3"><SeniorStartingLineup key={lineupKey} leagueMode="pony" embedded onSpeakingChange={setLineupSpeaking} onNavigate={()=>{}} /></div>
      <button onClick={()=>{halt();onBack()}} className="mt-4 w-full rounded-xl bg-white text-gray-950 font-bold py-4">← 試合前アナウンスに戻る</button>
    </div>
  </div>;
};
export default SeniorKnockLineup;
