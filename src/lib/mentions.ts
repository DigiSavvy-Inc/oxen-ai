import { mentionToken, type MediaSlot } from "./api";

export type MentionItem = {
  name: string;
  kind: MediaSlot["kind"];
};

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
  const token = match[1];
  if (/^(image|video|audio)\d+$/i.test(token)) return null;
  return { start: caret - match[0].length, query: token.toLowerCase() };
}

export function filterMentionItems<T extends MentionItem>(query: string, items: T[]): T[] {
  const q = query.toLowerCase();
  if (!q) return items;
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

export function insertMentionToken(
  text: string,
  caret: number,
  token: string,
): { next: string; caret: number } | null {
  const mention = mentionAtCaret(text, caret);
  if (!mention) return null;
  const inserted = `${token} `;
  const next = `${text.slice(0, mention.start)}${inserted}${text.slice(caret)}`;
  return { next, caret: mention.start + inserted.length };
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
  let end = mention.end;
  if (text[end] === " ") end += 1;
  return {
    next: `${text.slice(0, mention.start)}${text.slice(end)}`,
    caret: mention.start,
  };
}
