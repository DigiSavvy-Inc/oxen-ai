/** History groups per library page. Kept on a 3-column grid. */
export const HISTORY_PAGE_SIZES = [12, 24, 48, 96] as const;
export const DEFAULT_HISTORY_PAGE_SIZE = 24;

export function clampHistoryPageSize(value: unknown): number {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(numeric)) return DEFAULT_HISTORY_PAGE_SIZE;
  const rounded = Math.round(numeric);
  if ((HISTORY_PAGE_SIZES as readonly number[]).includes(rounded)) return rounded;
  return DEFAULT_HISTORY_PAGE_SIZE;
}
