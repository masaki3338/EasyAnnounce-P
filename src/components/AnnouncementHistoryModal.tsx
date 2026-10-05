import React, { useEffect, useState } from "react";
import { speak, stop } from "../lib/tts";
import { getAnnouncementHistory, type AnnouncementHistoryItem } from "../lib/announcementHistory";

type Props = { open: boolean; onClose: () => void };

const formatTime = (ms: number) => new Date(ms).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });

const AnnouncementHistoryModal: React.FC<Props> = ({ open, onClose }) => {
  const [items, setItems] = useState<AnnouncementHistoryItem[]>([]);
  const [selected, setSelected] = useState<AnnouncementHistoryItem | null>(null);

  useEffect(() => {
    if (!open) return;
    const load = () => void getAnnouncementHistory().then(setItems);
    load();
    window.addEventListener("easyannounce:announcement-history-changed", load);
    return () => window.removeEventListener("easyannounce:announcement-history-changed", load);
  }, [open]);

  useEffect(() => { if (!open) setSelected(null); }, [open]);
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[500]" role="dialog" aria-modal="true" aria-label="アナウンス履歴">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute inset-0 flex items-center justify-center p-3 sm:p-4 overflow-hidden">
        <div className="bg-white shadow-2xl rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col" style={{ paddingBottom: "env(safe-area-inset-bottom)" }} onClick={(e) => e.stopPropagation()}>
          <div className="px-4 py-3 bg-gradient-to-r from-emerald-600 to-teal-600 text-white flex items-center justify-between">
            <button type="button" onClick={() => selected ? setSelected(null) : onClose()} className="px-2 py-1 rounded-lg bg-white/15 font-bold">{selected ? "← 一覧" : "閉じる"}</button>
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
                    <button key={item.id} type="button" onClick={() => setSelected(item)} className="w-full text-left rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm active:bg-slate-50">
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
                  <div className="text-red-700 font-bold leading-relaxed [&_ruby]:ruby [&_rt]:text-xs" dangerouslySetInnerHTML={{ __html: selected.displayHtml }} />
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button onClick={() => speak(selected.speechText)} className="w-full h-11 rounded-xl bg-blue-600 text-white font-bold">読み上げ</button>
                    <button onClick={() => stop()} className="w-full h-11 rounded-xl bg-rose-600 text-white font-bold">停止</button>
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
