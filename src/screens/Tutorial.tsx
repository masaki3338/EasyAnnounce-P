import React, { useMemo, useRef, useState } from "react";

type Props = { onBack: () => void };
type TopicKey = "team" | "game" | "start"  | "defense"  | "offense"| "sub";

const topics = [
  { key: "team" as const, icon: "👥", title: "チーム・選手登録", subtitle: "最初にチームと選手を登録します" },
  { key: "game" as const, icon: "📝", title: "試合情報の入力", subtitle: "大会名・相手・スタメンなどを入力します" },
  { key: "start" as const, icon: "🏁", title: "試合開始（試合前アナウンス）", subtitle: "試合前のアナウンス" },
  { key: "defense" as const, icon: "🛡️", title: "試合中（守備時）", subtitle: "投球数・得点・その他メニュー" },
  { key: "offense" as const, icon: "⚾", title: "試合中（攻撃時）", subtitle: "打者読み上げ・代打/代走・得点" },
  { key: "sub" as const, icon: "🔄", title: "選手交代の手順", subtitle: "選手交代の手順方法" },
] as const;

export default function Tutorial({ onBack }: Props) {
  const [active, setActive] = useState<TopicKey | null>(null);
  const activeTopic = useMemo(
    () => (active ? topics.find((t) => t.key === active) ?? null : null),
    [active]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-900 to-slate-800 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-slate-900/70 backdrop-blur border-b border-white/10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (active ? setActive(null) : onBack())}
            className="px-4 py-2 rounded-lg bg-slate-700/60 border border-white/10 text-sm font-bold"
          >
            ← {active ? "戻る" : "戻る"}
          </button>

          <div className="flex-1 text-center min-w-0">
            <div className="text-base sm:text-lg font-extrabold whitespace-nowrap">
              {active ? activeTopic?.title : "チュートリアル"}
            </div>
            <div className="text-[11px] text-slate-300 whitespace-nowrap">
              {active ? "画像を左右にスワイプできます" : "基本の流れを確認"}
            </div>
          </div>

          <div className="w-[120px]" />
        </div>
      </div>

      {/* Body */}
      <div className="max-w-3xl mx-auto px-4 py-4">
        {!active && (
          <div className="space-y-3">
            {topics.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className="w-full text-left rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl active:scale-[0.99]"
              >
                <div className="flex gap-3 items-start">
                  <div className="text-2xl">{t.icon}</div>
                  <div className="flex-1">
                    <div className="text-base font-extrabold">{t.title}</div>
                    <div className="mt-1 text-sm text-slate-200">{t.subtitle}</div>
                    <div className="mt-2 text-emerald-300 text-sm font-bold">▶ 開く</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
            {/* ★ ここが画像チュートリアル */}
            {active === "team" && <TeamTutorial />}

            {active === "game" && <GameTutorial />}
            
            {active === "start" && <GameStartTutorial />}

            {active === "defense" && <DefenseTutorial />}

            {active === "offense" && <OffenseTutorial />}

            {active === "sub" && <SubstitutionTutorial />}
                </div>
                </div>
            );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
      <div className="text-base font-extrabold">{title}</div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex gap-2 items-start">
      <div className="w-6 h-6 rounded-full bg-emerald-500 text-slate-900 text-xs font-extrabold flex items-center justify-center flex-none">
        {n}
      </div>
      <div className="text-sm text-slate-100 leading-relaxed">{text}</div>
    </div>
  );
}

/** ====== チーム・選手登録チュートリアル ========*/
function TeamTutorial() {
  const slides = [
    { src: "/tutorial/team_1.jpg", label: "" },
    { src: "/tutorial/team_2.jpg", label: "" },
    { src: "/tutorial/team_3.jpg", label: "" },
    { src: "/tutorial/team_4.jpg", label: "" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">👥 チーム・選手登録</div>
        <div className="mt-1 text-sm text-slate-200">
          ふりがなは「ルビ表示」と「読み上げ」に使われます
        </div>
      </div>

      <ImageSlider slides={slides} />
    </div>
  );
}

/** ====== 試合作成：画像チュートリアル本体 ====== */
function GameTutorial() {
  const slides = [
    { src: "/tutorial/game_1.jpg", label: "" },
    { src: "/tutorial/game_2.jpg", label: "" },
    { src: "/tutorial/game_3.jpg", label: "" },
    { src: "/tutorial/game_4.jpg", label: "" },
    { src: "/tutorial/game_5.jpg", label: "" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">📝 試合情報の入力</div>
        <div className="mt-1 text-sm text-slate-200">
          試合情報 → スタメン設定まで入力します
        </div>
      </div>

      <ImageSlider slides={slides} />
    </div>
  );
}

/** ====== 試合開始：画像チュートリアル本体 ====== */
function GameStartTutorial() {
  const slides = [
    { src: "/tutorial/start_1.jpg", label: "" },
    { src: "/tutorial/start_2.jpg", label: "" },
    { src: "/tutorial/start_3.jpg", label: "" },
    { src: "/tutorial/start_4.jpg", label: "" },
    { src: "/tutorial/start_5.jpg", label: "" },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">🏁 試合開始（試合前アナウンス）</div>
        <div className="mt-1 text-sm text-slate-200">
          試合前に読む内容が「実施順」で並びます。項目を押すと読み上げ文が表示されます。
        </div>
      </div>

      <ImageSlider slides={slides} />
    </div>
  );
}

/** ====== 試合中（守備）：画像チュートリアル本体 ====== */
function DefenseTutorial() {
  const slides = [
    {
      src: "/tutorial/defense_1.jpg",
      label: "",
    },
    {
      src: "/tutorial/defense_2.jpg",
      label: "",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">🛡️ 試合中（守備時）</div>
        <div className="mt-1 text-sm text-slate-200">
          守備中は「投球数」「得点」の入力が主な操作です
        </div>
      </div>

      <ImageSlider slides={slides} />
    </div>
  );
}

/** ====== 試合中（攻撃）：画像チュートリアル本体 ====== */
function OffenseTutorial() {
  const slides = [
    {
      src: "/tutorial/offense_1.jpg",
      label: "",
    },
    {
      src: "/tutorial/offense_2.jpg",
      label: "",
    },
    {
      src: "/tutorial/offense_3.jpg",
      label: "",
    },
    {
      src: "/tutorial/offense_4.jpg",
      label: "",
    },
    {
      src: "/tutorial/offense_5.jpg",
      label: "",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">⚾ 試合中（攻撃時）</div>
        <div className="mt-1 text-sm text-slate-200">
          主に「打者の読み上げ」「代打/代走」「得点入力」を行います
        </div>
      </div>

      <ImageSlider slides={slides} />
    </div>
  );
}

/** ====== 選手交代：画像チュートリアル本体 ====== */
function SubstitutionTutorial() {
  const [tab, setTab] = useState<"number" | "drag">("number");

  // public/tutorial/ に置いた前提
  const numberSlides = [
    { src: "/tutorial/sub_0.jpg", label: "" },
    { src: "/tutorial/sub_1.jpg", label: "" },
    { src: "/tutorial/sub_2.jpg", label: "" },
    { src: "/tutorial/sub_3.jpg", label: "" },
    { src: "/tutorial/sub_4.jpg", label: "" },
    { src: "/tutorial/sub_5.jpg", label: "" },
  ];

  const dragSlides = [
    { src: "/tutorial/sub_drag.jpg", label: "フィールド図の選手をドラッグ＆ドロップ" },
  ];

  const slides = tab === "number" ? numberSlides : dragSlides;

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 p-4 shadow-xl">
        <div className="text-base font-extrabold">🔄 選手交代の手順</div>
        <div className="mt-1 text-sm text-slate-200">
          「守備番号で入力」か「フィールド図で移動」の2通りです
        </div>

        {/* Tabs */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTab("number")}
            className={`rounded-xl px-3 py-2 text-sm font-bold border ${
              tab === "number"
                ? "bg-emerald-500 text-slate-900 border-emerald-400"
                : "bg-slate-800/40 text-slate-100 border-white/10"
            }`}
          >
            守備番号で入力
          </button>
          <button
            type="button"
            onClick={() => setTab("drag")}
            className={`rounded-xl px-3 py-2 text-sm font-bold border ${
              tab === "drag"
                ? "bg-emerald-500 text-slate-900 border-emerald-400"
                : "bg-slate-800/40 text-slate-100 border-white/10"
            }`}
          >
            フィールド図で移動
          </button>
        </div>
      </div>

      {/* Slider */}
      <ImageSlider slides={slides} />
    </div>
  );
}

function ImageSlider({
  slides,
}: {
  slides: { src: string; label: string }[];
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(0);

  const onScroll = () => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const i = Math.round(el.scrollLeft / w);
    setIndex(Math.max(0, Math.min(slides.length - 1, i)));
  };

  const jump = (i: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const w = el.clientWidth;
    el.scrollTo({ left: w * i, behavior: "smooth" });
  };

  return (
    <div className="rounded-2xl bg-slate-700/40 backdrop-blur border border-white/10 shadow-xl overflow-hidden">
      <div className="px-4 pt-4 pb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-extrabold text-slate-100">
          {slides[index]?.label ?? ""}
        </div>
        <div className="text-xs text-slate-300">
          {index + 1} / {slides.length}
        </div>
      </div>

      <div
        ref={scrollerRef}
        onScroll={onScroll}
        className="w-full overflow-x-auto snap-x snap-mandatory flex scroll-smooth"
        style={{ WebkitOverflowScrolling: "touch" as any }}
      >
        {slides.map((s, i) => (
          <div key={i} className="w-full flex-none snap-center px-4 pb-4">
            <div className="rounded-xl overflow-hidden border border-white/10 bg-slate-900/30">
              <img
                src={s.src}
                alt={s.label}
                className="w-full h-auto block"
                loading="lazy"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Dots */}
      <div className="px-4 pb-4 flex items-center justify-center gap-2">
        {slides.map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => jump(i)}
            className={`h-2.5 w-2.5 rounded-full border ${
              i === index
                ? "bg-emerald-400 border-emerald-200"
                : "bg-white/10 border-white/20"
            }`}
            aria-label={`slide-${i + 1}`}
          />
        ))}
      </div>
    </div>
  );
}