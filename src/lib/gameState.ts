export type BattingOrderEntry = {
  id: number;
  reason: string;
};

export type UsedPlayerInfoEntry = {
  fromPos?: string;
  subId?: number;
  reason?: string;
  order?: number;
  wasStarter?: boolean;
  hasReentered?: boolean;
};

export type UsedPlayerInfoMap = Record<number, UsedPlayerInfoEntry>;
export type AssignmentsMap = Record<string, number | null>;

export type CurrentBattingSlot = {
  order: number;
  originalId: number;
  currentId: number;
  reason: string;
};

export type CurrentGameState = {
  battingOrder9: CurrentBattingSlot[];
  fieldByPos: AssignmentsMap;
  onFieldPlayerIds: number[];
};

export type DefensePreviewState = {
  battingOrder: BattingOrderEntry[];
  assignments: AssignmentsMap;
  usedPlayerInfo: UsedPlayerInfoMap;
  onFieldPlayerIds: number[];
};

export const resolveCurrentPlayerId = (
  startId: number,
  used: UsedPlayerInfoMap
): number => {
  const first = used?.[startId];

  if (!first || typeof first.subId !== "number") {
    return startId;
  }

  let cur = first.subId;
  const seen = new Set<number>([startId]);

  while (typeof cur === "number" && !seen.has(cur)) {
    const info = used?.[cur];

    if (!info || typeof info.subId !== "number") break;
    if (info.hasReentered) break;

    const reason = String(info.reason ?? "").trim();
    const isActivePinch =
      reason === "代打" || reason === "代走" || reason === "臨時代走";

    if (!isActivePinch) break;

    seen.add(cur);
    cur = info.subId;
  }

  return cur;
};

export const normalizeFieldAssignments = (
  assignments: AssignmentsMap
): AssignmentsMap => {
  const next: AssignmentsMap = { ...assignments };
  const latestPosByPlayer = new Map<number, string>();

  for (const [pos, rawId] of Object.entries(next)) {
    if (typeof rawId !== "number") continue;

    const playerId = Number(rawId);
    const oldPos = latestPosByPlayer.get(playerId);

    if (oldPos && oldPos !== pos) {
      next[oldPos] = null;
    }

    latestPosByPlayer.set(playerId, pos);
  }

  return next;
};

export const reenterPlayerToPosition = (params: {
  assignments: AssignmentsMap;
  usedPlayerInfo: UsedPlayerInfoMap;
  starterId: number;
  toPos: string;
}): {
  assignments: AssignmentsMap;
  usedPlayerInfo: UsedPlayerInfoMap;
} => {
  const { assignments, usedPlayerInfo, starterId, toPos } = params;

  const nextAssignments: AssignmentsMap = { ...assignments };
  const nextUsed: UsedPlayerInfoMap = { ...usedPlayerInfo };

  for (const pos of Object.keys(nextAssignments)) {
    if (pos !== toPos && Number(nextAssignments[pos]) === Number(starterId)) {
      nextAssignments[pos] = null;
    }
  }

  nextAssignments[toPos] = starterId;

  if (nextUsed[starterId]) {
    nextUsed[starterId] = {
      ...nextUsed[starterId],
      hasReentered: true,
    };
    delete nextUsed[starterId].reason;
    delete nextUsed[starterId].fromPos;
    delete nextUsed[starterId].subId;
  }

  return {
    assignments: normalizeFieldAssignments(nextAssignments),
    usedPlayerInfo: nextUsed,
  };
};

export const deriveDefensePreviewState = (params: {
  battingOrder: BattingOrderEntry[];
  assignments: AssignmentsMap;
  usedPlayerInfo: UsedPlayerInfoMap;
}): DefensePreviewState => {
  const normalizedAssignments = normalizeFieldAssignments(params.assignments);

  const current = deriveCurrentGameState({
    battingOrder: params.battingOrder,
    assignments: normalizedAssignments,
    usedPlayerInfo: params.usedPlayerInfo,
  });

  return {
    battingOrder: [...params.battingOrder],
    assignments: normalizedAssignments,
    usedPlayerInfo: { ...params.usedPlayerInfo },
    onFieldPlayerIds: current.onFieldPlayerIds,
  };
};

export const deriveCurrentGameState = (params: {
  battingOrder: BattingOrderEntry[];
  assignments: AssignmentsMap;
  usedPlayerInfo: UsedPlayerInfoMap;
}): CurrentGameState => {
  const { battingOrder, assignments, usedPlayerInfo } = params;

  const battingOrder9: CurrentBattingSlot[] = (battingOrder ?? []).map((entry, index) => ({
    order: index + 1,
    originalId: entry.id,
    currentId: entry.id,
    reason: entry.reason,
  }));

  const normalizedAssignments = normalizeFieldAssignments(assignments ?? {});
  const fieldByPos: AssignmentsMap = {};

  for (const [pos, pid] of Object.entries(normalizedAssignments)) {
    if (typeof pid !== "number") {
      fieldByPos[pos] = null;
      continue;
    }

    fieldByPos[pos] = resolveCurrentPlayerId(pid, usedPlayerInfo);
  }

  const onFieldPlayerIds = Array.from(
    new Set([
      ...battingOrder9.map((x) => x.currentId),
      ...Object.values(fieldByPos).filter((x): x is number => typeof x === "number"),
    ])
  );

  return {
    battingOrder9,
    fieldByPos,
    onFieldPlayerIds,
  };
};