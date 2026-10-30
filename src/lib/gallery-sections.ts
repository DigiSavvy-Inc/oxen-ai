import { referenceRoleUsesFace } from "../../worker/schema";

export type GallerySectionId =
  | "image-faces"
  | "image-scene"
  | "video-faces"
  | "video-scene"
  | "audio";

export type GallerySection<T> = {
  id: GallerySectionId;
  title: string;
  note: string;
  label: string;
  items: { item: T; index: number }[];
};

type SectionItem = {
  kind: "image" | "video" | "audio";
  role?: string | null;
};

const ORDER: { id: GallerySectionId; title: string; note: string; label: string }[] = [
  {
    id: "image-faces",
    title: "Images",
    note: "Faces and characters",
    label: "Images, faces and characters",
  },
  {
    id: "image-scene",
    title: "Backgrounds, objects, styles",
    note: "Images",
    label: "Backgrounds, objects, and styles, images",
  },
  {
    id: "video-faces",
    title: "Videos",
    note: "Faces and characters",
    label: "Videos, faces and characters",
  },
  {
    id: "video-scene",
    title: "Backgrounds, objects, styles",
    note: "Videos",
    label: "Backgrounds, objects, and styles, videos",
  },
  {
    id: "audio",
    title: "Audio",
    note: "",
    label: "Audio",
  },
];

function sectionId(item: SectionItem): GallerySectionId {
  switch (item.kind) {
    case "audio":
      return "audio";
    case "image":
      return referenceRoleUsesFace(item.role) ? "image-faces" : "image-scene";
    case "video":
      return referenceRoleUsesFace(item.role) ? "video-faces" : "video-scene";
    default: {
      const unreachable: never = item.kind;
      return unreachable;
    }
  }
}

/** Group a flat gallery into image, scene, video, and audio sections. Empty groups are omitted. */
export function gallerySections<T extends SectionItem>(items: readonly T[]): GallerySection<T>[] {
  const buckets = new Map<GallerySectionId, { item: T; index: number }[]>();
  items.forEach((item, index) => {
    const id = sectionId(item);
    const list = buckets.get(id);
    if (list) list.push({ item, index });
    else buckets.set(id, [{ item, index }]);
  });
  return ORDER.flatMap((section) => {
    const grouped = buckets.get(section.id);
    if (!grouped || grouped.length === 0) return [];
    return [{ ...section, items: grouped }];
  });
}
