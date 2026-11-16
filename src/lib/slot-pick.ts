import { acceptSlotType, normalizeMediaRole, SLOT_TYPES, type MediaRole, type SlotType } from "../../worker/schema";

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

/** The short line on a closed slot row: how much is in it, at a glance. */
export function slotRowMeta(slot: PickSlot & { note: string }): string {
  const n = slot.files.length;
  const files = `${n} ${n === 1 ? "file" : "files"}`;
  if (slot.galleryId) return `Whole gallery · ${files}`;
  if (n > 0) return files;
  return slot.note.trim() ? "Text" : "Empty";
}

/**
 * Which slot is open after the list changes. A slot that was just added opens so it can be
 * filled right away; otherwise the open one stays open, unless it is gone.
 */
export function openAfterChange(
  prev: readonly string[] | null,
  next: readonly string[],
  open: string | null,
): string | null {
  if (prev) {
    const added = next.filter((id) => !prev.includes(id));
    if (added.length === 1) return added[0]!;
  }
  return open && next.includes(open) ? open : null;
}

/** The find box appears once the list is long enough to need it. */
export const SLOT_FIND_FROM = 7;

/** Slots whose name or handle contains what was typed. A leading @ and letter case are ignored. */
export function findSlots<T extends { name: string; handle: string }>(slots: readonly T[], query: string): T[] {
  const needle = query.trim().replace(/^@/, "").toLowerCase();
  if (!needle) return [...slots];
  return slots.filter(
    (slot) => slot.name.toLowerCase().includes(needle) || slot.handle.toLowerCase().includes(needle),
  );
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

/** The slots list filter: every slot, or one type. */
export type SlotTypeFilter = SlotType | "all";

export function slotTypeLabel(type: SlotType): string {
  switch (type) {
    case "image":
      return "Image";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "text":
      return "Text";
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

export const SLOT_TYPE_FILTERS: readonly { id: SlotTypeFilter; label: string }[] = [
  { id: "all", label: "All" },
  ...SLOT_TYPES.map((type) => ({ id: type, label: slotTypeLabel(type) })),
];

/** A slot from an older response has no type yet. It reads as text, as the backfill would leave an empty slot. */
export function slotTypeOf(slot: { type?: unknown }): SlotType {
  return acceptSlotType(slot.type) ?? "text";
}

export function acceptSlotTypeFilter(raw: unknown): SlotTypeFilter {
  return raw === "all" ? "all" : (acceptSlotType(raw) ?? "all");
}

/** Slots the filter lets through, in their order. The type is a label only; files are not looked at. */
export function slotsOfType<T extends { type?: unknown }>(slots: readonly T[], filter: SlotTypeFilter): T[] {
  return filter === "all" ? [...slots] : slots.filter((slot) => slotTypeOf(slot) === filter);
}

/** Slots split by stored type in image, audio, video, text order. Types with no slots are left out. */
export function groupSlotsByType<T extends { type?: unknown }>(
  slots: readonly T[],
): { type: SlotType; slots: T[] }[] {
  return SLOT_TYPES.flatMap((type) => {
    const ofType = slots.filter((slot) => slotTypeOf(slot) === type);
    return ofType.length > 0 ? [{ type, slots: ofType }] : [];
  });
}

const SLOT_TYPE_FILTER_KEY = "ds-studio-slot-type";

/** The filter is kept in this browser, like the panel place and the library toggle. */
export function readSlotTypeFilter(): SlotTypeFilter {
  if (typeof window === "undefined") return "all";
  try {
    return acceptSlotTypeFilter(window.localStorage.getItem(SLOT_TYPE_FILTER_KEY));
  } catch {
    return "all";
  }
}

export function storeSlotTypeFilter(filter: SlotTypeFilter) {
  try {
    window.localStorage.setItem(SLOT_TYPE_FILTER_KEY, filter);
  } catch {
    /* storage unavailable */
  }
}
