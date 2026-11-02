/** カスタマイズモード専用。既存リーグの保存キー／画面は変更しない。 */
export type AnnounceCategory = 'offense' | 'defense' | 'other';
export type TemplatePart = { id: string; label: string; text: string; tokens: string[] };
export type AnnounceItem = { id: string; label: string; category: AnnounceCategory; parts: TemplatePart[] };
const p = (id:string,label:string,text:string,tokens:string[]=[]):TemplatePart=>({id,label,text,tokens});
export const RAIN_TOKENS=['先攻チーム名','後攻チーム名','大会名','試合番号'];
export const CUSTOM_IN_GAME_ITEMS:AnnounceItem[] = [
 {id:'startTime',label:'試合開始時刻',category:'offense',parts:[p('main','読み上げ文章','この試合の 試合開始時刻は 【開始時刻】です。',['開始時刻','先攻チーム名','後攻チーム名'])]},
 {id:'batter',label:'打者紹介',category:'offense',parts:[p('leadoff','回の先頭打者','【回】回の【表裏】、【チーム名】の攻撃は、',['回','表裏','打順','守備位置','選手名（苗字）','選手名（フルネーム）','敬称','背番号','チーム名','回','表裏']),p('first','初回','【打順】番、【守備位置】、【選手名（苗字）】【敬称】。背番号【背番号】。',['打順','守備位置','選手名（苗字）','選手名（フルネーム）','敬称','背番号','チーム名','回','表裏']),p('later','2回目以降','【打順】番、【守備位置】、【選手名（苗字）】【敬称】。',['打順','守備位置','選手名（苗字）','選手名（フルネーム）','敬称','背番号','チーム名','回','表裏'])]},
 {id:'score',label:'得点',category:'offense',parts:[p('scored','得点あり','この回の得点は、【得点】です。',['チーム名','得点','回','表裏']),p('noScore','得点なし','この回の得点は、無得点です。',['チーム名','得点','回','表裏'])]},
 {id:'foul',label:'ファウルボールの注意',category:'offense',parts:[p('main','注意放送','ファウルボールの行方には、十分ご注意ください。')]},
 {id:'pinchHitter',label:'代打',category:'offense',parts:[p('leadoff','回の先頭打者','【回】回の【表裏】、先頭打者に代打を送ります。【交代前選手名（苗字）】【交代前敬称】に代わりまして、【交代後選手名（苗字）】【交代後敬称】。',['回','表裏','打順','交代前選手名（苗字）','交代前選手名（フルネーム）','交代前敬称','交代後選手名（苗字）','交代後選手名（フルネーム）','交代後敬称','交代後背番号','チーム名','回','表裏']),p('main','代打の案内','【回】回の【表裏】、【交代前選手名（苗字）】【交代前敬称】に代わりまして、\n【交代後選手名（苗字）】【交代後敬称】。',['打順','交代前選手名（苗字）','交代前選手名（フルネーム）','交代前敬称','交代後選手名（苗字）','交代後選手名（フルネーム）','交代後敬称','交代後背番号','チーム名','回','表裏'])]},
 {id:'pinchRunner',label:'代走',category:'offense',parts:[p('main','代走の案内','【交代前選手名（苗字）】【交代前敬称】に代わりまして、代走、【交代後選手名（苗字）】【交代後敬称】、背番号【交代後背番号】。',['交代前選手名（苗字）','交代前選手名（フルネーム）','交代前敬称','交代後選手名（苗字）','交代後選手名（フルネーム）','交代後敬称','交代後背番号','チーム名','塁(ファースト/セカンド/サード)','塁(1塁/2塁/3塁)'])]},
 {id:'courtesyRunner',label:'臨時代走',category:'offense',parts:[p('main','臨時代走の案内','臨時代走、【交代後選手名（苗字）】【交代後敬称】、背番号【交代後背番号】。',['交代後選手名（苗字）','交代後選手名（フルネーム）','交代後敬称','交代後背番号','交代前選手名（苗字）','交代前選手名（フルネーム）','交代前敬称','チーム名','塁(ファースト/セカンド/サード)','塁(1塁/2塁/3塁)'])]},
 {id:'pitchCount',label:'投球数の放送',category:'defense',parts:[
 p('inningEnd','守備回終了時（合計投球数あり）','ただいまの回、【投手名（苗字）】【敬称】の投球数は【この回の投球数】球、合計【合計投球数】球です。',['投手名（苗字）','投手名（フルネーム）','敬称','この回の投球数','合計投球数','回','表裏','チーム名']),
 p('inningEndNoTotal','守備回終了時（合計投球数なし）','ただいまの回、【投手名（苗字）】【敬称】の投球数は【この回の投球数】球です。',['投手名（苗字）','投手名（フルネーム）','敬称','この回の投球数','回','表裏','チーム名']),
 p('limitAdvance','投球数・事前お知らせ','【投手名（苗字）】【敬称】の投球数は【合計投球数】球、残り10球です。',['投手名（苗字）','投手名（フルネーム）','敬称','合計投球数','投球上限','チーム名']),
 p('limit','投球数・到達時','【投手名（苗字）】【敬称】の投球数が【投球上限】球に達しました。',['投手名（苗字）','投手名（フルネーム）','敬称','合計投球数','投球上限','チーム名'])
 ]},
 {id:'defenseChange',label:'守備・選手交代',category:'defense',parts:[
 p('introPlayer','① 開始文：選手交代のみ','【チーム名】、選手の交代をお知らせいたします。',['チーム名']),
 p('introPosition','① 開始文：守備変更のみ','【チーム名】、シートの変更をお知らせいたします。',['チーム名']),
 p('introBoth','① 開始文：選手交代＋守備変更','【チーム名】、選手の交代並びにシートの変更をお知らせいたします。',['チーム名']),
 p('newPlayerSame','② 新しく出場する選手（元の守備）','【交代前・守備位置】 【交代前・選手名（苗字）】 に代わりまして、【交代後・選手名（苗字）】。',['交代前・守備位置','交代前・選手名（苗字）','交代前・選手名（フルネーム）','交代前・敬称','交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','守備位置','交代後・背番号','チーム名','打順']),
 p('newPlayerDifferent','③ 新しく出場する選手（守備位置変更）','【交代前・守備位置】 【交代前・選手名（苗字）】 に代わりまして、【交代後・選手名（苗字）】が入り【守備位置】。',['交代前・守備位置','交代前・選手名（苗字）','交代前・選手名（フルネーム）','交代前・敬称','交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','守備位置','交代後・背番号','チーム名','打順']),
 p('positionMove','③ 既存選手の守備移動','【移動前・守備位置】の【移動・選手名（苗字）】【移動・敬称】が【移動後・守備位置】に',['移動前・守備位置','移動・選手名（苗字）','移動・選手名（フルネーム）','移動・敬称','移動後・守備位置','チーム名','打順']),
 // 代打・代走から守備へ入る場面は、同じ選手が守備に残るか別選手へ交代するかで分ける。
 p('pinchHitStay','④ 代打からの守備交代：そのまま入る','先ほど代打いたしました【交代後・選手名（苗字）】【交代後・敬称】がそのまま【交代後・守備位置】に',['交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','交代後・背番号','チーム名','打順']),
 p('pinchHitReplace','⑤ 代打からの守備交代：選手交代','先ほど代打いたしました【交代前・選手名（苗字）】【交代前・敬称】に代わりまして、【交代後・選手名（苗字）】【交代後・敬称】が【交代後・守備位置】に',['交代前・選手名（苗字）','交代前・選手名（フルネーム）','交代前・敬称','交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','交代後・背番号','チーム名','打順']),
 p('pinchRunStay','⑥ 代走からの守備交代：そのまま入る','先ほど代走いたしました【交代後・選手名（苗字）】【交代後・敬称】がそのまま【交代後・守備位置】に',['交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','交代後・背番号','チーム名','打順']),
 p('pinchRunReplace','⑦ 代走からの守備交代：選手交代','先ほど代走いたしました【交代前・選手名（苗字）】【交代前・敬称】に代わりまして、【交代後・選手名（苗字）】【交代後・敬称】が【交代後・守備位置】に',['交代前・選手名（苗字）','交代前・選手名（フルネーム）','交代前・敬称','交代後・選手名（苗字）','交代後・選手名（フルネーム）','交代後・敬称','交代後・守備位置','交代後・背番号','チーム名','打順']),
 p('middle','⑧ 途中の接続文','入り、'),p('last','⑨ 最後の接続文','入ります。'),
 p('battingIntro','⑩ 打順紹介の開始文','続きまして、変更後の打順をお知らせいたします。'),
 p('battingRowNew','⑪ 打順紹介：新しく入る選手','【打順】番、【守備位置】、【選手名（フルネーム）】【敬称】 背番号【背番号】',['打順','守備位置','選手名（苗字）','選手名（フルネーム）','敬称','背番号','チーム名']),
 p('battingRowExisting','⑫ 打順紹介：既存選手','【打順】番、【守備位置】、【選手名（苗字）】【敬称】',['打順','守備位置','選手名（苗字）','選手名（フルネーム）','敬称','背番号','チーム名']),
 p('outro','⑬ 終了文','以上のように代わります。')
 ]},
 {id:'rainDelay',label:'雨天中断',category:'other',parts:[
 p('start','雨天時の中断','お知らせ致します。\nご覧のような天候状態のため、一時、試合を中断致します。\nしばらくお待ちください。',RAIN_TOKENS),
 p('continue','雨天中断の継続','お知らせ致します。\nご覧のような天候状態のため、ただいま、試合を中断しています。\n今しばらくお待ちください。',RAIN_TOKENS),
 p('cancel','雨天中断後の中止','お知らせ致します。\nご覧のような天候状態のため、試合続行が不可能となりました。\n大会規定により、この試合は、【中止区分】と致します。',[...RAIN_TOKENS,'中止区分','回']),
 p('maintenance','試合再開のグラウンド整備','お待たせしております。ただいまグラウンド整備を行っています。\n整備が済み次第、試合を再開致しますので、今しばらくお待ちください。',RAIN_TOKENS),
 p('resume','試合再開','大変長らくお待たせ致しました。\nただいまより試合を再開します。',RAIN_TOKENS)
 ]},
 {id:'intentionalWalk',label:'申告敬遠',category:'other',parts:[p('main','申告敬遠の案内','申告敬遠により、打者は一塁へ進みます。',['選手名（苗字）','選手名（フルネーム）','敬称','チーム名'])]},
 {id:'gameEnd',label:'試合終了',category:'other',parts:[p('main','試合終了の案内','ただいまをもちまして、【先攻チーム名】対【後攻チーム名】の試合は終了いたしました。',['先攻チーム名','後攻チーム名','先攻得点','後攻得点','勝利チーム名','終了時刻']),p('draw','引き分けの場合','ただいまをもちまして、【先攻チーム名】対【後攻チーム名】の試合は、【先攻得点】対【後攻得点】の引き分けで終了いたしました。',['先攻チーム名','後攻チーム名','先攻得点','後攻得点','勝利チーム名','終了時刻'])]},
 {id:'injuryPause',label:'試合中断（治療）',category:'other',parts:[p('pause','中断時','選手の治療のため、試合を一時中断いたします。'),p('resume','再開時','試合を再開いたします。')]},
 {id:'ground',label:'グラウンド整備',category:'other',parts:[p('start','開始','これよりグラウンド整備を行います。'),p('end','終了','グラウンド整備、有難うございました。')]},
 {id:'water',label:'給水タイム',category:'other',parts:[p('start','開始','これより【給水時間】分間の給水タイムに入ります。',['給水時間']),p('end','終了','給水タイムを終了いたします。')]},
 {id:'tieBreak',label:'タイブレーク',category:'other',parts:[p('main','開始案内','【回（現在）】回より、タイブレーク方式で試合を行います。',['回（現在）','回（前の回）','アウト数','走者情報','チーム名','打者の一人前の選手','打者の一人前の選手敬称','打者の一人前の選手背番号','打者の二人前の選手','打者の二人前の選手敬称','打者の二人前の選手背番号','打者の三人前の選手','打者の三人前の選手敬称','打者の三人前の選手背番号'])]},
 {id:'suspendedGame',label:'継続試合',category:'other',parts:[p('pause','継続試合の案内','本日の試合はここで中断し、継続試合といたします。'),p('resume','継続試合の再開','ただいまより、継続試合を再開いたします。')]},
 {id:'nextGame',label:'次の試合のお知らせ',category:'other',parts:[p('main','お知らせ','本日の第【次の試合番号】試合の両チームは、4回終了後、メンバー交換を行いますので本部席付近にお集まりください。',['次の試合番号'])]},
 {id:'heat',label:'熱中症',category:'other',parts:[p('notice','注意喚起','熱中症予防のため、こまめな水分補給をお願いいたします。'),p('pause','中断案内','熱中症予防のため、試合を一時中断いたします。'),p('resume','再開案内','試合を再開いたします。')]}
];
/** 旧保存データの変数を攻撃画面のみ移行する（守備画面は変更しない）。 */
export function migrateOffenseTokens(itemId:string,text:string):string {
 if(!['batter','pinchHitter','pinchRunner','courtesyRunner','intentionalWalk'].includes(itemId))return text;
 return text.replace(/【(交代前選手名|交代後選手名|選手名)】/g,(_match,name)=>`【${name}（苗字）】`);
}
/** 守備・選手交代の旧差込項目は苗字として引き継ぐ。 */
export function migrateDefenseNameTokens(itemId:string,text:string):string {
 if(itemId!=='defenseChange')return text;
 return text.replace(/【(交代前・選手名|交代後・選手名|移動・選手名|選手名)】/g,(_match,key)=>`【${key}（苗字）】`);
}
/** 旧設定の【投手名】は従来と同じ苗字指定として引き継ぐ。 */
export function migratePitchTokens(itemId:string,text:string):string {
 return itemId==='pitchCount'?text.replace(/【投手名】/g,'【投手名（苗字）】'):text;
}
/** 従来のタイブレーク【回】は現在の回として扱う（既存編集文は保持）。 */
export function migrateTieBreakTokens(itemId:string,text:string):string {
 return itemId==='tieBreak'?text.replace(/【回】/g,'【回（現在）】'):text;
}
export type StartTimeTiming='afterFirstPitch'|'beforeSecondBatter'|'afterTopFirst'|'afterBottomFirst';
export const START_TIME_TIMINGS:{value:StartTimeTiming;label:string}[]=[
 {value:'afterFirstPitch',label:'1球投球後'},
 {value:'beforeSecondBatter',label:'2人目の打者の前'},
 {value:'afterTopFirst',label:'1回表終了後'},
 {value:'afterBottomFirst',label:'1回裏終了後'}
];
export type CustomInGameTexts = Record<string,Record<string,string>>;
/** 画面に表示するかどうか。古い保存データではすべて有効（互換性維持）。 */
export const customItemEnabled=(texts:CustomInGameTexts,itemId:string)=>['batter','foul','pinchHitter','pinchRunner','courtesyRunner'].includes(itemId)||texts[itemId]?.enabled!=='false';
export const customPitchPartEnabled=(texts:CustomInGameTexts,partId:string)=>texts.pitchCount?.[`enabled:${partId}`]!=='false';
export type CustomInningSide='top'|'bottom';
export const customTiming=(texts:CustomInGameTexts,itemId:'ground'|'nextGame')=>({
 inning:Math.min(9,Math.max(1,Number(texts[itemId]?.triggerInning|| (itemId==='ground'?5:4))||1)),
 side:texts[itemId]?.triggerSide==='top'?'top' as CustomInningSide:'bottom' as CustomInningSide
});
export const customTimedItemDue=(texts:CustomInGameTexts,itemId:'ground'|'nextGame',inning:number,side:CustomInningSide)=>{
 const setting=customTiming(texts,itemId);
 return customItemEnabled(texts,itemId)&&setting.inning===inning&&setting.side===side;
};
export const customNextGameVars=(currentMatchNumber:number)=>({'次の試合番号':String(Math.max(1,currentMatchNumber+1))});
export const initialCustomInGameTexts=():CustomInGameTexts=>Object.fromEntries(CUSTOM_IN_GAME_ITEMS.map(x=>[x.id,Object.fromEntries([...x.parts.map(t=>[t.id,t.text]),...(x.id==='startTime'?[['timing','afterFirstPitch']]:[]),...(x.id==='score'?[['noScoreEnabled','false']]:[]),...(x.id==='gameEnd'?[['higherScoreFirst','false']]:[]),...(x.id==='ground'?[['triggerInning','5'],['triggerSide','bottom']]:[]),...(x.id==='nextGame'?[['triggerInning','4'],['triggerSide','bottom']]:[])] )]));
const storageKey = (profileId:string) => `easyannounce:custom:inGame:v1:${profileId}`;
export function loadCustomInGameTexts(profileId:string):CustomInGameTexts {
 const base=initialCustomInGameTexts();
 if(typeof window==='undefined')return base;
 try{const raw=localStorage.getItem(storageKey(profileId));if(!raw)return base;const obj=JSON.parse(raw);if(!obj||typeof obj!=='object')return base;
  // 旧『打順紹介（選手ごと）』は既存選手の文章へ引き継ぐ。
  if(typeof obj?.defenseChange?.battingRow==='string' && typeof obj?.defenseChange?.battingRowExisting!=='string') {
   base.defenseChange.battingRowExisting=migrateDefenseNameTokens('defenseChange',obj.defenseChange.battingRow);
  }
  // 旧『新しく出場する選手』設定は元の守備用へ継承する。
  if(typeof obj?.defenseChange?.newPlayer==='string' && typeof obj?.defenseChange?.newPlayerSame!=='string') {
   base.defenseChange.newPlayerSame=migrateDefenseNameTokens('defenseChange',obj.defenseChange.newPlayer);
  }
  for(const def of CUSTOM_IN_GAME_ITEMS){for(const part of def.parts){const t=obj?.[def.id]?.[part.id];if(typeof t==='string')base[def.id][part.id]= def.id==='score'&&part.id==='scored'&&t==='【チーム名】の得点は、【得点】点です。'?'この回の得点は、【得点】です。':def.id==='score'&&part.id==='noScore'&&t==='【チーム名】の得点は、無得点です。'?'この回の得点は、無得点です。':def.id==='startTime'&&part.id==='main'&&t==='この試合の 試合開始時刻は、【開始時刻】です。'?'この試合の 試合開始時刻は 【開始時刻】です。':migrateDefenseNameTokens(def.id,migrateTieBreakTokens(def.id,migratePitchTokens(def.id,migrateOffenseTokens(def.id,t))));} if(def.id==='defenseChange'&&typeof obj?.defenseChange?.intro==='string'&&typeof obj?.defenseChange?.introPlayer!=='string')base.defenseChange.introPlayer=obj.defenseChange.intro;
  for(const part of def.parts){const m=obj?.[def.id]?.[customInGameMemoKey(part.id)];if(typeof m==='string')base[def.id][customInGameMemoKey(part.id)]=m;} if(def.id==='startTime'&&START_TIME_TIMINGS.some(x=>x.value===obj?.startTime?.timing))base.startTime.timing=obj.startTime.timing; if(def.id==='score'&&['true','false'].includes(obj?.score?.noScoreEnabled))base.score.noScoreEnabled=obj.score.noScoreEnabled; if(def.id==='gameEnd'&&['true','false'].includes(obj?.gameEnd?.higherScoreFirst))base.gameEnd.higherScoreFirst=obj.gameEnd.higherScoreFirst;
  if(['true','false'].includes(obj?.[def.id]?.enabled))base[def.id].enabled=obj[def.id].enabled;
  if(def.id==='pitchCount')for(const part of def.parts){const k=`enabled:${part.id}`;if(['true','false'].includes(obj?.pitchCount?.[k]))base.pitchCount[k]=obj.pitchCount[k];}
  if(def.id==='ground'||def.id==='nextGame'){
   if(/^[1-9]$/.test(String(obj?.[def.id]?.triggerInning)))base[def.id].triggerInning=String(obj[def.id].triggerInning);
   if(['top','bottom'].includes(obj?.[def.id]?.triggerSide))base[def.id].triggerSide=obj[def.id].triggerSide;
  }} for(const [id,value] of Object.entries(obj)){if(/^userOther_[a-z0-9_]+$/.test(id)&&value&&typeof value==='object'&&typeof (value as any).label==='string'&&typeof (value as any).main==='string')base[id]={label:(value as any).label,main:(value as any).main,enabled:(value as any).enabled==='false'?'false':'true',[customInGameMemoKey('main')]:String((value as any)[customInGameMemoKey('main')]||'')};} return base;
 }catch{return base;}
}
export function saveCustomInGameTexts(profileId:string,texts:CustomInGameTexts){if(typeof window!=='undefined')localStorage.setItem(storageKey(profileId),JSON.stringify(texts));}
/** 読み上げメモは音声へ送らず、表示だけに使用する。各読み上げ文章ごとに保持。 */
export const customInGameMemoKey = (partId:string) => `memo:${partId}`;
/** 実際の試合画面でもこの変数置換規則を共通利用できる。*/
export const TOKEN_PATTERN=/【([^】]+)】/g;
export function unknownTokens(text:string,allowed:string[]){return Array.from(text.matchAll(TOKEN_PATTERN)).map(m=>m[1]).filter(t=>!allowed.includes(t));}
export function substituteTokens(text:string,data:Record<string,string>){return text.replace(TOKEN_PATTERN,(whole,token)=>Object.prototype.hasOwnProperty.call(data,token)?data[token]:whole);}
/** 守備交代は新規出場→既存守備移動→打順→終了で組み立てる。 */
export function buildDefenseChangeText(parts:Record<string,string>,args:{introVars:Record<string,string>;newPlayers:Record<string,string>[];positionMoves:Record<string,string>[];battingRows:Record<string,string>[];includeBatting?:boolean;includeOutro?:boolean;extraSegments?:string[]}){
 const chunks=[...(args.extraSegments||[]),...args.newPlayers.map(v=>substituteTokens((v['交代前・守備位置']===v['交代後・守備位置'] ? (parts.newPlayerSame??parts.newPlayer) : (parts.newPlayerDifferent??parts.newPlayer))||'',v)),...args.positionMoves.map(v=>substituteTokens(parts.positionMove||'',v))];
 // 各読み上げ文章が「。」で完結している場合は、接続文を追加しない。
 // 空白・改行が末尾にあっても句点を判定し、設定した文章そのものは変更しない。
 const changes=chunks.map((s,i)=>{
  if(!s.trim())return '';
  if(/。\s*$/.test(s))return s;
  return s+(i===chunks.length-1?(parts.last??''):(parts.middle??''));
 }).join('');
 const batting=args.includeBatting!==false&&args.battingRows.length?[parts.battingIntro,...args.battingRows.map(v=>substituteTokens(v.__battingKind==='new' ? (parts.battingRowNew??parts.battingRow??'') : (parts.battingRowExisting??parts.battingRow??''),v))].filter(Boolean).join('\n'):'';
 const newCount=args.newPlayers.length, movedCount=args.positionMoves.length;
 const introId=newCount>0&&movedCount>0?'introBoth':newCount>0?'introPlayer':'introPosition';
 const intro=parts[introId]??parts.intro??'';
 return [substituteTokens(intro,args.introVars),changes,batting,args.includeOutro!==false?parts.outro:''].filter(Boolean).join('\n');
}
