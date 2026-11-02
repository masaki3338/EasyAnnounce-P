// リトルシニア専用：試合終了アナウンスの自由編集
export type SeniorEndKind = "win" | "draw";
export type SeniorEndTemplates = Record<SeniorEndKind, string>;
export const DEFAULT_SENIOR_END_TEMPLATES: SeniorEndTemplates = {
  win: "ご覧のように【点数】対【点数】で【チーム名】が勝ちました。",
  draw: "ご覧のように【点数】対【点数】の同点で試合終了となりました。",
};
const STORAGE_KEY = "senior:end-game-templates:v1";
export function getSeniorEndTemplates(): SeniorEndTemplates {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SeniorEndTemplates>;
      return {
        win: typeof saved.win === "string" ? saved.win : DEFAULT_SENIOR_END_TEMPLATES.win,
        draw: typeof saved.draw === "string" ? saved.draw : DEFAULT_SENIOR_END_TEMPLATES.draw,
      };
    }
  } catch { /* 保存不可の場合は初期値を使う */ }
  return { ...DEFAULT_SENIOR_END_TEMPLATES };
}
export function saveSeniorEndTemplates(templates: SeniorEndTemplates): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(templates)); } catch { /* ignore */ }
}
export interface SeniorEndValues {
  topScore: number;
  bottomScore: number;
  winningTeam: string;
  winningTeamReading?: string;
}
// 【点数】の最初を先攻、2つ目を後攻とする。並べ替えたい場合は明示トークンを利用。
export function renderSeniorEndTemplate(kind: SeniorEndKind, values: SeniorEndValues, forSpeech = false, template?: string): string {
  const text = template ?? getSeniorEndTemplates()[kind];
  let numberIndex = 0;
  return text.replace(/【(点数|先攻点数|後攻点数|チーム名)】/g, (_whole, token: string) => {
    if (token === "チーム名") return forSpeech ? (values.winningTeamReading || values.winningTeam) : values.winningTeam;
    if (token === "先攻点数") return String(values.topScore);
    if (token === "後攻点数") return String(values.bottomScore);
    return String(numberIndex++ % 2 === 0 ? values.topScore : values.bottomScore);
  });
}
