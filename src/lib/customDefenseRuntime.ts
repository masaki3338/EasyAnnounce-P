import { getLeagueMode } from "./leagueSettings";
import { getActiveCustomProfileId } from "./customProfiles";
import { loadCustomInGameTexts, substituteTokens } from "./customInGameTemplates";

const esc=(s:unknown)=>String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const nameRuby=(name:unknown,kana:unknown)=>{const value=String(name??'');if(!value)return '';const reading=String(kana??'');return reading?`<ruby>${esc(value)}<rt>${esc(reading)}</rt></ruby>`:esc(value);};
export const pitcherRuby=(p:any)=>p?nameRuby(p.lastName,p.lastNameKana):'';
export const pitcherFullRuby=(p:any)=>p?nameRuby(p.lastName,p.lastNameKana)+nameRuby(p.firstName,p.firstNameKana):'';
export function customPitchText(part:'inningEnd'|'inningEndNoTotal'|'limit'|'limitAdvance', pitcher:any,current:number,total:number,limit:number,inning?:number,isTop?:boolean,teamName?:string):string|null{
 if(getLeagueMode()!=='custom')return null;
 const template=loadCustomInGameTexts(getActiveCustomProfileId()).pitchCount?.[part];
 if(typeof template!=='string')return null;
 return substituteTokens(template,{'投手名':pitcherRuby(pitcher),'投手名（苗字）':pitcherRuby(pitcher),'投手名（フルネーム）':pitcherFullRuby(pitcher),'敬称':pitcher?.isFemale?'さん':'くん','この回の投球数':String(current),'合計投球数':String(total),'投球上限':String(limit),'チーム名':String(teamName||pitcher?.teamName||pitcher?.team?.name||''),'回':typeof inning==='number'?String(inning):'','表裏':typeof isTop==='boolean'?(isTop?'表':'裏'):''});
}
export function customDefenseChangeIntro(kind:'player'|'position'|'both',teamName:string):string|null{
 if(getLeagueMode()!=='custom')return null;
 const item=loadCustomInGameTexts(getActiveCustomProfileId()).defenseChange;
 const key=kind==='both'?'introBoth':kind==='position'?'introPosition':'introPlayer';
 return typeof item?.[key]==='string'?substituteTokens(item[key],{'チーム名':teamName,'守備側チーム名':teamName}):null;
}

/** 代打・代走から守備入りする際の④～⑦の設定を実際の文章に反映する。
 * 既存の交代判定は変更せず、氏名と移動先を確実に特定できる行だけ置き換える。
 * 判定できない複雑なDH/リエントリー等は既存文を保護する。 */
export function customPinchDefenseBodies(source:string,players:any[],battingOrder:Array<{id:number}> = []):string {
  if(getLeagueMode()!=='custom' || !source)return source;
  const parts=loadCustomInGameTexts(getActiveCustomProfileId()).defenseChange;
  if(!parts)return source;
  const positions=['ピッチャー','キャッチャー','ファースト','セカンド','サード','ショート','レフト','センター','ライト','指名打者'];
  const plain=(s:string)=>s.replace(/<ruby>([^<]*)<rt>[^<]*<\/rt><\/ruby>/g,'$1').replace(/<[^>]+>/g,'');
  const findPlayer=(phrase:string):any|null=>{
    const p=plain(phrase);
    const pool=(players||[]).filter(x=>String(x?.lastName||'').trim() && p.includes(String(x.lastName).trim()));
    if(pool.length===1)return pool[0];
    const full=pool.filter(x=>String(x.firstName||'').trim() && p.includes(String(x.lastName)+String(x.firstName)));
    return full.length===1 ? full[0] : null;
  };
  const getName=(p:any)=> nameRuby(p?.lastName,p?.lastNameKana);
  const getFullName=(p:any)=> nameRuby(p?.lastName,p?.lastNameKana)+nameRuby(p?.firstName,p?.firstNameKana);
  const run=(line:string):string=>{
    if(!/先ほど代(?:打|走)/.test(plain(line)) || /リエントリー|臨時代走/.test(plain(line)))return line;
    if((plain(line).match(/先ほど代(?:打|走)/g)||[]).length!==1)return line;
    const text=plain(line);
    const hit=/先ほど代(打|走)(?:いたしました|しました|に出ました)/.exec(text);
    if(!hit)return line;
    const replaced=text.includes('に代わりまして');
    if(!replaced && !/そのまま|が/.test(text.slice(hit.index+hit[0].length)))return line;
    const partName=hit[1]==='打' ? (replaced?'pinchHitReplace':'pinchHitStay') : (replaced?'pinchRunReplace':'pinchRunStay');
    const template=parts[partName];
    if(typeof template!=='string')return line;
    const split = line.split(/に代わりまして[、，,]?/);
    const from = replaced ? findPlayer(split[0]) : null;
    const to = replaced ? findPlayer(split.slice(1).join('に代わりまして')) : findPlayer(line);
    if(!to || (replaced && !from))return line;
    const tail = plain(replaced?split.slice(1).join('に代わりまして'):line);
    const pos = positions.filter(x=>tail.includes(x)).at(-1);
    if(!pos)return line;
    const lineupId=from?.id??to?.id;
    const previousOrder=battingOrder.findIndex(x=>Number(x?.id)===Number(lineupId));
    const output=substituteTokens(template,{
      '交代前打順':previousOrder>=0?`${previousOrder+1}番`:'',
      '打順':previousOrder>=0?String(previousOrder+1):'',
      '交代前・選手名':from?getName(from):'',
      '交代前・選手名（苗字）':from?getName(from):'',
      '交代前・選手名（フルネーム）':from?getFullName(from):'',
      '交代前・敬称':from?(from.isFemale?'さん':'くん'):'',
      '交代後・選手名':getName(to),
      '交代後・選手名（苗字）':getName(to),
      '交代後・選手名（フルネーム）':getFullName(to),
      '交代後・敬称':to.isFemale?'さん':'くん',
      '交代後・守備位置':pos,
      '交代後・背番号':String(to.number??''),
    });
    const last = /[。.!！]\s*$/.test(text);
    const joiner= last ? (parts.last??'入ります。') : (parts.middle??'入り、');
    return /[。.!！、，,]\s*$/.test(output) ? output : output + joiner;
  };
  return source.split(/(\n|<br\s*\/?>)/i).map((segment,i)=> i%2===1 ? segment : run(segment)).join('');
}

/** 守備リエントリーの設定文。選手名のふりがなをルビで保持する。 */
export function customDefenseReentryText(before:any,after:any,position:string,kind:'pinch'|'defense',reason='代打'):string|null {
 if(getLeagueMode()!=='custom')return null;
 const part=kind==='pinch'?'reentryFromPinch':'reentryFromDefense';
 const source=loadCustomInGameTexts(getActiveCustomProfileId()).defenseChange?.[part];
 if(typeof source!=='string')return null;
 const pronoun=reason==='代走'?'代走':reason==='臨時代走'?'臨時代走':'代打';
 const full=(p:any)=>nameRuby(p?.lastName,p?.lastNameKana)+(p?.firstName?'、'+nameRuby(p?.firstName,p?.firstNameKana):'');
 const values={
  '交代前・選手名（苗字）':nameRuby(before?.lastName,before?.lastNameKana),
  '交代前・選手名（フルネーム）':full(before),
  '交代前・選手名':nameRuby(before?.lastName,before?.lastNameKana),
  '交代前・敬称':before?.isFemale?'さん':'くん',
  '交代後・選手名（苗字）':nameRuby(after?.lastName,after?.lastNameKana),
  '交代後・選手名（フルネーム）':full(after),
  '交代後・選手名':nameRuby(after?.lastName,after?.lastNameKana),
  '交代後・敬称':after?.isFemale?'さん':'くん',
  '交代後・守備位置':position
 };
 const mapped=source.replace(/代打（代走）/g,pronoun);
 return substituteTokens(mapped,values);
}
