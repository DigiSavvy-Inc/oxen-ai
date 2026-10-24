import type { MediaKind } from "./files";

export type GroupKind = Exclude<MediaKind, "document">;

export const GROUP_ORDER: GroupKind[] = ["image", "video", "audio"];

const LABELS: Record<GroupKind, string> = { image: "Images", video: "Videos", audio: "Audio" };

export type AttachmentGroup<T> = {
  kind: GroupKind;
  label: string;
  max: number;
  /** False when the selected model takes none of this kind (e.g. after a model switch). */
  supported: boolean;
  /** Items in order, with their index in the flat attachments array. */
  items: { item: T; index: number }[];
  /** Flat index to insert before when dropping at the end of this group. */
  endInsertBefore: number;
};

/**
 * Splits the flat attachment list into Images / Videos / Audio sections.
 * Only kinds with at least one attachment get a section, in a fixed order.
 */
export function groupAttachments<T extends { kind: MediaKind }>(
  attachments: T[],
  caps: Partial<Record<GroupKind, number>>,
): AttachmentGroup<T>[] {
  return GROUP_ORDER.flatMap((kind) => {
    const items = attachments
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.kind === kind);
    if (items.length === 0) return [];
    const max = caps[kind] ?? 0;
    return [
      {
        kind,
        label: LABELS[kind],
        max,
        supported: max > 0,
        items,
        endInsertBefore: items[items.length - 1].index + 1,
      },
    ];
  });
}

export function groupCountLabel(group: Pick<AttachmentGroup<unknown>, "items" | "max" | "supported">): string {
  if (!group.supported) return `${group.items.length} · not used by this model`;
  return `${group.items.length}/${group.max}`;
}
