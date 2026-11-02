// src/lib/leagueSettings.ts
export type LeagueMode = "pony" | "boys" | "senior" | "custom";

const STORAGE_KEY = "easyannounce_league_mode";

export function getLeagueMode(): LeagueMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "boys" ? "boys" : v === "senior" ? "senior" : v === "custom" ? "custom" : "pony";
}

export function setLeagueMode(mode: LeagueMode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function getLeagueLabel(mode: LeagueMode): string {
  return mode === "boys" ? "ボーイズリーグ" : mode === "senior" ? "リトルシニア" : mode === "custom" ? "カスタマイズ" : "ポニーリーグ";
}