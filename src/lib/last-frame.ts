const LAST_FRAME_EDGE = 720;

export function lastFrameSeekTime(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  const frame = 1 / 30;
  if (duration <= frame) return 0;
  return duration - frame;
}

function waitFor(target: HTMLVideoElement, event: "loadedmetadata" | "seeked"): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      target.removeEventListener(event, onReady);
      target.removeEventListener("error", onError);
      resolve();
    };
    const onReady = () => finish();
    const onError = () => {
      target.removeEventListener(event, onReady);
      target.removeEventListener("error", onError);
      reject(new Error("Could not read the video"));
    };
    target.addEventListener(event, onReady);
    target.addEventListener("error", onError);
  });
}

/** Draw the video's last frame. The caller stores the image with the generation. */
export async function captureVideoLastFrame(src: string): Promise<Blob> {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const ready = waitFor(video, "loadedmetadata");
  video.src = src;
  await ready;
  const target = lastFrameSeekTime(video.duration);
  if (Math.abs(video.currentTime - target) > 0.001) {
    const seeked = waitFor(video, "seeked");
    video.currentTime = target;
    await seeked;
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  if (!width || !height) throw new Error("Video has no frames");
  const scale = Math.min(1, LAST_FRAME_EDGE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not capture the last frame");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  video.removeAttribute("src");
  video.load();
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((value) => resolve(value), "image/jpeg", 0.85);
  });
  if (!blob) throw new Error("Could not capture the last frame");
  return blob;
}
