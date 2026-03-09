// src/Contact.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  onBack: () => void;
  version?: string; // App.tsx から渡す
};


const ENDPOINT = "https://formspree.io/f/xyknkzpa";

const SUBJECT  = "Easyアナウンスお問い合わせ";

const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);
const IconMail = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M20 4H4a2 2 0 00-2 2v12a2 2 0 002 2h16a2 2 0 002-2V6a2 2 0 00-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z"/>
  </svg>
);
const IconSend = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/>
  </svg>
);
const IconTrash = () => (
  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor" aria-hidden>
    <path d="M6 7h12l-1 14H7L6 7zm3-3h6l1 2H8l1-2z"/>
  </svg>
);
const IconImage = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M21 19V5a2 2 0 0 0-2-2H5C3.89 3 3 3.9 3 5v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2zM8.5 13.5 11 17l3.5-4.5L19 20H5l3.5-6.5zM8 8a2 2 0 1 1 .001 3.999A2 2 0 0 1 8 8z"/>
  </svg>
);

type Preview = { file: File; url: string };

export default function Contact({ onBack, version = "0.0.1" }: Props) {
  const [text, setText] = useState("");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);

  // 添付ファイル（画像のみ・タップ選択）
  const [files, setFiles] = useState<Preview[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // オブジェクトURL解放
  useEffect(() => {
    return () => files.forEach(p => URL.revokeObjectURL(p.url));
  }, [files]);

  const count = text.length;
  const totalSizeMB = useMemo(
    () => (files.reduce((s, f) => s + f.file.size, 0) / (1024 * 1024)),
    [files]
  );

  const addFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const arr = Array.from(fileList).filter(f => f.type.startsWith("image/"));
    if (arr.length === 0) return;

    // 上限（例: 最大10枚 / 画像1枚あたり 10MB / 合計 40MB）
    const MAX_FILES = 10;
    const MAX_EACH_MB = 10;
    const MAX_TOTAL_MB = 40;

    const current = [...files];
    for (const f of arr) {
      if (current.length >= MAX_FILES) break;
      if (f.size > MAX_EACH_MB * 1024 * 1024) {
        alert(`画像が大きすぎます（${f.name}: 最大 ${MAX_EACH_MB}MB）`);
        continue;
      }
      current.push({ file: f, url: URL.createObjectURL(f) });
      const sumMB = current.reduce((s, p) => s + p.file.size, 0) / (1024 * 1024);
      if (sumMB > MAX_TOTAL_MB) {
        alert(`合計サイズが大きすぎます（最大 ${MAX_TOTAL_MB}MB）`);
        const last = current.pop();
        if (last) URL.revokeObjectURL(last.url);
        break;
      }
    }
    setFiles(current);
  };

  const removeFile = (idx: number) => {
    setFiles(prev => {
      const copy = [...prev];
      const [rm] = copy.splice(idx, 1);
      if (rm) URL.revokeObjectURL(rm.url);
      return copy;
    });
  };

  // 送信
  const submit = async () => {
    const body = text.trim();
    if (!body) {
      alert("お問い合わせ内容をご入力ください。");
      return;
    }
try {
  setSending(true);

// multipart/form-data で送る（Getform向け）
const fd = new FormData();
fd.append("_subject", SUBJECT);
fd.append("subject", SUBJECT);
fd.append("message", body);
fd.append("version", version);
fd.append("email", email.trim()); 

// ★ ここを 'file' → 'files[]' に変更（複数添付の推奨形）
files.forEach(p => fd.append("files[]", p.file, p.file.name));

for (const [key, value] of fd.entries()) {
  console.log(key, value);
}

const res = await fetch(ENDPOINT, {
  method: "POST",
  // Content-Type は付けない（ブラウザが boundary を付与）
  headers: { Accept: "application/json" },
  body: fd,
});

  // 失敗時の詳細をできるだけ拾う
  let detail = "";
  let json: any = null;
  try {
    json = await res.json();
    if (json?.errors?.length) {
      detail = json.errors.map((e: any) => e.message || e.code).join("; ");
    } else if (json?.error) {
      detail = json.error;
    }
  } catch {
    // JSONで返らないケースもあるので握りつぶす
  }

  if (!res.ok) {
    console.error("Formspree error:", { status: res.status, statusText: res.statusText, json });
    alert(`送信に失敗しました：${res.status} ${res.statusText}${detail ? " / " + detail : ""}`);
    return;
  }

  alert("送信しました。ありがとうございました。");
  setText("");

  // 添付の後始末とUIクリア
  files.forEach(p => URL.revokeObjectURL(p.url));
  setFiles([]);
  if (fileInputRef.current) fileInputRef.current.value = "";

} catch {
  alert("送信時にエラーが発生しました。ネットワークをご確認ください。");
} finally {
  setSending(false);
}

  };

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full">
        {/* ヘッダー */}
        <div className="w-[100svw] -mx-6 md:mx-0 md:w-full flex items-center justify-between mb-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-white/90 active:scale-95 px-3 py-2 rounded-lg bg-white/10 border border-white/10"
          >
            <IconBack />
            <span className="text-sm">運用設定に戻る</span>
          </button>
          <div className="w-10" />
        </div>

        {/* タイトル */}
        <div className="mt-1 text-center select-none mb-2 w-full">
          <h1 className="inline-flex items-center gap-2 text-3xl font-extrabold tracking-wide leading-tight">
            <IconMail />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              お問い合わせ
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <p className="text-white/70 text-sm mt-2">ご要望・不具合報告など、写真（画像）を添付できます。</p>
        </div>

        {/* 本体カード */}
        <section
          className="w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4"
        >
          {/* 本文 */}
          <label className="block">
            <div className="text-sm text-white/90 mb-2 font-semibold">
              お問い合わせ内容 <span className="text-rose-300">※必須</span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={10}
              className="w-full rounded-2xl bg-white/90 text-gray-900 border border-white/70 shadow-sm
                         p-4 outline-none focus:ring-2 focus:ring-sky-400 placeholder-gray-600"
              placeholder="ご自由にご記入ください（不具合時は再現手順・環境など）"
              required
            />
            <div className="mt-1 text-right text-xs text-white/60">{count} 文字</div>
          </label>

<label className="block">
  <div className="text-sm text-white/90 mb-2 font-semibold">
    返信用メールアドレス <span className="text-white/60">（任意）</span>
  </div>

  <input
    type="email"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    className="w-full rounded-2xl bg-white/90 text-gray-900 border border-white/70 shadow-sm
               p-4 outline-none focus:ring-2 focus:ring-sky-400 placeholder-gray-600"
    placeholder="返信が必要な場合のみ入力してください"
  />

  <div className="text-xs text-white/60 mt-1">
    ※返信が必要な場合のみご入力ください
  </div>
</label>



          {/* 送信 */}
          <div className="text-center">
            <button
              className={`inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl font-semibold shadow active:scale-95
                         ${sending ? "bg-gray-500 cursor-not-allowed" : "bg-blue-600 hover:bg-blue-700 text-white"}`}
              onClick={submit}
              disabled={sending}
            >
              <IconSend />
              {sending ? "送信中..." : "送信する"}
            </button>
            <div className="mt-3 text-sm text-white/70">
              Version: <span className="font-semibold">{version}</span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
