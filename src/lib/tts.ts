import { prewarmPiper, speakPiper, stopPiper } from "./piperTts";
// src/lib/tts.ts  — Web Speech API 専用版（VOICEVOX非依存）

type SpeakOptions = {
  progressive?: boolean; // 互換用: 未使用
  cache?: boolean;       // 互換用: 未使用
  speaker?: number;      // 互換用: 未使用
  speedScale?: number;   // 読み上げ速度 (0.5〜2.0推奨)
  voiceName?: string;    // 音声名（任意）
  pitch?: number;        // 0〜2
  volume?: number;       // 0〜1
};

let __wsUnlocked = false;
let sessionCounter = 0; // 停止でインクリメントして旧セッションを無効化
let speaking = false;

function getTtsEngine(): "webspeech" | "piper" {
  return localStorage.getItem("tts:engine") === "piper" ? "piper" : "webspeech";
}


// ---- speech normalize ------------------------------------------------------
const ORDER_KANA: Record<string, string> = {
  "1": "いち",
  "2": "に",
  "3": "さん",
  "4": "よ",
  "5": "ご",
  "6": "ろく",
  "7": "なな",
  "8": "はち",
  "9": "きゅう",
};

function toHalfWidthDigits(s: string) {
  return s.replace(/[０-９]/g, (c) => String(c.charCodeAt(0) - 0xfee0));
}

/**
 * 読み上げ直前の文章を野球アナウンス向けに正規化する
 * - 例: "4番" / "４番" / "4 番" → "よばん"
 */
function normalizeSpeechText(input: string): string {
  let t = String(input);

  // 「○番」を「(かな)ばん」に置換。
  // 打順は分割・個別ピッチ変更をせず、「いちばん」のように一続きで読み上げる。
  t = t.replace(/[0-9０-９]\s*番/g, (m) => {
    const d = toHalfWidthDigits(m.replace(/\s/g, "").replace("番", ""));
    const kana = ORDER_KANA[d];
    return kana ? `${kana}ばん` : m;
  });

  // 単独の「0」を「ゼロ」に
  t = t.replace(/(^|[^0-9０-９])0(?![0-9０-９])/g, "$1ゼロ");

  // 第○試合 の読みを補正
  t = t.replace(/第1試合/g, "だいいちしあい");
  t = t.replace(/第2試合/g, "だいにしあい");
  t = t.replace(/第3試合/g, "だいさんしあい");
  t = t.replace(/第4試合/g, "だいよんしあい");
  t = t.replace(/第5試合/g, "だいごしあい");

  // メンバー表 の読みを補正
  t = t.replace(/メンバー表/g, "めんばーひょう");

  t = t.replace(/先攻/g, "せんこう");
  t = t.replace(/後攻/g, "こうこう");
  t = t.replace(/四氏/g, "よんし");
  t = t.replace(/行方/g, "ゆくえ");
  t = t.replace(/尚/g, "なお");

  // 「お知らせいたします」が Web Speech 側で
  // 「お知らせいた」＋「します」のように不自然に切られるのを防ぐ。
  // 表示文言は変更せず、読み上げ直前だけ「致します」表記にして
  // TTSに一続きの敬語表現として認識させる。
  t = t.replace(/お知らせいたします/g, "お知らせ致します");

  return t;
}

// ---- utilities -------------------------------------------------------------
function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// 長文だけ少し速くする（全音声共通で効かせやすい控えめ設定）
function getAutoAdjustedRate(text: string, baseRate: number): number {
  const normalized = String(text)
    .replace(/\s/g, "")
    .replace(/[、。！？!?]/g, "");

  const len = normalized.length;
  let adjusted = baseRate;

  // 控えめに上げる
  if (len >= 100) {
    adjusted = baseRate + 0.08;
  } else if (len >= 60) {
    adjusted = baseRate + 0.04;
  }

  return clamp(adjusted, 0.5, 2.0);
}

// 既存の hardCancelSpeechSynthesis を差し替え
function hardCancelSpeechSynthesis(deferred = false) {
  try {
    window.speechSynthesis.cancel();
  } catch {}

  if (deferred) {
    // UIの「停止」用: 旧セッションの取りこぼしを確実に止める
    try {
      setTimeout(() => window.speechSynthesis.cancel(), 0);
    } catch {}
    try {
      requestAnimationFrame(() => window.speechSynthesis.cancel());
    } catch {}
  }
}

async function waitForVoices(maxWaitMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) return resolve();

    const timer = setTimeout(() => {
      clearInterval(iv);
      resolve();
    }, maxWaitMs);

    const iv = setInterval(() => {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) {
        clearInterval(iv);
        clearTimeout(timer);
        resolve();
      }
    }, 50);
  });
}

function pickVoice(preferredName?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices() || [];

  if (preferredName) {
    const hit = voices.find((v) => v.name === preferredName);
    if (hit) return hit;
  }

  const ja = voices.filter((v) =>
    (v.lang || "").toLowerCase().startsWith("ja")
  );

  return ja[0] || voices[0];
}

function splitJaSentences(text: string): string[] {
  return String(text)
    .split(/([。！？!?]\s*|\n+)/)
    .reduce<string[]>((acc, cur, i, arr) => {
      if (i % 2 === 0) acc.push(cur + (arr[i + 1] || ""));
      return acc;
    }, [])
    .map((s) => s.trim())
    .filter(Boolean);
}

async function unlockWebSpeech(voiceName?: string) {
  if (__wsUnlocked) return;

  try {
    await waitForVoices();

    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "ja-JP";
    u.volume = 0;
    u.rate = 1;
    u.pitch = 1;

    const v = pickVoice(voiceName);
    if (v) u.voice = v;

    hardCancelSpeechSynthesis(false);
    window.speechSynthesis.speak(u);
    __wsUnlocked = true;
  } catch {
    // ignore
  }
}

// ---- public API ------------------------------------------------------------
export async function speak(text: string, options: SpeakOptions = {}) {
  if (!text || !text.trim()) return;

  text = normalizeSpeechText(text);

  // ローカル設定の既定値（LS未設定時のフォールバック）
  const DEFAULT_RATE = 1.0;
  const DEFAULT_PITCH = 1.0;
  const DEFAULT_VOLUME = 0.8;

  const lsSpeed = Number(localStorage.getItem("tts:speedScale"));
  const lsWSName = localStorage.getItem("tts:webspeech:voiceName") || undefined;
  const lsPitch = Number(localStorage.getItem("tts:pitch"));
  const lsVolume = Number(localStorage.getItem("tts:volume"));

  const voiceName = options.voiceName ?? lsWSName;

  const baseRate = Number.isFinite(options.speedScale)
    ? clamp(Number(options.speedScale), 0.5, 2.0)
    : Number.isFinite(lsSpeed)
      ? clamp(lsSpeed, 0.5, 2.0)
      : DEFAULT_RATE;

  const rate = getAutoAdjustedRate(text, baseRate);

  const pitch = Number.isFinite(options.pitch)
    ? clamp(Number(options.pitch), 0.0, 2.0)
    : Number.isFinite(lsPitch)
      ? clamp(lsPitch, 0.0, 2.0)
      : DEFAULT_PITCH;

  const volume = Number.isFinite(options.volume)
    ? clamp(Number(options.volume), 0.0, 1.0)
    : Number.isFinite(lsVolume)
      ? clamp(lsVolume, 0.0, 1.0)
      : DEFAULT_VOLUME;

  // Piper-Plus選択時はブラウザ内WASMで生成（サーバー不要）
  if (getTtsEngine() === "piper") {
    speaking = true;
    try {
      await speakPiper(text, {
        speedScale: baseRate,
        volume,
      });
    } finally {
      speaking = false;
    }
    return;
  }

  try {
    await unlockWebSpeech(voiceName);
  } catch {}

  // 重要：先に完全停止して既存キュー/イベント連鎖を断つ
  // 内部停止（遅延なし）→ 次tick/次フレームまで待ってから開始
  sessionCounter++; // 新セッション開始（旧イベント無効化）
  speaking = false;
  hardCancelSpeechSynthesis(false);

  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));
  const mySession = sessionCounter;

  await waitForVoices();
  const pick = pickVoice(voiceName);

  const chunks = splitJaSentences(text);
  if (chunks.length === 0) return;

  // 逐次再生（打順も文章の一部として分割せず、そのまま読み上げる）
  await new Promise<void>((resolve) => {
    let i = 0;

    const playNext = () => {
      if (mySession !== sessionCounter) return resolve();
      if (i >= chunks.length) {
        speaking = false;
        return resolve();
      }

      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = "ja-JP";
      if (pick) u.voice = pick;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = volume;

      u.onend = () => {
        if (mySession !== sessionCounter) return resolve();
        setTimeout(playNext, 0);
      };

      u.onerror = () => {
        if (mySession !== sessionCounter) return resolve();
        setTimeout(playNext, 0);
      };

      speaking = true;

      try {
        window.speechSynthesis.speak(u);
      } catch {
        speaking = false;
        resolve();
      }
    };

    playNext();
  });
}


// 複数の短い語句を「同じTTSセッション内」で別々の Utterance として連続再生する。
// 姓だけを独立させたい時など、アクセント解析を語ごとに分けるために使用する。
// 人工的な待ち時間は入れず、onend 後すぐ次を再生する。
export async function speakSegments(
  segments: string[],
  options: SpeakOptions = {}
) {
  const cleaned = (segments || [])
    .map((s) => normalizeSpeechText(String(s ?? "")).trim())
    .filter(Boolean);

  if (cleaned.length === 0) return;

  const DEFAULT_RATE = 1.0;
  const DEFAULT_PITCH = 1.0;
  const DEFAULT_VOLUME = 0.8;

  const lsSpeed = Number(localStorage.getItem("tts:speedScale"));
  const lsWSName = localStorage.getItem("tts:webspeech:voiceName") || undefined;
  const lsPitch = Number(localStorage.getItem("tts:pitch"));
  const lsVolume = Number(localStorage.getItem("tts:volume"));

  const voiceName = options.voiceName ?? lsWSName;

  const baseRate = Number.isFinite(options.speedScale)
    ? clamp(Number(options.speedScale), 0.5, 2.0)
    : Number.isFinite(lsSpeed)
      ? clamp(lsSpeed, 0.5, 2.0)
      : DEFAULT_RATE;

  const pitch = Number.isFinite(options.pitch)
    ? clamp(Number(options.pitch), 0.0, 2.0)
    : Number.isFinite(lsPitch)
      ? clamp(lsPitch, 0.0, 2.0)
      : DEFAULT_PITCH;

  const volume = Number.isFinite(options.volume)
    ? clamp(Number(options.volume), 0.0, 1.0)
    : Number.isFinite(lsVolume)
      ? clamp(lsVolume, 0.0, 1.0)
      : DEFAULT_VOLUME;

  // Piper は Web Speech の Utterance キューを使えないため、語ごとに順番に生成する。
  if (getTtsEngine() === "piper") {
    speaking = true;
    try {
      for (const segment of cleaned) {
        await speakPiper(segment, {
          speedScale: baseRate,
          volume,
        });
      }
    } finally {
      speaking = false;
    }
    return;
  }

  try {
    await unlockWebSpeech(voiceName);
  } catch {}

  sessionCounter++;
  speaking = false;
  hardCancelSpeechSynthesis(false);

  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const mySession = sessionCounter;

  await waitForVoices();
  const pick = pickVoice(voiceName);

  await new Promise<void>((resolve) => {
    let i = 0;

    const playNext = () => {
      if (mySession !== sessionCounter) return resolve();
      if (i >= cleaned.length) {
        speaking = false;
        return resolve();
      }

      const segment = cleaned[i++];
      const u = new SpeechSynthesisUtterance(segment);
      u.lang = "ja-JP";
      if (pick) u.voice = pick;
      u.rate = getAutoAdjustedRate(segment, baseRate);
      u.pitch = pitch;
      u.volume = volume;

      u.onend = () => {
        if (mySession !== sessionCounter) return resolve();
        // 姓→名の間に人工的な待ち時間は入れない
        playNext();
      };

      u.onerror = () => {
        if (mySession !== sessionCounter) return resolve();
        playNext();
      };

      speaking = true;

      try {
        window.speechSynthesis.speak(u);
      } catch {
        speaking = false;
        resolve();
      }
    };

    playNext();
  });
}

export function stop() {
  sessionCounter++;

  stopPiper();

  speaking = false;
  hardCancelSpeechSynthesis(true);
}

export function isSpeaking() {
  return speaking;
}

// 互換用: 事前ウォームアップ（無音1文字でモバイルのロック解除）
export async function prewarmTTS(): Promise<void> {
  try {
    if (getTtsEngine() === "piper") {
      try {
        await prewarmPiper();
      } catch (error) {
        console.warn("Piper prewarm failed:", error);
      }
      return;
    }

    const name = localStorage.getItem("tts:webspeech:voiceName") || undefined;

    await waitForVoices();

    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "ja-JP";
    u.volume = 0;
    u.rate = 1;
    u.pitch = 1;

    if (name) {
      const hit = window.speechSynthesis.getVoices().find((v) => v.name === name);
      if (hit) u.voice = hit;
    }

    hardCancelSpeechSynthesis(false);
    window.speechSynthesis.speak(u);
    __wsUnlocked = true;
  } catch {
    // ignore
  }
}