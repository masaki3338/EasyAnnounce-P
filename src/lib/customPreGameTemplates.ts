/** 試合前ビルダー専用定義。表示制御／保存は custom リーグモード限定。 */
export type PreGameKind='notice'|'startTime'|'call'|'warmup'|'sheetKnock'|'lineup'|'umpires'|'defense'|'bench'|'ground'|'gather'|'greeting'|'nationalFlag'|'firstPitch'|'seat'|'custom';
export type PreGameCondition={team:'any'|'top'|'bottom'|'firstBase'|'thirdBase';announcementMode:'any'|'single'|'normal';matchNo:string;repeat:'any'|'first'|'again';requiresData:boolean};
export type PreGameTiming={type:'manual'|'beforeStart'|'afterPrevious'|'event';minutes:number;event:string;note:string};
export type PreGameSegment={id:string;text:string;condition:PreGameCondition;timing:PreGameTiming;phase?:'prepare'|'start'|'notice'|'end';seatSide?:'top'|'bottom';pitcherSeparate?:boolean;pitcherText?:string};
export type PreGameItem={id:string;title:string;kind:PreGameKind;enabled:boolean;target:'any'|'top'|'bottom';condition:PreGameCondition;timing:PreGameTiming;segments:PreGameSegment[];timerSettings?:{minutes:number;noticeMinutes:number};announceDuringKnock?:boolean};
export const defaultCondition=():PreGameCondition=>({team:'any',announcementMode:'any',matchNo:'',repeat:'any',requiresData:false});
export const defaultTiming=():PreGameTiming=>({type:'manual',minutes:0,event:'',note:''});
const genId=()=>`item-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,9)}`;
export const COMMON_TOKENS=['チーム名','先攻チーム名','後攻チーム名','大会名','試合番号','開始予定時刻','開始時刻','選手名（苗字）','選手名（フルネーム）','投手名(苗字)','投手名(フルネーム)','投手背番号','控え選手名（苗字）','控え選手名（フルネーム）','選手敬称','打順','守備位置','背番号','球審名','1塁審名','2塁審名','3塁審名','審判名','残り時間','ノック時間','回','表裏','1塁側チーム名','3塁側チーム名'];
export const PRE_GAME_CATALOG:{kind:PreGameKind;title:string;text:string;target?:'top'|'bottom'}[]=[
 {kind:'startTime',title:'開始時間の案内',text:'第【試合番号】試合、【先攻チーム名】対【後攻チーム名】の試合開始予定時刻は【開始予定時刻】です。'},
 {kind:'call',title:'関係者呼び出し',text:'関係者の皆様は本部席までお集まりください。'},
 {kind:'warmup',title:'ウォーミングアップ',text:'【チーム名】のウォーミングアップを開始してください。'},
 {kind:'sheetKnock',title:'シートノック（後攻）',text:'後攻、【後攻チーム名】のシートノックを開始してください。',target:'bottom'},
 {kind:'sheetKnock',title:'シートノック（先攻）',text:'先攻、【先攻チーム名】のシートノックを開始してください。',target:'top'},
 {kind:'lineup',title:'スタメン発表（先攻）',text:'先攻、【先攻チーム名】のスターティングメンバーを発表いたします。\n【打順】番、【守備位置】、【選手名（フルネーム）】【選手敬称】、背番号【背番号】。',target:'top'},
 {kind:'lineup',title:'スタメン発表（後攻）',text:'後攻、【後攻チーム名】のスターティングメンバーを発表いたします。\n【打順】番、【守備位置】、【選手名（フルネーム）】【選手敬称】、背番号【背番号】。',target:'bottom'},
 {kind:'ground',title:'グラウンド整備',text:'ただいまからグラウンド整備を行います。しばらくお待ちください。'},
 {kind:'greeting',title:'試合開始挨拶',text:'本日はご来場いただきありがとうございます。まもなく試合を開始いたします。'},
 {kind:'seat',title:'シート紹介',text:'【回】回の【表裏】、【チーム名】の守備位置をご紹介します。【守備位置】、【選手名（フルネーム）】【選手敬称】。'},
 {kind:'custom',title:'自由項目',text:'アナウンス文を入力してください。'}
];
export function fromCatalog(index:number):PreGameItem{
 const c=PRE_GAME_CATALOG[index]||PRE_GAME_CATALOG[PRE_GAME_CATALOG.length-1];
 const segment=(text:string,phase?:'prepare'|'start'|'notice'|'end'):PreGameSegment=>({id:genId(),text,phase,condition:defaultCondition(),timing:defaultTiming()});
 return {id:genId(),title:c.title,kind:c.kind,enabled:true,target:c.target||'any',condition:{...defaultCondition(),team:c.target||'any'},timing:defaultTiming(),timerSettings:c.kind==='warmup'?{minutes:10,noticeMinutes:2}:undefined,segments:c.kind==='seat'?[{...segment(c.text),seatSide:'bottom'},{...segment(c.text),seatSide:'top'}]:c.kind==='sheetKnock'?[segment('','prepare'),segment(c.text,'start'),segment('ノック時間、残り【残り時間】分です。','notice'),segment('ノックを終了してください。','end')]:c.kind==='warmup'?[segment(c.text,'start'),segment('ウォーミングアップ、残り【残り分数】分です。','notice'),segment('ウォーミングアップを終了してください。','end')]:[segment(c.text)]};
}
export const REMOVED_PRE_GAME_TITLES = ["開始時間変更", "チーム呼び出し", "審判員紹介", "守備紹介", "控え紹介", "整列案内", "開始時刻放送", "国旗掲揚", "始球式"];
const knockPhase=(title:string):'prepare'|'start'|'notice'|'end'=>title.includes('残り')?'notice':title.includes('終了')?'end':'start';
export const initialPreGameItems=()=>{
 const all=PRE_GAME_CATALOG.slice(0,-1).map((_,i)=>fromCatalog(i));
 return ensureKnockPrepare(consolidateWarmupItems(consolidateKnockItems(all)));
};
// 従来の「開始・準備」は「開始」に引き継ぎ、「準備」を独立した保存欄として追加。
// 読み込み時のみ補完し、既存の文章やメモを消さない。
function ensureKnockPrepare(items:PreGameItem[]):PreGameItem[]{
 return items.map(item=>{
  if(item.kind!=='sheetKnock'||item.segments.some(seg=>seg.phase==='prepare'))return item;
  const base=item.segments.find(seg=>seg.phase==='start')||item.segments[0];
  const prepare:PreGameSegment={id:genId(),text:'',phase:'prepare',condition:{...defaultCondition(),...(base?.condition||{})},timing:defaultTiming()};
  return {...item,segments:[prepare,...item.segments]};
 });
}
// 旧保存データのシートノック三分割を一画面に統合。旧文言は維持する。
export function consolidateKnockItems(all:PreGameItem[]):PreGameItem[]{
 const withoutRemoved=all.filter(x=>!REMOVED_PRE_GAME_TITLES.includes(x.title));
 const output:PreGameItem[]=[];
 const seen=new Set<string>();
 for(const item of withoutRemoved){
  if(item.kind!=='sheetKnock'){output.push(item);continue;}
  const team=item.target==='top'?'top':item.target==='bottom'?'bottom':'any';
  if(seen.has(team))continue;
  seen.add(team);
  const group=withoutRemoved.filter(x=>x.kind==='sheetKnock'&&x.target===team);
  const segments=group.flatMap(x=>x.segments.map(y=>({...y,id:y.id,phase:y.phase||knockPhase(x.title)} as PreGameSegment & {phase:string})));
  const startItem=group.find(x=>x.segments.some(s=>(s.phase||knockPhase(x.title))==='start'))||item;
  segments.sort((a,b)=>({prepare:0,start:1,notice:2,end:3}[a.phase]-{prepare:0,start:1,notice:2,end:3}[b.phase]));
  output.push({...item, title: startItem.title || (team==='top'?'シートノック（先攻）':team==='bottom'?'シートノック（後攻）':'シートノック'), segments});
 }
 return output;
}

// 旧版の開始・終了2項目をまとめ、入力済み文章をできる限り維持する。
export function consolidateWarmupItems(all:PreGameItem[]):PreGameItem[]{
 const output:PreGameItem[]=[];const seen=new Set<string>();
 for(const item of all){
  if(item.kind!=='warmup'){output.push(item);continue;}
  const team=item.condition?.team??item.target??'any';
  if(seen.has(team))continue;
  seen.add(team);
  const group=all.filter(x=>x.kind==='warmup'&&(x.condition?.team??x.target??'any')===team);
  const defaults=fromCatalog(PRE_GAME_CATALOG.findIndex(c=>c.kind==='warmup'));
  const getPhase=(x:PreGameItem,y:PreGameSegment):'start'|'notice'|'end'=>y.phase||(x.title.includes('終了')?'end':x.title.includes('残り')?'notice':'start');
  const segments=(['start','notice','end'] as const).map(phase=>{
   const found=group.flatMap(x=>x.segments.map(y=>({x,y}))).find(v=>getPhase(v.x,v.y)===phase);
   return found?{...found.y,phase}:{...defaults.segments.find(y=>y.phase===phase)!,id:genId()};
  });
  output.push({...item,title:item.title || 'ウォーミングアップ',segments,timerSettings:item.timerSettings||{minutes:10,noticeMinutes:2}});
 }
 return output;
}

const key=(profileId:string)=>'easyannounce:custom:preGame:v1:'+profileId;
// シートノックの旧共通メモは「開始・準備」にのみ移行する。
// 既に各フェーズに保存されたメモは上書きしない。
function migrateKnockTimingNotes(items:PreGameItem[]):PreGameItem[]{
 return items.map(item=>{
  if(item.kind!=='sheetKnock'||!item.timing?.note) return item;
  const legacyNote=item.timing.note;
  return {...item,timing:{...item.timing,note:''},segments:item.segments.map((seg,index)=>
   (seg.phase==='start'||(!seg.phase&&index===0)) && !seg.timing?.note
    ? {...seg,timing:{...defaultTiming(),...seg.timing,note:legacyNote}}
    : seg
  )};
 });
}
export function loadPreGameItems(profileId:string):PreGameItem[]{if(typeof window==='undefined')return initialPreGameItems();try{const raw=localStorage.getItem(key(profileId));if(!raw)return initialPreGameItems();const parsed=JSON.parse(raw);return Array.isArray(parsed)?ensureKnockPrepare(migrateKnockTimingNotes(normalizeSingleTextItems(consolidateWarmupItems(consolidateKnockItems(parsed))))):initialPreGameItems();}catch{return initialPreGameItems();}}
export function savePreGameItems(profileId:string,items:PreGameItem[]){localStorage.setItem(key(profileId),JSON.stringify(ensureKnockPrepare(migrateKnockTimingNotes(normalizeSingleTextItems(items)))));}

export type PreGamePreviewPlayer={battingOrder:string;position:string;lastName:string;fullName:string;honorific:string;number:string;fieldingOrder:number};

const PREVIEW_STARTERS:PreGamePreviewPlayer[]=[
 {battingOrder:'1',position:'ピッチャー',lastName:'青空',fullName:'青空 太郎',honorific:'さん',number:'1',fieldingOrder:1},
 {battingOrder:'2',position:'キャッチャー',lastName:'若葉',fullName:'若葉 次郎',honorific:'くん',number:'3',fieldingOrder:2},
 {battingOrder:'3',position:'ファースト',lastName:'星野',fullName:'星野 三郎',honorific:'くん',number:'5',fieldingOrder:3},
 {battingOrder:'4',position:'セカンド',lastName:'春風',fullName:'春風 四郎',honorific:'くん',number:'4',fieldingOrder:4},
 {battingOrder:'5',position:'サード',lastName:'夏川',fullName:'夏川 五郎',honorific:'くん',number:'6',fieldingOrder:5},
 {battingOrder:'6',position:'ショート',lastName:'秋月',fullName:'秋月 六郎',honorific:'くん',number:'7',fieldingOrder:6},
 {battingOrder:'7',position:'レフト',lastName:'冬野',fullName:'冬野 七郎',honorific:'くん',number:'8',fieldingOrder:7},
 {battingOrder:'8',position:'センター',lastName:'朝日',fullName:'朝日 八郎',honorific:'くん',number:'9',fieldingOrder:8},
 {battingOrder:'9',position:'ライト',lastName:'夕凪',fullName:'夕凪 九郎',honorific:'くん',number:'10',fieldingOrder:9},
];

const PREVIEW_BENCH:PreGamePreviewPlayer[]=[
 {battingOrder:'',position:'',lastName:'花咲',fullName:'花咲 十郎',honorific:'くん',number:'12',fieldingOrder:0},
 {battingOrder:'',position:'',lastName:'水音',fullName:'水音 花子',honorific:'さん',number:'14',fieldingOrder:0},
 {battingOrder:'',position:'',lastName:'虹原',fullName:'虹原 大和',honorific:'くん',number:'16',fieldingOrder:0},
];

function replaceTokensByMap(text:string, values:Record<string,string>){
 return text.replace(/【([^】]+)】/g,(_,k)=>Object.prototype.hasOwnProperty.call(values,k)?values[k]:`【${k}】`);
}
function hasAny(text:string,tokens:string[]){return tokens.some(t=>text.includes(`【${t}】`));}
function basePreviewMap(values:Record<string,string>){return {...values};}
function playerPreviewMap(player:PreGamePreviewPlayer, values:Record<string,string>){
 return {
  ...basePreviewMap(values),
  '選手名': player.fullName,
  '選手名（苗字）': player.lastName,
  '選手名（フルネーム）': player.fullName,
  '控え選手名（苗字）': player.lastName,
  '控え選手名（フルネーム）': player.fullName,
  '選手敬称': player.honorific,
  '打順': player.battingOrder,
  '守備位置': player.position,
  '背番号': player.number,
 }
}

export function renderPreGamePreview(item:PreGameItem, segment:PreGameSegment, values:Record<string,string>){
 const text=segment.text||'';
 const lines=text.split(/\r?\n/);
 const starterTokens=['選手名（苗字）','選手名（フルネーム）','選手名','打順','守備位置'];
 const benchTokens=['控え選手名（苗字）','控え選手名（フルネーム）'];
 const starterList=item.kind==='seat'?[...PREVIEW_STARTERS].sort((a,b)=>a.fieldingOrder-b.fieldingOrder):PREVIEW_STARTERS;

 // シート紹介は同じ行の導入文だけ1回表示し、選手行のみ9人分展開する。
 // 改行より後の文章（「以上です。」など）は繰り返さない。
 if(item.kind==='seat'){
  const firstLine=lines[0]||'';
  const firstStarterTokenPos=Math.min(...starterTokens.map(t=>{const idx=firstLine.indexOf(`【${t}】`);return idx>=0?idx:Infinity;}));
  if(firstStarterTokenPos!==Infinity){
   const intro=firstLine.slice(0,firstStarterTokenPos);
   const playerLine=firstLine.slice(firstStarterTokenPos);
   const out:string[]=[];
   if(intro.trim()) out.push(replaceTokensByMap(intro.trim(),basePreviewMap(values)));
   for(const p of starterList)out.push(replaceTokensByMap(item.kind==='seat' && segment.pitcherSeparate && p.position==='ピッチャー' ? (segment.pitcherText || playerLine).trim() : playerLine.trim(),playerPreviewMap(p,values)));
   for(const line of lines.slice(1))out.push(replaceTokensByMap(line,basePreviewMap(values)));
   return out.join('\n');
  }
 }

 const out:string[]=[];
 for(const line of lines){
  const trimmed=line.trim();
  if(!trimmed){out.push('');continue;}
  if(hasAny(trimmed, benchTokens)){
   for(const p of PREVIEW_BENCH){
    out.push(replaceTokensByMap(trimmed, playerPreviewMap(p, values)));
   }
   continue;
  }
  if(hasAny(trimmed, starterTokens)){
   for(const p of starterList){
    out.push(replaceTokensByMap(item.kind==='seat' && segment.pitcherSeparate && p.position==='ピッチャー' ? (segment.pitcherText || trimmed) : trimmed, playerPreviewMap(p, values)));
   }
   continue;
  }
  out.push(replaceTokensByMap(trimmed, basePreviewMap(values)));
 }
 return out.join('\n');
}

export function renderPreGameText(text:string,values:Record<string,string>){return replaceTokensByMap(text,values);}
export function validatePreGameText(text:string){return [...text.matchAll(/【([^】]+)】/g)].map(x=>x[1]).filter(k=>!COMMON_TOKENS.includes(k)&&k!=='選手名'&&!['監督名','審判役割','残り分数'].includes(k));}
// UIから廃止した条件（アナウンスモード・試合番号・実行回数）は、旧保存データに残っていても評価しない。
export function matchesPreGameCondition(c:PreGameCondition,s:{team?:string;announcementMode?:string;matchNo?:number;firstTime?:boolean;hasData?:boolean}){
 return c.team==='any'||c.team===s.team;
}

/** シート紹介は先攻・後攻の二文を維持し、それ以外の通常項目は一文。 */
export function normalizeSingleTextItems(items:PreGameItem[]):PreGameItem[]{
 return items.map(item=>{
  const condition={...defaultCondition(),...item.condition,team:item.condition?.team??item.target??'any'};
  if(item.kind==='seat'){
   const original=item.segments||[];
   const fallback=original[0]||{id:genId(),text:'',condition:defaultCondition(),timing:defaultTiming()};
   const bottom=original.find(s=>s.seatSide==='bottom')||original.find(s=>!s.seatSide)||fallback;
   const top=original.find(s=>s.seatSide==='top')||original.find(s=>s!==bottom)||{...bottom,id:genId()};
   return {...item,condition,segments:[{...bottom,id:bottom.id||genId(),seatSide:'bottom' as const},{...top,id:top.id && top.id!==bottom.id?top.id:genId(),seatSide:'top' as const}]};
  }
  if(item.kind==='sheetKnock'||item.kind==='warmup')return {...item,condition};
  return {...item,condition,segments:item.segments.length?[item.segments[0]]:[{id:genId(),text:'',condition:defaultCondition(),timing:defaultTiming()}]};
 });
}
