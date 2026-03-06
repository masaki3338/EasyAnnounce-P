// AnnounceStartingLineup.tsx（全文置き換え）
import React, { useState, useEffect, useRef } from "react";
import localForage from "localforage";
import { ScreenType } from "./App";
import { speak as ttsSpeak, stop as ttsStop, prewarmTTS } from "./lib/tts";


/* === ミニSVGアイコン（依存なし） === */
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
  </svg>
);
const IconMegaphone = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

const IconInfo: React.FC = () => (
  <img
    src="/warning-icon.png"        // ← public/warning-icon.png
    alt="注意"
    className="w-6 h-6 object-contain select-none pointer-events-none"
    aria-hidden
    draggable={false}
    width={24}
    height={24}
  />
);

/* === 既存の型 & 補助 === */
const positionMapJP: Record<string, string> = {
  "投": "ピッチャー",
  "捕": "キャッチャー",
  "一": "ファースト",
  "二": "セカンド",
  "三": "サード",
  "遊": "ショート",
  "左": "レフト",
  "中": "センター",
  "右": "ライト",
  "指": "指名打者",
  "-": "ー",
};
type Player = {
  id: number;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  number: string;
  isFemale?: boolean;
};
type Umpire = { role: string; name: string; furigana: string };

/* === 情報カード（注意/補足用） === */
const InfoCard: React.FC<{ icon: React.ReactNode; title: string; text: string }> = ({ icon, title, text }) => (
  <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
    <div className="flex items-center gap-3 mb-2">
      <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center text-white">{icon}</div>
      <h2 className="font-semibold">{title}</h2>
    </div>
    <p className="text-amber-50/90 text-sm leading-relaxed">{text}</p>
  </section>
);

const AnnounceStartingLineup: React.FC<{ onNavigate: (screen: ScreenType) => void }> = ({ onNavigate }) => {
  const [teamPlayers, setTeamPlayers] = useState<Player[]>([]);
  const [assignments, setAssignments] = useState<{ [pos: string]: number | null }>({});
  const [battingOrder, setBattingOrder] = useState<{ id: number; reason: string }[]>([]);
  const [homeTeamName, setHomeTeamName] = useState<string>("");
  const [homeTeamFurigana, setHomeTeamFurigana] = useState<string>("");
  const [awayTeamName, setAwayTeamName] = useState<string>("");
  const [opponentTeamFurigana, setOpponentTeamFurigana] = useState<string>("");
  const [isHomeTeamFirstAttack, setIsHomeTeamFirstAttack] = useState<boolean>(true);
  const [benchSide, setBenchSide] = useState<"1塁側" | "3塁側">("1塁側");
  const [umpires, setUmpires] = useState<Umpire[]>([]);
  const [isTwoUmpires, setIsTwoUmpires] = useState<boolean>(false);
  const [speaking, setSpeaking] = useState(false);

  const announceBoxRef = useRef<HTMLDivElement | null>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const isSpeakingRef = useRef(false);

  const startingIds = battingOrder.map((e) => e.id);
  const [benchOutIds, setBenchOutIds] = useState<number[]>([]);
  const [ohtaniRule, setOhtaniRule] = useState(false);


　// ✅ DHあり判定：指名打者が割り当てられているか
  const dhActive = assignments["指"] != null;
  // ✅ 投手ID（守備の投手）
  const pitcherId = assignments["投"];
  // ✅ DHありで、投手が打順に入っていない場合だけ「投手を追加アナウンス」
  const shouldAnnouncePitcher =
    dhActive &&
    typeof pitcherId === "number" &&
    (!startingIds.includes(pitcherId) || ohtaniRule); // ★大谷ルール時は常に表示




  useEffect(() => {
    const onHide = () => handleStop();
    window.addEventListener("visibilitychange", onHide);
    return () => { window.removeEventListener("visibilitychange", onHide); handleStop(); };
  }, []);
  useEffect(() => {
    return () => { handleStop(); };
  }, []);

  // 初回だけ VOICEVOX を温める
  useEffect(() => { void prewarmTTS(); }, []);

  /* === データロード === */
  useEffect(() => {
    const loadA = async () => {
      // ✅ まずスタメン設定のキーを読む。なければ従来キーにフォールバック
      const sb = await localForage.getItem<number[]>("startingBenchOutIds");
      const fb = await localForage.getItem<number[]>("benchOutIds");
      const raw = Array.isArray(sb) ? sb : Array.isArray(fb) ? fb : [];
      // 念のため number 正規化
      const normalized = raw.map((v) => Number(v)).filter((v) => Number.isFinite(v));
      setBenchOutIds(normalized);
    };
    loadA();
  }, []);
  
  useEffect(() => {
    const loadB = async () => {
      const [team, matchInfo, ohtani] = await Promise.all([
        localForage.getItem<{ name: string; players: Player[] }>("team"),
        localForage.getItem("matchInfo"),
        localForage.getItem<boolean>("ohtaniRule"),
        
      ]);

      setOhtaniRule(!!ohtani);


      const assignRaw =
        (await localForage.getItem<Record<string, number | null>>("startingassignments")) ??
        (await localForage.getItem<Record<string, number | null>>("lineupAssignments")) ?? {};
      const orderRaw =
        (await localForage.getItem<Array<{ id?: number; playerId?: number; reason?: string }>>("startingBattingOrder")) ??
        (await localForage.getItem<Array<{ id?: number; playerId?: number; reason?: string }>>("battingOrder")) ?? [];

      const normalizedAssign: { [pos: string]: number | null } = {};
      Object.entries(assignRaw).forEach(([pos, id]) => { normalizedAssign[pos] = id == null ? null : Number(id); });
      setAssignments(normalizedAssign);

      const normalizedOrder = (orderRaw as any[])
        .map((e) => {
          const id = typeof e?.id === "number" ? e.id : e?.playerId;
          if (typeof id !== "number") return null;
          return { id: Number(id), reason: e?.reason ?? "スタメン" };
        })
        .filter(Boolean)
        .slice(0, 9) as { id: number; reason: string }[];
      setBattingOrder(normalizedOrder);

      if (team) {
        setTeamPlayers((team as any).players || []);
        setHomeTeamName((team as any).name || "");
        setHomeTeamFurigana((team as any).furigana ?? (team as any).nameKana ?? "");
      }
      if (matchInfo && typeof matchInfo === "object") {
        const mi = matchInfo as any;
        setAwayTeamName(mi.opponentTeam || "");
        setIsHomeTeamFirstAttack(!mi.isHome);
        if (Array.isArray(mi.umpires)) setUmpires(mi.umpires);
        setOpponentTeamFurigana(mi.opponentTeamFurigana || "");
        setIsTwoUmpires(Boolean(mi.twoUmpires));
        setBenchSide(mi.benchSide || "1塁側");
      }
    };
    
    loadB();
    
  }, []);

  /* === 表示ヘルパ === */
  const getPositionName = (pos: string) => positionMapJP[pos] || pos;
  const getHonorific = (p: Player) => (p.isFemale ? "さん" : "くん");
  const renderFurigana = (kanji: string, kana: string) => (
    <ruby className="ruby-text">
      {kanji}
      <rt className="ruby-reading">{kana}</rt>
    </ruby>
  );
  const renderFullName = (p: Player) => (<>{renderFurigana(p.lastName, p.lastNameKana)}{renderFurigana(p.firstName, p.firstNameKana)}</>);
  const renderLastName = (p: Player) => renderFurigana(p.lastName, p.lastNameKana);

  const team1stBaseName = benchSide === "1塁側" ? homeTeamName : awayTeamName;
  const team3rdBaseName = benchSide === "3塁側" ? homeTeamName : awayTeamName;

  const team1stBaseFurigana = benchSide === "1塁側" ? homeTeamFurigana : opponentTeamFurigana;
  const team3rdBaseFurigana = benchSide === "3塁側" ? homeTeamFurigana : opponentTeamFurigana;

  const renderTeam1stBase = () =>
    team1stBaseFurigana
      ? renderFurigana(team1stBaseName, team1stBaseFurigana)
      : team1stBaseName;

  const renderTeam3rdBase = () =>
    team3rdBaseFurigana
      ? renderFurigana(team3rdBaseName, team3rdBaseFurigana)
      : team3rdBaseName;


  /* === 画面に見えている文言をそのまま読む（rubyはrtを採用） === */
  const getVisibleAnnounceText = (): string => {
    const root = announceBoxRef.current;
    if (!root) return "";
    const clone = root.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("ruby").forEach((rb) => {
      const rt = rb.querySelector("rt");
      const kana = (rt?.textContent ?? "").trim();
      const fallback = (rb.textContent ?? "").trim();
      const textNode = document.createTextNode(kana || fallback);
      rb.replaceWith(textNode);
    });
    const lines: string[] = [];
    clone.querySelectorAll("p").forEach((p) => {
      const t = (p.textContent ?? "").replace(/\s+/g, " ").trim();
      if (t) lines.push(t);
    });
    return lines.join("\n");
  };

  /* === 読み上げ操作 === */
  const handleSpeak = () => {
    if (isSpeakingRef.current) return;
    isSpeakingRef.current = true;
    handleStop(); // 念のため直前に全停止
    let text = getVisibleAnnounceText();
    if (!text) { isSpeakingRef.current = false; return; }
    setSpeaking(true);
    // ❗️待たずに発火：体感が大幅に軽くなる。最初の1文を先に再生（progressive）
    void ttsSpeak(text) // progressive/cacheを使わない
      .finally(() => { setSpeaking(false); isSpeakingRef.current = false; });
  };

  const handleStop = () => {
   ttsStop();                 // ← sessionCounter が進むので連鎖が止まる
   isSpeakingRef.current = false;
   setSpeaking(false);
   utteranceRef.current = null;
 };

  return (
      <div
        className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
        style={{
          paddingTop: "max(16px, env(safe-area-inset-top))",
          paddingBottom: "max(16px, env(safe-area-inset-bottom))",
          WebkitTouchCallout: "none", // iOS Safari 長押しメニュー禁止
          WebkitUserSelect: "none",   // テキスト選択禁止
          userSelect: "none",         // 全体で禁止
        }}
      >

      {/* ヘッダー */}
      <header className="w-full max-w-md md:max-w-none">
        <div className="flex items-center justify-between">

          <div className="w-10" />
        </div>

        {/* 中央大タイトル */}
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">📣</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              スタメン発表
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>{isHomeTeamFirstAttack ? "先攻チーム🎤" : "後攻チーム🎤"}</span>
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="w-full max-w-md md:max-w-none mt-6 space-y-5">
        {/* 注意/タイミングカード */}
        {isHomeTeamFirstAttack ? (
          <InfoCard
            icon={<IconInfo />}
            title="読み上げタイミング"
            text="シートノック後、グラウンド整備中に読み上げ"
          />
        ) : (
          <InfoCard
            icon={<IconInfo />}
            title="読み上げタイミング"
            text="先攻チームのアナウンスが終わったタイミング"
          />
        )}

        {/* 🔴 アナウンス文言（赤 強め） */}
        <section
          ref={announceBoxRef}
          className="
            rounded-2xl p-4 shadow-lg text-left font-semibold
            border border-rose-600/90
            bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
            ring-1 ring-inset ring-rose-600/50
          "
        >
 

          {/* ヘッダー文 */}
          {isHomeTeamFirstAttack && (
            <p className="text-white whitespace-pre-wrap leading-relaxed">
              お待たせいたしました、
              {renderTeam1stBase()} {"対 "} {renderTeam3rdBase()}
              のスターティングラインナップ並びに審判員をお知らせいたします。
            </p>
          )}

          {/* 先攻/後攻 の見出し */}
          <p className="mt-2 text-white">
            {isHomeTeamFirstAttack ? (
              <>先攻 {homeTeamFurigana ? renderFurigana(homeTeamName, homeTeamFurigana) : homeTeamName}</>
            ) : (
              <>続きまして後攻 {homeTeamFurigana ? renderFurigana(homeTeamName, homeTeamFurigana) : homeTeamName}</>
            )}
          </p>

          {/* 打順 1〜9 */}
          <div className="mt-1 space-y-1">
            {battingOrder.map((entry, idx) => {
              const p = teamPlayers.find((pl) => pl.id === entry.id);
              if (!p) return null;

              const pos =
                Object.entries(assignments).find(([_, pid]) => pid === p.id)?.[0] || "-";

              // ★追加：表示用ポジション（大谷ルール時は投手を“指”表示にする）
              const displayPos =
                ohtaniRule && assignments["投"] === p.id ? "指" : pos;

              const posName = getPositionName(displayPos);
              const honorific = getHonorific(p);

              const num = (p.number ?? "").trim(); // ★追加：背番号（空白なら空）

              return (
                <p key={entry.id} className="text-white whitespace-pre-wrap leading-relaxed">
                  {idx + 1}番 {posName} {renderFullName(p)}{honorific}、<br />
                  {posName} {renderLastName(p)}{honorific}
                  {num ? ` 背番号${num}。` : "。"}
                </p>
              );
            })}
          </div>
          
          {/* ✅ DHありの場合：9番の後に投手を追加 */}
          {shouldAnnouncePitcher && (() => {
            const p = teamPlayers.find((pl) => pl.id === pitcherId);
            if (!p) return null;

            const honorific = getHonorific(p);
            const num = (p.number ?? "").trim();

            return (
              <p className="text-white whitespace-pre-wrap leading-relaxed">
                ピッチャーは {renderFullName(p)}{honorific}、<br />
                ピッチャー {renderLastName(p)}{honorific}
                {num ? ` 背番号${num}。` : "。"}
              </p>
            );
          })()}

          {/* 控え */}
          <p className="mt-3 text-white">ベンチ入りの選手をお知らせいたします。</p>
          <div className="mt-1 space-y-1">            
            {teamPlayers
              .filter((p) =>
                !startingIds.includes(p.id) &&
                !benchOutIds.includes(p.id) &&
                !(shouldAnnouncePitcher && p.id === pitcherId) // ✅ DH時の投手をベンチから外す
              )
              .map((p) => {
                const num = (p.number ?? "").trim(); // ★背番号空欄対応
                return (
                  <p key={p.id} className="text-white whitespace-pre-wrap leading-relaxed">
                    {renderFullName(p)}{getHonorific(p)}
                    {num ? `、背番号${num}、` : "、"}
                  </p>
                );
              })}
          </div>


          {/* 審判（後攻時に続けて告知） */}
          {!isHomeTeamFirstAttack && (
            isTwoUmpires ? (
              // ✅ 2審制
              <p className="mt-4 text-white whitespace-pre-wrap leading-relaxed">
                なお、この試合の審判は 球審（{umpires[0] ? renderFurigana(umpires[0].name, umpires[0].furigana) : ""}）、
                塁審は1塁（{umpires[1] ? renderFurigana(umpires[1].name, umpires[1].furigana) : ""}）、以上2氏でございます。
                試合開始まで今しばらくお待ちください。
              </p>
            ) : (
              // ✅ 4審制（従来どおり）
              <p className="mt-4 text-white whitespace-pre-wrap leading-relaxed">
                なお、この試合の審判は 球審（{umpires[0] ? renderFurigana(umpires[0].name, umpires[0].furigana) : ""}）、
                塁審は1塁（{umpires[1] ? renderFurigana(umpires[1].name, umpires[1].furigana) : ""}）、
                2塁（{umpires[2] ? renderFurigana(umpires[2].name, umpires[2].furigana) : ""}）、
                3塁（{umpires[3] ? renderFurigana(umpires[3].name, umpires[3].furigana) : ""}）以上4氏でございます。
                試合開始まで今しばらくお待ちください。
              </p>
            )
          )}
          
          {/* 操作ボタン */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <button
              onClick={handleSpeak}
              disabled={isSpeakingRef.current || speaking}
              className="w-full px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 text-white text-base font-semibold shadow-md disabled:opacity-60"
            >
              <span className="inline-flex items-center gap-2"><IconMegaphone /> 読み上げ</span>
            </button>
            <button
              onPointerDown={handleStop}             // ★押した瞬間に停止
              onClick={handleStop}                   // （保険で残してOK／二重でも問題なし）
              className="w-full px-4 py-2 rounded-xl bg-gray-600 hover:bg-gray-700 active:scale-95 text-white text-base font-semibold shadow-md"
            >
              停止
            </button>

          </div>

        </section>



        {/* 戻るボタン（操作ボタンの下に横幅いっぱいで配置） */}
        <div className="pt-2">
          <button
            onClick={() => onNavigate("announcement")}
            className="w-full px-6 py-4 rounded-2xl bg-white/90 hover:bg-white text-gray-900 text-lg font-semibold shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>


      </main>
    </div>
  );
};

export default AnnounceStartingLineup;
