import { slotMax, type GenerationMode, type ModelControls } from "./api";

/**
 * How many files of one kind a model takes in a mode. Kept free of browser code so the
 * Worker can apply the same limits to an API prompt that the composer applies.
 */
type MediaKind = "image" | "video" | "audio" | "document";

export const DEFAULT_ATTACH_MAX = 16;

function modeMinForKind(mode: GenerationMode | null | undefined, kind: MediaKind): number {
  switch (kind) {
    case "image":
      return mode === "image-to-image" || mode === "reference-to-video" || mode === "video-to-video"
        ? 1
        : 0;
    case "video":
      return mode === "video-to-video" ? 1 : 0;
    case "audio":
      return 0;
    case "document":
      return 0;
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export type CapControls = Pick<ModelControls, "slots"> & {
  imageVideoExclusive?: boolean;
  frames?: ModelControls["frames"];
};

/** Keyframes and continuation stay on different modes and cannot be combined. */
function exclusiveKindCap(
  controls: CapControls,
  mode: GenerationMode | null | undefined,
  kind: MediaKind,
): number | null {
  if (!controls.imageVideoExclusive) return null;
  if (kind === "image" && mode === "reference-to-video") return slotMax(controls, "image");
  if (kind === "video" && mode === "video-to-video") return slotMax(controls, "video");
  if (kind === "image" || kind === "video") return 0;
  return null;
}

export function mediaKindCap(
  controls: CapControls | null,
  mode: GenerationMode | null | undefined,
  kind: MediaKind,
): number {
  if (kind === "document") return mode === "chat" ? 4 : 0;
  if (mode === "chat" && kind === "image") return 4;
  if (controls) {
    const exclusive = exclusiveKindCap(controls, mode, kind);
    if (exclusive != null) return exclusive;
  }
  // A frames-only model takes a first and a last frame, and no references.
  if (kind === "image" && controls?.frames && !controls.frames.references) return 2;
  const fromSlots = slotMax(controls, kind);
  const modeMin = modeMinForKind(mode, kind);
  if (fromSlots > 0) return Math.max(fromSlots, modeMin);
  if (controls) return modeMin;
  if (modeMin > 0 || !mode) return DEFAULT_ATTACH_MAX;
  return 0;
}
