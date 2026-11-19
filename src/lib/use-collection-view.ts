import { useState } from "react";
import { api, type CollectionAsset, type StudioCollection } from "./api";
import { assetAttachNote, downloadAssets, type DeleteFilesRequest } from "./collection-assets";
import { galleryPaneView, type CollectionTab } from "./collection-view";
import type { GalleryDraftItem } from "./gallery-draft";
import type { CollectionControls } from "./use-collections";

/** What the opened collection needs from the app. Null while collections are not ready. */
export type CollectionViewControls = {
  collection: StudioCollection;
  controls: CollectionControls;
  tab: CollectionTab;
  onTab: (tab: CollectionTab) => void;
  /** Back to the Galleries list. */
  onClose: () => void;
  onDownload: (assets: CollectionAsset[]) => Promise<void>;
  /** Attaches in the order given, skipping what the current model cannot take, and says what happened. */
  onAttach: (items: GalleryDraftItem[]) => string;
  onDeleteFiles: DeleteFilesRequest;
  onDeleted: (keys: string[]) => void;
  onAssetDrag: (item: GalleryDraftItem | null) => void;
};

/**
 * Which collection is open in the Galleries pane, and the way back from a gallery opened there.
 * Kept out of App, which already holds the gallery itself (`galleryId`, `managingGallery`).
 */
export function useCollectionView(options: {
  controls: CollectionControls | null;
  paneOpen: boolean;
  managingGallery: boolean;
  galleryId: string | null;
  setManagingGallery: (value: boolean) => void;
  setTileDrag: (value: boolean) => void;
  /** Attaches gallery-style items to the prompt and answers with the names it skipped. */
  attach: (items: GalleryDraftItem[]) => string[];
  /** After files are deleted: drop them from the library, the canvas, and the open gallery. */
  afterDelete: (keys: string[]) => void;
}) {
  const { controls, setManagingGallery, setTileDrag } = options;
  const [openId, setOpenId] = useState<string | null>(null);
  const [tab, setTab] = useState<CollectionTab>("galleries");
  /** True while a gallery was the last thing open, so ⌘⇧G goes back to it. */
  const [galleryLast, setGalleryLast] = useState(false);
  const [createInto, setCreateInto] = useState<string | null>(null);
  const [dragAsset, setDragAsset] = useState<GalleryDraftItem | null>(null);

  const open = (openId && controls?.collections.find((collection) => collection.id === openId)) || null;
  const paneView = galleryPaneView({
    managingGallery: options.managingGallery,
    galleryId: options.galleryId,
    collectionOpen: Boolean(open),
  });
  const shown = options.paneOpen && paneView === "collection";

  function onClose() {
    setOpenId(null);
    setGalleryLast(false);
  }

  const view: CollectionViewControls | null =
    open && controls
      ? {
          collection: open,
          controls,
          tab,
          onTab: setTab,
          onClose,
          onDownload: (assets) => downloadAssets(assets),
          onAttach: (items) => assetAttachNote(items.length, options.attach(items).length),
          onDeleteFiles: (keys, scope) => api.deleteGalleryFiles(keys, { fromOxen: scope === "everywhere" }),
          onDeleted: options.afterDelete,
          onAssetDrag: (item) => {
            setDragAsset(item);
            setTileDrag(Boolean(item));
          },
        }
      : null;

  return {
    view,
    /** The collection view is on screen right now. */
    shown,
    /** For ⌘⇧G and the prompt's Gallery button: reopen the gallery only when it was open last. */
    resumeGallery: galleryLast,
    /** The All assets tile on its way to the prompt. */
    dragAsset,
    /** Opens a collection from the Galleries list. */
    onOpen(id: string) {
      setOpenId(id);
      setTab("galleries");
      setManagingGallery(false);
      setGalleryLast(false);
    },
    onClose,
    /** A gallery opened (true) or its Back pressed (false). The open collection stays the way back. */
    onManagingGallery(value: boolean) {
      setManagingGallery(value);
      setGalleryLast(value);
    },
    /** The plain list, from the header's Galleries button and the phone menu. */
    onList() {
      setOpenId(null);
      setGalleryLast(false);
    },
    /** Create gallery was pressed: a gallery made now goes into the collection on screen. */
    beginCreate() {
      setCreateInto(shown && open ? open.id : null);
    },
    /** Where a new gallery is filed. Null when none was open, or it has been deleted since. */
    createInto: createInto && controls?.collections.some((collection) => collection.id === createInto) ? createInto : null,
  };
}

export type CollectionNav = ReturnType<typeof useCollectionView>;
