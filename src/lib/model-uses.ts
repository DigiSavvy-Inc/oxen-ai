const MODEL_USE_KEY = "ds-studio-model-uses";

export type ModelUseCounts = Record<string, number>;

export type ModelUseStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

function browserStorage(): ModelUseStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function parseCounts(raw: string | null): ModelUseCounts {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const counts: ModelUseCounts = {};
    for (const [id, count] of Object.entries(parsed)) {
      if (typeof count !== "number" || !Number.isFinite(count) || count <= 0) continue;
      counts[id] = Math.floor(count);
    }
    return counts;
  } catch {
    return {};
  }
}

export function readModelUses(storage: ModelUseStorage | null = browserStorage()): ModelUseCounts {
  if (!storage) return {};
  try {
    return parseCounts(storage.getItem(MODEL_USE_KEY));
  } catch {
    return {};
  }
}

/** Count one successful generate. Stays in this browser. */
export function recordModelUse(
  modelId: string,
  storage: ModelUseStorage | null = browserStorage(),
): ModelUseCounts {
  const counts = readModelUses(storage);
  const id = modelId.trim();
  if (!id) return counts;
  const next = { ...counts, [id]: (counts[id] ?? 0) + 1 };
  if (!storage) return next;
  try {
    storage.setItem(MODEL_USE_KEY, JSON.stringify(next));
  } catch {
    /* private mode or a full disk; the caller can still keep the count in memory */
  }
  return next;
}
