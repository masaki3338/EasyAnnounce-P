import React, { useEffect,useRef, useState } from "react";
import localForage from "localforage";
import * as wanakana from "wanakana";



type Player = {
  id: number;
  lastName: string;
  firstName: string;
  lastNameKana: string;
  firstNameKana: string;
  number: string;
  isFemale: boolean;
};

type Team = {
  name: string;
  furigana: string;
  players: Player[];
};



const TeamRegister = () => {
  const [team, setTeam] = useState<Team>({
    name: "",
    furigana: "",
    players: [],
  });


  const [restoreMessage, setRestoreMessage] = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSaveComplete, setShowSaveComplete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
  const [formError, setFormError] = useState("");
  const [showBackupComplete, setShowBackupComplete] = useState(false);
  const [backupFileName, setBackupFileName] = useState("");
  const [showFormErrorModal, setShowFormErrorModal] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [allowLeave, setAllowLeave] = useState(false);
  const snapshotRef = useRef<string | null>(null);
  const initDoneRef = useRef(false);

  // 必須入力欄
  const firstNameInputRef = useRef<HTMLInputElement>(null);
  const lastNameInputRef = useRef<HTMLInputElement>(null);
  const firstNameKanaRef = useRef<HTMLInputElement>(null);
  const lastNameKanaRef  = useRef<HTMLInputElement>(null);
  const numberInputRef   = useRef<HTMLInputElement>(null);

  type FieldId = 'lastName' | 'lastNameKana' | 'firstName' | 'firstNameKana' | 'number';

  const inputRefs: Record<FieldId, React.RefObject<HTMLInputElement>> = {
    lastName:      lastNameInputRef,
    lastNameKana:  lastNameKanaRef,   // （任意）
    firstName:     firstNameInputRef,
    firstNameKana: firstNameKanaRef,  // （任意）
    number:        numberInputRef,
  };

  const FIELDS: { id: FieldId; label: string; placeholder: string }[] = [
    { id: 'lastName',      label: '姓',             placeholder: '例：山田' },
    { id: 'lastNameKana',  label: 'ふりがな（姓）', placeholder: 'やまだ' },
    { id: 'firstName',     label: '名',             placeholder: '例：太郎' },
    { id: 'firstNameKana', label: 'ふりがな（名）', placeholder: 'たろう' },
    { id: 'number',        label: '背番号',         placeholder: '10' },
  ];

  const buildSnapshot = () =>
  JSON.stringify({
    team,
    editingPlayer,
  });

  // 既存の handleBackup を置き換え
const handleBackup = async () => {
  const blob = new Blob([JSON.stringify(team, null, 2)], {
    type: "application/json",
  });

  // File System Access API が使える場合（Chrome / Edge 等）
  const anyWindow = window as any;
  if (typeof anyWindow.showSaveFilePicker === "function") {
    try {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName: `team_backup_${new Date()
          .toISOString()
          .slice(0,19)
          .replace(/[:T]/g,"-")}.json`,
        types: [
          {
            description: "JSON file",
            accept: { "application/json": [".json"] },
          },
        ],
        excludeAcceptAllOption: false,
      });

      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();

      //alert(`✅ 保存しました：${handle.name}`);
      setBackupFileName(handle.name);
      setShowBackupComplete(true);
      return;
      } catch (err: any) {
        // キャンセル時は何もしない
        if (err?.name === "AbortError") {
          return;
        }

        // それ以外のエラーだけフォールバックへ
        console.warn("save picker failed:", err);
      }
  }

  // ▼ フォールバック（従来どおりの自動ダウンロード）
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "team_backup.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setBackupFileName("team_backup.json");
  setShowBackupComplete(true);
};


  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setTeam(data);
      setRestoreMessage("✅ バックアップを読み込みました。必要なら保存するボタンを押してください。");
    } catch (error) {
      setRestoreMessage("❌ 読み込みに失敗しました。ファイル形式を確認してください。");
    }
  };


  const [editingPlayer, setEditingPlayer] = useState<Partial<Player>>({});

useEffect(() => {
  if (editingPlayer.id && typeof window !== "undefined") {
    setTimeout(() => {
      lastNameInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      lastNameInputRef.current?.focus();
    }, 100);
  }
}, [editingPlayer.id]);

useEffect(() => {
  localForage.getItem<Team>("team").then((data) => {
    if (data) {
      setTeam(data);
      snapshotRef.current = JSON.stringify({
        team: data,
        editingPlayer: {},
      });
    } else {
      snapshotRef.current = JSON.stringify({
        team: {
          name: "",
          furigana: "",
          players: [],
        },
        editingPlayer: {},
      });
    }

    setIsDirty(false);
    initDoneRef.current = true;
  });
}, []);

useEffect(() => {
  if (!initDoneRef.current) return;
  setIsDirty(buildSnapshot() !== snapshotRef.current);
}, [team, editingPlayer]);

useEffect(() => {
  const appBackBtn = document.getElementById(
    "team-register-back-button"
  ) as HTMLButtonElement | null;

  if (!appBackBtn) return;

  const handleClick = (e: Event) => {
    if (allowLeave) return;
    if (!isDirty) return;

    e.preventDefault();
    e.stopPropagation();
    setShowLeaveConfirm(true);
  };

  appBackBtn.addEventListener("click", handleClick, true);

  return () => {
    appBackBtn.removeEventListener("click", handleClick, true);
  };
}, [isDirty, allowLeave]);

const handleTeamChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const { name, value } = e.target;
  // ✅ チーム名・ふりがなをそれぞれ独立して更新（連動させない）
  setTeam((prev) => ({ ...prev, [name]: value }));
};

const handlePlayerChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const { name, value, type, checked } = e.target;

  const nextValue =
    type === "checkbox"
      ? checked
      : name === "number"
      ? value.replace(/[^0-9]/g, "")
      : value;

  setEditingPlayer((prev) => ({
    ...prev,
    [name]: nextValue,
  }));
};



const addOrUpdatePlayer = () => {
  const ln  = (editingPlayer.lastName  ?? "").trim();
  const fn  = (editingPlayer.firstName ?? "").trim();
  const lnk  = (editingPlayer.lastNameKana   ?? "").trim();   // ★追加
  const fnk  = (editingPlayer.firstNameKana  ?? "").trim();   // ★追加
  const num = (editingPlayer.number    ?? "").trim();

  // 未入力チェック（順番＝フォーカス優先度）
  const missing: { label: string; ref: React.RefObject<HTMLInputElement> }[] = [];
  if (!ln)  missing.push({ label: "姓",     ref: lastNameInputRef  });
  //if (!fn)  missing.push({ label: "名",     ref: firstNameInputRef });
  //if (!lnk) missing.push({ label: "ふりがな（姓）",  ref: lastNameKanaRef    });   // ★追加
  //if (!fnk) missing.push({ label: "ふりがな（名）",  ref: firstNameKanaRef   });   // ★追加
  //if (!num) missing.push({ label: "背番号", ref: numberInputRef    });

  if (missing.length > 0) {
    const labels = missing.map(m => m.label).join("・");
    setFormError(`未入力の項目があります：${labels}`);
    setShowFormErrorModal(true);

    // 最初の未入力欄へスクロール＆フォーカス
    setTimeout(() => {
      const target = missing[0].ref.current;
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.focus();
    }, 0);
    return;
  }

  setFormError("");

  // ここからは従来通りの追加・更新処理
  //if (!editingPlayer.lastName || !editingPlayer.firstName || !editingPlayer.number) return;
  if (!editingPlayer.lastName) return;

  setTeam((prev) => {
    const existingIndex = prev.players.findIndex((p) => p.id === editingPlayer.id);
    const newPlayer: Player = {
      id: editingPlayer.id ?? Date.now(),
      lastName: editingPlayer.lastName!,
      firstName: editingPlayer.firstName!,
      // ★ ふりがなを強制自動生成しない（空でも保存可）
      lastNameKana: editingPlayer.lastNameKana ?? "",
      firstNameKana: editingPlayer.firstNameKana ?? "",
      number: editingPlayer.number!,
      isFemale: editingPlayer.isFemale ?? false,
    };

    const updatedPlayers =
      existingIndex >= 0
        ? [...prev.players.slice(0, existingIndex), newPlayer, ...prev.players.slice(existingIndex + 1)]
        : [...prev.players, newPlayer];

    return { ...prev, players: updatedPlayers };
  });

  setEditingPlayer({});
};


  const editPlayer = (player: Player) => setEditingPlayer(player);

  const deletePlayer = (player: Player) => {
    setDeleteTarget(player);
  };
  const confirmDeletePlayer = () => {
    if (!deleteTarget) return;

    setTeam((prev) => ({
      ...prev,
      players: prev.players.filter((p) => p.id !== deleteTarget.id),
    }));

    if (editingPlayer.id === deleteTarget.id) {
      setEditingPlayer({});
    }

    setDeleteTarget(null);
  };

const saveTeam = async () => {
  const updatedTeam = {
    ...team,
    furigana: (team.furigana ?? "").trim(),
    players: [...team.players].sort((a, b) => Number(a.number) - Number(b.number)),
  };

  await localForage.setItem("team", updatedTeam);
  setTeam(updatedTeam);

  snapshotRef.current = JSON.stringify({
    team: updatedTeam,
    editingPlayer: {},
  });
  setIsDirty(false);
  setAllowLeave(false);

  setShowSaveComplete(true);
};


  return (
 <div
   className="min-h-[100svh] bg-gradient-to-b from-gray-900 to-gray-800 text-white flex flex-col items-center px-6"
   style={{
     paddingTop: "max(16px, env(safe-area-inset-top))",
     paddingBottom: "max(16px, env(safe-area-inset-bottom))",
   }}
 >
<div className="relative mt-2 text-center select-none mb-3 w-full">
  <h1 className="flex items-center justify-center gap-2 text-2xl sm:text-3xl font-extrabold tracking-wide leading-tight pr-12">
    <span className="text-xl sm:text-2xl">🧢</span>
    <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-sky-100 to-sky-400 drop-shadow">
      チーム／選手登録
    </span>
  </h1>

  <button
    type="button"
    onClick={() => setShowHelpModal(true)}
    className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-lg shadow active:scale-95"
    aria-label="チーム／選手登録の使い方"
  >
    ？
  </button>

  <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />
</div>

    <div className="flex gap-3 justify-center mt-4 mb-2 w-full">
      <button
        onClick={handleBackup}
         className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl shadow active:scale-95"
      >
        💽 バックアップ
      </button>

      <label className="inline-flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-xl shadow active:scale-95 cursor-pointer">
        📂 復元
        <input
          type="file"
          accept="application/json"
          onChange={handleRestore}
          style={{ display: "none" }}
        />
      </label>
    </div>

 {restoreMessage && (
   <div className="text-sm text-center mb-4">
     <span className="inline-block px-3 py-2 rounded-xl bg-white/10 border border-white/10">
       {restoreMessage}
     </span>
   </div>
 )}

      {/* チーム情報入力 */}
      <div className="w-full space-y-4 rounded-2xl p-4 bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow mb-6">
        <div>
          <label htmlFor="teamName" className="block text-sm font-semibold text-white/90 drop-shadow">
            チーム名
          </label>
          <input
            id="teamName"
            type="text"
            name="name"
            value={team.name}
            onChange={handleTeamChange}
             className="w-full mt-1 px-3 py-2 rounded-xl bg-white/90 text-gray-900 border border-white/70 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="例：広島カープ"
          />
        </div>
        <div>
          <label htmlFor="teamFurigana" className="block text-sm font-semibold text-white/90 drop-shadow">
            ふりがな
          </label>
          <input
            id="teamFurigana"
            type="text"
            name="furigana"
            value={team.furigana}
            onChange={handleTeamChange}
              className="w-full mt-1 px-3 py-2 rounded-xl
+             bg-white/90 text-gray-900 placeholder-gray-600
+             border border-white/70 shadow-sm
+             focus:outline-none focus:ring-2 focus:ring-sky-400"
            placeholder="例：ひろしまかーぷ"
          />
        </div>
      </div>


      {/* 選手追加フォーム */}      
       <div className="w-full rounded-2xl p-4 bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow mb-6">
        <h2 className="text-lg font-bold text-blue-600 mb-4">{editingPlayer.id ? "選手を編集" : "選手を追加"}</h2>
        
      
        {FIELDS.map(({ id, label, placeholder }) => (
          <div key={id} className="mb-3">
            <label htmlFor={id} className="block text-sm font-semibold text-white/90 drop-shadow">
              {label}
            </label>
              <input
                id={id}
                name={id}
                ref={inputRefs[id]}
                value={(editingPlayer as any)[id] || ""}
                onChange={handlePlayerChange}
                inputMode={id === "number" ? "numeric" : undefined}
                pattern={id === "number" ? "[0-9]*" : undefined}
                autoComplete="off"
                className="w-full mt-1 px-3 py-2 rounded-xl
                          bg-white/90 text-gray-900 placeholder-gray-600
                          border border-white/70 shadow-sm
                          focus:outline-none focus:ring-2 focus:ring-sky-400"
                placeholder={placeholder}
              />
          </div>
        ))}

        <label className="inline-flex items-center gap-2 mt-2 mb-4">
          <input
            type="checkbox"
            name="isFemale"
            checked={editingPlayer.isFemale || false}
            onChange={handlePlayerChange}
            className="mr-2"
          />
          女子選手
        </label>

        <button
          onClick={addOrUpdatePlayer}
          className="w-full bg-green-600 hover:bg-green-700 text-white py-3 rounded-2xl text-lg font-semibold shadow active:scale-95"
        >
          {editingPlayer.id ? "✅ 更新" : "➕ 追加"}
        </button>
      </div>

      {/* 選手一覧 */}
       <div className="w-full rounded-2xl p-4 bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10 shadow mb-6">
        <h2 className="text-lg font-bold text-blue-600 mb-4">👥 登録済み選手</h2>
        <ul className="space-y-3">
          {team.players
            .sort((a, b) => Number(a.number) - Number(b.number))
            .map((p) => (
              <li key={p.id} className="rounded-xl p-3 flex justify-between items-center bg-white/10 border border-white/10 ring-1 ring-inset ring-white/10">
                <div>
                  <p className="text-sm font-medium">
                    背番号 {p.number}：{p.lastName} {p.firstName} {p.isFemale ? "👩" : ""}
                  </p>
                  <p className="text-xs text-white/70">{p.lastNameKana} {p.firstNameKana}</p>
                </div>
   <div className="flex gap-2 text-sm">
     <button onClick={() => editPlayer(p)} className="px-3 py-1 rounded-lg bg-white/10 border border-white/10 hover:bg-white/15 active:scale-95">編集</button>
     <button onClick={() => deletePlayer(p)} className="px-3 py-1 rounded-lg bg-rose-600/80 hover:bg-rose-700 text-white active:scale-95">削除</button>
                </div>
              </li>
            ))}
        </ul>
      </div>

{/* 保存ボタンカード（横いっぱい・常に下に固定表示） */}
<div className="sticky bottom-0 left-0 right-0 
                w-full px-0">   {/* ← w-full をここに追加して親を画面幅いっぱいに */}
  <div className="px-4 py-3 
                  bg-gradient-to-t from-gray-900/95 to-gray-900/80 
                  backdrop-blur-md border-t border-white/10">
    <button
      onClick={saveTeam}
      className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white 
                 text-lg font-extrabold rounded-none shadow-lg 
                 active:scale-95 transition"
    >
     💾 保存する
    </button>
  </div>
</div>

{/* 使い方モーダル */}
{showHelpModal && (
  <div
    className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/50 px-3 py-3"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowHelpModal(false)}
  >
    <div
      className="w-full max-w-[460px] overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      {/* ヘッダー */}
      <div className="flex items-center justify-between bg-sky-600 px-4 py-3 text-white">
        <div className="flex items-center gap-2">
          <span className="text-[18px] leading-none">❓</span>
          <h2 className="text-[18px] font-extrabold leading-tight tracking-[0.01em]">
            チーム／選手登録の使い方
          </h2>
        </div>

        <button
          type="button"
          onClick={() => setShowHelpModal(false)}
          aria-label="閉じる"
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-[18px] font-bold text-white transition hover:bg-white/30 active:scale-95"
        >
          ×
        </button>
      </div>

      {/* 本文 */}
      <div className="max-h-[72svh] overflow-y-auto bg-white px-3 py-3">
        <div className="space-y-3">
          {/* 上部説明 */}
          <div className="rounded-[16px] border border-sky-200 bg-sky-50 px-3 py-3">
            <p className="text-[13px] font-semibold leading-5 text-slate-800">
              この画面では、チーム名と選手を登録します。
            </p>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                使い方はこの順番です
              </div>
              <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                ①チーム名を登録 → ②選手を追加 → ③必要に応じて編集・バックアップ
              </div>
            </div>
          </div>

          {/* 1 */}
          <div className="rounded-[16px] border border-emerald-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[12px] font-bold text-white shadow-sm">
                1
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-emerald-700">
                  チーム名を登録
                </h3>
                <p className="mt-1.5 text-[13px] font-normal leading-5 text-slate-700">
                  チーム名を入力します。
                </p>
                <p className="mt-1 text-[13px] font-normal leading-5 text-slate-700">
                  ふりがなは、
                  <br />
                  ・画面のルビ表示
                  <br />
                  ・アナウンスの読み上げ
                  <br />
                  に使われます。
                </p>
              </div>
            </div>
          </div>

          {/* 2 */}
          <div className="rounded-[16px] border border-sky-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-500 text-[12px] font-bold text-white shadow-sm">
                2
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-sky-700">
                  選手を追加
                </h3>

                <div className="mt-2 space-y-1 text-[13px] leading-5 text-slate-700">
                  <p>① 選手名・ふりがな・背番号を入力</p>
                  <p>
                    ②{" "}
                    <span className="font-bold text-emerald-700">
                      【追加】
                    </span>
                    ボタンを押す
                  </p>
                  <p className="font-bold text-rose-500">
                    → 選手が登録されます
                  </p>
                </div>

                <p className="mt-2 text-[12.5px] leading-5 text-slate-600">
                  ※ ふりがなはルビ表示と読み上げに使用されます。
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-slate-600">
                  ※ 女子選手にチェックを入れると、呼び方が
                  「くん」→「さん」になります。
                </p>
              </div>
            </div>
          </div>

          {/* 3 */}
          <div className="rounded-[16px] border border-violet-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500 text-[12px] font-bold text-white shadow-sm">
                3
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-violet-700">
                  登録後にできること
                </h3>

                <div className="mt-2 space-y-3 text-[13px] leading-5 text-slate-700">
                  <div>
                    <div className="font-bold text-slate-900">【編集】</div>
                    <p className="mt-1">
                      ①{" "}
                      <span className="font-bold text-sky-700">【編集】</span>
                      ボタンを押す
                      <br />
                      ② 内容を変更する
                      <br />
                      ③{" "}
                      <span className="font-bold text-sky-700">【更新】</span>
                      ボタンを押す
                      <br />
                      <span className="font-bold text-rose-500">
                        → 情報が更新されます
                      </span>
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【削除】</div>
                    <p className="mt-1">
                      ①{" "}
                      <span className="font-bold text-red-600">【削除】</span>
                      ボタンを押す
                      <br />
                      ② 確認メッセージで【OK】を押す
                      <br />
                      <span className="font-bold text-rose-500">
                        → 選手が削除されます
                      </span>
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【バックアップ】</div>
                    <p className="mt-1">
                      ① バックアップを実行する
                      <br />
                      <span className="font-bold text-rose-500">
                        → 登録データが保存されます
                      </span>
                      <br />
                      ファイル名：日付・時間.json
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【復元】</div>
                    <p className="mt-1">
                      ① 復元したいファイルを選ぶ
                      <br />
                      <span className="font-bold text-rose-500">
                        → バックアップ内容が復元されます
                      </span>
                    </p>
                  </div>
                </div>

                <p className="mt-3 text-[12px] font-semibold leading-5 text-emerald-700">
                  ※ 一度登録すれば、毎回入力する必要はありません。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* フッター */}
      <div className="bg-white px-3 pb-3 pt-1">
        <button
          type="button"
          onClick={() => setShowHelpModal(false)}
          className="w-full rounded-2xl bg-emerald-600 py-3 text-[15px] font-bold text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.98]"
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* 選手削除確認モーダル */}
{deleteTarget && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setDeleteTarget(null)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-red-600 text-white text-center font-bold py-3">
        確認
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          {`背番号 ${deleteTarget.number}：${deleteTarget.lastName ?? ""} ${deleteTarget.firstName ?? ""} を削除してよいですか？`}
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-gray-500 text-white font-semibold hover:bg-gray-600 active:bg-gray-700"
            onClick={() => setDeleteTarget(null)}
          >
            いいえ
          </button>
          <button
            className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
            onClick={confirmDeletePlayer}
          >
            削除
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{/* 保存完了モーダル */}
{showSaveComplete && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowSaveComplete(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-blue-600 text-white text-center font-bold py-3">
        保存完了
      </div>

      <div className="px-6 py-5 text-center">
        <p className="text-[15px] font-bold text-gray-800 leading-relaxed">
          チーム情報を保存しました！
        </p>
      </div>

      <div className="px-5 pb-5">
        <button
          className="w-full py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800"
          onClick={() => setShowSaveComplete(false)}
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* 未保存確認モーダル */}
{showLeaveConfirm && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowLeaveConfirm(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-green-600 text-white text-center font-bold py-3">
        確認
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          追加、変更、削除した内容を保存していません。{"\n"}
          よろしいですか？
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
            onClick={() => setShowLeaveConfirm(false)}
          >
            NO
          </button>
          <button
            className="w-full py-3 rounded-full bg-green-600 text-white font-semibold hover:bg-green-700 active:bg-green-800"
            onClick={() => {
              setShowLeaveConfirm(false);
              setAllowLeave(true);

              setTimeout(() => {
                const appBackBtn = document.getElementById("team-register-back-button");
                appBackBtn?.click();
              }, 0);
            }}
          >
            YES
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{/* 入力不足モーダル */}
{showFormErrorModal && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowFormErrorModal(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-red-600 text-white text-center font-bold py-3">
        確認
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          {formError}
        </p>
      </div>

      <div className="px-5 pb-5">
        <button
          className="w-full py-3 rounded-full bg-red-600 text-white font-semibold hover:bg-red-700 active:bg-red-800"
          onClick={() => setShowFormErrorModal(false)}
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

{/* バックアップ完了モーダル */}
{showBackupComplete && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowBackupComplete(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-blue-600 text-white text-center font-bold py-3">
        バックアップ完了
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          バックアップを保存しました。{"\n"}
          {backupFileName}
        </p>
      </div>

      <div className="px-5 pb-5">
        <button
          className="w-full py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800"
          onClick={() => setShowBackupComplete(false)}
        >
          OK
        </button>
      </div>
    </div>
  </div>
)}

    </div>
  );
};

export default TeamRegister;
