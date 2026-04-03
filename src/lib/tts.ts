// src/lib/tts.ts  — Web Speech API 専用版（VOICEVOX非依存）

type SpeakOptions = {
  progressive?: boolean; // 互換用: 未使用
  cache?: boolean;       // 互換用: 未使用
  speaker?: number;      // 互換用: 未使用
  speedScale?: number;   // 読み上げ速度 (0.5〜2.0推奨)
  voiceName?: string;    // 音声名（任意）
  pitch?: number;        // 0〜2 (既定 1.2)
  volume?: number;       // 0〜1 (既定 1.0)
};

let __wsUnlocked = false;
let sessionCounter = 0;          // 停止でインクリメントして旧セッションを無効化
let speaking = false;

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

  // 「○番」を「(かな)ばん」に置換（番が付くものだけ）
  t = t.replace(/[0-9０-９]\s*番/g, (m) => {
    const d = toHalfWidthDigits(m.replace(/\s/g, "").replace("番", ""));
    const kana = ORDER_KANA[d];
    return kana ? `${kana}ばん` : m;
  });

  // ✅ 単独の「0」を「ゼロ」に
  t = t.replace(/(^|[^0-9０-９])0(?![0-9０-９])/g, "$1ゼロ");

  // ✅ 第○試合 の読みを補正
  t = t.replace(/第1試合/g, "だいいちしあい");
  t = t.replace(/第2試合/g, "だいにしあい");
  t = t.replace(/第3試合/g, "だいさんしあい");
  t = t.replace(/第4試合/g, "だいよんしあい");
  t = t.replace(/第5試合/g, "だいごしあい");

  // ✅ メンバー表 の読みを補正
  t = t.replace(/メンバー表/g, "めんばーひょう");

  t = t.replace(/先攻/g, "せんこう");
  t = t.replace(/後攻/g, "こうこう");
  t = t.replace(/四氏/g, "よんし");
  t = t.replace(/行方/g, "ゆくえ");

  return t;
}
// ---- utilities -------------------------------------------------------------
// 置き換え（既存の hardCancelSpeechSynthesis を以下に差し替え）
function hardCancelSpeechSynthesis(deferred = false) {
  try { window.speechSynthesis.cancel(); } catch {}

  if (deferred) {
    // UIの「停止」用: 旧セッションの取りこぼしを確実に止める
    try { setTimeout(() => window.speechSynthesis.cancel(), 0); } catch {}
    try { requestAnimationFrame(() => window.speechSynthesis.cancel()); } catch {}
  }
}


async function waitForVoices(maxWaitMs = 1000): Promise<void> {
  return new Promise((resolve) => {
    const voices = window.speechSynthesis.getVoices();
    if (voices && voices.length > 0) return resolve();

    const timer = setTimeout(() => { clearInterval(iv); resolve(); }, maxWaitMs);
    const iv = setInterval(() => {
      const v = window.speechSynthesis.getVoices();
      if (v && v.length > 0) { clearInterval(iv); clearTimeout(timer); resolve(); }
    }, 50);
  });
}

function pickVoice(preferredName?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices() || [];
  if (preferredName) {
    const hit = voices.find(v => v.name === preferredName);
    if (hit) return hit;
  }
  const ja = voices.filter(v => (v.lang || "").toLowerCase().startsWith("ja"));
  return ja[0] || voices[0];
}

function splitJaSentences(text: string): string[] {
  return String(text)
    .split(/([。！？!?]\s*|\n+)/)
    .reduce<string[]>((acc, cur, i, arr) => {
      if (i % 2 === 0) acc.push(cur + (arr[i + 1] || ""));
      return acc;
    }, [])
    .map(s => s.trim())
    .filter(Boolean);
}

async function unlockWebSpeech(voiceName?: string) {
  if (__wsUnlocked) return;
  try {
    await waitForVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "ja-JP";
    u.volume = 0; u.rate = 1; u.pitch = 1;
    const v = pickVoice(voiceName);
    if (v) u.voice = v;
    hardCancelSpeechSynthesis(false);
    window.speechSynthesis.speak(u);
    __wsUnlocked = true;
  } catch { /* ignore */ }
}

// ---- public API ------------------------------------------------------------
export async function speak(text: string, options: SpeakOptions = {}) {
  if (!text || !text.trim()) return;

  text = normalizeSpeechText(text); // ★追加（ここが一括適用ポイント）

  // ローカル設定の既定値
  // ローカル設定の既定値（LS未設定時のフォールバック）
  const DEFAULT_RATE   = 1.3;
  const DEFAULT_PITCH  = 1.0;
  const DEFAULT_VOLUME = 0.8;

  const lsSpeed   = Number(localStorage.getItem("tts:speedScale"));
  const lsWSName  = localStorage.getItem("tts:webspeech:voiceName") || undefined;
  const lsPitch   = Number(localStorage.getItem("tts:pitch"));
  const lsVolume  = Number(localStorage.getItem("tts:volume"));

  const voiceName = options.voiceName ?? lsWSName;

  const rate = Number.isFinite(options.speedScale)
    ? Math.max(0.5, Math.min(2.0, Number(options.speedScale)))
    : (Number.isFinite(lsSpeed) ? Math.max(0.5, Math.min(2.0, lsSpeed)) : DEFAULT_RATE);

  const pitch = Number.isFinite(options.pitch)
    ? Math.max(0.0, Math.min(2.0, Number(options.pitch)))
    : (Number.isFinite(lsPitch) ? Math.max(0.0, Math.min(2.0, lsPitch)) : DEFAULT_PITCH);

  const volume = Number.isFinite(options.volume)
    ? Math.max(0.0, Math.min(1.0, Number(options.volume)))
    : (Number.isFinite(lsVolume) ? Math.max(0.0, Math.min(1.0, lsVolume)) : DEFAULT_VOLUME);


  try { await unlockWebSpeech(voiceName); } catch {}

  // 重要：先に完全停止して既存キュー/イベント連鎖を断つ
// 内部停止（遅延なし）→ 次tick/次フレームまで待ってから開始
sessionCounter++;      // 新セッション開始（旧イベント無効化）
speaking = false;
hardCancelSpeechSynthesis(false);  // ← 遅延なし

await new Promise<void>(r => setTimeout(r, 0));               // 次のtick
await new Promise<void>(r => requestAnimationFrame(() => r())); // 次フレーム
const mySession = sessionCounter;

  await waitForVoices();
  const pick = pickVoice(voiceName);

  const chunks = splitJaSentences(text);
  if (chunks.length === 0) return;

  // 逐次再生（各ステップでセッション確認。停止されたら即中断）
  await new Promise<void>((resolve) => {
    let i = 0;

    const playNext = () => {
      if (mySession !== sessionCounter) return resolve(); // 停止で無効化済み
      if (i >= chunks.length) { speaking = false; return resolve(); }

      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = "ja-JP";
      if (pick) u.voice = pick;
      u.rate = rate;
      u.pitch = pitch;
      u.volume = volume;


      u.onend = () => {
        if (mySession !== sessionCounter) return resolve(); // 停止後の連鎖防止
        // 少し待ってから次へ（環境依存の取りこぼし対策）
        setTimeout(playNext, 40);
      };
      u.onerror = () => {
        if (mySession !== sessionCounter) return resolve();
        setTimeout(playNext, 0); // エラーでも続行。ただし停止されていれば続行しない
      };

      speaking = true;
      try { window.speechSynthesis.speak(u); } catch { speaking = false; resolve(); }
    };

    playNext();
  });
}

// 置き換え
export function stop() {
  sessionCounter++;      // 旧セッションの onend/onerror/タイマーは無効化
  speaking = false;
  hardCancelSpeechSynthesis(true); // ★ UI停止は deferred = true
}


// 任意：状態参照が必要なら
export function isSpeaking() { return speaking; }

// 互換用: 事前ウォームアップ（無音1文字でモバイルのロック解除）
export async function prewarmTTS(): Promise<void> {
  try {
    const name = localStorage.getItem("tts:webspeech:voiceName") || undefined;
    await waitForVoices();
    const u = new SpeechSynthesisUtterance(" ");
    u.lang = "ja-JP";
    u.volume = 0; u.rate = 1; u.pitch = 1;
    if (name) {
      const hit = window.speechSynthesis.getVoices().find(v => v.name === name);
      if (hit) u.voice = hit;
    }
    hardCancelSpeechSynthesis(false);
    window.speechSynthesis.speak(u);
    __wsUnlocked = true;
  } catch { /* ignore */ }
}