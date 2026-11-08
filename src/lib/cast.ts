import { mentionToken, type MediaSlot } from "./api";
import { parsePromptMentions } from "./mentions";
import { normalizeMediaRole, type MediaRole } from "../../worker/schema";

export type CastKind = MediaSlot["kind"];

export type CastGalleryItem = {
  id: string;
  kind: CastKind;
  name: string;
  key: string;
  url: string | null;
  thumbUrl: string | null;
  galleryRole: MediaRole | null;
  roleOverride: MediaRole | null;
  active: boolean;
  excluded: boolean;
};

export type CastGalleryEntry = {
  type: "gallery";
  id: string;
  name: string;
  active: boolean;
  items: CastGalleryItem[];
};

export type CastFileEntry = {
  type: "file";
  id: string;
  kind: CastKind;
  name: string;
  key: string;
  url: string | null;
  thumbUrl: string | null;
  role: MediaRole | null;
  active: boolean;
};

export type CastEntry = CastGalleryEntry | CastFileEntry;

/** One numbered reference. `number` is the project-owned position within its kind. */
export type CastItem = {
  id: string;
  entryId: string;
  source: "gallery" | "file";
  kind: CastKind;
  name: string;
  key: string;
  url: string | null;
  preview: string;
  role: MediaRole | undefined;
  active: boolean;
  number: number;
};

export type CastSelection = {
  attached: CastItem[];
  total: number;
  /** Items the budget left out; the model cap or kind rejection is reported separately. */
  overBudget: number;
  /** Items whose kind the model cannot take, or that sit above the model's slot limit. */
  skipped: CastItem[];
};

export const CAST_BUDGET_DEFAULT = 20;

export function castItemRole(item: Pick<CastGalleryItem, "kind" | "galleryRole" | "roleOverride">): MediaRole | undefined {
  if (item.kind === "audio") return undefined;
  return normalizeMediaRole(item.roleOverride ?? item.galleryRole ?? null);
}

function castItemId(entry: CastEntry, item?: CastGalleryItem): string {
  return item ? `${entry.id}:${item.key}` : entry.id;
}

/**
 * Flatten the cast into numbered references. Numbers run per kind in cast order and
 * count inactive items too, so turning an item off does not move anything else.
 * Excluded gallery items are gone from the cast and take no number.
 */
export function flattenCast(entries: readonly CastEntry[]): CastItem[] {
  const counts: Record<CastKind, number> = { image: 0, video: 0, audio: 0 };
  const items: CastItem[] = [];
  for (const entry of entries) {
    if (entry.type === "file") {
      counts[entry.kind] += 1;
      items.push({
        id: castItemId(entry),
        entryId: entry.id,
        source: "file",
        kind: entry.kind,
        name: entry.name,
        key: entry.key,
        url: entry.url,
        preview: entry.thumbUrl || entry.url || "",
        role: entry.kind === "audio" ? undefined : normalizeMediaRole(entry.role),
        active: entry.active,
        number: counts[entry.kind],
      });
      continue;
    }
    for (const item of entry.items) {
      if (item.excluded) continue;
      counts[item.kind] += 1;
      items.push({
        id: castItemId(entry, item),
        entryId: entry.id,
        source: "gallery",
        kind: item.kind,
        name: item.name,
        key: item.key,
        url: item.url,
        preview: item.thumbUrl || item.url || "",
        role: castItemRole(item),
        active: entry.active && item.active,
        number: counts[item.kind],
      });
    }
  }
  return items;
}

/**
 * Which cast items the composer attaches: active items in cast order, up to the budget,
 * each kind cut at the model's slot limit. A kind the model cannot take is skipped.
 */
export function selectCastAttachments(
  items: readonly CastItem[],
  options: { budget: number; caps: Record<CastKind, number> },
): CastSelection {
  const budget = Math.max(0, Math.floor(options.budget));
  const attached: CastItem[] = [];
  const skipped: CastItem[] = [];
  const perKind: Record<CastKind, number> = { image: 0, video: 0, audio: 0 };
  let overBudget = 0;
  for (const item of items) {
    if (!item.active) continue;
    const cap = options.caps[item.kind] ?? 0;
    if (cap <= 0 || perKind[item.kind] >= cap) {
      skipped.push(item);
      continue;
    }
    if (attached.length >= budget) {
      overBudget += 1;
      continue;
    }
    perKind[item.kind] += 1;
    attached.push(item);
  }
  return { attached, total: items.length, overBudget, skipped };
}

export type CastNumberMap = Record<CastKind, Map<number, number | null>>;

/**
 * Old number → new number for every item that was in the cast before. An item that is
 * gone maps to null so its mentions can be dropped.
 */
export function castNumberMap(before: readonly CastItem[], after: readonly CastItem[]): CastNumberMap {
  const map: CastNumberMap = { image: new Map(), video: new Map(), audio: new Map() };
  const next = new Map(after.map((item) => [item.id, item.number] as const));
  for (const item of before) {
    map[item.kind].set(item.number, next.get(item.id) ?? null);
  }
  return map;
}

export type MentionRewrite = {
  next: string;
  changed: boolean;
  /** Mentions removed because their reference left the cast, in prompt order. */
  dropped: string[];
};

/**
 * Rewrite `@Image7`-style mentions after the cast changed. A mention whose number is
 * not in the map is left as written; a mention of a removed item is cut along with one
 * neighbouring space.
 */
export function rewriteMentions(text: string, map: CastNumberMap): MentionRewrite {
  const mentions = parsePromptMentions(text);
  if (mentions.length === 0) return { next: text, changed: false, dropped: [] };
  let next = "";
  let cursor = 0;
  let changed = false;
  const dropped: string[] = [];
  for (const mention of mentions) {
    const oldNumber = mention.index + 1;
    const kindMap = map[mention.kind];
    if (!kindMap.has(oldNumber)) continue;
    const newNumber = kindMap.get(oldNumber) ?? null;
    if (newNumber === oldNumber) continue;
    changed = true;
    if (newNumber == null) {
      dropped.push(mention.token);
      let start = mention.start;
      let end = mention.end;
      if (text[end] === " ") end += 1;
      else if (start > 0 && text[start - 1] === " ") start -= 1;
      next += text.slice(cursor, start);
      cursor = end;
      continue;
    }
    next += text.slice(cursor, mention.start) + mentionToken(mention.kind, newNumber - 1);
    cursor = mention.end;
  }
  next += text.slice(cursor);
  return { next: changed ? next : text, changed, dropped };
}

/** Human line for a drop notice: "Removed @Image7 from the prompt." */
export function droppedMentionNotice(dropped: readonly string[]): string | null {
  if (dropped.length === 0) return null;
  const unique = [...new Set(dropped)];
  if (unique.length === 1) return `Removed ${unique[0]} from the prompt.`;
  return `Removed ${unique.slice(0, -1).join(", ")} and ${unique[unique.length - 1]} from the prompt.`;
}

/**
 * The first mention in the prompt that points at a reference the model will not get.
 * Attached items carry their project number; without a project, position is the number.
 */
export function missingMention(
  text: string,
  attached: readonly { kind: CastKind; number?: number }[],
): string | null {
  const numbers: Record<CastKind, Set<number>> = {
    image: new Set(),
    video: new Set(),
    audio: new Set(),
  };
  const position: Record<CastKind, number> = { image: 0, video: 0, audio: 0 };
  for (const item of attached) {
    position[item.kind] += 1;
    numbers[item.kind].add(item.number ?? position[item.kind]);
  }
  for (const mention of parsePromptMentions(text)) {
    if (!numbers[mention.kind].has(mention.index + 1)) return mention.token;
  }
  return null;
}

/** Cast entries after dropping one item: a file entry goes, a gallery item is excluded. */
export function castWithoutItem(entries: readonly CastEntry[], item: CastItem): CastEntry[] {
  if (item.source === "file") return entries.filter((entry) => entry.id !== item.entryId);
  return entries.map((entry) => {
    if (entry.type !== "gallery" || entry.id !== item.entryId) return entry;
    return {
      ...entry,
      items: entry.items.map((member) => (member.key === item.key ? { ...member, excluded: true } : member)),
    };
  });
}

export function castWithItemActive(entries: readonly CastEntry[], item: CastItem, active: boolean): CastEntry[] {
  return entries.map((entry) => {
    if (entry.id !== item.entryId) return entry;
    if (entry.type === "file") return { ...entry, active };
    return {
      ...entry,
      items: entry.items.map((member) => (member.key === item.key ? { ...member, active } : member)),
    };
  });
}

export function castWithItemRole(entries: readonly CastEntry[], item: CastItem, role: MediaRole): CastEntry[] {
  return entries.map((entry) => {
    if (entry.id !== item.entryId) return entry;
    if (entry.type === "file") return entry.kind === "audio" ? entry : { ...entry, role };
    return {
      ...entry,
      items: entry.items.map((member) =>
        member.key === item.key && member.kind !== "audio" ? { ...member, roleOverride: role } : member,
      ),
    };
  });
}

export function castWithEntryActive(entries: readonly CastEntry[], entryId: string, active: boolean): CastEntry[] {
  return entries.map((entry) => (entry.id === entryId ? { ...entry, active } : entry));
}

export function castWithoutEntry(entries: readonly CastEntry[], entryId: string): CastEntry[] {
  return entries.filter((entry) => entry.id !== entryId);
}

export function castWithGallery(
  entries: readonly CastEntry[],
  gallery: { id: string; name: string },
): CastEntry[] {
  if (entries.some((entry) => entry.type === "gallery" && entry.id === gallery.id)) return [...entries];
  return [...entries, { type: "gallery", id: gallery.id, name: gallery.name, active: true, items: [] }];
}

export function castWithFiles(
  entries: readonly CastEntry[],
  files: readonly { kind: CastKind; name: string; key: string; url: string | null; role?: MediaRole | null }[],
): CastEntry[] {
  const known = new Set(flattenCast(entries).map((item) => item.key));
  const next = [...entries];
  for (const file of files) {
    if (known.has(file.key)) continue;
    known.add(file.key);
    next.push({
      type: "file",
      id: `new:${file.key}`,
      kind: file.kind,
      name: file.name,
      key: file.key,
      url: file.url,
      thumbUrl: file.kind === "image" ? file.url : null,
      role: file.kind === "audio" ? null : normalizeMediaRole(file.role ?? null),
      active: true,
    });
  }
  return next;
}

/** Move one entry (a gallery group or a loose file) to another index. */
export function castWithEntryMoved(entries: readonly CastEntry[], from: number, to: number): CastEntry[] {
  if (from === to || from < 0 || to < 0 || from >= entries.length || to >= entries.length) return [...entries];
  const next = [...entries];
  const [entry] = next.splice(from, 1);
  if (!entry) return [...entries];
  next.splice(to, 0, entry);
  return next;
}

/** Body for PUT /api/projects/:id. Gallery items only send their per-project state. */
export function castRequestBody(entries: readonly CastEntry[]) {
  return entries.map((entry) =>
    entry.type === "file"
      ? {
          type: "file" as const,
          kind: entry.kind,
          name: entry.name,
          key: entry.key,
          role: entry.role,
          active: entry.active,
        }
      : {
          type: "gallery" as const,
          id: entry.id,
          active: entry.active,
          items: entry.items
            .filter((item) => !item.active || item.excluded || item.roleOverride)
            .map((item) => ({
              key: item.key,
              active: item.active,
              excluded: item.excluded,
              role: item.roleOverride,
            })),
        },
  );
}

export function castSummaryLabel(selection: Pick<CastSelection, "attached" | "total">): string {
  return `${selection.attached.length} of ${selection.total} attached`;
}
