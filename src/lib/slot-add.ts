import type { MediaRole } from "../../worker/schema";
import type { SlotFileInput, StudioSlot } from "./api";

/** Matches SLOT_FILES_MAX in worker/slots.ts. */
export const SLOT_FILE_CAP = 12;

/** A finished file from the library or a gallery, ready to go into a slot. */
export type SlotAddItem = {
  key: string;
  kind: "image" | "video" | "audio";
  name: string;
  role?: MediaRole | null;
  label?: string | null;
};

export type SlotChoice = {
  id: string;
  name: string;
  /** Set when the slot reads its files from a gallery and takes none of its own. */
  disabledReason: string | null;
};

/** Slots usable right now: the open project's slots first, then Everywhere slots. */
export function slotChoices(slots: readonly StudioSlot[], projectId: string | null): SlotChoice[] {
  const project = projectId ? slots.filter((slot) => slot.projectId === projectId) : [];
  const everywhere = slots.filter((slot) => slot.projectId == null);
  return [...project, ...everywhere].map((slot) => ({
    id: slot.id,
    name: slot.name,
    disabledReason: slot.galleryId && slot.galleryName ? `Uses ${slot.galleryName}` : null,
  }));
}

/** What the server append takes, in selection order, each key once. Files with no stored copy wait. */
export function slotFilesFromItems(items: readonly SlotAddItem[]): SlotFileInput[] {
  const seen = new Set<string>();
  const out: SlotFileInput[] = [];
  for (const item of items) {
    const key = item.key.trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      kind: item.kind,
      name: item.name,
      key,
      label: item.label || null,
      role: item.kind === "audio" ? null : (item.role ?? "character"),
    });
  }
  return out;
}

export type SlotAddNotice =
  | { kind: "added"; name: string; added: number; already: number; full: number; created?: boolean }
  | { kind: "error"; message: string };

function files(count: number): string {
  return count === 1 ? "1 file" : `${count} files`;
}

export function slotAddNoticeText(notice: SlotAddNotice): string {
  if (notice.kind === "error") return notice.message;
  const { name, added, already, full } = notice;
  const parts: string[] = [];
  if (notice.created) parts.push(`Created ${name} with ${files(added)}.`);
  else if (added > 0) parts.push(`Added ${files(added)} to ${name}.`);
  else if (full > 0) parts.push(`Nothing added. ${name} is full.`);
  else parts.push(`Already in ${name}.`);
  if (full > 0) {
    parts.push(`${full} did not fit. A slot holds ${SLOT_FILE_CAP} files.`);
  }
  if (already > 0 && (added > 0 || full > 0)) {
    parts.push(`${already} ${already === 1 ? "was" : "were"} already in.`);
  }
  return parts.join(" ");
}

/** The short mark on the slot row that was just chosen. */
export function slotRowMark(notice: SlotAddNotice): string | null {
  if (notice.kind === "error") return null;
  if (notice.added > 0) return notice.full > 0 ? `Added ${notice.added}` : "Added";
  if (notice.full > 0) return "Full";
  return "Already in";
}
