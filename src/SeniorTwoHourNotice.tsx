import React, { useEffect, useRef, useState } from "react";
import localForage from "localforage";
import { speak, stop } from "./lib/tts";

/** リトルシニア専用：5・6回の途中で試合開始から120分を経過した場合の案内。 */
type ScoreBoard = Record<number, { top?: number; bottom?: number }>;
type Props = { inning: number; isTop: boolean; scores: ScoreBoard; startTime: string | null };
const NO_NEXT = "お知らせいたします。\n試合開始から２時間が経過しましたので、\n新しいイニングには入りません。";
const GAME_END = "お知らせいたします。\n試合開始から２時間が経過しましたので、\n試合終了となります。";

function startMilliseconds(text: string | null, now: number): number | null {
  if (!text) return null;
  const value = String(text).trim();
  // タイムゾーン付きのISO日付が保存されている場合
  const timestamp = Date.parse(value);
  if (/\d{4}-\d{2}-\d{2}/.test(value) && Number.isFinite(timestamp)) return timestamp;
  const match = value.match(/(\d{1,2})\s*(?:[:：]|時)\s*(\d{1,2})/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const today = new Date(now);
  today.setHours(hours, minutes, 0, 0);
  // 日付を保存しない既存startTimeの互換処理。深夜を跨ぐ試合に対応。
  if (today.getTime() > now + 60_000) today.setDate(today.getDate() - 1);
  return today.getTime();
}

const SeniorTwoHourNotice: React.FC<Props> = ({ inning, isTop, scores, startTime }) => {
  const [message, setMessage] = useState("");
  const claimedRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      if (claimedRef.current || busyRef.current || inning < 5 || inning > 6) return;
      busyRef.current = true;
      try {
        const now = Date.now();
        const matchInfo = (await localForage.getItem<any>("matchInfo")) || {};
        // リトルシニア以外は絶対に動作させない。
        const savedStart = (await localForage.getItem<string>("startTime")) ||
          (await localForage.getItem<string>("gameStartTime")) || startTime;
        const from = startMilliseconds(savedStart, now);
        if (from === null || now - from < 120 * 60 * 1000 || now < from) return;
        const matchKey = [matchInfo.tournamentName || "", matchInfo.matchNumber || "", matchInfo.teamName || "", matchInfo.opponentTeam || "", savedStart].join("::");
        const key = `senior:two-hour-announced:${matchKey}`;
        if (await localForage.getItem<boolean>(key)) { claimedRef.current = true; return; }
        const latest = (await localForage.getItem<ScoreBoard>("scores")) || scores || {};
        const totals = Object.values(latest).reduce((sum, s) => ({
          top: sum.top + (Number(s?.top) || 0),
          bottom: sum.bottom + (Number(s?.bottom) || 0),
        }), { top: 0, bottom: 0 });
        const result = !isTop && totals.bottom > totals.top ? GAME_END : NO_NEXT;
        await localForage.setItem(key, true);
        claimedRef.current = true;
        if (active) setMessage(result);
      } catch (error) {
        console.warn("[SeniorTwoHourNotice] 判定失敗", error);
      } finally { busyRef.current = false; }
    };
    void check();
    const id = window.setInterval(() => void check(), 2000);
    return () => { active = false; window.clearInterval(id); };
  }, [inning, isTop, scores, startTime]);

  if (!message) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="試合開始から2時間経過のお知らせ">
      <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
        <h2 className="mb-4 text-lg font-bold text-slate-900">試合開始から2時間経過</h2>
        <p className="whitespace-pre-line rounded-xl bg-slate-100 p-4 text-base font-medium leading-8 text-slate-900">{message}</p>
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" className="min-h-12 rounded-xl bg-emerald-600 px-3 py-3 font-bold text-white" onClick={() => void speak(message)}>▶ 読み上げ</button>
          <button type="button" className="min-h-12 rounded-xl bg-rose-600 px-3 py-3 font-bold text-white" onClick={() => stop()}>■ 停止</button>
        </div>
        <button type="button" className="mt-3 min-h-12 w-full rounded-xl bg-slate-700 px-3 py-3 font-bold text-white" onClick={() => { stop(); setMessage(""); }}>OK（閉じる）</button>
      </div>
    </div>
  );
};
export default SeniorTwoHourNotice;
