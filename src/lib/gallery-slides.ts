export type GallerySwipeItem = {
  id: string;
  kind: "image" | "video" | "audio";
  name: string;
  url: string;
  preview?: string;
};

export type GallerySwipeSlide = {
  id: string;
  src: string;
  alt: string;
  mediaType: "image" | "video";
  poster: string | null;
};

/** Images and videos in gallery order. Audio stays in the small player. */
export function gallerySwipeSlides(items: readonly GallerySwipeItem[]): GallerySwipeSlide[] {
  const slides: GallerySwipeSlide[] = [];
  for (const item of items) {
    if (!item.url) continue;
    if (item.kind !== "image" && item.kind !== "video") continue;
    slides.push({
      id: item.id,
      src: item.url,
      alt: item.name,
      mediaType: item.kind,
      poster: item.preview || null,
    });
  }
  return slides;
}
