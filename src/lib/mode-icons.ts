/**
 * The kind icon beside a model name. A model's kinds are the modes it supports, read
 * from the same `modelSupportsMode` check that ghosts the mode pills, in pill order.
 */

import { ALL_MODES, MODE_LABELS, modelSupportsMode, type GenerationMode } from "./api";

/** One drawing per mode. The names say what is drawn, not which mode uses it. */
export type ModeGlyph =
  | "image"
  | "image-pencil"
  | "film"
  | "image-play"
  | "film-pencil"
  | "waveform"
  | "bubble";

export const MODE_GLYPHS: Record<GenerationMode, ModeGlyph> = {
  "text-to-image": "image",
  "image-to-image": "image-pencil",
  "text-to-video": "film",
  "reference-to-video": "image-play",
  "video-to-video": "film-pencil",
  "text-to-audio": "waveform",
  chat: "bubble",
};

/** Tooltip and accessible name. Plain words, since a screen reader stumbles on the pill's arrow. */
export const MODE_ICON_LABELS: Record<GenerationMode, string> = {
  "text-to-image": "Text to image",
  "image-to-image": "Image to image (edit)",
  "text-to-video": "Text to video",
  "reference-to-video": "Image to video",
  "video-to-video": "Video to video",
  "text-to-audio": "Text to audio",
  chat: "Chat",
};

/** A row shows this many icons; a model with more gets a count for the rest. */
export const MODE_ICON_ROW_MAX = 3;

type ModeSource = Parameters<typeof modelSupportsMode>[0];

export function isGenerationMode(value: unknown): value is GenerationMode {
  return typeof value === "string" && Object.hasOwn(MODE_LABELS, value);
}

/** Every mode the catalog row supports, in pill order. Empty when it supports none. */
export function modelModes(model: ModeSource): GenerationMode[] {
  return ALL_MODES.filter((mode) => modelSupportsMode(model, mode));
}

/** The mode a finished run used, as a one-icon row. Empty for a mode this build does not know. */
export function runModes(mode: string | null | undefined): GenerationMode[] {
  return isGenerationMode(mode) ? [mode] : [];
}

export type ModeIconRow = {
  shown: GenerationMode[];
  /** Modes past the row limit, named in the count's tooltip. */
  more: GenerationMode[];
};

/** Pill order, without repeats, cut at the row limit. */
export function modeIconRow(modes: readonly GenerationMode[], max = MODE_ICON_ROW_MAX): ModeIconRow {
  const ordered = ALL_MODES.filter((mode) => modes.includes(mode));
  if (ordered.length <= max) return { shown: ordered, more: [] };
  return { shown: ordered.slice(0, max), more: ordered.slice(max) };
}

/** "Text to image, Image to image (edit)" */
export function modeIconsLabel(modes: readonly GenerationMode[]): string {
  return ALL_MODES.filter((mode) => modes.includes(mode))
    .map((mode) => MODE_ICON_LABELS[mode])
    .join(", ");
}
