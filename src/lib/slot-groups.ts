export type SlotMediaKind = "image" | "video" | "audio";
export type SlotGroupId = SlotMediaKind | "note" | "empty";
export type SlotListFilter = "all" | SlotMediaKind | "note";

export type SlotGroupSource = {
  note: string;
  files: readonly { kind: SlotMediaKind }[];
};

const MEDIA: readonly SlotMediaKind[] = ["image", "video", "audio"];

function counts(slot: SlotGroupSource): Record<SlotMediaKind, number> {
  const tally: Record<SlotMediaKind, number> = { image: 0, video: 0, audio: 0 };
  for (const file of slot.files) tally[file.kind] += 1;
  return tally;
}

/** Where the slot sits when every type is showing. Mixed files use the kind there is most of. */
export function slotGroup(slot: SlotGroupSource): SlotGroupId {
  const tally = counts(slot);
  const present = MEDIA.filter((kind) => tally[kind] > 0);
  if (present.length === 0) return slot.note.trim() ? "note" : "empty";
  present.sort((a, b) => tally[b] - tally[a]);
  return present[0] ?? "empty";
}

export function slotMatchesFilter(slot: SlotGroupSource, filter: SlotListFilter): boolean {
  if (filter === "all") return true;
  if (filter === "note") return slotGroup(slot) === "note";
  return slot.files.some((file) => file.kind === filter);
}
