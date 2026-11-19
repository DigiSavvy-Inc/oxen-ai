import { useCallback, useEffect, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from "react";
import { api, type GallerySummary, type StudioCollection } from "./api";
import { createCollectionStore } from "./collection-store";
import {
  collectionOrder,
  collectionWatchKey,
  dropCollection,
  readFolded,
  stepCollection,
  storeFolded,
  toggleFolded,
  ungroupCollection,
  withGalleryCollection,
} from "./collections";

/** Everything the grouped Galleries screen needs. Null from the hook while collections are not ready. */
export type CollectionControls = {
  collections: StudioCollection[];
  folded: ReadonlySet<string>;
  status: string | null;
  onToggleFold: (id: string) => void;
  onCreate: (name: string) => Promise<StudioCollection | null>;
  onRename: (id: string, name: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onStep: (id: string, step: -1 | 1) => void;
  onDropOn: (dragId: string, targetId: string) => void;
  /** Files a gallery into a collection, or takes it out with null. */
  onFile: (galleryId: string, collectionId: string | null) => Promise<boolean>;
  /** Makes a collection and files the gallery into it. */
  onFileNew: (galleryId: string, name: string) => Promise<boolean>;
};

/**
 * Collections for the active profile, kept beside the gallery cards App already has. The list is
 * read when the profile changes, and again only when a filed gallery's count or first preview
 * changes (`collectionWatchKey`), so a rename or an ungrouped gallery's save sends no request.
 */
export function useCollections(options: {
  signedIn: boolean;
  profileId: string | null;
  gallerySummaries: GallerySummary[];
  setGallerySummaries: Dispatch<SetStateAction<GallerySummary[]>>;
}): CollectionControls | null {
  const { signedIn, profileId, gallerySummaries, setGallerySummaries } = options;
  const [store] = useState(() => createCollectionStore(api));
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const [folded, setFolded] = useState<string[]>(() => readFolded());
  const scope = signedIn ? `profile:${profileId ?? ""}` : null;
  const watch = collectionWatchKey(gallerySummaries);

  useEffect(() => {
    void store.refresh(scope);
  }, [store, scope, watch]);

  const onToggleFold = useCallback((id: string) => {
    setFolded((current) => {
      const next = toggleFolded(current, id);
      storeFolded(next);
      return next;
    });
  }, []);

  async function onDelete(id: string): Promise<boolean> {
    if (!(await store.remove(id))) return false;
    setGallerySummaries((current) => ungroupCollection(current, id));
    setFolded((current) => {
      if (!current.includes(id)) return current;
      const next = current.filter((item) => item !== id);
      storeFolded(next);
      return next;
    });
    return true;
  }

  async function onFile(galleryId: string, collectionId: string | null): Promise<boolean> {
    const current = gallerySummaries.find((gallery) => gallery.id === galleryId);
    if (!current || (current.collectionId ?? null) === collectionId) return true;
    if (!(await store.file(galleryId, collectionId))) return false;
    setGallerySummaries((list) => withGalleryCollection(list, galleryId, collectionId));
    return true;
  }

  async function onFileNew(galleryId: string, name: string): Promise<boolean> {
    if (!gallerySummaries.some((gallery) => gallery.id === galleryId)) return false;
    const created = await store.fileNew(galleryId, name);
    if (!created) return false;
    setGallerySummaries((list) => withGalleryCollection(list, galleryId, created.id));
    return true;
  }

  if (scope === null || state.scope !== scope || !state.ready) return null;
  return {
    collections: state.collections,
    folded: new Set(folded),
    status: state.status,
    onToggleFold,
    onCreate: store.create,
    onRename: store.rename,
    onDelete,
    onStep: (id, step) => store.order(stepCollection(collectionOrder(store.getState().collections), id, step)),
    onDropOn: (dragId, targetId) =>
      store.order(dropCollection(collectionOrder(store.getState().collections), dragId, targetId)),
    onFile,
    onFileNew,
  };
}
