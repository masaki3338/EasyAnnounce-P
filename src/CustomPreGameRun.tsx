import React, {useEffect,useMemo,useRef,useState} from 'react';
import localForage from 'localforage';
import {getActiveCustomProfileId,getCustomProfiles} from './lib/customProfiles';
import {loadPreGameItems,type PreGameItem, type PreGameSegment} from './lib/customPreGameTemplates';
import {speak,stop,preserveNameReading} from './lib/tts';
import type {ScreenType} from './App';

type Player={id:number;lastName?:string;firstName?:string;lastNameKana?:string;firstNameKana?:string;number?:string;isFemale?:boolean};
type Team={name:string;kana:string;players:Player[];assignments:Record<string,number|null>;order:{id:number}[];benchOutIds:number[]};
const POS:Record<string,string>={投:'ピッチャー',捕:'キャッチャー',一:'ファースト',二:'セカンド',三:'サード',遊:'ショート',左:'レフト',中:'センター',右:'ライト',指:'指名打者'};
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const ruby=(text:string,kana?:string)=>kana?`<ruby>${esc(text)}<rt>${esc(kana)}</rt></ruby>`:esc(text);
const playerSurname=(p:Player)=>ruby(p.lastName||'',p.lastNameKana);
const playerName=(p:Player)=>playerSurname(p)+(p.firstName?ruby(p.firstName,p.firstNameKana):'');
const playerSpeech=(p:Player)=>[preserveNameReading(p.lastNameKana||p.lastName||''),preserveNameReading(p.firstNameKana||p.firstName||'')].filter(Boolean).join('、');
const tokenPattern=/【([^】]+)】/g;
const replaceTokens=(source:string,vars:Record<string,string>)=>source.split(tokenPattern).map((part,i)=>i%2===0?esc(part):(Object.prototype.hasOwnProperty.call(vars,part)?vars[part]:esc('【'+part+'】'))).join('');
const speakingFromHtml=(html:string)=>{const el=document.createElement('div');el.innerHTML=html.replace(/<br\s*\/?\s*>/gi,'\n');el.querySelectorAll('ruby').forEach(r=>{const kana=r.querySelector('rt')?.textContent||'';const visible=Array.from(r.childNodes).filter(n=>n.nodeName!=='RT').map(n=>n.textContent||'').join('');r.replaceWith(preserveNameReading(kana||visible));});return el.textContent||'';};
// 審判は役割名から対応付ける（2審制の「塁審」は1塁審欄へ）。
const umpireNameTokens=(umpires:any):Record<string,string>=>{
 const result:Record<string,string>={'球審名':'','1塁審名':'','2塁審名':'','3塁審名':''};
 if(!Array.isArray(umpires))return result;
 const occupied=new Set<string>();
 umpireData: for(const u of umpires){
  const role=String(u?.role??'').replace(/[\s　]/g,'').replace(/[１２３]/g,d=>String('１２３'.indexOf(d)+1));
  let key='';
  if(/球審|主審/.test(role))key='球審名';
  else if(/1塁|一塁|塁審1|塁審一/.test(role))key='1塁審名';
  else if(/2塁|二塁|塁審2|塁審二/.test(role))key='2塁審名';
  else if(/3塁|三塁|塁審3|塁審三/.test(role))key='3塁審名';
  else if(role==='塁審')key='1塁審名';
  if(!key||occupied.has(key))continue umpireData;
  result[key]=ruby(String(u?.name??''),String(u?.furigana??''));
  occupied.add(key);
 }
 return result;
};
const normalizeClockInput=(value:unknown):string=>{
 const raw=String(value??'').trim();
 const match=raw.match(/^(\d{1,2})(?::|時)(\d{1,2})?(?:分)?$/);
 if(!match)return '';
 const h=Number(match[1]);const m=Number(match[2]??0);
 return h>=0&&h<24&&m>=0&&m<60?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`:'';
};
const clockAnnouncement=(value:string):string=>{
 const normalized=normalizeClockInput(value);
 if(!normalized)return String(value||'');
 const [hour,minute]=normalized.split(':').map(Number);
 return `${hour}時${minute?`${minute}分`:''}`;
};
const startClockStorageKey=(profileId:string,itemId:string)=>`easyannounce:custom:preGame:startClock:v1:${profileId}:${itemId}`;
const getPos=(team:Team,id:number)=>POS[Object.entries(team.assignments).find(([,pid])=>pid===id)?.[0]||'']||'指名打者';
const emptyTeam=():Team=>({name:'',kana:'',players:[],assignments:{},order:[],benchOutIds:[]});
export default function CustomPreGameRun({onNavigate,onBack,seatTopModal=false}:{onNavigate:(s:ScreenType)=>void;onBack:()=>void;seatTopModal?:boolean}){
 const [items,setItems]=useState<PreGameItem[]>([]);
 const [match,setMatch]=useState<any>({});
 const [top,setTop]=useState<Team>(emptyTeam);
 const [bottom,setBottom]=useState<Team>(emptyTeam);
 const [side,setSide]=useState<'top'|'bottom'>('top');
 const [completed,setCompleted]=useState<Record<string,number>>({});
 const [playing,setPlaying]=useState('');
 const [detailId,setDetailId]=useState<string|null>(null);
 const [returnToKnockId,setReturnToKnockId]=useState<string|null>(null);
 const [ready,setReady]=useState(false);
 const [profileName,setProfileName]=useState('');
 // 試合当日の入力値。アナウンス設定のテンプレートは変更しない。
 const [startClocks,setStartClocks]=useState<Record<string,string>>({});
 const session=useRef(0);
 useEffect(()=>{let live=true;(async()=>{
  const id=getActiveCustomProfileId();const all=loadPreGameItems(id);const mi=await localForage.getItem<any>('matchInfo')||{};
  const self=await localForage.getItem<any>('team'); const store=await localForage.getItem<any>('teamRegisterStore');
  const folder=(teamId:any)=>store?.teams?.find((x:any)=>String(x.id)===String(teamId));
  const make=async (raw:any,teamId?:any):Promise<Team>=>{
   const t=raw?.team||raw||{};
   const order=await localForage.getItem<any>(teamId!=null?`startingBattingOrder_${teamId}`:'startingBattingOrder');
   const assigns=await localForage.getItem<any>(teamId!=null?`startingassignments_${teamId}`:'startingassignments');
   const benchOut=await localForage.getItem<any>(teamId!=null?`startingBenchOutIds_${teamId}`:'startingBenchOutIds');
   return {name:String(t.name||raw?.teamName||raw?.name||''),kana:String(t.furigana||t.nameKana||t.name||''),players:Array.isArray(t.players)?t.players:[],assignments:assigns||{},order:Array.isArray(order)?order:[],benchOutIds:Array.isArray(benchOut)?benchOut.map(Number):[]};
  };
  let topTeam:Team,bottomTeam:Team;
  if(mi.announcementMode==='single'){
   const first=await make(folder(mi.firstBaseTeamId),mi.firstBaseTeamId);
   const third=await make(folder(mi.thirdBaseTeamId),mi.thirdBaseTeamId);
   [topTeam,bottomTeam]=mi.battingFirstSide==='third'?[third,first]:[first,third];
  }else{
   const selfTeam=await make(self);
   const other=emptyTeam();other.name=String(mi.opponentTeam||mi.opponentTeamName||'対戦チーム');other.kana=String(mi.opponentTeamFurigana||other.name);
   [topTeam,bottomTeam]=mi.isHome?[other,selfTeam]:[selfTeam,other];
  }
  const storedTimes=await Promise.all(all.map(async item=>{
   try{return [item.id,normalizeClockInput(await localForage.getItem<string>(startClockStorageKey(id,item.id)))] as const;}
   catch{return [item.id,''] as const;}
  }));
  if(!live)return;
  setStartClocks(Object.fromEntries(storedTimes));
  setItems(all);setMatch(mi);setTop(topTeam);setBottom(bottomTeam);setSide(mi.isHome?'bottom':'top');
  setProfileName(getCustomProfiles().find(x=>x.id===id)?.name||'カスタマイズ');setReady(true);
 })().catch(e=>{console.error('[CustomPreGameRun]',e);setReady(true)});return()=>{live=false;session.current++;stop()};},[]);
 // 既存画面への遷移をなくし、カスタマイズ専用の同一進行画面上で操作する。
 const [knockMinutes,setKnockMinutes]=useState(7);
 const [noticeMinutes,setNoticeMinutes]=useState(2);
 const [knockSides,setKnockSides]=useState<Record<'top'|'bottom',{remaining:number;running:boolean;deadline:number|null;noticed:boolean;ended:boolean}>>({
  top:{remaining:420,running:false,deadline:null,noticed:false,ended:false},
  bottom:{remaining:420,running:false,deadline:null,noticed:false,ended:false}
 });
 useEffect(()=>{let mounted=true;(async()=>{
  const v=await localForage.getItem<any>('sheetKnockTimerSettings:custom');
  if(!mounted)return;
  const minutes=Math.max(1,Math.min(30,Number(v?.knockMinutes)||7));
  const notice=Math.max(0,Math.min(minutes,(v?.noticeMinutes===undefined?2:Number(v.noticeMinutes))));
  setKnockMinutes(minutes);setNoticeMinutes(notice);
  setKnockSides({top:{remaining:minutes*60,running:false,deadline:null,noticed:false,ended:false},bottom:{remaining:minutes*60,running:false,deadline:null,noticed:false,ended:false}});
 })().catch(console.error);return()=>{mounted=false};},[]);
 useEffect(()=>{
  const timer=window.setInterval(()=>setKnockSides(prev=>{
   let change=false;
   const next={...prev};
   (['top','bottom'] as const).forEach(k=>{
    const v=prev[k];if(!v.running||v.deadline===null)return;
    const remaining=Math.max(0,Math.ceil((v.deadline-Date.now())/1000));
    const noticed=v.noticed||(noticeMinutes>0&&remaining<=noticeMinutes*60);
    const ended=remaining===0;
    if(v.remaining!==remaining||v.noticed!==noticed||v.ended!==ended){next[k]={...v,remaining,noticed,ended,running:!ended,deadline:ended?null:v.deadline};change=true;}
   });
   return change?next:prev;
  }),250);
  return()=>window.clearInterval(timer);
 },[noticeMinutes]);
 const changeKnock=(k:'top'|'bottom',command:'start'|'pause'|'reset')=>{
  setKnockSides(prev=>{
   const v=prev[k];
   if(command==='reset')return {...prev,[k]:{remaining:knockMinutes*60,running:false,deadline:null,noticed:false,ended:false}};
   if(command==='pause')return {...prev,[k]:{...v,remaining:v.deadline!==null?Math.max(0,Math.ceil((v.deadline-Date.now())/1000)):v.remaining,running:false,deadline:null}};
   const secs=v.remaining>0?v.remaining:knockMinutes*60;
   return {...prev,[k]:{...v,remaining:secs,running:true,deadline:Date.now()+secs*1000,ended:false}};
  });
 };
 const formatClock=(n:number)=>`${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`;
 type WarmTimer={remaining:number;running:boolean;deadline:number|null;noticed:boolean;ended:boolean};
 const [warmTimers,setWarmTimers]=useState<Record<string,WarmTimer>>({});
 const getWarmTimer=(item:PreGameItem):WarmTimer=>warmTimers[item.id]||{remaining:(item.timerSettings?.minutes??10)*60,running:false,deadline:null,noticed:false,ended:false};
 useEffect(()=>{const timer=window.setInterval(()=>setWarmTimers(prev=>{
  let changed=false;const next={...prev};
  for(const [id,v] of Object.entries(prev)){
   if(!v.running||v.deadline==null)continue;
   const item=items.find(x=>x.id===id);const notice=item?.timerSettings?.noticeMinutes??2;
   const remaining=Math.max(0,Math.ceil((v.deadline-Date.now())/1000));
   const noticed=v.noticed||(notice>0&&remaining<=notice*60);const ended=remaining===0;
   if(remaining!==v.remaining||noticed!==v.noticed||ended!==v.ended){next[id]={...v,remaining,noticed,ended,running:!ended,deadline:ended?null:v.deadline};changed=true;}
  }
  return changed?next:prev;
 }),250);return()=>window.clearInterval(timer)},[items]);
 const changeWarm=(item:PreGameItem,command:'start'|'pause'|'reset')=>setWarmTimers(prev=>{
  const v=prev[item.id]||{remaining:(item.timerSettings?.minutes??10)*60,running:false,deadline:null,noticed:false,ended:false};
  if(command==='reset')return {...prev,[item.id]:{remaining:(item.timerSettings?.minutes??10)*60,running:false,deadline:null,noticed:false,ended:false}};
  if(command==='pause')return {...prev,[item.id]:{...v,remaining:v.deadline!=null?Math.max(0,Math.ceil((v.deadline-Date.now())/1000)):v.remaining,running:false,deadline:null}};
  const remaining=v.remaining>0?v.remaining:(item.timerSettings?.minutes??10)*60;
  return {...prev,[item.id]:{...v,remaining,running:true,deadline:Date.now()+remaining*1000,ended:false}};
 });
 const updateWarmSettings=(item:PreGameItem,minutes:number,noticeMinutes:number)=>{
  const m=Math.max(1,Math.min(30,minutes));const n=Math.max(0,Math.min(m-1,noticeMinutes));
  const updated=items.map(x=>x.id===item.id?{...x,timerSettings:{minutes:m,noticeMinutes:n}}:x);
  setItems(updated);savePreGameItems(getActiveCustomProfileId(),updated);
  setWarmTimers(prev=>({...prev,[item.id]:{remaining:m*60,running:false,deadline:null,noticed:false,ended:false}}));
 };
 const renderWarmTimer=(item:PreGameItem)=>{
  const current=getWarmTimer(item);const minutes=item.timerSettings?.minutes??10;const notice=item.timerSettings?.noticeMinutes??2;
  return <div className="rounded-xl border border-sky-300/40 bg-slate-900/55 px-3 py-3 space-y-3">
   <div className="flex justify-between items-center gap-3"><div className="font-bold">⏱ ウォーミングアップタイマー</div><div className="text-3xl font-black tabular-nums">{formatClock(current.remaining)}</div></div>
   <div className="grid grid-cols-2 gap-2 text-xs"><label>ウォーミングアップ時間<select className="block w-full bg-slate-700 border border-white/20 p-3 rounded-lg mt-1" value={minutes} disabled={current.running} onChange={e=>updateWarmSettings(item,Number(e.target.value),notice)}>{Array.from({length:30},(_,i)=>i+1).map(x=><option key={x} value={x}>{x}分</option>)}</select></label><label>残り時間のお知らせ<select className="block w-full bg-slate-700 border border-white/20 p-3 rounded-lg mt-1" value={Math.min(minutes-1,notice)} disabled={current.running} onChange={e=>updateWarmSettings(item,minutes,Number(e.target.value))}><option value={0}>なし</option>{Array.from({length:minutes-1},(_,i)=>i+1).map(x=><option key={x} value={x}>残り{x}分</option>)}</select></label></div>
   <div className="grid grid-cols-2 gap-2"><button className="rounded-xl bg-emerald-600 py-3 font-bold" onClick={()=>changeWarm(item,current.running?'pause':'start')}>{current.running?'一時停止':'開始・再開'}</button><button className="rounded-xl bg-slate-600 py-3 font-bold" onClick={()=>changeWarm(item,'reset')}>リセット</button></div>
   {current.noticed&&current.remaining>0&&<div className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-bold text-amber-950">残り{notice}分です。残り時間のアナウンスをご確認ください。</div>}
   {current.ended&&<div className="rounded-lg border border-rose-300 bg-rose-100 px-3 py-2 text-sm font-bold text-rose-950">ウォーミングアップ時間が終了しました。終了アナウンスをご確認ください。</div>}
  </div>
 };

 const getKnockSide=(item:PreGameItem):'top'|'bottom'=>item.target==='top'?'top':item.target==='bottom'?'bottom':side;
 const isKnockStart=(item:PreGameItem)=>item.kind==='sheetKnock'&&item.segments.some(seg=>(seg.phase||'start')==='start');
 const renderKnockTimer=(item:PreGameItem)=>{
  const k=getKnockSide(item);const current=knockSides[k];
  const updateTimerSettings=async (minutes:number,notice:number)=>{
   const m=Math.max(1,Math.min(30,minutes));const n=Math.max(0,Math.min(m,notice));
   setKnockMinutes(m);setNoticeMinutes(n);
   setKnockSides(prev=>({
    top:prev.top.running?prev.top:{...prev.top,remaining:m*60,noticed:false,ended:false},
    bottom:prev.bottom.running?prev.bottom:{...prev.bottom,remaining:m*60,noticed:false,ended:false}
   }));
   await localForage.setItem('sheetKnockTimerSettings:custom',{knockMinutes:m,noticeMinutes:n});
  };
  return <div className="rounded-xl border border-sky-300/40 bg-slate-900/55 px-3 py-3 space-y-3">
   <div className="flex items-center justify-between gap-3"><div><div className="text-sm font-bold">⏱ シートノックタイマー（{k==='top'?'先攻':'後攻'}）</div><p className="text-xs text-white/70">{knockMinutes}分／残り{noticeMinutes}分でお知らせ</p></div><div className="text-3xl font-black tabular-nums">{formatClock(current.remaining)}</div></div>
   <div className="grid grid-cols-2 gap-2 text-xs"><label className="space-y-1">ノック時間（1～30分）<select aria-label="ノック時間" value={knockMinutes} disabled={knockSides.top.running||knockSides.bottom.running} onChange={e=>void updateTimerSettings(Number(e.target.value),noticeMinutes)} className="block w-full bg-slate-700 border border-white/20 p-2 rounded-lg">{Array.from({length:30},(_,i)=>i+1).map(x=><option key={x} value={x}>{x}分</option>)}</select></label><label className="space-y-1">残り時間のお知らせ<select aria-label="残り時間のお知らせ" value={noticeMinutes} disabled={knockSides.top.running||knockSides.bottom.running} onChange={e=>void updateTimerSettings(knockMinutes,Number(e.target.value))} className="block w-full bg-slate-700 border border-white/20 p-2 rounded-lg">{Array.from({length:knockMinutes+1},(_,i)=>i).map(x=><option key={x} value={x}>{x===0?'なし':`${x}分`}</option>)}</select></label></div>
   <div className="grid grid-cols-2 gap-2"><button type="button" className="rounded-xl bg-emerald-600 py-3 font-bold" onClick={()=>changeKnock(k,current.running?'pause':'start')}>{current.running?'一時停止':'開始・再開'}</button><button type="button" className="rounded-xl bg-slate-600 py-3 font-bold" onClick={()=>changeKnock(k,'reset')}>リセット</button></div>
   {current.noticed&&current.remaining>0&&<div className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-sm font-bold text-amber-950">残り{noticeMinutes}分以下です。「残り時間」のアナウンスを確認してください。</div>}
   {current.ended&&<div className="rounded-lg border border-rose-300 bg-rose-100 px-3 py-2 text-sm font-bold text-rose-950">ノック時間が終了しました。「終了案内」を読み上げてください。</div>}
  </div>
 };
 const changeStartClock=(itemId:string,value:string)=>{
  setStartClocks(prev=>({...prev,[itemId]:value}));
  void localForage.setItem(startClockStorageKey(getActiveCustomProfileId(),itemId),value).catch(e=>console.error('[CustomPreGameRun] 開始予定時刻の保存に失敗',e));
 };
 const current=side==='top'?top:bottom;
 const vars=useMemo(()=>({
  'チーム名':current.name,'先攻チーム名':top.name,'後攻チーム名':bottom.name,'大会名':String(match.tournamentName||''),
  '試合番号':String(match.matchNumber||''),'開始予定時刻':clockAnnouncement(String(match.startTime||match.scheduledStartTime||'')),
  '開始時刻':String(match.actualStartTime||match.startTime||''),'残り分数':String(noticeMinutes),'残り時間':String(noticeMinutes),'ノック時間':String(knockMinutes),
  '回':'1','表裏':'表','1塁側チーム名':match.battingFirstSide==='third'?bottom.name:top.name,
  '3塁側チーム名':match.battingFirstSide==='third'?top.name:bottom.name,
  '監督名':'','選手名':'','選手名（苗字）':'','選手名（フルネーム）':'','投手名(苗字)':'','投手名(フルネーム)':'','投手背番号':'','控え選手名（苗字）':'','控え選手名（フルネーム）':'','選手敬称':'','打順':'','守備位置':'','背番号':'','審判名':'','審判役割':'','球審名':'','1塁審名':'','2塁審名':'','3塁審名':''
 }),[current,top,bottom,match,knockMinutes,noticeMinutes]);
 const buildSegment=(item:PreGameItem,seg:PreGameSegment)=>{
  const seatSide=item.kind==='seat'?(seg.seatSide??'bottom'):side;
  // 保存済みの表示条件を最優先する。'any' は明示的な『指定なし』。
  const selectedTeam=item.condition?.team??item.target??'any';
  // 1人アナウンスでは設定上の先攻・後攻・塁側にかかわらず表示するが、
  // 差し込みに使うチームは各項目の指定側を尊重する。
  const firstBaseIsTop=match.announcementMode==='single'
    ? match.battingFirstSide!=='third'
    : match.battingFirstSide==='third'?false:match.battingFirstSide==='first'?true:!match.isHome;
  const firstBaseTeam=firstBaseIsTop?top:bottom;
  const thirdBaseTeam=firstBaseIsTop?bottom:top;
  const team=item.kind==='seat'?(seatSide==='top'?top:bottom):selectedTeam==='top'?top:selectedTeam==='bottom'?bottom:
    selectedTeam==='firstBase'?firstBaseTeam:selectedTeam==='thirdBase'?thirdBaseTeam:current;
  const basic={...vars,...umpireNameTokens(match.umpires),'チーム名':team.name,'表裏':item.kind==='seat'?(seatSide==='top'?'裏':'表'):vars['表裏'],'開始予定時刻':clockAnnouncement(startClocks[item.id]||String(match.startTime||match.scheduledStartTime||'')),'残り分数':String(item.kind==='warmup'?(item.timerSettings?.noticeMinutes??2):noticeMinutes),'残り時間':String(noticeMinutes)};
  const template=seg.text;
  // 控えはスタメン・守備配置・ベンチ外を除外して抽出する。
  const benchOutIds=new Set<number>(team.benchOutIds);
    // メンバーのベンチ外情報が利用できる場合はそのフラグも反映。
  const benchPlayers=team.players.filter(p=>!team.order.some(x=>Number(x.id)===Number(p.id))&&!Object.values(team.assignments).some(id=>Number(id)===Number(p.id))&&!benchOutIds.has(Number(p.id))&&!(p as any).isBenchOut);
  const currentPlayer=team.order.map(x=>team.players.find(p=>Number(p.id)===Number(x.id))).find(Boolean)||team.players[0];
  // 投手は打順1番ではなく、対象チームのスタメン守備配置「投」で特定する。
  const pitcherId=team.assignments['投'];
  const pitcher=pitcherId==null?undefined:team.players.find(p=>Number(p.id)===Number(pitcherId));
  const values={...basic,
    '投手名(苗字)':pitcher?playerSurname(pitcher):'',
    '投手名(フルネーム)':pitcher?playerName(pitcher):'',
    '投手背番号':pitcher?String(pitcher.number??''):'',
    '選手名（苗字）':currentPlayer?playerSurname(currentPlayer):'',
    '選手名（フルネーム）':currentPlayer?playerName(currentPlayer):'',
    '控え選手名（苗字）':benchPlayers.map(playerSurname).join('、'),
    '控え選手名（フルネーム）':benchPlayers.map(playerName).join('、')};
  // カスタマイズのスタメン発表は、打順行とウェイティング行を別々に展開する。
  // 説明文（「ウェイティング選手は、」等）は繰り返さない。
  if (item.kind === 'lineup') {
    const starters = team.order.slice(0, 9)
      .map(entry => team.players.find(p => Number(p.id) === Number(entry.id)))
      .filter((p): p is Player => Boolean(p));
    const starterToken = /【(?:打順|守備位置|選手名|選手名（苗字）|選手名（フルネーム）)】/;
    // 打順・守備位置がある行は、控え選手名トークンを誤使用していても先発行を優先する。
    const starterIdentityToken = /【(?:打順|守備位置)】/;
    const benchToken = /【控え選手名（(?:苗字|フルネーム)）】/;
    const renderedLines: string[] = [];
    for (const line of template.split(/\r?\n/)) {
      if (starterIdentityToken.test(line) || (starterToken.test(line) && !benchToken.test(line))) {
        // スタメン行の【控え選手名】は設定ミスでも先発選手名に読み替える。
        starters.forEach((p, i) => {
          renderedLines.push(replaceTokens(line, {
            ...values,
            '選手名': playerName(p),
            '選手名（苗字）': playerSurname(p),
            '選手名（フルネーム）': playerName(p),
            '控え選手名（苗字）': playerSurname(p),
            '控え選手名（フルネーム）': playerName(p),
            '選手敬称': p.isFemale ? 'さん' : 'くん',
            '打順': String(i + 1),
            '守備位置': getPos(team, p.id),
            '背番号': String(p.number ?? ''),
          }));
        });
      } else if (benchToken.test(line)) {
        // 控え選手は、各選手の敬称と背番号を個別に埋め込む。
        for (const p of benchPlayers) {
          renderedLines.push(replaceTokens(line, {
            ...values,
            '控え選手名（苗字）': playerSurname(p),
            '控え選手名（フルネーム）': playerName(p),
            '選手敬称': p.isFemale ? 'さん' : 'くん',
            '背番号': String(p.number ?? ''),
          }));
        }
      } else {
        // 「先攻、…」「ウェイティング選手は、」などは一度だけ表示する。
        renderedLines.push(replaceTokens(line, values));
      }
    }
    return renderedLines.join('\n');
  }
  const hasPlayer=/【(?:選手名|選手名（苗字）|選手名（フルネーム）|選手敬称|打順|守備位置|背番号)】/.test(template);
  const hasLegacyUmpire=/【(?:審判名|審判役割)】/.test(template);
  if(item.kind==='lineup'||item.kind==='bench'||item.kind==='defense'||item.kind==='seat'){
    const players=item.kind==='bench'?team.players.filter(p=>!team.order.some(x=>x.id===p.id)&&!Object.values(team.assignments).includes(p.id)):
      item.kind==='lineup'?team.order.map(x=>team.players.find(p=>p.id===x.id)).filter(Boolean) as Player[]:
      team.players.filter(p=>Object.entries(team.assignments).some(([pos,id])=>
        Number(id)===Number(p.id) && (item.kind!=='seat' || pos!=='指')))
        // シート紹介のみ、DHを除き守備番号順（投・捕・一・二・三・遊・左・中・右）。
        .sort((a,b)=>item.kind==='seat'
          ? ((['投','捕','一','二','三','遊','左','中','右'].indexOf(
                Object.keys(team.assignments).find(pos=>Number(team.assignments[pos])===Number(a.id))||'') + 11)%11)
            - ((['投','捕','一','二','三','遊','左','中','右'].indexOf(
                Object.keys(team.assignments).find(pos=>Number(team.assignments[pos])===Number(b.id))||'') + 11)%11)
          : 0);
    if(hasPlayer && players.length){
      const firstToken=template.search(/【(?:選手名|選手名（苗字）|選手名（フルネーム）|選手敬称|打順|守備位置|背番号)】/);
      const lineStart=template.lastIndexOf('\n',firstToken)+1;
      // 選手名を含む1行だけを繰り返す。後続の審判紹介などは繰り返さない。
      const lineEndIndex=template.indexOf('\n',firstToken);
      const lineEnd=lineEndIndex===-1?template.length:lineEndIndex;
      const head=template.slice(0,lineStart);
      const row=template.slice(lineStart,lineEnd).replace(/\r$/, '');
      const tail=template.slice(lineEndIndex===-1?template.length:lineEndIndex+1);
      const rows=players.map((p,i)=>{const seatPosition=item.kind==='seat'?getPos(team,p.id):'';const chosenRow=item.kind==='seat'&&seg.pitcherSeparate&&seatPosition==='ピッチャー'?(seg.pitcherText||row):row;const orderIndex=team.order.findIndex(x=>x.id===p.id);return replaceTokens(chosenRow,{...values,'選手名':playerName(p),'選手名（苗字）':playerSurname(p),'選手名（フルネーム）':playerName(p),'選手敬称':p.isFemale?'さん':'くん','打順':String(orderIndex>=0?orderIndex+1:i+1),'守備位置':getPos(team,p.id),'背番号':String(p.number??'')})});
      return replaceTokens(head,values)+rows.join('\n')+(lineEndIndex===-1?'':'\n'+replaceTokens(tail,values));
    }
  }
  if(item.kind==='umpires'&&hasLegacyUmpire&&Array.isArray(match.umpires)&&match.umpires.length){
   const pos=template.search(/【(?:審判名|審判役割)】/);const lineStart=template.lastIndexOf('\n',pos)+1;
   return replaceTokens(template.slice(0,lineStart),basic)+match.umpires.map((u:any)=>replaceTokens(template.slice(lineStart),{...basic,'審判名':ruby(String(u.name||''),String(u.furigana||'')),'審判役割':String(u.role||'')})).join('\n');
  }
  return replaceTokens(template,values);
 };
 const context=(item:PreGameItem)=>({team:side,announcementMode:match.announcementMode==='single'?'single':'normal',matchNo:Number(match.matchNumber)||undefined,firstTime:!completed[item.id],hasData:!!current.name});
 // チーム条件は先攻/後攻とベンチ位置を実際の試合設定で照合する。
 // 通常モードでは isHome（自チームの先攻/後攻）を参照し、
 // 1人モードでは battingFirstSide（先攻のベンチ側）を参照する。
 const firstBaseIsTop=match.announcementMode==='single'
  ? match.battingFirstSide!=='third'
  : match.battingFirstSide==='third'?false:match.battingFirstSide==='first'?true:!match.isHome;
 const matchesTeam=(selected:'any'|'top'|'bottom'|'firstBase'|'thirdBase')=>{
  switch(selected){
   case 'top':return side==='top';
   case 'bottom':return side==='bottom';
   case 'firstBase':return side===(firstBaseIsTop?'top':'bottom');
   case 'thirdBase':return side===(firstBaseIsTop?'bottom':'top');
   default:return true;
  }
 };
 // 1人アナウンスではチーム指定を表示フィルタに使わず、チェックONをすべて表示する。
 // 通常モードでは従来どおり選択したチームに一致する項目のみ表示する。
 const topLineup=items.find(x=>x.kind==='lineup'&&x.target==='top'&&x.enabled&&x.announceDuringKnock);
 const bottomLineup=items.find(x=>x.kind==='lineup'&&x.target==='bottom'&&x.enabled);
 const knockLineupEnabled=!!topLineup;
 const filtered=items.filter(item=>
  !(knockLineupEnabled && item.kind==='lineup' && (item.target==='top' || (match.announcementMode==='single' && item.target==='bottom'))) &&
  item.enabled && (!seatTopModal || item.kind==='seat') &&
  // シート紹介は後攻チームが守る1回表のみ試合前に表示する。
  // 先攻用（1回裏）は1回表終了後の seatTopModal 専用。
  (item.kind!=='seat' || seatTopModal || side==='bottom') && (
   match.announcementMode==='single' || item.kind==='seat' ||
   matchesTeam(item.condition?.team??item.target??'any')
  )
 );
 const stopAudio=()=>{session.current++;stop();setPlaying('')};
 const play=async(item:PreGameItem,seg:PreGameSegment,html:string)=>{
  stopAudio();const n=++session.current;setPlaying(seg.id);
  try{await speak(speakingFromHtml(html));if(n===session.current)setCompleted(prev=>({...prev,[item.id]:(prev[item.id]||0)+1}));}catch(e){console.error(e)}finally{if(n===session.current)setPlaying('')}
 };

 // 1回表終了時に呼び出す先攻シート紹介専用モーダル。
 // 試合前の一覧とは独立し、保存済みの先攻用文章だけを使用する。
 if (seatTopModal) {
  const item=items.find(x=>x.enabled&&x.kind==='seat');
  const segment=item?.segments.find(x=>x.seatSide==='top');
  const html=item&&segment?buildSegment(item,segment):'';
  const missing=[...html.matchAll(/【([^】]+)】/g)].map(x=>x[1]);
  return <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label="シート紹介（先攻用）">
   <div className="w-full max-w-2xl max-h-[95dvh] overflow-y-auto rounded-2xl bg-slate-900 text-white shadow-2xl p-4 space-y-4">
    <div className="flex justify-between items-center gap-3"><h2 className="font-extrabold text-xl">🎤 シート紹介（先攻用・1回裏）</h2><button aria-label="閉じる" onClick={()=>{stopAudio();onBack()}} className="rounded-full bg-white/20 px-4 py-2">×</button></div>
    {!ready&&<p>読み込み中...</p>}
    {ready&&(!item||!segment)&&<p className="rounded-xl bg-amber-100 text-amber-950 p-3">先攻用シート紹介が設定されていません。</p>}
    {item&&segment&&<>
     {!!(segment.timing?.note ?? item.timing?.note)?.trim()&&<div className="rounded-xl bg-amber-100 text-amber-950 p-3 whitespace-pre-wrap">⚠️ {segment.timing?.note ?? item.timing?.note}</div>}
     <div className="rounded-xl border border-rose-400 bg-rose-100 text-rose-800 p-3 space-y-3">
      <div className="font-semibold leading-9 whitespace-pre-wrap break-words" dangerouslySetInnerHTML={{__html:html.replace(/\n/g,'<br/>')}}/>
      {!!missing.length&&<p className="text-sm">未設定の差込項目：{[...new Set(missing)].join('、')}</p>}
      <div className="grid grid-cols-2 gap-2"><button disabled={!!missing.length||!html.trim()} onClick={()=>void play(item,segment,html)} className="rounded-xl bg-blue-600 text-white py-3 font-bold disabled:opacity-50">🎤 読み上げ</button><button onClick={stopAudio} className="rounded-xl bg-red-600 text-white py-3 font-bold">停止</button></div>
     </div>
    </>}
    <button onClick={()=>{stopAudio();onBack()}} className="w-full rounded-xl bg-emerald-600 py-4 font-bold">閉じる・試合へ戻る</button>
   </div>
  </div>;
 }

 return <div className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-3 sm:px-6 py-5 pb-24"><main className="max-w-3xl mx-auto space-y-4">
  <header><h1 className="text-2xl sm:text-3xl font-extrabold text-center">🎤 試合前アナウンス</h1><p className="text-center text-sky-200 text-sm mt-2">カスタマイズ：{profileName}</p></header>
  {match.announcementMode==='single' ? (
   <div className="rounded-2xl bg-white/10 border border-sky-300/20 p-3 text-center font-bold space-y-1">
    <div>先攻：{top.name||'未設定'}</div>
    <div>後攻：{bottom.name||'未設定'}</div>
   </div>
  ) : (
   <div className="rounded-2xl bg-white/10 border border-sky-300/20 p-3 text-center font-bold">自チーム：{side==='top'?'先攻':'後攻'} {current.name||'未設定'}</div>
  )}
  {!ready&&<p>試合情報を読み込み中...</p>}
  {ready&&filtered.length===0&&<p className="rounded-xl bg-white/10 p-4">チェックされた進行項目がありません。カスタマイズ設定で表示する項目にチェックを入れて保存してください。</p>}
  {detailId ? (()=>{
   const currentItem=items.find(x=>x.id===detailId && x.enabled);
   if(!currentItem)return <button onClick={()=>setDetailId(null)}>← 一覧に戻る</button>;
   const isKnock=currentItem.kind==='sheetKnock';const isWarm=currentItem.kind==='warmup';const isTriple=isKnock||isWarm;
   // チェック済みの進行項目は、項目名や旧チーム条件にかかわらず読み上げ文章も表示。
   const relatedSegments=currentItem.kind==='seat'?currentItem.segments.filter(seg=>(seg.seatSide??'bottom')===(seatTopModal?'top':'bottom')):currentItem.segments;
   const parts=isTriple?(isKnock?(['prepare','start','notice','end'] as const):(['start','notice','end'] as const)).map(phase=>({phase,segments:relatedSegments.filter(s=>(s.phase||'start')===phase)})):[];
   return <section className="space-y-4">
    <button className="w-full rounded-xl bg-white/15 border border-white/20 p-3 text-left font-bold" onClick={()=>{stopAudio();setDetailId(returnToKnockId);setReturnToKnockId(null)}}>{returnToKnockId?'← シートノック画面へ戻る':'← 試合前アナウンス一覧に戻る'}</button>
    <h2 className="text-2xl font-extrabold text-center">{currentItem.title}</h2>
    {currentItem.kind!=='sheetKnock'&&currentItem.kind!=='seat'&&currentItem.timing?.note?.trim()&&<div className="rounded-xl border border-amber-300 bg-amber-100 px-3 py-3 text-amber-950"><div className="whitespace-pre-wrap">⚠️ {currentItem.timing.note}</div></div>}
    {relatedSegments.some(seg=>seg.text.includes('【開始予定時刻】'))&&<div className="rounded-xl border border-sky-300/40 bg-slate-900/55 p-3 space-y-2">
      <label htmlFor={`scheduled-start-${currentItem.id}`} className="block text-sm font-bold">🕒 開始予定時刻</label>
      <input id={`scheduled-start-${currentItem.id}`} type="time" step={60}
        value={startClocks[currentItem.id]||normalizeClockInput(match.startTime||match.scheduledStartTime)}
        onChange={e=>changeStartClock(currentItem.id,e.target.value)}
        className="block w-full min-h-12 rounded-xl border border-white/20 bg-slate-700 px-4 text-lg font-bold text-white [color-scheme:dark]"/>
      <p className="text-xs text-white/70">入力した時刻が、この項目のアナウンスに自動反映されます。入力値は端末に保存されます。</p>
    </div>}
    {isKnock&&renderKnockTimer(currentItem)}
    {isWarm&&renderWarmTimer(currentItem)}
    {(isTriple?parts:currentItem.kind==='seat'?relatedSegments.map(s=>({phase:s.seatSide||'bottom',segments:[s]})):[{phase:'other',segments:relatedSegments}]).map(block=><div key={block.phase} className="space-y-3">
      {isKnock&&block.phase==='notice'&&currentItem.target==='top'&&topLineup&&<div className="rounded-2xl border border-sky-400/60 bg-slate-700/80 p-4 space-y-3">
       <h3 className="font-extrabold">🎤 スタメン発表</h3>
       <p className="text-sm">タイマーはスタメン発表中も進みます。読み終わったら「シートノック画面へ戻る」を押してください。</p>
       <button type="button" className="w-full rounded-xl bg-blue-600 py-3 font-bold" onClick={()=>{stopAudio();setReturnToKnockId(currentItem.id);setDetailId(topLineup.id)}}>先攻チームのスタメン発表画面を開く</button>
       {match.announcementMode==='single' ? (bottomLineup ?
        <button type="button" className="w-full rounded-xl bg-blue-600 py-3 font-bold" onClick={()=>{stopAudio();setReturnToKnockId(currentItem.id);setDetailId(bottomLineup.id)}}>後攻チームのスタメン発表画面を開く</button> :
        <div className="rounded-xl bg-amber-100 text-amber-950 py-3 text-center font-bold">後攻チームのスタメン発表は未設定です</div>) :
        <div className="rounded-xl bg-amber-100 text-amber-950 py-3 text-center font-bold">後攻チームのスタメン発表を待つ</div>}
      </div>}
      {currentItem.kind==='seat'&&<h3 className="rounded-xl bg-sky-900/60 px-4 py-3 font-extrabold">{(block.segments[0]?.seatSide??'bottom')==='top'?'先攻用（1回裏）':'後攻用（1回表）'}</h3>}
      {isTriple&&<h3 className="rounded-xl bg-sky-900/60 px-4 py-3 font-extrabold">{block.phase==='prepare'?'① 準備アナウンス':block.phase==='start'?(isWarm?'① 開始アナウンス':'② 開始アナウンス'):block.phase==='notice'?(isWarm?'② 残り時間アナウンス':'③ 残り時間アナウンス'):(isWarm?'③ 終了アナウンス':'④ 終了アナウンス')}</h3>}
      {block.segments.filter(seg=>seg.text.trim()!==''&&!(isWarm&&seg.phase==='notice'&&(currentItem.timerSettings?.noticeMinutes??2)===0)).map(seg=>{const html=buildSegment(currentItem,seg);const missing=[...html.matchAll(/【([^】]+)】/g)].map(x=>x[1]);return <div key={seg.id} className="rounded-xl border border-rose-400/60 bg-gradient-to-br from-rose-600/50 to-rose-400/25 p-3 space-y-3">
       {(currentItem.kind==='sheetKnock'||currentItem.kind==='seat')&&seg.timing?.note?.trim()&&<div className="rounded-lg border border-amber-300 bg-amber-100 px-3 py-2 text-amber-950 whitespace-pre-wrap">⚠️ {seg.timing.note}</div>}
       <div className="whitespace-pre-line font-semibold leading-9 break-words" dangerouslySetInnerHTML={{__html:html.replace(/\n/g,'<br/>')}}/>
       {!!missing.length&&<p className="text-xs text-amber-200">未設定の差し込み項目：{[...new Set(missing)].join('、')}</p>}
       <div className="grid grid-cols-2 gap-2"><button disabled={!!missing.length||!html.trim()} onClick={()=>void play(currentItem,seg,html)} className="rounded-xl bg-blue-600 py-3 font-bold disabled:opacity-50">🔊 読み上げ</button><button onPointerDown={stopAudio} onClick={stopAudio} className="rounded-xl bg-gray-600 py-3 font-bold">■ 停止</button></div>
      </div>})}
     </div>)}
    <button className="w-full rounded-xl bg-white text-gray-900 py-3 font-bold" onClick={()=>{stopAudio();setDetailId(returnToKnockId);setReturnToKnockId(null)}}>{returnToKnockId?'← シートノック画面へ戻る':'← 一覧に戻る'}</button>
   </section>;
  })() : filtered.map((item,i)=><button key={item.id} type="button" onClick={()=>{stopAudio();setDetailId(item.id)}} className="w-full rounded-2xl bg-slate-700/65 border border-white/15 p-4 flex items-center gap-3 text-left min-h-20 active:scale-[.99]">
    <span className="bg-sky-500 rounded-full w-9 h-9 shrink-0 flex items-center justify-center font-bold">{i+1}</span>
    <span className="flex-1 min-w-0"><span className="font-bold text-base sm:text-lg block">{knockLineupEnabled && item.kind==='sheetKnock' && item.target==='top' ? 'シートノック（先攻）/スタメン発表' : item.title}</span>{item.kind==='seat' ? item.segments.filter(seg=>(seg.seatSide??'bottom')==='bottom' && seg.timing?.note?.trim()).map(seg=><span key={seg.id} className="block mt-1 rounded-lg bg-amber-100 text-amber-950 px-2 py-1 text-sm whitespace-pre-wrap">🕒 {seg.timing.note}</span>) : item.kind==='sheetKnock' ? item.segments.filter(seg=>seg.timing?.note?.trim()).map(seg=><span key={seg.id} className="block mt-1 rounded-lg bg-amber-100 text-amber-950 px-2 py-1 text-sm whitespace-pre-wrap">⚠️ {seg.phase==='notice'?'残り時間':seg.phase==='end'?'終了':seg.phase==='prepare'?'準備':'開始'}：{seg.timing.note}</span>) : item.timing?.note?.trim()&&<span className="block mt-1 rounded-lg bg-amber-100 text-amber-950 px-2 py-1 text-sm whitespace-pre-wrap">🕒 {item.timing.note}</span>}</span>
    <span className="text-white/70 text-xl">›</span>
   </button>)}
  <button onClick={()=>{stopAudio();onBack()}} className="w-full rounded-2xl bg-white text-slate-900 py-4 font-bold">← 試合開始画面に戻る</button>
 </main></div>
}
