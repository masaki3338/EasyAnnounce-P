import React, { useEffect,useRef, useState } from "react";
import localForage from "localforage";
import * as wanakana from "wanakana";
import QRCode from "qrcode";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import * as pako from "pako";



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

type QrLineupData = {
  assignments: Record<string, number | null>;
  battingOrder: Array<{ id: number; reason: "スタメン" }>;
  benchOutIds: number[];
  extraBattingSlots: number;
  extraPositionMap: Record<number, string | null>;
  ohtaniRule: boolean;
};

type QrImportData = {
  folder: Omit<TeamFolder, "id" | "createdAt" | "updatedAt">;
  match: {
    tournamentName: string;
    opponentTeam: string;
    opponentTeamFurigana: string;
  };
  lineup: QrLineupData;
};

const QR_PREFIX_V3 = "EA3:";
const QR_PREFIX_V2 = "EA2:"; // 旧QR互換
const QR_PREFIX_V1 = "EA1:"; // 旧QR互換
const QR_POSITION_KEYS = ["投", "捕", "一", "二", "三", "遊", "左", "中", "右", "指"] as const;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};


const BASE45_CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:";
const BASE45_LOOKUP = new Map<string, number>(
  Array.from(BASE45_CHARSET).map((ch, index) => [ch, index])
);

const bytesToBase45 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 2) {
    if (i + 1 < bytes.length) {
      let x = bytes[i] * 256 + bytes[i + 1];
      const e = x % 45;
      x = Math.floor(x / 45);
      const d = x % 45;
      const c = Math.floor(x / 45);
      out += BASE45_CHARSET[e] + BASE45_CHARSET[d] + BASE45_CHARSET[c];
    } else {
      const x = bytes[i];
      const e = x % 45;
      const d = Math.floor(x / 45);
      out += BASE45_CHARSET[e] + BASE45_CHARSET[d];
    }
  }
  return out;
};

const base45ToBytes = (value: string) => {
  const bytes: number[] = [];
  for (let i = 0; i < value.length; ) {
    const remain = value.length - i;
    if (remain >= 3) {
      const c0 = BASE45_LOOKUP.get(value[i]);
      const c1 = BASE45_LOOKUP.get(value[i + 1]);
      const c2 = BASE45_LOOKUP.get(value[i + 2]);
      if (c0 == null || c1 == null || c2 == null) throw new Error("Base45 decode error");
      const x = c0 + c1 * 45 + c2 * 45 * 45;
      if (x > 0xffff) throw new Error("Base45 decode overflow");
      bytes.push(Math.floor(x / 256), x % 256);
      i += 3;
    } else if (remain === 2) {
      const c0 = BASE45_LOOKUP.get(value[i]);
      const c1 = BASE45_LOOKUP.get(value[i + 1]);
      if (c0 == null || c1 == null) throw new Error("Base45 decode error");
      const x = c0 + c1 * 45;
      if (x > 0xff) throw new Error("Base45 decode overflow");
      bytes.push(x);
      i += 2;
    } else {
      throw new Error("Base45 decode length error");
    }
  }
  return new Uint8Array(bytes);
};

const base64UrlToBytes = (value: string) => {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
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
  const [showSwitchTeamConfirm, setShowSwitchTeamConfirm] = useState(false);
  const [showSwitchTeamComplete, setShowSwitchTeamComplete] = useState(false);
  const [pendingSwitchTargetId, setPendingSwitchTargetId] = useState<string | null>(null);
  const [pendingSwitchTargetName, setPendingSwitchTargetName] = useState("");
  const [switchCompletedName, setSwitchCompletedName] = useState("");

  const [restoreMessage, setRestoreMessage] = useState("");
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [showSaveComplete, setShowSaveComplete] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Player | null>(null);
  const [formError, setFormError] = useState("");
  const [showBackupComplete, setShowBackupComplete] = useState(false);
  const [backupFileName, setBackupFileName] = useState("");

  // QR共有 / QR読取
  const [showQrShareModal, setShowQrShareModal] = useState(false);
  const [qrImageUrl, setQrImageUrl] = useState("");
  const [qrShareSummary, setQrShareSummary] = useState("");
  const [qrError, setQrError] = useState("");
  const [showQrScanModal, setShowQrScanModal] = useState(false);
  const [qrScannerError, setQrScannerError] = useState("");
  const [pendingQrImport, setPendingQrImport] = useState<QrImportData | null>(null);
  const [showQrImportConfirm, setShowQrImportConfirm] = useState(false);
  const [showQrImportComplete, setShowQrImportComplete] = useState(false);
  const qrVideoRef = useRef<HTMLVideoElement | null>(null);
  const qrMediaStreamRef = useRef<MediaStream | null>(null);
  const qrZxingControlsRef = useRef<IScannerControls | null>(null);
  const qrNativeTimerRef = useRef<number | null>(null);
  const qrScanHandledRef = useRef(false);
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

  const openSwitchTeamConfirm = (folderId: string) => {
  const folder = teamStore.teams.find((t) => t.id === folderId);
  if (!folder) return;

  if (folder.id === teamStore.selectedTeamId) {
    setShowTeamMenu(false);
    return;
  }

  setPendingSwitchTargetId(folder.id);
  setPendingSwitchTargetName(folder.listName);
  setShowSwitchTeamConfirm(true);
};

const confirmSwitchTeam = async () => {
  if (!pendingSwitchTargetId) return;

  const folder = teamStore.teams.find((t) => t.id === pendingSwitchTargetId);
  if (!folder) return;

  await clearContinuationGameCache();

  const nextStore: TeamRegisterStore = {
    ...teamStore,
    selectedTeamId: folder.id,
  };

  // ✅ 現在選択中チームの実データも同期
  await localForage.setItem(TEAM_STORE_KEY, nextStore);
  await localForage.setItem("team", folder.team);

  setTeamStore(nextStore);
  loadFolderToForm(folder);
  setShowTeamMenu(false);

  setShowSwitchTeamConfirm(false);
  setPendingSwitchTargetId(null);
  setPendingSwitchTargetName("");

  setSwitchCompletedName(folder.listName);
  setShowSwitchTeamComplete(true);
};

  const selectFolder = async (folderId: string) => {
    const folder = teamStore.teams.find((t) => t.id === folderId);
    if (!folder) return;

    await clearContinuationGameCache();

    const nextStore: TeamRegisterStore = {
      ...teamStore,
      selectedTeamId: folder.id,
    };

    // ✅ 現在選択中チームの実データも同期
    await localForage.setItem(TEAM_STORE_KEY, nextStore);
    await localForage.setItem("team", folder.team);

    setTeamStore(nextStore);
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



const getLineupForQr = async (folderId: string): Promise<QrLineupData> => {
  const matchInfo = await localForage.getItem<any>("matchInfo");
  const isSingle = matchInfo?.announcementMode === "single";
  const key = (name: string) => `${name}_${folderId}`;

  const readWithFallback = async <T,>(name: string, fallback: T): Promise<T> => {
    if (isSingle) {
      const teamSpecific = await localForage.getItem<T>(key(name));
      if (teamSpecific != null) return teamSpecific;
    }
    const normal = await localForage.getItem<T>(name);
    return normal ?? fallback;
  };

  return {
    assignments: await readWithFallback<Record<string, number | null>>("startingassignments", {}),
    battingOrder: await readWithFallback<Array<{ id: number; reason: "スタメン" }>>("startingBattingOrder", []),
    benchOutIds: await readWithFallback<number[]>("startingBenchOutIds", []),
    extraBattingSlots: await readWithFallback<number>("startingExtraBattingSlots", 0),
    extraPositionMap: await readWithFallback<Record<number, string | null>>("startingExtraPositionMap", {}),
    ohtaniRule: Boolean(await localForage.getItem<boolean>("ohtaniRule")),
  };
};

const encodeQrShareData = (data: QrImportData) => {
  const players = data.folder.team.players;
  const shortIdByPlayerId = new Map<number, number>();
  players.forEach((p, index) => shortIdByPlayerId.set(p.id, index + 1));

  const sid = (id: number | null | undefined): number => {
    if (typeof id !== "number") return 0;
    return shortIdByPlayerId.get(id) ?? 0;
  };

  // EA3: キー名を完全に無くし、配列位置で意味を持たせる。
  // 文字列自体は削らず、共有内容はEA2と同じ。
  const compact = [
    data.folder.listName,
    data.folder.team.name,
    data.folder.team.furigana,
    players.map((p) => [
      p.lastName,
      p.firstName,
      p.lastNameKana,
      p.firstNameKana,
      p.number,
      p.isFemale ? 1 : 0,
    ]),
    data.match.tournamentName,
    data.match.opponentTeam,
    data.match.opponentTeamFurigana,
    QR_POSITION_KEYS.map((pos) => sid(data.lineup.assignments?.[pos] ?? null)),
    data.lineup.battingOrder.map((x) => sid(x.id)).filter((x) => x > 0),
    data.lineup.benchOutIds.map((id) => sid(id)).filter((x) => x > 0),
    Math.max(0, Number(data.lineup.extraBattingSlots ?? 0)),
    Object.entries(data.lineup.extraPositionMap ?? {})
      .map(([id, pos]) => [sid(Number(id)), pos] as const)
      .filter((pair) => pair[0] > 0 && pair[1] != null),
    data.lineup.ohtaniRule ? 1 : 0,
  ];

  const utf8 = new TextEncoder().encode(JSON.stringify(compact));
  // zlibヘッダー/末尾CRCを省くため raw DEFLATE を使用。
  const compressed = pako.deflateRaw(utf8, { level: 9 });
  // Base45はQRの英数字モードに載せやすく、Base64のByte modeよりQR上で効率が良い。
  return `${QR_PREFIX_V3}${bytesToBase45(compressed)}`;
};

const decodeQrShareDataV3 = (text: string): QrImportData => {
  // Base45の文字集合には半角スペースも含まれるため、内部空白を削除してはいけない。
  const cleaned = text.trim();
  const payload = cleaned.slice(QR_PREFIX_V3.length);

  let raw: any;
  try {
    const inflated = pako.inflateRaw(base45ToBytes(payload));
    const json = new TextDecoder("utf-8", { fatal: false }).decode(inflated);
    raw = JSON.parse(json);
  } catch (error) {
    console.error("EA3 decode error", error);
    throw new Error("QRデータの展開に失敗しました。QRコードをもう一度表示して読み取ってください。");
  }

  if (!Array.isArray(raw) || !Array.isArray(raw[3])) {
    throw new Error("対応していないQRデータです");
  }

  const players: Player[] = raw[3].map((p: any[], index: number) => ({
    id: index + 1,
    lastName: String(p?.[0] ?? ""),
    firstName: String(p?.[1] ?? ""),
    lastNameKana: String(p?.[2] ?? ""),
    firstNameKana: String(p?.[3] ?? ""),
    number: String(p?.[4] ?? ""),
    isFemale: Number(p?.[5] ?? 0) === 1,
  }));

  const assignmentIds = Array.isArray(raw[7]) ? raw[7] : [];
  const assignments: Record<string, number | null> = {};
  QR_POSITION_KEYS.forEach((pos, index) => {
    const value = Number(assignmentIds[index]);
    assignments[pos] = Number.isFinite(value) && value > 0 ? value : null;
  });

  const orderIds = Array.isArray(raw[8]) ? raw[8] : [];
  const benchIds = Array.isArray(raw[9]) ? raw[9] : [];
  const extraPairs = Array.isArray(raw[11]) ? raw[11] : [];
  const extraPositionMap: Record<number, string | null> = {};
  extraPairs.forEach((pair: any[]) => {
    const id = Number(pair?.[0]);
    const pos = pair?.[1];
    if (Number.isFinite(id) && id > 0 && typeof pos === "string") {
      extraPositionMap[id] = pos;
    }
  });

  return {
    folder: {
      listName: String(raw[0] ?? raw[1] ?? "QR受信データ"),
      team: {
        name: String(raw[1] ?? ""),
        furigana: String(raw[2] ?? ""),
        players,
      },
    },
    match: {
      tournamentName: String(raw[4] ?? ""),
      opponentTeam: String(raw[5] ?? ""),
      opponentTeamFurigana: String(raw[6] ?? ""),
    },
    lineup: {
      assignments,
      battingOrder: orderIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id) && id > 0)
        .map((id: number) => ({ id, reason: "スタメン" as const })),
      benchOutIds: benchIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id) && id > 0),
      extraBattingSlots: Math.max(0, Number(raw[10] ?? 0)),
      extraPositionMap,
      ohtaniRule: Number(raw[12] ?? 0) === 1,
    },
  };
};

const inflateQrJsonUtf8 = (payload: string) => {
  // pako の { to: "string" } は端末／バージョン差で日本語UTF-8が崩れることがあるため、
  // Uint8Array のまま展開し、TextDecoder でUTF-8として明示的に文字列化する。
  const inflated = pako.inflate(base64UrlToBytes(payload));
  return new TextDecoder("utf-8", { fatal: false }).decode(inflated);
};

const decodeQrShareDataV2 = (text: string): QrImportData => {
  const cleaned = text.trim().replace(/\s+/g, "");
  const json = inflateQrJsonUtf8(cleaned.slice(QR_PREFIX_V2.length));

  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    console.error("EA2 JSON parse error", {
      error,
      jsonHead: json.slice(0, 80),
      jsonLength: json.length,
    });
    throw new Error("QRデータの展開に失敗しました。QRコードをもう一度表示して読み取ってください。");
  }

  if (!Array.isArray(raw?.f) || !Array.isArray(raw?.f?.[3])) {
    throw new Error("対応していないQRデータです");
  }

  const players: Player[] = raw.f[3].map((p: any[], index: number) => ({
    id: index + 1,
    lastName: String(p?.[0] ?? ""),
    firstName: String(p?.[1] ?? ""),
    lastNameKana: String(p?.[2] ?? ""),
    firstNameKana: String(p?.[3] ?? ""),
    number: String(p?.[4] ?? ""),
    isFemale: Number(p?.[5] ?? 0) === 1,
  }));

  const lineupRaw = Array.isArray(raw.l) ? raw.l : [];
  const assignmentIds = Array.isArray(lineupRaw[0]) ? lineupRaw[0] : [];
  const assignments: Record<string, number | null> = {};
  QR_POSITION_KEYS.forEach((pos, index) => {
    const value = Number(assignmentIds[index]);
    assignments[pos] = Number.isFinite(value) && value > 0 ? value : null;
  });

  const orderIds = Array.isArray(lineupRaw[1]) ? lineupRaw[1] : [];
  const benchIds = Array.isArray(lineupRaw[2]) ? lineupRaw[2] : [];
  const extraPairs = Array.isArray(lineupRaw[4]) ? lineupRaw[4] : [];
  const extraPositionMap: Record<number, string | null> = {};
  extraPairs.forEach((pair: any[]) => {
    const id = Number(pair?.[0]);
    const pos = pair?.[1];
    if (Number.isFinite(id) && id > 0 && typeof pos === "string") {
      extraPositionMap[id] = pos;
    }
  });

  return {
    folder: {
      listName: String(raw.f[0] ?? raw.f[1] ?? "QR受信データ"),
      team: {
        name: String(raw.f[1] ?? ""),
        furigana: String(raw.f[2] ?? ""),
        players,
      },
    },
    match: {
      tournamentName: String(raw?.m?.[0] ?? ""),
      opponentTeam: String(raw?.m?.[1] ?? ""),
      opponentTeamFurigana: String(raw?.m?.[2] ?? ""),
    },
    lineup: {
      assignments,
      battingOrder: orderIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id) && id > 0)
        .map((id: number) => ({ id, reason: "スタメン" as const })),
      benchOutIds: benchIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id) && id > 0),
      extraBattingSlots: Math.max(0, Number(lineupRaw[3] ?? 0)),
      extraPositionMap,
      ohtaniRule: Number(lineupRaw[5] ?? 0) === 1,
    },
  };
};

const decodeQrShareDataV1 = (text: string): QrImportData => {
  const cleaned = text.trim().replace(/\s+/g, "");
  const json = inflateQrJsonUtf8(cleaned.slice(QR_PREFIX_V1.length));

  let raw: any;
  try {
    raw = JSON.parse(json);
  } catch (error) {
    console.error("EA1 JSON parse error", {
      error,
      jsonHead: json.slice(0, 80),
      jsonLength: json.length,
    });
    throw new Error("QRデータの展開に失敗しました。QRコードをもう一度表示して読み取ってください。");
  }
  if (raw?.v !== 1 || raw?.t !== "ea" || !raw?.f || !Array.isArray(raw?.f?.p)) {
    throw new Error("対応していないQRデータです");
  }

  const players: Player[] = raw.f.p.map((p: any[]) => ({
    id: Number(p?.[0]),
    lastName: String(p?.[1] ?? ""),
    firstName: String(p?.[2] ?? ""),
    lastNameKana: String(p?.[3] ?? ""),
    firstNameKana: String(p?.[4] ?? ""),
    number: String(p?.[5] ?? ""),
    isFemale: Number(p?.[6] ?? 0) === 1,
  }));

  const lineupRaw = Array.isArray(raw.l) ? raw.l : [];
  const orderIds = Array.isArray(lineupRaw[1]) ? lineupRaw[1] : [];

  return {
    folder: {
      listName: String(raw.f.n ?? raw.f.m ?? "QR受信データ"),
      team: {
        name: String(raw.f.m ?? ""),
        furigana: String(raw.f.r ?? ""),
        players,
      },
    },
    match: {
      tournamentName: String(raw?.m?.[0] ?? ""),
      opponentTeam: String(raw?.m?.[1] ?? ""),
      opponentTeamFurigana: String(raw?.m?.[2] ?? ""),
    },
    lineup: {
      assignments: lineupRaw[0] && typeof lineupRaw[0] === "object" ? lineupRaw[0] : {},
      battingOrder: orderIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id))
        .map((id: number) => ({ id, reason: "スタメン" as const })),
      benchOutIds: Array.isArray(lineupRaw[2])
        ? lineupRaw[2].map((id: any) => Number(id)).filter((id: number) => Number.isFinite(id))
        : [],
      extraBattingSlots: Math.max(0, Number(lineupRaw[3] ?? 0)),
      extraPositionMap:
        lineupRaw[4] && typeof lineupRaw[4] === "object" ? lineupRaw[4] : {},
      ohtaniRule: Number(lineupRaw[5] ?? 0) === 1,
    },
  };
};

const decodeQrShareData = (text: string): QrImportData => {
  const trimmed = text.trim();
  if (trimmed.startsWith(QR_PREFIX_V3)) return decodeQrShareDataV3(trimmed);

  // EA1/EA2はBase64URLなので、互換用に内部空白を除去してから読む。
  const legacy = trimmed.replace(/\s+/g, "");
  if (legacy.startsWith(QR_PREFIX_V2)) return decodeQrShareDataV2(legacy);
  if (legacy.startsWith(QR_PREFIX_V1)) return decodeQrShareDataV1(legacy);
  throw new Error("EasyアナウンスのQRコードではありません");
};

const remapImportedPlayerIds = (data: QrImportData): QrImportData => {
  const base = Date.now();
  const idMap = new Map<number, number>();
  const players = data.folder.team.players.map((p, index) => {
    const nextId = base + index + 1;
    idMap.set(p.id, nextId);
    return { ...p, id: nextId };
  });

  const mapId = (id: number | null | undefined): number | null => {
    if (typeof id !== "number") return null;
    return idMap.get(id) ?? null;
  };

  const assignments: Record<string, number | null> = {};
  QR_POSITION_KEYS.forEach((pos) => {
    assignments[pos] = mapId(data.lineup.assignments?.[pos] ?? null);
  });

  const extraPositionMap: Record<number, string | null> = {};
  Object.entries(data.lineup.extraPositionMap ?? {}).forEach(([oldId, pos]) => {
    const nextId = mapId(Number(oldId));
    if (nextId != null) extraPositionMap[nextId] = pos;
  });

  return {
    ...data,
    folder: {
      ...data.folder,
      team: { ...data.folder.team, players },
    },
    lineup: {
      ...data.lineup,
      assignments,
      battingOrder: data.lineup.battingOrder
        .map((entry) => mapId(entry.id))
        .filter((id): id is number => id != null)
        .map((id) => ({ id, reason: "スタメン" as const })),
      benchOutIds: data.lineup.benchOutIds
        .map((id) => mapId(id))
        .filter((id): id is number => id != null),
      extraPositionMap,
    },
  };
};

const handleQrShare = async () => {
  setQrError("");
  setQrImageUrl("");
  setQrShareSummary("");

  const selectedFolder =
    teamStore.teams.find((folder) => folder.id === teamStore.selectedTeamId) ?? null;

  if (!selectedFolder) {
    setFormError("QR共有する登録が選択されていません");
    setShowFormErrorModal(true);
    return;
  }

  try {
    const matchInfo = (await localForage.getItem<any>("matchInfo")) ?? {};
    const lineup = await getLineupForQr(selectedFolder.id);

    const shareData: QrImportData = {
      folder: { listName: selectedFolder.listName, team: selectedFolder.team },
      match: {
        tournamentName: String(matchInfo.tournamentName ?? ""),
        opponentTeam: String(matchInfo.opponentTeam ?? ""),
        opponentTeamFurigana: String(matchInfo.opponentTeamFurigana ?? ""),
      },
      lineup,
    };

    const qrText = encodeQrShareData(shareData);
    console.log("[QR EA3] payload chars:", qrText.length);

    // 高密度QRはPNGを縮小すると1マスの境界がにじみやすいため、
    // ベクター形式のSVGで生成する。quiet zone（白い余白）は4モジュール確保。
    const svg = await QRCode.toString(qrText, {
      type: "svg",
      errorCorrectionLevel: "L",
      margin: 4,
      width: 1024,
      color: {
        dark: "#000000",
        light: "#ffffff",
      },
    });

    const image = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

    setQrImageUrl(image);
    setQrShareSummary(
      `${selectedFolder.listName} / 選手${selectedFolder.team.players.length}名` +
        (shareData.match.tournamentName ? ` / ${shareData.match.tournamentName}` : "")
    );
    setShowQrShareModal(true);
  } catch (error) {
    console.error("QR share error", error);
    setQrError(
      "QRコードを作成できませんでした。登録人数や文字数が多すぎる可能性があります。"
    );
    setShowQrShareModal(true);
  }
};

const stopQrScanner = async () => {
  if (qrNativeTimerRef.current != null) {
    window.clearInterval(qrNativeTimerRef.current);
    qrNativeTimerRef.current = null;
  }

  try {
    qrZxingControlsRef.current?.stop();
  } catch {}
  qrZxingControlsRef.current = null;

  const stream = qrMediaStreamRef.current;
  qrMediaStreamRef.current = null;
  if (stream) {
    stream.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
  }

  const video = qrVideoRef.current;
  if (video) {
    try {
      video.pause();
      video.srcObject = null;
    } catch {}
  }
};

const handleDecodedQrText = (decodedText: string) => {
  if (qrScanHandledRef.current) return;

  try {
    const decoded = decodeQrShareData(decodedText);
    qrScanHandledRef.current = true;

    setPendingQrImport(decoded);
    setShowQrImportConfirm(true);
    setShowQrScanModal(false);
    setQrScannerError("");

    window.setTimeout(() => {
      void stopQrScanner();
    }, 0);
  } catch (error: any) {
    qrScanHandledRef.current = false;
    setQrScannerError(error?.message || "QRコードを読み取れませんでした");
  }
};

const startZxingScanner = async () => {
  const video = qrVideoRef.current;
  if (!video || qrScanHandledRef.current) return;

  const reader = new BrowserQRCodeReader(undefined, {
    delayBetweenScanAttempts: 60,
    delayBetweenScanSuccess: 400,
  });

  const constraints: MediaStreamConstraints = {
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    },
  };

  try {
    const controls = await reader.decodeFromConstraints(
      constraints,
      video,
      (result) => {
        if (result && !qrScanHandledRef.current) {
          handleDecodedQrText(result.getText());
        }
      }
    );
    qrZxingControlsRef.current = controls;
  } catch (error) {
    console.error("ZXing camera start error", error);
    throw error;
  }
};

const startNativeBarcodeDetector = async (): Promise<boolean> => {
  const video = qrVideoRef.current;
  if (!video || qrScanHandledRef.current) return false;

  const BarcodeDetectorCtor = (window as any).BarcodeDetector;
  if (!BarcodeDetectorCtor || !navigator.mediaDevices?.getUserMedia) return false;

  try {
    if (typeof BarcodeDetectorCtor.getSupportedFormats === "function") {
      const formats: string[] = await BarcodeDetectorCtor.getSupportedFormats();
      if (!formats.includes("qr_code")) return false;
    }

    const detector = new BarcodeDetectorCtor({ formats: ["qr_code"] });
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    });

    qrMediaStreamRef.current = stream;
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    video.muted = true;
    await video.play();

    let busy = false;
    let elapsed = 0;
    qrNativeTimerRef.current = window.setInterval(async () => {
      if (busy || qrScanHandledRef.current || video.readyState < 2) return;
      busy = true;
      elapsed += 150;
      try {
        const found = await detector.detect(video);
        const raw = found?.[0]?.rawValue;
        if (raw) {
          handleDecodedQrText(String(raw));
          return;
        }
      } catch {}
      finally {
        busy = false;
      }

      // ネイティブ検出で拾えない場合はZXingへ切り替える。
      if (elapsed >= 2500 && !qrScanHandledRef.current) {
        if (qrNativeTimerRef.current != null) {
          window.clearInterval(qrNativeTimerRef.current);
          qrNativeTimerRef.current = null;
        }
        const current = qrMediaStreamRef.current;
        qrMediaStreamRef.current = null;
        current?.getTracks().forEach((track) => {
          try { track.stop(); } catch {}
        });
        try { video.srcObject = null; } catch {}
        try {
          await startZxingScanner();
        } catch {
          setQrScannerError("QR読取カメラを開始できませんでした。カメラの使用を許可して、もう一度お試しください。");
        }
      }
    }, 150);

    return true;
  } catch (error) {
    console.warn("Native BarcodeDetector start failed", error);
    const current = qrMediaStreamRef.current;
    qrMediaStreamRef.current = null;
    current?.getTracks().forEach((track) => {
      try { track.stop(); } catch {}
    });
    try { video.srcObject = null; } catch {}
    return false;
  }
};

useEffect(() => {
  if (!showQrScanModal) return;

  qrScanHandledRef.current = false;
  setQrScannerError("");

  const timer = window.setTimeout(() => {
    void (async () => {
      try {
        const nativeStarted = await startNativeBarcodeDetector();
        if (!nativeStarted) {
          await startZxingScanner();
        }
      } catch (error) {
        console.error("QR scanner start error", error);
        setQrScannerError(
          "QR読取カメラを開始できませんでした。カメラの使用を許可して、もう一度お試しください。"
        );
      }
    })();
  }, 120);

  return () => {
    window.clearTimeout(timer);
    void stopQrScanner();
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [showQrScanModal]);

const handleQrImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;

  setQrScannerError("");
  await stopQrScanner();

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = objectUrl;
    });

    const reader = new BrowserQRCodeReader();
    const result = await reader.decodeFromImageElement(img);
    handleDecodedQrText(result.getText());
  } catch (error) {
    console.error("QR image scan error", error);
    setQrScannerError("画像からQRコードを読み取れませんでした。QRコード全体が写った画像を選んでください。");
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

const importQrData = async () => {
  if (!pendingQrImport) return;

  try {
    const imported = remapImportedPlayerIds(pendingQrImport);
    const now = Date.now();
    const existingNames = teamStore.teams.map((t) => t.listName.trim());
    const baseName = (imported.folder.listName || imported.folder.team.name || "QR受信データ").trim();
    let nextName = baseName || "QR受信データ";
    let suffix = 1;
    while (existingNames.includes(nextName)) {
      suffix += 1;
      nextName = `${baseName} (${suffix})`;
    }

    const newFolder: TeamFolder = {
      id: `team_${now}`,
      listName: nextName,
      team: imported.folder.team,
      createdAt: now,
      updatedAt: now,
    };

    // 進行中データを持ち込まないよう、既存の試合進行キャッシュを先に消す。
    await clearContinuationGameCache();

    const nextStore: TeamRegisterStore = {
      selectedTeamId: newFolder.id,
      teams: [...teamStore.teams, newFolder],
    };

    await localForage.setItem(TEAM_STORE_KEY, nextStore);
    await localForage.setItem("team", newFolder.team);

    const existingMatch = (await localForage.getItem<any>("matchInfo")) ?? {};
    await localForage.setItem("matchInfo", {
      ...existingMatch,
      tournamentName: imported.match.tournamentName,
      opponentTeam: imported.match.opponentTeam,
      opponentTeamFurigana: imported.match.opponentTeamFurigana,
    });

    const l = imported.lineup;
    await Promise.all([
      localForage.setItem("startingassignments", l.assignments),
      localForage.setItem("startingBattingOrder", l.battingOrder),
      localForage.setItem("startingBenchOutIds", l.benchOutIds),
      localForage.setItem("startingExtraBattingSlots", l.extraBattingSlots),
      localForage.setItem("startingExtraPositionMap", l.extraPositionMap),
      localForage.setItem("startingassignments_draft", l.assignments),
      localForage.setItem("startingBattingOrder_draft", l.battingOrder),
      localForage.setItem("startingBenchOutIds_draft", l.benchOutIds),
      localForage.setItem("startingExtraBattingSlots_draft", l.extraBattingSlots),
      localForage.setItem("startingExtraPositionMap_draft", l.extraPositionMap),
      localForage.setItem("lineupAssignments", l.assignments),
      localForage.setItem("battingOrder", l.battingOrder),
      localForage.setItem("ohtaniRule", l.ohtaniRule),

      // 1人アナウンスモードでも、新しい登録IDでそのまま読めるように保存。
      localForage.setItem(`startingassignments_${newFolder.id}`, l.assignments),
      localForage.setItem(`startingBattingOrder_${newFolder.id}`, l.battingOrder),
      localForage.setItem(`startingBenchOutIds_${newFolder.id}`, l.benchOutIds),
      localForage.setItem(`startingExtraBattingSlots_${newFolder.id}`, l.extraBattingSlots),
      localForage.setItem(`startingExtraPositionMap_${newFolder.id}`, l.extraPositionMap),
    ]);

    setTeamStore(nextStore);
    setTeam(newFolder.team);
    setTeamListName(newFolder.listName);
    setEditingPlayer({});
    snapshotRef.current = makeSnapshot(newFolder.team, {}, newFolder.listName);
    setIsDirty(false);
    setShowQrImportConfirm(false);
    setPendingQrImport(null);
    setShowQrImportComplete(true);
  } catch (error) {
    console.error("QR import error", error);
    setShowQrImportConfirm(false);
    setFormError("QRデータの登録に失敗しました");
    setShowFormErrorModal(true);
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
    <>
      {/* 画面のどこでも外側タップで閉じるための透明レイヤー */}
      <button
        type="button"
        aria-label="登録済みチーム一覧を閉じる"
        className="fixed inset-0 z-40 cursor-default bg-transparent"
        onClick={() => setShowTeamMenu(false)}
      />

      {/* 登録リスト本体 */}
      <div
        className="absolute left-0 top-[calc(100%+8px)] z-50 w-64 overflow-hidden rounded-2xl border border-white/15 bg-slate-900/95 text-left shadow-2xl backdrop-blur"
        onClick={(e) => e.stopPropagation()}
      >
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
                onClick={() => openSwitchTeamConfirm(folder.id)}
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
    </>
  )}

</div>

    <div className="grid grid-cols-2 gap-3 justify-center mt-4 mb-2 w-full">
      <button
        type="button"
        onClick={handleQrShare}
        className="inline-flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-3 rounded-xl shadow active:scale-95 font-bold"
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-5 w-5 shrink-0"
        >
          <rect x="3" y="3" width="6" height="6" rx="1" />
          <rect x="15" y="3" width="6" height="6" rx="1" />
          <rect x="3" y="15" width="6" height="6" rx="1" />
          <path d="M15 15h2v2h-2zM19 15h2M19 19h2v2h-2zM15 19v2" />
        </svg>
        <span>QR共有</span>
      </button>

      <button
        type="button"
        onClick={() => setShowQrScanModal(true)}
        className="inline-flex items-center justify-center gap-2 bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-3 rounded-xl shadow active:scale-95 font-bold"
      >
        📷 QR読取
      </button>
    </div>

    <div className="grid grid-cols-2 gap-3 justify-center mb-2 w-full">
      <button
        type="button"
        onClick={handleBackup}
        className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-xl shadow active:scale-95 font-bold"
      >
        💽 バックアップ
      </button>

      <label className="inline-flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-xl shadow active:scale-95 font-bold cursor-pointer">
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
      className="w-full max-w-[min(96vw,900px)] overflow-hidden rounded-[22px] bg-white shadow-[0_20px_60px_rgba(0,0,0,0.35)]"
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
      <div className="max-h-[78svh] overflow-y-auto bg-white px-4 py-4">
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
                ①登録名・チーム名を入力 → ②選手を追加 → ③保存
                <br />
                ④QR共有・QR読取、または必要に応じて切り替え・編集・バックアップ
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
          <div className="rounded-[16px] border border-fuchsia-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-fuchsia-500 text-[12px] font-bold text-white shadow-sm">
                4
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-fuchsia-700">
                  QR共有でほかの端末へ渡す
                </h3>

                <div className="mt-2 space-y-2 text-[13px] leading-5 text-slate-700">
                  <p>
                    共有したい内容を各画面で保存してから、
                    <span className="font-bold text-fuchsia-700">【QR共有】</span>
                    を押します。
                  </p>
                  <p>
                    表示されたQRコードを、データを使いたい相手の端末で読み取ります。
                  </p>
                  <div className="rounded-xl border border-fuchsia-100 bg-fuchsia-50 px-3 py-2">
                    <div className="font-bold text-fuchsia-800">QRで共有される内容</div>
                    <div className="mt-1 text-[12.5px] leading-5 text-slate-700">
                      ・チーム名、ふりがな、登録選手
                      <br />
                      ・大会名
                      <br />
                      ・相手チーム名、ふりがな
                      <br />
                      ・スタメン（打順、守備位置、ベンチ入り／出場しない選手、DH・大谷ルール等）
                    </div>
                  </div>
                  <p className="text-[12.5px] text-slate-600">
                    ※ QR共有は、今選択している登録の<span className="font-bold">保存済みデータ</span>を使用します。
                  </p>
                  <p className="text-[12.5px] text-slate-600">
                    ※ 得点・投球数・現在のイニングなど、試合進行中のデータは共有されません。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 5 */}
          <div className="rounded-[16px] border border-cyan-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-cyan-500 text-[12px] font-bold text-white shadow-sm">
                5
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-cyan-700">
                  QR読取で受け取る
                </h3>

                <div className="mt-2 space-y-2 text-[13px] leading-5 text-slate-700">
                  <p>
                    データを受け取る端末で
                    <span className="font-bold text-cyan-700">【📷 QR読取】</span>
                    を押します。
                  </p>
                  <p>
                    カメラの使用を許可して、相手の端末に表示されているQRコードを枠内に入れます。
                  </p>
                  <p>
                    読み取り後に内容を確認し、
                    <span className="font-bold text-cyan-700">【登録する】</span>
                    を押すと、チーム・試合情報・スタメンがまとめて登録されます。
                  </p>
                  <p className="text-[12.5px] text-slate-600">
                    ※ 同じ登録名がすでにある場合は、上書きせず「(2)」などを付けて新しい登録として追加されます。
                  </p>
                  <p className="text-[12.5px] text-slate-600">
                    ※ 読み取り後は受け取ったチームが現在の登録として選択されます。
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* 6 */}
          <div className="rounded-[16px] border border-amber-200 bg-white px-3 py-3 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[12px] font-bold text-white shadow-sm">
                6
              </div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-extrabold leading-tight text-amber-700">
                  その他の便利な機能
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

{/* 登録切替確認モーダル */}
{showSwitchTeamConfirm && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowSwitchTeamConfirm(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-amber-500 text-white text-center font-bold py-3">
        確認
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          登録を切り替えるとスタメン設定が初期化されます{"\n"}
          「{pendingSwitchTargetName}」に切り替えます
        </p>
      </div>

      <div className="px-5 pb-5">
        <div className="grid grid-cols-2 gap-3">
          <button
            className="w-full py-3 rounded-full bg-gray-300 text-gray-800 font-semibold hover:bg-gray-400 active:bg-gray-500"
            onClick={() => {
              setShowSwitchTeamConfirm(false);
              setPendingSwitchTargetId(null);
              setPendingSwitchTargetName("");
            }}
          >
            キャンセル
          </button>
          <button
            className="w-full py-3 rounded-full bg-amber-500 text-white font-semibold hover:bg-amber-600 active:bg-amber-700"
            onClick={confirmSwitchTeam}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </div>
)}

{/* 登録切替完了モーダル */}
{showSwitchTeamComplete && (
  <div
    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 px-6"
    role="dialog"
    aria-modal="true"
    onClick={() => setShowSwitchTeamComplete(false)}
  >
    <div
      className="w-full max-w-sm rounded-2xl bg-white text-gray-900 shadow-2xl overflow-hidden"
      onClick={(e) => e.stopPropagation()}
      role="document"
    >
      <div className="bg-blue-600 text-white text-center font-bold py-3">
        切り替え完了
      </div>

      <div className="px-6 py-5 text-center">
        <p className="whitespace-pre-line text-[15px] font-bold text-gray-800 leading-relaxed">
          「{switchCompletedName}」に切り替えました。{"\n"}
          保存したあとにスタメン設定を行ってください。
        </p>
      </div>

      <div className="px-5 pb-5">
        <button
          className="w-full py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 active:bg-blue-800"
          onClick={() => setShowSwitchTeamComplete(false)}
        >
          OK
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
{/* QR共有モーダル */}
{showQrShareModal && (
  <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/70 px-4 py-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl">
      <div className="bg-violet-600 px-4 py-3 text-center font-bold text-white">QR共有</div>
      <div className="px-4 py-4 text-center">
        {qrError ? (
          <p className="text-sm font-bold leading-6 text-red-600">{qrError}</p>
        ) : (
          <>
            <p className="mb-3 text-sm font-bold text-gray-800">{qrShareSummary}</p>
            {qrImageUrl && (
              <div className="mx-auto w-full max-w-[390px] bg-white p-2 sm:p-3">
                <img
                  src={qrImageUrl}
                  alt="共有用QRコード"
                  className="block h-auto w-full bg-white"
                  draggable={false}
                  style={{ imageRendering: "pixelated" }}
                />
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-gray-600">
              相手の端末で「QR読取」を押し、QRコード全体と周囲の白い余白が枠内に入るように読み取ってください。
            </p>
          </>
        )}
      </div>
      <div className="px-4 pb-4">
        <button type="button" onClick={() => setShowQrShareModal(false)} className="w-full rounded-full bg-gray-600 py-3 font-bold text-white active:scale-95">閉じる</button>
      </div>
    </div>
  </div>
)}

{/* QR読取モーダル */}
{showQrScanModal && (
  <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 px-3 py-3" role="dialog" aria-modal="true">
    <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl">
      <div className="bg-cyan-600 px-4 py-3 text-center font-bold text-white">QR読取</div>
      <div className="p-3">
        <div className="relative min-h-[360px] w-full overflow-hidden rounded-xl bg-black">
          <video
            ref={qrVideoRef}
            className="h-[360px] w-full object-cover"
            playsInline
            muted
          />
          <div className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-cyan-300/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.18)]" />
        </div>
        <p className="mt-2 text-center text-xs font-semibold text-gray-600">QRコード全体が枠内に入るように、少し離して映してください</p>

        <div className="mt-3">
          <label className="flex w-full cursor-pointer items-center justify-center rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow active:scale-95">
            🖼️ 画像からQRを読み取る
            <input
              type="file"
              accept="image/*"
              onChange={handleQrImageFile}
              className="hidden"
            />
          </label>
        </div>

        {qrScannerError && (
          <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-center text-sm font-bold text-red-600">{qrScannerError}</p>
        )}
      </div>
      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={() => { void stopQrScanner(); setShowQrScanModal(false); }}
          className="w-full rounded-full bg-gray-600 py-3 font-bold text-white active:scale-95"
        >
          キャンセル
        </button>
      </div>
    </div>
  </div>
)}

{/* QR登録確認モーダル */}
{showQrImportConfirm && pendingQrImport && (
  <div className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl">
      <div className="bg-emerald-600 px-4 py-3 text-center font-bold text-white">QRデータを読み取りました</div>
      <div className="space-y-2 px-5 py-5 text-sm leading-6">
        <p><span className="font-bold">登録名：</span>{pendingQrImport.folder.listName}</p>
        <p><span className="font-bold">チーム名：</span>{pendingQrImport.folder.team.name}</p>
        <p><span className="font-bold">選手：</span>{pendingQrImport.folder.team.players.length}名</p>
        <p><span className="font-bold">大会名：</span>{pendingQrImport.match.tournamentName || "未設定"}</p>
        <p><span className="font-bold">相手チーム：</span>{pendingQrImport.match.opponentTeam || "未設定"}</p>
        <p><span className="font-bold">スタメン：</span>{pendingQrImport.lineup.battingOrder.length > 0 ? `${pendingQrImport.lineup.battingOrder.length}名分` : "未設定"}</p>
        <p className="pt-2 text-center font-bold text-gray-800">このデータを登録しますか？</p>
      </div>
      <div className="grid grid-cols-2 gap-3 px-5 pb-5">
        <button
          type="button"
          onClick={() => { setShowQrImportConfirm(false); setPendingQrImport(null); }}
          className="rounded-full bg-gray-400 py-3 font-bold text-white active:scale-95"
        >
          キャンセル
        </button>
        <button type="button" onClick={importQrData} className="rounded-full bg-emerald-600 py-3 font-bold text-white active:scale-95">登録する</button>
      </div>
    </div>
  </div>
)}

{/* QR登録完了モーダル */}
{showQrImportComplete && (
  <div className="fixed inset-0 z-[10030] flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true">
    <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white text-gray-900 shadow-2xl">
      <div className="bg-blue-600 px-4 py-3 text-center font-bold text-white">登録完了</div>
      <div className="px-5 py-6 text-center text-[15px] font-bold leading-7">
        チーム・選手情報、大会名、相手チーム、スタメンを登録しました。
      </div>
      <div className="px-5 pb-5">
        <button type="button" onClick={() => setShowQrImportComplete(false)} className="w-full rounded-full bg-blue-600 py-3 font-bold text-white active:scale-95">OK</button>
      </div>
    </div>
  </div>
)}

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
