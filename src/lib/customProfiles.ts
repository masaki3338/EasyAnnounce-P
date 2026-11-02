import { youthPreGameItems, youthInGameTexts } from './youthBaseballDefaults';
import { BUNDLED_CUSTOM_PROFILE_NAME, bundledPreGameItems, bundledInGameTexts } from './bundledCustomDefaults';
/** カスタマイズ専用のカスタマイズ設定。既存の連盟保存キーと分離する。 */
export type CustomProfile={id:string;name:string;createdAt:number};
const LIST='easyannounce:custom:profiles:v1';
const ACTIVE='easyannounce:custom:activeProfileId';
// Keep the legacy id unchanged so existing installations retain their announcements.
const initial:CustomProfile={id:'gakudo-default',name:BUNDLED_CUSTOM_PROFILE_NAME,createdAt:0};
const youth:CustomProfile={id:'gakudo-youth-default',name:'学童野球（サンプル）',createdAt:0};
const bundledProfiles=[initial,youth];
const PRE_GAME_KEY = 'easyannounce:custom:preGame:v1:';
const IN_GAME_KEY = 'easyannounce:custom:inGame:v1:';
/** 保存データがない設定グループにだけ、同梱した標準文章を設定する。 */
function seedBundledDefaults(id:string){
 if(typeof window==='undefined')return;
 if(localStorage.getItem(PRE_GAME_KEY+id)===null)
  localStorage.setItem(PRE_GAME_KEY+id,JSON.stringify(id===youth.id?youthPreGameItems:bundledPreGameItems));
 if(localStorage.getItem(IN_GAME_KEY+id)===null)
  localStorage.setItem(IN_GAME_KEY+id,JSON.stringify(id===youth.id?youthInGameTexts:bundledInGameTexts));
}
/** 明示的な初期化用。既存設定を置換するので、UI側で確認を取ってから使用する。 */
export function resetCustomProfileToBundledDefaults(id:string){
 if(!getCustomProfiles().some(p=>p.id===id))throw new Error('設定グループが見つかりません');
 localStorage.setItem(PRE_GAME_KEY+id,JSON.stringify(id===youth.id?youthPreGameItems:bundledPreGameItems));
 localStorage.setItem(IN_GAME_KEY+id,JSON.stringify(id===youth.id?youthInGameTexts:bundledInGameTexts));
}

export function getCustomProfiles():CustomProfile[]{
 if(typeof window==='undefined')return bundledProfiles;
 let profiles:CustomProfile[]=[];
 try{
  const parsed=JSON.parse(localStorage.getItem(LIST)||'null');
  if(Array.isArray(parsed)) profiles=parsed.filter(x=>x&&typeof x.id==='string'&&typeof x.name==='string');
 }catch{}
 // Add newly bundled options to saved users without replacing their existing settings.
 // Preserve built-in IDs and user data; synchronize display names after updates.
 if(profiles.length===0)profiles=[...bundledProfiles];
 else for(const builtin of bundledProfiles){
  const index=profiles.findIndex(p=>p.id===builtin.id);
  if(index<0)profiles.push(builtin);
  else if(profiles[index].name!==builtin.name)profiles[index]={...profiles[index],name:builtin.name};
 }
 if(localStorage.getItem(LIST)!==JSON.stringify(profiles))
  localStorage.setItem(LIST,JSON.stringify(profiles));
 // Older app versions seeded the youth profile with the federation sample.
 // Migrate only fields still identical to that original sample; retain any edits.
 const migration='easyannounce:custom:youthDefaultsMigrated:v1';
 if(localStorage.getItem(migration)!=='1'){
  const oldPre=localStorage.getItem(PRE_GAME_KEY+youth.id);
  const oldIn=localStorage.getItem(IN_GAME_KEY+youth.id);
  if(oldPre===JSON.stringify(bundledPreGameItems))localStorage.setItem(PRE_GAME_KEY+youth.id,JSON.stringify(youthPreGameItems));
  if(oldIn===JSON.stringify(bundledInGameTexts))localStorage.setItem(IN_GAME_KEY+youth.id,JSON.stringify(youthInGameTexts));
  localStorage.setItem(migration,'1');
 }
 for(const builtin of bundledProfiles)seedBundledDefaults(builtin.id);
 return profiles;
}
export function getActiveCustomProfileId(){if(typeof window==='undefined')return initial.id;const p=getCustomProfiles();const id=localStorage.getItem(ACTIVE);return p.some(x=>x.id===id)?id!:p[0].id;}
export function setActiveCustomProfileId(id:string){if(getCustomProfiles().some(x=>x.id===id))localStorage.setItem(ACTIVE,id);}
export function createCustomProfile(name:string,sourceId?:string):CustomProfile{
 const profiles=getCustomProfiles();const id=`custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,7)}`;
 const next={id,name:name.trim()||'新しいカスタマイズ',createdAt:Date.now()};localStorage.setItem(LIST,JSON.stringify([...profiles,next]));
 if(!sourceId)seedBundledDefaults(id);
 if(sourceId){for(const prefix of ['easyannounce:custom:inGame:v1:','easyannounce:custom:preGame:v1:']){const raw=localStorage.getItem(prefix+sourceId);if(raw!==null)localStorage.setItem(prefix+id,raw);}}
 setActiveCustomProfileId(id);return next;
}

/** 選択中グループの試合前・試合中設定を、登録済みグループへ上書きする。 */
export function overwriteCustomProfileSettings(sourceId:string,targetId:string){
 const profiles=getCustomProfiles();
 if(!profiles.some(p=>p.id===sourceId)||!profiles.some(p=>p.id===targetId))throw new Error('設定グループが見つかりません');
 if(sourceId===targetId)return;
 for(const prefix of ['easyannounce:custom:preGame:v1:','easyannounce:custom:inGame:v1:']){
  const raw=localStorage.getItem(prefix+sourceId);
  if(raw===null)localStorage.removeItem(prefix+targetId);
  else localStorage.setItem(prefix+targetId,raw);
 }
}
export function renameCustomProfile(id:string,name:string){if(bundledProfiles.some(p=>p.id===id))throw new Error('初期設定の名前は変更できません。コピーした設定で変更してください');const profiles=getCustomProfiles().map(x=>x.id===id?{...x,name:name.trim()||x.name}:x);localStorage.setItem(LIST,JSON.stringify(profiles));}
export function deleteCustomProfile(id:string){if(bundledProfiles.some(p=>p.id===id))throw new Error('初期設定は削除できません');const profiles=getCustomProfiles().filter(x=>x.id!==id);localStorage.setItem(LIST,JSON.stringify(profiles.length?profiles:[initial]));for(const prefix of ['easyannounce:custom:inGame:v1:','easyannounce:custom:preGame:v1:'])localStorage.removeItem(prefix+id);if(getActiveCustomProfileId()===id)setActiveCustomProfileId(getCustomProfiles()[0].id);}
export function exportCustomProfile(id:string){const profile=getCustomProfiles().find(p=>p.id===id);if(!profile)return '';return JSON.stringify({format:'easyannounce-custom-v1',profile,preGame:JSON.parse(localStorage.getItem('easyannounce:custom:preGame:v1:'+id)||'null'),inGame:JSON.parse(localStorage.getItem('easyannounce:custom:inGame:v1:'+id)||'null')},null,2);}

/** ファイルを安全に検証して、全設定を新しいプロファイルとして読み込む。既存設定は上書きしない。 */
export function importCustomProfile(raw:string):CustomProfile{
 const data=JSON.parse(raw);
 if(data?.format!=='easyannounce-custom-v1'||!data.profile||typeof data.profile.name!=='string')throw new Error('Easyアナウンスの設定ファイルではありません');
 if(data.preGame!==null&&data.preGame!==undefined&&!Array.isArray(data.preGame))throw new Error('試合前データの形式が不正です');
 if(data.inGame!==null&&data.inGame!==undefined&&(typeof data.inGame!=='object'||Array.isArray(data.inGame)))throw new Error('試合中データの形式が不正です');
 const profile=createCustomProfile(data.profile.name);
 if(data.preGame!=null)localStorage.setItem('easyannounce:custom:preGame:v1:'+profile.id,JSON.stringify(data.preGame));
 if(data.inGame!=null)localStorage.setItem('easyannounce:custom:inGame:v1:'+profile.id,JSON.stringify(data.inGame));
 return profile;
}
