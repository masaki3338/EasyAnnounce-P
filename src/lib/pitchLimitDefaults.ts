// リーグ別の規定投球数（保存値が存在しないときの初期値）
import type { LeagueMode } from "./leagueSettings";
import localForage from "localforage";

export type PitchLimitChoice = "85" | "75" | "45" | "custom";
export const DEFAULT_CUSTOM_PITCH_LIMIT = 85;

export function getDefaultPitchLimit(mode: LeagueMode): { choice: PitchLimitChoice; custom: number; selected: number } {
  return mode === "pony"
    ? { choice: "75", custom: DEFAULT_CUSTOM_PITCH_LIMIT, selected: 75 }
    : { choice: "custom", custom: DEFAULT_CUSTOM_PITCH_LIMIT, selected: DEFAULT_CUSTOM_PITCH_LIMIT };
}

// リーグを実際に切り替えたときだけ、そのリーグの規定投球数に初期化する。
export async function resetPitchLimitForLeague(mode: LeagueMode): Promise<void> {
  const defaults = getDefaultPitchLimit(mode);
  await localForage.setItem("rule.pitchLimit.choice", defaults.choice);
  await localForage.setItem("rule.pitchLimit.custom", defaults.custom);
  await localForage.setItem("rule.pitchLimit.selected", defaults.selected);
  // 旧キーを参照する旧処理が残っていても不整合を起こさないように同期
  await localForage.setItem("rule.pitchLimit", defaults.selected);
}
