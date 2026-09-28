import type { GenerationMode } from "./model-modes";
import type { OxenModel, OxenPricing } from "./oxen";
import { controlOptionsFromPricing, parseOxenPricing } from "./pricing";

export function clampDuration(value: number | string | undefined): number | string | undefined {
  return value;
}
