import type { Generation } from "./api";

export type GenerationBatch = {
  id: string;
  items: Generation[];
};

/** Rows saved before batch ids share one enqueue's timestamp, mode, model, and prompt. */
export function batchKey(generation: Generation): string {
  if (generation.batchId) return generation.batchId;
  return [
    "legacy",
    generation.createdAt,
    generation.mode,
    generation.mediaType ?? "",
    generation.model,
    generation.prompt ?? "",
  ].join("\0");
}

export function groupGenerationBatches(generations: Generation[]): GenerationBatch[] {
  const order: string[] = [];
  const map = new Map<string, Generation[]>();
  for (const generation of generations) {
    const key = batchKey(generation);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, [generation]);
      order.push(key);
    } else {
      existing.push(generation);
    }
  }
  return order.map((id) => ({ id, items: map.get(id) ?? [] }));
}

export function coverGeneration(items: Generation[]): Generation | undefined {
  return (
    items.find((item) => item.status === "succeeded" && item.resultUrl) ??
    items.find((item) => item.status === "succeeded") ??
    items[0]
  );
}

export function siblingAfterRemoval(
  id: string | null,
  removing: Set<string>,
  rows: Generation[],
): string | null {
  if (!id) return null;
  if (!removing.has(id)) return id;
  const current = rows.find((row) => row.id === id);
  if (!current) return null;
  const key = batchKey(current);
  return rows.find((row) => !removing.has(row.id) && batchKey(row) === key)?.id ?? null;
}

export function batchPreviewItems(items: Generation[], max = 4): Generation[] {
  const cover = coverGeneration(items);
  if (!cover) return items.slice(0, max);
  if (items.length <= 1) return [cover];
  return [cover, ...items.filter((item) => item.id !== cover.id)].slice(0, max);
}

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

export function isActiveGeneration(generation: Generation): boolean {
  return !TERMINAL_STATUSES.has(generation.status);
}

/** Failed, cancelled, or succeeded without a file. In-flight jobs stay. */
export function isUnfinishedGeneration(
  item: Pick<Generation, "status" | "resultUrl"> & { resultKey?: string | null },
): boolean {
  if (item.status === "failed" || item.status === "cancelled") return true;
  if (item.status === "succeeded" && !item.resultUrl && !item.resultKey) return true;
  return false;
}

/** Stable while a job is merely polled again with the same visible fields. */
export function generationPollChanged(prev: Generation, next: Generation): boolean {
  return (
    prev.status !== next.status ||
    prev.resultUrl !== next.resultUrl ||
    prev.thumbUrl !== next.thumbUrl ||
    prev.lastFrameUrl !== next.lastFrameUrl ||
    prev.errorMessage !== next.errorMessage ||
    prev.progress !== next.progress ||
    prev.etaSeconds !== next.etaSeconds ||
    prev.startedAt !== next.startedAt
  );
}

export function activeGenerationKey(rows: readonly Generation[]): string {
  return rows
    .filter(isActiveGeneration)
    .map((item) => item.id)
    .sort()
    .join("\n");
}

export function mergeGenerations(
  existing: Generation[],
  incoming: Generation[],
): Generation[] {
  const map = new Map<string, Generation>();
  for (const item of existing) map.set(item.id, item);
  for (const item of incoming) {
    const prev = map.get(item.id);
    if (!prev || item.updatedAt >= prev.updatedAt) map.set(item.id, item);
  }
  return [...map.values()].sort((a, b) => {
    if (b.createdAt !== a.createdAt) return b.createdAt - a.createdAt;
    return b.id.localeCompare(a.id);
  });
}
