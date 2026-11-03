import { videoStillTime } from "../../worker/video-thumb";

const MAX_EDGE = 320;
const CONCURRENT = 2;

let active = 0;
const waiting: Array<() => void> = [];
const frames = new Map<string, string>();

function acquire(): Promise<void> {
  if (active < CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiting.push(() => {
      active += 1;
      resolve();
    });
  });
}

function release(): void {
  active -= 1;
  const next = waiting.shift();
  if (next) next();
}

export function videoStillKey(src: string, seconds: number): string {
  return `${seconds}\n${src}`;
}

function paint(video: HTMLVideoElement): string | null {
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) return null;
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  try {
    return canvas.toDataURL("image/jpeg", 0.72);
  } catch {
    return null;
  }
}

function drawFrame(src: string, seconds: number, signal: AbortSignal): Promise<string | null> {
  return new Promise((resolve) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    if (!src.startsWith("blob:") && !src.startsWith("data:")) video.crossOrigin = "anonymous";
    video.style.cssText = "position:fixed;width:8px;height:8px;left:-9999px;opacity:0;pointer-events:none";
    let settled = false;
    const finish = (url: string | null) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      video.removeAttribute("src");
      video.load();
      video.remove();
      resolve(url);
    };
    const onAbort = () => finish(null);
    signal.addEventListener("abort", onAbort);
    const grab = () => finish(paint(video));
    video.addEventListener("error", () => finish(null), { once: true });
    video.addEventListener(
      "loadedmetadata",
      () => {
        const target = videoStillTime(seconds, video.duration);
        if (target <= 0.01) {
          if (video.readyState >= 2) grab();
          else video.addEventListener("loadeddata", grab, { once: true });
          return;
        }
        video.addEventListener("seeked", grab, { once: true });
        try {
          video.currentTime = target;
        } catch {
          finish(null);
        }
      },
      { once: true },
    );
    document.body.appendChild(video);
    video.src = src;
  });
}

/** One JPEG still from a video. Repeated calls for the same source and time reuse the first frame. */
export async function captureVideoStill(
  src: string,
  seconds: number,
  signal: AbortSignal,
): Promise<string | null> {
  if (!src || signal.aborted || typeof document === "undefined") return null;
  const key = videoStillKey(src, seconds);
  const cached = frames.get(key);
  if (cached) return cached;
  await acquire();
  try {
    if (signal.aborted) return null;
    const again = frames.get(key);
    if (again) return again;
    const url = await drawFrame(src, seconds, signal);
    if (url) frames.set(key, url);
    return url;
  } finally {
    release();
  }
}
