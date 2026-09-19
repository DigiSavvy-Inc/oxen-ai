export type OxenCostGrid = Record<string, Record<string, number>>;
export type OxenResolutionRates = Record<string, number>;

export type OxenPricing = {
  method?: string | null;
  cost_per_image?: number | null;
  cost_per_image_grid?: OxenCostGrid | null;
  cost_per_second?: number | null;
  cost_per_second_by_resolution?: OxenResolutionRates | null;
  cost_per_second_with_audio?: number | null;
  cost_per_second_high_res?: number | null;
};

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function parseNumberMap(raw: unknown): Record<string, number> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const amount = asFiniteNumber(value);
    if (amount == null) continue;
    out[key] = amount;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function parseImageGrid(raw: unknown): OxenCostGrid | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: OxenCostGrid = {};
  for (const [quality, inner] of Object.entries(raw as Record<string, unknown>)) {
    const row = parseNumberMap(inner);
    if (!row) continue;
    out[quality] = row;
  }
  return Object.keys(out).length > 0 ? out : null;
}

export function parseOxenPricing(raw: unknown): OxenPricing | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const pricing: OxenPricing = {
    method: typeof record.method === "string" ? record.method : null,
    cost_per_image: asFiniteNumber(record.cost_per_image),
    cost_per_image_grid: parseImageGrid(record.cost_per_image_grid),
    cost_per_second: asFiniteNumber(record.cost_per_second),
    cost_per_second_by_resolution: parseNumberMap(record.cost_per_second_by_resolution),
    cost_per_second_with_audio: asFiniteNumber(record.cost_per_second_with_audio),
    cost_per_second_high_res: asFiniteNumber(record.cost_per_second_high_res),
  };
  const hasValue =
    pricing.method != null ||
    pricing.cost_per_image != null ||
    pricing.cost_per_image_grid != null ||
    pricing.cost_per_second != null ||
    pricing.cost_per_second_by_resolution != null ||
    pricing.cost_per_second_with_audio != null ||
    pricing.cost_per_second_high_res != null;
  return hasValue ? pricing : null;
}

const RESOLUTION_SORT = [
  "1k",
  "1.5k",
  "2k",
  "3k",
  "4k",
  "480p",
  "720p",
  "768p",
  "1080p",
];

function sortResolutionLabels(values: string[]): string[] {
  return [...values].sort((a, b) => {
    const ia = RESOLUTION_SORT.indexOf(resolutionCanonical(a));
    const ib = RESOLUTION_SORT.indexOf(resolutionCanonical(b));
    const ra = ia === -1 ? 100 : ia;
    const rb = ib === -1 ? 100 : ib;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}

export function controlOptionsFromPricing(pricing: OxenPricing | null | undefined): {
  quality: string[];
  resolution: string[];
} {
  if (!pricing) return { quality: [], resolution: [] };
  const quality: string[] = [];
  const resolutionByCanon = new Map<string, string>();
  if (pricing.cost_per_image_grid) {
    for (const [qualityKey, row] of Object.entries(pricing.cost_per_image_grid)) {
      quality.push(qualityKey);
      for (const key of Object.keys(row)) {
        const canon = resolutionCanonical(key);
        if (!resolutionByCanon.has(canon)) resolutionByCanon.set(canon, key);
      }
    }
  }
  if (pricing.cost_per_second_by_resolution) {
    for (const key of Object.keys(pricing.cost_per_second_by_resolution)) {
      const canon = resolutionCanonical(key);
      if (!resolutionByCanon.has(canon)) resolutionByCanon.set(canon, key);
    }
  }
  return {
    quality: [...new Set(quality)],
    resolution: sortResolutionLabels([...resolutionByCanon.values()]),
  };
}

function lookupInsensitive(map: Record<string, number>, key: string): number | null {
  if (key in map) return map[key] ?? null;
  const needle = key.toLowerCase();
  for (const [name, value] of Object.entries(map)) {
    if (name.toLowerCase() === needle) return value;
  }
  return null;
}

function resolutionCanonical(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/\s+/g, "");
  const compact = trimmed.replace(/p$/i, "");
  if (compact === "1k" || compact === "1024") return "1k";
  if (compact === "1.5k" || compact === "1536") return "1.5k";
  if (compact === "2k" || compact === "1440" || compact === "2048") return "2k";
  if (compact === "3k" || compact === "3072") return "3k";
  if (compact === "4k" || compact === "2160" || compact === "3840" || compact === "uhd") return "4k";
  if (compact === "480" || compact === "sd") return "480p";
  if (compact === "720" || compact === "hd") return "720p";
  if (
    compact === "1080" ||
    compact === "fhd" ||
    compact === "fullhd" ||
    trimmed.includes("1920x1080")
  ) {
    return "1080p";
  }
  if (compact === "768") return "768p";
  if (/^\d+$/.test(compact)) return `${compact}p`;
  return trimmed;
}

export function lookupResolutionRate(
  map: Record<string, number> | null | undefined,
  resolution: string | undefined,
): number | null {
  if (!map) return null;
  if (resolution?.trim()) {
    const exact = lookupInsensitive(map, resolution.trim());
    if (exact != null) return exact;
    const want = resolutionCanonical(resolution);
    for (const [key, value] of Object.entries(map)) {
      if (resolutionCanonical(key) === want) return value;
    }
  }
  return null;
}

function pickQualityRow(
  grid: OxenCostGrid,
  quality: string | undefined,
): Record<string, number> | null {
  const keys = Object.keys(grid);
  if (keys.length === 0) return null;
  if (quality?.trim()) {
    const needle = quality.trim().toLowerCase();
    const hit = keys.find((key) => key.toLowerCase() === needle);
    if (hit) return grid[hit] ?? null;
  }
  const preferred = ["high", "medium", "standard", "low"];
  for (const name of preferred) {
    const hit = keys.find((key) => key.toLowerCase() === name);
    if (hit) return grid[hit] ?? null;
  }
  return grid[keys[0] ?? ""] ?? null;
}

function imageUnitCost(
  pricing: OxenPricing,
  quality: string | undefined,
  resolution: string | undefined,
): number | null {
  const grid = pricing.cost_per_image_grid;
  if (grid) {
    const row = pickQualityRow(grid, quality);
    const fromRes = lookupResolutionRate(row, resolution);
    if (fromRes != null) return fromRes;
    if (row) {
      const values = Object.values(row);
      if (values[0] != null) return values[0];
    }
  }
  return pricing.cost_per_image ?? null;
}

function isHighRes(resolution: string | undefined): boolean {
  const res = (resolution || "").toLowerCase();
  return (
    res.includes("1080") ||
    res.includes("4k") ||
    res.includes("2160") ||
    res === "2k" ||
    res.includes("1440")
  );
}

function videoUnitCost(
  pricing: OxenPricing,
  resolution: string | undefined,
  generateAudio: boolean | undefined,
): number | null {
  const fromRes = lookupResolutionRate(pricing.cost_per_second_by_resolution, resolution);
  if (fromRes != null) return fromRes;
  if (isHighRes(resolution) && pricing.cost_per_second_high_res != null) {
    return pricing.cost_per_second_high_res;
  }
  if (generateAudio && pricing.cost_per_second_with_audio != null) {
    return pricing.cost_per_second_with_audio;
  }
  return pricing.cost_per_second ?? null;
}

function isImagePricing(pricing: OxenPricing): boolean {
  return (
    pricing.method === "per_image" ||
    pricing.cost_per_image != null ||
    pricing.cost_per_image_grid != null
  );
}

function isVideoPricing(pricing: OxenPricing): boolean {
  return (
    pricing.method === "per_video_output_second" ||
    pricing.cost_per_second != null ||
    pricing.cost_per_second_by_resolution != null ||
    pricing.cost_per_second_with_audio != null ||
    pricing.cost_per_second_high_res != null
  );
}

export function formatUsd(amount: number, decimals?: number): string {
  const places = decimals ?? (amount < 0.01 ? 3 : amount < 1 ? 3 : 2);
  return `≈$${amount.toFixed(places)}`;
}

export function estimateGenerationCost(opts: {
  pricing: OxenPricing | null | undefined;
  numGenerations: number;
  duration?: number | string;
  generateAudio?: boolean;
  resolution?: string;
  quality?: string;
}): { amount: number | null; label: string } {
  const count = Math.min(4, Math.max(1, Math.round(opts.numGenerations || 1)));
  const pricing = opts.pricing ? parseOxenPricing(opts.pricing) ?? opts.pricing : null;
  if (!pricing) return { amount: null, label: "Price unavailable" };

  const durationRaw = opts.duration;
  const seconds =
    typeof durationRaw === "number"
      ? durationRaw
      : durationRaw && durationRaw !== "auto" && Number.isFinite(Number(durationRaw))
        ? Number(durationRaw)
        : 5;

  if (isImagePricing(pricing) && !isVideoPricing(pricing)) {
    const unit = imageUnitCost(pricing, opts.quality, opts.resolution);
    if (unit == null) return { amount: null, label: "Price varies" };
    const amount = unit * count;
    return { amount, label: formatUsd(amount, 3) };
  }

  if (isVideoPricing(pricing) && pricing.method !== "per_image") {
    const unit = videoUnitCost(pricing, opts.resolution, opts.generateAudio);
    if (unit == null) return { amount: null, label: "Price varies" };
    const amount = unit * seconds * count;
    return { amount, label: formatUsd(amount, 2) };
  }

  if (isImagePricing(pricing)) {
    const unit = imageUnitCost(pricing, opts.quality, opts.resolution);
    if (unit == null) return { amount: null, label: "Price varies" };
    const amount = unit * count;
    return { amount, label: formatUsd(amount, 3) };
  }

  return { amount: null, label: "Price varies" };
}
