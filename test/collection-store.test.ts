import { describe, expect, it, vi } from "vitest";
import type { StudioCollection } from "../src/lib/api";
import { createCollectionStore, type CollectionClient } from "../src/lib/collection-store";

function collection(id: string, position = 0): StudioCollection {
  return { id, name: id, position, updatedAt: 0, galleryIds: [], itemCount: 0, cover: null };
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function fakeClient(list: StudioCollection[] = []) {
  const client = {
    collections: vi.fn(async () => ({ collections: list, ready: true })),
    createCollection: vi.fn(async (name: string) => ({ collection: collection(`c-${name}`, list.length) })),
    updateCollection: vi.fn(async (id: string, patch: { name?: string; coverKey?: string | null }) => ({
      collection: {
        ...collection(id),
        name: patch.name ?? id,
        cover: patch.coverKey
          ? { key: patch.coverKey, kind: "image" as const, thumbUrl: null, chosen: true }
          : null,
      },
    })),
    deleteCollection: vi.fn(async () => ({ ok: true })),
    orderCollections: vi.fn(async (ids: string[]) => ({ ids })),
    orderCollectionGalleries: vi.fn(async (_id: string, galleryIds: string[]) => ({ galleryIds })),
    fileGallery: vi.fn(async () => ({ ok: true })),
  } satisfies CollectionClient;
  return client;
}

const ids = (store: ReturnType<typeof createCollectionStore>) => store.getState().collections.map((item) => item.id);

describe("collection reads", () => {
  it("keeps only the newest read when two are in flight", async () => {
    const client = fakeClient();
    const first = deferred<{ collections: StudioCollection[]; ready: boolean }>();
    const second = deferred<{ collections: StudioCollection[]; ready: boolean }>();
    client.collections.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const store = createCollectionStore(client);
    void store.refresh("p1");
    void store.refresh("p1");
    second.resolve({ collections: [collection("new")], ready: true });
    await flush();
    first.resolve({ collections: [collection("old")], ready: true });
    await flush();
    expect(ids(store)).toEqual(["new"]);
  });

  it("keeps the list on screen when a later read fails, instead of dropping to today's screen", async () => {
    const client = fakeClient([collection("a")]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    client.collections.mockRejectedValueOnce(new Error("offline"));
    await store.refresh("p1");
    expect(store.getState().ready).toBe(true);
    expect(ids(store)).toEqual(["a"]);
  });

  it("stays on today's screen when the first read fails or the migration is not applied", async () => {
    const client = fakeClient();
    client.collections.mockRejectedValueOnce(new Error("offline"));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(store.getState().ready).toBe(false);
    client.collections.mockResolvedValueOnce({ collections: [], ready: false });
    await store.refresh("p1");
    expect(store.getState().ready).toBe(false);
  });

  it("never shows one profile's collections on another, even while the new read is out", async () => {
    const client = fakeClient([collection("mine")]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const pending = deferred<{ collections: StudioCollection[]; ready: boolean }>();
    client.collections.mockReturnValueOnce(pending.promise);
    void store.refresh("p2");
    expect(store.getState()).toMatchObject({ scope: "p2", ready: false, collections: [] });
    pending.resolve({ collections: [], ready: true });
    await flush();
    expect(store.getState()).toMatchObject({ scope: "p2", ready: true, collections: [] });
  });

  it("reads again when a write lands while an older read is out, so the write is not undone", async () => {
    const client = fakeClient([]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const stale = deferred<{ collections: StudioCollection[]; ready: boolean }>();
    client.collections.mockReturnValueOnce(stale.promise);
    void store.refresh("p1");
    client.collections.mockResolvedValueOnce({ collections: [collection("c-Shoot")], ready: true });
    await store.create("Shoot");
    stale.resolve({ collections: [], ready: true });
    await flush();
    expect(ids(store)).toEqual(["c-Shoot"]);
    expect(client.collections).toHaveBeenCalledTimes(3);
  });

  it("clears everything on sign-out", async () => {
    const store = createCollectionStore(fakeClient([collection("a")]));
    await store.refresh("p1");
    await store.refresh(null);
    expect(store.getState()).toMatchObject({ scope: null, ready: false, collections: [] });
  });
});

describe("New collection from Move to collection", () => {
  it("deletes the new collection again when filing the gallery fails", async () => {
    const client = fakeClient([collection("a")]);
    client.fileGallery.mockRejectedValueOnce(new Error("That gallery is on another profile."));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const made = await store.fileNew("g1", "Shoot");
    expect(made).toBeNull();
    expect(client.deleteCollection).toHaveBeenCalledWith("c-Shoot");
    expect(ids(store)).toEqual(["a"]);
    expect(store.getState().status).toBe("That gallery is on another profile.");
  });

  it("keeps the collection on screen when the clean-up delete also fails, since it still exists", async () => {
    const client = fakeClient([]);
    client.fileGallery.mockRejectedValueOnce(new Error("nope"));
    client.deleteCollection.mockRejectedValueOnce(new Error("offline"));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(await store.fileNew("g1", "Shoot")).toBeNull();
    expect(ids(store)).toEqual(["c-Shoot"]);
  });

  it("files the gallery into the new collection on success", async () => {
    const client = fakeClient([]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect((await store.fileNew("g1", "Shoot"))?.id).toBe("c-Shoot");
    expect(client.fileGallery).toHaveBeenCalledWith("g1", "c-Shoot");
    expect(client.deleteCollection).not.toHaveBeenCalled();
  });
});

describe("collection cover", () => {
  it("sets the cover and shows the collection the server sends back, so the list cover changes", async () => {
    const client = fakeClient([collection("a"), collection("b")]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(await store.setCover("a", "u/1/pick.png")).toBe(true);
    expect(client.updateCollection).toHaveBeenCalledWith("a", { coverKey: "u/1/pick.png" });
    expect(store.getState().collections[0].cover).toMatchObject({ key: "u/1/pick.png", chosen: true });
    expect(store.getState().collections[1].cover).toBeNull();
  });

  it("resets with null, which goes back to the automatic cover", async () => {
    const client = fakeClient([collection("a")]);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    await store.setCover("a", "u/1/pick.png");
    expect(await store.setCover("a", null)).toBe(true);
    expect(client.updateCollection).toHaveBeenLastCalledWith("a", { coverKey: null });
    expect(store.getState().collections[0].cover).toBeNull();
  });

  it("keeps the cover on screen and says why when the save fails", async () => {
    const client = fakeClient([collection("a")]);
    client.updateCollection.mockRejectedValueOnce(new Error("That file is not in this collection."));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(await store.setCover("a", "u/1/gone.png")).toBe(false);
    expect(store.getState().collections[0].cover).toBeNull();
    expect(store.getState().status).toBe("That file is not in this collection.");
  });
});

describe("collection order", () => {
  const three =() => [collection("a", 0), collection("b", 1), collection("c", 2)];

  it("rolls back to the last saved order when a save fails", async () => {
    const client = fakeClient(three());
    client.orderCollections.mockRejectedValueOnce(new Error("Couldn’t save the order"));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    store.order(["b", "a", "c"]);
    expect(ids(store)).toEqual(["b", "a", "c"]);
    await flush();
    expect(ids(store)).toEqual(["a", "b", "c"]);
    expect(store.getState().status).toBe("Couldn’t save the order");
  });

  it("sends one save at a time, and a failed older save does not undo a newer order", async () => {
    const client = fakeClient(three());
    const first = deferred<unknown>();
    client.orderCollections.mockReturnValueOnce(first.promise);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    store.order(["b", "a", "c"]);
    store.order(["c", "b", "a"]);
    expect(client.orderCollections).toHaveBeenCalledTimes(1);
    first.reject(new Error("blip"));
    await flush();
    expect(client.orderCollections).toHaveBeenLastCalledWith(["c", "b", "a"]);
    expect(ids(store)).toEqual(["c", "b", "a"]);
    expect(store.getState().status).toBeNull();
  });

  it("rolls a failed newer save back to the older order that did save", async () => {
    const client = fakeClient(three());
    const first = deferred<unknown>();
    client.orderCollections.mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error("blip"));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    store.order(["b", "a", "c"]);
    store.order(["c", "b", "a"]);
    first.resolve({ ids: ["b", "a", "c"] });
    await flush();
    expect(ids(store)).toEqual(["b", "a", "c"]);
  });

  it("keeps the chosen order when a read lands while the save is still going out", async () => {
    const client = fakeClient(three());
    const save = deferred<unknown>();
    client.orderCollections.mockReturnValueOnce(save.promise);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    store.order(["c", "a", "b"]);
    await store.refresh("p1");
    expect(ids(store)).toEqual(["c", "a", "b"]);
    save.resolve({ ids: ["c", "a", "b"] });
    await flush();
  });
});

describe("gallery order inside a collection", () => {
  const filed = (): StudioCollection[] => [{ ...collection("c"), galleryIds: ["g1", "g2", "g3"] }];
  const galleryIds = (store: ReturnType<typeof createCollectionStore>) =>
    store.getState().collections.find((item) => item.id === "c")?.galleryIds;

  it("shows a dragged order at once and saves it with the small order route", async () => {
    const client = fakeClient(filed());
    const save = deferred<unknown>();
    client.orderCollectionGalleries.mockReturnValueOnce(save.promise);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const done = store.orderGalleries("c", ["g3", "g1", "g2"]);
    expect(galleryIds(store)).toEqual(["g3", "g1", "g2"]);
    save.resolve({ galleryIds: ["g3", "g1", "g2"] });
    expect(await done).toBe(true);
    expect(client.orderCollectionGalleries).toHaveBeenCalledWith("c", ["g3", "g1", "g2"]);
    // Ordering never rewrites or refiles a gallery.
    expect(client.fileGallery).not.toHaveBeenCalled();
  });

  it("puts the old order back and says so when the save fails", async () => {
    const client = fakeClient(filed());
    client.orderCollectionGalleries.mockRejectedValueOnce(new Error("offline"));
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(await store.orderGalleries("c", ["g2", "g1", "g3"])).toBe(false);
    expect(galleryIds(store)).toEqual(["g1", "g2", "g3"]);
    expect(store.getState().status).toBe("offline");
  });

  it("keeps a newer order when an older save fails, then saves the newer one", async () => {
    const client = fakeClient(filed());
    const first = deferred<unknown>();
    client.orderCollectionGalleries.mockReturnValueOnce(first.promise);
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const older = store.orderGalleries("c", ["g2", "g1", "g3"]);
    const newer = store.orderGalleries("c", ["g3", "g2", "g1"]);
    first.reject(new Error("blip"));
    expect(await older).toBe(false);
    expect(await newer).toBe(true);
    expect(galleryIds(store)).toEqual(["g3", "g2", "g1"]);
    expect(client.orderCollectionGalleries).toHaveBeenLastCalledWith("c", ["g3", "g2", "g1"]);
    expect(store.getState().status).toBeNull();
  });

  it("sends rapid moves one at a time so the server ends on the newest order", async () => {
    const client = fakeClient(filed());
    const first = deferred<unknown>();
    let active = 0;
    let most = 0;
    client.orderCollectionGalleries.mockImplementation(async (_id: string, ids: string[]) => {
      active += 1;
      most = Math.max(most, active);
      // The first save is slow; if the later ones went out beside it, it would land last.
      if (client.orderCollectionGalleries.mock.calls.length === 1) await first.promise;
      active -= 1;
      return { galleryIds: ids };
    });
    const store = createCollectionStore(client);
    await store.refresh("p1");
    const a = store.orderGalleries("c", ["g2", "g1", "g3"]);
    const b = store.orderGalleries("c", ["g3", "g1", "g2"]);
    const c = store.orderGalleries("c", ["g1", "g3", "g2"]);
    expect(client.orderCollectionGalleries).toHaveBeenCalledTimes(1);
    first.resolve({});
    expect(await Promise.all([a, b, c])).toEqual([true, true, true]);
    expect(most).toBe(1);
    // The replaced middle order is never sent; the newest goes last.
    expect(client.orderCollectionGalleries.mock.calls.map((call) => call[1])).toEqual([
      ["g2", "g1", "g3"],
      ["g1", "g3", "g2"],
    ]);
    expect(galleryIds(store)).toEqual(["g1", "g3", "g2"]);
  });

  it("does nothing for a collection that is not listed", async () => {
    const client = fakeClient(filed());
    const store = createCollectionStore(client);
    await store.refresh("p1");
    expect(await store.orderGalleries("gone", ["g1"])).toBe(false);
    expect(client.orderCollectionGalleries).not.toHaveBeenCalled();
  });
});
