// リトルシニア専用設定。ポニー／ボーイズの保存値には触れない。
export type SeniorStartTiming = "kanto" | "kansai" | "tohoku";
export type SeniorSeatName = "last" | "full";
export type SeniorBatterStyle = "kanto" | "kansai" | "kansaiNumber" | "custom";
export type SeniorFoulStyle = "kanto" | "kansai" | "custom";
export type SeniorBatterPart = "order" | "position" | "last" | "full" | "number";
export type SeniorAnnounceSettings = {
  startTiming: SeniorStartTiming;
  seatName: SeniorSeatName;
  batterStyle: SeniorBatterStyle;
  batterParts: SeniorBatterPart[];
  foulStyle: SeniorFoulStyle;
  customFoul: string;
};
export const SENIOR_SETTINGS_KEY = "easyannounce:senior:announcementSettings:v1";
export const DEFAULT_SENIOR_SETTINGS: SeniorAnnounceSettings = {
  startTiming: "kanto", seatName: "last", batterStyle: "kanto",
  batterParts: ["order", "position", "last", "number"],
  foulStyle: "kanto", customFoul: "",
};
const ALL_PARTS: SeniorBatterPart[] = ["order", "position", "last", "full", "number"];
export function getSeniorAnnounceSettings(): SeniorAnnounceSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SENIOR_SETTINGS_KEY) || "{}");
    const next = {...DEFAULT_SENIOR_SETTINGS, ...saved};
    next.batterParts = Array.isArray(saved.batterParts)
      ? [...new Set(saved.batterParts)].filter((p: unknown) => ALL_PARTS.includes(p as SeniorBatterPart))
      : [...DEFAULT_SENIOR_SETTINGS.batterParts];
    return next;
  } catch {return {...DEFAULT_SENIOR_SETTINGS, batterParts: [...DEFAULT_SENIOR_SETTINGS.batterParts]};}
}
export function saveSeniorAnnounceSettings(s: SeniorAnnounceSettings) {
  localStorage.setItem(SENIOR_SETTINGS_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("easyannounce:senior-settings-updated"));
}
export const seniorFoulText = (s: SeniorAnnounceSettings) => s.foulStyle === "kansai"
  ? "スタンドの皆様、ファールボールにはくれぐれもご注意ください"
  : s.foulStyle === "custom" ? s.customFoul.trim() : "ファウルボールの行方には十分ご注意下さい";
export const seniorStartTimingLabel = (s: SeniorAnnounceSettings) => ({
  kanto: "投手が1球投げた後（関東連盟）",
  kansai: "1回表裏攻撃終了後（関西連盟）",
  tohoku: "2番打者の前（東北連盟）",
})[s.startTiming];
export type SeniorBatterPlayer = {lastName?:string;firstName?:string;lastNameKana?:string;firstNameKana?:string;number?:string|number;isFemale?:boolean};
export function seniorBatterParts(s: SeniorAnnounceSettings): SeniorBatterPart[] {
  switch(s.batterStyle) {
    case "kansai": return ["order","position","full"];
    case "kansaiNumber": return ["order","position","full","number"];
    case "custom": return s.batterParts;
    default: return ["order","position","last","number"];
  }
}
export function seniorBatterLine(s: SeniorAnnounceSettings, order: number, position: string, player: SeniorBatterPlayer, forceFull=false, speech=false): string {
  const honor = player.isFemale ? "さん" : "くん";
  const escapeHtml = (value: string) => value.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const ruby = (base: string, kana: string) => speech ? (kana||base) : (kana ? `<ruby>${escapeHtml(base)}<rt>${escapeHtml(kana)}</rt></ruby>` : escapeHtml(base));
  const last = ruby(String(player.lastName||""),String(player.lastNameKana||""));
  const first = ruby(String(player.firstName||""),String(player.firstNameKana||""));
  const lastPart = forceFull ? last+ (speech ? " " : "") +first : last;
  const fullPart = last+(speech ? " " : "")+first;
  const number = String(player.number??"").trim();
  const pieces = seniorBatterParts(s).map(part=>{
    switch(part) {
      case "order":return `${order}番`;
      case "position":return position;
      case "last":return lastPart+honor;
      case "full":return fullPart+honor;
      case "number":return number ? `背番号${number}` : "";
    }
  }).filter(Boolean);
  return pieces.join("、")+"。";
}
