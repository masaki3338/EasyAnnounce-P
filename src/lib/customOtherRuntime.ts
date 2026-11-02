import { getLeagueMode } from './leagueSettings';
import { getActiveCustomProfileId } from './customProfiles';
import { loadCustomInGameTexts, substituteTokens } from './customInGameTemplates';

/** カスタマイズ以外には影響しない。空の文章はユーザーが意図して消したものとして尊重。 */
export function getCustomOtherText(item: string,part: string,vars:Record<string,string>={}):string|null {
  if(getLeagueMode()!=='custom')return null;
  const text=loadCustomInGameTexts(getActiveCustomProfileId())?.[item]?.[part];
  return typeof text==='string'?substituteTokens(text,vars):null;
}
