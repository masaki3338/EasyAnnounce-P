// VersionInfo.tsx（更新確認・強制再読み込み対応）
import React, { useEffect, useRef, useState } from "react";

type Props = {
  version: string;
  onBack: () => void;
  onOpenContact: () => void;
};

// ── 見た目用ミニアイコン（ロジック非依存） ──
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);
const IconInfo = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9a10 10 0 1010 10A10 10 0 0012 2z" />
  </svg>
);
const IconHistory = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M13 3a9 9 0 109 9h-2a7 7 0 11-7-7V3l3 3-3 3V6a5 5 0 105 5h2A7 7 0 1113 5z"/>
  </svg>
);
const IconLegal = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M3 5h18v2H3V5zm2 4h14v10H5V9zm2 2v6h10v-6H7z"/>
  </svg>
);

type HistoryItem = {
  date: string;
  version: string;
  details: string[];
};

const historyData: HistoryItem[] = [
  {
    date: "2026.05.26",
    version: "Version 1.00",
    details: ["GooglePlay Release"],
  },
  {
    date: "2026.06.15",
    version: "Version 1.01",
    details: ["シートノック時間変更可能対応"],
  },
  {
    date: "2026.07.20",
    version: "Version 1.02",
    details: ["1人で両チームアナウンス対応"],
  },
  {
    date: "2026.07.23",
    version: "Version 1.03",
    details: [
      `投球数ボタンの操作性を改善
      ・ボタン押下時のデザインを変更
      ・Android端末でバイブレーション機能を追加`,
    ],
  },
  {
    date: "2026.08.07",
    version: "Version 1.04",
    details: [
      `運用設定画面に下記追加
      ・給水タイムのアナウンス設定
      ・グラウンド整備のアナウンス設定`,
    ],
  },
  {
    date: "2026.09.30",
    version: "Version 1.05",
    details: [
      `・読み上げ設定画面でAI音声の選択追加
       ・チーム選手データのQRコード共有追加`,
    ],
  },
  {
    date: "2026.10.05",
    version: "Version 1.06",
    details: ["アナウンス履歴機能を追加"],
  },



];

export default function VersionInfo({ version, onBack }: Props) {
  const [openIndex, setOpenIndex] = useState<number | null>(0); // 最新を最初から開く

  const [checking, setChecking] = useState(false);
  const [updateMessage, setUpdateMessage] = useState("");
  const updateLock = useRef(false);
  const updateAbort = useRef<AbortController | null>(null);
  const [applying, setApplying] = useState(false);
  useEffect(() => () => { updateAbort.current?.abort(); }, []);


  // ビルド時に埋め込んだIDと、公開先の小さなJSONを比較する。
  const checkForUpdate = async () => {
    if (updateLock.current) return;
    if (!navigator.onLine) {
      setUpdateMessage("ネットワークにつながっていません。インターネットに接続してから、もう一度お試しください。");
      return;
    }
    updateLock.current = true;
    setChecking(true);
    setUpdateMessage("最新版を確認しています…");
    const controller = new AbortController();
    updateAbort.current = controller;
    let timedOut = false;
    let timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 8000);
    const abortError = () => new DOMException("更新を中止しました", "AbortError");
    // fetch以外のブラウザーAPIにもタイムアウトを適用する。
    const wait = <T,>(operation: Promise<T>): Promise<T> => new Promise((resolve, reject) => {
      const onAbort = () => { cleanup(); reject(abortError()); };
      const cleanup = () => controller.signal.removeEventListener("abort", onAbort);
      if (controller.signal.aborted) { reject(abortError()); return; }
      controller.signal.addEventListener("abort", onAbort, { once: true });
      operation.then((value) => { cleanup(); resolve(value); }, (error) => { cleanup(); reject(error); });
    });
    const pause = () => wait(new Promise<void>((resolve) => window.setTimeout(resolve, 100)));
    try {
      const entryUrl = new URL(import.meta.env.BASE_URL, window.location.origin);
      const checkUrl = new URL("app-update.json", entryUrl);
      checkUrl.searchParams.set("__easy_update_check", Date.now().toString());
      const response = await wait(fetch(checkUrl.href, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      }));
      if (!response.ok) throw new Error("server");
      const latest = await wait(response.json());
      const currentBuildId = import.meta.env.VITE_APP_BUILD_ID;
      if (typeof latest?.buildId !== "string" || !latest.buildId || !currentBuildId) {
        setUpdateMessage("更新情報を確認できませんでした。更新用の設定が公開されているか確認してください。");
        return;
      }
      if (latest.buildId === currentBuildId) {
        setUpdateMessage(import.meta.env.DEV
          ? "開発画面です。現在の開発サーバーと更新IDが一致しています。公開版の更新確認はVercelのURLで行ってください。"
          : "現在お使いのアプリは最新版です。");
        return;
      }
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 30000);
      setUpdateMessage("新しいバージョンがあります。更新ファイルを準備しています…（音声の取得で時間がかかる場合があります）");
      let waiting: ServiceWorker | null = null;
      if ("serviceWorker" in navigator) {
        const registration = await wait(navigator.serviceWorker.getRegistration(window.location.href));
        if (registration) {
          await wait(registration.update());
          while (registration.installing && !registration.waiting) await pause();
          waiting = registration.waiting;
        }
      }
      // 再読み込み前に公開先のHTMLにも接続できることを確認。
      const htmlUrl = new URL("index.html", entryUrl);
      htmlUrl.searchParams.set("__easy_updated", latest.buildId);
      const htmlResponse = await wait(fetch(htmlUrl.href, { cache: "no-store", signal: controller.signal }));
      if (!htmlResponse.ok || !/<script[^>]+src=/i.test(await wait(htmlResponse.text()))) throw new Error("html");
      if (controller.signal.aborted) throw abortError();
      if (!navigator.onLine) throw new Error("offline");
      setApplying(true);
      setUpdateMessage("更新を適用しています…");
      if (waiting) {
        waiting.postMessage({ type: "SKIP_WAITING" });
        while (waiting.state !== "activated" && waiting.state !== "redundant") await pause();
        if (waiting.state !== "activated") throw new Error("activation");
      }
      if (controller.signal.aborted) throw abortError();
      if (!navigator.onLine) throw new Error("offline");
      setUpdateMessage("更新の準備ができました。アプリを再読み込みしています…");
      const reloadUrl = new URL(window.location.href);
      reloadUrl.searchParams.set("__easy_updated", latest.buildId);
      window.location.replace(reloadUrl.href);
    } catch (error) {
      if (!navigator.onLine) {
        setUpdateMessage("ネットワークにつながっていません。インターネットに接続してから、もう一度お試しください。");
      } else if (error instanceof Error && error.name === "AbortError") {
        setUpdateMessage(timedOut
          ? "確認・更新の待ち時間を超えました。Wi-Fiなど接続状況を確認して、もう一度お試しください。"
          : "更新を中止しました。現在のバージョンで引き続き使用できます。");
      } else {
        setUpdateMessage("最新版を確認・更新できませんでした。インターネット接続やサーバーの状態を確認して、もう一度お試しください。");
      }
    } finally {
      window.clearTimeout(timeout);
      if (updateAbort.current === controller) updateAbort.current = null;
      updateLock.current = false;
      setChecking(false);
      setApplying(false);
    }
  };

  const start = 2025;
  const y = new Date().getFullYear();
  const year = start === y ? `${y}` : `${start}–${y}`;

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
            disabled={applying}
            onClick={() => { updateAbort.current?.abort(); onBack(); }}
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
            <IconInfo />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              バージョン情報
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
        </div>

        {/* Version & 更新履歴 */}
        <section className="w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4">

          <div className="text-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-white/10 border border-white/10 text-sm">
              <IconInfo />
              <span className="font-semibold">Version {version}</span>
            </span>
          </div>

          <div className="mx-auto w-full max-w-md space-y-3">
            <button
              type="button"
              onClick={checkForUpdate}
              disabled={checking}
              aria-busy={checking}
              className="w-full min-h-[48px] rounded-xl bg-sky-500 px-4 py-3 text-base font-bold text-white shadow active:scale-[0.99] disabled:opacity-60 disabled:cursor-wait"
            >
              {checking ? "確認・更新中…" : "最新版を確認・更新"}
            </button>
            {checking && !applying && (
              <button type="button" onClick={() => updateAbort.current?.abort()} className="w-full min-h-[44px] rounded-xl border border-white/30 px-4 py-2 text-sm">
                確認・更新準備を中止
              </button>
            )}
            <p className="text-center text-xs text-gray-300">
              新しいバージョンがある場合、更新してアプリを再読み込みします。
              入力中の内容は保存してから押してください。
            </p>
            {updateMessage && (
              <p role="status" aria-live="polite" className="rounded-xl border border-sky-300/30 bg-sky-950/50 px-4 py-3 text-sm leading-relaxed">
                {updateMessage}
              </p>
            )}
          </div>

          {/* 更新履歴アコーディオン */}
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
                <IconHistory />
              </span>
              <h2 className="text-lg font-bold">更新履歴</h2>
            </div>

            <ul className="space-y-3">
              {historyData.map((item, index) => (
                <li key={index} className="rounded-xl bg-white/5 border border-white/10">
                  <button
                    onClick={() =>
                      setOpenIndex(openIndex === index ? null : index)
                    }
                    className="w-full text-left px-4 py-3 flex justify-between items-center active:scale-[0.99]"
                  >
                    <span className="font-medium text-base">
                      {item.date}　{item.version}
                    </span>
                    <span className="text-sm">
                      {openIndex === index ? "▲" : "▼"}
                    </span>
                  </button>

                  {openIndex === index && (
                    <div className="px-6 pb-4 text-sm text-gray-300">
                      <ul className="list-disc ml-4 space-y-1">
                        {item.details.map((d, i) => (
                          <li key={i} className="whitespace-pre-line">
                            {d}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 法的情報 */}
        <section className="mt-4 w-[100svw] -mx-6 md:mx-0 md:w-full rounded-none md:rounded-2xl p-4 md:p-6
                     bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow space-y-4">

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center justify-center w-8 h-8 rounded-xl bg-white/10 border border-white/10">
              <IconLegal />
            </span>
            <h2 className="text-lg font-bold">法的情報 / Legal</h2>
          </div>

          <p><span className="font-medium">アプリ名：</span>野球アナウンス支援 Easyアナウンス</p>

          <div>
            <h3 className="font-semibold mb-1">著作権</h3>
            <p>© {year} M.OKUMURA. All rights reserved.</p>
            <p className="mt-2">
              本アプリおよび付随するコンテンツは著作権法等により保護されています。無断複製・転載・再配布を禁じます。
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-1">免責事項</h3>
            <p>
              本アプリは野球試合のアナウンスを支援する目的で提供されています。
              本アプリの利用または利用できなかったことにより生じたいかなる損害・トラブルについても、
              開発者は一切の責任を負いません。
            </p>
            <p className="mt-2">
              ご利用にあたっては、利用者ご自身の責任においてご使用ください。
            </p>
          </div>

          <div>
            <h3 className="font-semibold mb-1">商標</h3>
            <p>
              Google、Google Cloud は Google LLC の商標です。
              その他記載の会社名・製品名は各社の商標または登録商標です。
            </p>
          </div>

        </section>
      </div>
    </div>
  );
}