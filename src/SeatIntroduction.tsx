// SeatIntroduction.tsx（全文置き換え）
import React, { useEffect, useState, useRef } from "react";
import localForage from "localforage";
import { ScreenType } from "./pre-game-announcement";
import { speak as ttsSpeak, stop as ttsStop, preserveNameReading, prefetchTTS } from "./lib/tts";
import { getLeagueMode } from "./lib/leagueSettings";

interface Props {
  onNavigate: (screen: ScreenType) => void;
  onBack?: () => void;
}

type PositionInfo = {
  lastName: string;
  lastNameKana: string;
  firstName: string;       // ★追加
  firstNameKana: string;   // ★追加
  honorific: string;
};


/* ==== ミニSVGアイコン（依存なし） ==== */
const IconBack = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5" fill="currentColor" aria-hidden>
    <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
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
const IconMic = () => (
  <svg viewBox="0 0 24 24" className="w-6 h-6" fill="currentColor" aria-hidden>
    <path d="M12 14a3 3 0 003-3V6a3 3 0 10-6 0v5a3 3 0 003 3zm-7-3h2a5 5 0 0010 0h2a7 7 0 01-6 6.9V20h3v2H8v-2h3v-2.1A7 7 0 015 11z"/>
  </svg>
);

// 追加：戻り先をストレージから都度解決
// 追加：戻り先をストレージから都度解決
const resolveBackTarget = async (): Promise<ScreenType> => {
  const [last, matchInfo] = await Promise.all([
    localForage.getItem<string>("lastScreen"),
    localForage.getItem<any>("matchInfo"),
  ]);

  const s = (last || "").toLowerCase();

  // ✅ 1人アナウンスモードは "announce" を含むため、
  // 試合前アナウンス判定より先に処理する
  const isFromOnePerson =
    s === "onepersonannounce" ||
    s.includes("oneperson");

  if (isFromOnePerson) {
    return "onePersonAnnounce" as ScreenType;
  }

  const isFromPreAnnounce =
    s.includes("announce") ||
    s.includes("warmup") ||
    s.includes("greet") ||
    s.includes("knock") ||
    s.includes("gather") ||
    s.includes("seat");

  const isFromOffense =
    s.includes("offen") ||
    s.includes("attack") ||
    s.includes("bat");

  if (isFromPreAnnounce) return "announcement" as ScreenType;
  if (isFromOffense) return "defense" as ScreenType;
  if (matchInfo && matchInfo.isDefense === false) return "defense" as ScreenType;

  return "startGame" as ScreenType;
};

const SeatIntroduction: React.FC<Props> = ({ onNavigate, onBack }) => {
  const [teamName, setTeamName] = useState("");       // 表示用
  const [teamReading, setTeamReading] = useState(""); // 読み上げ用
  const [positions, setPositions] = useState<{ [key: string]: PositionInfo }>({});
  const [isHome, setIsHome] = useState(true); // true → 後攻
  const [speaking, setSpeaking] = useState(false);
  const seatSpeakSessionRef = useRef(0);
  const [backTarget, setBackTarget] = useState<ScreenType>("announcement" as ScreenType);
  const [leagueMode, setLeagueMode] = useState<"pony" | "boys">(getLeagueMode());
  const [umpires, setUmpires] = useState<{ role: string; name: string; furigana: string }[]>([]);
  // ★ 同姓（苗字）重複セット
  const [dupLastNames, setDupLastNames] = useState<Set<string>>(new Set());
  useEffect(() => {
    (async () => {
      const list = (await localForage.getItem<string[]>("duplicateLastNames")) ?? [];
      setDupLastNames(new Set(list.map(s => String(s))));
    })();
  }, []);



  const positionLabels: [string, string][] = [
    ["投", "ピッチャー"],
    ["捕", "キャッチャー"],
    ["一", "ファースト"],
    ["二", "セカンド"],
    ["三", "サード"],
    ["遊", "ショート"],
    ["左", "レフト"],
    ["中", "センター"],
    ["右", "ライト"],
  ];

  // 試合前アナウンスから開いたシート紹介は、先攻・後攻に関係なく
  // 最初に紹介する守備チームとして「1回の表」と表示する。
  // 試合中に開いた場合は従来どおり isHome で判定する。
  const inning =
    backTarget === ("announcement" as ScreenType)
      ? "1回の表"
      : isHome
      ? "1回の表"
      : "1回の裏";

  // 読み上げ用：「表」を「ひょう」と誤読しないよう明示
  const inningReading =
    inning === "1回の裏" ? "いっかいのうら" : "いっかいのおもて";

  // 読み上げボタンで最初に再生する文章。
  // 先読み時と実再生時で完全に同じ文字列を使い、キャッシュを確実に一致させる。
  const seatIntroFirstText =
    leagueMode === "boys"
      ? inning === "1回の裏"
        ? `${inningReading}、守ります、${teamReading}の`
        : `${inningReading}、まず守ります、${teamReading}の`
      : `${inningReading}、守ります、${teamReading}のシートをお知らせします。`;

  useEffect(() => {
    const loadData = async () => {
 const team = await localForage.getItem<any>("team");
 // ✅ まずスタメン専用キーを読む。無ければ従来キーにフォールバック
const latest = await localForage.getItem<Record<string, number | null>>("lineupAssignments");
const starting = await localForage.getItem<Record<string, number | null>>("startingassignments");
const assignments: Record<string, number | null> = latest ?? starting ?? {};
 const matchInfo = await localForage.getItem<any>("matchInfo");
      const last = (await localForage.getItem<string>("lastScreen")) || "";

      console.log("SeatIntro lastScreen=", last, " isDefense=", matchInfo?.isDefense);

      if (team) {
        setTeamName(team.name || "");
        setTeamReading(team.furigana || team.kana || team.reading || team.name || "");
      }
      if (matchInfo) {
        setLeagueMode(getLeagueMode());
        setUmpires(Array.isArray(matchInfo.umpires) ? matchInfo.umpires : []);
        setIsHome(
          typeof matchInfo.seatIntroIsHome === "boolean"
            ? matchInfo.seatIntroIsHome
            : matchInfo.isHome ?? true
        );
      }

      // 戻り先の判定（大小無視の部分一致＋保険）
      const s = (last || "").toLowerCase();
      const isFromPreAnnounce =
        s.includes("announce") || s.includes("warmup") || s.includes("greet") ||        s.includes("knock") || s.includes("gather") || s.includes("seat");
      const isFromOffense =
        s.includes("offen") || s.includes("attack") || s.includes("bat");

      setBackTarget(await resolveBackTarget());
      const tgt = await resolveBackTarget();
      setBackTarget(tgt);
      console.log("SeatIntro backTarget(init)=", tgt, " lastScreen=", last, " isDefense=", matchInfo?.isDefense);

 if (team?.players) {
   const FIELD_POS = ["投","捕","一","二","三","遊","左","中","右"]; // ← フィールドだけ
   const posMap: { [key: string]: PositionInfo } = {};
   for (const pos of FIELD_POS) {
     const playerId = assignments[pos];
     if (typeof playerId !== "number") continue;
     const player = team.players.find((p: any) => p.id === playerId);
     if (!player) continue;
      posMap[pos] = {
        lastName: player.lastName,
        lastNameKana: player.lastNameKana,
        firstName: player.firstName,         // ★追加
        firstNameKana: player.firstNameKana, // ★追加
        honorific: player.isFemale ? "さん" : "くん",
      };

   }
   setPositions(posMap);
 }
    };
    loadData();
    return () => { ttsStop(); setSpeaking(false); };
  }, []);

  useEffect(() => {
    if (!teamReading) return;

    const options = { progressive: true, cache: true } as const;

    const pitcher = positions["投"];
    const fixedKana = (value?: string) =>
      preserveNameReading(String(value ?? ""));
    const pitcherName = leagueMode === "boys"
      ? `${fixedKana(pitcher?.lastNameKana || pitcher?.lastName)} ${fixedKana(
          pitcher?.firstNameKana || pitcher?.firstName
        )}`.trim()
      : pitcher && pitcher.lastName && dupLastNames.has(pitcher.lastName)
      ? `${fixedKana(pitcher.lastNameKana || pitcher.lastName)} ${fixedKana(
          pitcher.firstNameKana || pitcher.firstName
        )}`.trim()
      : fixedKana(pitcher?.lastNameKana || pitcher?.lastName);
    const pitcherLine = leagueMode === "boys"
      ? `ぴっちゃーは、${pitcherName}${pitcher?.honorific || "くん"}`
      : `ピッチャー、${pitcherName}${pitcher?.honorific || "くん"}`;

    // 開始文＋9人分を画面表示時から順番に先読みする。
    // 従来は「開始文＋ピッチャー」だけだったため、
    // ピッチャーの後でキャッチャー以降の生成待ちが発生することがあった。
    const seatPrefetchLines =
      leagueMode === "boys"
        ? [
            pitcherLine,
            `キャッチャー、${(() => {
              const p = positions["捕"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `ファースト、${(() => {
              const p = positions["一"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `セカンド、${(() => {
              const p = positions["二"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `サード、${(() => {
              const p = positions["三"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `ショート、${(() => {
              const p = positions["遊"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `レフト、${(() => {
              const p = positions["左"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `センター、${(() => {
              const p = positions["中"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
            `ライト、${(() => {
              const p = positions["右"];
              return `${fixedKana(p?.lastNameKana || p?.lastName)} ${fixedKana(
                p?.firstNameKana || p?.firstName
              )}`.trim() + (p?.honorific || "くん");
            })()}`,
          ]
        : positionLabels.map(([pos, label]) => {
            const p = positions[pos];
            if (!p) return "";
            const ln = p.lastName || "";
            const forceFull = ln && dupLastNames.has(ln);
            const yomi = forceFull
              ? `${fixedKana(p.lastNameKana || p.lastName)} ${fixedKana(
                  p.firstNameKana || p.firstName
                )}`.trim()
              : fixedKana(p.lastNameKana || p.lastName);
            const isLastPlayer = pos === "右";
            return `${label}、${yomi}${p.honorific || "くん"}${isLastPlayer ? "です。" : ""}`;
          });

    void (async () => {
      for (const part of [seatIntroFirstText, ...seatPrefetchLines]) {
        if (!part) continue;
        await prefetchTTS(part, options);
      }
    })().catch((error) => {
      console.warn("[TTS PREFETCH][SeatIntroduction] failed", error);
    });
  }, [teamReading, seatIntroFirstText, positions, dupLastNames, leagueMode]);

  // Matchaの起動時prewarmはtts.ts側で共通実行する。
  // この画面で重ねてprewarmすると、読み上げボタン直後の実再生と
  // 1スレッドWorkerを取り合うことがあるため、ここでは実行しない。

  // 審判の役割名は保存元によって
  // 「一塁」「1塁」「一塁審」「塁審（一塁）」など表記が異なるため正規化して検索する
  const normalizeUmpireRole = (value: any) =>
    String(value ?? "")
      .trim()
      .replace(/[　\s]/g, "")
      .replace(/[（）()［］\[\]【】]/g, "")
      .replace(/１/g, "1")
      .replace(/２/g, "2")
      .replace(/３/g, "3")
      .replace(/一塁/g, "1塁")
      .replace(/二塁/g, "2塁")
      .replace(/三塁/g, "3塁");

  const findUmpireByRole = (target: "球審" | "一塁" | "二塁" | "三塁") => {
    const normalizedTarget =
      target === "一塁" ? "1塁" :
      target === "二塁" ? "2塁" :
      target === "三塁" ? "3塁" :
      "球審";

    return umpires.find((u: any) => {
      const roleText = normalizeUmpireRole(
        u?.role ??
        u?.position ??
        u?.umpireRole ??
        u?.type ??
        u?.label ??
        ""
      );

      if (normalizedTarget === "球審") {
        return roleText.includes("球審") || roleText.includes("主審");
      }

      return roleText.includes(normalizedTarget);
    });
  };

  const speakText = () => {
    const speakOpening = async () => {
      const options = { progressive: true, cache: true } as const;
      await ttsSpeak(seatIntroFirstText, options);
    };

    const honor = (p?: PositionInfo) => p?.honorific || "くん";
    const fixedKana = (value?: string) =>
      preserveNameReading(String(value ?? ""));

    const fullKana = (p?: PositionInfo) =>
      `${fixedKana(p?.lastNameKana || p?.lastName || "")} ${fixedKana(
        p?.firstNameKana || p?.firstName || ""
      )}`.trim();

    const ponyKana = (p?: PositionInfo) => {
      if (!p) return "";
      const ln = p.lastName || "";
      const forceFull = ln && dupLastNames.has(ln);

      return forceFull
        ? `${fixedKana(p.lastNameKana || p.lastName)} ${fixedKana(
            p.firstNameKana || p.firstName
          )}`.trim()
        : fixedKana(p.lastNameKana || p.lastName);
    };

    const umpireYomi = (role: "球審" | "一塁" | "二塁" | "三塁") => {
      const u: any = findUmpireByRole(role);
      const registeredName = String(
        u?.name || u?.umpireName || u?.displayName || ""
      ).trim();

      if (!registeredName || registeredName === "未設定") return "";

      return String(
        u?.furigana ||
        u?.nameKana ||
        u?.kana ||
        u?.reading ||
        registeredName
      ).trim();
    };

    // iPhone / iPad は、9人分を1本の長いWAVへ結合すると
    // Safariで再生エラーになる場合があるため、短い音声を連続再生する。
    const isIOSSeatIntro =
      typeof navigator !== "undefined" &&
      (/iP(hone|ad|od)/.test(navigator.userAgent || "") ||
        (/Macintosh/.test(navigator.userAgent || "") &&
          Number((navigator as any).maxTouchPoints || 0) > 1));

    const mySession = ++seatSpeakSessionRef.current;
    setSpeaking(true);

    void (async () => {
      try {
        if (leagueMode === "boys") {
          await speakOpening();
          if (mySession !== seatSpeakSessionRef.current) return;

          const playerLines = [
            // 表示は「ピッチャーは」のまま。読み上げ用だけひらがなにして
            // 「ピッチャー」の固定文一致を確実に回避する。
            `ぴっちゃーは、${fullKana(positions["投"])}${honor(positions["投"])}`,
            `キャッチャー、${fullKana(positions["捕"])}${honor(positions["捕"])}`,
            `ファースト、${fullKana(positions["一"])}${honor(positions["一"])}`,
            `セカンド、${fullKana(positions["二"])}${honor(positions["二"])}`,
            `サード、${fullKana(positions["三"])}${honor(positions["三"])}`,
            `ショート、${fullKana(positions["遊"])}${honor(positions["遊"])}`,
            `レフト、${fullKana(positions["左"])}${honor(positions["左"])}`,
            `センター、${fullKana(positions["中"])}${honor(positions["中"])}`,
            `ライト、${fullKana(positions["右"])}${honor(positions["右"])}`,
          ];

          // 全端末共通：
          // 8人分を speakJoinedTTS() でまとめて生成してから再生すると、
          // キャッシュ未完成時に数秒の大きな無音が発生することがある。
          // 1人ずつ順番に再生し、画面表示時の先読みキャッシュを利用する。
          for (const line of playerLines) {
            if (mySession !== seatSpeakSessionRef.current) return;
            await ttsSpeak(line, { progressive: true, cache: true });
          }
          if (mySession !== seatSpeakSessionRef.current) return;

          if (inning !== "1回の裏") {
            const configuredUmpires = [
              { role: "球審" as const, label: "球審" },
              { role: "一塁" as const, label: "塁審、一塁" },
              { role: "二塁" as const, label: "二塁" },
              { role: "三塁" as const, label: "三塁" },
            ]
              .map(({ role, label }) => ({ label, reading: umpireYomi(role) }))
              .filter(({ reading }) => !!reading);

            // 未設定の審判は役割・名前とも読み上げ文から除外する。
            if (configuredUmpires.length > 0) {
              const umpireText =
                `審判は${configuredUmpires
                  .map(({ label, reading }) => `${label}、${reading}。`)
                  .join("")}` +
                (configuredUmpires.length === 4
                  ? "以上四氏でございます。"
                  : "以上でございます。");

              if (mySession !== seatSpeakSessionRef.current) return;
              await ttsSpeak(umpireText, { progressive: true, cache: true });
            }
          }

          return;
        }

        await speakOpening();
        if (mySession !== seatSpeakSessionRef.current) return;

        const ponyPlayerLines = positionLabels.map(([pos, label]) => {
          const p = positions[pos];
          const yomi = ponyKana(p);
          const isLastPlayer = pos === "右";

          return `${label}、${yomi}${p?.honorific || "くん"}${isLastPlayer ? "です。" : ""}`;
        });

        // 全端末共通：
        // まとめて結合生成せず、1人ずつ順番に再生する。
        // 画面表示時に9人分を先読みしているので、選手間の生成待ちを減らす。
        for (const line of ponyPlayerLines) {
          if (mySession !== seatSpeakSessionRef.current) return;
          await ttsSpeak(line, { progressive: true, cache: true });
        }
        if (mySession !== seatSpeakSessionRef.current) return;
      } finally {
        if (mySession === seatSpeakSessionRef.current) {
          setSpeaking(false);
        }
      }
    })();
  };
  const stopSpeaking = () => {
    seatSpeakSessionRef.current += 1;
    ttsStop();
    setSpeaking(false);
  };


  const fullNameRuby = (p?: PositionInfo) => {
    if (!p?.lastName && !p?.firstName) return "（選手名）";
    return (
      `<ruby>${p.lastName || ""}<rt>${p.lastNameKana || ""}</rt></ruby>` +
      `<ruby>${p.firstName || ""}<rt>${p.firstNameKana || ""}</rt></ruby>`
    );
  };

  const umpireHTML = (role: "球審" | "一塁" | "二塁" | "三塁") => {
    const u: any = findUmpireByRole(role);
    if (!u) return "（　）";

    const name =
      u?.name ||
      u?.umpireName ||
      u?.displayName ||
      "";

    const furigana =
      u?.furigana ||
      u?.nameKana ||
      u?.kana ||
      u?.reading ||
      "";

    if (!name || String(name).trim() === "未設定") return "（　）";
    return `<ruby>${name}<rt>${furigana}</rt></ruby>`;
  };

  const boysPlayersAnnouncement =
      `ピッチャーは ${fullNameRuby(positions["投"])} ${positions["投"]?.honorific || "くん"}、<br />` +
      `キャッチャー ${fullNameRuby(positions["捕"])} ${positions["捕"]?.honorific || "くん"}、<br />` +
      `ファースト ${fullNameRuby(positions["一"])} ${positions["一"]?.honorific || "くん"}、<br />` +
      `セカンド ${fullNameRuby(positions["二"])} ${positions["二"]?.honorific || "くん"}、<br />` +
      `サード ${fullNameRuby(positions["三"])} ${positions["三"]?.honorific || "くん"}、<br />` +
      `ショート ${fullNameRuby(positions["遊"])} ${positions["遊"]?.honorific || "くん"}、<br />` +
      `レフト ${fullNameRuby(positions["左"])} ${positions["左"]?.honorific || "くん"}、<br />` +
      `センター ${fullNameRuby(positions["中"])} ${positions["中"]?.honorific || "くん"}、<br />` +
      `ライト ${fullNameRuby(positions["右"])} ${positions["右"]?.honorific || "くん"}`;

  const formattedAnnouncement = leagueMode === "boys"
    ? (
        inning === "1回の裏"
          ? `${inning}、守ります　${teamName} の<br /><br />` +
            boysPlayersAnnouncement
          : `${inning}、まず守ります　${teamName} の<br /><br />` +
            boysPlayersAnnouncement +
            `<br /><br />` +
            `審判は球審 ${umpireHTML("球審")}、塁審　一塁 ${umpireHTML("一塁")}、` +
            `二塁 ${umpireHTML("二塁")}、三塁 ${umpireHTML("三塁")}、以上四氏でございます。`
      )
    : `${inning}、守ります　${teamName} のシートをお知らせします。

` +
      positionLabels
        .map(([pos, label]) => {
          const p = positions[pos];
          const ln = p?.lastName || "";
          const forceFull = ln && dupLastNames.has(ln);
          const nameHTML = p?.lastName
            ? (forceFull
                ? `<ruby>${p.lastName}<rt>${p.lastNameKana || ""}</rt></ruby>` +
                  `<ruby>${p.firstName || ""}<rt>${p.firstNameKana || ""}</rt></ruby>`
                : `<ruby>${p.lastName}<rt>${p.lastNameKana || ""}</rt></ruby>`)
            : "（苗字）";
          return `${label}　${nameHTML}　${p?.honorific || "くん"}`;
        })
        .join("<br />") + "です。";


  // 導入文だけを優先先読みし、選手紹介部分は従来どおり実再生時に処理する。

  if (!teamName) {
    return (
      <div className="min-h-[100dvh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex items-center justify-center px-6">
        読み込み中…
      </div>
    );
  }

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
      <header className="w-full max-w-[720px]">
        <div className="flex items-center justify-between">

          <div className="w-10" />
        </div>

        {/* 中央大タイトル */}
        <div className="mt-3 text-center select-none">
          <h1 className="inline-flex items-center gap-2 text-3xl md:text-4xl font-extrabold tracking-wide leading-tight">
            <span className="text-2xl md:text-3xl">🪑</span>
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
              シート紹介
            </span>
          </h1>
          <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
          <div className="mt-3 inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs">
            <span>{isHome ? "後攻チーム 🎤" : "先攻チーム 🎤"}</span>
          </div>
        </div>
      </header>

      {/* 本体 */}
      <main className="w-full max-w-[720px] mt-6 space-y-5">
        {/* 注意カード（黄系） */}
        <section className="rounded-2xl p-4 shadow-lg text-left bg-gradient-to-br from-amber-400/20 via-amber-300/15 to-amber-200/10 border border-amber-300/60 ring-1 ring-inset ring-amber-300/30">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-11 h-11 rounded-xl bg-white/15 border border-white/20 flex items-center justify-center">
              <IconInfo />
            </div>
            <h2 className="font-semibold">読み上げタイミング</h2>
          </div>
          <p className="text-amber-50/90 text-sm leading-relaxed">
            ピッチャーが練習球を1球投げてから
          </p>
        </section>

        {/* 🔴 アナウンス文言（赤 強め）＋ 枠内ボタン */}
        <section
          className="
            rounded-2xl p-4 shadow-lg text-left font-semibold
            border border-rose-600/90
            bg-gradient-to-br from-rose-600/45 via-rose-500/35 to-rose-400/25
            ring-1 ring-inset ring-rose-600/50
          "
        >

          <div
            className="text-white whitespace-pre-line leading-relaxed drop-shadow"
            dangerouslySetInnerHTML={{ __html: formattedAnnouncement }}
          />

          {/* 枠内の操作ボタン */}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={speakText}
              disabled={speaking}
              className="w-full px-4 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow active:scale-95 disabled:opacity-60 inline-flex items-center justify-center gap-2"
            >
              <IconMic /> 読み上げ
            </button>
            <button
              onClick={stopSpeaking}
              disabled={!speaking}
              className="flex-1 px-4 py-3 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-semibold shadow active:scale-95 inline-flex items-center justify-center"
            >
              停止
            </button>
          </div>
        </section>

        {/* 戻るボタン（読み上げ・停止の下に横幅いっぱいで配置） */}
        <div className="mt-3">
          <button
            onClick={async () => {
              const tgt = await resolveBackTarget();

              // ✅ 1人アナウンスモードの「1回表終了後シート紹介」から戻る場合、
              // 1回裏の攻撃画面を表示するために matchInfo を進める
              const returnState =
                (await localForage.getItem<any>("seatIntroReturnState")) || null;

              if (
                tgt === ("onePersonAnnounce" as ScreenType) &&
                returnState?.mode === "onePersonNextHalf"
              ) {
                const mi = (await localForage.getItem<any>("matchInfo")) || {};

                await localForage.setItem("matchInfo", {
                  ...mi,
                  inning: Number(returnState.inning ?? 1),
                  isTop: Boolean(returnState.isTop ?? false),
                  isDefense: false,
                  announcementMode: "single",
                });

                await localForage.removeItem("seatIntroReturnState");
              }

              console.log("SeatIntro back ->", tgt);
              onNavigate(tgt);
            }}
            className="w-full px-6 py-4 rounded-2xl bg-white/90 hover:bg-white
                      text-gray-900 font-semibold text-lg shadow-lg active:scale-95"
          >
            ← 戻る
          </button>
        </div>

      </main>
    </div>
  );
};

export default SeatIntroduction;
