import localForage from "localforage";
import { getSeniorAnnounceSettings, type SeniorStartTiming } from "./SeniorAnnouncementSettings";

/** リトルシニア専用。開始時刻の記録とアナウンス済み状態を試合ごとに分離。 */
const SESSION_KEY = "senior.startTimeNotice.session.v2";
const SHOWN_KEY = "senior.startTimeNotice.shown.v2";
let claimInProgress = false;

/** 「試合開始」操作で必ず新規セッションを発行。以前の試合の案内済み状態を持ち越さない。 */
export async function resetSeniorStartTimeNotice(): Promise<void> {
  const session = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await localForage.setItem(SESSION_KEY, session);
  await localForage.removeItem(SHOWN_KEY);
  // 古いバージョンで保存された案内済みフラグも無効化。
  await localForage.removeItem("startTimePopupShown");
}

export async function claimSeniorStartTimeNotice(timing: SeniorStartTiming): Promise<boolean> {
  if (getSeniorAnnounceSettings().startTiming !== timing) return false;
  if (claimInProgress) return false;
  claimInProgress = true;
  try {
    const start = String((await localForage.getItem<string>("startTime")) || "").trim();
    if (!start) return false;
    let session = await localForage.getItem<string>(SESSION_KEY);
    if (!session) {
      // 修正前に開始した試合も表示可能にする。古い案内済みフラグは使わない。
      const mi = (await localForage.getItem<any>("matchInfo")) || {};
      session = `legacy-${String(mi.tournamentName || "")}-${String(mi.matchNumber || "")}-${start}`;
      await localForage.setItem(SESSION_KEY, session);
    }
    if ((await localForage.getItem<string>(SHOWN_KEY)) === session) return false;
    await localForage.setItem(SHOWN_KEY, session);
    return true;
  } finally {
    claimInProgress = false;
  }
}

export async function getSeniorStartTimeText(): Promise<string> {
  const raw = String((await localForage.getItem<string>("startTime")) || "");
  const m = raw.match(/(\d{1,2})[:：](\d{1,2})/);
  if (m) return `この試合の開始時刻は、${Number(m[1])}時${Number(m[2])}分です。`;
  return raw ? `この試合の開始時刻は、${raw}です。` : "";
}
