import type { StudioCollection } from "./api";
import { collectionOrder, orderedCollections } from "./collections";

/** The collection calls the store makes. `api` in the app, a fake in tests. */
export type CollectionClient = {
  collections: () => Promise<{ collections: StudioCollection[]; ready: boolean }>;
  createCollection: (name: string) => Promise<{ collection: StudioCollection }>;
  updateCollection: (id: string, patch: { name?: string }) => Promise<{ collection: StudioCollection }>;
  deleteCollection: (id: string) => Promise<unknown>;
  orderCollections: (ids: string[]) => Promise<unknown>;
  orderCollectionGalleries: (id: string, galleryIds: string[]) => Promise<unknown>;
  fileGallery: (galleryId: string, collectionId: string | null) => Promise<unknown>;
};

export type CollectionState = {
  /** Who the list belongs to: the active profile while signed in, null when signed out. */
  scope: string | null;
  collections: StudioCollection[];
  ready: boolean;
  status: string | null;
};

function message(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/**
 * Collections for one profile, outside React so the request ordering can be tested.
 * - Only the newest read lands. A read that was in flight while a write finished is read again,
 *   so it cannot put back a list from before the write.
 * - A failed read keeps the list already on screen; only a first read that fails leaves today's
 *   screen.
 * - Order saves go one at a time. A failed save rolls back to the last saved order unless a newer
 *   order is already waiting to go.
 */
export function createCollectionStore(client: CollectionClient) {
  let state: CollectionState = { scope: null, collections: [], ready: false, status: null };
  const listeners = new Set<() => void>();
  let readTicket = 0;
  let reading = false;
  let savedOrder: string[] = [];
  let orderSending = false;
  let orderWaiting: string[] | null = null;

  function set(patch: Partial<CollectionState>) {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  async function read(scope: string) {
    const ticket = ++readTicket;
    reading = true;
    try {
      const data = await client.collections();
      if (ticket !== readTicket) return;
      reading = false;
      const orderBusy = orderSending || orderWaiting !== null;
      if (!orderBusy) savedOrder = collectionOrder(data.collections);
      // While an order save is going out, keep the order the user just chose.
      const collections = orderBusy
        ? orderedCollections(data.collections, collectionOrder(state.collections))
        : data.collections;
      set({ scope, collections, ready: data.ready });
    } catch {
      if (ticket !== readTicket) return;
      reading = false;
      if (!state.ready) set({ scope, collections: [], ready: false });
    }
  }

  /** After a write: a read that started before it finished could be stale, so read again. */
  function afterWrite() {
    if (reading && state.scope !== null) void read(state.scope);
  }

  function sameScope(scope: string | null) {
    return scope !== null && state.scope === scope;
  }

  async function sendOrder(ids: string[]) {
    const scope = state.scope;
    orderSending = true;
    try {
      await client.orderCollections(ids);
      if (!sameScope(scope)) return;
      savedOrder = ids;
    } catch (err) {
      if (!sameScope(scope)) return;
      if (!orderWaiting) {
        set({
          collections: orderedCollections(state.collections, savedOrder),
          status: message(err, "Couldn’t save the order"),
        });
      }
    } finally {
      orderSending = false;
    }
    const next = orderWaiting;
    orderWaiting = null;
    if (next && sameScope(scope)) await sendOrder(next);
    else afterWrite();
  }

  async function create(name: string): Promise<StudioCollection | null> {
    const trimmed = name.trim();
    const scope = state.scope;
    if (!trimmed || scope === null) return null;
    set({ status: null });
    try {
      const { collection } = await client.createCollection(trimmed);
      if (!sameScope(scope)) return null;
      set({ collections: [...state.collections, collection] });
      afterWrite();
      return collection;
    } catch (err) {
      if (sameScope(scope)) set({ status: message(err, "Couldn’t make that collection") });
      return null;
    }
  }

  async function file(galleryId: string, collectionId: string | null): Promise<boolean> {
    const scope = state.scope;
    set({ status: null });
    try {
      await client.fileGallery(galleryId, collectionId);
      afterWrite();
      return sameScope(scope);
    } catch (err) {
      if (sameScope(scope)) set({ status: message(err, "Couldn’t move that gallery") });
      return false;
    }
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,

    /** Reads the list for a profile, or clears it with null. A new profile starts on today's screen. */
    refresh(scope: string | null) {
      if (scope === null) {
        readTicket += 1;
        reading = false;
        if (state.scope !== null || state.ready) set({ scope: null, collections: [], ready: false, status: null });
        return Promise.resolve();
      }
      if (state.scope !== scope) {
        orderWaiting = null;
        set({ scope, collections: [], ready: false, status: null });
      }
      return read(scope);
    },

    create,

    async rename(id: string, name: string): Promise<boolean> {
      const trimmed = name.trim();
      const scope = state.scope;
      if (!trimmed || scope === null) return false;
      set({ status: null });
      try {
        const { collection } = await client.updateCollection(id, { name: trimmed });
        if (!sameScope(scope)) return false;
        set({ collections: state.collections.map((item) => (item.id === id ? collection : item)) });
        afterWrite();
        return true;
      } catch (err) {
        if (sameScope(scope)) set({ status: message(err, "Couldn’t rename that collection") });
        return false;
      }
    },

    async remove(id: string): Promise<boolean> {
      const scope = state.scope;
      if (scope === null) return false;
      set({ status: null });
      try {
        await client.deleteCollection(id);
        if (!sameScope(scope)) return false;
        savedOrder = savedOrder.filter((item) => item !== id);
        set({ collections: state.collections.filter((item) => item.id !== id) });
        afterWrite();
        return true;
      } catch (err) {
        if (sameScope(scope)) set({ status: message(err, "Couldn’t delete that collection") });
        return false;
      }
    },

    /** Shows the new order at once and saves it, one request at a time. */
    order(ids: string[] | null) {
      if (!ids || state.scope === null) return;
      set({ collections: orderedCollections(state.collections, ids), status: null });
      if (orderSending) {
        orderWaiting = ids;
        return;
      }
      void sendOrder(ids);
    },

    file,

    /**
     * Shows a new order of galleries inside one collection at once and saves it. A failed save
     * puts back the order from before, unless a newer order has been chosen since.
     */
    async orderGalleries(collectionId: string, galleryIds: string[]): Promise<boolean> {
      const scope = state.scope;
      const before = state.collections.find((item) => item.id === collectionId);
      if (!before || scope === null) return false;
      const withIds = (ids: string[]) =>
        state.collections.map((item) => (item.id === collectionId ? { ...item, galleryIds: ids } : item));
      set({ collections: withIds(galleryIds), status: null });
      try {
        await client.orderCollectionGalleries(collectionId, galleryIds);
        afterWrite();
        return sameScope(scope);
      } catch (err) {
        if (!sameScope(scope)) return false;
        const now = state.collections.find((item) => item.id === collectionId);
        if (now && now.galleryIds.join("\0") === galleryIds.join("\0")) {
          set({ collections: withIds(before.galleryIds), status: message(err, "Couldn’t save the order") });
        } else {
          set({ status: message(err, "Couldn’t save the order") });
        }
        return false;
      }
    },

    /**
     * Makes a collection and files the gallery into it. If filing fails the new collection is
     * deleted again, so a failed move never leaves an empty collection behind.
     */
    async fileNew(galleryId: string, name: string): Promise<StudioCollection | null> {
      const collection = await create(name);
      if (!collection) return null;
      if (await file(galleryId, collection.id)) return collection;
      const failed = state.status;
      try {
        await client.deleteCollection(collection.id);
        if (state.scope !== null) {
          savedOrder = savedOrder.filter((item) => item !== collection.id);
          set({ collections: state.collections.filter((item) => item.id !== collection.id), status: failed });
        }
      } catch {
        // The collection is still on the server, so it stays on screen and the move failure shows.
      }
      return null;
    },
  };
}

export type CollectionStore = ReturnType<typeof createCollectionStore>;
