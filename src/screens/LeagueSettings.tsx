// src/screens/LeagueSettings.tsx
import React, { useEffect, useState } from "react";
import { getSeniorAnnounceSettings, saveSeniorAnnounceSettings,
  seniorBatterLine, seniorFoulText, type SeniorAnnounceSettings, type SeniorBatterPart } from "../SeniorAnnouncementSettings";
import { DEFAULT_SENIOR_SUB_TEMPLATES, getSeniorSubTemplates, saveSeniorSubTemplates, renderSeniorSubTemplate, type SeniorSubKind } from "../SeniorSubstitutionTemplates";
import { DEFAULT_SENIOR_END_TEMPLATES, getSeniorEndTemplates, saveSeniorEndTemplates, renderSeniorEndTemplate, type SeniorEndKind } from "../SeniorEndGameTemplates";
import type { ScreenType } from "../App";
import { getLeagueLabel, getLeagueMode, setLeagueMode, type LeagueMode } from "../lib/leagueSettings";
import CustomProfileQR from "./CustomProfileQR";
import { resetPitchLimitForLeague } from "../lib/pitchLimitDefaults";
import { getActiveCustomProfileId, getCustomProfiles } from "../lib/customProfiles";

type Props = {
  onNavigate: (s: ScreenType) => void;
};

function OptionCard({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full rounded-2xl border p-4 text-left transition active:scale-[0.98]",
        selected
          ? "bg-blue-600/30 border-blue-300 shadow-lg"
          : "bg-white/10 border-white/10 hover:bg-white/15",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-lg font-bold">{title}</div>
          <div className="text-sm opacity-80 mt-1">{desc}</div>
        </div>
        <div
          className={[
            "w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0",
            selected ? "border-blue-200" : "border-white/40",
          ].join(" ")}
        >
          {selected && <div className="w-3 h-3 rounded-full bg-blue-200" />}
        </div>
      </div>
    </button>
  );
}

export default function LeagueSettings({ onNavigate }: Props) {
  const [endTemplates, setEndTemplates] = useState(getSeniorEndTemplates);
  const [endKind, setEndKind] = useState<SeniorEndKind>("win");
  const endTextRef = React.useRef<HTMLTextAreaElement>(null);
  const updateEndText = (text: string) => setEndTemplates(prev => {
    const next = { ...prev, [endKind]: text };
    saveSeniorEndTemplates(next);
    return next;
  });
  const insertEndToken = (token: string) => {
    const el = endTextRef.current;
    const text = endTemplates[endKind];
    const start = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? start;
    updateEndText(text.slice(0, start) + `【${token}】` + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length + 2, start + token.length + 2);
    });
  };
  const [subTemplates,setSubTemplates]=useState(getSeniorSubTemplates);
  const [subKind,setSubKind]=useState<SeniorSubKind>("pinch");
  const [subPlayerRole,setSubPlayerRole]=useState<"交代前"|"交代後">("交代後");
  const subTextRef=React.useRef<HTMLTextAreaElement>(null);
  const updateSubTemplate=(text:string)=>setSubTemplates(prev=>{const next={...prev,[subKind]:text};saveSeniorSubTemplates(next);return next;});
  const insertSubToken=(token:string)=>{
    const el=subTextRef.current;const text=subTemplates[subKind];const start=el?.selectionStart??text.length;const end=el?.selectionEnd??start;
    const next=text.slice(0,start)+`【${token}】`+text.slice(end);updateSubTemplate(next);
    requestAnimationFrame(()=>{el?.focus();el?.setSelectionRange(start+token.length+2,start+token.length+2);});
  };
  const [showLeagueHelp, setShowLeagueHelp] = useState(false);
  const [showCustomQr, setShowCustomQr] = useState(false);
  const [qrImportMessage, setQrImportMessage] = useState("");
  const [mode, setMode] = useState<LeagueMode>("pony");
  const [senior, setSenior] = useState<SeniorAnnounceSettings>(getSeniorAnnounceSettings);
  const updateSenior = (patch: Partial<SeniorAnnounceSettings>) => {
    setSenior(prev => {const next = {...prev,...patch};saveSeniorAnnounceSettings(next);return next;});
  };
  const addPart = (part: SeniorBatterPart) => {
    if (part === "last" || part === "full") {
      updateSenior({batterParts:[...senior.batterParts.filter(x=>x!=="last"&&x!=="full"),part]});
    } else if (!senior.batterParts.includes(part)) updateSenior({batterParts:[...senior.batterParts,part]});
  };

  useEffect(() => {
    setMode(getLeagueMode());
  }, []);

  const handleSelect = (next: LeagueMode) => {
    if (getLeagueMode() === next) return; // 同じリーグの再選択では手動設定を維持
    setMode(next);
    setLeagueMode(next);
    void resetPitchLimitForLeague(next);
  };

  return (
    <div
      className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white px-6"
      style={{
        paddingTop: "max(16px, env(safe-area-inset-top))",
        paddingBottom: "max(16px, env(safe-area-inset-bottom))",
      }}
    >
      <div className="w-full max-w-2xl mx-auto flex flex-col min-h-[100svh]">
        <header className="pt-2 pb-6">
          <button
            onClick={() => onNavigate("operationSettings")}
            className="mb-4 inline-flex items-center gap-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 px-4 py-2"
          >
            ← 戻る
          </button>

          <div className="relative text-center">
            <button type="button" aria-label="リーグ設定のヘルプ" onClick={() => setShowLeagueHelp(true)} className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center rounded-full bg-sky-600 text-xl font-bold text-white shadow-md hover:bg-sky-500 focus:outline-none focus:ring-2 focus:ring-white" >？</button>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-wide">
              🏆 リーグ設定
            </h1>
            <div className="mx-auto mt-2 h-0.5 w-20 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
            <p className="text-sm opacity-80 mt-3">
              選択したリーグ設定は保存され、次回起動時も引き継がれます。
            </p>
          </div>
        </header>

        <main className="flex-1 flex flex-col justify-center gap-4">
          <OptionCard
            selected={mode === "pony"}
            title="ポニーリーグ"
            desc="ポニーリーグ用のルール・アナウンスで動作"
            onClick={() => handleSelect("pony")}
          />

          <OptionCard
            selected={mode === "boys"}
            title="ボーイズリーグ"
            desc="ボーイズリーグ用のルール・アナウンスで動作"
            onClick={() => handleSelect("boys")}
          />

          <OptionCard
            selected={mode === "senior"}
            title="リトルシニア"
            desc="リトルシニア用のルール・アナウンスで動作"
            onClick={() => handleSelect("senior")}
          />

          <OptionCard
            selected={mode === "custom"}
            title="カスタマイズ"
            desc="大会ごとのアナウンス文言設定"
            onClick={() => handleSelect("custom")}
          />

          {/* カスタマイズモードでのみ、専用の文章設定を表示する。 */}
          {mode === "custom" && <section className="rounded-2xl border border-emerald-400/40 bg-emerald-950/30 p-4 space-y-3">
            <h2 className="text-lg font-bold">🛠 カスタマイズ（設定作成）</h2>
            <p className="text-sm opacity-85">既存3リーグには影響しません。試合中アナウンスの文章を編集・保存できます。</p>
            <button type="button" onClick={() => onNavigate("custom-pre-game-settings")} className="w-full rounded-xl bg-sky-600 px-4 py-3 font-bold text-white active:scale-[0.98]">試合前アナウンス設定を開く →</button>
            <button type="button" onClick={() => onNavigate("custom-in-game-settings")} className="w-full rounded-xl bg-emerald-600 px-4 py-3 font-bold text-white active:scale-[0.98]">試合中アナウンス設定を開く →</button>
            <button type="button" onClick={() => { setQrImportMessage(""); setShowCustomQr(true); }} className="w-full rounded-xl bg-indigo-600 px-4 py-3 font-bold text-white active:scale-[0.98]">📱 QRコードで設定を共有・読み込み</button>
            <p className="text-xs text-emerald-100/80">試合前・試合中の設定を圧縮して1枚のQRで受け渡しします。容量を超える場合はQRを作成できません。</p>
            {qrImportMessage && <p role="status" className="rounded-xl bg-emerald-950/70 p-3 text-sm">{qrImportMessage}</p>}
          </section>}

          {mode === "senior" && (
            <section className="space-y-5 rounded-2xl border border-sky-300/40 bg-slate-800 p-4 text-left">
              <h2 className="text-xl font-extrabold">リトルシニア アナウンス設定</h2>
              <p className="text-xs text-sky-200">変更は自動保存されます。ポニー・ボーイズには適用しません。</p>
              <fieldset className="space-y-2"><legend className="font-bold mb-2">試合開始時間のアナウンス</legend>
                {([ ["kanto","投手が1球投げた後（関東連盟）"], ["kansai","1回表裏攻撃終了後（関西連盟）"], ["tohoku","2番打者の前（東北連盟）"] ] as const).map(([value,label])=>(
                  <label key={value} className="flex gap-3 items-start rounded-xl bg-white/10 p-3"><input type="radio" className="mt-1" name="senior-start-time" checked={senior.startTiming===value} onChange={()=>updateSenior({startTiming:value})}/>{label}</label>
                ))}
              </fieldset>
              <fieldset className="space-y-2"><legend className="font-bold mb-2">シート紹介</legend>
                {([ ["last","苗字のみ"], ["full","フルネーム（東北連盟）"] ] as const).map(([value,label])=>(
                  <label key={value} className="flex gap-3 items-center rounded-xl bg-white/10 p-3"><input type="radio" name="senior-seat-name" checked={senior.seatName===value} onChange={()=>updateSenior({seatName:value})}/>{label}</label>
                ))}
              </fieldset>
              <fieldset className="space-y-2"><legend className="font-bold mb-2">打者紹介（2巡目以降）</legend>
                {([ ["kanto","1番センター（苗字）君、背番号8（関東連盟）"], ["kansai","1番センター（フルネーム）君（関西連盟）"], ["kansaiNumber","1番センター（フルネーム）君、背番号8（関西連盟）"], ["custom","カスタム"] ] as const).map(([value,label])=>(
                  <label key={value} className="flex gap-3 items-start rounded-xl bg-white/10 p-3"><input type="radio" className="mt-1" name="senior-batter-style" checked={senior.batterStyle===value} onChange={()=>updateSenior({batterStyle:value})}/>{label}</label>
                ))}
                {senior.batterStyle === "custom" && <div className="rounded-xl border border-sky-300/30 p-3 space-y-3">
                  <p className="text-sm">使う部品を押した順番で追加します。苗字・フルネームはどちらか一方です。</p>
                  <div className="flex flex-wrap gap-2">{([ ["order","打順"],["position","守備位置"],["last","苗字"],["full","フルネーム"],["number","背番号"] ] as const).map(([value,label])=>(
                    <button type="button" key={value} onClick={()=>addPart(value)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold">＋{label}</button>
                  ))}</div>
                  <div className="flex flex-wrap gap-2 items-center">{senior.batterParts.map((part,i)=>(<button key={i} type="button" title="押すと削除" onClick={()=>updateSenior({batterParts:senior.batterParts.filter((_,j)=>j!==i)})} className="rounded-full bg-white/20 border px-3 py-2 text-sm">{({order:"打順",position:"守備位置",last:"苗字",full:"フルネーム",number:"背番号"})[part]} ×</button>))}</div>
                  <button type="button" onClick={()=>updateSenior({batterParts:[]})} className="text-sm underline">すべてクリア</button>
                </div>}
                <div className="rounded-xl bg-white/10 p-3 text-sm"><div className="opacity-70 mb-1">プレビュー</div><div dangerouslySetInnerHTML={{__html:seniorBatterLine(senior,1,"センター",{lastName:"大谷",firstName:"翔平",lastNameKana:"おおたに",firstNameKana:"しょうへい",number:8})}} /></div>
              </fieldset>
              <fieldset className="space-y-3"><legend className="font-bold mb-2">代打・代走 アナウンス（カスタマイズ）</legend>
                <div className="grid grid-cols-2 gap-2">{([ ["pinch","代打"],["runner","代走"] ] as const).map(([value,label])=><button key={value} type="button" onClick={()=>setSubKind(value)} className={`rounded-xl px-4 py-3 font-bold ${subKind===value?"bg-blue-600 text-white":"bg-white/10"}`}>{label}</button>)}</div>
                <p className="text-sm text-sky-100">文章の好きな位置にカーソルを置き、下のボタンを押すと差し込みます。交代前・交代後を切り替えて選手名を指定できます。</p>
                <div className="flex flex-wrap gap-2 items-center"><span className="text-sm">選手名の対象：</span>{(["交代前","交代後"] as const).map(role=><button key={role} type="button" onClick={()=>setSubPlayerRole(role)} className={`rounded-lg px-3 py-2 text-sm font-bold ${subPlayerRole===role?"bg-sky-600":"bg-white/10"}`}>{role}</button>)}</div>
                <div className="flex flex-wrap gap-2">{(["チーム名","打順","背番号","苗字","フルネーム"] as const).map(key=><button key={key} type="button" className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold" onClick={()=>insertSubToken(["背番号","苗字","フルネーム"].includes(key)?`${subPlayerRole}・${key}`:key)}>＋{key}</button>)}{subKind==="runner"&&<button type="button" onClick={()=>insertSubToken("塁")} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold">＋塁</button>}</div>
                <textarea ref={subTextRef} value={subTemplates[subKind]} onChange={e=>updateSubTemplate(e.target.value)} rows={6} className="w-full rounded-xl bg-white text-gray-900 p-3 text-sm leading-relaxed" aria-label={`${subKind==="pinch"?"代打":"代走"}の文章テンプレート`}/>
                <div className="rounded-xl bg-white/10 p-3 text-sm"><p className="opacity-75 mb-2">プレビュー（選手名は登録のふりがなをルビ表示）</p><div className="leading-8" dangerouslySetInnerHTML={{__html:renderSeniorSubTemplate(subKind,{team:"サンプルチーム",order:4,base:"1塁",before:{lastName:"山田",firstName:"太郎",lastNameKana:"やまだ",firstNameKana:"たろう",number:8},after:{lastName:"佐藤",firstName:"一郎",lastNameKana:"さとう",firstNameKana:"いちろう",number:12}},false,subTemplates[subKind])}} /></div>
                <button type="button" onClick={()=>updateSubTemplate(DEFAULT_SENIOR_SUB_TEMPLATES[subKind])} className="underline text-sm">この文章を初期設定に戻す</button>
              </fieldset>
              <fieldset className="space-y-3">
                <legend className="font-bold mb-2">試合終了 アナウンス（カスタマイズ）</legend>
                <div className="grid grid-cols-2 gap-2">
                  {([ ["win", "勝敗あり"], ["draw", "引き分け"] ] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setEndKind(value)}
                      className={`rounded-xl px-4 py-3 font-bold ${endKind === value ? "bg-blue-600 text-white" : "bg-white/10"}`}>{label}</button>
                  ))}
                </div>
                <p className="text-sm text-sky-100">文章を自由に編集できます。カーソル位置に下のボタンで項目を挿入します。【点数】の1つ目は先攻、2つ目は後攻の得点です。【チーム名】は勝利チーム名になります。</p>
                <div className="flex flex-wrap gap-2">
                  {(["点数", "チーム名", "先攻点数", "後攻点数"] as const).map(token => (
                    <button key={token} type="button" onClick={() => insertEndToken(token)} className="rounded-lg bg-blue-600 px-3 py-2 text-sm font-bold">＋{token}</button>
                  ))}
                </div>
                <textarea ref={endTextRef} value={endTemplates[endKind]} onChange={e => updateEndText(e.target.value)}
                  rows={5} className="w-full rounded-xl bg-white text-gray-900 p-3 text-sm leading-relaxed"
                  aria-label={`${endKind === "win" ? "勝敗あり" : "引き分け"}の試合終了アナウンス`} />
                <div className="rounded-xl bg-white/10 p-3 text-sm">
                  <p className="opacity-75 mb-2">プレビュー</p>
                  <p className="whitespace-pre-wrap leading-relaxed">{renderSeniorEndTemplate(endKind, { topScore: 5, bottomScore: endKind === "draw" ? 5 : 3, winningTeam: "東京ドジャース" }, false, endTemplates[endKind])}</p>
                </div>
                <button type="button" className="underline text-sm" onClick={() => updateEndText(DEFAULT_SENIOR_END_TEMPLATES[endKind])}>この文章を初期設定に戻す</button>
              </fieldset>
              <fieldset className="space-y-2"><legend className="font-bold mb-2">ファールボール</legend>
                {([ ["kanto","ファウルボールの行方には十分ご注意下さい（関東連盟）"], ["kansai","スタンドの皆様、ファールボールにはくれぐれもご注意ください（関西連盟）"], ["custom","カスタム"] ] as const).map(([value,label])=>(
                  <label key={value} className="flex gap-3 items-start rounded-xl bg-white/10 p-3"><input type="radio" className="mt-1" name="senior-foul" checked={senior.foulStyle===value} onChange={()=>updateSenior({foulStyle:value})}/>{label}</label>
                ))}
                {senior.foulStyle === "custom" && <textarea value={senior.customFoul} onChange={e=>updateSenior({customFoul:e.target.value})} placeholder="読み上げる文章を入力" rows={3} className="w-full rounded-xl bg-white text-gray-900 p-3" />}
                <p className="text-sm opacity-80">プレビュー：{seniorFoulText(senior)||"（未入力）"}</p>
              </fieldset>
            </section>
          )}
          <div className="rounded-2xl bg-white/10 border border-white/10 p-4 text-sm opacity-90">
            現在の設定：
            <span className="font-bold ml-2">{getLeagueLabel(mode)}</span>
          </div>
        </main>
        {showCustomQr && <CustomProfileQR
          profileId={getActiveCustomProfileId()}
          onBeforeExport={() => { /* 保存済み設定をそのまま共有 */ }}
          onImported={(id) => {
            const imported = getCustomProfiles().find((profile) => profile.id === id);
            setQrImportMessage(`「${imported?.name || 'カスタマイズ'}」を取り込みました。試合前・試合中の設定が引き継がれています。`);
            setShowCustomQr(false);
          }}
          onClose={() => setShowCustomQr(false)}
        />}
        {showLeagueHelp && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 px-2 sm:px-4 py-3" role="presentation" onClick={() => setShowLeagueHelp(false)}>
            <section role="dialog" aria-modal="true" aria-labelledby="league-help-title" onClick={(event) => event.stopPropagation()}
              className="flex w-full max-w-lg max-h-[min(92svh,850px)] flex-col overflow-hidden rounded-[22px] bg-white text-slate-900 shadow-2xl">
              <div className="flex shrink-0 items-center justify-between gap-2 bg-sky-600 px-4 py-3 text-white">
                <h2 id="league-help-title" className="flex items-center gap-2 text-base sm:text-lg font-extrabold">
                  <span className="text-xl" aria-hidden="true">❓</span> リーグ設定画面の使い方
                </h2>
                <button type="button" aria-label="ヘルプを閉じる" onClick={() => setShowLeagueHelp(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl font-bold hover:bg-white/30">×</button>
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm leading-relaxed">
                <div className="rounded-2xl border border-sky-200 bg-sky-50 px-3 py-3">
                  <p className="font-bold text-slate-800">試合で使用するリーグを選択する画面です。</p>
                  <p className="mt-1 text-xs text-slate-700">選択したリーグによって、アナウンス文言や試合中の設定内容が変わります。</p>
                  <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2">
                    <p className="text-xs font-bold text-slate-500">おすすめ</p>
                    <p className="mt-1 text-xs font-semibold text-rose-600">試合開始前にリーグの選択を確認してください</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                  <h3 className="text-sm font-extrabold text-emerald-800">⚾ リーグを選ぶ</h3>
                  <div className="rounded-xl border border-orange-200 bg-orange-50 px-3 py-2">
                    <p className="font-bold text-orange-800">⚾ ポニーリーグ</p>
                    <p className="mt-1 text-xs text-slate-700">ポニーリーグに対応したアナウンスを使用します。</p>
                  </div>
                  <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2">
                    <p className="font-bold text-blue-800">⚾ ボーイズリーグ</p>
                    <p className="mt-1 text-xs text-slate-700">ボーイズリーグに対応したアナウンスを使用します。</p>
                  </div>
                  <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-2">
                    <p className="font-bold text-violet-800">⚾ リトルシニア</p>
                    <p className="mt-1 text-xs text-slate-700">リトルシニアのアナウンスを使用し、必要に応じて画面内の詳細設定を調整します。</p>
                  </div>
                  <div className="rounded-xl border border-teal-200 bg-teal-50 px-3 py-2">
                    <p className="font-bold text-teal-800">🛠 カスタマイズ</p>
                    <p className="mt-1 text-xs text-slate-700">試合前・試合中の読み上げ文章やメモを、独自の内容に設定できます。</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
                  <h3 className="font-extrabold text-amber-900">💡 設定の保存について</h3>
                  <p className="mt-1 text-xs text-slate-700">選択したリーグは自動保存され、次回の起動時にも引き継がれます。</p>
                  <p className="mt-1 text-xs text-slate-700">試合途中でリーグを変更すると、使用するアナウンスが変わるため、試合前に選択してください。</p>
                </div>
              </div>
              <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3" style={{paddingBottom:'max(12px, env(safe-area-inset-bottom))'}}>
                <button type="button" onClick={() => setShowLeagueHelp(false)} className="w-full rounded-xl bg-emerald-600 py-3 text-base font-extrabold text-white shadow-sm active:scale-[0.99]">OK</button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}