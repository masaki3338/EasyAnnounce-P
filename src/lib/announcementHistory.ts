import localForage from "localforage";

export type AnnouncementHistoryItem = {
  id: string;
  createdAt: number;
  category: string;
  displayHtml: string;
  speechText: string;
  inningLabel?: string;
};

const KEY = "easyannounce:announcementHistory";
const MAX_ITEMS = 20;

const stripToSpeech = (html: string): string => {
  if (!html) return "";
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("ruby").forEach((ruby) => {
      const rt = ruby.querySelector("rt")?.textContent?.trim();
      const rb = ruby.querySelector("rb")?.textContent?.trim();
      const base = rb || ruby.childNodes[0]?.textContent?.trim() || "";
      ruby.replaceWith(doc.createTextNode(rt || base));
    });
    doc.querySelectorAll("br").forEach((br) => br.replaceWith(doc.createTextNode("\n")));
    return (doc.body.textContent || "").replace(/[ \t\u3000]+/g, " ").replace(/\s*\n\s*/g, "\n").trim();
  } catch {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
};

export const plainTextToHistoryHtml = (text: string) =>
  String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");

export async function getAnnouncementHistory(): Promise<AnnouncementHistoryItem[]> {
  const list = await localForage.getItem<AnnouncementHistoryItem[]>(KEY);
  return Array.isArray(list) ? list : [];
}

export async function addAnnouncementHistory(input: {
  category: string;
  displayHtml?: string;
  displayText?: string;
  speechText?: string;
  inningLabel?: string;
}): Promise<void> {
  const displayHtml = (input.displayHtml || plainTextToHistoryHtml(input.displayText || "")).trim();
  if (!displayHtml) return;
  const speechText = (input.speechText || stripToSpeech(displayHtml)).trim();
  if (!speechText) return;

  let inningLabel = String(input.inningLabel || "").trim();
  if (!inningLabel) {
    const matchInfo = await localForage.getItem<any>("matchInfo");
    const inning = Number(matchInfo?.inning);
    if (Number.isFinite(inning) && inning > 0 && typeof matchInfo?.isTop === "boolean") {
      inningLabel = `${inning}回${matchInfo.isTop ? "表" : "裏"}`;
    }
  }

  let list = await getAnnouncementHistory();

  // 投球数・得点履歴は、それぞれ常に最新1件だけ保持する。
  // 新しい履歴を保存する前に、同じカテゴリの過去履歴だけ削除する。
  if (input.category === "投球数" || input.category === "得点") {
    list = list.filter((entry) => entry.category !== input.category);
  }

  const latest = list[0];
  // 同じモーダルの再描画で同一文が重複登録されるのを防ぐ。
  if (latest && latest.category === input.category && latest.speechText === speechText) return;

  const item: AnnouncementHistoryItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
    category: input.category,
    displayHtml,
    speechText,
    inningLabel: inningLabel || undefined,
  };
  await localForage.setItem(KEY, [item, ...list].slice(0, MAX_ITEMS));
  window.dispatchEvent(new Event("easyannounce:announcement-history-changed"));
}

export async function clearAnnouncementHistory(): Promise<void> {
  await localForage.setItem(KEY, []);
  window.dispatchEvent(new Event("easyannounce:announcement-history-changed"));
}
