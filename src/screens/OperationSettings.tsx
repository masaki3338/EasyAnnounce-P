// src/screens/OperationSettings.tsx
import type { ScreenType } from "../App";
import React, { useEffect, useState } from "react";
import localForage from "localforage";
import { getLeagueMode } from "../lib/leagueSettings";


type AnnouncementTimingSettings = {
  coolingEnabled: boolean;
  coolingMinutes: number;
  coolingAnnouncementMinutes: number;
  coolingFirstInning: number;
  coolingSecondInning: number | null;
  groundMaintenanceInning: number | null;
};

const DEFAULT_ANNOUNCEMENT_TIMING_SETTINGS: AnnouncementTimingSettings = {
  coolingEnabled: false,
  coolingMinutes: 3,
  coolingAnnouncementMinutes: 1,
  coolingFirstInning: 3,
  coolingSecondInning: 5,
  groundMaintenanceInning: 5,
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const NumberStepper: React.FC<{
  value: number;
  min: number;
  max: number;
  suffix: string;
  onChange: (value: number) => void;
}> = ({ value, min, max, suffix, onChange }) => (
  <div className="grid grid-cols-[48px_1fr_48px] items-center gap-2">
    <button
      type="button"
      onClick={() => onChange(clamp(value - 1, min, max))}
      disabled={value <= min}
      className="h-11 rounded-xl bg-slate-700 text-xl font-bold disabled:opacity-35 active:scale-95"
    >
      −
    </button>
    <div className="h-11 rounded-xl bg-white/10 border border-white/10 flex items-center justify-center font-bold">
      {value}{suffix}
    </div>
    <button
      type="button"
      onClick={() => onChange(clamp(value + 1, min, max))}
      disabled={value >= max}
      className="h-11 rounded-xl bg-slate-700 text-xl font-bold disabled:opacity-35 active:scale-95"
    >
      ＋
    </button>
  </div>
);

type Props = {
  onNavigate: (s: ScreenType) => void;
};

const TileButton: React.FC<{
  icon: React.ReactNode;
  title: string;
  desc?: string;
  onClick: () => void;
}> = ({ icon, title, desc, onClick }) => (
  <button
    onClick={onClick}
    className="w-full rounded-2xl bg-white/10 hover:bg-white/15 border border-white/10 p-4 text-left shadow-lg active:scale-95 transition flex items-center gap-4"
  >
    <div className="w-11 h-11 flex items-center justify-center rounded-xl bg-white/10 border border-white/10 shrink-0">
      {icon}
    </div>
    <div className="min-w-0">
      <div className="font-semibold leading-tight">{title}</div>
      {desc && <div className="text-xs opacity-80 mt-0.5 truncate">{desc}</div>}
    </div>
  </button>
);

export default function OperationSettings({ onNavigate }: Props) {
  const [showManual, setShowManual] = useState(false);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [timingSettings, setTimingSettings] =
    useState<AnnouncementTimingSettings>(DEFAULT_ANNOUNCEMENT_TIMING_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const saved =
        (await localForage.getItem<Partial<AnnouncementTimingSettings>>(
          "announcementTimingSettings"
        )) || {};
      setTimingSettings({
        ...DEFAULT_ANNOUNCEMENT_TIMING_SETTINGS,
        ...saved,
      });
      setSettingsLoaded(true);
    })();
  }, []);

  useEffect(() => {
    if (!settingsLoaded) return;
    void localForage.setItem("announcementTimingSettings", timingSettings);
    window.dispatchEvent(
      new CustomEvent("easyannounce:timing-settings-changed", {
        detail: timingSettings,
      })
    );
  }, [timingSettings, settingsLoaded]);

  const updateTimingSettings = (
    patch: Partial<AnnouncementTimingSettings>
  ) => {
    setTimingSettings((prev) => ({ ...prev, ...patch }));
  };

  const leagueMode = getLeagueMode();
  const manualFile = leagueMode === "boys" ? "Boysmanual.pdf" : "manual.pdf";
  const manualTitle =
    leagueMode === "boys"
      ? "ボーイズリーグ 連盟アナウンスマニュアル"
      : "ポニーリーグ 連盟アナウンスマニュアル";

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-4 sm:px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <header className="relative w-full max-w-2xl">
        <button
          type="button"
          onClick={() => setShowHelpModal(true)}
          aria-label="運用設定画面の使い方"
          title="使い方"
          className="
            absolute right-0 top-0 z-20
            w-10 h-10 rounded-full
            bg-sky-600 hover:bg-sky-700
            text-white font-bold text-lg
            shadow-md
            flex items-center justify-center
            active:scale-95
          "
        >
          ？
        </button>

        <div className="mt-3 text-center select-none">
          <h1
            className="
              inline-flex items-center gap-2
              text-3xl md:text-4xl font-extrabold tracking-wide leading-tight
            "
          >
            <span className="text-2xl md:text-3xl">⚙️</span>
            <span
              className="
                bg-clip-text text-transparent
                bg-gradient-to-r from-white via-blue-100 to-blue-400
                drop-shadow
              "
            >
              運用設定
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
        </div>
      </header>

      <div className="flex-1 w-full max-w-2xl flex flex-col gap-4 py-5">
        <TileButton
          icon={<span className="text-2xl">⚾️</span>}
          title="規定投球数"
          desc="学年別・大会別の上限"
          onClick={() => onNavigate("pitchLimit")}
        />

        <TileButton
          icon={<span className="text-2xl">🔀</span>}
          title="タイブレークルール"
          desc="開始回・無死満塁など"
          onClick={() => onNavigate("tiebreakRule")}
        />

        <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-2xl">💧</span>
            <div>
              <h2 className="font-bold">クーリングタイム</h2>
              <p className="text-xs opacity-75">指定した回の裏終了時に表示</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            {[{ label: "なし", value: false }, { label: "あり", value: true }].map((item) => (
              <label
                key={item.label}
                className={`h-11 rounded-xl border flex items-center justify-center gap-2 font-bold ${
                  timingSettings.coolingEnabled === item.value
                    ? "bg-sky-600 border-sky-400"
                    : "bg-white/5 border-white/15"
                }`}
              >
                <input
                  type="radio"
                  name="coolingEnabled"
                  checked={timingSettings.coolingEnabled === item.value}
                  onChange={() => updateTimingSettings({ coolingEnabled: item.value })}
                  className="accent-sky-500"
                />
                {item.label}
              </label>
            ))}
          </div>

          {timingSettings.coolingEnabled && (
            <div className="mt-4 space-y-4">
              <div>
                <div className="text-sm font-semibold mb-2">クーリング時間</div>
                <NumberStepper
                  value={timingSettings.coolingMinutes}
                  min={1}
                  max={30}
                  suffix="分"
                  onChange={(coolingMinutes) => updateTimingSettings({ coolingMinutes })}
                />
              </div>

              <div>
                <div className="text-sm font-semibold mb-2">残りアナウンス</div>
                <select
                  value={timingSettings.coolingAnnouncementMinutes}
                  onChange={(e) =>
                    updateTimingSettings({
                      coolingAnnouncementMinutes: Number(e.target.value),
                    })
                  }
                  className="w-full h-11 rounded-xl bg-slate-800 border border-white/15 px-3 text-white font-bold"
                >
                  <option value={0}>なし</option>
                  {Array.from({ length: 30 }, (_, i) => i + 1).map((minutes) => (
                    <option key={minutes} value={minutes}>{minutes}分</option>
                  ))}
                </select>
                {timingSettings.coolingAnnouncementMinutes > 0 &&
                  timingSettings.coolingAnnouncementMinutes >= timingSettings.coolingMinutes && (
                    <p className="mt-2 text-xs text-amber-300">
                      残りアナウンスはクーリング時間より短く設定してください。
                    </p>
                  )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="block">
                  <span className="block text-sm font-semibold mb-2">1回目</span>
                  <select
                    value={timingSettings.coolingFirstInning}
                    onChange={(e) =>
                      updateTimingSettings({ coolingFirstInning: Number(e.target.value) })
                    }
                    className="w-full h-11 rounded-xl bg-slate-800 border border-white/15 px-3 text-white"
                  >
                    {Array.from({ length: 9 }, (_, i) => i + 1).map((inningNo) => (
                      <option key={inningNo} value={inningNo}>{inningNo}回裏</option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="block text-sm font-semibold mb-2">2回目</span>
                  <select
                    value={timingSettings.coolingSecondInning ?? "none"}
                    onChange={(e) =>
                      updateTimingSettings({
                        coolingSecondInning:
                          e.target.value === "none" ? null : Number(e.target.value),
                      })
                    }
                    className="w-full h-11 rounded-xl bg-slate-800 border border-white/15 px-3 text-white"
                  >
                    <option value="none">なし</option>
                    {Array.from({ length: 9 }, (_, i) => i + 1).map((inningNo) => (
                      <option key={inningNo} value={inningNo}>{inningNo}回裏</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
          )}
        </section>

        <section className="rounded-2xl bg-white/10 border border-white/10 p-4 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-2xl">🧹</span>
            <div>
              <h2 className="font-bold">グラウンド整備</h2>
              <p className="text-xs opacity-75">指定した回の裏終了時に表示  ※ ポニーリーグは4回裏</p>
            </div>
          </div>
          <select
            value={timingSettings.groundMaintenanceInning ?? "none"}
            onChange={(e) =>
              updateTimingSettings({
                groundMaintenanceInning:
                  e.target.value === "none" ? null : Number(e.target.value),
              })
            }
            className="mt-4 w-full h-12 rounded-xl bg-slate-800 border border-white/15 px-3 text-white font-bold"
          >
            <option value="none">なし</option>
            {Array.from({ length: 9 }, (_, i) => i + 1).map((inningNo) => (
              <option key={inningNo} value={inningNo}>{inningNo}回裏</option>
            ))}
          </select>
        </section>

        <TileButton
          icon={<span className="text-2xl">📘</span>}
          title="連盟アナウンスマニュアル"
          desc="PDFをアプリ内で表示"
          onClick={() => setShowManual(true)}
        />

        <TileButton
          icon={<span className="text-2xl">🔊</span>}
          title="読み上げ設定"
          desc="声 / 話速"
          onClick={() => onNavigate("tts-settings")}
        />

        <TileButton
          icon={<span className="text-2xl">🏆</span>}
          title="リーグ設定"
          desc="ポニーリーグ / ボーイズリーグ"
          onClick={() => onNavigate("league-settings")}
        />
        <TileButton
          icon={<span className="text-2xl">🎤</span>}
          title="アナウンスモード"
          desc="自チームのみ / 両チームを1人でアナウンス"
          onClick={() => onNavigate("announcement-mode")}
        />
        <TileButton
          icon={<span className="text-2xl">📔</span>}
          title="チュートリアル"
          desc="使い方"
          onClick={() => onNavigate("tutorial")}
        />

        <TileButton
          icon={<span className="text-2xl">❓</span>}
          title="Q＆A"
          desc="よくある質問"
          onClick={() => onNavigate("qa")}
        />

        <TileButton
          icon={<span className="text-2xl">✉️</span>}
          title="お問い合わせ"
          desc="不具合・要望はこちら"
          onClick={() => onNavigate("contact")}
        />

        <TileButton
          icon={<span className="text-2xl">ℹ️</span>}
          title="バージョン情報"
          desc="ビルド番号・更新履歴"
          onClick={() => onNavigate("versionInfo")}
        />
      </div>


      {showHelpModal && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 px-3 py-3"
          role="dialog"
          aria-modal="true"
          aria-label="運用設定画面の使い方"
          onClick={() => setShowHelpModal(false)}
        >
          <div
            className="
              w-full max-w-[min(96vw,900px)]
              max-h-[88svh]
              overflow-hidden
              rounded-[22px]
              bg-white
              text-slate-900
              shadow-[0_20px_60px_rgba(0,0,0,0.35)]
              flex flex-col
            "
            onClick={(e) => e.stopPropagation()}
            role="document"
          >
            {/* ヘッダー */}
            <div className="flex items-center justify-between bg-sky-600 px-4 py-3 text-white">
              <div className="flex items-center gap-2">
                <span className="text-[18px] leading-none">❓</span>
                <h2 className="text-[18px] font-extrabold leading-tight tracking-[0.01em]">
                  運用設定画面の使い方
                </h2>
              </div>

              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                aria-label="閉じる"
                className="
                  flex h-8 w-8 items-center justify-center
                  rounded-full bg-white/20 text-[18px] font-bold text-white
                  transition hover:bg-white/30 active:scale-95
                "
              >
                ×
              </button>
            </div>

            {/* 本文 */}
            <div className="overflow-y-auto bg-white px-4 py-4">
              <div className="space-y-3">

                <div className="rounded-[16px] border border-sky-200 bg-sky-50 px-3 py-3">
                  <p className="text-[13px] font-semibold leading-5 text-slate-800">
                    この画面では、試合で使用する
                    <span className="font-bold">
                      投球数・タイブレーク・クーリングタイム・グラウンド整備・読み上げ・リーグ・アナウンスモード
                    </span>
                    などを設定できます。
                  </p>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
                    <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                      おすすめ
                    </div>
                    <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                      試合開始前に一度確認してください
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] border border-emerald-200 bg-white px-3 py-3 shadow-sm">
                  <h3 className="text-[15px] font-extrabold leading-tight text-emerald-700">
                    試合ルール・タイミング設定
                  </h3>

                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
                      <div className="font-bold text-amber-800">⚾ 規定投球数</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        学年や大会規定に合わせて、投球数の上限を設定します。
                      </p>
                    </div>

                    <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
                      <div className="font-bold text-violet-800">🔀 タイブレークルール</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        タイブレーク開始時のアウト数やランナー配置などを設定します。
                      </p>
                    </div>

                    <div className="rounded-xl border border-sky-200 bg-sky-50 px-3 py-3">
                      <div className="font-bold text-sky-800">💧 クーリングタイム</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        クーリングタイムの有無、時間、残り時間アナウンス、表示する回を設定します。
                      </p>
                      <p className="mt-1 text-[12.5px] leading-5 text-sky-900">
                        「なし」にすると自動表示しません。
                      </p>
                    </div>

                    <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-3">
                      <div className="font-bold text-teal-800">🧹 グラウンド整備</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        グラウンド整備のアナウンスを表示する回を設定します。
                      </p>
                      <p className="mt-1 text-[12.5px] leading-5 text-teal-900">
                        「なし」にすると自動表示しません。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] border border-blue-200 bg-white px-3 py-3 shadow-sm">
                  <h3 className="text-[15px] font-extrabold leading-tight text-blue-700">
                    アナウンス・表示設定
                  </h3>

                  <div className="mt-3 space-y-3">
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
                      <div className="font-bold text-rose-800">🔊 読み上げ設定</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        声や読み上げ速度など、音声に関する設定を変更します。
                      </p>
                    </div>

                    <div className="rounded-xl border border-cyan-200 bg-cyan-50 px-3 py-3">
                      <div className="font-bold text-cyan-800">🏆 リーグ設定</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        ポニーリーグ／ボーイズリーグを切り替えます。
                      </p>
                      <p className="mt-1 text-[12.5px] leading-5 text-cyan-900">
                        選択したリーグに合わせて、試合中の機能やアナウンス内容が切り替わります。
                      </p>
                    </div>

                    <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-3">
                      <div className="font-bold text-indigo-800">🎤 アナウンスモード</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        「自チームのみ」と「両チームを1人でアナウンス」を切り替えます。
                      </p>
                    </div>

                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
                      <div className="font-bold text-slate-800">📘 連盟アナウンスマニュアル</div>
                      <p className="mt-1.5 text-[13px] leading-5 text-slate-700">
                        現在選択しているリーグの連盟アナウンスマニュアルを表示します。
                      </p>
                    </div>
                  </div>
                </div>

                <div className="rounded-[16px] border border-orange-200 bg-orange-50 px-3 py-3 shadow-sm">
                  <h3 className="text-[15px] font-extrabold leading-tight text-orange-700">
                    困ったとき
                  </h3>
                  <div className="mt-2 space-y-1 text-[13px] leading-5 text-slate-700">
                    <p><span className="font-bold">【チュートリアル】</span> … 基本的な使い方を確認できます。</p>
                    <p><span className="font-bold">【Q＆A】</span> … よくある質問を確認できます。</p>
                    <p><span className="font-bold">【お問い合わせ】</span> … 不具合や要望を送るときに使用します。</p>
                    <p><span className="font-bold">【バージョン情報】</span> … 更新履歴などを確認できます。</p>
                  </div>
                </div>

              </div>
            </div>

            {/* フッター */}
            <div className="border-t bg-white px-3 pb-3 pt-2">
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="
                  w-full rounded-2xl
                  bg-emerald-600 py-3
                  text-[15px] font-bold text-white
                  shadow-sm transition
                  hover:bg-emerald-700 active:scale-[0.98]
                "
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {showManual && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm">
          <div
            className="
              h-[100svh] w-full
              flex flex-col
              bg-slate-950
              sm:px-3 sm:py-3
            "
            style={{
              paddingTop: "max(8px, env(safe-area-inset-top))",
              paddingBottom: "max(8px, env(safe-area-inset-bottom))",
              paddingLeft: "max(8px, env(safe-area-inset-left))",
              paddingRight: "max(8px, env(safe-area-inset-right))",
            }}
          >
            <div
              className="
                flex-1 min-h-0 w-full
                bg-slate-900
                sm:rounded-3xl
                sm:border sm:border-white/10
                sm:shadow-2xl
                overflow-hidden
                flex flex-col
              "
            >
              {/* ヘッダー */}
              <div className="shrink-0 px-4 sm:px-5 py-3 border-b border-white/10 bg-slate-900/95">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-base sm:text-lg font-bold leading-tight">
                      {manualTitle}
                    </div>
                    <div className="text-xs sm:text-sm text-white/65 mt-1 break-all">
                      {manualFile}
                    </div>
                  </div>

                  <button
                    onClick={() => setShowManual(false)}
                    className="shrink-0 rounded-xl border border-white/15 bg-white/10 hover:bg-white/15 px-3 py-2 text-sm font-semibold"
                    aria-label="閉じる"
                  >
                    ✕
                  </button>
                </div>
              </div>

              {/* PDF表示エリア */}
              <div className="flex-1 min-h-0 bg-white">
                <iframe
                  title={manualTitle}
                  src={`/${manualFile}#toolbar=0&navpanes=0&scrollbar=1&view=FitH`}
                  className="w-full h-full"
                />
              </div>

              {/* フッター */}
              <div className="shrink-0 px-4 sm:px-5 py-3 border-t border-white/10 bg-slate-900">
                <button
                  onClick={() => setShowManual(false)}
                  className="
                    w-full rounded-2xl
                    bg-blue-600 hover:bg-blue-500 active:scale-[0.98]
                    transition font-bold
                    py-3.5 text-base sm:text-lg
                    shadow-lg
                  "
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}