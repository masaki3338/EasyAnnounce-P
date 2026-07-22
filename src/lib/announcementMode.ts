import localForage from "localforage";

export type AnnouncementMode =
  | "normal"
  | "single";

const KEY = "announcementMode";

export async function getAnnouncementMode(): Promise<AnnouncementMode> {
  const mode = await localForage.getItem<AnnouncementMode>(KEY);
  return mode ?? "normal";
}

export async function setAnnouncementMode(
  mode: AnnouncementMode
) {
  await localForage.setItem(KEY, mode);
}