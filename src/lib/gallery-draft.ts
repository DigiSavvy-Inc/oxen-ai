import type { MediaRole } from "../../worker/schema";

export type GalleryDraftItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  preview: string;
  key: string;
  url: string;
  role?: MediaRole;
  label?: string;
};

/**
 * A save writes fresh row ids. When the saved list is the list that was sent, keep the ids the
 * panel already shows, so a selection and the tiles themselves survive the save.
 */
export function keepDraftIds<T extends { id: string; key: string }>(
  sent: readonly { id: string; key: string }[],
  saved: readonly T[],
): T[] {
  const same =
    sent.length === saved.length && saved.every((item, index) => item.key === sent[index]?.key);
  if (!same) return [...saved];
  return saved.map((item, index) => ({ ...item, id: sent[index]?.id ?? item.id }));
}
