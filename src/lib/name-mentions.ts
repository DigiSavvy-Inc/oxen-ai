import { mentionToken } from "./api";
import { parseNameMentions, type NamePromptMention } from "./mentions";
import { normalizeMediaRole, type MediaRole } from "../../worker/schema";

export type NameCatalogItem = {
  key: string;
  kind: "image" | "video" | "audio";
  name: string;
  role?: string | null;
  label?: string | null;
  url?: string | null;
  thumbUrl?: string | null;
};

export type NameCatalogGallery = {
  id: string;
  name: string;
  handle: string;
  take: number;
  items: readonly NameCatalogItem[];
};

export type HandRef = {
  key?: string;
  kind: "image" | "video" | "audio";
  /** Project or hand-attached number. Without one, position within the kind is the number. */
  number?: number;
};

export type ResolvedNameFile = {
  galleryId: string;
  key: string;
  kind: "image" | "video" | "audio";
  name: string;
  role: MediaRole | null;
  url: string | null;
  thumbUrl: string | null;
  /** The mention that first attached this file, such as @Maya or @Loft.wide. */
  token: string;
  number: number;
};

export type NameTrim = { token: string; from: number; to: number };

export type NameHover = {
  start: number;
  token: string;
  name: string;
  kind: "image" | "video" | "audio";
  preview: string;
};

export type NamePlan = {
  files: ResolvedNameFile[];
  /** Hand keys that a name also resolved, so the existing chip can show the handle. */
  marks: { key: string; token: string }[];
  unresolved: NamePromptMention[];
  trimmed: NameTrim[];
  dropped: string[];
  hovers: NameHover[];
  /** Kept names and the tokens they expand to, so another field can use the same numbers. */
  kept: { handle: string; label: string | null; tokens: string[] }[];
  removed: { handle: string; label: string | null }[];
  /** The prompt with each kept name replaced by its @Image tokens. */
  expanded: string;
};

export type NamePickerChoice = {
  token: string;
  handle: string;
  label: string | null;
  title: string;
  kind: "image" | "video" | "audio" | null;
  preview: string;
};

type Kind = "image" | "video" | "audio";

type LiveMention = {
  mention: NamePromptMention;
  gallery: NameCatalogGallery;
  mode: "take" | "label";
  items: NameCatalogItem[];
};

const KINDS: readonly Kind[] = ["image", "video", "audio"];

function sameHandle(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function clampTake(value: number): number {
  if (!Number.isInteger(value)) return 1;
  return Math.min(4, Math.max(1, value));
}

function galleryFor(galleries: readonly NameCatalogGallery[], handle: string): NameCatalogGallery | null {
  return galleries.find((gallery) => gallery.handle && sameHandle(gallery.handle, handle)) ?? null;
}

function itemForLabel(gallery: NameCatalogGallery, label: string): NameCatalogItem | null {
  const key = label.toLowerCase();
  return gallery.items.find((item) => (item.label ?? "").toLowerCase() === key) ?? null;
}

function handKey(item: HandRef): string | null {
  return item.key ? `key:${item.key}` : null;
}

function sentHand(hand: readonly HandRef[], caps: Record<Kind, number>): HandRef[] {
  const counts: Record<Kind, number> = { image: 0, video: 0, audio: 0 };
  const sent: HandRef[] = [];
  for (const item of hand) {
    const cap = Math.max(0, caps[item.kind] ?? 0);
    if (counts[item.kind] >= cap) continue;
    counts[item.kind] += 1;
    sent.push(item);
  }
  return sent;
}

function filesFor(live: LiveMention, takeByHandle: ReadonlyMap<string, number>): NameCatalogItem[] {
  if (live.mode === "label") return live.items;
  const take = takeByHandle.get(live.gallery.handle.toLowerCase()) ?? 1;
  return live.items.slice(0, take);
}

function occupancy(
  lives: readonly LiveMention[],
  takeByHandle: ReadonlyMap<string, number>,
  dropped: ReadonlySet<number>,
  hand: readonly HandRef[],
): Record<Kind, number> {
  const counts: Record<Kind, number> = { image: 0, video: 0, audio: 0 };
  const seen = new Set<string>();
  for (const item of hand) {
    counts[item.kind] += 1;
    const key = handKey(item);
    if (key) seen.add(key);
  }
  for (const live of lives) {
    if (dropped.has(live.mention.start)) continue;
    for (const item of filesFor(live, takeByHandle)) {
      const key = `key:${item.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      counts[item.kind] += 1;
    }
  }
  return counts;
}

function overCap(counts: Record<Kind, number>, caps: Record<Kind, number>): boolean {
  return KINDS.some((kind) => counts[kind] > Math.max(0, caps[kind] ?? 0));
}

function pairKey(handle: string, label: string | null): string {
  return `${handle.toLowerCase()}\n${(label ?? "").toLowerCase()}`;
}

/**
 * Replace name mentions with the @Image tokens they resolved to.
 * A dropped name is removed. A name that matched nothing stays, so the composer can flag it.
 */
export function expandNameText(
  text: string,
  kept: readonly { handle: string; label: string | null; tokens: readonly string[] }[],
  dropped: readonly { handle: string; label: string | null }[],
): string {
  const mentions = parseNameMentions(text);
  if (mentions.length === 0) return text;
  const keptByPair = new Map(kept.map((entry) => [pairKey(entry.handle, entry.label), entry.tokens]));
  const droppedPairs = new Set(dropped.map((entry) => pairKey(entry.handle, entry.label)));
  let next = "";
  let cursor = 0;
  for (const mention of mentions) {
    const key = pairKey(mention.handle, mention.label);
    const tokens = keptByPair.get(key);
    if (!tokens && !droppedPairs.has(key)) continue;
    let start = mention.start;
    let end = mention.end;
    const replacement = tokens && tokens.length > 0 ? tokens.join(" ") : "";
    if (!replacement) {
      if (text[end] === " ") end += 1;
      else if (start > 0 && text[start - 1] === " ") start -= 1;
    }
    next += text.slice(cursor, start) + replacement;
    cursor = end;
  }
  next += text.slice(cursor);
  return next;
}

export function namePlanNotice(plan: Pick<NamePlan, "trimmed" | "dropped">): string | null {
  const parts: string[] = [];
  for (const trim of plan.trimmed) parts.push(`Trimmed ${trim.token} to ${trim.to}`);
  const dropped = [...new Set(plan.dropped)];
  if (dropped.length === 1) parts.push(`Dropped ${dropped[0]}`);
  else if (dropped.length > 1) {
    parts.push(`Dropped ${dropped.slice(0, -1).join(", ")} and ${dropped[dropped.length - 1]}`);
  }
  if (parts.length === 0) return null;
  return `${parts.join(". ")}.`;
}

/**
 * Resolve @Handle and @Handle.label against the profile's galleries.
 * Hand-attached files keep their numbers. Name files are numbered after them,
 * in the order the names first appear. A name used twice attaches once.
 * When the model cannot take every file, take counts shrink from the end of the
 * prompt, and only then are whole names dropped from the end.
 */
export function planNameAttachments(input: {
  prompt: string;
  galleries: readonly NameCatalogGallery[];
  hand: readonly HandRef[];
  caps: Record<Kind, number>;
}): NamePlan {
  const mentions = parseNameMentions(input.prompt);
  const hand = sentHand(input.hand, input.caps);
  const unresolved: NamePromptMention[] = [];
  const lives: LiveMention[] = [];
  for (const mention of mentions) {
    const gallery = galleryFor(input.galleries, mention.handle);
    if (!gallery) {
      unresolved.push(mention);
      continue;
    }
    if (mention.label) {
      const item = itemForLabel(gallery, mention.label);
      if (!item) {
        unresolved.push(mention);
        continue;
      }
      lives.push({ mention, gallery, mode: "label", items: [item] });
      continue;
    }
    if (gallery.items.length === 0) {
      unresolved.push(mention);
      continue;
    }
    lives.push({ mention, gallery, mode: "take", items: [...gallery.items] });
  }

  const takeByHandle = new Map<string, number>();
  for (const live of lives) {
    if (live.mode !== "take") continue;
    const key = live.gallery.handle.toLowerCase();
    if (!takeByHandle.has(key)) takeByHandle.set(key, clampTake(live.gallery.take));
  }
  const initialTake = new Map(takeByHandle);
  const droppedStarts = new Set<number>();
  const dropped: string[] = [];
  let guard = 0;
  while (overCap(occupancy(lives, takeByHandle, droppedStarts, hand), input.caps) && guard < 64) {
    guard += 1;
    let reduced = false;
    for (let index = lives.length - 1; index >= 0; index -= 1) {
      const live = lives[index];
      if (!live || live.mode !== "take" || droppedStarts.has(live.mention.start)) continue;
      const key = live.gallery.handle.toLowerCase();
      const take = takeByHandle.get(key) ?? 1;
      if (take <= 1) continue;
      takeByHandle.set(key, take - 1);
      reduced = true;
      break;
    }
    if (reduced) continue;
    let droppedOne = false;
    for (let index = lives.length - 1; index >= 0; index -= 1) {
      const live = lives[index];
      if (!live || droppedStarts.has(live.mention.start)) continue;
      droppedStarts.add(live.mention.start);
      dropped.push(live.mention.token);
      droppedOne = true;
      break;
    }
    if (!droppedOne) break;
  }

  const trimmed: NameTrim[] = [];
  for (const [key, to] of takeByHandle) {
    const from = initialTake.get(key) ?? to;
    if (to >= from) continue;
    const live = lives.find(
      (entry) =>
        entry.mode === "take" &&
        entry.gallery.handle.toLowerCase() === key &&
        !droppedStarts.has(entry.mention.start),
    );
    if (!live) continue;
    trimmed.push({ token: `@${live.gallery.handle}`, from, to });
  }

  const numbers = new Map<string, number>();
  const next: Record<Kind, number> = { image: 0, video: 0, audio: 0 };
  for (const kind of KINDS) {
    const ofKind = hand.filter((item) => item.kind === kind);
    const explicit = ofKind.flatMap((item) => (item.number != null ? [item.number] : []));
    next[kind] = explicit.length > 0 ? Math.max(...explicit) : ofKind.length;
    ofKind.forEach((item, index) => {
      const key = handKey(item);
      if (!key) return;
      numbers.set(key, item.number ?? index + 1);
    });
  }

  const files: ResolvedNameFile[] = [];
  const marks: { key: string; token: string }[] = [];
  const hovers: NameHover[] = [];
  const keptPairs = new Map<string, { handle: string; label: string | null; tokens: string[] }>();
  const droppedPairs = new Map<string, { handle: string; label: string | null }>();

  for (const live of lives) {
    const pair = pairKey(live.gallery.handle, live.mode === "label" ? live.mention.label : null);
    if (droppedStarts.has(live.mention.start)) {
      if (!keptPairs.has(pair)) {
        droppedPairs.set(pair, {
          handle: live.gallery.handle,
          label: live.mode === "label" ? live.mention.label : null,
        });
      }
      continue;
    }
    const tokens: string[] = [];
    let hover: NameHover | null = null;
    for (const item of filesFor(live, takeByHandle)) {
      const key = `key:${item.key}`;
      let number = numbers.get(key);
      if (number == null) {
        next[item.kind] += 1;
        number = next[item.kind];
        numbers.set(key, number);
        files.push({
          galleryId: live.gallery.id,
          key: item.key,
          kind: item.kind,
          name: item.name,
          role: item.kind === "audio" ? null : normalizeMediaRole(item.role),
          url: item.url ?? null,
          thumbUrl: item.thumbUrl ?? null,
          token: live.mention.token,
          number,
        });
      } else if (hand.some((entry) => entry.key === item.key)) {
        if (!marks.some((mark) => mark.key === item.key)) marks.push({ key: item.key, token: live.mention.token });
      }
      tokens.push(mentionToken(item.kind, number - 1));
      if (!hover) {
        hover = {
          start: live.mention.start,
          token: live.mention.token,
          name: item.name,
          kind: item.kind,
          preview: item.thumbUrl || item.url || "",
        };
      }
    }
    if (hover && hover.preview) hovers.push(hover);
    const existing = keptPairs.get(pair);
    if (existing) {
      if (existing.tokens.length === 0) existing.tokens = tokens;
    } else {
      keptPairs.set(pair, {
        handle: live.gallery.handle,
        label: live.mode === "label" ? live.mention.label : null,
        tokens,
      });
      droppedPairs.delete(pair);
    }
  }

  return {
    files,
    marks,
    unresolved,
    trimmed,
    dropped,
    hovers,
    kept: [...keptPairs.values()],
    removed: [...droppedPairs.values()],
    expanded: expandNameText(input.prompt, [...keptPairs.values()], [...droppedPairs.values()]),
  };
}

/** Drop every occurrence of one name token, such as @Maya, and leave @Maya.wide in place. */
export function removeNameToken(text: string, token: string): string {
  const target = token.toLowerCase();
  const mentions = parseNameMentions(text).filter((mention) => mention.token.toLowerCase() === target);
  if (mentions.length === 0) return text;
  let next = text;
  for (const mention of [...mentions].reverse()) {
    let start = mention.start;
    let end = mention.end;
    if (next[end] === " ") end += 1;
    else if (start > 0 && next[start - 1] === " ") start -= 1;
    next = `${next.slice(0, start)}${next.slice(end)}`;
  }
  return next;
}

/** Gallery ids whose handles appear in the prompt, so their files can be loaded. */
export function mentionedGalleryIds(text: string, galleries: readonly NameCatalogGallery[]): string[] {
  const ids: string[] = [];
  for (const mention of parseNameMentions(text)) {
    const gallery = galleryFor(galleries, mention.handle);
    if (!gallery || ids.includes(gallery.id)) continue;
    ids.push(gallery.id);
  }
  return ids;
}

/** Handles, and after a dot the labels of that gallery. */
export function namePickerChoices(query: string, galleries: readonly NameCatalogGallery[]): NamePickerChoice[] {
  const q = query.toLowerCase();
  const dot = q.indexOf(".");
  const listed = galleries.filter((gallery) => gallery.handle);
  if (dot >= 0) {
    const handleQuery = q.slice(0, dot);
    const labelQuery = q.slice(dot + 1);
    const exact = listed.filter((gallery) => gallery.handle.toLowerCase() === handleQuery);
    const pool = exact.length > 0 ? exact : listed.filter((gallery) => gallery.handle.toLowerCase().startsWith(handleQuery));
    const choices: NamePickerChoice[] = [];
    for (const gallery of pool) {
      for (const item of gallery.items) {
        const label = item.label?.trim() ?? "";
        if (!label) continue;
        if (labelQuery && !label.toLowerCase().startsWith(labelQuery)) continue;
        choices.push({
          token: `@${gallery.handle}.${label}`,
          handle: gallery.handle,
          label,
          title: item.name,
          kind: item.kind,
          preview: item.thumbUrl || item.url || "",
        });
      }
    }
    return choices;
  }
  return listed
    .filter((gallery) => !q || gallery.handle.toLowerCase().includes(q))
    .map((gallery) => {
      const cover = gallery.items[0];
      return {
        token: `@${gallery.handle}`,
        handle: gallery.handle,
        label: null,
        title: gallery.name || gallery.handle,
        kind: cover?.kind ?? null,
        preview: cover?.thumbUrl || cover?.url || "",
      };
    });
}
