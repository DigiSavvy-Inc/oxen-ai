/**
 * The composer's attached media, grouped by kind. Plain functions so the grouping,
 * the headings, and the drop arithmetic can be tested without a browser.
 */
export type AttachSectionKind = "image" | "video" | "audio" | "document";

/** Fixed section order. A kind with nothing attached gets no section. */
const ATTACH_SECTION_ORDER: readonly AttachSectionKind[] = ["image", "video", "audio", "document"];

const SECTION_LABELS: Record<AttachSectionKind, string> = {
  image: "Images",
  video: "Videos",
  audio: "Audio",
  document: "Documents",
};

export type AttachSectionEntry<T> = {
  item: T;
  /** Position in the full attachment list, which is what reorder and remove act on. */
  index: number;
};

export type AttachSection<T> = {
  kind: AttachSectionKind;
  label: string;
  entries: AttachSectionEntry<T>[];
  /** The model's limit for this kind, or null when no limit is known. */
  cap: number | null;
  /** The current model takes none of this kind, so the section is dimmed. */
  unused: boolean;
};

/** "10 of 30", or the count alone when the limit is not known. */
export function attachSectionCount(count: number, cap: number | null): string {
  return cap != null && cap > 0 ? `${count} of ${cap}` : String(count);
}

/**
 * Split attachments into sections in the fixed kind order. Entries keep their order
 * and their index in the full list, so numbering and reorder stay as they are.
 */
export function attachSections<T extends { kind: AttachSectionKind }>(
  items: readonly T[],
  caps: Partial<Record<AttachSectionKind, number | null>>,
): AttachSection<T>[] {
  return ATTACH_SECTION_ORDER.flatMap((kind): AttachSection<T>[] => {
    const entries = items.flatMap((item, index) => (item.kind === kind ? [{ item, index }] : []));
    if (entries.length === 0) return [];
    const cap = caps[kind] ?? null;
    return [{ kind, label: SECTION_LABELS[kind], entries, cap, unused: cap === 0 }];
  });
}

/**
 * Where a chip lands in the full list when it is dropped at `position` in its section
 * (0 is before the first chip, `indices.length` is after the last). `indices` are the
 * section's positions in the full list. Other kinds keep their order, so their
 * numbers do not change.
 */
export function sectionMoveTarget(indices: readonly number[], from: number, position: number): number {
  if (indices.length === 0) return from;
  const clamped = Math.max(0, Math.min(position, indices.length));
  // Either side of the chip itself leaves the section's order as it is.
  const at = indices.indexOf(from);
  if (at >= 0 && (clamped === at || clamped === at + 1)) return from;
  const insertBefore = clamped < indices.length ? indices[clamped]! : indices[indices.length - 1]! + 1;
  if (insertBefore === from || insertBefore === from + 1) return from;
  return from < insertBefore ? insertBefore - 1 : insertBefore;
}

/**
 * Whether a drop over a chip goes before it. Chips that fill the row (one column on a
 * phone) split top and bottom; chips side by side split left and right.
 */
export function dropsBefore(
  rect: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
  rowWidth: number,
): boolean {
  if (rowWidth > 0 && rect.width > rowWidth * 0.6) return point.y < rect.top + rect.height / 2;
  return point.x < rect.left + rect.width / 2;
}
