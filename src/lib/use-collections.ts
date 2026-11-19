import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { api, type GallerySummary, type StudioCollection } from "./api";
import {
  collectionOrder,
  dropCollection,
  orderedCollections,
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

function message(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Collections for the active profile, kept beside the gallery cards App already has. The list is
 * read again whenever the cards change (a profile switch, a gallery made, renamed, deleted, or
 * filed), so counts and covers follow without a second source of truth.
 */
export function useCollections(options: {
  signedIn: boolean;
  gallerySummaries: GallerySummary[];
  setGallerySummaries: Dispatch<SetStateAction<GallerySummary[]>>;
}): CollectionControls | null {
  const { signedIn, gallerySummaries, setGallerySummaries } = options;
  const [collections, setCollections] = useState<StudioCollection[]>([]);
  const [ready, setReady] = useState(false);
  const [folded, setFolded] = useState<string[]>(() => readFolded());
  const [status, setStatus] = useState<string | null>(null);
  const request = useRef(0);

  const reload = useCallback(async () => {
    const ticket = ++request.current;
    try {
      const data = await api.collections();
      if (ticket !== request.current) return;
      setCollections(data.collections);
      setReady(data.ready);
    } catch {
      if (ticket !== request.current) return;
      // A failed read shows today's screen rather than a half-working one.
      setCollections([]);
      setReady(false);
    }
  }, []);

  useEffect(() => {
    if (!signedIn) {
      request.current += 1;
      setCollections([]);
      setReady(false);
      return;
    }
    void reload();
  }, [signedIn, gallerySummaries, reload]);

  const onToggleFold = useCallback((id: string) => {
    setFolded((current) => {
      const next = toggleFolded(current, id);
      storeFolded(next);
      return next;
    });
  }, []);

  async function onCreate(name: string): Promise<StudioCollection | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    setStatus(null);
    try {
      const { collection } = await api.createCollection(trimmed);
      setCollections((current) => [...current, collection]);
      return collection;
    } catch (err) {
      setStatus(message(err, "Couldn’t make that collection"));
      return null;
    }
  }

  async function onRename(id: string, name: string): Promise<boolean> {
    const trimmed = name.trim();
    if (!trimmed) return false;
    setStatus(null);
    try {
      const { collection } = await api.updateCollection(id, { name: trimmed });
      setCollections((current) => current.map((item) => (item.id === id ? collection : item)));
      return true;
    } catch (err) {
      setStatus(message(err, "Couldn’t rename that collection"));
      return false;
    }
  }

  async function onDelete(id: string): Promise<boolean> {
    setStatus(null);
    try {
      await api.deleteCollection(id);
      setCollections((current) => current.filter((item) => item.id !== id));
      setGallerySummaries((current) => ungroupCollection(current, id));
      setFolded((current) => {
        if (!current.includes(id)) return current;
        const next = current.filter((item) => item !== id);
        storeFolded(next);
        return next;
      });
      return true;
    } catch (err) {
      setStatus(message(err, "Couldn’t delete that collection"));
      return false;
    }
  }

  function saveOrder(ids: string[] | null) {
    if (!ids) return;
    const before = collections;
    setStatus(null);
    setCollections(orderedCollections(collections, ids));
    void api.orderCollections(ids).catch((err: unknown) => {
      setCollections(before);
      setStatus(message(err, "Couldn’t save the order"));
    });
  }

  function onStep(id: string, step: -1 | 1) {
    saveOrder(stepCollection(collectionOrder(collections), id, step));
  }

  function onDropOn(dragId: string, targetId: string) {
    saveOrder(dropCollection(collectionOrder(collections), dragId, targetId));
  }

  async function onFile(galleryId: string, collectionId: string | null): Promise<boolean> {
    const current = gallerySummaries.find((gallery) => gallery.id === galleryId);
    if (!current || (current.collectionId ?? null) === collectionId) return true;
    setStatus(null);
    try {
      await api.fileGallery(galleryId, collectionId);
      setGallerySummaries((list) => withGalleryCollection(list, galleryId, collectionId));
      return true;
    } catch (err) {
      setStatus(message(err, "Couldn’t move that gallery"));
      return false;
    }
  }

  async function onFileNew(galleryId: string, name: string): Promise<boolean> {
    const collection = await onCreate(name);
    if (!collection) return false;
    return onFile(galleryId, collection.id);
  }

  if (!signedIn || !ready) return null;
  return {
    collections,
    folded: new Set(folded),
    status,
    onToggleFold,
    onCreate,
    onRename,
    onDelete,
    onStep,
    onDropOn,
    onFile,
    onFileNew,
  };
}
