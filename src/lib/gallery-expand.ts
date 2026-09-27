export type GalleryExpandState = {
  expandedId: string | null;
  previewId: string | null;
  fitOpen: boolean;
};

export type GalleryExpandAction =
  | { type: "tile"; batchId: string; count: number; openId: string; mediaType?: string | null }
  | { type: "version"; versionId: string }
  | { type: "preview" }
  | { type: "close-fit" };

/** Image sets expand once there is more than one version. A video always expands in the gallery. */
function tileOpensInGallery(action: Extract<GalleryExpandAction, { type: "tile" }>): boolean {
  return action.count > 1 || action.mediaType === "video";
}

/** `peek: undefined` leaves the attach peek alone. */
export type GalleryExpandTransition = GalleryExpandState & {
  peek: string | null | undefined;
};

export function galleryExpandTransition(
  state: GalleryExpandState,
  action: GalleryExpandAction,
): GalleryExpandTransition {
  switch (action.type) {
    case "tile": {
      if (!tileOpensInGallery(action)) {
        return {
          expandedId: null,
          previewId: null,
          fitOpen: false,
          peek: action.openId,
        };
      }
      if (state.expandedId === action.batchId) {
        return {
          expandedId: null,
          previewId: null,
          fitOpen: false,
          peek: null,
        };
      }
      return {
        expandedId: action.batchId,
        previewId: action.openId,
        fitOpen: false,
        peek: null,
      };
    }
    case "version": {
      if (!state.expandedId) return { ...state, peek: undefined };
      return {
        expandedId: state.expandedId,
        previewId: action.versionId,
        fitOpen: state.fitOpen,
        peek: undefined,
      };
    }
    case "preview": {
      if (!state.expandedId) return { ...state, peek: undefined };
      return { ...state, fitOpen: true, peek: undefined };
    }
    case "close-fit":
      return { ...state, fitOpen: false, peek: undefined };
    default: {
      const unreachable: never = action;
      return unreachable;
    }
  }
}

export function versionsBesidePreview<T extends { id: string }>(
  items: T[],
  previewId: string,
): T[] {
  return items.filter((item) => item.id !== previewId);
}
