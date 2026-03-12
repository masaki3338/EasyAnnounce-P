// src/screens/LeagueSettings.tsx
import React, { useEffect, useState } from "react";
import type { ScreenType } from "../App";
import { getLeagueLabel, getLeagueMode, setLeagueMode, type LeagueMode } from "../lib/leagueSettings";

type Props = {
  onNavigate: (s: ScreenType) => void;
};

function OptionCard({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full rounded-2xl border p-4 text-left transition active:scale-[0.98]",
        selected
          ? "bg-blue-600/30 border-blue-300 shadow-lg"
          : "bg-white/10 border-white/10 hover:bg-white/15",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{title}</div>
          <div className="text-sm opacity-80 mt-1">{desc}</div>
        </div>
        <div
          className={[
            "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
            selected ? "border-blue-200" : "border-white/40",
          ].join(" ")}
        >
          {selected && <div className="w-3 h-3 rounded-full bg-blue-200" />}
        </div>
      </div>
    </button>
  );
}

export default function LeagueSettings({ onNavigate }: Props) {
  const [mode, setMode] = useState<LeagueMode>("pony");

  useEffect(() => {
    setMode(getLeagueMode());
  }, []);

  const handleSelect = (next: LeagueMode) => {
    setMode(next);
    setLeagueMode(next);
  };

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-2xl mx-auto flex flex-col min-h-[100svh]">
        <header className="pt-2 pb-6">
          <button
            onClick={() => onNavigate("operationSettings")}
            className="mb-4 inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2"
          >
            ← 戻る
          </button>

          <div className="text-center">
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-wide">
              🏆 リーグ設定
            </h1>
            <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
            <p className="text-sm opacity-80 mt-3">
              選択したリーグ設定は保存され、次回起動時も引き継がれます。
            </p>
          </div>
        </header>

        <main className="flex-1 flex flex-col justify-center gap-4">
          <OptionCard
            selected={mode === "pony"}
            title="ポニーリーグ"
            desc="ポニーリーグ用のルール・アナウンスで動作"
            onClick={() => handleSelect("pony")}
          />

          <OptionCard
            selected={mode === "boys"}
            title="ボーイズリーグ"
            desc="ボーイズリーグ用のルール・アナウンスで動作"
            onClick={() => handleSelect("boys")}
          />

          <div className="rounded-2xl bg-white/10 border border-white/10 p-4 text-sm opacity-90">
            現在の設定：
            <span className="font-bold ml-2">{getLeagueLabel(mode)}</span>
          </div>
        </main>
      </div>
    </div>
  );
}