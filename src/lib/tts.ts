import {
  prefetchMatcha,
  prewarmMatcha,
  speakMatcha,
  synthesizeMatchaPcmForJoin,
  playJoinedMatchaPcm,
  stopMatcha,
  unlockMatchaAudioForIOS,
  type MatchaPcmAudio,
} from "./matchaTts";

// src/lib/tts.ts
// Easyアナウンス Matcha-TTS
// - 1スレッドWorkerを維持して安定動作を優先
// - 起動時prewarmをバックグラウンド実行
// - 各画面のprefetchTTS()で読み上げ音声を先読み
// - 読み上げボタン自体は先読み完了待ちで無効化しない
// - 固定MP3はAI音声ごとのフォルダから最優先再生


// -----------------------------------------------------------------------------
// TTSデバッグログ
// 本番では false。必要なときだけ true にすると console.log が復活する。
// warn / error は異常検知のため常時残す。
// -----------------------------------------------------------------------------
const TTS_DEBUG = false;
const ttsDebugLog = (...args: any[]) => {
  if (TTS_DEBUG) console.log(...args);
};

type SpeakOptions = {
  progressive?: boolean;
  cache?: boolean;
  speaker?: number;
  speedScale?: number;
  voiceName?: string;
  pitch?: number;
  volume?: number;

  // 守備交代画面専用：
  // 打順(0001～0009)・守備位置(0010～0019)の固定MP3だけ使わず、
  // その部分はMatcha生成音声で読む。他の固定MP3は従来通り使用する。
  disableFixedBattingAndPositions?: boolean;

  // 再生中の「次の1文」専用先読み。
  // 通常prefetchと違い、foregroundの読み上げ中でも中止しない。
  // DefenseChangeなど、現在の音声を再生している間に次文を生成する用途。
  foregroundLookahead?: boolean;
};

let sessionCounter = 0;
let speaking = false;
let __wsUnlocked = false;

// -----------------------------------------------------------------------------
// 全画面共通：実際の読み上げをバックグラウンド先読みより最優先にする。
// speak()/speakJoinedTTS()/stop() が呼ばれるたびに世代を進め、
// それ以前に開始された prefetchTTS() は残りの生成を中止する。
// -----------------------------------------------------------------------------
let prefetchGeneration = 0;

function cancelBackgroundPrefetch(reason: string) {
  prefetchGeneration += 1;
  ttsDebugLog("[TTS PRIORITY] foreground wins", {
    reason,
    generation: prefetchGeneration,
  });
}

// -----------------------------------------------------------------------------
// 固定MP3（AI音声選択時のみ最優先）
// 谷保さん = public/audio/1/
// ウグイス嬢 = public/audio/2/
// 文末の句点の有無は問いません。長文中に含まれる固定文言もMP3を優先します。
// -----------------------------------------------------------------------------
let fixedAudioElement: HTMLAudioElement | null = null;
let fixedAudioFinish: (() => void) | null = null;

// 固定MP3は生成TTSより少し大きく聞こえるため、固定音声だけ約12%下げる。
// 1.0に戻せば補正なし。必要なら 0.85～0.95 の範囲で微調整可能。
const FIXED_AUDIO_VOLUME_SCALE = 0.80;

type FixedAudioEntry = {
  text: string;
  files: string[];
};

const FIXED_AUDIO_ENTRIES: ReadonlyArray<FixedAudioEntry> = [

  // 打順アナウンス
  { text: "1番", files: ["0001"] },
  { text: "イチバン", files: ["0001"] },
  { text: "2番", files: ["0002"] },
  { text: "ニバン", files: ["0002"] },
  { text: "3番", files: ["0003"] },
  { text: "サンバン", files: ["0003"] },
  { text: "4番", files: ["0004"] },
  { text: "ヨバン", files: ["0004"] },
  { text: "5番", files: ["0005"] },
  { text: "ゴバン", files: ["0005"] },
  { text: "6番", files: ["0006"] },
  { text: "ロクバン", files: ["0006"] },
  { text: "7番", files: ["0007"] },
  { text: "ナナバン", files: ["0007"] },
  { text: "8番", files: ["0008"] },
  { text: "ハチバン", files: ["0008"] },
  { text: "9番", files: ["0009"] },
  { text: "キュウバン", files: ["0009"] },
  // 守備位置アナウンス
  { text: "ピッチャー", files: ["0010"] },
  { text: "キャッチャー", files: ["0011"] },
  { text: "ファースト", files: ["0012"] },
  { text: "セカンド", files: ["0013"] },
  { text: "サード", files: ["0014"] },
  { text: "ショート", files: ["0015"] },
  { text: "レフト", files: ["0016"] },
  { text: "センター", files: ["0017"] },
  { text: "ライト", files: ["0018"] },  
  { text: "指名打者", files: ["0019"] },  

  { text: "ファウルボールの行方には十分ご注意ください", files: ["0378"] },
  { text: "ごらいじょうのみなさまにおねがいをいたします。しあいちゅう、スタンドにはいりますファウルボールはたいへんきけんでございます。だきゅうのゆくえにはじゅうぶんごちゅういください", files: ["404"] },

  { text: "この回の投球数は", files: ["0381"] },
  { text: "この回のとうきゅうすうは", files: ["0381"] },
  { text: "合計投球数は", files: ["0380"] },
  { text: "トータル", files: ["424"] },
  
  // 守備位置交代アナウンス
  { text: "選手の交代をお知らせいたします", files: ["0383"] },
  { text: "シートの変更をお知らせいたします", files: ["0384"] },
  { text: "選手の交代並びにシートの変更をお知らせいたします", files: ["0385"] },  
  { text: "以上に代わります", files: ["427"] },
  { text: "そのままハイリ", files: ["0387"] },
  { text: "リエントリーで", files: ["0391"] },
  { text: "先ほど代打いたしました", files: ["0386"] },
  { text: "先ほど代走いたしました", files: ["0388"] },
  { text: "同じく先ほど代打いたしました", files: ["0389"] },
  { text: "同じく先ほど代走いたしました", files: ["0390"] }, 

  // 次の試合アナウンス
  { text: "本日の第一試合、両チームのメンバー交換を行います。", files: ["440"] },
  { text: "本日の第2試合の両チームは、4回終了後、メンバー交換を行います", files: ["441"] },
  { text: "本日の第3試合の両チームは、4回終了後、メンバー交換を行います", files: ["442"] },
  { text: "両チームのキャプテンと全てのベンチ入り指導者は、ボール3個とメンバー表とピッチングレコードを持って本部席付近にお集まりください", files: ["401"] },
  { text: "ベンチ入りのスコアラー、審判員、球場責任者、EasyScore担当、公式記録員、アナウンスもお集まりください", files: ["402"] },
  { text: "メンバーチェックと道具チェックはシートノックの間に行います", files: ["439"] },
  // ウォーミングアップ  
  { text: "両チームはウォーミングアップに入ってください", files: ["0325"] },
  { text: "りょうチームはウォーミングアップニ入ってください。", files: ["0325"] },
  // 呼び出し元で「両」が読み仮名「りょう」に変換済みでも
  // 同じ固定MP3を確実に使用する。
  { text: "両チーム、交代してください", files: ["0328"] },
  { text: "りょうチーム、交代してください", files: ["0328"] },
  { text: "ウォーミングアップを終了してください", files: ["0329"] },
  // シートノック
  { text: "シートノックの準備に入ってください", files: ["0330"] },
  { text: "ノックを終了してください", files: ["0334"] },
  // 試合開始挨拶
  { text: "おまたせいたしました", files: ["0339"] },
  { text: "まもなくかいしでございます", files: ["0340"] },
   // 中断
  { text: "ご覧のような天候の為、試合を一時中断いたします。", files: ["445"] },
  { text: "お知らせいたします。雷雲が近づいている為、試合を一時中断いたします。スタンドの皆様も安全な場所に避難をお願い致します。", files: ["446"] },
  { text: "大変長らくお待たせをしております。ただいまからグラウンドの整備をおこないます。今しばらくお待ちください。", files: ["447"] },
  { text: "ご覧のような天候状態の為、本日の試合は中止とさせていただきます。", files: ["448"] },

  { text: "ご覧のような天候状態の為、試合続行が不可能となりましたのでこの試合は大会規定により、サスペンデッドゲームといたします。", files: ["449"] },

  // グラウンド整備  
  { text: "両チームはグランド整備をお願いします", files: ["0396"] },
  { text: "グランド整備、ありがとうございました", files: ["0397"] },
  // その他
  { text: "この試合は、ただ今で打ち切り、継続試合となります。明日以降に中断した時点から再開いたします。あしからずご了承くださいませ", files: ["413"] },
  { text: "本日は気温が高く、熱中症が心配されますので、水分をこまめにとり、体調に気を付けてください", files: ["425"] },
  // 試合終了アナウンス
  { text: "ただいまの試合は、ご覧のように", files: ["426"] },
  { text: "なおこの試合の終了時刻は", files: ["416"] },
  { text: "審判員の皆様、ありがとうございました", files: ["417"] },
  { text: "健闘しました両チームの選手に、盛大な拍手をお願いいたします", files: ["418"] },
  { text: "これより、ピッチングレコードの確認を行います", files: ["419"] },
  { text: "両チームの監督、キャプテンはピッチングレコードを記載の上、バックネット前にお集まりください", files: ["420"] },
  { text: "球審、EasyScore担当、公式記録員、球場役員もお集まりください", files: ["421"] },
  { text: "第2試合のグランド整備は、第2試合のシートノック終了後に行います。第1試合の選手は、グランド整備ご協力をよろしくお願いいたします。", files: ["443"] },
  { text: "第3試合のグランド整備は、第3試合のシートノック終了後に行います。第2試合の選手は、グランド整備ご協力をよろしくお願いいたします。", files: ["444"] },

  { text: "とうきゅうすうは", files: ["0379"] },
  { text: "合計とうきゅうすうは", files: ["0380"] },
];

function getSelectedMatchaVoice(): "taniho" | "uguisu" {
  try {
    const saved =
      localStorage.getItem("tts:matcha:voice") ||
      localStorage.getItem("tts:matcha:model") ||
      localStorage.getItem("tts:piper:model") ||
      "";

    if (saved === "uguisu" || saved === "easy-announce-2") {
      return "uguisu";
    }
  } catch {}
  return "taniho";
}

function getFixedAudioFolder(): string {
  return getSelectedMatchaVoice() === "uguisu" ? "2" : "1";
}

function getFixedAudioSrc(baseName: string): string {
  return `/audio/${getFixedAudioFolder()}/${baseName}.mp3`;
}

const fixedAudioPrefetchInFlight = new Map<string, Promise<boolean>>();


// 回先頭の分割結合再生でも固定MP3を使えるよう、MP3をPCMへdecodeして保持する。
// Matcha/Vocosは22.05kHzなので、固定MP3も22.05kHzのmono PCMへ揃える。
const JOIN_SAMPLE_RATE = 22050;
const fixedPcmCache = new Map<string, Promise<MatchaPcmAudio | null>>();
let fixedDecodeContext: AudioContext | null = null;

function getFixedDecodeContext(): AudioContext {
  if (fixedDecodeContext) return fixedDecodeContext;
  const Ctx = window.AudioContext || (window as any).webkitAudioContext;
  if (!Ctx) throw new Error('AudioContextが利用できません。');
  fixedDecodeContext = new Ctx();
  return fixedDecodeContext;
}

function resampleMonoLinear(
  input: Float32Array,
  inputRate: number,
  outputRate: number
): Float32Array {
  if (inputRate === outputRate) return input.slice();
  if (!input.length) return new Float32Array(0);

  const outLength = Math.max(1, Math.round(input.length * outputRate / inputRate));
  const out = new Float32Array(outLength);
  const ratio = inputRate / outputRate;

  for (let i = 0; i < outLength; i++) {
    const pos = i * ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const frac = pos - i0;
    out[i] = input[i0] * (1 - frac) + input[i1] * frac;
  }

  return out;
}

async function decodeFixedAudioToPcm(baseName: string): Promise<MatchaPcmAudio | null> {
  const src = getFixedAudioSrc(baseName);
  const cached = fixedPcmCache.get(src);
  if (cached) return cached;

  const promise = (async (): Promise<MatchaPcmAudio | null> => {
    try {
      const response = await fetch(src, { cache: 'force-cache' });
      if (!response.ok) return null;

      const arrayBuffer = await response.arrayBuffer();
      const ctx = getFixedDecodeContext();
      const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));

      // ステレオでもmonoへ平均化する。
      const mono = new Float32Array(decoded.length);
      const channels = Math.max(1, decoded.numberOfChannels);
      for (let ch = 0; ch < channels; ch++) {
        const data = decoded.getChannelData(ch);
        for (let i = 0; i < data.length; i++) mono[i] += data[i] / channels;
      }

      const samples = resampleMonoLinear(mono, decoded.sampleRate, JOIN_SAMPLE_RATE);

      // 結合再生時も固定MP3だけ同じ音量補正をかける。
      for (let i = 0; i < samples.length; i++) {
        samples[i] *= FIXED_AUDIO_VOLUME_SCALE;
      }
      ttsDebugLog('[TTS JOIN FIXED] decoded', {
        voice: getSelectedMatchaVoice(),
        src,
        inputRate: decoded.sampleRate,
        outputRate: JOIN_SAMPLE_RATE,
        durationSec: Math.round((samples.length / JOIN_SAMPLE_RATE) * 100) / 100,
      });

      return { samples, sampleRate: JOIN_SAMPLE_RATE };
    } catch (error) {
      console.warn('[TTS JOIN FIXED] decode failed', { src, error });
      return null;
    }
  })();

  fixedPcmCache.set(src, promise);
  return promise;
}

async function prefetchFixedAudioFile(baseName: string): Promise<boolean> {
  const src = getFixedAudioSrc(baseName);
  const existing = fixedAudioPrefetchInFlight.get(src);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const response = await fetch(src, { cache: "force-cache" });
      return response.ok;
    } catch {
      return false;
    }
  })();

  fixedAudioPrefetchInFlight.set(src, promise);
  try {
    return await promise;
  } finally {
    fixedAudioPrefetchInFlight.delete(src);
  }
}

function stopFixedAudio() {
  const finish = fixedAudioFinish;
  fixedAudioFinish = null;

  if (fixedAudioElement) {
    try { fixedAudioElement.pause(); } catch {}
    try { fixedAudioElement.currentTime = 0; } catch {}
    fixedAudioElement = null;
  }

  if (finish) {
    try { finish(); } catch {}
  }
}

async function playFixedAudioFile(
  baseName: string,
  volume: number
): Promise<void> {
  stopFixedAudio();

  const src = getFixedAudioSrc(baseName);
  const audio = new Audio(src);
  audio.preload = "auto";
  audio.volume = clamp(volume * FIXED_AUDIO_VOLUME_SCALE, 0, 1);
  fixedAudioElement = audio;

  await new Promise<void>((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      audio.onended = null;
      audio.onerror = null;
      if (fixedAudioFinish === finish) fixedAudioFinish = null;
      if (fixedAudioElement === audio) fixedAudioElement = null;
    };

    const finish = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };

    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    fixedAudioFinish = finish;
    audio.onended = finish;
    audio.onerror = () => fail(new Error(`固定音声の再生に失敗しました: ${src}`));

    try {
      const promise = audio.play();
      if (promise && typeof promise.catch === "function") {
        void promise.catch(fail);
      }
    } catch (error) {
      fail(error);
    }
  });
}

type HybridSegment =
  | { type: "tts"; text: string }
  | { type: "fixed"; text: string; files: string[] };

// 守備交代画面では打順(0001～0009)と守備位置(0010～0019)だけ固定MP3を除外する。

function isBattingOrPositionFixedEntry(entry: FixedAudioEntry): boolean {
  return entry.files.some((baseName) => {
    const n = Number(baseName);
    return Number.isFinite(n) && n >= 1 && n <= 19;
  });
}

function isBattingFixedEntry(entry: FixedAudioEntry): boolean {
  return entry.files.some((baseName) => {
    const n = Number(baseName);
    return Number.isFinite(n) && n >= 1 && n <= 9;
  });
}

function isPositionFixedEntry(entry: FixedAudioEntry): boolean {
  return entry.files.some((baseName) => {
    const n = Number(baseName);
    return Number.isFinite(n) && n >= 10 && n <= 19;
  });
}

// 固定MP3を使わない文脈判定
// 打順:
//   「8番」   -> 固定MP3を使う
//   「8番に」 -> 固定MP3を使わない
//
// 守備位置:
//   「ショート」   -> 固定MP3を使う
//   「ショートの」 -> 固定MP3を使わない
//   「ピッチャーに」-> 固定MP3を使わない
function shouldSkipFixedForFollowingParticle(
  source: string,
  originalEnd: number,
  entry: FixedAudioEntry
): boolean {
  const rest = source
    .slice(originalEnd)
    .replace(/^[\s\u3000\u00A0]+/, "");

  // 打順は「に」が直後に続くときだけ固定文を使わない。
  if (isBattingFixedEntry(entry)) {
    return rest.startsWith("に");
  }

  // 守備位置は助詞が直後に続くとき固定文を使わない。
  if (isPositionFixedEntry(entry)) {
    return /^(?:の|に|へ|を|が|は|で|と|から|まで)/.test(rest);
  }

  return false;
}

// 選手名の中に「ライト」「ショート」「センター」などが含まれていても、
// その文字列を守備位置の固定MP3として扱わない。
function getProtectedPlayerNameRanges(source: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];

  const patterns = [
    /[ァ-ヶヷヸヹヺー]{1,30}(?:[ 　][ァ-ヶヷヸヹヺー]{1,30})?(?:くん|さん|投手)/g,
    /[一-龯々〆ヵヶぁ-ゖァ-ヶヷヸヹヺー]{1,30}(?:[ 　][一-龯々〆ヵヶぁ-ゖァ-ヶヷヸヹヺー]{1,30})?(?:くん|さん|投手)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index == null) continue;
      ranges.push({
        start: match.index,
        end: match.index + match[0].length,
      });
    }
  }

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range.start > last.end) {
      merged.push({ ...range });
    } else {
      last.end = Math.max(last.end, range.end);
    }
  }

  return merged;
}

function isInsideProtectedPlayerName(
  start: number,
  end: number,
  protectedRanges: Array<{ start: number; end: number }>
): boolean {
  return protectedRanges.some(
    (range) => start >= range.start && end <= range.end
  );
}

// 固定文言の照合では、改行・半角/全角空白・ゼロ幅文字を無視する。
// 画面側で文の間に \n や空白が入っても、複数文の固定MP3を確実に拾う。
function compactFixedMatchText(value: string): {
  text: string;
  originalIndexes: number[];
} {
  const source = String(value ?? "");
  let compact = "";
  const originalIndexes: number[] = [];

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];

    if (/[\s\u3000\u200B\uFEFF]/.test(ch)) continue;

    compact += ch;
    originalIndexes.push(i);
  }

  return { text: compact, originalIndexes };
}

function splitByFixedAudio(
  originalText: string,
  options: Pick<SpeakOptions, "disableFixedBattingAndPositions"> = {}
): HybridSegment[] {
  const source = String(originalText ?? "");
  const result: HybridSegment[] = [];
  const compactSource = compactFixedMatchText(source);
  const protectedPlayerNameRanges = getProtectedPlayerNameRanges(source);

  let sourceCursor = 0;

  while (sourceCursor < source.length) {
    let compactCursor = 0;

    while (
      compactCursor < compactSource.originalIndexes.length &&
      compactSource.originalIndexes[compactCursor] < sourceCursor
    ) {
      compactCursor++;
    }

    let bestOriginalStart = -1;
    let bestOriginalEnd = -1;
    let bestEntry: FixedAudioEntry | null = null;
    let bestCompactLength = -1;

    for (const entry of FIXED_AUDIO_ENTRIES) {
      if (
        options.disableFixedBattingAndPositions &&
        isBattingOrPositionFixedEntry(entry)
      ) {
        continue;
      }

      const compactEntry = compactFixedMatchText(entry.text).text;
      if (!compactEntry) continue;

      const compactIndex = compactSource.text.indexOf(
        compactEntry,
        compactCursor
      );

      if (compactIndex < 0) continue;

      const compactEndIndex = compactIndex + compactEntry.length - 1;
      const originalStart = compactSource.originalIndexes[compactIndex];
      const originalEnd =
        compactSource.originalIndexes[compactEndIndex] + 1;

      // 打順・守備位置の固定MP3(0001～0019)が、
      // 「ライトくん」「ショートさん」のような選手名の内部にある場合は無視する。
      if (
        isBattingOrPositionFixedEntry(entry) &&
        isInsideProtectedPlayerName(
          originalStart,
          originalEnd,
          protectedPlayerNameRanges
        )
      ) {
        continue;
      }

      // 「8番に」「ショートの」「ピッチャーに」など、
      // 助詞まで一続きで読ませたい箇所では固定MP3に分割しない。
      if (
        isBattingOrPositionFixedEntry(entry) &&
        shouldSkipFixedForFollowingParticle(
          source,
          originalEnd,
          entry
        )
      ) {
        continue;
      }

      if (
        bestOriginalStart < 0 ||
        originalStart < bestOriginalStart ||
        (
          originalStart === bestOriginalStart &&
          compactEntry.length > bestCompactLength
        )
      ) {
        bestOriginalStart = originalStart;
        bestOriginalEnd = originalEnd;
        bestEntry = entry;
        bestCompactLength = compactEntry.length;
      }
    }

    if (
      bestOriginalStart < 0 ||
      bestOriginalEnd < 0 ||
      !bestEntry
    ) {
      result.push({
        type: "tts",
        text: source.slice(sourceCursor),
      });
      break;
    }

    if (bestOriginalStart > sourceCursor) {
      result.push({
        type: "tts",
        text: source.slice(sourceCursor, bestOriginalStart),
      });
    }

    const matchedOriginalText = source.slice(
      bestOriginalStart,
      bestOriginalEnd
    );

    ttsDebugLog("[TTS FIXED MATCH]", {
      text: bestEntry.text,
      files: bestEntry.files,
      matchedOriginalText,
    });

    result.push({
      type: "fixed",
      text: matchedOriginalText,
      files: [...bestEntry.files],
    });

    sourceCursor = bestOriginalEnd;
  }

  return result;
}

function hasSpeakableCharacters(text: string): boolean {
  return String(text ?? "")
    .replace(/[\s、。．,.！？!?「」『』（）()・…ー\-]/g, "")
    .length > 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function getTtsEngine(): "webspeech" | "matcha" {
  try {
    const engine = localStorage.getItem("tts:engine");

    // 旧Piper設定はMatchaへ移行。
    if (engine === "piper") {
      localStorage.setItem("tts:engine", "matcha");
      return "matcha";
    }

    if (engine === "matcha") return "matcha";
    return "webspeech";
  } catch {
    return "webspeech";
  }
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  return (
    /iP(hone|ad|od)/.test(ua) ||
    (/Macintosh/.test(ua) &&
      typeof document !== "undefined" &&
      "ontouchend" in document)
  );
}

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
  return s.replace(/[０-９]/g, (c) =>
    String(c.charCodeAt(0) - 0xfee0)
  );
}

export function preserveNameReading(input: string): string {
  return String(input ?? "").replace(/[ぁ-ゖ]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) + 0x60)
  );
}

function numberToJapaneseReading(n: number): string {
  if (!Number.isFinite(n) || n < 0 || n > 999) return String(n);
  if (n === 0) return "ゼロ";

  const ones: Record<number, string> = {
    1: "いち",
    2: "に",
    3: "さん",
    4: "よん",
    5: "ご",
    6: "ろく",
    7: "なな",
    8: "はち",
    9: "きゅう",
  };

  let x = Math.floor(n);
  let out = "";

  if (x >= 100) {
    const h = Math.floor(x / 100);
    out +=
      h === 1 ? "ひゃく" :
      h === 3 ? "さんびゃく" :
      h === 6 ? "ろっぴゃく" :
      h === 8 ? "はっぴゃく" :
      `${ones[h]}ひゃく`;
    x %= 100;
  }

  if (x >= 10) {
    const d = Math.floor(x / 10);
    out += d === 1 ? "じゅう" : `${ones[d]}じゅう`;
    x %= 10;
  }

  if (x > 0) out += ones[x];
  return out;
}

function normalizeSpeechText(input: string): string {
  let t = String(input ?? "");

  t = t.replace(/ノック時間\s*[、,]\s*は/g, "ノック時間は");
  t = t.replace(/明日以降に/g, "あすいこうに");
  t = t.replace(
    /りょうチームはウォーミングアップ\s*に\s*入ってください/g,
    "りょうチームはウォーミングアップニ入ってください"
  );
  t = t.replace(/おりはら/g, "オリハラ");
  t = t.replace(/よしかわ/g, "ヨシカワ");

  t = t.replace(/[0-9０-９]\s*番/g, (m) => {
    const d = toHalfWidthDigits(
      m.replace(/\s/g, "").replace("番", "")
    );
    const kana = ORDER_KANA[d];
    if (!kana) return m;

    // Matchaで「8番」の語頭が弱くなり「わちばん」のように聞こえることがあるため、
    // 8番だけ「はち」と「ばん」の語境界を空白で明示する。
    // 読点は入れないので、大きなポーズは作らない。
    if (d === "8") return "はちばん";

    return `${kana}ばん`;
  });

  t = t.replace(/([0-9０-９]+)\s*球/g, (m, raw) => {
    const n = Number(toHalfWidthDigits(String(raw)));
    if (!Number.isFinite(n)) return m;
    if (n % 10 === 8) {
      return `${preserveNameReading(numberToJapaneseReading(n))}キュウ`;
    }
    return m;
  });

  t = t.replace(/(^|[^0-9０-９])0(?![0-9０-９])/g, "$1ゼロ");

  const gameRead: Record<string, string> = {
    "1": "だいいちしあい",
    "2": "だいにしあい",
    "3": "だいさんしあい",
    "4": "だいよんしあい",
    "5": "だいごしあい",
    "6": "だいろくしあい",
    "7": "だいななしあい",
    "8": "だいはちしあい",
    "9": "だいきゅうしあい",
  };

  t = t.replace(/第([1-9１-９])試合/g, (m, d) => {
    const half = toHalfWidthDigits(String(d));
    return gameRead[half] ?? m;
  });

  // StartGreeting などで「だい1しあい」の形で渡される場合も
  // 「だいいちしあい」に揃えて発音を安定させる。
  t = t.replace(/だい([1-9１-９])しあい/g, (m, d) => {
    const half = toHalfWidthDigits(String(d));
    return gameRead[half] ?? m;
  });

  t = t.replace(/メンバー表/g, "めんばーひょう");
  t = t.replace(/先攻/g, "せんこう");
  t = t.replace(/後攻/g, "こうこう");
  t = t.replace(/四氏/g, "よんし");
  t = t.replace(/行方/g, "ゆくえ");
  t = t.replace(/尚/g, "なお");
  t = t.replace(/1回/g, "いっかい");
  t = t.replace(/表/g, "おもて");
  t = t.replace(/Easyscore/gi, "イージースコア");
  t = t.replace(/お知らせいたします/g, "お知らせ致します");
  t = t.replace(/下さい/g, "ください");
  t = t.replace(/、、+/g, "、");

  return t;
}

function normalizeMatchaSegmentText(input: string): string {
  return normalizeSpeechText(input)
    .replace(/^[\s。、，,.！？!?]+/, "")
    .trim();
}


// -----------------------------------------------------------------------------
// 試合開始挨拶の「○○たい△△のしあい」を強制的に2部品へ分割する。
// 実際のStartGreeting側が全文を1回の speak() に渡してきても、
// 「たい」の後だけ短い間を作る。
// ※「大会」の「たい」を誤検出しないよう、
//   「ほんじつの ... しあい、」を含む文だけを対象にする。
// -----------------------------------------------------------------------------
const START_GREETING_MATCHUP_GAP_MS = 120;

function splitStartGreetingMatchup(
  text: string
): [string, string] | null {
  const source = String(text ?? "").trim();

  if (!/ほんじつの/.test(source)) return null;
  if (!/しあい[、,]/.test(source)) return null;
  if (!/のしあい[、,。.]?$/.test(source)) return null;

  // 「ほんじつの だいいちしあい、」より後だけを見る。
  const firstGameComma = source.search(/しあい[、,]/);
  if (firstGameComma < 0) return null;

  const afterGameIndex = firstGameComma + source.slice(firstGameComma).search(/[、,]/) + 1;
  const head = source.slice(0, afterGameIndex);
  const matchup = source.slice(afterGameIndex);

  // 対戦文の最後の「たい」を境界にする。
  // チーム名の中に「たい」が含まれる可能性よりも、
  // 末尾「○○のしあい」に最も近い「たい」を優先する。
  const versusIndex = matchup.lastIndexOf("たい");
  if (versusIndex < 0) return null;

  const left = (head + matchup.slice(0, versusIndex + 2)).trim();
  const right = matchup.slice(versusIndex + 2).trim();

  if (!left || !right) return null;
  if (!/のしあい[、,。.]?$/.test(right)) return null;

  return [left, right];
}

function getAutoAdjustedRate(text: string, baseRate: number): number {
  const len = String(text)
    .replace(/\s/g, "")
    .replace(/[、。！？!?]/g, "")
    .length;

  if (len >= 100) return clamp(baseRate + 0.08, 0.5, 2.0);
  if (len >= 60) return clamp(baseRate + 0.04, 0.5, 2.0);
  return clamp(baseRate, 0.5, 2.0);
}

function loadCommonOptions(options: SpeakOptions) {
  const readStoredNumber = (key: string): number | null => {
    const raw = localStorage.getItem(key);
    if (raw == null || raw.trim() === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const lsSpeed = readStoredNumber("tts:speedScale");
  const lsPitch = readStoredNumber("tts:pitch");
  const lsVolume = readStoredNumber("tts:volume");
  const lsVoice = localStorage.getItem("tts:webspeech:voiceName") || undefined;

  return {
    voiceName: options.voiceName ?? lsVoice,
    baseRate: Number.isFinite(options.speedScale)
      ? clamp(Number(options.speedScale), 0.5, 2.0)
      : lsSpeed != null
      ? clamp(lsSpeed, 0.5, 2.0)
      : 1.0,
    pitch: Number.isFinite(options.pitch)
      ? clamp(Number(options.pitch), 0, 2)
      : lsPitch != null
      ? clamp(lsPitch, 0, 2)
      : 1.0,
    volume: Number.isFinite(options.volume)
      ? clamp(Number(options.volume), 0, 1)
      : lsVolume != null
      ? clamp(lsVolume, 0, 1)
      : 0.8,
  };
}

function hardCancelSpeechSynthesis() {
  try {
    window.speechSynthesis.cancel();
  } catch {}
}

async function waitForVoices(maxWaitMs = 1000): Promise<void> {
  if (window.speechSynthesis.getVoices().length > 0) return;

  await new Promise<void>((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (
        window.speechSynthesis.getVoices().length > 0 ||
        Date.now() - started >= maxWaitMs
      ) {
        window.clearInterval(timer);
        resolve();
      }
    }, 50);
  });
}

function pickVoice(name?: string): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices() || [];
  if (name) {
    const hit = voices.find((v) => v.name === name);
    if (hit) return hit;
  }
  return (
    voices.find((v) => (v.lang || "").toLowerCase().startsWith("ja")) ||
    voices[0]
  );
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
    hardCancelSpeechSynthesis();
    window.speechSynthesis.speak(u);
    __wsUnlocked = true;
  } catch {}
}

async function speakWebSpeech(
  text: string,
  options: ReturnType<typeof loadCommonOptions>
): Promise<void> {
  await unlockWebSpeech(options.voiceName);

  sessionCounter++;
  const mySession = sessionCounter;
  hardCancelSpeechSynthesis();

  await new Promise<void>((r) => window.setTimeout(r, 0));
  await waitForVoices();

  const voice = pickVoice(options.voiceName);
  const rate = getAutoAdjustedRate(text, options.baseRate);

  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "ja-JP";
    if (voice) u.voice = voice;
    u.rate = rate;
    u.pitch = options.pitch;
    u.volume = options.volume;

    u.onend = () => resolve();
    u.onerror = () => resolve();

    if (mySession !== sessionCounter) {
      resolve();
      return;
    }

    speaking = true;
    try {
      window.speechSynthesis.speak(u);
    } catch {
      resolve();
    }
  });
}

function showMatchaError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error("[TTS] Matcha読み上げ失敗:", error);

  try {
    window.alert(
      `AI音声の読み上げに失敗しました。\n\n${message}`
    );
  } catch {}
}

export async function speak(
  text: string,
  options: SpeakOptions = {}
): Promise<void> {
  const requestStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  const originalText = String(text ?? "");
  if (!originalText.trim()) return;

  const common = loadCommonOptions(options);

  if (getTtsEngine() === "matcha") {
    // 読み上げボタンが押された瞬間に、残りのバックグラウンド先読みを打ち切る。
    cancelBackgroundPrefetch("speak");

    ttsDebugLog("[TTS LATENCY] speak requested", {
      voice: getSelectedMatchaVoice(),
      textLength: originalText.length,
      at: Math.round(requestStartedAt * 10) / 10,
    });
    speaking = true;
    const mySession = ++sessionCounter;

    try {
      if (isIOSDevice()) {
        unlockMatchaAudioForIOS();
      }

      // 固定文言が含まれる場合は、その部分だけMP3を最優先で再生。
      // 固定MP3が無い/再生失敗の場合は、その部分もMatchaへフォールバック。
      const segments = splitByFixedAudio(originalText, options);

      // 投球数アナウンス専用：
      // 0381「この回の投球数は」や 424「トータル」を固定MP3で再生したあと、
      // 「〇球です」を別再生すると、MP3末尾無音＋次音声開始処理で間が長くなる。
      // そこで投球数アナウンス全体をPCMへ揃えて1回で再生する。
      const hasPitchCountFixedSegment = segments.some(
        (segment) =>
          segment.type === "fixed" &&
          segment.files.some(
            (baseName) =>
              baseName === "0381" ||
              baseName === "0380" ||
              baseName === "424"
          )
      );

      if (hasPitchCountFixedSegment && segments.length > 1) {
        const pcmParts: MatchaPcmAudio[] = [];

        for (const segment of segments) {
          if (mySession !== sessionCounter) return;

          if (segment.type === "fixed") {
            let fixedPcm: MatchaPcmAudio | null = null;

            for (const baseName of segment.files) {
              fixedPcm = await decodeFixedAudioToPcm(baseName);
              if (fixedPcm) {
                ttsDebugLog("[TTS PITCH JOIN FIXED] use", {
                  voice: getSelectedMatchaVoice(),
                  src: getFixedAudioSrc(baseName),
                  text: segment.text,
                });
                break;
              }
            }

            if (fixedPcm) {
              pcmParts.push(fixedPcm);
              continue;
            }
            // 固定MP3取得失敗時は、同じ文言をMatchaへフォールバック。
          }

          // 固定MP3の直後に「、〇球です」のような先頭読点が残ると
          // OpenJTalk側でpause扱いになり、つなぎが長くなるため読み上げ時だけ除去。
          const normalized = normalizeSpeechText(segment.text)
            .replace(/^[\s、，,]+/, "")
            .trim();

          if (!normalized || !hasSpeakableCharacters(normalized)) continue;

          const pcm = await synthesizeMatchaPcmForJoin(normalized, {
            speedScale: common.baseRate,
            volume: common.volume,
          });

          if (pcm) pcmParts.push(pcm);
        }

        if (pcmParts.length) {
          // つなぎは10ms。通常の35msより短くし、
          // 「投球数は→〇球です」「トータル→〇球です」を自然に連続させる。
          await playJoinedMatchaPcm(
            pcmParts,
            {
              speedScale: common.baseRate,
              volume: common.volume,
            },
            10
          );
          return;
        }
      }

      for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
        if (mySession !== sessionCounter) return;

        const segment = segments[segmentIndex];

        if (segment.type === "fixed") {
          // ---------------------------------------------------------------
          // 固定MP3を再生している時間を、次のMatcha生成時間として利用する。
          //
          // 例:
          // 「おまたせいたしました」(固定MP3) の再生を開始する直前に
          // 「第50回 SSK 関東連盟秋季大会。」の生成を先に開始する。
          //
          // 固定MP3が終わった時点で生成済みなら即再生、
          // 生成途中でも speakMatcha() は同じ in-flight Promise を引き継ぐので、
          // 残り時間だけ待てばよい。
          // ---------------------------------------------------------------
          const nextSegment = segments[segmentIndex + 1];

          if (nextSegment?.type === "tts") {
            const nextNormalized =
              normalizeMatchaSegmentText(nextSegment.text);

            if (
              nextNormalized &&
              hasSpeakableCharacters(nextNormalized)
            ) {
              ttsDebugLog("[TTS LOOKAHEAD] start while fixed audio plays", {
                voice: getSelectedMatchaVoice(),
                currentFixed: segment.text,
                nextTextLength: nextNormalized.length,
                nextTextPreview: nextNormalized
                  .replace(/\s+/g, " ")
                  .slice(0, 48),
              });

              // 発音補助は matchaTts.ts の音素列で行う。
              // 音声は1本のまま生成して、語間が不自然に空くのを防ぐ。
              void prefetchMatcha(nextNormalized, {
                speedScale: common.baseRate,
                volume: common.volume,
              });
            }
          }

          let played = false;

          for (const baseName of segment.files) {
            try {
              ttsDebugLog("[TTS FIXED] try", {
                voice: getSelectedMatchaVoice(),
                src: getFixedAudioSrc(baseName),
                text: segment.text,
              });

              await playFixedAudioFile(baseName, common.volume);
              played = true;

              ttsDebugLog("[TTS FIXED] played", {
                voice: getSelectedMatchaVoice(),
                src: getFixedAudioSrc(baseName),
              });

              break;
            } catch (error) {
              console.warn("[TTS FIXED] failed; try fallback", {
                src: getFixedAudioSrc(baseName),
                error,
              });
            }
          }

          if (played) continue;
        }

        const normalized = normalizeMatchaSegmentText(segment.text);
        if (!normalized || !hasSpeakableCharacters(normalized)) continue;

        const matchupParts = splitStartGreetingMatchup(normalized);

        if (matchupParts) {
          ttsDebugLog("[TTS MATCHUP FORCE PAUSE]", {
            gapMs: START_GREETING_MATCHUP_GAP_MS,
            left: matchupParts[0],
            right: matchupParts[1],
          });

          const pcmParts: MatchaPcmAudio[] = [];

          for (const part of matchupParts) {
            const pcm = await synthesizeMatchaPcmForJoin(part, {
              speedScale: common.baseRate,
              volume: common.volume,
            });

            if (pcm) pcmParts.push(pcm);
          }

          if (pcmParts.length === 2) {
            await playJoinedMatchaPcm(
              pcmParts,
              {
                speedScale: common.baseRate,
                volume: common.volume,
              },
              START_GREETING_MATCHUP_GAP_MS
            );
            continue;
          }
        }

        await speakMatcha(normalized, {
          speedScale: common.baseRate,
          volume: common.volume,
        });
      }
    } catch (error) {
      showMatchaError(error);
      throw error;
    } finally {
      speaking = false;
    }
    return;
  }

  const normalized = normalizeSpeechText(originalText).trim();
  if (!normalized) return;

  speaking = true;
  try {
    await speakWebSpeech(normalized, common);
  } finally {
    speaking = false;
  }
}


// 回先頭など、別々に先読みした短い音声を1本のPCMへ結合して再生する。
// Matcha以外の端末音声では従来どおり1つの文章として読み上げる。
export async function speakJoinedTTS(
  parts: string[],
  options: SpeakOptions = {}
): Promise<void> {
  // このAPIを直接使う画面でも、本番読み上げを最優先にする。
  if (getTtsEngine() === "matcha") {
    cancelBackgroundPrefetch("speakJoinedTTS");
  }
  const originalParts = (parts || [])
    .map((part) => String(part ?? ''))
    .filter((part) => part.trim().length > 0);

  if (!originalParts.length) return;

  if (getTtsEngine() !== 'matcha') {
    await speak(originalParts.join(''), options);
    return;
  }

  const common = loadCommonOptions(options);

  // 重要：normalizeSpeechText() より前に固定MP3判定する。
  // 例: 「8番」が先に「はちばん」へ変換されると FIXED_AUDIO_ENTRIES に一致しなくなるため。
  const hybridSegments: HybridSegment[] = [];
  for (const part of originalParts) {
    hybridSegments.push(...splitByFixedAudio(part, options));
  }

  ttsDebugLog('[TTS JOIN] request', {
    voice: getSelectedMatchaVoice(),
    segments: hybridSegments.length,
    previews: hybridSegments.map((s) => `${s.type}:${s.text.slice(0, 28)}`),
  });

  speaking = true;
  ++sessionCounter;

  try {
    if (isIOSDevice()) unlockMatchaAudioForIOS();

    const pcmParts: MatchaPcmAudio[] = [];

    for (const segment of hybridSegments) {
      if (segment.type === 'fixed') {
        let fixedPcm: MatchaPcmAudio | null = null;

        for (const baseName of segment.files) {
          fixedPcm = await decodeFixedAudioToPcm(baseName);
          if (fixedPcm) {
            ttsDebugLog('[TTS JOIN FIXED] use', {
              voice: getSelectedMatchaVoice(),
              src: getFixedAudioSrc(baseName),
              text: segment.text,
            });
            break;
          }
        }

        if (fixedPcm) {
          pcmParts.push(fixedPcm);
          continue;
        }
        // MP3が無い場合はこの固定文言もMatchaへフォールバック。
      }

      const normalized = normalizeMatchaSegmentText(segment.text);
      if (!normalized || !hasSpeakableCharacters(normalized)) continue;

      const pcm = await synthesizeMatchaPcmForJoin(normalized, {
        speedScale: common.baseRate,
        volume: common.volume,
      });
      if (pcm) pcmParts.push(pcm);
    }

    if (!pcmParts.length) return;

    await playJoinedMatchaPcm(
      pcmParts,
      {
        speedScale: common.baseRate,
        volume: common.volume,
      },
      35
    );
  } catch (error) {
    showMatchaError(error);
    throw error;
  } finally {
    speaking = false;
  }
}

export async function speakSegments(
  segments: string[],
  options: SpeakOptions = {}
): Promise<void> {
  const cleaned = (segments || [])
    .map((s) => normalizeSpeechText(String(s ?? "")).trim())
    .filter(Boolean);

  if (!cleaned.length) return;

  // 復旧優先: Matchaでも先読み/並列生成せず、順番に直接読む。
  for (const segment of cleaned) {
    await speak(segment, options);
  }
}

export async function prefetchTTS(
  text: string,
  options: SpeakOptions = {}
): Promise<void> {
  const originalText = String(text ?? "");
  if (!originalText.trim()) return;
  if (getTtsEngine() !== "matcha") return;

  const foregroundLookahead = options.foregroundLookahead === true;

  // 通常のバックグラウンド先読みは本番読み上げへCPU/Workerを譲る。
  // ただし foregroundLookahead=true は「今読んでいる間に次の1文を作る」
  // 専用なので、再生中でも継続する。
  if (speaking && !foregroundLookahead) {
    ttsDebugLog("[TTS PREFETCH] skipped: foreground speaking", {
      textPreview: originalText.replace(/\s+/g, " ").slice(0, 48),
    });
    return;
  }

  const myPrefetchGeneration = prefetchGeneration;
  const shouldYieldToForeground = () =>
    !foregroundLookahead &&
    (speaking || myPrefetchGeneration !== prefetchGeneration);

  if (foregroundLookahead) {
    ttsDebugLog("[TTS LOOKAHEAD] foreground next-part prefetch", {
      textPreview: originalText.replace(/\s+/g, " ").slice(0, 48),
    });
  }

  const common = loadCommonOptions(options);
  const segments = splitByFixedAudio(originalText, options);
  const prefetchStartedAt = typeof performance !== "undefined" ? performance.now() : Date.now();

  ttsDebugLog("[TTS PREFETCH] request", {
    voice: getSelectedMatchaVoice(),
    speedScale: Number(common.baseRate.toFixed(3)),
    textLength: originalText.length,
    textPreview: originalText.replace(/\s+/g, " ").slice(0, 48),
  });

  // 固定MP3はHTTPキャッシュへ先読み。
  // MP3が存在しない場合だけMatcha側のフォールバック音声も生成しておく。
  //
  // 通常の画面先読みでは、Matcha生成は「最初に必要な1セグメント」で止める。
  // これにより複数の作成文・長文の先読みが1スレッドWorkerへ大量に並ぶのを防ぐ。
  //
  // foregroundLookahead=true は再生中の次文先読み専用なので、
  // その場合はこの制限をかけない。
  let generatedTtsSegmentCount = 0;

  for (const segment of segments) {
    if (shouldYieldToForeground()) {
      ttsDebugLog("[TTS PREFETCH] yielded to foreground", {
        textPreview: originalText.replace(/\s+/g, " ").slice(0, 48),
      });
      return;
    }

    if (segment.type === "fixed") {
      let fixedAvailable = false;
      for (const baseName of segment.files) {
        if (shouldYieldToForeground()) return;

        if (await prefetchFixedAudioFile(baseName)) {
          fixedAvailable = true;
          break;
        }
      }

      if (fixedAvailable) {
        // 結合再生ではdecode待ちも削りたいので、HTTPキャッシュだけでなくPCMも先に作る。
        for (const baseName of segment.files) {
          if (shouldYieldToForeground()) return;

          const pcm = await decodeFixedAudioToPcm(baseName);
          if (pcm) break;
        }
        continue;
      }
    }

    const normalized = normalizeMatchaSegmentText(segment.text);
    if (!normalized || !hasSpeakableCharacters(normalized)) continue;

    // 本番と同じ1本の文章で先読みする。
    const matchupParts = splitStartGreetingMatchup(normalized);

    if (matchupParts) {
      ttsDebugLog("[TTS PREFETCH][MATCHUP SPLIT]", {
        parts: matchupParts,
      });

      for (const part of matchupParts) {
        if (shouldYieldToForeground()) return;

        if (!foregroundLookahead && generatedTtsSegmentCount >= 1) {
          return;
        }

        await prefetchMatcha(part, {
          speedScale: common.baseRate,
          volume: common.volume,
        });

        generatedTtsSegmentCount += 1;

        // 通常の画面先読みは、最初のMatcha音声が準備できた時点で終了。
        if (!foregroundLookahead) {
          return;
        }
      }
      continue;
    }

    if (shouldYieldToForeground()) return;

    if (!foregroundLookahead && generatedTtsSegmentCount >= 1) {
      return;
    }

    await prefetchMatcha(normalized, {
      speedScale: common.baseRate,
      volume: common.volume,
    });

    generatedTtsSegmentCount += 1;

    // 1チャンク生成が終わった時点でも、本番読み上げが来ていれば即終了。
    if (shouldYieldToForeground()) return;

    // 通常の画面先読みはここで終了。
    // 再生開始後の次チャンク生成は speakMatcha() が担当する。
    if (!foregroundLookahead) {
      return;
    }
  }

  const finishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
  ttsDebugLog("[TTS PREFETCH] ready", {
    voice: getSelectedMatchaVoice(),
    speedScale: Number(common.baseRate.toFixed(3)),
    totalMs: Math.round((finishedAt - prefetchStartedAt) * 10) / 10,
    textPreview: originalText.replace(/\s+/g, " ").slice(0, 48),
  });
}

export async function prewarmTTS(): Promise<void> {
  if (getTtsEngine() !== "matcha") return;

  try {
    await prewarmMatcha();
  } catch (error) {
    // 起動時準備はバックグラウンド処理。失敗してもUIや読み上げボタンを塞がない。
    console.warn("[TTS] background prewarm failed:", error);
  }
}

export function stop() {
  cancelBackgroundPrefetch("stop");
  sessionCounter++;
  stopFixedAudio();
  stopMatcha();
  speaking = false;
  hardCancelSpeechSynthesis();
}

export function isSpeaking() {
  return speaking;
}

// 既存画面からの先読み呼び出しを有効化。
// 起動直後のUI描画を邪魔しないよう、少し遅らせてAI音声の準備を開始する。
if (typeof window !== "undefined") {
  (
    window as typeof window & {
      prefetchTTS?: (text: string) => void;
    }
  ).prefetchTTS = (text: string) => {
    void prefetchTTS(text);
  };

  const startBackgroundPrewarm = () => {
    if (getTtsEngine() !== "matcha") return;
    void prewarmTTS();
  };

  // Phase 1高速化: モジュール読込直後の次タスクで準備開始。
  // UI操作は止めない。1スレッドWorkerなので4スレッド時のSession作成停止は起こさない。
  window.setTimeout(startBackgroundPrewarm, 0);
}
