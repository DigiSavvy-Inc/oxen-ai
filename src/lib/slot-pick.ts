import { normalizeMediaRole, type MediaRole } from "../../worker/schema";

/** Matches SLOT_FILES_MAX in worker/slots.ts. */
export const SLOT_PICK_MAX = 12;

export type PickItem = {
  kind: "image" | "video" | "audio";
  name: string;
  key: string;
  role?: string | null;
  label?: string | null;
};

export type PickSlot = {
  galleryId: string | null;
  files: readonly PickItem[];
};

export type PickFile = {
  kind: "image" | "video" | "audio";
  name: string;
  key: string;
  label: string | null;
  role: MediaRole | null;
};

/**
 * Files that stay in the slot while picking. A slot linked to a whole gallery keeps none of
 * its gallery files: picking replaces them.
 */
export function keptFiles(slot: PickSlot): readonly PickItem[] {
  return slot.galleryId ? [] : slot.files;
}

/** Keys of gallery items already in the slot's own files. They show as added and can't be ticked. */
export function inSlotKeys(slot: PickSlot): Set<string> {
  return new Set(keptFiles(slot).map((file) => file.key));
}

/** How many more files fit after the kept files and the current ticks. */
export function pickRoom(slot: PickSlot, picked: ReadonlySet<string>): number {
  return Math.max(0, SLOT_PICK_MAX - keptFiles(slot).length - picked.size);
}

/** The count shown while picking, "3 of 12". */
export function pickCount(slot: PickSlot, picked: ReadonlySet<string>): { used: number; max: number } {
  return { used: keptFiles(slot).length + picked.size, max: SLOT_PICK_MAX };
}

/** Why an unticked item can't be ticked, or null when it can. */
export function pickBlocked(slot: PickSlot, picked: ReadonlySet<string>, key: string): string | null {
  if (picked.has(key)) return null;
  if (inSlotKeys(slot).has(key)) return "Already in this slot.";
  if (pickRoom(slot, picked) > 0) return null;
  return `A slot holds ${SLOT_PICK_MAX} files.`;
}

/** Tick or untick one item. A tick past the limit, or on a file already in the slot, does nothing. */
export function togglePick(slot: PickSlot, picked: ReadonlySet<string>, key: string): Set<string> {
  const next = new Set(picked);
  if (next.has(key)) {
    next.delete(key);
    return next;
  }
  if (pickBlocked(slot, picked, key)) return next;
  next.add(key);
  return next;
}

/** Select all ticks items in gallery order until the slot is full, keeping existing ticks. */
export function pickAll(slot: PickSlot, items: readonly PickItem[], picked: ReadonlySet<string>): Set<string> {
  const next = new Set(picked);
  const skip = inSlotKeys(slot);
  for (const item of items) {
    if (pickRoom(slot, next) === 0) break;
    if (skip.has(item.key)) continue;
    next.add(item.key);
  }
  return next;
}

function asFile(item: PickItem): PickFile {
  return {
    kind: item.kind,
    name: item.name,
    key: item.key,
    label: item.label?.trim() ? item.label.trim() : null,
    role: item.kind === "audio" ? null : normalizeMediaRole(item.role ?? null),
  };
}

/**
 * The slot's files after "Add selected" or "Use only these": kept files first, then the ticked
 * items in gallery order with their roles. Keys already present are skipped, a label that would
 * clash with one already in the slot is dropped, and the list stops at the limit.
 */
export function pickedFiles(slot: PickSlot, items: readonly PickItem[], picked: ReadonlySet<string>): PickFile[] {
  const files = keptFiles(slot).map(asFile);
  const keys = new Set(files.map((file) => file.key));
  const labels = new Set(files.flatMap((file) => (file.label ? [file.label.toLowerCase()] : [])));
  for (const item of items) {
    if (files.length >= SLOT_PICK_MAX) break;
    if (!picked.has(item.key) || keys.has(item.key)) continue;
    const file = asFile(item);
    if (file.label) {
      const mark = file.label.toLowerCase();
      if (labels.has(mark)) file.label = null;
      else labels.add(mark);
    }
    keys.add(file.key);
    files.push(file);
  }
  return files;
}

/** What the card says about where its files come from. */
export function slotSource(slot: PickSlot & { galleryName: string | null; note: string }): string {
  if (slot.galleryId) {
    const n = slot.files.length;
    return `Whole gallery: ${slot.galleryName ?? "a gallery"} (${n} ${n === 1 ? "item" : "items"})`;
  }
  if (slot.files.length > 0) return `Own files: ${slot.files.length} of ${SLOT_PICK_MAX}`;
  if (slot.note.trim()) return "Text slot: the handle writes its note. No files.";
  return "Empty. Add files or a note.";
}
