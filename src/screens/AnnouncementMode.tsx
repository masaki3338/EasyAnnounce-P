import React, { useEffect, useState } from "react";
import localForage from "localforage";
import {
  getAnnouncementMode,
  setAnnouncementMode,
  type AnnouncementMode,
} from "../lib/announcementMode";

type Props = {
  onBack: () => void;
};

export default function AnnouncementModeScreen({ onBack }: Props) {
  const [mode, setMode] = useState<AnnouncementMode>("normal");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getAnnouncementMode().then(setMode);
  }, []);

  const handleSave = async () => {
    // ✅ アナウンスモード設定として保存
    await setAnnouncementMode(mode);

    // ✅ 既存の matchInfo 側にも反映して、古い single が残らないようにする
    const matchInfo = await localForage.getItem<any>("matchInfo");

    if (matchInfo && typeof matchInfo === "object") {
      await localForage.setItem("matchInfo", {
        ...matchInfo,
        announcementMode: mode,
      });
    } else {
      await localForage.setItem("matchInfo", {
        announcementMode: mode,
      });
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  };

  return (
    <div className="min-h-[100svh] bg-slate-900 text-white px-4 py-6">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-2xl font-extrabold mb-6">🎤 アナウンスモード</h1>

        <div className="space-y-4">
          <label className="block rounded-2xl bg-white/10 border border-white/10 p-4">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                checked={mode === "normal"}
                onChange={() => setMode("normal")}
                className="w-5 h-5"
              />
              <div>
                <div className="font-bold">通常モード</div>
                <div className="text-sm text-white/70">自チームのみアナウンス</div>
              </div>
            </div>
          </label>

          <label className="block rounded-2xl bg-white/10 border border-white/10 p-4">
            <div className="flex items-center gap-3">
              <input
                type="radio"
                checked={mode === "single"}
                onChange={() => setMode("single")}
                className="w-5 h-5"
              />
              <div>
                <div className="font-bold">両チームを1人でアナウンス</div>
                <div className="text-sm text-white/70">
                  1塁側・3塁側の両チームを管理します
                </div>
              </div>
            </div>
          </label>
        </div>

        {saved && (
          <div className="mt-4 text-emerald-300 font-bold">
            保存しました
          </div>
        )}

        <div className="mt-8 grid grid-cols-2 gap-3">
          <button
            onClick={onBack}
            className="rounded-2xl bg-white/10 border border-white/10 py-3 font-bold"
          >
            戻る
          </button>

          <button
            onClick={handleSave}
            className="rounded-2xl bg-blue-600 py-3 font-bold"
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}