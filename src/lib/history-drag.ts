export const HISTORY_MEDIA_DRAG_TYPE = "application/x-oxen-history-media";

const TEXT_PREFIX = "oxen-history:";

export function writeHistoryDrag(data: DataTransfer, ids: readonly string[]) {
  const body = JSON.stringify(uniqueIds(ids));
  data.setData(HISTORY_MEDIA_DRAG_TYPE, body);
  data.setData("text/plain", `${TEXT_PREFIX}${body}`);
  data.effectAllowed = "copy";
}

export function fileDragOffered(types: readonly string[]): boolean {
  return Array.from(types).includes("Files");
}

export function historyDragOffered(types: readonly string[]): boolean {
  const list = Array.from(types).map((type) => type.toLowerCase());
  if (list.includes(HISTORY_MEDIA_DRAG_TYPE)) return true;
  if (list.includes("files")) return false;
  if (list.includes("application/x-oxen-gallery-item")) return false;
  // Safari only advertises text/plain while the drag is in flight.
  return list.includes("text/plain");
}

export function readHistoryDrag(data: DataTransfer): string[] {
  const custom = data.getData(HISTORY_MEDIA_DRAG_TYPE);
  if (custom) return parseHistoryIds(custom);
  const text = data.getData("text/plain");
  if (text.startsWith(TEXT_PREFIX)) return parseHistoryIds(text.slice(TEXT_PREFIX.length));
  return [];
}

export function parseHistoryIds(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueIds(parsed.filter((item): item is string => typeof item === "string"));
  } catch {
    return [];
  }
}

function uniqueIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const trimmed = id.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}
