// src/lib/matchaTts.ts
// Easyアナウンス Matcha-TTS-JP + Vocos
//
// public 配置:
//   /models/easy-announce/matcha/TANIHO.onnx / UGUISU.onnx
//   /models/easy-announce/matcha/vocos-22khz-univ.onnx
//
// Matcha-TTS-JP 学習時:
//   text_to_sequence(text, ["jp_cleaners"])
//   + add_blank=true
//
// ブラウザでは openjtalkjs の extractFullContextAsync() を使用し、
// 学習時の matcha/text/jtalk.py (pyopenjtalk.extract_fullcontext) と
// 同じ規則で音素 + アクセント記号へ変換する。
// その後、Matcha-TTS-JP symbols.py のIDへ変換し add_blank=true を適用する。

import * as ort from "onnxruntime-web/wasm";
import {
  connectSpeechOutput,
  float32ToWavBlob as pipelineFloat32ToWavBlob,
  getSharedAudioContext,
  prepareSpeechPcm,
  resumeSharedAudioContext,
} from "./audioPipeline";


// -----------------------------------------------------------------------------
// TTSデバッグログ
// 本番では false。必要なときだけ true にすると console.log が復活する。
// warn / error は異常検知のため常時残す。
// -----------------------------------------------------------------------------
const TTS_DEBUG = false;
const ttsDebugLog = (...args: any[]) => {
  if (TTS_DEBUG) console.log(...args);
};

type MatchaSpeakOptions = {
  speedScale?: number;
  volume?: number;
};

export type MatchaPcmAudio = {
  samples: Float32Array;
  sampleRate: number;
};

type SynthesizedAudio = MatchaPcmAudio;

export type MatchaPerformanceLevel = "good" | "warning" | "slow";

export type MatchaPerformanceProgress =
  | "preparing"
  | "g2p"
  | "inference"
  | "judging"
  | "complete";

export type MatchaPerformanceResult = {
  level: MatchaPerformanceLevel;
  generationMs: number;
  g2pMs: number;
  inferenceMs: number;
  prepareMs: number;
  audioDurationMs: number;
  rtf: number;
  modelId: "taniho" | "uguisu";
  hardwareConcurrency: number;
  deviceMemoryGb: number | null;
  crossOriginIsolated: boolean;
};

const MATCHA_PERFORMANCE_BENCHMARK_TEXT =
  "ライトの山田くんに代わりまして";

const MATCHA_MODEL_URL =
  "/models/easy-announce/matcha/TANIHO.onnx / UGUISU.onnx";

const VOCOS_MODEL_URL =
  "/models/easy-announce/matcha/vocos-22khz-univ.onnx";

const SAMPLE_RATE = 22050;
const N_FFT = 1024;
const HOP_LENGTH = 256;
const N_BINS = 513;
const MEL_BINS = 80;

const MATCHA_TEMPERATURE = 0.667;

// Matcha-TTS-JP / matcha/text/symbols.py と同じ順番。
// ID=0 は "~"（blank/pad）。
const MATCHA_SYMBOLS = [
  "~",
  "A", "E", "I", "N", "O", "U",
  "a", "b", "by", "ch", "cl", "d", "dy", "e", "f",
  "g", "gy", "h", "hy", "i", "j", "k", "ky", "m",
  "my", "n", "ny", "o", "p", "py", "r", "ry", "s",
  "sh", "t", "ts", "ty", "u", "v", "w", "y", "z",
  "pau", "sil",
  "^", "$", "?", "_", "#", "[", "]",
] as const;

const MATCHA_SYMBOL_TO_ID = new Map<string, number>(
  MATCHA_SYMBOLS.map((symbol, index) => [symbol, index])
);

let matchaSessionPromise: Promise<ort.InferenceSession> | null = null;
let vocosSessionPromise: Promise<ort.InferenceSession> | null = null;
let openJTalkReadyPromise: Promise<void> | null = null;
let prewarmMatchaPromise: Promise<void> | null = null;
let openJTalkBrowserModule: any = null;

let audioContext: AudioContext | null = null;
let currentSource: AudioBufferSourceNode | null = null;
let currentGain: GainNode | null = null;

let iosAudioElement: HTMLAudioElement | null = null;
let iosAudioObjectUrl: string | null = null;

let generationId = 0;

// 読み上げボタン押下相当（speakMatcha開始）から最初の再生要求までを計測。
// 高速化の効果確認用。動作には影響しない。
let activeSpeakStartedAt = 0;
let activeSpeakGenerationId = 0;
let activeFirstAudioLogged = false;

function markFirstAudioStart(myGenerationId: number, backend: string) {
  if (
    activeSpeakGenerationId !== myGenerationId ||
    activeFirstAudioLogged ||
    activeSpeakStartedAt <= 0
  ) {
    return;
  }

  activeFirstAudioLogged = true;
  ttsDebugLog("[TTS LATENCY] first audio start", {
    backend,
    ms: Math.round((performance.now() - activeSpeakStartedAt) * 10) / 10,
  });
}


const synthesizedCache = new Map<string, SynthesizedAudio>();
const synthesizedCacheOrder: string[] = [];

// -----------------------------------------------------------------------------
// 永続キャッシュ（IndexedDB）
// -----------------------------------------------------------------------------
// 一度生成したMatcha音声をブラウザ再起動後も再利用する。
// Float32のまま保存すると容量が大きいため、保存時だけPCM16へ圧縮する。
// モデルを学習し直した場合は PERSISTENT_CACHE_VERSION を変更すれば
// 古い音声キャッシュを自動的に無効化できる。
const PERSISTENT_CACHE_VERSION = "20260918-v1";
const PERSISTENT_DB_NAME = "easy-announce-matcha-cache";
const PERSISTENT_DB_VERSION = 1;
const PERSISTENT_STORE = "audio";
const MAX_PERSISTENT_CACHE_ITEMS = 120;

type PersistentAudioRecord = {
  key: string;
  sampleRate: number;
  pcm16Buffer: ArrayBuffer;
  updatedAt: number;
};

let persistentDbPromise: Promise<IDBDatabase | null> | null = null;

function openPersistentCacheDb(): Promise<IDBDatabase | null> {
  if (persistentDbPromise) return persistentDbPromise;

  persistentDbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }

    try {
      const request = indexedDB.open(
        PERSISTENT_DB_NAME,
        PERSISTENT_DB_VERSION
      );

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(PERSISTENT_STORE)) {
          const store = db.createObjectStore(
            PERSISTENT_STORE,
            { keyPath: "key" }
          );
          store.createIndex("updatedAt", "updatedAt");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        console.warn("[MatchaCache] IndexedDB open failed", request.error);
        resolve(null);
      };
      request.onblocked = () => resolve(null);
    } catch (error) {
      console.warn("[MatchaCache] IndexedDB unavailable", error);
      resolve(null);
    }
  });

  return persistentDbPromise;
}

function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]));
    out[i] = x < 0
      ? Math.round(x * 32768)
      : Math.round(x * 32767);
  }
  return out;
}

function pcm16ToFloat(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] < 0
      ? samples[i] / 32768
      : samples[i] / 32767;
  }
  return out;
}

async function getPersistentCache(
  key: string
): Promise<SynthesizedAudio | null> {
  const db = await openPersistentCacheDb();
  if (!db) return null;

  return await new Promise((resolve) => {
    try {
      const tx = db.transaction(PERSISTENT_STORE, "readonly");
      const store = tx.objectStore(PERSISTENT_STORE);
      const request = store.get(key);

      request.onsuccess = () => {
        const record = request.result as PersistentAudioRecord | undefined;
        if (!record?.pcm16Buffer) {
          resolve(null);
          return;
        }

        try {
          const pcm16 = new Int16Array(record.pcm16Buffer);
          const audio: SynthesizedAudio = {
            samples: pcm16ToFloat(pcm16),
            sampleRate: Number(record.sampleRate) || SAMPLE_RATE,
          };

          ttsDebugLog("[MatchaCache] persistent hit", {
            keyLength: key.length,
            samples: audio.samples.length,
          });

          resolve(audio);
        } catch {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function prunePersistentCache(): Promise<void> {
  const db = await openPersistentCacheDb();
  if (!db) return;

  try {
    const items = await new Promise<Array<{ key: string; updatedAt: number }>>(
      (resolve) => {
        const tx = db.transaction(PERSISTENT_STORE, "readonly");
        const store = tx.objectStore(PERSISTENT_STORE);
        const request = store.getAll();

        request.onsuccess = () => {
          const list = (request.result || []).map((row: PersistentAudioRecord) => ({
            key: row.key,
            updatedAt: Number(row.updatedAt) || 0,
          }));
          resolve(list);
        };
        request.onerror = () => resolve([]);
      }
    );

    if (items.length <= MAX_PERSISTENT_CACHE_ITEMS) return;

    items.sort((a, b) => a.updatedAt - b.updatedAt);
    const remove = items.slice(
      0,
      items.length - MAX_PERSISTENT_CACHE_ITEMS
    );

    await new Promise<void>((resolve) => {
      const tx = db.transaction(PERSISTENT_STORE, "readwrite");
      const store = tx.objectStore(PERSISTENT_STORE);
      for (const item of remove) store.delete(item.key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {}
}

async function putPersistentCache(
  key: string,
  audio: SynthesizedAudio
): Promise<void> {
  const db = await openPersistentCacheDb();
  if (!db) return;

  try {
    const pcm16 = floatToPcm16(audio.samples);
    // IDBへ渡すBufferは独立コピーにして、再生用samplesへ影響させない。
    const pcm16Buffer = pcm16.buffer.slice(0);

    await new Promise<void>((resolve) => {
      const tx = db.transaction(PERSISTENT_STORE, "readwrite");
      const store = tx.objectStore(PERSISTENT_STORE);

      const record: PersistentAudioRecord = {
        key,
        sampleRate: audio.sampleRate,
        pcm16Buffer,
        updatedAt: Date.now(),
      };

      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });

    // 保存処理の本線を遅くしないよう削除整理は非同期。
    void prunePersistentCache();
  } catch (error) {
    console.warn("[MatchaCache] save failed", error);
  }
}


// 同一チャンクの二重生成を防ぐ。
// 画面表示時のprefetch中に「読み上げ」を押した場合は、
// 同じ生成処理をもう一度開始せず、このPromiseをそのまま待つ。
const synthesisInFlight = new Map<
  string,
  Promise<SynthesizedAudio | null>
>();


type MatchaModelId = "taniho" | "uguisu";

function getSelectedMatchaModelId(): MatchaModelId {
  try {
    // 現在の読み上げ設定で使われている旧互換キーをそのまま利用。
    // easy-announce-1 = 谷保さん
    // easy-announce-2 = ウグイス嬢
    // 現在の読み上げ設定画面は tts:matcha:voice に
    // "taniho" / "uguisu" を保存する。
    // 旧キーも後方互換のため残す。
    const saved =
      localStorage.getItem("tts:matcha:voice") ||
      localStorage.getItem("tts:matcha:model") ||
      localStorage.getItem("tts:piper:model") ||
      "";

    if (
      saved === "easy-announce-2" ||
      saved === "uguisu"
    ) {
      return "uguisu";
    }
  } catch {}

  return "taniho";
}

type InferenceWorkerResponse =
  | { type: "ready"; id: number }
  | { type: "result"; id: number; sampleRate: number; samplesBuffer: ArrayBuffer }
  | { type: "error"; id: number; message: string };

let inferenceWorker: Worker | null = null;
let inferenceWorkerSeq = 0;
const inferenceWorkerPending = new Map<
  number,
  {
    resolve: (value: SynthesizedAudio | null) => void;
    reject: (reason?: unknown) => void;
  }
>();

function rejectAllWorkerPending(error: unknown) {
  for (const pending of inferenceWorkerPending.values()) {
    pending.reject(error);
  }
  inferenceWorkerPending.clear();
}

function getInferenceWorker(): Worker {
  if (inferenceWorker) return inferenceWorker;

  const worker = new Worker(
    new URL("./matchaInferenceWorker.ts", import.meta.url),
    { type: "module", name: "easy-announce-matcha" }
  );

  worker.onmessage = (event: MessageEvent<InferenceWorkerResponse>) => {
    const message = event.data;
    const pending = inferenceWorkerPending.get(message.id);
    if (!pending) return;

    inferenceWorkerPending.delete(message.id);

    if (message.type === "error") {
      pending.reject(new Error(message.message));
      return;
    }

    if (message.type === "ready") {
      pending.resolve(null);
      return;
    }

    pending.resolve({
      samples: new Float32Array(message.samplesBuffer),
      sampleRate: message.sampleRate,
    });
  };

  worker.onerror = (event) => {
    const error = new Error(
      event.message || "Matcha inference worker error"
    );
    rejectAllWorkerPending(error);
    try { worker.terminate(); } catch {}
    if (inferenceWorker === worker) inferenceWorker = null;
  };

  inferenceWorker = worker;
  return worker;
}

function postInferenceWorker(
  message:
    | { type: "init"; modelId: MatchaModelId }
    | { type: "synthesize"; ids: number[]; speedScale: number; modelId: MatchaModelId }
): Promise<SynthesizedAudio | null> {
  const worker = getInferenceWorker();
  const id = ++inferenceWorkerSeq;

  return new Promise((resolve, reject) => {
    inferenceWorkerPending.set(id, { resolve, reject });
    worker.postMessage({ ...message, id });
  });
}

async function initInferenceWorker(
  modelId: MatchaModelId
): Promise<void> {
  await postInferenceWorker({
    type: "init",
    modelId,
  });
}

const MAX_CACHE_ITEMS = 64; // Phase 2: 打順全体の先読みを保持

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bigintArray(
  values: number[]
): BigInt64Array {
  return new BigInt64Array(
    values.map(
      (value) => BigInt(value)
    )
  );
}

function isIOSDevice(): boolean {
  if (typeof navigator === "undefined") return false;

  const ua = navigator.userAgent || "";

  return (
    /iP(hone|ad|od)/.test(ua) ||
    (
      /Macintosh/.test(ua) &&
      typeof document !== "undefined" &&
      "ontouchend" in document
    )
  );
}

function configureOrt() {
  // Proxy Workerは一部のPWA/Vite配布環境で
  // "worker not ready" になるため使用しない。
  // UIを塞がない処理はApp.tsx側で維持する。
  ort.env.wasm.proxy = false;

  const cores =
    typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency || 1
      : 1;

  const canUseThreads =
    typeof self !== "undefined" &&
    self.crossOriginIsolated === true;

  // 実推論Workerと同じ条件で WASM Threads を使用。
  // crossOriginIsolated=false の環境では安全に1スレッドへフォールバックする。
  const usableThreads = canUseThreads
    ? Math.min(4, Math.max(1, cores - 1))
    : 1;

  ort.env.wasm.numThreads = usableThreads;

  if (typeof window !== "undefined") {
    const origin = window.location.origin;

    ort.env.wasm.wasmPaths = {
      wasm: `${origin}/ort/ort-wasm-simd-threaded.wasm`,
      mjs: `${origin}/ort/ort-wasm-simd-threaded.mjs`,
    } as any;
  }

}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `${url} の取得に失敗しました (HTTP ${response.status})`
    );
  }

  return new Uint8Array(
    await response.arrayBuffer()
  );
}

async function getMatchaSession(): Promise<ort.InferenceSession> {
  if (!matchaSessionPromise) {
    configureOrt();

    matchaSessionPromise = (async () => {
      const bytes =
        await fetchBytes(MATCHA_MODEL_URL);

      return ort.InferenceSession.create(
        bytes,
        {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        }
      );
    })().catch((error) => {
      matchaSessionPromise = null;
      throw error;
    });
  }

  return matchaSessionPromise;
}

async function getVocosSession(): Promise<ort.InferenceSession> {
  if (!vocosSessionPromise) {
    configureOrt();

    vocosSessionPromise = (async () => {
      const bytes =
        await fetchBytes(VOCOS_MODEL_URL);

      return ort.InferenceSession.create(
        bytes,
        {
          executionProviders: ["wasm"],
          graphOptimizationLevel: "all",
        }
      );
    })().catch((error) => {
      vocosSessionPromise = null;
      throw error;
    });
  }

  return vocosSessionPromise;
}



const OPENJTALK_ASSET_BASE = "/openjtalkjs";

async function getOpenJTalkReady(): Promise<void> {
  if (!openJTalkReadyPromise) {
    openJTalkReadyPromise = (async () => {
      if (typeof window === "undefined") {
        throw new Error(
          "Matcha OpenJTalk G2Pはブラウザ環境でのみ使用できます。"
        );
      }

      // Viteにnode_modules内Workerを変換させると、
      // openjtalkjs 0.1.0 のWorker URL解決が壊れる場合がある。
      // そのためブラウザ用runtime一式を public/openjtalk-runtime に
      // そのまま配置し、ブラウザから直接importする。
      const browserModuleUrl =
        "/openjtalk-runtime/browser.js";


      // public配下のJSをViteのimport解析に通すと "?import" が付き、
      // 開発サーバーで500になるため、ブラウザネイティブのimport()を使う。
      const nativeDynamicImport =
        new Function(
          "url",
          "return import(url);"
        ) as (
          url: string
        ) => Promise<any>;

      openJTalkBrowserModule =
        await nativeDynamicImport(
          browserModuleUrl
        );

      if (
        !openJTalkBrowserModule ||
        typeof openJTalkBrowserModule.configure !== "function" ||
        typeof openJTalkBrowserModule.extractFullContextAsync !== "function"
      ) {
        throw new Error(
          "OpenJTalk browser runtimeのAPIを読み込めませんでした。"
        );
      }


      // Blob Worker 内では "/openjtalkjs/..." のような
      // ルート相対URLを基準解決できず、fetch() が失敗する。
      // Workerへ渡す時点で完全な絶対URLへ変換しておく。
      const origin = window.location.origin;
      const dicUrl = new URL(
        `${OPENJTALK_ASSET_BASE}/dic`,
        origin
      ).href.replace(/\/$/, "");
      const voiceUrl = new URL(
        `${OPENJTALK_ASSET_BASE}/voice.htsvoice`,
        origin
      ).href;

      ttsDebugLog("[Matcha] OpenJTalk absolute assets", {
        dicUrl,
        voiceUrl,
      });

      await openJTalkBrowserModule.configure({
        dicUrl,
        voiceUrl,
      });

    })().catch((error: unknown) => {
      openJTalkReadyPromise = null;
      openJTalkBrowserModule = null;

      console.error(
        "[Matcha] OpenJTalk initialization failed:",
        error
      );

      throw error;
    });
  }

  return openJTalkReadyPromise;
}

function numericFeatureByRegex(
  regex: RegExp,
  text: string
): number {
  const match =
    text.match(regex);

  if (!match) {
    return -50;
  }

  return Number.parseInt(
    match[1],
    10
  );
}

// 学習時の Matcha-TTS-JP/matcha/text/jtalk.py の g2p() を
// TypeScriptへそのまま移植。
// drop_unvoiced_vowels=true も学習時と同じ。
function fullContextLabelsToPhonemes(
  labels: string[]
): string[] {
  const results: string[] = [];
  const count = labels.length;

  for (
    let index = 0;
    index < count;
    index++
  ) {
    const label =
      labels[index];

    const phonemeMatch =
      label.match(/-(.*?)\+/);

    if (!phonemeMatch) {
      throw new Error(
        `OpenJTalk labelから音素を取得できません: ${label}`
      );
    }

    let p3 =
      phonemeMatch[1];

    if (
      ["A", "E", "I", "O", "U"].includes(p3)
    ) {
      p3 =
        p3.toLowerCase();
    }

    if (p3 === "sil") {
      if (
        index !== 0 &&
        index !== count - 1
      ) {
        throw new Error(
          "OpenJTalkのsilが文頭/文末以外に現れました。"
        );
      }

      if (index === 0) {
        results.push("^");
      } else {
        const e3 =
          numericFeatureByRegex(
            /!(\d+)_/,
            label
          );

        if (e3 === 0) {
          results.push("$");
        } else if (e3 === 1) {
          results.push("?");
        }
      }

      continue;
    }

    if (p3 === "pau") {
      results.push("_");
      continue;
    }

    results.push(p3);

    const a1 =
      numericFeatureByRegex(
        /\/A:([0-9\-]+)\+/,
        label
      );

    const a2 =
      numericFeatureByRegex(
        /\+(\d+)\+/,
        label
      );

    const a3 =
      numericFeatureByRegex(
        /\+(\d+)\//,
        label
      );

    const f1 =
      numericFeatureByRegex(
        /\/F:(\d+)_/,
        label
      );

    const nextLabel =
      labels[index + 1] ?? "";

    const a2Next =
      numericFeatureByRegex(
        /\+(\d+)\+/,
        nextLabel
      );

    if (
      a3 === 1 &&
      a2Next === 1
    ) {
      results.push("#");
    } else if (
      a1 === 0 &&
      a2Next === a2 + 1 &&
      a2 !== f1
    ) {
      results.push("]");
    } else if (
      a2 === 1 &&
      a2Next === 2
    ) {
      results.push("[");
    }
  }

  return results;
}


// 「8番（はちばん）」の語頭 /h/ が弱く「わちばん」のように聞こえる場合の補正。
// 文字列に空白や読点は入れず、OpenJTalkが返した音素列の /h/ だけを少し長くする。
// prosody記号は無視して h-a-ch-i-b-a-N の並びを検出する。
function strengthenHachibanOnset(
  phonemes: string[],
  sourceText: string
): string[] {
  if (!/(?:8番|はちばん|ハチバン)/.test(sourceText)) {
    return phonemes;
  }

  const prosody = new Set(["^", "$", "?", "_", "#", "[", "]"]);

  const nextSpeech = (start: number, count: number) => {
    const items: Array<{ index: number; phoneme: string }> = [];
    for (let i = start; i < phonemes.length && items.length < count; i++) {
      if (!prosody.has(phonemes[i])) {
        items.push({ index: i, phoneme: phonemes[i] });
      }
    }
    return items;
  };

  for (let i = 0; i < phonemes.length; i++) {
    if (phonemes[i] !== "h") continue;

    const seq = nextSpeech(i, 7);
    const sounds = seq.map((x) => x.phoneme);

    if (
      sounds[0] === "h" &&
      sounds[1] === "a" &&
      sounds[2] === "ch" &&
      sounds[3] === "i" &&
      sounds[4] === "b" &&
      sounds[5] === "a" &&
      sounds[6] === "N"
    ) {
      // /h/ を1個だけ重ねて息成分を強める。
      // pauや句読点は追加しないので、「はち」と「ばん」の間は増やさない。
      const out = [...phonemes];
      out.splice(i, 0, "h");

      ttsDebugLog("[Matcha pronunciation] strengthen 8番 onset", {
        before: phonemes.slice(Math.max(0, i - 3), Math.min(phonemes.length, i + 12)),
        after: out.slice(Math.max(0, i - 3), Math.min(out.length, i + 13)),
      });

      return out;
    }
  }

  console.warn("[Matcha pronunciation] 8番 phoneme pattern not found", {
    text: sourceText,
    phonemes,
  });

  return phonemes;
}

// -----------------------------------------------------------------------------
// 発音補助：無音(pau)を入れず、1本の音声のままアクセント句境界 # だけを追加。
// 「秋季大会」→「たいけー」、「だいいちしあい」→「しあー」のような
// 母音のつぶれを抑えつつ、別音声生成による不自然な間を作らない。
// -----------------------------------------------------------------------------
function needsPronunciationPhraseBoundary(sourceText: string): boolean {
  return (
    /(?:秋季大会|しゅうきたいかい|シュウキタイカイ)/.test(sourceText) ||
    /だい(?:いち|に|さん|よん|ご|ろく|なな|はち|きゅう)しあい/.test(sourceText)
  );
}

function insertPronunciationPhraseBoundary(
  phonemes: string[],
  sourceText: string
): string[] {
  if (!needsPronunciationPhraseBoundary(sourceText)) {
    return phonemes;
  }

  const prosody = new Set(["^", "$", "?", "_", "#", "[", "]"]);
  const speechItems = phonemes
    .map((phoneme, index) => ({ phoneme, index }))
    .filter((item) => !prosody.has(item.phoneme));

  const insertionIndexes: number[] = [];

  const addBoundaryBeforeSequence = (sequence: string[]) => {
    for (let i = 0; i <= speechItems.length - sequence.length; i++) {
      let matched = true;

      for (let j = 0; j < sequence.length; j++) {
        if (speechItems[i + j].phoneme !== sequence[j]) {
          matched = false;
          break;
        }
      }

      if (!matched) continue;

      const targetIndex = speechItems[i].index;
      const prevSpeechIndex = i > 0 ? speechItems[i - 1].index : -1;
      const between = phonemes.slice(prevSpeechIndex + 1, targetIndex);

      if (!between.includes("#")) {
        insertionIndexes.push(targetIndex);
      }
    }
  };

  if (/(?:秋季大会|しゅうきたいかい|シュウキタイカイ)/.test(sourceText)) {
    // 「たいかい」= t a i k a i の直前
    addBoundaryBeforeSequence(["t", "a", "i", "k", "a", "i"]);
  }

  if (/だい(?:いち|に|さん|よん|ご|ろく|なな|はち|きゅう)しあい/.test(sourceText)) {
    // 「しあい」= sh i a i の直前
    addBoundaryBeforeSequence(["sh", "i", "a", "i"]);
  }

  if (!insertionIndexes.length) {
    console.warn("[Matcha pronunciation] phrase boundary target not found", {
      text: sourceText,
    });
    return phonemes;
  }

  const out = [...phonemes];
  const uniqueIndexes = [...new Set(insertionIndexes)].sort((a, b) => b - a);

  for (const index of uniqueIndexes) {
    out.splice(index, 0, "#");
  }

  ttsDebugLog("[Matcha pronunciation] inserted phrase boundary", {
    text: sourceText,
    count: uniqueIndexes.length,
  });

  return out;
}

// OpenJTalk は文頭が「、」「。」などの短いポーズだと
// JPCommonLabel_insert_pause(): First mora should not be short pause.
// の警告を出す。
// 表示文や文中の句読点は変更せず、OpenJTalkへ渡す直前の文頭だけ整える。
function sanitizeOpenJTalkInput(input: string): string {
  return String(input ?? "")
    .replace(/^[\s\u3000、。，．,.！？!?・…]+/u, "")
    .trimStart();
}

async function textToMatchaIds(
  text: string
): Promise<number[]> {
  await getOpenJTalkReady();

  if (
    !openJTalkBrowserModule ||
    typeof openJTalkBrowserModule.extractFullContextAsync !== "function"
  ) {
    throw new Error(
      "OpenJTalk browser runtimeが初期化されていません。"
    );
  }

  const openJTalkText = sanitizeOpenJTalkInput(text);

  if (!openJTalkText) {
    console.warn("[Matcha] OpenJTalk input became empty after leading-pause cleanup", {
      originalText: text,
    });
    return [];
  }

  if (openJTalkText !== text) {
    ttsDebugLog("[Matcha] removed leading pause punctuation", {
      before: text.slice(0, 24),
      after: openJTalkText.slice(0, 24),
    });
  }

  const labelsResult =
    await openJTalkBrowserModule.extractFullContextAsync(
      openJTalkText
    );

  const labels =
    Array.from(
      labelsResult as ArrayLike<string>
    ).map(String);

  if (!labels.length) {
    throw new Error(
      "OpenJTalkからfull-context labelが返されませんでした。"
    );
  }

  let phonemes =
    fullContextLabelsToPhonemes(
      labels
    );

  // 8番だけ、語頭の /h/ を音素レベルで補強する。
  // 「はち」と「ばん」の間には pau / 空白を入れない。
  phonemes = strengthenHachibanOnset(phonemes, openJTalkText);

  // 無音は追加せず、アクセント句境界 # だけで語の境目を補助する。
  phonemes = insertPronunciationPhraseBoundary(phonemes, openJTalkText);

  const ids: number[] = [];

  for (const phoneme of phonemes) {
    const id =
      MATCHA_SYMBOL_TO_ID.get(
        phoneme
      );

    if (id === undefined) {
      throw new Error(
        `Matcha symbols.pyに無い音素が返されました: "${phoneme}"`
      );
    }

    ids.push(id);
  }

  // Matcha-TTS-JP add_blank=true:
  // intersperse(ids, 0) => [0, id, 0, id, ..., 0]
  const idsWithBlank: number[] =
    [0];

  for (const id of ids) {
    idsWithBlank.push(
      id,
      0
    );
  }



  return idsWithBlank;
}

function makeCacheKey(
  text: string,
  speedScale: number,
  modelId: MatchaModelId = getSelectedMatchaModelId()
) {
  // 発音補助対象だけ旧音声キャッシュを使わない。
  // その他のキャッシュはそのまま維持する。
  const pronunciationRuleSuffix =
    needsPronunciationPhraseBoundary(text)
      ? "::pron-boundary-v3"
      : "";

  return `${PERSISTENT_CACHE_VERSION}${pronunciationRuleSuffix}::${modelId}::${speedScale.toFixed(3)}::${text}`;
}

function putCache(
  key: string,
  value: SynthesizedAudio
) {
  if (synthesizedCache.has(key)) {
    const index =
      synthesizedCacheOrder.indexOf(key);

    if (index >= 0) {
      synthesizedCacheOrder.splice(
        index,
        1
      );
    }
  }

  synthesizedCache.set(
    key,
    value
  );

  synthesizedCacheOrder.push(
    key
  );

  while (
    synthesizedCacheOrder.length >
    MAX_CACHE_ITEMS
  ) {
    const oldest =
      synthesizedCacheOrder.shift();

    if (oldest) {
      synthesizedCache.delete(
        oldest
      );
    }
  }
}


// -----------------------------------------------------------------------------
// Vocos complex spectrum -> PCM
// 単体ブラウザテストで正常動作確認済みの radix-2 IFFT + Hann ISTFT。
// torch.istft(center=True) と同じように前後 n_fft/2 をトリムする。
// -----------------------------------------------------------------------------

function ifft(
  real: Float64Array,
  imag: Float64Array
): void {
  const n = real.length;

  // bit-reversal permutation
  for (
    let i = 1, j = 0;
    i < n;
    i++
  ) {
    let bit = n >> 1;

    for (
      ;
      j & bit;
      bit >>= 1
    ) {
      j ^= bit;
    }

    j ^= bit;

    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  // radix-2 inverse FFT
  for (
    let len = 2;
    len <= n;
    len <<= 1
  ) {
    const angle =
      (2 * Math.PI) / len;

    const wlenR =
      Math.cos(angle);

    const wlenI =
      Math.sin(angle);

    for (
      let i = 0;
      i < n;
      i += len
    ) {
      let wr = 1;
      let wi = 0;

      for (
        let j = 0;
        j < len / 2;
        j++
      ) {
        const uR =
          real[i + j];

        const uI =
          imag[i + j];

        const vr0 =
          real[
            i +
            j +
            len / 2
          ];

        const vi0 =
          imag[
            i +
            j +
            len / 2
          ];

        const vR =
          vr0 * wr -
          vi0 * wi;

        const vI =
          vr0 * wi +
          vi0 * wr;

        real[i + j] =
          uR + vR;

        imag[i + j] =
          uI + vI;

        real[
          i +
          j +
          len / 2
        ] =
          uR - vR;

        imag[
          i +
          j +
          len / 2
        ] =
          uI - vI;

        const nextWr =
          wr * wlenR -
          wi * wlenI;

        wi =
          wr * wlenI +
          wi * wlenR;

        wr =
          nextWr;
      }
    }
  }

  for (
    let i = 0;
    i < n;
    i++
  ) {
    real[i] /= n;
    imag[i] /= n;
  }
}

function hannWindow(
  n: number
): Float32Array {
  const window =
    new Float32Array(n);

  // torch.hann_window(periodic=True)
  for (
    let i = 0;
    i < n;
    i++
  ) {
    window[i] =
      0.5 -
      0.5 *
        Math.cos(
          (2 * Math.PI * i) /
            n
        );
  }

  return window;
}

function istftFromVocos(
  mag: Float32Array,
  xr: Float32Array,
  yi: Float32Array,
  frames: number
): Float32Array {
  const rawLength =
    N_FFT +
    HOP_LENGTH *
      (frames - 1);

  const output =
    new Float32Array(
      rawLength
    );

  const norm =
    new Float32Array(
      rawLength
    );

  const window =
    hannWindow(N_FFT);

  const real =
    new Float64Array(
      N_FFT
    );

  const imag =
    new Float64Array(
      N_FFT
    );

  // ONNX layout:
  // [1, 513, T]
  // index = bin * frames + frame
  for (
    let t = 0;
    t < frames;
    t++
  ) {
    real.fill(0);
    imag.fill(0);

    for (
      let k = 0;
      k < N_BINS;
      k++
    ) {
      const index =
        k * frames + t;

      real[k] =
        mag[index] *
        xr[index];

      imag[k] =
        mag[index] *
        yi[index];
    }

    // Negative frequencies:
    // conjugate mirror
    for (
      let k = 1;
      k < N_BINS - 1;
      k++
    ) {
      real[N_FFT - k] =
        real[k];

      imag[N_FFT - k] =
        -imag[k];
    }

    ifft(
      real,
      imag
    );

    const base =
      t * HOP_LENGTH;

    for (
      let i = 0;
      i < N_FFT;
      i++
    ) {
      const w =
        window[i];

      output[
        base + i
      ] +=
        real[i] * w;

      norm[
        base + i
      ] +=
        w * w;
    }
  }

  for (
    let i = 0;
    i < rawLength;
    i++
  ) {
    if (
      norm[i] >
      1e-8
    ) {
      output[i] /=
        norm[i];
    }
  }

  // torch.istft(center=True)
  // n_fft/2 を前後から落とす。
  const trim =
    N_FFT / 2;

  return output.slice(
    trim,
    rawLength - trim
  );
}

async function synthesizeMatchaChunkInternal(
  text: string,
  speedScale: number,
  _myGenerationId: number | null
): Promise<SynthesizedAudio | null> {
  const modelId = getSelectedMatchaModelId();
  const key = makeCacheKey(text, speedScale, modelId);
  const cached = synthesizedCache.get(key);
  if (cached) {
    ttsDebugLog("[TTS PERF] memory cache hit", {
      modelId,
      textLength: text.length,
    });
    return cached;
  }

  // 永続キャッシュ確認とG2Pを同時に開始する。
  // キャッシュが無かった場合、従来はIndexedDB確認後にG2Pを始めていたため、
  // その分だけ初回生成開始が遅れていた。
  const persistentStart = performance.now();
  const g2pStart = performance.now();

  const g2pPromise = textToMatchaIds(text).then(
    (ids) => ({ ok: true as const, ids }),
    (error) => ({ ok: false as const, error })
  );

  const persistent = await getPersistentCache(key);
  if (persistent) {
    putCache(key, persistent);
    ttsDebugLog("[TTS CACHE] PERSISTENT HIT", {
      modelId,
      textLength: text.length,
      textPreview: text.slice(0, 36),
      loadMs: Math.round((performance.now() - persistentStart) * 10) / 10,
    });
    return persistent;
  }

  // OpenJTalkだけメイン側で実行。
  // Matcha/Vocos/ISTFTは専用Workerへ渡す。
  const totalStart = performance.now();

  const g2pResult = await g2pPromise;
  if ("error" in g2pResult) {
    console.error("[Matcha] G2P failed:", g2pResult.error);
    throw g2pResult.error;
  }
  const ids = g2pResult.ids;
  const g2pMs = performance.now() - g2pStart;

  let synthesized: SynthesizedAudio | null;
  try {
    synthesized = await postInferenceWorker({
      type: "synthesize",
      ids,
      speedScale,
      modelId,
    });
  } catch (error) {
    console.error("[Matcha] worker inference failed:", error);
    throw error;
  }

  if (!synthesized) return null;

  putCache(key, synthesized);

  // 再生開始を遅らせないよう、IndexedDB保存は待たない。
  void putPersistentCache(key, synthesized);

  ttsDebugLog("[TTS PERF] synthesis completed", {
    modelId,
    textLength: text.length,
    g2pMs: Math.round(g2pMs * 10) / 10,
    totalMs: Math.round((performance.now() - totalStart) * 10) / 10,
  });

  return synthesized;
}

async function synthesizeMatchaChunk(
  text: string,
  speedScale: number,
  myGenerationId: number | null
): Promise<SynthesizedAudio | null> {
  const modelId = getSelectedMatchaModelId();
  const key = makeCacheKey(text, speedScale, modelId);

  const cached = synthesizedCache.get(key);
  if (cached) {
    ttsDebugLog("[TTS CACHE] MEMORY HIT", {
      modelId,
      speedScale: Number(speedScale.toFixed(3)),
      textLength: text.length,
      textPreview: text.slice(0, 36),
    });
    return cached;
  }

  const existing = synthesisInFlight.get(key);
  if (existing) {
    ttsDebugLog("[TTS CACHE] IN-FLIGHT", {
      modelId,
      speedScale: Number(speedScale.toFixed(3)),
      textLength: text.length,
      textPreview: text.slice(0, 36),
    });
    return existing;
  }

  ttsDebugLog("[TTS CACHE] MISS", {
    modelId,
    speedScale: Number(speedScale.toFixed(3)),
    textLength: text.length,
    textPreview: text.slice(0, 36),
  });

  // 生成処理そのものはgenerationIdでキャンセルしない。
  // 途中まで進んだ先読みを読み上げボタン押下で捨てないため。
  const promise = synthesizeMatchaChunkInternal(
    text,
    speedScale,
    null
  );

  synthesisInFlight.set(key, promise);

  try {
    return await promise;
  } finally {
    if (synthesisInFlight.get(key) === promise) {
      synthesisInFlight.delete(key);
    }
  }
}

function takeFastFirstPhrase(source: string): { first: string; rest: string } | null {
  // 最初の音を早く出すため、文章先頭に自然な句読点がある場合は
  // その短いフレーズだけを最優先チャンクにする。
  // 不自然な文字数切りはせず「、。！？」だけを利用する。
  const minFirst = 8;
  const maxFirst = 24;

  if (source.length <= maxFirst) return null;

  for (let i = minFirst - 1; i < Math.min(source.length, maxFirst); i++) {
    if (/[、。！？!?]/.test(source[i])) {
      const first = source.slice(0, i + 1).trim();
      const rest = source.slice(i + 1).trimStart();
      if (first && rest) return { first, rest };
    }
  }

  return null;
}

function splitMatchaText(
  text: string
): string[] {
  const source =
    String(text ?? "")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+/g, " ")
      .replace(/ノック時間\s*[、,]\s*は/g, "ノック時間は")
      .trim();

  if (!source) return [];

  // バッター紹介は「打順・守備位置・氏名」の途中で絶対に分割しない。
  // 例:
  // 「さんばん、セカンド、タナカ フウトくん、セカンド、タナカくん、背番号4。」
  //
  // 従来の takeFastFirstPhrase() では
  // 「さんばん、セカンド、」だけが先に生成・再生され、
  // 氏名部分の生成待ちで大きな無音が発生することがあった。
  //
  // OffenseScreen側で全文を事前生成してからボタンを有効化するため、
  // ここでは短いバッター紹介を1チャンクのまま保持する。
  const batterPositionPattern =
    /(ピッチャー|キャッチャー|ファースト|セカンド|サード|ショート|レフト|センター|ライト|指名打者)/;

  const batterOrderPattern =
    /(いち|に|さん|よ|ご|ろく|なな|はち|きゅう)\s*ばん/;

  const looksLikeBatterIntroduction =
    source.length <= 110 &&
    batterOrderPattern.test(source) &&
    batterPositionPattern.test(source) &&
    /(くん|さん)/.test(source);

  if (looksLikeBatterIntroduction) {
    return [source];
  }

  // 投球数アナウンスは選手名・球数が変わっても1文1チャンク。
  // 例:
  // 「ピッチャー○○くん、この回のとうきゅうすうは、8球です。」
  // 名前の後ろの読点では絶対に分割しない。
  const pitchAnnouncementMatch = source.match(
    /^(ピッチャー.+?(?:くん|さん)、この回のとうきゅうすうは[、,]?\s*[^。！？!?]+[。！？!?])/
  );
  if (pitchAnnouncementMatch) {
    const fixedPitchSentence = pitchAnnouncementMatch[1].trim();
    const restAfterPitch = source
      .slice(fixedPitchSentence.length)
      .trimStart();

    const fixedChunks = [fixedPitchSentence];

    if (restAfterPitch) {
      fixedChunks.push(
        ...splitMatchaText(restAfterPitch)
      );
    }

    return fixedChunks;
  }

  const warmupFixed = "りょうチームはウォーミングアップニ入ってください。";
  if (source.startsWith(warmupFixed)) {
    const restAfterWarmup = source.slice(warmupFixed.length).trimStart();
    const fixedChunks = [warmupFixed];
    if (restAfterWarmup) {
      // 残りは通常分割へ回す
      const tail = splitMatchaText(restAfterWarmup);
      fixedChunks.push(...tail);
    }
    return fixedChunks;
  }

  const chunks: string[] = [];
  let rest = source;

  // 最初の自然な短句だけを先に生成すると、全文推論完了を待たずに再生できる。
  const fastFirst = takeFastFirstPhrase(rest);
  if (fastFirst) {
    chunks.push(fastFirst.first);
    rest = fastFirst.rest;
  }

  // 1チャンクを極端に長くしない一方、読点だけでは安易に分割しない。
  // 「ノック時間は、」「この回の投球数は、」などを同一チャンクに保つ。
  const targetLength = 36;
  const hardMaxLength = 52;
  const minUsefulLength = 14;

  // 選手名は画面側で登録ふりがなをカタカナ化して渡す。
  // 「姓 名くん/さん」または「姓くん/さん」を検出し、
  // チャンク分割位置が氏名の途中へ入らないよう保護する。
  //
  // 例:
  //   オクムラ マサキくん
  //   オクムラくん
  //
  // 半角スペースは残すため、姓と名の間には短い語境界があり、
  // 読点ほど長い間にはならない。
  const protectedPlayerNames = Array.from(
    source.matchAll(
      /[ァ-ヶヷヸヹヺー]{1,24}(?: [ァ-ヶヷヸヹヺー]{1,24})?(?:くん|さん|投手)/g
    ),
    (match) => match[0]
  );

  const protectedPhrases = [
    "りょうチームはウォーミングアップニ入ってください。",
    "ノック時間は",
    "この回の投球数は",
    "合計投球数は",
    "明日以降に",
    "第1試合",
    "第2試合",
    "第3試合",
    "第4試合",
    "第5試合",
    ...protectedPlayerNames,
  ];

  const adjustCutForProtectedPhrase = (
    target: string,
    cut: number
  ): number => {
    // 選手名の途中にcutが来た場合は、可能なら「名前の手前」で切る。
    // これにより名前を分断せず、名前の末尾までチャンクを長く伸ばさない。
    for (const phrase of protectedPlayerNames) {
      let pos = target.indexOf(phrase);
      while (pos >= 0) {
        const phraseEnd = pos + phrase.length;

        if (pos < cut && cut < phraseEnd) {
          // 名前の前に十分な長さがあるなら、名前の直前で切る。
          if (pos >= minUsefulLength) {
            return pos;
          }

          // 文頭近くから名前が始まる場合だけ、名前の末尾まで含める。
          return phraseEnd;
        }

        pos = target.indexOf(phrase, pos + 1);
      }
    }

    // 従来からある固定保護フレーズは従来どおり末尾まで含める。
    for (const phrase of protectedPhrases) {
      if (protectedPlayerNames.includes(phrase)) continue;

      let pos = target.indexOf(phrase);
      while (pos >= 0) {
        const phraseEnd = pos + phrase.length;
        if (pos < cut && cut < phraseEnd) return phraseEnd;
        pos = target.indexOf(phrase, pos + 1);
      }
    }

    return cut;
  };

  while (rest.length > 0) {
    if (rest.length <= hardMaxLength) {
      const last = rest.trim();
      if (last) chunks.push(last);
      break;
    }

    const head = rest.slice(0, Math.min(rest.length, hardMaxLength + 1));
    let cut = -1;

    // まず文末・改行を優先
    for (let i = Math.min(head.length - 1, hardMaxLength - 1); i >= minUsefulLength; i--) {
      if (/[。！？!?\n]/.test(head[i])) {
        cut = i + 1;
        break;
      }
    }

    // 文末が無い長文だけ、後半の読点を候補にする
    if (cut < 0) {
      for (let i = Math.min(head.length - 1, hardMaxLength - 1); i >= targetLength; i--) {
        if (/[、，,]/.test(head[i])) {
          cut = i + 1;
          break;
        }
      }
    }

    // それでも無ければtargetLength付近で切る
    if (cut < 0) {
      cut = targetLength;
      const before = rest.slice(0, targetLength);
      const space = before.lastIndexOf(" ");
      if (space >= minUsefulLength) cut = space + 1;
    }

    // 保護語の途中では切らない。
    // 選手名は原則として名前の「手前」で切るため、
    // 固定MP3の後に続く生成チャンクが不必要に長くならない。
    cut = adjustCutForProtectedPhrase(rest, cut);

    // 通常は従来どおり52文字以内。
    // 文頭近くに長い選手名がある場合だけ、その名前を切らないため
    // 最小限の超過を許可する。
    if (cut > hardMaxLength) {
      const beginsWithProtectedPlayerName = protectedPlayerNames.some(
        (phrase) => {
          const pos = rest.indexOf(phrase);
          return pos >= 0 && pos < minUsefulLength && pos < hardMaxLength && pos + phrase.length === cut;
        }
      );

      if (!beginsWithProtectedPlayerName) {
        cut = hardMaxLength;
      }
    }

    cut = Math.max(1, Math.min(cut, rest.length));

    const chunk = rest.slice(0, cut).trim();
    if (chunk) chunks.push(chunk);

    rest = rest.slice(cut).trimStart();
  }


  return chunks.filter(Boolean);
}

function getAudioContext(): AudioContext {
  return getSharedAudioContext();
}

async function resumeAudioContext(): Promise<AudioContext> {
  return resumeSharedAudioContext();
}

function float32ToWavBlob(
  samples: Float32Array,
  sampleRate: number
): Blob {
  return pipelineFloat32ToWavBlob(samples, sampleRate);
}

export function unlockMatchaAudioForIOS(): void {
  if (!isIOSDevice()) return;

  try {
    if (!iosAudioElement) {
      iosAudioElement =
        new Audio();

      iosAudioElement.preload =
        "auto";

      iosAudioElement.playsInline =
        true;
    }

    const silentWav =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=";

    iosAudioElement.src =
      silentWav;

    iosAudioElement.volume = 0;

    const promise =
      iosAudioElement.play();

    if (
      promise &&
      typeof promise.catch === "function"
    ) {
      void promise.catch(
        () => {}
      );
    }
  } catch {}
}

async function playSamplesIOS(
  audio: SynthesizedAudio,
  volume: number,
  myGenerationId: number
): Promise<void> {
  if (
    myGenerationId !== generationId
  ) {
    return;
  }

  const preparedAudio =
    prepareSpeechPcm(
      audio.samples,
      audio.sampleRate
    );

  const blob =
    float32ToWavBlob(
      preparedAudio.samples,
      preparedAudio.sampleRate
    );

  const playAttempt = async (
    attempt: number
  ): Promise<void> => {
    if (
      myGenerationId !== generationId
    ) {
      return;
    }

    try {
      iosAudioElement?.pause();
    } catch {}

    if (iosAudioObjectUrl) {
      try {
        URL.revokeObjectURL(
          iosAudioObjectUrl
        );
      } catch {}

      iosAudioObjectUrl = null;
    }

    // iOS Safariの一時的なHTMLAudio状態を引き継がないよう、
    // 毎回Audio要素を作り直す。
    iosAudioElement =
      new Audio();

    iosAudioElement.preload =
      "auto";

    iosAudioElement.playsInline =
      true;

    iosAudioObjectUrl =
      URL.createObjectURL(blob);

    iosAudioElement.src =
      iosAudioObjectUrl;

    iosAudioElement.volume =
      clamp(volume, 0, 1);

    const element =
      iosAudioElement;

    await new Promise<void>(
      (resolve, reject) => {
        const cleanup = () => {
          element.onended = null;
          element.onerror = null;
        };

        element.onended = () => {
          cleanup();
          resolve();
        };

        element.onerror = () => {
          const mediaError = element.error;

          console.warn("[Matcha iOS] HTMLAudio playback failed", {
            attempt,
            mediaErrorCode: mediaError?.code ?? null,
            mediaErrorMessage: mediaError?.message ?? null,
            readyState: element.readyState,
            networkState: element.networkState,
            blobSize: blob.size,
            blobType: blob.type,
          });

          cleanup();
          reject(
            new Error(
              "iPhoneでMatcha音声の再生に失敗しました。"
            )
          );
        };

        try {
          markFirstAudioStart(
            myGenerationId,
            attempt === 1
              ? "html-audio"
              : "html-audio-retry"
          );

          const promise =
            element.play();

          if (
            promise &&
            typeof promise.catch === "function"
          ) {
            void promise.catch(
              (error) => {
                console.warn("[Matcha iOS] element.play() rejected", {
                  attempt,
                  error,
                  readyState: element.readyState,
                  networkState: element.networkState,
                  blobSize: blob.size,
                  blobType: blob.type,
                });

                cleanup();
                reject(error);
              }
            );
          }
        } catch (error) {
          cleanup();
          reject(error);
        }
      }
    );
  };

  try {
    await playAttempt(1);
  } catch (firstError) {
    if (
      myGenerationId !== generationId
    ) {
      return;
    }

    console.warn(
      "[Matcha iOS] first playback failed; retry once",
      firstError
    );

    await new Promise<void>(
      (resolve) => window.setTimeout(resolve, 0)
    );

    try {
      await playAttempt(2);
      ttsDebugLog(
        "[Matcha iOS] retry playback succeeded"
      );
    } catch (retryError) {
      console.error(
        "[Matcha iOS] retry playback failed",
        retryError
      );

      throw new Error(
        "iPhoneでMatcha音声の再生に失敗しました。"
      );
    }
  }
}

async function playSamplesWebAudio(
  audio: SynthesizedAudio,
  volume: number,
  myGenerationId: number
): Promise<void> {
  const context =
    await resumeAudioContext();

  if (
    myGenerationId !== generationId
  ) {
    return;
  }

  try {
    currentSource?.stop();
  } catch {}

  try {
    currentSource?.disconnect();
  } catch {}

  try {
    currentGain?.disconnect();
  } catch {}

  const preparedAudio =
    prepareSpeechPcm(
      audio.samples,
      audio.sampleRate
    );

  const buffer =
    context.createBuffer(
      1,
      preparedAudio.samples.length,
      preparedAudio.sampleRate
    );

  buffer.copyToChannel(
    preparedAudio.samples,
    0
  );

  const source =
    context.createBufferSource();

  source.buffer = buffer;

  // 固定MP3と同じ共通出力チェーン
  // Gain → 軽いCompressor → destination
  const output =
    connectSpeechOutput(
      context,
      source,
      volume
    );

  currentSource = source;
  currentGain = output.gain;

  await new Promise<void>(
    (resolve, reject) => {
      source.onended = () => {
        if (
          currentSource === source
        ) {
          currentSource = null;
          currentGain = null;
        }

        try { output.disconnect(); } catch {}

        resolve();
      };

      try {
        markFirstAudioStart(myGenerationId, "web-audio");
        source.start();
      } catch (error) {
        if (
          currentSource === source
        ) {
          currentSource = null;
          currentGain = null;
        }

        try { output.disconnect(); } catch {}

        reject(error);
      }
    }
  );
}

async function playSamples(
  audio: SynthesizedAudio,
  volume: number,
  myGenerationId: number
) {
  if (isIOSDevice()) {
    await playSamplesIOS(
      audio,
      volume,
      myGenerationId
    );

    return;
  }

  await playSamplesWebAudio(
    audio,
    volume,
    myGenerationId
  );
}


// -----------------------------------------------------------------------------
// 分割キャッシュ結合再生
// 回先頭の「○回の表/裏」「チーム名の攻撃は」「打者紹介」を別々に先読みし、
// 再生時はPCMを1本へ結合してから再生する。
// HTMLAudio/WebAudioを複数回playしないため、部品間に大きな待ち時間を作らない。
// -----------------------------------------------------------------------------
function trimJoinSilence(
  audio: SynthesizedAudio,
  trimStart: boolean,
  trimEnd: boolean,
  keepSilenceMs = 30
): SynthesizedAudio {
  const samples = audio.samples;
  if (!samples.length) return audio;

  // 通常結合は従来どおり約30ms残す。
  // 発音補助のごく短い語境界では 5ms 程度まで縮められるようにする。
  const threshold = 0.0012;
  const keep = Math.max(
    1,
    Math.round(audio.sampleRate * Math.max(0, keepSilenceMs) / 1000)
  );
  let start = 0;
  let end = samples.length;

  if (trimStart) {
    let first = 0;
    while (first < samples.length && Math.abs(samples[first]) < threshold) first++;
    start = Math.max(0, first - keep);
  }

  if (trimEnd) {
    let last = samples.length - 1;
    while (last >= start && Math.abs(samples[last]) < threshold) last--;
    end = Math.min(samples.length, last + 1 + keep);
  }

  if (end <= start) return audio;
  return {
    samples: samples.slice(start, end),
    sampleRate: audio.sampleRate,
  };
}

function joinSynthesizedAudios(
  audios: SynthesizedAudio[],
  joinSilenceMs = 35,
  edgeKeepSilenceMs = 30
): SynthesizedAudio | null {
  const valid = audios.filter((a) => a && a.samples.length > 0);
  if (!valid.length) return null;

  const sampleRate = valid[0].sampleRate;
  if (valid.some((a) => a.sampleRate !== sampleRate)) {
    throw new Error('分割音声のサンプルレートが一致しません。');
  }

  const prepared = valid.map((audio, index) =>
    trimJoinSilence(
      audio,
      index > 0,
      index < valid.length - 1,
      edgeKeepSilenceMs
    )
  );

  const gapSamples = Math.max(0, Math.round(sampleRate * joinSilenceMs / 1000));
  const total = prepared.reduce((sum, a) => sum + a.samples.length, 0) +
    gapSamples * Math.max(0, prepared.length - 1);
  const joined = new Float32Array(total);

  let offset = 0;
  prepared.forEach((audio, index) => {
    joined.set(audio.samples, offset);
    offset += audio.samples.length;
    if (index < prepared.length - 1) offset += gapSamples;
  });

  return { samples: joined, sampleRate };
}

async function synthesizeWholeForJoin(
  text: string,
  speedScale: number,
  myGenerationId: number
): Promise<SynthesizedAudio | null> {
  const chunks = splitMatchaText(text);
  if (!chunks.length) return null;

  const chunkAudios: SynthesizedAudio[] = [];
  for (const chunk of chunks) {
    const audio = await synthesizeMatchaChunk(chunk, speedScale, myGenerationId);
    if (!audio) return null;
    chunkAudios.push(audio);
  }

  // 1部品内で複数チャンクになった場合も、1本にしてから外側で結合する。
  return joinSynthesizedAudios(chunkAudios, 45);
}


// -----------------------------------------------------------------------------
// 外部PCM（固定MP3をdecodeした音声など）とMatcha生成音声を1本に結合するためのAPI。
// tts.ts の speakJoinedTTS() から使用する。
// -----------------------------------------------------------------------------
export async function synthesizeMatchaPcmForJoin(
  text: string,
  options: MatchaSpeakOptions = {}
): Promise<MatchaPcmAudio | null> {
  const cleanText = String(text ?? '').trim();
  if (!cleanText) return null;

  const speedScale = Number.isFinite(options.speedScale)
    ? clamp(Number(options.speedScale), 0.5, 2.0)
    : 1.0;

  // 生成自体はキャッシュ/in-flight共有を使う。再生generationはここでは進めない。
  return synthesizeWholeForJoin(cleanText, speedScale, generationId);
}

export async function playJoinedMatchaPcm(
  audios: MatchaPcmAudio[],
  options: MatchaSpeakOptions = {},
  joinSilenceMs = 35,
  edgeKeepSilenceMs = 30
): Promise<void> {
  const valid = (audios || []).filter((a) => a && a.samples?.length > 0);
  if (!valid.length) return;

  const myGenerationId = ++generationId;
  activeSpeakStartedAt = performance.now();
  activeSpeakGenerationId = myGenerationId;
  activeFirstAudioLogged = false;

  if (isIOSDevice()) {
    unlockMatchaAudioForIOS();
  } else {
    await resumeAudioContext();
  }

  const volume = Number.isFinite(options.volume)
    ? clamp(Number(options.volume), 0, 1)
    : 0.8;

  const joined = joinSynthesizedAudios(valid, joinSilenceMs, edgeKeepSilenceMs);
  if (!joined) return;

  ttsDebugLog('[TTS JOIN] mixed PCM ready', {
    parts: valid.length,
    samples: joined.samples.length,
    durationSec: Math.round((joined.samples.length / joined.sampleRate) * 100) / 100,
  });

  await playSamples(joined, volume, myGenerationId);
}

export async function speakMatchaJoined(
  parts: string[],
  options: MatchaSpeakOptions = {}
): Promise<void> {
  const cleanParts = (parts || [])
    .map((part) => String(part ?? '').trim())
    .filter(Boolean);

  if (!cleanParts.length) return;

  const myGenerationId = ++generationId;
  activeSpeakStartedAt = performance.now();
  activeSpeakGenerationId = myGenerationId;
  activeFirstAudioLogged = false;

  if (isIOSDevice()) {
    unlockMatchaAudioForIOS();
  } else {
    await resumeAudioContext();
  }

  const speedScale = Number.isFinite(options.speedScale)
    ? clamp(Number(options.speedScale), 0.5, 2.0)
    : 1.0;
  const volume = Number.isFinite(options.volume)
    ? clamp(Number(options.volume), 0, 1)
    : 0.8;

  ttsDebugLog('[TTS JOIN] start', {
    parts: cleanParts.length,
    modelId: getSelectedMatchaModelId(),
    previews: cleanParts.map((p) => p.slice(0, 28)),
  });

  const audios: SynthesizedAudio[] = [];
  for (const part of cleanParts) {
    if (myGenerationId !== generationId) return;
    const audio = await synthesizeWholeForJoin(part, speedScale, myGenerationId);
    if (!audio) return;
    audios.push(audio);
  }

  if (myGenerationId !== generationId) return;

  const joined = joinSynthesizedAudios(audios, 35);
  if (!joined) return;

  ttsDebugLog('[TTS JOIN] ready', {
    parts: audios.length,
    samples: joined.samples.length,
    durationSec: Math.round((joined.samples.length / joined.sampleRate) * 100) / 100,
  });

  await playSamples(joined, volume, myGenerationId);
}

export async function speakMatcha(
  text: string,
  options: MatchaSpeakOptions = {}
): Promise<void> {
  const cleanText =
    String(text ?? "").trim();

  if (!cleanText) return;

  const myGenerationId =
    ++generationId;

  activeSpeakStartedAt = performance.now();
  activeSpeakGenerationId = myGenerationId;
  activeFirstAudioLogged = false;

  if (isIOSDevice()) {
    unlockMatchaAudioForIOS();
  } else {
    await resumeAudioContext();
  }

  const speedScale =
    Number.isFinite(
      options.speedScale
    )
      ? clamp(
          Number(
            options.speedScale
          ),
          0.5,
          2.0
        )
      : 1.0;

  const volume =
    Number.isFinite(
      options.volume
    )
      ? clamp(
          Number(
            options.volume
          ),
          0,
          1
        )
      : 0.8;

  const chunks =
    splitMatchaText(cleanText);

  if (!chunks.length) {
    return;
  }

  let nextPromise =
    synthesizeMatchaChunk(
      chunks[0],
      speedScale,
      myGenerationId
    );

  for (
    let index = 0;
    index < chunks.length;
    index++
  ) {
    const current =
      await nextPromise;

    if (
      myGenerationId !== generationId ||
      !current
    ) {
      return;
    }

    if (
      index + 1 <
      chunks.length
    ) {
      nextPromise =
        synthesizeMatchaChunk(
          chunks[index + 1],
          speedScale,
          myGenerationId
        );
    }

    await playSamples(
      current,
      volume,
      myGenerationId
    );

    if (
      myGenerationId !== generationId
    ) {
      return;
    }
  }
}

export async function prefetchMatcha(
  text: string,
  options: MatchaSpeakOptions = {}
): Promise<void> {
  const cleanText =
    String(text ?? "").trim();

  if (!cleanText) return;

  const speedScale =
    Number.isFinite(
      options.speedScale
    )
      ? clamp(
          Number(
            options.speedScale
          ),
          0.5,
          2.0
        )
      : 1.0;

  try {
    const prefetchStartedAt = performance.now();
    const modelId = getSelectedMatchaModelId();
    const chunks =
      splitMatchaText(cleanText);

    ttsDebugLog("[TTS PREFETCH] Matcha start", {
      modelId,
      speedScale: Number(speedScale.toFixed(3)),
      chunks: chunks.length,
      textLength: cleanText.length,
      textPreview: cleanText.slice(0, 42),
    });

    // 画面表示中のバックグラウンド先読みは、先頭1チャンクだけ生成する。
    //
    // 重要:
    // ここで2チャンク目以降まで生成すると、1スレッドの推論Workerに
    // バックグラウンド処理が溜まり、読み上げボタンを押した本番音声が
    // 待たされることがある。
    //
    // 長文の途中については speakMatcha() 側で、
    // 「現在チャンクを再生している間に次チャンクを生成」するため、
    // 再生開始後の先回り生成は維持する。
    const prefetchChunks = chunks.slice(0, 1);

    for (
      const chunk of
      prefetchChunks
    ) {
      const key =
        makeCacheKey(
          chunk,
          speedScale,
          getSelectedMatchaModelId()
        );

      if (
        synthesizedCache.has(key)
      ) {
        continue;
      }

      await synthesizeMatchaChunk(
        chunk,
        speedScale,
        null
      );
    }

    ttsDebugLog("[TTS PREFETCH] Matcha ready", {
      modelId,
      speedScale: Number(speedScale.toFixed(3)),
      chunks: prefetchChunks.length,
      totalMs: Math.round((performance.now() - prefetchStartedAt) * 10) / 10,
      textPreview: cleanText.slice(0, 42),
    });
  } catch (error) {
    console.warn(
      "[Matcha] prefetch failed:",
      error
    );
  }
}

export async function prewarmMatcha(): Promise<void> {
  if (prewarmMatchaPromise) return prewarmMatchaPromise;

  prewarmMatchaPromise = (async () => {
    const modelId = getSelectedMatchaModelId();
    const startedAt = performance.now();

    ttsDebugLog("[TTS PREWARM] start", { modelId });

    // Phase 1高速化:
    // OpenJTalk準備（メイン側）と、1スレッドWorker内のMatcha/Vocos Session作成を
    // 同時に開始する。Worker内部のMatcha→Vocosは従来どおり直列のまま。
    // 4スレッド化は行わない。
    await Promise.all([
      getOpenJTalkReady(),
      initInferenceWorker(modelId),
    ]);

    // ダミー「あ。」推論は行わない。
    // 画面側prefetchTTS()で「実際に次に読む文章」を最優先で生成し、
    // ダミー推論が実文の生成を塞ぐのを防ぐ。

    ttsDebugLog("[TTS PREWARM] ready", {
      modelId,
      totalMs: Math.round((performance.now() - startedAt) * 10) / 10,
    });
  })().catch((error) => {
    prewarmMatchaPromise = null;
    throw error;
  });

  return prewarmMatchaPromise;
}

// 自動起動は tts.ts 側で、React初回描画後にバックグラウンド開始する。

export async function benchmarkMatchaPerformance(
  onProgress?: (progress: MatchaPerformanceProgress) => void
): Promise<MatchaPerformanceResult> {
  const modelId = getSelectedMatchaModelId();

  onProgress?.("preparing");
  const prepareStartedAt = performance.now();
  await prewarmMatcha();
  const prepareMs = performance.now() - prepareStartedAt;

  const generationStartedAt = performance.now();

  onProgress?.("g2p");
  const g2pStartedAt = performance.now();
  const ids = await textToMatchaIds(MATCHA_PERFORMANCE_BENCHMARK_TEXT);
  const g2pMs = performance.now() - g2pStartedAt;

  if (!ids.length) {
    throw new Error("AI音声の性能チェック用テキストを音素へ変換できませんでした。");
  }

  onProgress?.("inference");
  const inferenceStartedAt = performance.now();
  const audio = await postInferenceWorker({
    type: "synthesize",
    ids,
    speedScale: 1.3,
    modelId,
  });
  const inferenceMs = performance.now() - inferenceStartedAt;
  const generationMs = performance.now() - generationStartedAt;

  if (!audio || !audio.samples?.length) {
    throw new Error("AI音声の性能チェック用音声を生成できませんでした。");
  }

  onProgress?.("judging");

  const audioDurationMs =
    (audio.samples.length / Math.max(1, audio.sampleRate)) * 1000;
  const rtf =
    audioDurationMs > 0
      ? generationMs / audioDurationMs
      : 999;

  // Easyアナウンスの即時読み上げ用途を想定した暫定基準。
  const level: MatchaPerformanceLevel =
    generationMs <= 1800
      ? "good"
      : generationMs <= 3200
      ? "warning"
      : "slow";

  const nav = navigator as Navigator & {
    deviceMemory?: number;
  };

  const result: MatchaPerformanceResult = {
    level,
    generationMs: Math.round(generationMs * 10) / 10,
    g2pMs: Math.round(g2pMs * 10) / 10,
    inferenceMs: Math.round(inferenceMs * 10) / 10,
    prepareMs: Math.round(prepareMs * 10) / 10,
    audioDurationMs: Math.round(audioDurationMs * 10) / 10,
    rtf: Math.round(rtf * 1000) / 1000,
    modelId,
    hardwareConcurrency: navigator.hardwareConcurrency || 1,
    deviceMemoryGb:
      Number.isFinite(nav.deviceMemory)
        ? Number(nav.deviceMemory)
        : null,
    crossOriginIsolated:
      typeof self !== "undefined" &&
      self.crossOriginIsolated === true,
  };

  ttsDebugLog("[TTS DEVICE CHECK]", result);
  onProgress?.("complete");
  return result;
}

export function stopMatcha() {
  generationId++;

  try {
    iosAudioElement?.pause();
  } catch {}

  if (iosAudioElement) {
    try {
      iosAudioElement.currentTime = 0;
    } catch {}
  }

  if (iosAudioObjectUrl) {
    try {
      URL.revokeObjectURL(
        iosAudioObjectUrl
      );
    } catch {}

    iosAudioObjectUrl = null;
  }

  try {
    currentSource?.stop();
  } catch {}

  try {
    currentSource?.disconnect();
  } catch {}

  try {
    currentGain?.disconnect();
  } catch {}

  currentSource = null;
  currentGain = null;
}

export function notifyMatchaVoiceChanged(): void {
  // 音声切替後は選択した声を改めてバックグラウンド準備する。
  // キャッシュキー自体にもmodelIdが含まれるが、メモリ使用量を抑えるため一度整理する。
  clearMatchaAudioCache();
  prewarmMatchaPromise = null;

  void prewarmMatcha().catch((error) => {
    console.warn("[TTS PREWARM] voice switch prewarm failed:", error);
  });
}

export function clearMatchaAudioCache() {
  synthesizedCache.clear();
  synthesizedCacheOrder.length = 0;
  synthesisInFlight.clear();
}

// 学習モデルを差し替えた時など、保存済み音声も完全削除したい場合に使用。
export async function clearPersistentMatchaAudioCache(): Promise<void> {
  const db = await openPersistentCacheDb();
  if (!db) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(PERSISTENT_STORE, "readwrite");
      tx.objectStore(PERSISTENT_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
