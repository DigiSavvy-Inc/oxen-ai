import type { Generation } from "./api";

export type GenerationBatch = {
  id: string;
  items: Generation[];
};

export function batchKey(generation: Generation): string {
  return generation.batchId || generation.id;
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
