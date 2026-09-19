export const MAX_TAGS_PER_MEDIA = 8;
export const MAX_TAG_LENGTH = 32;

export function parseTag(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const tag = raw.trim().replace(/^#+/, "").replace(/\s+/g, " ");
  if (!tag || tag.length > MAX_TAG_LENGTH) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(tag)) return null;
  return tag;
}

export function parseTagList(raw: unknown): string[] {
  const values = Array.isArray(raw)
    ? raw
    : typeof raw === "string"
      ? raw.split(/[,]/)
      : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const tag = parseTag(value);
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
    if (out.length >= MAX_TAGS_PER_MEDIA) break;
  }
  return out;
}

export function tagQueryNeedle(query: string): string {
  return query.trim().replace(/^#+/, "").toLowerCase();
}

export function collectUniqueTags(tagLists: Array<string[] | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of tagLists) {
    for (const tag of list ?? []) {
      const key = tag.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
  }
  return out;
}

export function suggestTags(allTags: string[], query: string, limit = 8): string[] {
  const needle = tagQueryNeedle(query);
  if (!needle) return [];
  const unique = collectUniqueTags([allTags]);
  const starts: string[] = [];
  const contains: string[] = [];
  for (const tag of unique) {
    const lower = tag.toLowerCase();
    if (lower.startsWith(needle)) starts.push(tag);
    else if (lower.includes(needle)) contains.push(tag);
  }
  return [...starts, ...contains].slice(0, limit);
}

export function tagsMatchQuery(tags: string[] | undefined, query: string): boolean {
  const needle = tagQueryNeedle(query);
  if (!needle) return true;
  return (tags ?? []).some((tag) => tag.toLowerCase().includes(needle));
}
