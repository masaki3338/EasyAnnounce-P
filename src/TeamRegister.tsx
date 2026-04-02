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
  const [formError, setFormError] = useState("");
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

      alert(`✅ 保存しました：${handle.name}`);
      return;
    } catch (err) {
      // ユーザーがキャンセルした等。フォールバックへ続行
      console.warn("save picker canceled or failed:", err);
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
};


  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      setTeam(data);
      setRestoreMessage("✅ バックアップを読み込みました。必要なら保存ボタンを押してください。");
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
      if (data) setTeam(data);
    });
  }, []);

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
    alert(`未入力の項目があります：${labels}`);

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
  const name = `${player.lastName ?? ""} ${player.firstName ?? ""}`.trim();
  const msg  = `背番号 ${player.number}：${name} を削除してよいですか？`;
  if (!window.confirm(msg)) return;

  setTeam((prev) => ({
    ...prev,
    players: prev.players.filter((p) => p.id !== player.id),
  }));

  // 編集中の選手を消した場合はフォームをクリア（任意）
  if (editingPlayer.id === player.id) {
    setEditingPlayer({});
  }
};


const saveTeam = async () => {
  const updatedTeam = {
    ...team,
    // ✅ 入力されたふりがなをそのまま保存（上書きしない）
    furigana: (team.furigana ?? "").trim(),
    players: [...team.players].sort((a, b) => Number(a.number) - Number(b.number)),
  };
  await localForage.setItem("team", updatedTeam);
  alert("✅ チーム情報を保存しました");
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
        className="fixed inset-0 z-[9998] flex items-center justify-center bg-black px-4 py-4"
        role="dialog"
        aria-modal="true"
        onClick={() => setShowHelpModal(false)}
      >
        <div
          className="w-full max-w-2xl rounded-2xl bg-gray-900 text-white shadow-2xl border border-white/15 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          role="document"
        >
          <div className="px-5 py-4 bg-sky-600 text-white font-bold text-center text-lg">
            チーム／選手登録の使い方
          </div>

          <div className="px-5 py-5 space-y-4 text-sm leading-relaxed bg-gray-950">
            <div>
              <div className="font-bold text-base text-sky-200">・チーム名を入力</div>
              <div className="mt-1 text-white/90">
                ふりがなはルビ表示、機械読み上げに使用されます。
              </div>
            </div>

            <div>
              <div className="font-bold text-base text-sky-200">・選手を追加</div>
              <div className="mt-1 text-white/90">
                ふりがなはルビ表示、機械読み上げに使用されます。<br />
                女子選手の場合、女子選手にチェックをしてください。<br />
                （"くん" から "さん" になります）<br />
                入力後に【追加】ボタンを押すと登録されます。
              </div>
            </div>

            <div>
              <div className="font-bold text-base text-sky-200">・登録済選手の編集</div>
              <div className="mt-1 text-white/90">
                選手名の【編集】ボタンを押すと現在の選手情報が表示されるので、
                変更したい項目を入力してください。<br />
                【更新】ボタンを押すと更新されます。
              </div>
            </div>

            <div>
              <div className="font-bold text-base text-sky-200">・登録済選手の削除</div>
              <div className="mt-1 text-white/90">
                選手名の【削除】ボタンを押すと「削除していいですか？」のメッセージが表示され、
                【OK】を押すと削除されます。
              </div>
            </div>

            <div>
              <div className="font-bold text-base text-sky-200">・バックアップ</div>
              <div className="mt-1 text-white/90">
                現在、登録されているチーム、選手のバックアップが出来ます。<br />
                [日付、時間.json] の名前で保存されます。<br />
                必要に応じて、保存場所、名称を変更してください。
              </div>
            </div>

            <div>
              <div className="font-bold text-base text-sky-200">・復元</div>
              <div className="mt-1 text-white/90">
                復元したいファイルを選択することで、
                バックアップしたファイルを読み込み復元することが出来ます。
              </div>
            </div>
          </div>

          <div className="px-5 pb-5">
            <button
              type="button"
              onClick={() => setShowHelpModal(false)}
              className="w-full py-3 rounded-2xl bg-green-600 hover:bg-green-700 text-white font-semibold active:scale-95"
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
