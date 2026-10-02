// src/lib/audioPipeline.ts
// Easyアナウンス 共通音声パイプライン
//
// 固定MP3 / Matcha生成PCMの両方に同じ処理を適用して、
// 音量・無音・音圧差を小さくする。

export type SpeechPcm = {
  samples: Float32Array;
  sampleRate: number;
};

let sharedAudioContext: AudioContext | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function isIOSAudioDevice(): boolean {
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

export function getSharedAudioContext(): AudioContext {
  if (
    sharedAudioContext &&
    sharedAudioContext.state !== "closed"
  ) {
    return sharedAudioContext;
  }

  const Ctor =
    window.AudioContext ||
    (
      window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }
    ).webkitAudioContext;

  if (!Ctor) {
    throw new Error("AudioContextを利用できません。");
  }

  sharedAudioContext = new Ctor();
  return sharedAudioContext;
}

export async function resumeSharedAudioContext(): Promise<AudioContext> {
  const context = getSharedAudioContext();

  if (context.state !== "running") {
    try {
      await context.resume();
    } catch {}
  }

  return context;
}

function findSpeechRange(
  samples: Float32Array,
  sampleRate: number
): { start: number; end: number } {
  if (!samples.length) {
    return { start: 0, end: 0 };
  }

  // 小さなノイズを音声開始と誤判定しにくい値。
  const threshold = 0.0015;

  // 語頭・語尾を削りすぎないため少し余白を残す。
  const keepStart = Math.round(sampleRate * 0.018);
  const keepEnd = Math.round(sampleRate * 0.028);

  let first = 0;
  while (
    first < samples.length &&
    Math.abs(samples[first]) < threshold
  ) {
    first++;
  }

  let last = samples.length - 1;
  while (
    last > first &&
    Math.abs(samples[last]) < threshold
  ) {
    last--;
  }

  if (first >= samples.length) {
    return { start: 0, end: samples.length };
  }

  return {
    start: Math.max(0, first - keepStart),
    end: Math.min(samples.length, last + 1 + keepEnd),
  };
}

function calculateActiveRms(samples: Float32Array): number {
  if (!samples.length) return 0;

  // 無音部をRMS計算から除外。
  const gate = 0.0045;
  let sum = 0;
  let count = 0;

  for (let i = 0; i < samples.length; i++) {
    const value = samples[i];
    if (Math.abs(value) < gate) continue;

    sum += value * value;
    count++;
  }

  if (count < 32) {
    for (let i = 0; i < samples.length; i++) {
      const value = samples[i];
      sum += value * value;
    }
    count = samples.length;
  }

  if (!count) return 0;
  return Math.sqrt(sum / count);
}

function applyShortFade(
  samples: Float32Array,
  sampleRate: number
): void {
  const fadeSamples = Math.min(
    Math.round(sampleRate * 0.006),
    Math.floor(samples.length / 4)
  );

  if (fadeSamples <= 1) return;

  for (let i = 0; i < fadeSamples; i++) {
    const ratio = i / fadeSamples;
    samples[i] *= ratio;

    const endIndex = samples.length - 1 - i;
    samples[endIndex] *= ratio;
  }
}

/**
 * 固定MP3 / Matcha の双方へ同じ基準で適用。
 *
 * targetRms:
 *  約 -19dBFS相当。
 *  音量を上げすぎず、場内アナウンスとして聞き取りやすい範囲。
 */
export function prepareSpeechPcm(
  input: Float32Array,
  sampleRate: number
): SpeechPcm {
  if (!input.length) {
    return {
      samples: input,
      sampleRate,
    };
  }

  const range = findSpeechRange(input, sampleRate);
  const trimmed = input.slice(range.start, range.end);

  const rms = calculateActiveRms(trimmed);
  const targetRms = 0.112;

  let gain = rms > 0.00001
    ? targetRms / rms
    : 1;

  // 録音差が極端でも不自然に持ち上げ/下げしない。
  gain = clamp(gain, 0.60, 1.65);

  let peak = 0;
  for (let i = 0; i < trimmed.length; i++) {
    peak = Math.max(peak, Math.abs(trimmed[i] * gain));
  }

  // クリップ防止。
  const maxPeak = 0.92;
  if (peak > maxPeak && peak > 0) {
    gain *= maxPeak / peak;
  }

  const output = new Float32Array(trimmed.length);

  for (let i = 0; i < trimmed.length; i++) {
    output[i] = clamp(trimmed[i] * gain, -0.98, 0.98);
  }

  applyShortFade(output, sampleRate);

  return {
    samples: output,
    sampleRate,
  };
}

export type SpeechOutputNodes = {
  gain: GainNode;
  compressor: DynamicsCompressorNode;
  disconnect: () => void;
};

/**
 * 固定MP3 / MatchaのWebAudio再生で共通使用。
 * 軽いコンプレッションだけにして声質を変えすぎない。
 */
export function connectSpeechOutput(
  context: AudioContext,
  source: AudioNode,
  volume: number
): SpeechOutputNodes {
  const gain = context.createGain();
  const compressor = context.createDynamicsCompressor();

  gain.gain.value = clamp(volume, 0, 1);

  compressor.threshold.value = -18;
  compressor.knee.value = 14;
  compressor.ratio.value = 2.2;
  compressor.attack.value = 0.004;
  compressor.release.value = 0.14;

  source.connect(gain);
  gain.connect(compressor);
  compressor.connect(context.destination);

  return {
    gain,
    compressor,
    disconnect: () => {
      try { source.disconnect(); } catch {}
      try { gain.disconnect(); } catch {}
      try { compressor.disconnect(); } catch {}
    },
  };
}

export function float32ToWavBlob(
  samples: Float32Array,
  sampleRate: number
): Blob {
  const bytesPerSample = 2;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;

  for (let i = 0; i < samples.length; i++, offset += 2) {
    const sample = clamp(samples[i], -1, 1);
    view.setInt16(
      offset,
      sample < 0
        ? Math.round(sample * 0x8000)
        : Math.round(sample * 0x7fff),
      true
    );
  }

  return new Blob([buffer], { type: "audio/wav" });
}
