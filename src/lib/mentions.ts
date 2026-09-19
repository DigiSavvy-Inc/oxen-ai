import { mentionToken, type MediaSlot } from "./api";

export type MentionItem = {
  name: string;
  kind: MediaSlot["kind"];
};

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
