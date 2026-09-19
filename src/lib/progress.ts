export const OXEN_TYPICAL_IMAGE_SECONDS = 18;
export const OXEN_TYPICAL_VIDEO_SECONDS = 180;

export function typicalWaitSeconds(mediaType: string | null | undefined): number {
  return mediaType === "video" ? OXEN_TYPICAL_VIDEO_SECONDS : OXEN_TYPICAL_IMAGE_SECONDS;
}

export function formatWaitDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
}

export function remainingLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  if (total === 1) return "1 second remaining";
  if (total < 60) return `${total} seconds remaining`;
  return `${formatWaitDuration(total)} remaining`;
}

export function typicalWaitLabel(mediaType: string | null | undefined, seconds: number): string {
  const kind = mediaType === "video" ? "Videos" : "Images";
  return `${kind} usually generate in ${formatWaitDuration(seconds)}`;
}

export type WaitPhase = "queued" | "processing";

export function estimateGenerationWait(opts: {
  status: string;
  mediaType: string | null | undefined;
  createdAt: number;
  enqueuedAt?: number | null;
  startedAt?: number | null;
  etaSeconds?: number | null;
  progress?: number | null;
  typicalSeconds?: number | null;
  nowMs?: number;
}): {
  phase: WaitPhase;
  elapsedSeconds: number;
  remainingSeconds: number;
  percent: number;
  typicalSeconds: number;
  headline: string;
  remainingText: string;
  typicalText: string;
} {
  const typical = Math.max(
    5,
    Math.round(opts.typicalSeconds || typicalWaitSeconds(opts.mediaType)),
  );
  const nowSec = Math.floor((opts.nowMs ?? Date.now()) / 1000);
  const start =
    opts.status === "queued"
      ? (opts.enqueuedAt ?? opts.createdAt)
      : (opts.startedAt ?? opts.enqueuedAt ?? opts.createdAt);
  const elapsedSeconds = Math.max(0, nowSec - start);
  const phase: WaitPhase = opts.status === "queued" ? "queued" : "processing";
  const remainingFromEta =
    opts.etaSeconds != null && Number.isFinite(opts.etaSeconds)
      ? Math.max(0, opts.etaSeconds)
      : null;
  const remainingSeconds = remainingFromEta ?? Math.max(0, typical - elapsedSeconds);
  const fromApi =
    opts.progress != null && Number.isFinite(opts.progress)
      ? opts.progress <= 1
        ? opts.progress
        : opts.progress / 100
      : null;
  const rawPercent = fromApi ?? Math.min(0.92, elapsedSeconds / typical);
  const percent = Math.min(0.95, Math.max(phase === "queued" ? 0.04 : 0.08, rawPercent));

  return {
    phase,
    elapsedSeconds,
    remainingSeconds,
    percent,
    typicalSeconds: typical,
    headline: waitHeadline(phase, opts.mediaType, elapsedSeconds),
    remainingText:
      remainingFromEta != null || elapsedSeconds < typical
        ? remainingLabel(remainingSeconds)
        : "Usually done by now",
    typicalText: typicalWaitLabel(opts.mediaType, typical),
  };
}

function waitHeadline(
  phase: WaitPhase,
  mediaType: string | null | undefined,
  elapsedSeconds: number,
): string {
  switch (phase) {
    case "queued":
      return "Queued on Oxen…";
    case "processing": {
      const lines =
        mediaType === "video"
          ? ["Rendering frames…", "Stitching the shot…", "Still cooking…"]
          : ["Plowing through pixels…", "Composing the shot…", "Waiting on Oxen…"];
      return lines[Math.floor(elapsedSeconds / 8) % lines.length] ?? "Generating…";
    }
    default: {
      const _exhaustive: never = phase;
      return _exhaustive;
    }
  }
}
