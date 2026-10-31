import { downloadFilename } from "./download";
import { kindFromMediaType } from "./library-refs";

export type HistoryGallerySource = {
  id: string;
  status: string;
  mediaType: string | null;
  resultUrl: string | null;
  resultKey?: string | null;
  thumbUrl?: string | null;
  prompt?: string | null;
};

export type HistoryGalleryItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  preview: string;
  key: string;
  url: string;
};

export function historyItemForGallery(item: HistoryGallerySource): HistoryGalleryItem | null {
  const kind = kindFromMediaType(item.mediaType);
  const key = item.resultKey?.trim() ?? "";
  if (!kind || item.status !== "succeeded" || !item.resultUrl || !key) return null;
  return {
    id: item.id,
    kind,
    name: downloadFilename({
      id: item.id,
      mediaType: item.mediaType,
      prompt: item.prompt ?? null,
      resultUrl: item.resultUrl,
    }),
    preview: item.thumbUrl || item.resultUrl,
    key,
    url: item.resultUrl,
  };
}

export function historyItemsForGallery(items: readonly HistoryGallerySource[]): HistoryGalleryItem[] {
  const seen = new Set<string>();
  const out: HistoryGalleryItem[] = [];
  for (const item of items) {
    const draft = historyItemForGallery(item);
    if (!draft || seen.has(draft.key)) continue;
    seen.add(draft.key);
    out.push(draft);
  }
  return out;
}

export type HistoryGalleryNotice =
  | { kind: "added"; count: number; name: string }
  | { kind: "already"; name: string }
  | { kind: "created"; count: number; name: string }
  | { kind: "error"; message: string };

export function historyGalleryNoticeText(notice: HistoryGalleryNotice): string {
  switch (notice.kind) {
    case "added":
      return notice.count === 1 ? `Added 1 to ${notice.name}` : `Added ${notice.count} to ${notice.name}`;
    case "already":
      return `Already in ${notice.name}`;
    case "created":
      return notice.count === 1
        ? `Created ${notice.name} with 1 item`
        : `Created ${notice.name} with ${notice.count} items`;
    case "error":
      return notice.message;
    default: {
      const unreachable: never = notice;
      return unreachable;
    }
  }
}

export type HistoryToggleResult<T> = {
  items: T[];
  added: number;
  removed: number;
  skipped: number;
};

/** Add the missing history items, or remove them when every one is already in the gallery. */
export function toggleHistoryInGallery<T extends { key: string }>(
  current: readonly T[],
  incoming: readonly T[],
  cap: number,
): HistoryToggleResult<T> {
  if (incoming.length === 0) {
    return { items: [...current], added: 0, removed: 0, skipped: 0 };
  }
  const incomingKeys = new Set(incoming.map((item) => item.key));
  const allPresent = incoming.every((item) => current.some((entry) => entry.key === item.key));
  if (allPresent) {
    return {
      items: current.filter((entry) => !incomingKeys.has(entry.key)),
      added: 0,
      removed: incoming.length,
      skipped: 0,
    };
  }
  const next = [...current];
  let added = 0;
  let skipped = 0;
  for (const item of incoming) {
    if (next.some((entry) => entry.key === item.key)) continue;
    if (next.length >= cap) {
      skipped += 1;
      continue;
    }
    next.push(item);
    added += 1;
  }
  return { items: next, added, removed: 0, skipped };
}

export type HistoryAppendResult<T> = {
  items: T[];
  added: number;
  already: number;
  skipped: number;
};

/** Add history items that are not already in the gallery. A drop never removes. */
export function appendHistoryToGallery<T extends { key: string }>(
  current: readonly T[],
  incoming: readonly T[],
  cap: number,
): HistoryAppendResult<T> {
  const next = [...current];
  let added = 0;
  let already = 0;
  let skipped = 0;
  for (const item of incoming) {
    if (next.some((entry) => entry.key === item.key)) {
      already += 1;
      continue;
    }
    if (next.length >= cap) {
      skipped += 1;
      continue;
    }
    next.push(item);
    added += 1;
  }
  return { items: next, added, already, skipped };
}

export function historyKeySelected(
  keys: ReadonlySet<string>,
  items: readonly { resultKey?: string | null }[],
): boolean {
  return items.some((item) => {
    const key = item.resultKey?.trim();
    return Boolean(key && keys.has(key));
  });
}
