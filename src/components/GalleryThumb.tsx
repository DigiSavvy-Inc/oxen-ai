import { shortenFileName } from "../lib/files";
import {
  galleryPreviewIsImage,
  gallerySlotSrc,
  type GalleryThumbSlot,
} from "../lib/gallery-thumbs";

type Props = {
  kind: "image" | "video" | "audio";
  name: string;
  preview: string;
  slot: GalleryThumbSlot;
};

export function GalleryThumb({ kind, name, preview, slot }: Props) {
  if (kind === "audio" || !galleryPreviewIsImage(preview)) {
    return (
      <span className="gallery-audio">{kind === "video" ? "Video" : shortenFileName(name, 12)}</span>
    );
  }
  return <img src={gallerySlotSrc(preview, slot)} alt="" draggable={false} loading="lazy" />;
}
