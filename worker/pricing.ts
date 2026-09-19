import type { OxenPricing } from "./oxen";

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export function parseOxenPricing(raw: unknown): OxenPricing | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const pricing: OxenPricing = {
    method: typeof record.method === "string" ? record.method : null,
    cost_per_image: asFiniteNumber(record.cost_per_image),
    cost_per_second: asFiniteNumber(record.cost_per_second),
    cost_per_second_with_audio: asFiniteNumber(record.cost_per_second_with_audio),
    cost_per_second_high_res: asFiniteNumber(record.cost_per_second_high_res),
  };
  const hasValue =
    pricing.method != null ||
    pricing.cost_per_image != null ||
    pricing.cost_per_second != null ||
    pricing.cost_per_second_with_audio != null ||
    pricing.cost_per_second_high_res != null;
  return hasValue ? pricing : null;
}

export function estimateGenerationCost(opts: {
  pricing: OxenPricing | null | undefined;
  numGenerations: number;
  duration?: number | string;
  generateAudio?: boolean;
  resolution?: string;
}): { amount: number | null; label: string } {
  const count = Math.min(4, Math.max(1, Math.round(opts.numGenerations || 1)));
  const pricing = opts.pricing;
  if (!pricing) return { amount: null, label: "Price unavailable" };

  const durationRaw = opts.duration;
  const seconds =
    typeof durationRaw === "number"
      ? durationRaw
      : durationRaw && durationRaw !== "auto" && Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : 5;

  const res = (opts.resolution || "").toLowerCase();
  const highRes = res.includes("1080") || res.includes("4k") || res === "2k";
  const perSecond =
    (highRes ? pricing.cost_per_second_high_res : null) ??
    (opts.generateAudio ? pricing.cost_per_second_with_audio : null) ??
    pricing.cost_per_second ??
    null;

  if (pricing.method === "per_image" || pricing.cost_per_image != null) {
    const unit = pricing.cost_per_image ?? 0;
    const amount = unit * count;
    return { amount, label: `≈$${amount.toFixed(3)}` };
  }
  if (pricing.method === "per_video_output_second" || perSecond != null) {
    const unit = perSecond ?? 0;
    const amount = unit * seconds * count;
    return { amount, label: `≈$${amount.toFixed(2)}` };
  }
  return { amount: null, label: "Price varies" };
}
