import React, { useEffect, useMemo, useRef, useState } from "react";
import { speak, stop, prefetchTTS, preserveNameReading } from "../lib/tts";
import { getAnnouncementHistory, type AnnouncementHistoryItem } from "../lib/announcementHistory";

type Props = { open: boolean; onClose: () => void };

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

/** 履歴に保存されたHTMLを、日本語の読み上げ文へ変換する。
 *  <ruby>漢字<rt>かな</rt></ruby> をそのままTTSへ渡すと、
 *  rtの二重読み・タグ読み・AI音声の誤発音が起きるため、先にかなへ置換する。
 */
function historySpeechText(item: AnnouncementHistoryItem): string {
  // 投球数の履歴では保存時の speechText に既に名前の読みが含まれる場合がある。
  // ルビ付き表示文を唯一の入力とすることで、名前の二重読みを防ぐ。
  // 他カテゴリの履歴は従来どおり speechText を優先する。
  const source = String(
    item.category === "投球数" && item.displayHtml
      ? item.displayHtml
      : (item.speechText || item.displayHtml || "")
  );
  if (!source.trim()) return "";

  const root = document.createElement("div");
  root.innerHTML = source;

  root.querySelectorAll("ruby").forEach((node) => {
    const rt = node.querySelector("rt");
    const base = node.cloneNode(true) as HTMLElement;
    base.querySelectorAll("rt, rp").forEach((el) => el.remove());
    const reading = (rt?.textContent || "").trim();
    const value = reading ? preserveNameReading(reading) : base.textContent || "";
    const nextIsRuby = node.nextElementSibling?.tagName.toLowerCase() === "ruby";
    node.replaceWith(document.createTextNode(value + (nextIsRuby ? " " : "")));
  });

  root.querySelectorAll("br").forEach((el) => el.replaceWith(document.createTextNode("\n")));
  root.querySelectorAll("script, style, rt, rp").forEach((el) => el.remove());

  // innerTextは非表示の一時DOMでは空文字になる場合があるためtextContentを使用。
  return (root.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/([\p{L}\p{N}])[ \t、，,]+(くん|さん)/gu, "$1$2")
    .replace(/[ \t]+/g, " ")
    .replace(/\n[ \t]*/g, "。")
    .replace(/。{2,}/g, "。")
    .trim();
}

const AnnouncementHistoryModal: React.FC<Props> = ({ open, onClose }) => {
  const [items, setItems] = useState<AnnouncementHistoryItem[]>([]);
  const [selected, setSelected] = useState<AnnouncementHistoryItem | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const speakVersion = useRef(0);
  const previousOpen = useRef(open);
  const preparedText = useMemo(() => selected ? historySpeechText(selected) : "", [selected]);

  // 開いた履歴の本文は、ボタンを押す前にMatcha-TTSで先読みする。
  // 先読みと再生には同一の文字列を渡し、生成済みキャッシュの再利用を促す。
  useEffect(() => {
    if (!open || !preparedText) return;
    void prefetchTTS(preparedText).catch((error) =>
      console.warn("[TTS PREFETCH][History] failed", error)
    );
  }, [open, preparedText]);

  const handleStop = () => {
    speakVersion.current += 1;
    stop();
    setSpeaking(false);
  };

  const handleSpeak = async () => {
    if (!preparedText) return;
    const version = ++speakVersion.current;
    stop();
    setSpeaking(true);
    try {
      await speak(preparedText, { progressive: true, cache: true });
    } catch (error) {
      console.error("[TTS][History] failed", error);
    } finally {
      if (version === speakVersion.current) setSpeaking(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const load = () => void getAnnouncementHistory().then(setItems);
    load();
    window.addEventListener("easyannounce:announcement-history-changed", load);
    return () => window.removeEventListener("easyannounce:announcement-history-changed", load);
  }, [open]);

  useEffect(() => {
    if (previousOpen.current && !open) {
      handleStop();
      setSelected(null);
    }
    previousOpen.current = open;
  }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500]" role="dialog" aria-modal="true" aria-label="アナウンス履歴">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => { handleStop(); onClose(); }} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-hidden">
        <div className="bg-white shadow-2xl rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
            <button type="button" onClick={() => { handleStop(); if (selected) setSelected(null); else onClose(); }} className="px-2 py-1 rounded-lg bg-white/15 font-bold">{selected ? "← 一覧" : "閉じる"}</button>
            <h2 className="font-extrabold text-lg">アナウンス履歴</h2>
            <div className="w-14" />
          </div>

          <div className="overflow-y-auto p-4">
            {!selected ? (
              items.length === 0 ? (
                <div className="py-10 text-center text-slate-500">履歴はありません</div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <button key={item.id} type="button" onClick={() => { handleStop(); setSelected(item); }} className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm active:bg-slate-50">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-bold text-slate-900">{item.category}</span>
                        <span className="text-xs text-slate-500 shrink-0 flex items-center gap-2">
                          <span>{formatTime(item.createdAt)}</span>
                          {item.inningLabel && <span className="font-bold text-slate-700">{item.inningLabel}</span>}
                        </span>
                      </div>
                      <div className="mt-1 text-sm text-slate-600 line-clamp-2" dangerouslySetInnerHTML={{ __html: item.displayHtml }} />
                    </button>
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4">
                <div className="text-sm font-bold text-slate-500">
                  {selected.category}　{formatTime(selected.createdAt)}{selected.inningLabel ? `　${selected.inningLabel}` : ""}
                </div>
                <div className="rounded-2xl border border-red-500 bg-red-200 p-4 shadow-sm">
                  <div className="text-red-700 font-bold leading-relaxed whitespace-pre-wrap [&_ruby]:ruby [&_rt]:text-xs" dangerouslySetInnerHTML={{ __html: selected.displayHtml }} />
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={handleSpeak} className="w-full h-11 rounded-xl bg-blue-600 text-white font-bold">{speaking ? "読み上げ中" : "読み上げ"}</button>
                    <button onClick={handleStop} className="w-full h-11 rounded-xl bg-rose-600 text-white font-bold">停止</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementHistoryModal;
