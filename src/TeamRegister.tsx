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

type TeamFolder = {
  id: string;
  listName: string; // 左上リストに表示する名前
  team: Team;
  createdAt: number;
  updatedAt: number;
};

type TeamRegisterStore = {
  selectedTeamId: string | null;
  teams: TeamFolder[];
};

const TEAM_STORE_KEY = "teamRegisterStore";

const EMPTY_TEAM: Team = {
  name: "",
  furigana: "",
  players: [],
};


const TeamRegister = () => {
  const [team, setTeam] = useState<Team>(EMPTY_TEAM);
  const [teamListName, setTeamListName] = useState("");
  const [teamStore, setTeamStore] = useState<TeamRegisterStore>({
    selectedTeamId: null,
    teams: [],
  });
  const [showTeamMenu, setShowTeamMenu] = useState(false);

  const [showDeleteTeamConfirm, setShowDeleteTeamConfirm] = useState(false);

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

  const buildEmptySnapshot = () =>
  JSON.stringify({
    team: EMPTY_TEAM,
    editingPlayer: {},
    teamListName: "",
  });

  const loadFolderToForm = (folder: TeamFolder) => {
    setTeam(folder.team);
    setTeamListName(folder.listName);
    setEditingPlayer({});
  };

  const makeSnapshot = (nextTeam: Team, nextEditingPlayer: Partial<Player>, nextTeamListName: string) =>
      JSON.stringify({
        team: nextTeam,
        editingPlayer: nextEditingPlayer,
        teamListName: nextTeamListName,
      });

const clearContinuationGameCache = async () => {
  const keys = [
    "lastGameScreen",
    "startingBattingOrder",
    "battingOrder",
    "startingLineup",
    "lineupAssignments",
    "matchInfo",
    "lastBatterIndex",
    "scores",
    "usedPlayerInfo",
    "tempRunnerByOrder",
    "pitchCounts",
    "pitcherTotals",
    "pitcherOrder",

    // ▼ スタメン設定画面の復元元も空にする
    "startingassignments",
    "startingInitialSnapshot",
    "startingBenchOutIds",
  ];

  await Promise.all(keys.map((key) => localForage.removeItem(key)));
};

  const createNewFolder = async () => {
    await clearContinuationGameCache();

    setTeamStore((prev) => ({
      ...prev,
      selectedTeamId: null,
    }));
    setTeamListName("");
    setTeam(EMPTY_TEAM);
    setEditingPlayer({});
    setShowTeamMenu(false);
  };

  const selectFolder = async (folderId: string) => {
    const folder = teamStore.teams.find((t) => t.id === folderId);
    if (!folder) return;

    await clearContinuationGameCache();

    setTeamStore((prev) => ({
      ...prev,
      selectedTeamId: folder.id,
    }));
    loadFolderToForm(folder);
    setShowTeamMenu(false);
  };

  const confirmDeleteCurrentTeam = async () => {
  if (!teamStore.selectedTeamId) {
    setFormError("削除する登録が選択されていません");
    setShowFormErrorModal(true);
    return;
  }

  const deletingId = teamStore.selectedTeamId;
  const remainingTeams = teamStore.teams.filter((folder) => folder.id !== deletingId);
  const nextSelected = remainingTeams[0] ?? null;

  const nextStore: TeamRegisterStore = {
    selectedTeamId: nextSelected?.id ?? null,
    teams: remainingTeams,
  };

  await localForage.setItem(TEAM_STORE_KEY, nextStore);

  if (nextSelected) {
    await localForage.setItem("team", nextSelected.team);
    setTeam(nextSelected.team);
    setTeamListName(nextSelected.listName);
  } else {
    await localForage.removeItem("team");
    setTeam(EMPTY_TEAM);
    setTeamListName("");
  }

  setTeamStore(nextStore);
  setEditingPlayer({});
  snapshotRef.current = makeSnapshot(
    nextSelected?.team ?? EMPTY_TEAM,
    {},
    nextSelected?.listName ?? ""
  );
  setIsDirty(false);
  setShowDeleteTeamConfirm(false);
  setShowTeamMenu(false);
};

const buildSnapshot = () =>
  JSON.stringify({
    team,
    editingPlayer,
    teamListName,
  });

  // 既存の handleBackup を置き換え
const handleBackup = async () => {
  const selectedFolder =
    teamStore.teams.find((folder) => folder.id === teamStore.selectedTeamId) ?? null;

  if (!selectedFolder) {
    setFormError("バックアップする登録が選択されていません");
    setShowFormErrorModal(true);
    return;
  }

  const backupData = {
    version: 1,
    type: "single-team-backup",
    exportedAt: new Date().toISOString(),
    folder: selectedFolder,
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], {
    type: "application/json",
  });

  const safeName = (selectedFolder.listName || "team")
    .replace(/[\\/:*?"<>|]/g, "_")
    .trim();

  const anyWindow = window as any;
  if (typeof anyWindow.showSaveFilePicker === "function") {
    try {
      const handle = await anyWindow.showSaveFilePicker({
        suggestedName: `${safeName}_backup.json`,
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

      setBackupFileName(handle.name);
      setShowBackupComplete(true);
      return;
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.warn("save picker failed:", err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeName}_backup.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);

  setBackupFileName(`${safeName}_backup.json`);
  setShowBackupComplete(true);
};

const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const now = Date.now();

    await clearContinuationGameCache();
    
    const buildUniqueListName = (base: string, existingNames: string[]) => {
      const trimmedBase = (base || "復元データ").trim() || "復元データ";
      let nextName = trimmedBase;
      let suffix = 1;

      while (existingNames.includes(nextName)) {
        suffix += 1;
        nextName = `${trimmedBase} (${suffix})`;
      }

      return nextName;
    };

    const isTeamLike = (value: any): value is Team => {
      return (
        value &&
        typeof value === "object" &&
        typeof value.name === "string" &&
        Array.isArray(value.players)
      );
    };

    const isTeamFolderLike = (value: any): value is TeamFolder => {
      return (
        value &&
        typeof value === "object" &&
        typeof value.listName === "string" &&
        isTeamLike(value.team)
      );
    };

    // ① 新形式: 1チームごとバックアップ
    if (data?.type === "single-team-backup" && isTeamFolderLike(data?.folder)) {
      const existingNames = teamStore.teams.map((t) => t.listName.trim());
      const nextName = buildUniqueListName(data.folder.listName, existingNames);

      const newFolder: TeamFolder = {
        ...data.folder,
        id: `team_${now}`,
        listName: nextName,
        createdAt: now,
        updatedAt: now,
      };

      const nextStore: TeamRegisterStore = {
        selectedTeamId: newFolder.id,
        teams: [...teamStore.teams, newFolder],
      };

      await localForage.setItem(TEAM_STORE_KEY, nextStore);
      await localForage.setItem("team", newFolder.team);

      setTeamStore(nextStore);
      setTeam(newFolder.team);
      setTeamListName(newFolder.listName);
      setEditingPlayer({});
      snapshotRef.current = makeSnapshot(newFolder.team, {}, newFolder.listName);
      setIsDirty(false);
      setRestoreMessage(`✅ 「${newFolder.listName}」を復元しました。`);
      return;
    }

    // ② 旧形式: 全チームまとめバックアップ
    if (Array.isArray(data?.teams)) {
      const incomingTeams = data.teams.filter(isTeamFolderLike);

      if (incomingTeams.length === 0) {
        setRestoreMessage("❌ 復元対象のチームが見つかりませんでした。");
        return;
      }

      const usedNames = teamStore.teams.map((t) => t.listName.trim());

      const renamedTeams: TeamFolder[] = incomingTeams.map((folder, index) => {
        const baseName = folder.listName || folder.team?.name || `復元データ${index + 1}`;
        const nextName = buildUniqueListName(baseName, usedNames);
        usedNames.push(nextName);

        return {
          ...folder,
          id: `team_${now}_${index}`,
          listName: nextName,
          createdAt: now,
          updatedAt: now,
        };
      });

      const selectedFolder = renamedTeams[0];

      const nextStore: TeamRegisterStore = {
        selectedTeamId: selectedFolder.id,
        teams: [...teamStore.teams, ...renamedTeams],
      };

      await localForage.setItem(TEAM_STORE_KEY, nextStore);
      await localForage.setItem("team", selectedFolder.team);

      setTeamStore(nextStore);
      setTeam(selectedFolder.team);
      setTeamListName(selectedFolder.listName);
      setEditingPlayer({});
      snapshotRef.current = makeSnapshot(selectedFolder.team, {}, selectedFolder.listName);
      setIsDirty(false);
      setRestoreMessage(`✅ ${renamedTeams.length}件の登録を復元しました。`);
      return;
    }

    // ③ 旧形式: Team単体
    if (isTeamLike(data)) {
      const existingNames = teamStore.teams.map((t) => t.listName.trim());
      const nextName = buildUniqueListName(data.name || "復元データ", existingNames);

      const newFolder: TeamFolder = {
        id: `team_${now}`,
        listName: nextName,
        team: {
          name: data.name ?? "",
          furigana: (data as any).furigana ?? "",
          players: Array.isArray(data.players) ? data.players : [],
        },
        createdAt: now,
        updatedAt: now,
      };

      const nextStore: TeamRegisterStore = {
        selectedTeamId: newFolder.id,
        teams: [...teamStore.teams, newFolder],
      };

      await localForage.setItem(TEAM_STORE_KEY, nextStore);
      await localForage.setItem("team", newFolder.team);

      setTeamStore(nextStore);
      setTeam(newFolder.team);
      setTeamListName(newFolder.listName);
      setEditingPlayer({});
      snapshotRef.current = makeSnapshot(newFolder.team, {}, newFolder.listName);
      setIsDirty(false);
      setRestoreMessage(`✅ 「${newFolder.listName}」を復元しました。`);
      return;
    }

    setRestoreMessage("❌ 読み込みに失敗しました。対応していないバックアップ形式です。");
  } catch (error) {
    console.error("restore error", error);
    setRestoreMessage("❌ 読み込みに失敗しました。ファイル形式を確認してください。");
  } finally {
    e.target.value = "";
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
  const load = async () => {
    const store = await localForage.getItem<TeamRegisterStore>(TEAM_STORE_KEY);

    if (store && store.teams.length > 0) {
      setTeamStore(store);

      const selected =
        store.teams.find((t) => t.id === store.selectedTeamId) ?? store.teams[0];

      if (selected) {
        setTeam(selected.team);
        setTeamListName(selected.listName);
        snapshotRef.current = makeSnapshot(selected.team, {}, selected.listName);
      } else {
        snapshotRef.current = buildEmptySnapshot();
      }
    } else {
      // 旧データ互換
      const oldTeam = await localForage.getItem<Team>("team");

      if (oldTeam) {
        const now = Date.now();
        const migrated: TeamFolder = {
          id: `team_${now}`,
          listName: oldTeam.name || "チーム1",
          team: oldTeam,
          createdAt: now,
          updatedAt: now,
        };

        const nextStore: TeamRegisterStore = {
          selectedTeamId: migrated.id,
          teams: [migrated],
        };

        await localForage.setItem(TEAM_STORE_KEY, nextStore);
        setTeamStore(nextStore);
        setTeam(oldTeam);
        setTeamListName(migrated.listName);
        snapshotRef.current = makeSnapshot(oldTeam, {}, migrated.listName);
      } else {
        snapshotRef.current = buildEmptySnapshot();
      }
    }

    setIsDirty(false);
    initDoneRef.current = true;
  };

  load();
}, []);

useEffect(() => {
  if (!initDoneRef.current) return;
  setIsDirty(buildSnapshot() !== snapshotRef.current);
}, [team, editingPlayer, teamListName]);

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
  const trimmedListName = teamListName.trim();
  const trimmedTeamName = (team.name ?? "").trim();

  if (!trimmedListName) {
    setFormError("一覧に表示する名前を入力してください");
    setShowFormErrorModal(true);
    return;
  }

  if (!trimmedTeamName) {
    setFormError("チーム名を入力してください");
    setShowFormErrorModal(true);
    return;
  }

    const duplicateFolder = teamStore.teams.find(
    (folder) =>
      folder.listName.trim() === trimmedListName &&
      folder.id !== teamStore.selectedTeamId
  );

  if (duplicateFolder) {
    setFormError("同じ登録名がすでにあります");
    setShowFormErrorModal(true);
    return;
  }

  const updatedTeam: Team = {
    ...team,
    name: trimmedTeamName,
    furigana: (team.furigana ?? "").trim(),
    players: [...team.players].sort((a, b) => Number(a.number) - Number(b.number)),
  };

  const now = Date.now();

  const selectedFolder =
    teamStore.teams.find((folder) => folder.id === teamStore.selectedTeamId) ?? null;

  // 追加条件:
  // 1) 新規モード(selectedTeamIdなし)
  // 2) 既存を開いていても、登録名を変更した
  const shouldCreateNew =
    !selectedFolder || selectedFolder.listName.trim() !== trimmedListName;

  let nextStore: TeamRegisterStore;

  if (shouldCreateNew) {
    const newId = `team_${now}`;
    const newFolder: TeamFolder = {
      id: newId,
      listName: trimmedListName,
      team: updatedTeam,
      createdAt: now,
      updatedAt: now,
    };

    nextStore = {
      selectedTeamId: newId,
      teams: [...teamStore.teams, newFolder],
    };
  } else {
    nextStore = {
      ...teamStore,
      teams: teamStore.teams.map((folder) =>
        folder.id === teamStore.selectedTeamId
          ? {
              ...folder,
              listName: trimmedListName,
              team: updatedTeam,
              updatedAt: now,
            }
          : folder
      ),
    };
  }

  await localForage.setItem(TEAM_STORE_KEY, nextStore);
  await localForage.setItem("team", updatedTeam);

  setTeamStore(nextStore);
  setTeam(updatedTeam);
  setTeamListName(trimmedListName);

  snapshotRef.current = makeSnapshot(updatedTeam, {}, trimmedListName);
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
    onClick={() => setShowTeamMenu((prev) => !prev)}
    className="absolute left-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-xl shadow active:scale-95"
    aria-label="登録済みチーム一覧を開く"
  >
    ☰
  </button>

  <button
    type="button"
    onClick={() => setShowHelpModal(true)}
    className="absolute right-0 top-1/2 -translate-y-1/2 inline-flex items-center justify-center w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-white font-bold text-lg shadow active:scale-95"
    aria-label="チーム／選手登録の使い方"
  >
    ？
  </button>

  <div className="mx-auto mt-2 h-0.5 w-24 rounded-full bg-gradient-to-r from-white/60 via-white/30 to-transparent" />

  {showTeamMenu && (
    <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-white/15 bg-slate-900/95 text-left shadow-2xl backdrop-blur">
      <button
        type="button"
        onClick={createNewFolder}
        className="block w-full border-b border-white/10 bg-blue-600 px-4 py-3 text-left text-sm font-bold text-white hover:bg-blue-700"
      >
        ＋ 新しい登録を作る
      </button>

      {teamStore.teams.length === 0 ? (
        <div className="px-4 py-3 text-sm text-white/70">
          登録済みチームはありません
        </div>
      ) : (
        teamStore.teams.map((folder) => {
          const active = folder.id === teamStore.selectedTeamId;
          return (
            <button
              key={folder.id}
              type="button"
              onClick={() => selectFolder(folder.id)}
              className={`block w-full px-4 py-3 text-left text-sm ${
                active ? "bg-white/20 text-white font-bold" : "text-white/90 hover:bg-white/10"
              }`}
            >
              {folder.listName}
            </button>
          );
        })
      )}
    </div>
  )}

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
          <label
            htmlFor="teamListName"
            className="block text-center text-sm font-medium text-white mb-1"
          >
            登録名
          </label>

          <div className="mx-auto flex w-full max-w-[320px] items-center gap-2">
            <input
              id="teamListName"
              type="text"
              value={teamListName}
              onChange={(e) => setTeamListName(e.target.value)}
              placeholder="例：東京サンプルズB"
              className="min-w-0 flex-1 rounded-lg border border-white/20 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-400"
            />

            <button
              type="button"
              onClick={() => setShowDeleteTeamConfirm(true)}
              disabled={!teamStore.selectedTeamId}
              className="shrink-0 rounded-lg border border-red-300 bg-red-500 px-3 py-2 text-sm font-bold text-white shadow-sm hover:bg-red-600 disabled:cursor-not-allowed disabled:border-white/20 disabled:bg-white/20 disabled:text-white/50"
            >
              削除
            </button>
          </div>
        </div>
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
              この画面では、登録名ごとにチーム名と選手を登録できます。
            </p>

            <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-center">
              <div className="text-[11px] font-semibold tracking-[0.02em] text-slate-500">
                使い方はこの順番です
              </div>
              <div className="mt-1 text-[13px] font-bold leading-5 text-rose-500">
                ①登録名・チーム名を入力 → ②選手を追加 → ③保存 → ④必要に応じて切り替え・編集・削除・バックアップ
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
                  登録名・チーム名を登録
                </h3>
                <p className="mt-1.5 text-[13px] font-normal leading-5 text-slate-700">
                  まず「登録名」を入力します。
                </p>
                <p className="mt-1 text-[13px] font-normal leading-5 text-slate-700">
                  登録名は、左上のリストに表示される管理用の名前です。
                  <br />
                  例：
                  <br />
                  ・Aチーム
                  <br />
                  ・Bチーム
                  <br />
                  ・練習試合用
                </p>
                <p className="mt-2 text-[13px] font-normal leading-5 text-slate-700">
                  その下の「チーム名」は実際に表示されるチーム名です。
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

                <div className="mt-2 text-[13px] leading-5 text-slate-700">
                  <p>
                    背番号・選手名・ふりがなを入力して
                    <span className="font-bold text-sky-700">【追加】</span>
                    を押します。
                  </p>
                  <p className="font-bold text-rose-500">→ 選手が登録されます</p>
                </div>

                <p className="mt-2 text-[12.5px] leading-5 text-slate-600">
                  ※ ふりがなはルビ表示と読み上げに使用されます。
                </p>
                <p className="mt-1 text-[12.5px] leading-5 text-slate-600">
                  ※ 女子選手にチェックを入れると、呼び方が「くん」→「さん」になります。
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
                  保存のしかた
                </h3>

                <div className="mt-2 space-y-2 text-[13px] leading-5 text-slate-700">
                  <p>
                    入力が終わったら
                    <span className="font-bold text-sky-700">【保存する】</span>
                    を押します。
                  </p>
                  <p>
                    <span className="font-bold text-slate-900">同じ登録名のまま保存</span>
                    すると、今開いている登録に
                    <span className="font-bold text-rose-500">上書き保存</span>
                    されます。
                  </p>
                  <p>
                    <span className="font-bold text-slate-900">登録名を変更して保存</span>
                    すると、
                    <span className="font-bold text-rose-500">新しい登録として追加</span>
                    されます。
                  </p>
                  <p>
                    <span className="font-bold text-slate-900">同じ登録名がすでにある場合</span>
                    は、その名前では保存できません。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 4 */}
          <div className="rounded-[16px] border border-amber-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white shadow-sm">
                4
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-amber-700">
                  登録後にできること
                </h3>

                <div className="mt-2 space-y-3 text-[13px] leading-5 text-slate-700">
                  <div>
                    <div className="font-bold text-slate-900">【左上リストで切り替え】</div>
                    <p className="mt-1">
                      左上のボタンを押すと、登録済みチームの一覧を開けます。
                      <br />
                      リストの名前を押すと、その登録内容に切り替わります。
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【新しい登録を作る】</div>
                    <p className="mt-1">
                      左上のリストから
                      <span className="font-bold text-sky-700">【新しい登録を作る】</span>
                      を押すと、新しい登録を追加できます。
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【登録を削除】</div>
                    <p className="mt-1">
                      登録名入力欄の右側の
                      <span className="font-bold text-red-600">【削除】</span>
                      を押すと、今開いている登録を削除できます。
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【選手の編集】</div>
                    <p className="mt-1">
                      ① <span className="font-bold text-sky-700">【編集】</span> ボタンを押す
                      <br />
                      ② 内容を変更する
                      <br />
                      ③ <span className="font-bold text-sky-700">【更新】</span> を押す
                      <br />
                      <span className="font-bold text-rose-500">→ 情報が更新されます</span>
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【選手の削除】</div>
                    <p className="mt-1">
                      不要な選手は削除できます。
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【バックアップ】</div>
                    <p className="mt-1">
                      今開いている登録だけをバックアップして保存できます。
                      <br />
                      ほかの登録は含まれません。
                    </p>
                  </div>

                  <div>
                    <div className="font-bold text-slate-900">【復元】</div>
                    <p className="mt-1">
                      バックアップファイルを読み込むと、
                      <span className="font-bold text-rose-500">1チーム分の登録として復元</span>
                      されます。
                      <br />
                      同じ登録名がある場合は、別の登録名で追加されます。
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* 補足 */}
          <div className="rounded-[16px] border border-rose-200 bg-rose-50 px-3 py-3">
            <p className="text-[13px] font-bold leading-5 text-rose-700">
              ※ 登録名は管理用の名前です
            </p>
            <p className="mt-1 text-[13px] leading-5 text-slate-700">
              実際の表示やアナウンスには「チーム名」と「ふりがな」が使われます。
            </p>
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

{/* 登録削除モーダル */}
{showDeleteTeamConfirm && (
  <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 px-4">
    <div className="w-full max-w-sm rounded-2xl bg-white p-5 text-gray-900 shadow-2xl">
      <h3 className="text-lg font-bold text-red-600">登録を削除しますか？</h3>
      <p className="mt-3 text-sm leading-6">
        <span className="font-bold">「{teamListName || "この登録"}」</span>
        を削除します。
        <br />
        この操作は元に戻せません。
      </p>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={() => setShowDeleteTeamConfirm(false)}
          className="flex-1 rounded-xl border border-gray-300 bg-white px-4 py-2 font-semibold text-gray-700"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={confirmDeleteCurrentTeam}
          className="flex-1 rounded-xl bg-red-500 px-4 py-2 font-bold text-white"
        >
          削除する
        </button>
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
