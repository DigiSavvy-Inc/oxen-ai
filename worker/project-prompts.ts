/**
 * Project prompts (#88): named prompt text kept with one project. An Every scene prompt is on
 * for each new job in the project; an On request prompt stays off until it is picked. For one
 * job the person can switch any of them on or off without changing the project.
 *
 * On prompts go after the looks and ahead of the scene text, joined in list order. Like looks,
 * they never appear as text in the composer box and are recorded per run as `studio_prompts`.
 *
 * This module has no bindings so the client can share the types and the pure helpers.
 * Storage is in worker/project-prompt-store.ts.
 */

/** Same limit as an account saved prompt's name (SAVED_PROMPT_NAME_MAX). */
export const PROJECT_PROMPT_NAME_MAX = 80;
/** The project brief prompt's limit too; worker/projects.ts re-exports it from here. */
export const PROJECT_PROMPT_MAX = 8000;
/** A project keeps this many prompts at most. */
export const PROJECT_PROMPTS_MAX = 50;
const PROMPT_ID_MAX = 64;

export type ProjectPrompt = {
  id: string;
  name: string;
  body: string;
  /** True: on for every new job. False: on request only. */
  everyScene: boolean;
  position: number;
};

/** Ids and names only. Stored with a generation so the Jobs view can show chips. */
export type AppliedPrompt = { id: string; name: string };

export function acceptProjectPromptName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  if (!name || name.length > PROJECT_PROMPT_NAME_MAX) return null;
  return name;
}

/** Keep the text exactly, including mention tokens, like a saved prompt. Reject blank text. */
export function acceptProjectPromptBody(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (!raw.trim()) return null;
  if (raw.length > PROJECT_PROMPT_MAX) return null;
  return raw;
}

export function acceptEveryScene(raw: unknown): boolean | null {
  if (raw === true || raw === 1) return true;
  if (raw === false || raw === 0) return false;
  return null;
}

/** True while the project has room for one more prompt. */
export function canAddProjectPrompt(count: number): boolean {
  return count < PROJECT_PROMPTS_MAX;
}

function acceptPromptId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > PROMPT_ID_MAX) return null;
  return id;
}

/** Unique ids in the order given, capped at the project limit. Null when the value is not a list. */
export function acceptPromptIds(raw: unknown): string[] | null {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const entry of raw) {
    const id = acceptPromptId(entry);
    if (!id || out.includes(id)) continue;
    out.push(id);
    if (out.length >= PROJECT_PROMPTS_MAX) break;
  }
  return out;
}

/** The project's prompts in list order. */
export function sortProjectPrompts<T extends { position: number; name: string }>(prompts: readonly T[]): T[] {
  return [...prompts].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}

/** What a new job starts with: the Every scene prompts, in list order. */
export function everyScenePromptIds(prompts: readonly ProjectPrompt[]): string[] {
  return sortProjectPrompts(prompts)
    .filter((prompt) => prompt.everyScene)
    .map((prompt) => prompt.id);
}

/**
 * The on set kept to prompts the project still has, in list order. A prompt deleted from the
 * project drops out. Null (a draft saved before project prompts) reads as the Every scene set.
 */
export function livePromptIds(ids: readonly string[] | null | undefined, prompts: readonly ProjectPrompt[]): string[] {
  if (ids == null) return everyScenePromptIds(prompts);
  const wanted = new Set(ids);
  return sortProjectPrompts(prompts)
    .filter((prompt) => wanted.has(prompt.id))
    .map((prompt) => prompt.id);
}

/** The prompts that are on, in list order. */
export function onProjectPrompts(ids: readonly string[], prompts: readonly ProjectPrompt[]): ProjectPrompt[] {
  const wanted = new Set(ids);
  return sortProjectPrompts(prompts).filter((prompt) => wanted.has(prompt.id));
}

/** Switch one prompt for this job. The project is not changed. */
export function togglePromptId(ids: readonly string[], id: string, prompts: readonly ProjectPrompt[]): string[] {
  const next = ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
  return livePromptIds(next, prompts);
}

/** The on prompts as one block, in list order, that goes after the looks and ahead of the scene. */
export function joinProjectPrompts(prompts: readonly { body: string }[]): string {
  return prompts
    .map((prompt) => prompt.body.trim())
    .filter(Boolean)
    .join("\n\n");
}

/**
 * The text names are resolved over: the scene first, so a mention's offset still matches the
 * composer box, then the on project prompts. One plan means a file named in both is attached
 * and numbered once, and @Image numbers mean the same thing everywhere in the send.
 */
export function promptPlanText(scene: string, promptBlock: string): string {
  return promptBlock ? `${scene}\n\n${promptBlock}` : scene;
}

/** How many Every scene prompts are on, for the "2 of 3 on" control label. */
export function everySceneCounts(
  ids: readonly string[],
  prompts: readonly ProjectPrompt[],
): { on: number; total: number } {
  const every = prompts.filter((prompt) => prompt.everyScene);
  return { on: every.filter((prompt) => ids.includes(prompt.id)).length, total: every.length };
}

/** The first non-blank line of a body, for list rows. */
export function promptFirstLine(body: string, max = 90): string {
  const line = body.split("\n").map((item) => item.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** Prompts whose name or body has the query, in list order. */
export function filterProjectPrompts<T extends ProjectPrompt>(prompts: readonly T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  const sorted = sortProjectPrompts(prompts);
  if (!needle) return sorted;
  return sorted.filter(
    (prompt) => prompt.name.toLowerCase().includes(needle) || prompt.body.toLowerCase().includes(needle),
  );
}

/**
 * The new list order. Ids the project has come first in the order given; any it has that the
 * request left out keep their old order after them. Unknown ids are ignored.
 */
export function reorderedPromptIds(requested: readonly string[], prompts: readonly ProjectPrompt[]): string[] {
  const known = sortProjectPrompts(prompts).map((prompt) => prompt.id);
  const head = requested.filter((id, index) => known.includes(id) && requested.indexOf(id) === index);
  return [...head, ...known.filter((id) => !head.includes(id))];
}

export function acceptAppliedPrompts(raw: unknown): AppliedPrompt[] {
  if (!Array.isArray(raw)) return [];
  const out: AppliedPrompt[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { id?: unknown; name?: unknown };
    const id = acceptPromptId(record.id);
    const name = acceptProjectPromptName(record.name);
    if (!id || !name || out.some((item) => item.id === id)) continue;
    out.push({ id, name });
    if (out.length >= PROJECT_PROMPTS_MAX) break;
  }
  return out;
}

/** The project prompts recorded with a generation, from its stored params. */
export function promptsFromParams(paramsJson: string | null | undefined): AppliedPrompt[] {
  if (!paramsJson) return [];
  try {
    const parsed = JSON.parse(paramsJson) as { studio_prompts?: unknown };
    return acceptAppliedPrompts(parsed.studio_prompts);
  } catch {
    return [];
  }
}
