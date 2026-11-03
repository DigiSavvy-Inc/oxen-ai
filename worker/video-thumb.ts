/** How far into a gallery video the still is taken. One second avoids a black opening frame. */
export const DEFAULT_VIDEO_THUMB_SECONDS = 1;
export const MAX_VIDEO_THUMB_SECONDS = 120;

export function clampVideoThumbSeconds(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_VIDEO_THUMB_SECONDS;
  const tenths = Math.round(parsed * 10) / 10;
  return Math.min(MAX_VIDEO_THUMB_SECONDS, Math.max(0, tenths));
}

export function videoThumbMs(seconds: number): number {
  return Math.round(clampVideoThumbSeconds(seconds) * 1000);
}

export function videoThumbSecondsFromMs(value: unknown): number {
  const ms = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(ms)) return DEFAULT_VIDEO_THUMB_SECONDS;
  return clampVideoThumbSeconds(ms / 1000);
}

/** Stay on a decoded frame. A clip shorter than the setting uses its last moment. */
export function videoStillTime(requestedSeconds: number, durationSeconds: number): number {
  const requested = clampVideoThumbSeconds(requestedSeconds);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) return requested;
  const last = Math.max(0, durationSeconds - 0.05);
  return Math.min(requested, last);
}
