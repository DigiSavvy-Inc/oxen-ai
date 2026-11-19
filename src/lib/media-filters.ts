import type { LibraryMediaFilter } from "./api";

/** The All / Images / Videos / Audio filter, in the order past work shows it. */
export const MEDIA_FILTERS: { id: LibraryMediaFilter; label: string }[] = [
  { id: "", label: "All" },
  { id: "image", label: "Images" },
  { id: "video", label: "Videos" },
  { id: "audio", label: "Audio" },
];
