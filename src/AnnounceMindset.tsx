import React from "react";

type Props = {
  onBack: () => void;
};

export default function AnnounceMindset({ onBack }: Props) {
  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      {/* 本体カード */}
      <div className="w-full">
        <div className="rounded-3xl bg-white/10 border border-white/10 shadow-2xl overflow-hidden">
          {/* ✅ ヘッダー：中央・大きく・目立つ */}
          <div className="px-5 py-6 bg-gradient-to-r from-rose-600/90 to-pink-600/90">
            <div className="flex flex-col items-center text-center gap-2">
                <h1 className="text-2xl font-extrabold tracking-wide">
                野球アナウンスの心得
              </h1>
              <p className="text-sm text-white/90 font-semibold">
                試合をスムーズに進めるための基本
              </p>
            </div>
          </div>

          {/* ✅ 全体の文字サイズUP */}
          <div className="px-5 py-6 space-y-5">
            {/* ① */}
            <section className="rounded-2xl bg-black/20 border border-white/10 p-5">
              <div className="text-base font-extrabold text-amber-200 mb-2">
                ① 大原則
              </div>

              <div className="text-lg font-extrabold leading-relaxed">
                選手がプレーをしているときは{" "}
                <span className="text-rose-300">アナウンスしない！</span>
              </div>

              <ul className="mt-3 text-base text-white/90 space-y-2 list-disc pl-6">
                <li>投手が投球動作に入った時</li>
                <li>ボールが動いている時（インプレー中）</li>
              </ul>
            </section>

            {/* ② */}
            <section className="rounded-2xl bg-black/20 border border-white/10 p-5">
              <div className="text-base font-extrabold text-amber-200 mb-2">
                ② 選手交代
              </div>

              {/* ✅ 強調：大きく太く */}
              <div className="text-lg leading-relaxed text-white">
                選手交代は{" "}
                <span className="font-extrabold text-emerald-200">
                  審判の合図があってから
                </span>
                <span className="font-extrabold"> アナウンスすること！</span>
              </div>

              {/* ✅ 追記：注意書きを目立つボックスに */}
              <div className="mt-4 rounded-xl border border-amber-300/40 bg-amber-200/10 px-4 py-3">
                <div className="text-sm font-extrabold text-amber-200 mb-1">
                  ※ポイント
                </div>
                <p className="text-base text-white/95 leading-relaxed">
                  代打や代走がでる場合、グラウンドの様子でわかれば
                  <span className="font-extrabold text-amber-100">
                    審判にOKサイン
                  </span>
                  を出すとスムーズです。
                </p>
              </div>
            </section>

            {/* ③ */}
            <section className="rounded-2xl bg-black/20 border border-white/10 p-5">
              <div className="text-base font-extrabold text-amber-200 mb-2">
                ③ しゃべり方のコツ
              </div>

              <div className="flex flex-wrap gap-2">
                {["明るく", "元気よく", "はっきり"].map((t) => (
                  <span
                    key={t}
                    className="px-4 py-2 rounded-full bg-white/10 border border-white/10 text-base font-bold"
                  >
                    {t}
                  </span>
                ))}
              </div>

              <div className="mt-3 text-lg text-white/95">
                そして、落ち着いて{" "}
                <span className="font-extrabold text-rose-300">ゆっくり</span>{" "}
                話そう！
              </div>
            </section>

            <div className="rounded-xl border border-red-300/40 bg-red-400/10 px-4 py-3 text-center">
              <span className="text-base font-extrabold text-red-200">
                ※プレーの妨げにならないタイミングを最優先
              </span>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}