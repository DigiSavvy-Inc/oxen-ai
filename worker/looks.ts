/** A look is prompt text about how things should feel. It never changes model settings. */

export const LOOK_GROUPS = ["Camera", "Light", "Color", "Era", "Motion", "Other"] as const;
export type LookGroup = (typeof LOOK_GROUPS)[number];

export const LOOK_NAME_MAX = 80;
export const LOOK_BODY_MAX = 2000;
/** A project applies this many looks at most, in chip order. */
export const PROJECT_LOOKS_MAX = 5;

export type Look = {
  id: string;
  name: string;
  body: string;
  group: LookGroup | null;
  starred: boolean;
};

/** Ids and names only. Stored with a generation so the Jobs view can show chips. */
export type AppliedLook = { id: string; name: string };

export function acceptLookGroup(raw: unknown): LookGroup | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return (LOOK_GROUPS as readonly string[]).includes(value) ? (value as LookGroup) : null;
}

export function acceptLookName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > LOOK_NAME_MAX) return null;
  return name;
}

export function acceptLookBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const body = raw.trim();
  if (!body || body.length > LOOK_BODY_MAX) return null;
  return body;
}

/** Trim and end on a sentence mark so joined looks read as sentences. */
export function lookSentence(body: string): string {
  const text = body.trim();
  if (!text) return "";
  return /[.!?…]["'”’)]?$/.test(text) ? text : `${text}.`;
}

/** Unique ids in the order given, capped at the project limit. */
export function cappedLookIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= PROJECT_LOOKS_MAX) break;
  }
  return out;
}

export function acceptLookIds(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  if (!raw.every((item) => typeof item === "string" && item.trim())) return null;
  return cappedLookIds(raw.map((item: string) => item.trim()));
}

/** Toggle one look in the applied set. Adding past the cap leaves the set unchanged. */
export function toggleLookId(ids: readonly string[], id: string): string[] {
  if (ids.includes(id)) return ids.filter((item) => item !== id);
  if (ids.length >= PROJECT_LOOKS_MAX) return [...ids];
  return [...ids, id];
}

/** The looks a project applies, resolved against the profile's collection, in chip order. */
export function appliedLooks<T extends { id: string }>(ids: readonly string[], looks: readonly T[]): T[] {
  return cappedLookIds(ids).flatMap((id) => {
    const look = looks.find((item) => item.id === id);
    return look ? [look] : [];
  });
}

/** One block of sentences, in chip order, that goes ahead of the prompt. */
export function joinLooks(looks: readonly { body: string }[]): string {
  return looks
    .slice(0, PROJECT_LOOKS_MAX)
    .map((look) => lookSentence(look.body))
    .filter(Boolean)
    .join(" ");
}

export function acceptAppliedLooks(raw: unknown): AppliedLook[] {
  if (!Array.isArray(raw)) return [];
  const out: AppliedLook[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; name?: unknown };
    if (typeof record.id !== "string" || !record.id.trim() || record.id.length > 64) continue;
    const name = acceptLookName(record.name);
    if (!name || out.some((item) => item.id === record.id)) continue;
    out.push({ id: record.id.trim(), name });
    if (out.length >= PROJECT_LOOKS_MAX) break;
  }
  return out;
}

/** The looks recorded with a generation, from its stored params. */
export function looksFromParams(paramsJson: string | null | undefined): AppliedLook[] {
  if (!paramsJson) return [];
  try {
    const parsed = JSON.parse(paramsJson) as { studio_looks?: unknown };
    return acceptAppliedLooks(parsed.studio_looks);
  } catch {
    return [];
  }
}

/** Starred first, then by group order, then name. Ungrouped looks come last. */
export function sortLooks<T extends Look>(looks: readonly T[]): T[] {
  const rank = (look: Look) => (look.group ? LOOK_GROUPS.indexOf(look.group) : LOOK_GROUPS.length);
  return [...looks].sort((a, b) => {
    if (a.starred !== b.starred) return a.starred ? -1 : 1;
    const groupDelta = rank(a) - rank(b);
    if (groupDelta !== 0) return groupDelta;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export type LookSection = { label: string; looks: Look[] };

/** Picker sections: a Starred section first, then each group, then looks with no group. */
export function lookSections(looks: readonly Look[], query = ""): LookSection[] {
  const needle = query.trim().toLowerCase();
  const matches = needle
    ? looks.filter(
        (look) =>
          look.name.toLowerCase().includes(needle) ||
          look.body.toLowerCase().includes(needle) ||
          (look.group ?? "").toLowerCase().includes(needle),
      )
    : [...looks];
  const sorted = sortLooks(matches);
  const sections: LookSection[] = [];
  const starred = sorted.filter((look) => look.starred);
  if (starred.length > 0) sections.push({ label: "Starred", looks: starred });
  const rest = sorted.filter((look) => !look.starred);
  for (const group of LOOK_GROUPS) {
    const inGroup = rest.filter((look) => look.group === group);
    if (inGroup.length > 0) sections.push({ label: group, looks: inGroup });
  }
  const ungrouped = rest.filter((look) => !look.group);
  if (ungrouped.length > 0) sections.push({ label: "No group", looks: ungrouped });
  return sections;
}
