// src/lib/matchaInferenceWorker.ts
// Matcha/Vocos/ISTFT専用Worker。
// OpenJTalk(G2P)とAudio再生はメインスレッド、重いONNX推論だけWorkerで実行する。

import * as ort from "onnxruntime-web/wasm";


// -----------------------------------------------------------------------------
// TTSデバッグログ
// 本番では false。必要なときだけ true にすると console.log が復活する。
// warn / error は異常検知のため常時残す。
// -----------------------------------------------------------------------------
const TTS_DEBUG = false;
const ttsDebugLog = (...args: any[]) => {
  if (TTS_DEBUG) ttsDebugLog(...args);
};

type MatchaModelId = "taniho" | "uguisu";

const MATCHA_MODEL_URLS: Record<MatchaModelId, string> = {
  taniho: "/models/easy-announce/matcha/TANIHO.onnx",
  uguisu: "/models/easy-announce/matcha/UGUISU.onnx",
};
const VOCOS_MODEL_URL =
  "/models/easy-announce/matcha/vocos-22khz-univ.onnx";

const SAMPLE_RATE = 22050;
const N_FFT = 1024;
const HOP_LENGTH = 256;
const N_BINS = 513;
const MEL_BINS = 80;
const MATCHA_TEMPERATURE = 0.667;

const matchaSessionPromises = new Map<MatchaModelId, Promise<ort.InferenceSession>>();
let vocosSessionPromise: Promise<ort.InferenceSession> | null = null;
let ortConfigured = false;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function bigintArray(values: number[]): BigInt64Array {
  return new BigInt64Array(values.map((value) => BigInt(value)));
}

function configureOrt() {
  if (ortConfigured) return;
  ortConfigured = true;

  // 自前Workerの中なのでORT proxyは不要。
  ort.env.wasm.proxy = false;

  const cores =
    typeof navigator !== "undefined"
      ? navigator.hardwareConcurrency || 1
      : 1;

  const canUseThreads =
    typeof self !== "undefined" &&
    self.crossOriginIsolated === true;

  // crossOriginIsolated=true の端末では WASM Threads を使用。
  // 端末の論理コア数に余裕がある場合だけ最大4スレッドまで使い、
  // 条件を満たさない端末は安全に1スレッドへフォールバックする。
  const usableThreads = canUseThreads
    ? Math.min(4, Math.max(1, cores - 1))
    : 1;

  ort.env.wasm.numThreads = usableThreads;

  ttsDebugLog("[TTS PERF] ORT config", {
    crossOriginIsolated: canUseThreads,
    hardwareConcurrency: cores,
    numThreads: ort.env.wasm.numThreads,
  });

  const origin = self.location.origin;
  ort.env.wasm.wasmPaths = {
    wasm: `${origin}/ort/ort-wasm-simd-threaded.wasm`,
    mjs: `${origin}/ort/ort-wasm-simd-threaded.mjs`,
  } as any;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} の取得に失敗しました (HTTP ${response.status})`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function getMatchaSession(
  modelId: MatchaModelId
): Promise<ort.InferenceSession> {
  const existing = matchaSessionPromises.get(modelId);
  if (existing) return existing;

  configureOrt();

  const promise = (async () => {
    const url = MATCHA_MODEL_URLS[modelId];
    ttsDebugLog("[TTS LOAD] Matcha fetch start", { modelId, url });
    const start = performance.now();
    const bytes = await fetchBytes(url);
    const fetchMs = performance.now() - start;
    ttsDebugLog("[TTS LOAD] Matcha fetch complete", { modelId, bytes: bytes.byteLength, fetchMs: Math.round(fetchMs * 10) / 10 });

    ttsDebugLog("[TTS LOAD] Matcha session create start", { modelId });
    const sessionStart = performance.now();
    const session = await ort.InferenceSession.create(bytes, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });

    ttsDebugLog("[TTS PERF] Matcha model ready", {
      modelId,
      fetchMs: Math.round(fetchMs * 10) / 10,
      sessionMs: Math.round((performance.now() - sessionStart) * 10) / 10,
    });

    return session;
  })().catch((error) => {
    matchaSessionPromises.delete(modelId);
    throw error;
  });

  matchaSessionPromises.set(modelId, promise);
  return promise;
}

async function getVocosSession(): Promise<ort.InferenceSession> {
  if (!vocosSessionPromise) {
    configureOrt();
    vocosSessionPromise = (async () => {
      ttsDebugLog("[TTS LOAD] Vocos fetch start", { url: VOCOS_MODEL_URL });
      const start = performance.now();
      const bytes = await fetchBytes(VOCOS_MODEL_URL);
      const fetchMs = performance.now() - start;
      ttsDebugLog("[TTS LOAD] Vocos fetch complete", { bytes: bytes.byteLength, fetchMs: Math.round(fetchMs * 10) / 10 });

      ttsDebugLog("[TTS LOAD] Vocos session create start");
      const sessionStart = performance.now();
      const session = await ort.InferenceSession.create(bytes, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });

      ttsDebugLog("[TTS PERF] Vocos model ready", {
        fetchMs: Math.round(fetchMs * 10) / 10,
        sessionMs: Math.round((performance.now() - sessionStart) * 10) / 10,
      });

      return session;
    })().catch((error) => {
      vocosSessionPromise = null;
      throw error;
    });
  }
  return vocosSessionPromise;
}

function ifft(real: Float64Array, imag: Float64Array): void {
  const n = real.length;

  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = real[i]; real[i] = real[j]; real[j] = tr;
      const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
    }
  }

  for (let len = 2; len <= n; len <<= 1) {
    const angle = (2 * Math.PI) / len;
    const wlenR = Math.cos(angle);
    const wlenI = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let wr = 1;
      let wi = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vr0 = real[i + j + len / 2];
        const vi0 = imag[i + j + len / 2];
        const vR = vr0 * wr - vi0 * wi;
        const vI = vr0 * wi + vi0 * wr;

        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len / 2] = uR - vR;
        imag[i + j + len / 2] = uI - vI;

        const nextWr = wr * wlenR - wi * wlenI;
        wi = wr * wlenI + wi * wlenR;
        wr = nextWr;
      }
    }
  }

  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] /= n;
  }
}

function hannWindow(n: number): Float32Array {
  const window = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  }
  return window;
}

function istftFromVocos(
  mag: Float32Array,
  xr: Float32Array,
  yi: Float32Array,
  frames: number
): Float32Array {
  const rawLength = N_FFT + HOP_LENGTH * (frames - 1);
  const output = new Float32Array(rawLength);
  const norm = new Float32Array(rawLength);
  const window = hannWindow(N_FFT);
  const real = new Float64Array(N_FFT);
  const imag = new Float64Array(N_FFT);

  for (let t = 0; t < frames; t++) {
    real.fill(0);
    imag.fill(0);

    for (let k = 0; k < N_BINS; k++) {
      const index = k * frames + t;
      real[k] = mag[index] * xr[index];
      imag[k] = mag[index] * yi[index];
    }

    for (let k = 1; k < N_BINS - 1; k++) {
      real[N_FFT - k] = real[k];
      imag[N_FFT - k] = -imag[k];
    }

    ifft(real, imag);

    const base = t * HOP_LENGTH;
    for (let i = 0; i < N_FFT; i++) {
      const w = window[i];
      output[base + i] += real[i] * w;
      norm[base + i] += w * w;
    }
  }

  for (let i = 0; i < rawLength; i++) {
    if (norm[i] > 1e-8) output[i] /= norm[i];
  }

  const trim = N_FFT / 2;
  return output.slice(trim, rawLength - trim);
}

async function synthesize(ids: number[], speedScale: number, modelId: MatchaModelId): Promise<Float32Array> {
  const totalStart = performance.now();
  const sessionWaitStart = performance.now();

  // MatchaとVocosを同時に初期化すると、特にWASMマルチスレッド環境で
  // 大きなモデルの読み込み・Session作成が競合することがあるため直列化する。
  const matchaSession = await getMatchaSession(modelId);
  const vocosSession = await getVocosSession();

  const sessionWaitMs = performance.now() - sessionWaitStart;

  const x = new ort.Tensor("int64", bigintArray(ids), [1, ids.length]);
  const xLengths = new ort.Tensor("int64", bigintArray([ids.length]), [1]);

  const safeSpeed = clamp(speedScale, 0.5, 2.0);
  const lengthScale = 1 / safeSpeed;
  const scales = new ort.Tensor(
    "float32",
    new Float32Array([MATCHA_TEMPERATURE, lengthScale]),
    [2]
  );

  const matchaStart = performance.now();
  const matchaOutput = await matchaSession.run({
    x,
    x_lengths: xLengths,
    scales,
  });
  const matchaMs = performance.now() - matchaStart;

  const melTensor =
    (matchaOutput as any).mel || matchaOutput[matchaSession.outputNames[0]];
  const melLengthTensor =
    (matchaOutput as any).mel_lengths || matchaOutput[matchaSession.outputNames[1]];

  let frames = Number(melTensor.dims[melTensor.dims.length - 1]);
  if (melLengthTensor?.data?.length) {
    const valid = Number(melLengthTensor.data[0]);
    if (valid > 0) frames = Math.min(frames, valid);
  }

  const originalFrames = Number(melTensor.dims[melTensor.dims.length - 1]);
  let melData = melTensor.data as Float32Array;

  if (frames !== originalFrames) {
    const clipped = new Float32Array(MEL_BINS * frames);
    for (let channel = 0; channel < MEL_BINS; channel++) {
      clipped.set(
        melData.subarray(
          channel * originalFrames,
          channel * originalFrames + frames
        ),
        channel * frames
      );
    }
    melData = clipped;
  }

  const vocosStart = performance.now();
  const vocosOutput = await vocosSession.run({
    mels: new ort.Tensor("float32", melData, [1, MEL_BINS, frames]),
  });
  const vocosMs = performance.now() - vocosStart;

  const magTensor =
    (vocosOutput as any).mag || vocosOutput[vocosSession.outputNames[0]];
  const xTensor =
    (vocosOutput as any).x || vocosOutput[vocosSession.outputNames[1]];
  const yTensor =
    (vocosOutput as any).y || vocosOutput[vocosSession.outputNames[2]];

  const istftStart = performance.now();
  const samples = istftFromVocos(
    magTensor.data as Float32Array,
    xTensor.data as Float32Array,
    yTensor.data as Float32Array,
    frames
  );
  const istftMs = performance.now() - istftStart;

  ttsDebugLog("[TTS PERF] inference", {
    modelId,
    ids: ids.length,
    frames,
    sessionWaitMs: Math.round(sessionWaitMs * 10) / 10,
    matchaMs: Math.round(matchaMs * 10) / 10,
    vocosMs: Math.round(vocosMs * 10) / 10,
    istftMs: Math.round(istftMs * 10) / 10,
    totalMs: Math.round((performance.now() - totalStart) * 10) / 10,
  });

  return samples;
}

type WorkerRequest =
  | { type: "init"; id: number; modelId: MatchaModelId }
  | { type: "synthesize"; id: number; ids: number[]; speedScale: number; modelId: MatchaModelId };

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;

  try {
    if (message.type === "init") {
      // 初期化は必ず直列。ORTのWASM初期化と巨大モデルSession作成の競合を避ける。
      await getMatchaSession(message.modelId);
      await getVocosSession();
      self.postMessage({ type: "ready", id: message.id });
      return;
    }

    if (message.type === "synthesize") {
      const samples = await synthesize(message.ids, message.speedScale, message.modelId);
      self.postMessage(
        {
          type: "result",
          id: message.id,
          sampleRate: SAMPLE_RATE,
          samplesBuffer: samples.buffer,
        },
        [samples.buffer]
      );
    }
  } catch (error) {
    self.postMessage({
      type: "error",
      id: message.id,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
