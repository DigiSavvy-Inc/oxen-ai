import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { shortenFileName } from "../lib/files";
import {
  galleryPreviewIsImage,
  gallerySlotSrc,
  type GalleryThumbSlot,
} from "../lib/gallery-thumbs";
import { captureVideoStill } from "../lib/video-still";
import { DEFAULT_VIDEO_THUMB_SECONDS } from "../../worker/video-thumb";

type Props = {
  kind: "image" | "video" | "audio";
  name: string;
  preview: string;
  slot: GalleryThumbSlot;
};

const VideoThumbSecondsContext = createContext(DEFAULT_VIDEO_THUMB_SECONDS);

export function VideoThumbSecondsProvider({
  seconds,
  children,
}: {
  seconds: number;
  children: ReactNode;
}) {
  return <VideoThumbSecondsContext.Provider value={seconds}>{children}</VideoThumbSecondsContext.Provider>;
}

export function GalleryThumb({ kind, name, preview, slot }: Props) {
  const seconds = useContext(VideoThumbSecondsContext);
  const image = galleryPreviewIsImage(preview);
  const [still, setStill] = useState<string | null>(null);

  useEffect(() => {
    if (kind !== "video" || !preview || image) return;
    const controller = new AbortController();
    setStill(null);
    void captureVideoStill(preview, seconds, controller.signal).then((url) => {
      if (!controller.signal.aborted) setStill(url);
    });
    return () => controller.abort();
  }, [image, kind, preview, seconds]);

  if (kind === "audio" || (!image && kind !== "video")) {
    return <span className="gallery-audio">{shortenFileName(name, 12)}</span>;
  }
  if (kind === "video" && !image) {
    if (!still) return <span className="gallery-audio">Video</span>;
    return (
      <span className="gallery-video-still">
        <img src={still} alt="" draggable={false} />
        <VideoMark />
      </span>
    );
  }
  return <img src={gallerySlotSrc(preview, slot)} alt="" draggable={false} loading="lazy" />;
}

function VideoMark() {
  return (
    <span className="gallery-video-mark" aria-hidden="true">
      <svg viewBox="0 0 16 16">
        <path d="M6 4.2v7.6L12.2 8 6 4.2z" fill="currentColor" />
      </svg>
    </span>
  );
}
