import { useState, type CSSProperties, type MouseEvent } from "react";

const FULL_EDGE = 2048;

function joinClass(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function sameMedia(left: string, right: string): boolean {
  if (left === right) return true;
  if (!left || !right || typeof window === "undefined") return false;
  try {
    return new URL(left, window.location.href).href === new URL(right, window.location.href).href;
  } catch {
    return false;
  }
}

/** Aspect ratio of a thumbnail already decoded on the page, so the stand-in can match the full frame. */
function cachedRatio(url: string): number | null {
  if (typeof document === "undefined") return null;
  for (const img of Array.from(document.images)) {
    if (!img.naturalWidth) continue;
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!sameMedia(src, url)) continue;
    return img.naturalWidth / img.naturalHeight;
  }
  return null;
}

function frameSize(ratio: number): { width: number; height: number } {
  if (ratio >= 1) {
    return { width: FULL_EDGE, height: Math.max(1, Math.round(FULL_EDGE / ratio)) };
  }
  return { width: Math.max(1, Math.round(FULL_EDGE * ratio)), height: FULL_EDGE };
}

function frameProps(scale: boolean, ratio: number | null): { className: string; style?: CSSProperties } {
  if (!scale || !ratio) return { className: "staged-still" };
  return {
    className: "staged-still is-scaled",
    style: { "--still-ratio": String(ratio) } as CSSProperties,
  };
}

/** First frame of a video element that is already showing this file. */
function visibleVideoFrame(src: string): { url: string; ratio: number } | null {
  if (typeof document === "undefined") return null;
  const matches = Array.from(document.querySelectorAll("video")).filter((video) => {
    if (video.readyState < 2 || !video.videoWidth) return false;
    const current = video.currentSrc || video.getAttribute("src") || "";
    return sameMedia(current, src);
  });
  const video = matches.find((item) => item.offsetWidth > 0 && item.offsetHeight > 0) ?? matches[0];
  if (!video) return null;
  try {
    const canvas = document.createElement("canvas");
    const width = Math.min(video.videoWidth, 480);
    const height = Math.max(1, Math.round((width * video.videoHeight) / video.videoWidth));
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(video, 0, 0, width, height);
    return { url: canvas.toDataURL("image/jpeg", 0.72), ratio: video.videoWidth / video.videoHeight };
  } catch {
    return null;
  }
}

type StillProps = {
  thumb?: string | null;
  full: string;
  alt: string;
  className?: string;
  /** Give the cached thumb the layout size of a large file so the frame does not jump when the file arrives. */
  scale?: boolean;
  title?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

/**
 * Show a thumbnail that is already on screen, then cover it with the full file once that file has decoded.
 * Keeps the previous full file from sitting in place while the next download finishes.
 */
export function StagedStill({ thumb, full, alt, className, scale = false, title, onClick }: StillProps) {
  const staged = Boolean(thumb && thumb !== full);
  const [forFull, setForFull] = useState(full);
  const [ready, setReady] = useState(false);
  const [ratio, setRatio] = useState<number | null>(() => (scale && thumb ? cachedRatio(thumb) : null));
  if (forFull !== full) {
    setForFull(full);
    setReady(false);
    setRatio(scale && thumb ? cachedRatio(thumb) : null);
  }

  if (!staged || !thumb) {
    return <img className={className} src={full} alt={alt} title={title} onClick={onClick} />;
  }

  const size = scale && ratio ? frameSize(ratio) : null;
  const reveal = (img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0) setReady(true);
  };

  const frame = frameProps(scale, ratio);
  return (
    <span className={frame.className} style={frame.style} onClick={onClick}>
      <img
        className={joinClass(className, "staged-base")}
        src={thumb}
        alt={alt}
        title={title}
        decoding="sync"
        width={size?.width}
        height={size?.height}
        onLoad={(event) => {
          const img = event.currentTarget;
          if (img.naturalWidth > 0) setRatio(img.naturalWidth / img.naturalHeight);
        }}
      />
      <img
        className={joinClass(className, "staged-sharp", ready && "is-ready")}
        src={full}
        alt=""
        aria-hidden
        decoding="async"
        ref={reveal}
        onLoad={(event) => reveal(event.currentTarget)}
      />
    </span>
  );
}

type VideoProps = {
  src: string;
  poster?: string | null;
  className?: string;
  controls?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  muted?: boolean;
  playsInline?: boolean;
  preload?: "none" | "metadata" | "auto";
  label?: string;
  scale?: boolean;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

/** Show the frame already visible in the strip, then the new video once it has a frame of its own. */
export function StagedVideo({
  src,
  poster,
  className,
  controls,
  autoPlay,
  loop,
  muted,
  playsInline,
  preload = "metadata",
  label,
  scale = false,
  onClick,
}: VideoProps) {
  const [forSrc, setForSrc] = useState(src);
  const [ready, setReady] = useState(false);
  const [still, setStill] = useState<{ url: string; ratio: number | null } | null>(() => {
    const frame = visibleVideoFrame(src);
    if (frame) return frame;
    return poster ? { url: poster, ratio: cachedRatio(poster) } : null;
  });
  if (forSrc !== src) {
    const frame = visibleVideoFrame(src);
    setForSrc(src);
    setReady(false);
    setStill(frame ? frame : poster ? { url: poster, ratio: cachedRatio(poster) } : null);
  }

  const reveal = (video: HTMLVideoElement | null) => {
    if (video && video.readyState >= 2) setReady(true);
  };
  const video = (
    <video
      className={joinClass(className, still && "staged-sharp", still && ready && "is-ready")}
      src={src}
      aria-label={label}
      poster={still?.url}
      controls={controls}
      autoPlay={autoPlay}
      loop={loop}
      muted={muted}
      playsInline={playsInline}
      preload={preload}
      ref={reveal}
      onLoadedData={(event) => reveal(event.currentTarget)}
      onClick={onClick}
    />
  );
  if (!still) return video;

  const size = scale && still.ratio ? frameSize(still.ratio) : null;
  const frame = frameProps(scale, still.ratio);
  return (
    <span className={frame.className} style={frame.style} onClick={onClick}>
      <img
        className={joinClass(className, "staged-base")}
        src={still.url}
        alt=""
        decoding="sync"
        width={size?.width}
        height={size?.height}
        onLoad={(event) => {
          const img = event.currentTarget;
          if (!still.ratio && img.naturalWidth > 0) {
            setStill({ url: still.url, ratio: img.naturalWidth / img.naturalHeight });
          }
        }}
      />
      {video}
    </span>
  );
}
