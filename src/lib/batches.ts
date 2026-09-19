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
