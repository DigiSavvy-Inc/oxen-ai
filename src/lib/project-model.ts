/**
 * A project's model and what the composer starts from. The Brief can pin a model;
 * otherwise the last run's choice stands in. New job starts from the brief with that
 * model; opening the project brings the draft back under it.
 */

import {
  firstSupportedMode,
  modelSupportsMode,
  type ComposerDefaults,
  type ComposerDraft,
  type GenerationMode,
  type ReferenceCaps,
  type ReferenceModel,
  type StudioProject,
} from "./api";

/** Modes that send references, in the order a pinned model prefers them. */
const REFERENCE_MODES: GenerationMode[] = ["reference-to-video", "image-to-image", "video-to-video"];

/** Where the composer's current contents came from. Shown so a draft is not mistaken for a fresh job. */
export type ComposerOrigin = "draft" | "new-job";

export const ORIGIN_LABELS: Record<ComposerOrigin, string> = {
  draft: "Draft",
  "new-job": "New job",
};

export function referenceModeFor(model: ReferenceModel): GenerationMode | null {
  return REFERENCE_MODES.find((mode) => modelSupportsMode(model, mode)) ?? firstSupportedMode(model, "text-to-image");
}

/** "9 images · 3 videos · 3 audio". A null cap names the kind without a number. */
export function referenceCapsLabel(caps: ReferenceCaps): string {
  const parts: string[] = [];
  for (const kind of ["image", "video", "audio"] as const) {
    const cap = caps[kind];
    if (cap === 0) continue;
    const noun = kind === "audio" ? "audio" : cap === 1 ? kind : `${kind}s`;
    parts.push(cap == null ? noun : `${cap} ${noun}`);
  }
  return parts.join(" · ");
}

/** Pinned models first by name, then the rest by name. */
export function sortReferenceModels(models: readonly ReferenceModel[], preferredIds: ReadonlySet<string>): ReferenceModel[] {
  const name = (model: ReferenceModel) => model.display_name ?? model.id;
  return [...models].sort((a, b) => {
    const starA = preferredIds.has(a.id) ? 0 : 1;
    const starB = preferredIds.has(b.id) ? 0 : 1;
    return starA - starB || name(a).localeCompare(name(b));
  });
}

/** Defaults after the Brief picks a model. Settings carry over only when the model is the same. */
export function pinnedDefaults(model: ReferenceModel, previous: ComposerDefaults | null): ComposerDefaults {
  const settings = previous && previous.model === model.id ? previous.settings : {};
  return { mode: referenceModeFor(model), model: model.id, settings, pinned: true };
}

/** Defaults after the Brief lets go of the model: what was pinned becomes a plain last-run default. */
export function unpinnedDefaults(previous: ComposerDefaults | null): ComposerDefaults | null {
  if (!previous) return null;
  return { mode: previous.mode, model: previous.model, settings: previous.settings };
}

/** Defaults after a run. A pinned model keeps its place; its saved settings follow a run that used it. */
export function defaultsAfterRun(previous: ComposerDefaults | null, run: ComposerDraft): ComposerDefaults {
  if (previous?.pinned && previous.model) {
    return run.model === previous.model ? { ...previous, settings: run.settings } : previous;
  }
  return { mode: run.mode, model: run.model, settings: run.settings };
}

export type ProjectComposerState = {
  prompt: string;
  lookIds: string[];
  defaults: ComposerDefaults | null;
  origin: ComposerOrigin;
};

type ProjectSource = Pick<StudioProject, "prompt" | "lookIds" | "draft" | "defaults">;

/** New job: the brief's prompt and looks, with the project model and its saved settings. */
export function composerStateForNewJob(project: ProjectSource): ProjectComposerState {
  return { prompt: project.prompt, lookIds: project.lookIds, defaults: project.defaults, origin: "new-job" };
}

/**
 * Opening a project: the draft comes back when there is one. A pinned model still wins
 * over whatever the draft last used, keeping the draft's settings only when they were for it.
 */
export function composerStateOnOpen(project: ProjectSource): ProjectComposerState {
  const draft = project.draft;
  if (!draft) return composerStateForNewJob(project);
  const prompt = draft.prompt ?? project.prompt;
  const pinned = project.defaults?.pinned ? project.defaults : null;
  if (pinned) {
    const sameModel = draft.model === pinned.model;
    return {
      prompt,
      lookIds: project.lookIds,
      defaults: { ...pinned, settings: sameModel ? draft.settings : pinned.settings },
      origin: "draft",
    };
  }
  return {
    prompt,
    lookIds: project.lookIds,
    defaults: { mode: draft.mode, model: draft.model, settings: draft.settings },
    origin: "draft",
  };
}
