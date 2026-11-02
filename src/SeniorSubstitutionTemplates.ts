// リトルシニア専用：代打・代走アナウンスの編集可能な文章テンプレート
export type SeniorSubKind = "pinch" | "runner";
export type SeniorSubPlayer = {lastName?:string;firstName?:string;lastNameKana?:string;firstNameKana?:string;number?:string|number;isFemale?:boolean} | null | undefined;
export const SENIOR_SUB_TEMPLATES_KEY = "easyannounce:senior:substitutionTemplates:v1";
export const DEFAULT_SENIOR_SUB_TEMPLATES = {
  pinch: "【チーム名】、選手の交代をお知らせいたします。\n【打順】番、【交代前・苗字】君に代わりまして、【交代後・苗字】君が入ります。\n【打順】番、代打、【交代後・苗字】君、背番号【交代後・背番号】。\n以上のように代わります。",
  runner: "【チーム名】、選手の交代をお知らせいたします。\n【塁】ランナー、【交代前・苗字】君に代わりまして、\n代走【交代後・苗字】君、背番号【交代後・背番号】、【塁】ランナーは【交代後・苗字】君。\n以上のように代わります。",
};
export type SeniorSubTemplates = typeof DEFAULT_SENIOR_SUB_TEMPLATES;
export function getSeniorSubTemplates():SeniorSubTemplates {
  try {const obj=JSON.parse(localStorage.getItem(SENIOR_SUB_TEMPLATES_KEY)||"{}");return {pinch:typeof obj.pinch==="string"?obj.pinch:DEFAULT_SENIOR_SUB_TEMPLATES.pinch,runner:typeof obj.runner==="string"?obj.runner:DEFAULT_SENIOR_SUB_TEMPLATES.runner};}
  catch{return {...DEFAULT_SENIOR_SUB_TEMPLATES};}
}
export function saveSeniorSubTemplates(templates:SeniorSubTemplates){localStorage.setItem(SENIOR_SUB_TEMPLATES_KEY,JSON.stringify(templates));window.dispatchEvent(new Event("easyannounce:senior-settings-updated"));}
const escapeHtml=(t:string)=>t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
export function renderSeniorSubTemplate(kind:SeniorSubKind, context:{team:string;teamReading?:string;order?:number;base?:string;before?:SeniorSubPlayer;after?:SeniorSubPlayer}, speech=false, override?:string):string {
 const template=override??getSeniorSubTemplates()[kind];
 const names=(person:SeniorSubPlayer,full:boolean):string=>{
  if(!person)return "";
  const part=(name:any,kana:any)=>{const value=String(name??"");const reading=String(kana??"");return speech?(reading||value):(reading?`<ruby>${escapeHtml(value)}<rt>${escapeHtml(reading)}</rt></ruby>`:escapeHtml(value));};
  return part(person.lastName,person.lastNameKana)+(full?(speech?" ":"")+part(person.firstName,person.firstNameKana):"");
 };
 const replacement=(token:string):string=>{
  switch(token){case "チーム名":return speech?(context.teamReading||context.team):escapeHtml(context.team);
   case "打順":return String(context.order??"");case "塁":return context.base||"";
   case "苗字":case "交代後・苗字":return names(context.after,false);
   case "フルネーム":case "交代後・フルネーム":return names(context.after,true);
   case "背番号":case "交代後・背番号":return String(context.after?.number??"");
   case "交代前・苗字":return names(context.before,false);
   case "交代前・フルネーム":return names(context.before,true);
   case "交代前・背番号":return String(context.before?.number??"");
   default:return `【${token}】`;
  }
 };
 const content=template.replace(/【([^】]+)】/g,(_,token:string)=>replacement(token));
 return speech?content:content.replace(/\n/g,"<br/>");
}
