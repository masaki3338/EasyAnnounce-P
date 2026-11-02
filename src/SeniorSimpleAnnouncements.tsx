import React, { useEffect, useMemo, useRef, useState } from "react";
import localForage from "localforage";
import { speak, stop, prefetchTTS } from "./lib/tts";

type Page = "seniorStartTime" | "seniorMemberExchange" | "seniorGroundMaintenance" | "seniorStartGreeting";
type Props = { page: Page; onBack: () => void };
type Item = { title: string; display: string; spoken: string; note: string };
const Mic = () => <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden><path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/></svg>;
const SeniorSimpleAnnouncements: React.FC<Props> = ({page,onBack}) => {
  const [mi,setMi] = useState<any>({});
  const [teamNames,setTeamNames] = useState({visitor:"先攻チーム",home:"後攻チーム",visitorKana:"先攻チーム",homeKana:"後攻チーム"});
  const [active,setActive] = useState<string|null>(null);
  const [startAt,setStartAt] = useState("09:00");
  const [warmupAt,setWarmupAt] = useState("08:20");
  const [knockAt,setKnockAt] = useState("08:40");
  const [includeGameBalls,setIncludeGameBalls] = useState(false);
  const [gameBallCount,setGameBallCount] = useState(3);
  const [includeRosinBag,setIncludeRosinBag] = useState(false);
  const [attendees,setAttendees] = useState<"captain" | "captainCoach">("captain");
  const [meetingPlace,setMeetingPlace] = useState<"headquarters" | "backnet">("headquarters");
  const session = useRef(0);
  useEffect(()=>{
    let alive=true;
    (async()=>{
      const [info,team,store]=await Promise.all([localForage.getItem<any>("matchInfo"),localForage.getItem<any>("team"),localForage.getItem<any>("teamRegisterStore")]);
      if(!alive)return;
      const data=info||{};setMi(data);
      const f=(id:any)=>store?.teams?.find((t:any)=>String(t.id)===String(id));
      const from=(entry:any, fallback:string)=>({name:entry?.team?.name||entry?.name||fallback,kana:entry?.team?.furigana||entry?.team?.nameKana||entry?.furigana||entry?.team?.name||fallback});
      if(data.announcementMode==="single"){
        const first=from(f(data.firstBaseTeamId),data.firstBaseTeamName||"1塁側チーム");
        const third=from(f(data.thirdBaseTeamId),data.thirdBaseTeamName||"3塁側チーム");
        const visitor=data.battingFirstSide==="third"?third:first;
        const home=data.battingFirstSide==="third"?first:third;
        setTeamNames({visitor:visitor.name,home:home.name,visitorKana:visitor.kana,homeKana:home.kana});
      } else {
        const self={name:team?.name||"自チーム",kana:team?.furigana||team?.nameKana||team?.name||"自チーム"};
        const other={name:data.opponentTeam||data.opponentTeamName||"相手チーム",kana:data.opponentTeamFurigana||data.opponentTeam||data.opponentTeamName||"相手チーム"};
        const home=data.isHome===true||data.isHome==="後攻";
        setTeamNames({visitor:home?other.name:self.name,home:home?self.name:other.name,visitorKana:home?other.kana:self.kana,homeKana:home?self.kana:other.kana});
      }
      setStartAt(String(data.startTime||data.gameStartTime||"09:00"));
      setWarmupAt(String(data.warmupTime||"08:20"));
      setKnockAt(String(data.sheetKnockTime||data.knockTime||"08:40"));
    })();
    return()=>{alive=false;++session.current;stop()};
  },[]);
  const matchNo=String(mi.matchNumber||"〇");
  const hhmm=(t:string)=>{const m=t.match(/^(\d{1,2}):(\d{2})$/);return m?`${Number(m[1])}時${Number(m[2])}分`:t;};
  const items:Item[]=useMemo(()=>{
    if(page==="seniorStartTime")return [
      {title:"開始予定案内",note:"審判員または大会本部から予定時刻を確認して放送",display:`お知らせいたします。\n本日の第${matchNo}試合のトスバッティングとキャッチボールは、${hhmm(warmupAt)}頃を予定しております。`,spoken:`お知らせいたします。本日の第${matchNo}試合のトスバッティングとキャッチボールは、${hhmm(warmupAt)}頃を予定しております。`},
      {title:"シートノック予定",note:"予定が決まっている場合のみ案内",display:`シートノックは${hhmm(knockAt)}頃を予定しております。\n試合開始は${hhmm(startAt)}の予定です。`,spoken:`シートノックは${hhmm(knockAt)}頃を予定しております。試合開始は${hhmm(startAt)}の予定です。`}
    ];
    if(page==="seniorMemberExchange"){
      const supplies = [
        ...(includeGameBalls ? [`試合球${gameBallCount}個`] : []),
        ...(includeRosinBag ? ["確認のため使用するロジンバッグ"] : []),
      ];
      const suppliesText = supplies.length ? `${supplies.join("と")}を持って、` : "";
      const attendeeLabel = attendees === "captain" ? "キャプテン" : "キャプテンと監督";
      const placeLabel = meetingPlace === "headquarters" ? "本部席" : "バックネット前";
      const message = `お知らせいたします。\n両チームの${attendeeLabel}は、${suppliesText}${placeLabel}までお越しください。`;
      return [{
        title:"メンバー交換・本部への集合案内",
        note:"審判員または球場責任理事の指示があった場合に放送してください。",
        display:message,
        spoken:message.replace(/\n/g,""),
      }];
    }
    if(page==="seniorGroundMaintenance")return [
      {title:"グラウンド整備依頼",note:"審判・大会本部の指示があった場合",display:"両チームの選手は、グラウンド整備をお願いいたします。",spoken:"両チームの選手は、グラウンド整備をお願いいたします。"},
      {title:"グラウンド整備終了",note:"整備終了後",display:"グラウンド整備、ありがとうございました。",spoken:"グラウンド整備、ありがとうございました。"}
    ];
    return [{title:"試合開始直前のご案内",note:"両チームの挨拶終了後、後攻チームが守備につく前",display:`お待たせいたしました。\n本日の第${matchNo}試合、まもなく開始でございます。`,spoken:`お待たせいたしました。本日の第${matchNo}試合、まもなく開始でございます。`}];
  },[page,matchNo,startAt,warmupAt,knockAt,includeGameBalls,gameBallCount,includeRosinBag,attendees,meetingPlace]);
  const titles:Record<Page,string>={seniorStartTime:"開始予定時間案内",seniorMemberExchange:"メンバー交換案内",seniorGroundMaintenance:"グラウンド整備",seniorStartGreeting:"試合開始挨拶"};
  useEffect(()=>{items.forEach(i=>void prefetchTTS(i.spoken).catch(()=>{}));},[items.map(i=>i.spoken).join("|")]);
  const say=(key:string,txt:string)=>{++session.current;const id=session.current;stop();setActive(key);void speak(txt,{progressive:true,cache:true}).finally(()=>{if(id===session.current)setActive(null);});};
  const halt=()=>{++session.current;stop();setActive(null);};
  return <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-4 sm:px-6 py-5"><div className="max-w-2xl mx-auto space-y-5">
    <header className="text-center"><h1 className="text-2xl sm:text-3xl font-extrabold">🎤 {titles[page]}</h1><p className="text-sky-200 text-sm mt-2">リトルシニア／関東連盟基準</p></header>
    {page==="seniorStartTime"&&<section className="rounded-2xl bg-white/10 p-4 space-y-3"><p className="font-bold">予定時刻を設定</p>{[["ウォーミングアップ",warmupAt,setWarmupAt],["シートノック",knockAt,setKnockAt],["試合開始",startAt,setStartAt]].map(([label,value,setter]:any)=><label key={label} className="flex justify-between items-center gap-3"><span className="text-sm">{label}</span><input type="time" className="bg-white text-gray-900 rounded-lg px-3 py-2" value={value} onChange={e=>setter(e.target.value)}/></label>)}</section>}
    {page==="seniorMemberExchange"&&<section className="rounded-2xl bg-white/10 border border-white/15 p-4 space-y-4">
      <fieldset className="space-y-2">
        <legend className="font-bold mb-2">集合する人</legend>
        <div className="flex flex-col sm:flex-row sm:gap-6 gap-2">
          <label className="inline-flex items-center gap-2 min-h-11 cursor-pointer">
            <input type="radio" name="senior-member-attendees" value="captain" className="h-5 w-5 accent-blue-600" checked={attendees === "captain"} onChange={()=>setAttendees("captain")}/>
            <span>キャプテン</span>
          </label>
          <label className="inline-flex items-center gap-2 min-h-11 cursor-pointer">
            <input type="radio" name="senior-member-attendees" value="captainCoach" className="h-5 w-5 accent-blue-600" checked={attendees === "captainCoach"} onChange={()=>setAttendees("captainCoach")}/>
            <span>キャプテンと監督</span>
          </label>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="font-bold mb-2">集合場所</legend>
        <div className="flex flex-col sm:flex-row sm:gap-6 gap-2">
          <label className="inline-flex items-center gap-2 min-h-11 cursor-pointer">
            <input type="radio" name="senior-member-location" value="headquarters" className="h-5 w-5 accent-blue-600" checked={meetingPlace === "headquarters"} onChange={()=>setMeetingPlace("headquarters")}/>
            <span>本部席</span>
          </label>
          <label className="inline-flex items-center gap-2 min-h-11 cursor-pointer">
            <input type="radio" name="senior-member-location" value="backnet" className="h-5 w-5 accent-blue-600" checked={meetingPlace === "backnet"} onChange={()=>setMeetingPlace("backnet")}/>
            <span>バックネット前</span>
          </label>
        </div>
      </fieldset>
      <div className="border-t border-white/15 pt-3 space-y-3">
      <h2 className="font-bold">持参物の読み上げ設定</h2>
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 min-h-11 cursor-pointer">
          <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={includeGameBalls} onChange={e=>setIncludeGameBalls(e.target.checked)}/>
          <span>試合球</span>
        </label>
        <label className="flex items-center gap-2">
          <span className="text-sm">個数</span>
          <select aria-label="試合球の数" className="bg-white text-gray-900 rounded-lg px-3 py-2 disabled:opacity-50" disabled={!includeGameBalls} value={gameBallCount} onChange={e=>setGameBallCount(Number(e.target.value))}>
            {[1,2,3,4,5].map(n=><option key={n} value={n}>{n}個</option>)}
          </select>
        </label>
      </div>
      <label className="flex items-center gap-2 min-h-11 cursor-pointer">
        <input type="checkbox" className="h-5 w-5 accent-blue-600" checked={includeRosinBag} onChange={e=>setIncludeRosinBag(e.target.checked)}/>
        <span>ロジンバッグ</span>
      </label>
      <p className="text-xs text-white/70">チェックした持参物だけを下のアナウンス文言に追加します。両方とも未選択なら集合案内のみを読み上げます。</p>
      </div>
    </section>}
    {items.map((item,i)=><section key={i} className="space-y-2"><div className="rounded-xl border border-amber-300/40 bg-amber-300/10 p-3"><h2 className="font-semibold">{i+1}. {item.title}</h2><p className="text-sm mt-1 text-amber-50">{item.note}</p></div><div className="rounded-2xl p-4 border border-rose-500/80 bg-gradient-to-br from-rose-600/45 to-rose-400/25 shadow-lg"><p className="font-semibold whitespace-pre-wrap leading-relaxed">{item.display}</p><div className="grid grid-cols-2 gap-2 mt-3"><button className={`rounded-xl py-3 font-bold flex gap-2 items-center justify-center ${active===String(i)?"bg-green-600":"bg-blue-600"}`} onClick={()=>say(String(i),item.spoken)}><Mic/>読み上げ</button><button className="bg-gray-600 disabled:opacity-40 rounded-xl py-3 font-bold" disabled={active!==String(i)} onClick={halt}>停止</button></div></div></section>)}
    <button className="w-full rounded-xl bg-white text-gray-900 py-4 font-bold" onClick={()=>{halt();onBack()}}>← 試合前アナウンスに戻る</button>
  </div></div>;
};
export default SeniorSimpleAnnouncements;
