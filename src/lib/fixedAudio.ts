// src/lib/fixedAudio.ts
// Easyアナウンス 固定文MP3
//
// public/audio/{音声フォルダ}/{4桁ID}.mp3
//
// 固定文は文章を1個だけ登録すればOK。
// 照合時は末尾の句点、空白、改行を無視します。

export type FixedAudioEntry = {
  id: string;
  text: string;
};

export const FIXED_AUDIO_ENTRIES: FixedAudioEntry[] = [
  {
    id: "413",
    text: "この試合は、ただ今で打ち切り、継続試合となります。明日以降に中断した時点から再開いたします。あしからずご了承くださいませ",
  },
  {
    id: "425",
    text: "本日は気温が高く、熱中症が心配されますので、水分をこまめにとり、体調に気を付けてください",
  },
  {
    id: "0378",
    text: "ファウルボールの行方には十分ご注意ください",
  },
  {
    id: "0329",
    text: "ウォーミングアップを終了してください",
  },
  {
    id: "0334",
    text: "ノックを終了してください",
  },
  {
    id: "426",
    text: "ただいまの試合は、ご覧のように",
  },
  {
    id: "416",
    text: "なおこの試合の終了時刻は",
  },
  {
    id: "417",
    text: "審判員の皆様、ありがとうございました",
  },
  {
    id: "418",
    text: "健闘しました両チームの選手に、盛大な拍手をお願いいたします",
  },
  {
    id: "419",
    text: "両チームの監督、キャプテンはピッチングレコードを記載の上、バックネット前にお集まりください",
  },
  {
    id: "420",
    text: "これより、ピッチングレコードの確認を行います",
  },
  {
    id: "421",
    text: "球審、EasyScore担当、公式記録員、球場役員もお集まりください",
  },
];

export type HybridSegment =
  | { type: "fixed"; id: string; text: string }
  | { type: "tts"; text: string };

let currentFixedAudio: HTMLAudioElement | null = null;
let playToken = 0;

// 固定MP3は速度優先でHTMLAudioを直接再生する。
// Matcha側の正規化後音量に近づけるため、固定文だけ軽く音量補正。
// まだ固定文が大きければ 0.92 → 0.88、
// 小さければ 0.92 → 0.96 のように調整する。
const FIXED_AUDIO_VOLUME_GAIN = 0.82;

function canonicalize(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, "")
    .replace(/[。．.!！?？]+$/g, "")
    .trim();
}

function sourceForScan(input: string): string {
  return String(input ?? "")
    .replace(/\r\n?/g, "\n")
    .trim();
}

export function getFixedAudioFolder(): string {
  try {
    // 読み上げ設定とONNXモデルと固定MP3を同じ番号で連動
    // easy-announce-1 = AI音声（谷保さん）  → /audio/1/
    // easy-announce-2 = AI音声（ウグイス嬢）→ /audio/2/
    const selected =
      localStorage.getItem("tts:matcha:model") ||
      localStorage.getItem("tts:piper:model") ||
      "";

    if (
      selected === "easy-announce-2" ||
      selected === "uguisu"
    ) {
      return "2";
    }

    if (
      selected === "easy-announce-1" ||
      selected === "taniho"
    ) {
      return "1";
    }
  } catch {}

  return "1";
}

export function setFixedAudioFolder(folder: string | number): void {
  const value = String(folder ?? "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("固定音声フォルダ名が不正です。");
  }
  localStorage.setItem("tts:fixedAudioFolder", value);
}

export function getFixedAudioUrl(id: string): string {
  return `/audio/${getFixedAudioFolder()}/${id}.mp3`;
}

function urlFor(id: string): string {
  return getFixedAudioUrl(id);
}

function findNextFixed(
  source: string,
  from: number
): { index: number; end: number; entry: FixedAudioEntry } | null {
  let best: { index: number; end: number; entry: FixedAudioEntry } | null = null;

  for (const entry of FIXED_AUDIO_ENTRIES) {
    const targetCanonical = canonicalize(entry.text);
    if (!targetCanonical) continue;

    // 文章は通常それほど長くないため、各位置から照合。
    // 空白・末尾句点・「ニ」補正を無視するためcanonicalizeして比較する。
    for (let i = from; i < source.length; i++) {
      // 十分な長さを少し広めに切り出す
      const maxEnd = Math.min(source.length, i + entry.text.length + 8);

      for (let end = i + 1; end <= maxEnd; end++) {
        const part = source.slice(i, end);
        const c = canonicalize(part);

        if (c === targetCanonical) {
          // 直後に句点があれば固定MP3側へ吸収
          let finalEnd = end;
          while (
            finalEnd < source.length &&
            /[。．.!！?？]/.test(source[finalEnd])
          ) {
            finalEnd++;
          }

          if (!best || i < best.index) {
            best = { index: i, end: finalEnd, entry };
          }
          break;
        }

        // canonicalized partがtargetより長くなったら打ち切り
        if (c.length > targetCanonical.length + 1) break;
      }

      if (best && best.index === i) break;
    }
  }

  return best;
}

export function splitFixedAudioSegments(input: string): HybridSegment[] {
  const source = sourceForScan(input);
  if (!source) return [];

  const result: HybridSegment[] = [];
  let pos = 0;

  while (pos < source.length) {
    const hit = findNextFixed(source, pos);

    if (!hit) {
      const rest = source.slice(pos);
      if (rest.trim()) result.push({ type: "tts", text: rest });
      break;
    }

    if (hit.index > pos) {
      const before = source.slice(pos, hit.index);
      if (before.trim()) result.push({ type: "tts", text: before });
    }

    result.push({
      type: "fixed",
      id: hit.entry.id,
      text: source.slice(hit.index, hit.end),
    });

    pos = hit.end;
  }

  if (!result.length) {
    result.push({ type: "tts", text: source });
  }

  return result;
}

export async function playFixedAudio(
  id: string,
  volume = 0.8
): Promise<boolean> {
  const myToken = ++playToken;

  if (currentFixedAudio) {
    try { currentFixedAudio.pause(); } catch {}
    try { currentFixedAudio.currentTime = 0; } catch {}
    currentFixedAudio = null;
  }

  // 重要:
  // fetch→Blob→play ではなく、ユーザー操作直後に直接 audio.play() する。
  // iPhone/Safariでユーザー操作権限が切れる問題を避ける。
  const audio = new Audio();
  currentFixedAudio = audio;

  audio.preload = "auto";
  audio.playsInline = true;
  audio.volume = Math.max(
    0,
    Math.min(
      1,
      volume * FIXED_AUDIO_VOLUME_GAIN
    )
  );
  const src = urlFor(id);
  audio.src = src;

  const startedAt = performance.now();

  console.log("[FixedMP3] play direct", {
    id,
    folder: getFixedAudioFolder(),
    src,
    volume: audio.volume,
  });

  return await new Promise<boolean>((resolve) => {
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;

      audio.onended = null;
      audio.onerror = null;
      audio.onabort = null;

      if (currentFixedAudio === audio) {
        currentFixedAudio = null;
      }

      resolve(ok && myToken === playToken);
    };

    audio.onended = () => {
      console.log("[FixedMP3] ended", {
        id,
        ms: Math.round((performance.now() - startedAt) * 10) / 10,
      });
      finish(true);
    };
    audio.onerror = () => {
      console.warn("[FixedMP3] failed", {
        id,
        src,
      });
      finish(false);
    };
    audio.onabort = () => finish(false);

    try {
      const p = audio.play();

      if (p && typeof p.catch === "function") {
        void p.catch(() => finish(false));
      }
    } catch {
      finish(false);
    }
  });
}

export async function prefetchFixedAudio(id: string): Promise<void> {
  try {
    await fetch(urlFor(id), {
      method: "GET",
      cache: "force-cache",
    });
  } catch {
    // 失敗しても再生時にMatchaへフォールバック。
  }
}

export function stopFixedAudio(): void {
  playToken++;

  if (currentFixedAudio) {
    try { currentFixedAudio.pause(); } catch {}
    try { currentFixedAudio.currentTime = 0; } catch {}
    currentFixedAudio = null;
  }
}
