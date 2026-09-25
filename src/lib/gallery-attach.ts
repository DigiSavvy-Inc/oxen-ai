import type { MediaKind } from "./files";
import { mentionOrdered, promptContainsToken, tokenForItem, type MentionItem } from "./mentions";

export type GalleryAttachItem = MentionItem & {
  key?: string;
  url?: string;
};

export type GalleryAttachPlan<T extends GalleryAttachItem> = {
  add: T[];
  tokens: string[];
  skipped: T[];
};

function mediaIdentity(item: { key?: string; url?: string }): string | null {
  if (item.key) return `key:${item.key}`;
  if (item.url) return `url:${item.url}`;
  return null;
}

/**
 * Decide which gallery items become composer attachments.
 * Items the model cannot take stay out and are listed as skipped.
 * A mention token already in the prompt is not inserted again.
 */
export function planGalleryAttach<T extends GalleryAttachItem>(options: {
  items: T[];
  staged: GalleryAttachItem[];
  caps: Record<MediaKind, number>;
  prompt: string;
  faceFirst: boolean;
}): GalleryAttachPlan<T> {
  const add: T[] = [];
  const tokens: string[] = [];
  const skipped: T[] = [];
  let virtual: GalleryAttachItem[] = [...options.staged];
  let promptText = options.prompt;
  const seen = new Set(options.staged.map(mediaIdentity).filter((id): id is string => Boolean(id)));

  for (const item of options.items) {
    const identity = mediaIdentity(item);
    if (identity && seen.has(identity)) {
      const ordered = mentionOrdered(virtual, options.faceFirst);
      const existing = ordered.find((entry) => mediaIdentity(entry) === identity);
      if (existing) {
        const token = tokenForItem(ordered, existing, 0);
        if (!promptContainsToken(promptText, token)) {
          tokens.push(token);
          promptText = `${promptText} ${token}`;
        }
      }
      continue;
    }
    const cap = options.caps[item.kind];
    const count = virtual.filter((entry) => entry.kind === item.kind).length;
    if (cap <= 0 || count >= cap) {
      skipped.push(item);
      continue;
    }
    const draft: T = {
      ...item,
      role: item.kind === "audio" ? undefined : item.role ?? ("character" as const),
    };
    virtual = [...virtual, draft];
    if (identity) seen.add(identity);
    add.push(draft);
    const ordered = mentionOrdered(virtual, options.faceFirst);
    const token = tokenForItem(ordered, draft, virtual.length - 1);
    if (!promptContainsToken(promptText, token)) {
      tokens.push(token);
      promptText = `${promptText} ${token}`;
    }
  }

  return { add, tokens, skipped };
}
