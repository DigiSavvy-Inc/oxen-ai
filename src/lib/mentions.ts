import { mentionToken, type MediaSlot } from "./api";

export type MentionItem = {
  name: string;
  kind: MediaSlot["kind"];
  role?: "character" | "scene";
};

/** Seedance numbers face/character refs before scene refs of the same type. */
export function mentionOrdered<T extends MentionItem>(items: T[], faceFirst: boolean): T[] {
  if (!faceFirst) return items;
  const kinds: MediaSlot["kind"][] = ["image", "video", "audio"];
  const ordered: T[] = [];
  for (const kind of kinds) {
    const ofKind = items.filter((item) => item.kind === kind);
    if (kind === "audio") {
      ordered.push(...ofKind);
      continue;
    }
    ordered.push(
      ...ofKind.filter((item) => item.role !== "scene"),
      ...ofKind.filter((item) => item.role === "scene"),
    );
  }
  return ordered;
}

export type PromptMention = {
  start: number;
  end: number;
  token: string;
  kind: MediaSlot["kind"];
  index: number;
};

export type PromptHighlightPart =
  | { type: "text"; value: string }
  | { type: "mention"; mention: PromptMention };

const MENTION_TOKEN_RE = /@(Image|Video|Audio)(\d+)/gi;

function kindFromToken(raw: string): MediaSlot["kind"] | null {
  const kind = raw.toLowerCase();
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return kind;
    default:
      return null;
  }
}

export function parsePromptMentions(text: string): PromptMention[] {
  const mentions: PromptMention[] = [];
  const pattern = new RegExp(MENTION_TOKEN_RE.source, "gi");
  for (const match of text.matchAll(pattern)) {
    const kind = kindFromToken(match[1] ?? "");
    const n = Number(match[2]);
    if (!kind || !Number.isInteger(n) || n < 1 || match.index == null) continue;
    mentions.push({
      start: match.index,
      end: match.index + match[0].length,
      token: match[0],
      kind,
      index: n - 1,
    });
  }
  return mentions;
}

export function mentionAtOffset(text: string, offset: number): PromptMention | null {
  return (
    parsePromptMentions(text).find((mention) => offset >= mention.start && offset < mention.end) ??
    null
  );
}

export function promptHighlightParts(text: string): PromptHighlightPart[] {
  const mentions = parsePromptMentions(text);
  if (mentions.length === 0) return text ? [{ type: "text", value: text }] : [];
  const parts: PromptHighlightPart[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    if (mention.start > cursor) {
      parts.push({ type: "text", value: text.slice(cursor, mention.start) });
    }
    parts.push({ type: "mention", mention });
    cursor = mention.end;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

export function cycleHotIndex(current: number | null, delta: number, length: number): number {
  if (length <= 0) return 0;
  const from = current ?? (delta > 0 ? -1 : 0);
  return (from + delta + length * 4) % length;
}

export function attachmentForMention<T extends MentionItem>(
  attachments: T[],
  mention: Pick<PromptMention, "kind" | "index">,
): T | null {
  return attachments.filter((item) => item.kind === mention.kind)[mention.index] ?? null;
}

export function mentionAtCaret(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/@([A-Za-z0-9]*)$/);
  if (!match) return null;
  return { start: caret - match[0].length, query: (match[1] ?? "").toLowerCase() };
}

function kindFromQueryPrefix(raw: string | undefined): MediaSlot["kind"] | null {
  if (!raw) return null;
  switch (raw) {
    case "image":
    case "img":
      return "image";
    case "video":
    case "vid":
      return "video";
    case "audio":
    case "aud":
      return "audio";
    default:
      return null;
  }
}

export function filterMentionItems<T extends MentionItem>(query: string, items: T[]): T[] {
  const q = query.toLowerCase();
  if (!q) return items;
  const numbered = q.match(/^(image|img|video|vid|audio|aud)?(\d+)$/);
  if (numbered) {
    const n = Number(numbered[2]);
    const kind = kindFromQueryPrefix(numbered[1]);
    const pool = kind ? items.filter((item) => item.kind === kind) : null;
    if (pool) {
      const hit = pool[n - 1];
      return hit ? [hit] : [];
    }
    const hits: T[] = [];
    for (const fallback of ["image", "video", "audio"] as const) {
      const ofKind = items.filter((item) => item.kind === fallback);
      const hit = ofKind[n - 1];
      if (hit) hits.push(hit);
    }
    return hits;
  }
  if ("image".startsWith(q) || q.startsWith("im")) {
    return items.filter((item) => item.kind === "image");
  }
  if ("video".startsWith(q) || q.startsWith("vid")) {
    return items.filter((item) => item.kind === "video");
  }
  if ("audio".startsWith(q) || q.startsWith("aud")) {
    return items.filter((item) => item.kind === "audio");
  }
  return items.filter(
    (item) => item.kind.includes(q) || item.name.toLowerCase().includes(q),
  );
}

export function tokenForItem<T extends MentionItem>(attachments: T[], item: T, index: number): string {
  const ofKind = attachments.filter((entry) => entry.kind === item.kind);
  const kindIndex = ofKind.findIndex((entry) => entry === item);
  return mentionToken(item.kind, kindIndex >= 0 ? kindIndex : index);
}

/** True when `token` is already a mention, so `@Image1` does not match inside `@Image10`. */
export function promptContainsToken(text: string, token: string): boolean {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^A-Za-z0-9])${escaped}(?!\\d)`).test(text);
}

/**
 * Insert attach tokens at the caret. `caret === null` means the prompt is not
 * focused, so the tokens go at the end. Existing whitespace stays; a separating
 * space is added only where the mention would otherwise stick to a word.
 * The returned caret sits just after the new mention, not at the end of the prompt.
 */
export function insertAttachMentions(
  text: string,
  caret: number | null,
  tokens: string[],
): { next: string; caret: number } {
  const at = caret == null ? text.length : Math.max(0, Math.min(caret, text.length));
  let next = text;
  let cursor = at;
  let inserted = false;
  for (const token of tokens) {
    if (!token || promptContainsToken(next, token)) continue;
    const placed = placeAttachToken(next, cursor, token);
    next = placed.next;
    cursor = placed.caret;
    inserted = true;
  }
  if (!inserted) return { next: text, caret: at };
  return { next, caret: cursor };
}

function placeAttachToken(
  text: string,
  at: number,
  token: string,
): { next: string; caret: number } {
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const boundary = after[0];
  if (boundary == null) {
    const inserted = `${lead}${token} `;
    return { next: `${before}${inserted}`, caret: before.length + inserted.length };
  }
  if (boundary === " " || boundary === "\t") {
    const inserted = `${lead}${token}`;
    return {
      next: `${before}${inserted}${after}`,
      caret: before.length + inserted.length + 1,
    };
  }
  if (boundary === "\n" || boundary === "\r") {
    const inserted = `${lead}${token} `;
    return {
      next: `${before}${inserted}${after}`,
      caret: before.length + inserted.length,
    };
  }
  const inserted = `${lead}${token} `;
  return {
    next: `${before}${inserted}${after}`,
    caret: before.length + inserted.length,
  };
}

export function insertMentionToken(
  text: string,
  caret: number,
  token: string,
): { next: string; caret: number } | null {
  const mention = mentionAtCaret(text, caret);
  if (!mention) return null;
  const after = text.slice(caret);
  // A space closes the @ query. Reuse a space or tab that is already there so
  // newlines and later lines stay put; otherwise insert one space.
  const existingSpace = /^[ \t]/.test(after);
  const inserted = existingSpace ? token : `${token} `;
  const next = `${text.slice(0, mention.start)}${inserted}${after}`;
  return { next, caret: mention.start + inserted.length + (existingSpace ? 1 : 0) };
}

export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (
    from === to ||
    from < 0 ||
    to < 0 ||
    from >= items.length ||
    to >= items.length
  ) {
    return items;
  }
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (!item) return items;
  next.splice(to, 0, item);
  return next;
}

export function indexAfterInsertBefore(from: number, insertBefore: number): number {
  if (insertBefore === from || insertBefore === from + 1) return from;
  return from < insertBefore ? insertBefore - 1 : insertBefore;
}

function mentionNumberStart(mention: PromptMention): number {
  const digits = mention.token.match(/\d+$/);
  return digits ? mention.end - digits[0].length : mention.end;
}

export function deleteMentionToken(
  text: string,
  caret: number,
  direction: "backward" | "forward",
): { next: string; caret: number } | null {
  const mentions = parsePromptMentions(text);
  const mention =
    direction === "backward"
      ? (mentions.find((item) => caret > item.start && caret <= item.end) ??
        (text[caret - 1] === " "
          ? mentions.find((item) => item.end === caret - 1)
          : undefined))
      : mentions.find((item) => caret >= item.start && caret < item.end);
  if (!mention) return null;
  const deletingIndex = direction === "backward" ? caret - 1 : caret;
  if (deletingIndex >= mentionNumberStart(mention) && deletingIndex < mention.end) {
    return null;
  }
  let end = mention.end;
  if (text[end] === " ") end += 1;
  return {
    next: `${text.slice(0, mention.start)}${text.slice(end)}`,
    caret: mention.start,
  };
}
