import React from 'react';
import { getLeagueMode } from '../lib/leagueSettings';
import { getActiveCustomProfileId } from '../lib/customProfiles';
import { loadCustomInGameTexts, substituteTokens } from '../lib/customInGameTemplates';

/** 表示専用。読み上げ本文のDOMには混ぜず、音声・履歴には追加しない。 */
export default function CustomInGameMemo({ item, part, parts, vars = {} }: {
  item: string;
  part?: string;
  parts?: string[];
  vars?: Record<string, string>;
}) {
  if (getLeagueMode() !== 'custom') return null;
  const saved = loadCustomInGameTexts(getActiveCustomProfileId())[item];
  const memos = (parts ?? (part ? [part] : [])).map(id =>
    substituteTokens(String(saved?.[`memo:${id}`] ?? ''), vars).trim()
  ).filter(Boolean);
  const unique = [...new Set(memos)];
  if (!unique.length) return null;
  return <div className="mb-2 rounded-md border border-yellow-200 bg-yellow-50 px-3 py-2 text-xs font-medium leading-relaxed text-amber-950 whitespace-pre-wrap" role="note">
    {unique.map((memo, i) => <div key={i} className="flex items-start gap-1"><span aria-hidden="true">⚠️</span><span>{memo}</span></div>)}
  </div>;
}
