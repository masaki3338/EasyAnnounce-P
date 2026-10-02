import React, { useEffect, useMemo, useRef, useState } from "react";
import { speak } from "../lib/tts";
import {
  benchmarkMatchaPerformance,
  notifyMatchaVoiceChanged,
  type MatchaPerformanceProgress,
  type MatchaPerformanceResult,
} from "../lib/matchaTts";
import { useWebSpeechVoices } from "../hooks/useWebSpeechVoices";

const MATCHA_TANIHO_VALUE = "__easy_announce_matcha_taniho__";
const MATCHA_UGUISU_VALUE = "__easy_announce_matcha_uguisu__";

const MATCHA_TANIHO_LABEL = "AI音声｜谷保恵美さん";
const MATCHA_UGUISU_LABEL = "AI音声｜ウグイス嬢";

const DEFAULT_TEST_TEXT =
  "ファウルボールの行方には十分ご注意ください";

const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);

function isPitchLikelyUnsupported(voiceName?: string) {
  if (!voiceName) return false;
  const n = voiceName.toLowerCase();
  return n.includes("microsoft") && n.includes("online") && n.includes("natural");
}

type Props = {
  onNavigate?: (screen: string) => void;
  onBack?: () => void;
};

function readSavedMatchaVoice(): "taniho" | "uguisu" {
  const saved =
    localStorage.getItem("tts:matcha:voice") ||
    localStorage.getItem("tts:matcha:model") ||
    localStorage.getItem("tts:piper:model") ||
    "";

  return saved === "uguisu" || saved === "easy-announce-2"
    ? "uguisu"
    : "taniho";
}

function saveMatchaVoice(voice: "taniho" | "uguisu") {
  // 現行キー
  localStorage.setItem("tts:engine", "matcha");
  localStorage.setItem("tts:matcha:voice", voice);
  localStorage.setItem("tts:matcha:model", voice);

  // 旧実装（固定MP3等）との互換キーも同時更新
  localStorage.setItem(
    "tts:piper:model",
    voice === "uguisu" ? "easy-announce-2" : "easy-announce-1"
  );
}

export default function TtsSettings({ onNavigate, onBack }: Props) {
  const { voices, ready } = useWebSpeechVoices("ja");

  const DEFAULT_RATE = 1.3;
  const DEFAULT_PITCH = 1.0;
  const DEFAULT_VOLUME = 0.8;

  const [speed, setSpeed] = useState<number>(() => {
    const v = Number(localStorage.getItem("tts:speedScale"));
    return Number.isFinite(v) ? Math.min(2, Math.max(0.5, v)) : DEFAULT_RATE;
  });

  const [pitch, setPitch] = useState<number>(() => {
    const v = Number(localStorage.getItem("tts:pitch"));
    return Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : DEFAULT_PITCH;
  });

  const [volume, setVolume] = useState<number>(() => {
    const v = Number(localStorage.getItem("tts:volume"));
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_VOLUME;
  });

  const [selectedName, setSelectedName] = useState<string>(() => {
    const engine = localStorage.getItem("tts:engine");

    if (engine === "matcha" || engine === "piper") {
      const voice = readSavedMatchaVoice();
      saveMatchaVoice(voice);
      return voice === "uguisu"
        ? MATCHA_UGUISU_VALUE
        : MATCHA_TANIHO_VALUE;
    }

    return localStorage.getItem("tts:webspeech:voiceName") || "";
  });

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [showAiVoiceNotice, setShowAiVoiceNotice] = useState(false);
  const [testText, setTestText] = useState(DEFAULT_TEST_TEXT);
  const [aiPerformance, setAiPerformance] =
    useState<MatchaPerformanceResult | null>(null);
  const [isCheckingAiPerformance, setIsCheckingAiPerformance] =
    useState(false);
  const [aiPerformanceProgress, setAiPerformanceProgress] =
    useState<MatchaPerformanceProgress | null>(null);
  const [aiPerformanceError, setAiPerformanceError] = useState("");

  const onceRef = useRef(false);
  useEffect(() => {
    if (!ready || onceRef.current) return;
    onceRef.current = true;

    if (!selectedName && voices.length > 0) {
      const def = voices.find((v) => v.default) || voices[0];
      setSelectedName(def.name);
      localStorage.setItem("tts:webspeech:voiceName", def.name);
      localStorage.setItem("tts:engine", "webspeech");
    }
  }, [ready, voices, selectedName]);

  const selectedLabel = useMemo(() => {
    if (selectedName === MATCHA_TANIHO_VALUE) return MATCHA_TANIHO_LABEL;
    if (selectedName === MATCHA_UGUISU_VALUE) return MATCHA_UGUISU_LABEL;

    const v = voices.find((voice) => voice.name === selectedName);
    return v ? `${v.name} (${v.lang})` : "未選択";
  }, [voices, selectedName]);

  const isMatchaVoice =
    selectedName === MATCHA_TANIHO_VALUE ||
    selectedName === MATCHA_UGUISU_VALUE;

  const pitchUnsupported =
    !isMatchaVoice && isPitchLikelyUnsupported(selectedName || undefined);

  const runAiPerformanceCheck = async () => {
    if (isCheckingAiPerformance) return;

    setIsCheckingAiPerformance(true);
    setAiPerformance(null);
    setAiPerformanceProgress("preparing");
    setAiPerformanceError("");

    try {
      const result = await benchmarkMatchaPerformance((progress) => {
        setAiPerformanceProgress(progress);
      });
      setAiPerformance(result);
      setAiPerformanceProgress("complete");
    } catch (error) {
      console.error("[TTS settings] AI performance check failed:", error);
      setAiPerformance(null);
      setAiPerformanceProgress(null);
      setAiPerformanceError(
        "AI音声の動作チェックに失敗しました。もう一度お試しください。"
      );
    } finally {
      setIsCheckingAiPerformance(false);
    }
  };

  const handleSelectVoice = (name: string) => {
    setSelectedName(name);

    if (name === MATCHA_TANIHO_VALUE) {
      saveMatchaVoice("taniho");
      notifyMatchaVoiceChanged();
      setAiPerformance(null);
      setAiPerformanceProgress("preparing");
      setAiPerformanceError("");
      setShowAiVoiceNotice(true);
      void runAiPerformanceCheck();
      return;
    }

    if (name === MATCHA_UGUISU_VALUE) {
      saveMatchaVoice("uguisu");
      notifyMatchaVoiceChanged();
      setAiPerformance(null);
      setAiPerformanceProgress("preparing");
      setAiPerformanceError("");
      setShowAiVoiceNotice(true);
      void runAiPerformanceCheck();
      return;
    }

    localStorage.setItem("tts:engine", "webspeech");
    localStorage.setItem("tts:webspeech:voiceName", name);
    setShowAiVoiceNotice(false);
    setAiPerformanceProgress(null);
    setAiPerformanceError("");
  };

  const handleSpeedChange = (v: number) => {
    const clamped = Math.min(2, Math.max(0.5, v));
    setSpeed(clamped);
    localStorage.setItem("tts:speedScale", String(clamped));
  };

  const handlePitchChange = (v: number) => {
    const clamped = Math.min(2, Math.max(0, v));
    setPitch(clamped);
    localStorage.setItem("tts:pitch", String(clamped));
  };

  const handleVolumeChange = (v: number) => {
    const clamped = Math.min(1, Math.max(0, v));
    setVolume(clamped);
    localStorage.setItem("tts:volume", String(clamped));
  };

  const handleTest = async () => {
    if (isSpeaking) return;
    const text = testText.trim();
    if (!text) return;

    setIsSpeaking(true);
    try {
      await speak(text, {
        voiceName: isMatchaVoice ? undefined : selectedName || undefined,
        speedScale: speed,
        pitch,
        volume,
      });
    } catch (error) {
      console.error("[TTS settings] test speak failed:", error);
    } finally {
      setIsSpeaking(false);
    }
  };

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-slate-900 to-slate-800 text-white flex flex-col items-center px-5"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-[720px]">
        <div className="w-[100svw] -mx-5 md:mx-0 md:w-full flex items-center justify-between mb-3">
          <button
            onClick={() => (onBack ? onBack() : onNavigate?.("operation-settings"))}
            className="flex items-center gap-1 text-white/95 active:scale-95 px-3 py-2 rounded-xl bg-white/10 border border-white/10 backdrop-blur-sm shadow-sm"
          >
            <IconBack />
            <span className="text-sm">運用設定に戻る</span>
          </button>
          <div className="w-10" />
        </div>

        <div className="mt-1 text-center select-none mb-3 w-full">
          <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-wide leading-tight">
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              🔊 読み上げ設定
            </span>
          </h1>
          <p className="text-white/70 text-sm mt-1">
            端末音声またはEasyアナウンスAI音声を選択し、読み上げを調整
          </p>
        </div>

        <section className="w-[100svw] -mx-5 md:mx-0 md:w-full rounded-none md:rounded-3xl p-4 md:p-6 bg-white/5 border border-white/10 ring-1 ring-inset ring-white/10 shadow-xl shadow-black/20 backdrop-blur-md">
          <div className="rounded-2xl bg-gradient-to-b from-white/5 to-white/[0.03] border border-white/10 p-4 md:p-5 shadow-md shadow-black/20">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-2xl bg-sky-500/20 ring-1 ring-inset ring-sky-300/30">🗣️</span>
              <h2 className="text-lg md:text-xl font-bold tracking-wide">使う音声</h2>
            </div>

            <select
              className="w-full rounded-2xl bg-white text-gray-800 p-3 pr-10 shadow-inner focus:outline-none focus:ring-4 focus:ring-sky-400/40"
              value={selectedName}
              onChange={(e) => handleSelectVoice(e.target.value)}
            >
              <option value={MATCHA_TANIHO_VALUE}>★ {MATCHA_TANIHO_LABEL}</option>
              <option value={MATCHA_UGUISU_VALUE}>★ {MATCHA_UGUISU_LABEL}</option>
              {voices.length === 0 && <option value="">（利用可能な端末音声が見つかりません）</option>}
              {voices.map((v) => (
                <option key={`${v.name}__${v.voiceURI}`} value={v.name}>
                  {v.default ? "★ " : ""}{v.name} ({v.lang})
                </option>
              ))}
            </select>

            <div className="mt-2 text-sm text-white/85">
              現在の選択：<span className="font-semibold">{selectedLabel}</span>
            </div>
            {isMatchaVoice && (
              <p className="mt-2 text-xs text-white/60 leading-relaxed">
                ⚠️AI音声は、本人の音声ではありません。イメージをもとに制作したAI音声です。
              </p>
            )}
          </div>

          {isMatchaVoice && aiPerformance && !showAiVoiceNotice && (
            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 mt-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base md:text-lg font-bold">
                    📱 AI音声 動作チェック結果
                  </h2>
                  <p className={`text-sm mt-1 font-semibold ${
                    aiPerformance.level === "good"
                      ? "text-emerald-300"
                      : aiPerformance.level === "warning"
                      ? "text-amber-300"
                      : "text-rose-300"
                  }`}>
                    {aiPerformance.level === "good"
                      ? `✅ 使用できます（約${(aiPerformance.generationMs / 1000).toFixed(1)}秒）`
                      : aiPerformance.level === "warning"
                      ? `⚠️ 遅延する場合があります（約${(aiPerformance.generationMs / 1000).toFixed(1)}秒）`
                      : `⛔ 端末音声を推奨します（約${(aiPerformance.generationMs / 1000).toFixed(1)}秒）`}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setShowAiVoiceNotice(true);
                    void runAiPerformanceCheck();
                  }}
                  className="shrink-0 px-3 h-10 rounded-xl bg-cyan-600/80 hover:bg-cyan-500 border border-cyan-300/20 text-white text-sm font-semibold"
                >
                  再チェック
                </button>
              </div>
            </div>
          )}

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg md:text-xl font-bold">⏩ 読み上げ速度</h2>
              <div className="text-sm text-white/80">x{speed.toFixed(1)}</div>
            </div>
            <input
              type="range"
              min={0.5}
              max={2}
              step={0.1}
              value={speed}
              onChange={(e) => handleSpeedChange(Number(e.target.value))}
              className="w-full accent-sky-400"
            />
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg md:text-xl font-bold">🎚️ 声の高さ（ピッチ）</h2>
              <div className="text-sm text-white/80">{pitch.toFixed(1)}</div>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={pitch}
              onChange={(e) => handlePitchChange(Number(e.target.value))}
              className={`w-full accent-fuchsia-400 ${isMatchaVoice ? "opacity-50" : ""}`}
              disabled={isMatchaVoice}
            />
            {isMatchaVoice && <p className="text-xs text-white/60 mt-2">※ AI音声ではピッチ設定は使用しません。</p>}
            {pitchUnsupported && <p className="text-xs text-amber-300 mt-2">※ この端末音声はピッチが反映されない場合があります。</p>}
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 mt-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg md:text-xl font-bold">🔈 音量</h2>
              <div className="text-sm text-white/80">{volume.toFixed(2)}</div>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              className="w-full accent-orange-400"
            />
          </div>

          <div className="rounded-2xl bg-white/5 border border-white/10 p-4 md:p-5 mt-5">
            <h2 className="text-lg md:text-xl font-bold mb-3">📝 テスト文章</h2>
            <textarea
              value={testText}
              onChange={(e) => setTestText(e.target.value)}
              rows={4}
              spellCheck={false}
              className="w-full resize-y min-h-[104px] rounded-2xl bg-white text-gray-900 p-3 md:p-4 text-base leading-relaxed shadow-inner focus:outline-none focus:ring-4 focus:ring-cyan-400/40"
            />
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setTestText(DEFAULT_TEST_TEXT)}
                disabled={isSpeaking}
                className="shrink-0 px-4 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold"
              >
                比較文に戻す
              </button>
              <button
                type="button"
                onClick={() => setTestText("")}
                disabled={isSpeaking}
                className="shrink-0 px-4 h-10 rounded-xl bg-white/10 border border-white/15 text-sm font-semibold"
              >
                クリア
              </button>
            </div>
            <button
              onClick={handleTest}
              disabled={isSpeaking || !testText.trim()}
              className={`w-full h-12 mt-4 rounded-2xl text-white font-semibold shadow-lg ${
                isSpeaking || !testText.trim()
                  ? "bg-gray-500/60 cursor-not-allowed"
                  : "bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500"
              }`}
            >
              {isSpeaking ? "読み上げ中..." : "現在の設定でテスト読み上げ"}
            </button>
          </div>
        </section>
      </div>

      {showAiVoiceNotice && isMatchaVoice && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-3xl bg-slate-800 border border-white/15 shadow-2xl p-5 md:p-6">
            <h2 className="text-xl font-bold text-white text-center">
              AI音声について
            </h2>

            <div className="mt-4 rounded-2xl border border-amber-300/60 bg-amber-400/10 px-4 py-3 text-amber-50">
              <div className="flex items-start gap-3">
                <span className="shrink-0 text-2xl leading-none" aria-hidden="true">
                  ⚠️
                </span>
                <p className="text-sm leading-relaxed">
                  AI音声は、本人の音声ではありません。イメージをもとに制作したAI音声です。
                </p>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div className="font-bold text-white">
                  📱 この端末でAI音声をチェック
                </div>

                {isCheckingAiPerformance && (
                  <div className="text-xs font-semibold text-cyan-100">
                    チェック中
                  </div>
                )}
              </div>

              {isCheckingAiPerformance && (
                <>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-cyan-300 transition-all duration-300"
                      style={{
                        width:
                          aiPerformanceProgress === "preparing"
                            ? "15%"
                            : aiPerformanceProgress === "g2p"
                            ? "40%"
                            : aiPerformanceProgress === "inference"
                            ? "70%"
                            : aiPerformanceProgress === "judging"
                            ? "90%"
                            : aiPerformanceProgress === "complete"
                            ? "100%"
                            : "5%",
                      }}
                    />
                  </div>

                  <div className="mt-4 flex items-center gap-3">
                    <div className="h-5 w-5 rounded-full border-2 border-cyan-200/30 border-t-cyan-200 animate-spin" />
                    <div className="text-sm font-semibold text-cyan-50">
                      {aiPerformanceProgress === "preparing"
                        ? "AIモデルを準備しています..."
                        : aiPerformanceProgress === "g2p"
                        ? "文章をAI音声用データに変換しています..."
                        : aiPerformanceProgress === "inference"
                        ? "AI音声を生成しています..."
                        : aiPerformanceProgress === "judging"
                        ? "この端末で快適に使えるか判定しています..."
                        : "チェックしています..."}
                    </div>
                  </div>

                  <div className="mt-4 space-y-2 text-xs">
                    <div className={
                      aiPerformanceProgress === "preparing"
                        ? "text-cyan-100 font-semibold"
                        : "text-emerald-300"
                    }>
                      {aiPerformanceProgress === "preparing" ? "●" : "✓"} AIモデルの準備
                    </div>

                    <div className={
                      aiPerformanceProgress === "g2p"
                        ? "text-cyan-100 font-semibold"
                        : ["inference", "judging", "complete"].includes(aiPerformanceProgress || "")
                        ? "text-emerald-300"
                        : "text-white/35"
                    }>
                      {["inference", "judging", "complete"].includes(aiPerformanceProgress || "")
                        ? "✓"
                        : "●"}{" "}
                      文章の変換
                    </div>

                    <div className={
                      aiPerformanceProgress === "inference"
                        ? "text-cyan-100 font-semibold"
                        : ["judging", "complete"].includes(aiPerformanceProgress || "")
                        ? "text-emerald-300"
                        : "text-white/35"
                    }>
                      {["judging", "complete"].includes(aiPerformanceProgress || "")
                        ? "✓"
                        : "●"}{" "}
                      AI音声の生成
                    </div>

                    <div className={
                      aiPerformanceProgress === "judging"
                        ? "text-cyan-100 font-semibold"
                        : aiPerformanceProgress === "complete"
                        ? "text-emerald-300"
                        : "text-white/35"
                    }>
                      {aiPerformanceProgress === "complete" ? "✓" : "●"} 端末性能の判定
                    </div>
                  </div>
                </>
              )}

              {!isCheckingAiPerformance && aiPerformance?.level === "good" && (
                <div className="mt-3 rounded-xl border border-emerald-300/40 bg-emerald-500/15 px-4 py-3 text-emerald-50">
                  <div className="font-bold">
                    ✅ この端末ではAI音声を使用できます
                  </div>
                  <p className="mt-1 text-sm leading-relaxed">
                    AI音声の生成時間は約
                    {(aiPerformance.generationMs / 1000).toFixed(1)}
                    秒でした。読み上げ開始の遅延は比較的小さいと判断しました。
                  </p>
                </div>
              )}

              {!isCheckingAiPerformance && aiPerformance?.level === "warning" && (
                <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-400/15 px-4 py-3 text-amber-50">
                  <div className="font-bold">
                    ⚠️ AI音声の読み上げが遅れる場合があります
                  </div>
                  <p className="mt-1 text-sm leading-relaxed">
                    AI音声の生成時間は約
                    {(aiPerformance.generationMs / 1000).toFixed(1)}
                    秒でした。試合中に待ち時間が気になる場合は、AI音声以外の端末音声を選択してください。
                  </p>
                </div>
              )}

              {!isCheckingAiPerformance && aiPerformance?.level === "slow" && (
                <div className="mt-3 rounded-xl border border-rose-300/60 bg-rose-500/20 px-4 py-3 text-rose-50">
                  <div className="font-bold">
                    ⛔ この端末ではAI音声の使用をおすすめしません
                  </div>
                  <p className="mt-2 text-sm leading-relaxed">
                    この端末ではAI音声の処理能力が不足しているため、
                    AI音声を選択して読み上げると大きな遅延が発生する可能性があります。
                  </p>
                  <p className="mt-2 text-sm font-bold">
                    AI音声以外の端末音声を選択してください。
                  </p>
                  <p className="mt-2 text-xs text-rose-100/80">
                    測定したAI音声生成時間：約
                    {(aiPerformance.generationMs / 1000).toFixed(1)}秒
                  </p>
                </div>
              )}

              {!isCheckingAiPerformance && aiPerformanceError && (
                <div className="mt-3 rounded-xl border border-amber-300/50 bg-amber-400/15 px-4 py-3 text-sm text-amber-50">
                  {aiPerformanceError}
                  <button
                    type="button"
                    onClick={() => void runAiPerformanceCheck()}
                    className="mt-3 w-full h-10 rounded-xl bg-cyan-600 text-white font-semibold"
                  >
                    もう一度チェック
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => setShowAiVoiceNotice(false)}
              disabled={isCheckingAiPerformance}
              className={`mt-5 w-full h-12 rounded-2xl text-white font-bold shadow-lg ${
                isCheckingAiPerformance
                  ? "bg-gray-500/60 cursor-not-allowed"
                  : "bg-gradient-to-r from-sky-600 to-blue-600"
              }`}
            >
              {isCheckingAiPerformance
                ? "チェック完了までお待ちください"
                : "OK"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}