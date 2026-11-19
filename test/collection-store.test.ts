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
    updateCollection: vi.fn(async (id: string, patch: { name?: string }) => ({
      collection: { ...collection(id), name: patch.name ?? id },
    })),
    deleteCollection: vi.fn(async () => ({ ok: true })),
    orderCollections: vi.fn(async (ids: string[]) => ({ ids })),
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

describe("collection order", () => {
  const three = () => [collection("a", 0), collection("b", 1), collection("c", 2)];

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
