/**
 * The models a project can pin: those whose request schema takes image, video, or
 * audio reference inputs. Caps come from the same slot detection the composer uses,
 * so Seedance's face and reference arrays, Seedream's input_image, and GPT Image's
 * edit input all count without a list of names.
 */

import { isChatModel, isMediaGenerationModel, type ModeFilterModel } from "./model-modes";
import type { OxenModel, OxenPricing } from "./oxen";
import { modelControlsOrEmpty, type MediaKind, type MediaSlot } from "./schema";

/** Per kind: the slot limit, or null when the catalog lists the kind but the schema is silent. */
export type ReferenceCaps = Record<MediaKind, number | null>;

export type ReferenceModel = {
  id: string;
  display_name?: string;
  endpoint?: string;
  capabilities?: { input?: string[]; output?: string[] };
  pricing?: OxenPricing | null;
  caps: ReferenceCaps;
};

const KINDS: MediaKind[] = ["image", "video", "audio"];

function slotCap(slots: MediaSlot[], kind: MediaKind): number {
  const matching = slots.filter((slot) => slot.kind === kind);
  if (matching.length === 0) return 0;
  return Math.max(...matching.map((slot) => slot.maxItems));
}

function catalogLists(model: ModeFilterModel, kind: MediaKind): boolean {
  return (model.capabilities?.input ?? []).some((item) => item.toLowerCase() === kind);
}

/** Null when the model takes no references at all. */
export function referenceCapsFor(model: OxenModel): ReferenceCaps | null {
  if (isChatModel(model) || !isMediaGenerationModel(model)) return null;
  const hasSchema = Boolean(model.request_schema && typeof model.request_schema === "object");
  const slots = hasSchema ? modelControlsOrEmpty(model).slots : [];
  const caps: ReferenceCaps = { image: 0, video: 0, audio: 0 };
  let any = false;
  for (const kind of KINDS) {
    const fromSchema = slotCap(slots, kind);
    if (fromSchema > 0) {
      caps[kind] = fromSchema;
      any = true;
    } else if (!hasSchema && catalogLists(model, kind)) {
      caps[kind] = null;
      any = true;
    }
  }
  return any ? caps : null;
}

/** True when at least one kind has a cap, so the project can attach something. */
export function takesReferences(caps: ReferenceCaps | null): caps is ReferenceCaps {
  return Boolean(caps && KINDS.some((kind) => caps[kind] == null || caps[kind] > 0));
}

export function referenceModels(models: OxenModel[]): ReferenceModel[] {
  const out: ReferenceModel[] = [];
  const seen = new Set<string>();
  for (const model of models) {
    const id = model.id.trim().toLowerCase();
    if (!id || seen.has(id)) continue;
    const caps = referenceCapsFor(model);
    if (!takesReferences(caps)) continue;
    seen.add(id);
    out.push({
      id: model.id,
      display_name: model.display_name,
      endpoint: model.endpoint,
      capabilities: model.capabilities,
      pricing: model.pricing ?? null,
      caps,
    });
  }
  return out.sort((a, b) => (a.display_name ?? a.id).localeCompare(b.display_name ?? b.id));
}
