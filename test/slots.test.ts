import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { deleteGallery, GalleryRejected, saveGallery } from "../worker/galleries";
import { createProject, deleteProject, getProject, readShare, createShare } from "../worker/projects";
import {
  appendSlotFiles,
  createSlot,
  deleteSlot,
  forgetSlotFiles,
  listSlots,
  saveProjectSlotsAsGallery,
  saveSlotAsGallery,
  SLOT_FILES_MAX,
  SlotRejected,
  updateSlot,
} from "../worker/slots";
import type { Env } from "../worker/types";

const USER = "u1";
const PROFILE = "profile-1";

function openDb() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = OFF");
  const files = readdirSync(new URL("../migrations", import.meta.url))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  }
  raw
    .prepare(
      `INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`,
    )
    .run(USER);
  raw
    .prepare(`INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES (?, ?, 'Main', 1, 1)`)
    .run(PROFILE, USER);
  const statement = (sql: string, args: unknown[]) => ({
    async first() {
      return raw.prepare(sql).get(...(args as (string | number | null)[])) ?? null;
    },
    async all() {
      return { results: raw.prepare(sql).all(...(args as (string | number | null)[])) };
    },
    async run() {
      const info = raw.prepare(sql).run(...(args as (string | number | null)[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  const db = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => statement(sql, args), ...statement(sql, []) };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      for (const item of statements) await item.run();
      return [];
    },
  } as unknown as D1Database;
  const env = {
    DB: db,
    PUBLIC_BASE_URL: "https://studio.test",
    ENCRYPTION_KEY: "test-encryption-key",
    MEDIA_SIGNING_KEY: "test-signing-key",
    MEDIA: { get: async () => null },
  } as unknown as Env;
  return { raw, env };
}

function image(name: string, key: string, label?: string) {
  return { kind: "image" as const, name, key: `u/${USER}/${key}`, label: label ?? null, role: "character" as const };
}

describe("slots", () => {
  it("keeps a project slot off the prompt until that project is open, and lets it win", async () => {
    const { env } = openDb();
    const projectId = await createProject(env.DB, USER, PROFILE, "Film");
    const everywhere = await createSlot(env, USER, PROFILE, {
      name: "Maya",
      files: [image("wide.png", "wide.png")],
      note: "everywhere",
    });
    const project = await createSlot(env, USER, PROFILE, {
      name: "Maya",
      projectId,
      files: [image("close.png", "close.png")],
      note: "on set",
    });
    expect(everywhere?.projectId).toBeNull();
    expect(project?.projectId).toBe(projectId);
    expect(everywhere?.handle).toBe("Maya");
    expect(project?.handle).toBe("Maya");
    const listed = await listSlots(env, USER, PROFILE);
    expect(listed.find((slot) => slot.id === project?.id)?.files.map((file) => file.name)).toEqual(["close.png"]);
    const detail = await getProject(env, USER, projectId);
    expect(detail?.slotHandles).toEqual(["Maya"]);
    expect(detail && "slots" in detail).toBe(false);
  });

  it("rejects a shared handle in either namespace and a move onto a taken everywhere handle", async () => {
    const { env } = openDb();
    await saveGallery(env.DB, USER, {
      name: "Loft",
      handle: "Loft",
      items: [image("floor.png", "floor.png")],
      profileId: PROFILE,
    });
    await expect(createSlot(env, USER, PROFILE, { name: "Loft", handle: "Loft" })).rejects.toThrow(
      /gallery on this profile already uses that handle/,
    );
    const projectId = await createProject(env.DB, USER, PROFILE, "Film");
    const scoped = await createSlot(env, USER, PROFILE, { name: "Loft", handle: "Loft", projectId });
    expect(scoped?.handle).toBe("Loft");
    await expect(updateSlot(env, USER, PROFILE, scoped!.id, { projectId: null })).rejects.toThrow(
      /gallery on this profile already uses that handle/,
    );
    await createSlot(env, USER, PROFILE, { name: "Skin", note: "warm" });
    await expect(saveGallery(env.DB, USER, { name: "Skin", handle: "Skin", items: [], profileId: PROFILE })).rejects.toBeInstanceOf(
      GalleryRejected,
    );
    await expect(createSlot(env, USER, PROFILE, { name: "Other", handle: "Skin" })).rejects.toThrow(
      /slot on this profile already uses that handle/,
    );
    await expect(createSlot(env, USER, PROFILE, { name: "Nope", note: "has @Maya" })).rejects.toThrow(
      /A note can’t contain @/,
    );
  });

  it("saves a slot as a gallery, cleans deleted files, and drops project slots with the project", async () => {
    const { env } = openDb();
    const projectId = await createProject(env.DB, USER, PROFILE, "Film");
    const slot = await createSlot(env, USER, PROFILE, {
      name: "Cast",
      projectId,
      files: [image("a.png", "a.png", "wide"), image("b.png", "b.png")],
    });
    const saved = await saveSlotAsGallery(env, USER, PROFILE, slot!.id);
    expect(saved?.slot.galleryId).toBeTruthy();
    expect(saved?.slot.files.length).toBe(2);
    const crowd = await createSlot(env, USER, PROFILE, {
      name: "Crowd",
      projectId,
      files: [image("c.png", "c.png")],
    });
    const packed = await saveProjectSlotsAsGallery(env, USER, PROFILE, projectId);
    expect(packed?.omitted).toBe(0);
    await forgetSlotFiles(env.DB, USER, [`u/${USER}/c.png`]);
    const after = await listSlots(env, USER, PROFILE);
    expect(after.find((item) => item.id === crowd?.id)?.files).toEqual([]);
    const kept = await createSlot(env, USER, PROFILE, { name: "Skin", note: "warm" });
    await deleteProject(env.DB, USER, projectId);
    const left = await listSlots(env, USER, PROFILE);
    expect(left.find((item) => item.projectId === projectId)).toBeUndefined();
    expect(left.map((item) => item.id)).toEqual([kept?.id]);
    expect(await deleteSlot(env.DB, USER, PROFILE, kept!.id)).toBe(true);
  });

  it("rejects a thirteenth file, a foreign key, and a second project slot with the same handle", async () => {
    const { env } = openDb();
    const files = Array.from({ length: 13 }, (_, index) => image(`f${index}.png`, `f${index}.png`));
    await expect(createSlot(env, USER, PROFILE, { name: "Full", files })).rejects.toBeInstanceOf(SlotRejected);
    await expect(
      createSlot(env, USER, PROFILE, { name: "Foreign", files: [{ kind: "image", name: "x.png", key: "u/other/x.png" }] }),
    ).rejects.toThrow(/files you own/);
    const projectId = await createProject(env.DB, USER, PROFILE, "Film");
    await createSlot(env, USER, PROFILE, { name: "Maya", projectId });
    await expect(createSlot(env, USER, PROFILE, { name: "Maya", projectId })).rejects.toThrow(
      /slot in this project already uses that handle/,
    );
  });

  it("lets a gallery saved from an Everywhere slot be saved again while the slot keeps the handle", async () => {
    const { env, raw } = openDb();
    const slot = await createSlot(env, USER, PROFILE, { name: "Maya", files: [image("a.png", "a.png")] });
    const saved = await saveSlotAsGallery(env, USER, PROFILE, slot!.id);
    const galleryId = saved!.galleryId;
    // The gallery editor sends back the handle it was shown, which is made from the name.
    const again = await saveGallery(env.DB, USER, {
      id: galleryId,
      name: "Maya",
      handle: "Maya",
      items: [image("a.png", "a.png"), image("b.png", "b.png")],
    });
    expect(again?.items.length).toBe(2);
    const stored = raw.prepare(`SELECT handle FROM galleries WHERE id = ?`).get(galleryId) as { handle: string | null };
    expect(stored.handle).toBeNull();
    const listed = await listSlots(env, USER, PROFILE);
    expect(listed[0]?.files.map((file) => file.name)).toEqual(["a.png", "b.png"]);
    // A handle the person typed that a slot already owns is still refused.
    await createSlot(env, USER, PROFILE, { name: "Skin", note: "warm" });
    await expect(
      saveGallery(env.DB, USER, { id: galleryId, name: "Maya", handle: "Skin", items: [image("a.png", "a.png")] }),
    ).rejects.toThrow(/slot on this profile already uses that handle/);
  });

  it("treats a slot whose gallery was deleted as a slot with its own files", async () => {
    const { env } = openDb();
    const gallery = await saveGallery(env.DB, USER, {
      name: "Loft",
      handle: "Loft",
      items: [image("floor.png", "floor.png")],
      profileId: PROFILE,
    });
    const slot = await createSlot(env, USER, PROFILE, { name: "Room", galleryId: gallery!.id, note: "wide lens" });
    expect(slot?.files.map((file) => file.name)).toEqual(["floor.png"]);
    expect(await deleteGallery(env.DB, USER, gallery!.id)).toBe(true);
    const [left] = await listSlots(env, USER, PROFILE);
    expect(left).toMatchObject({ galleryId: null, galleryName: null, files: [], note: "wide lens" });
    const refilled = await updateSlot(env, USER, PROFILE, slot!.id, { files: [image("new.png", "new.png")] });
    expect(refilled?.galleryId).toBeNull();
    expect(refilled?.files.map((file) => file.name)).toEqual(["new.png"]);
  });

  it("picks single files from a linked gallery in one patch, and relinks the whole gallery in one more", async () => {
    const { env } = openDb();
    const gallery = await saveGallery(env.DB, USER, {
      name: "Cast",
      handle: "Cast",
      items: [image("a.png", "a.png"), image("b.png", "b.png"), image("c.png", "c.png")],
      profileId: PROFILE,
    });
    const slot = await createSlot(env, USER, PROFILE, { name: "Maya", galleryId: gallery!.id });
    expect(slot?.files.length).toBe(3);
    // "Use only these": unlink and keep just the picked files, with no separate unlink step.
    const only = await updateSlot(env, USER, PROFILE, slot!.id, {
      galleryId: null,
      files: [{ ...image("c.png", "c.png"), role: "background" }, image("a.png", "a.png")],
    });
    expect(only).toMatchObject({ galleryId: null, galleryName: null });
    expect(only?.files.map((file) => [file.name, file.role])).toEqual([
      ["c.png", "background"],
      ["a.png", "character"],
    ]);
    // "Use whole gallery": the slot follows the gallery again and its own files give way.
    const whole = await updateSlot(env, USER, PROFILE, slot!.id, { galleryId: gallery!.id });
    expect(whole?.galleryId).toBe(gallery!.id);
    expect(whole?.files.map((file) => file.name)).toEqual(["a.png", "b.png", "c.png"]);
    // "Unlink" alone leaves a slot with no files of its own.
    const unlinked = await updateSlot(env, USER, PROFILE, slot!.id, { galleryId: null });
    expect(unlinked).toMatchObject({ galleryId: null, files: [] });
  });

  it("leaves slots out of a shared project", async () => {
    const { env } = openDb();
    const projectId = await createProject(env.DB, USER, PROFILE, "Film");
    await createSlot(env, USER, PROFILE, { name: "Maya", projectId, note: "secret" });
    const share = await createShare(env.DB, USER, projectId, null);
    const view = await readShare(env, share.token);
    expect(view).toMatchObject({ name: "Film" });
    expect(view && "slots" in view).toBe(false);
    expect(view && "slotHandles" in view).toBe(false);
  });
});

describe("appendSlotFiles", () => {
  it("adds after the slot's own files in selection order and skips files already there", async () => {
    const { env } = openDb();
    const slot = await createSlot(env, USER, PROFILE, { name: "Maya", files: [image("a.png", "a.png")] });
    const result = await appendSlotFiles(env, USER, PROFILE, slot!.id, [
      image("c.png", "c.png"),
      image("a.png", "a.png"),
      image("b.png", "b.png"),
      image("c.png", "c.png"),
    ]);
    expect(result).toMatchObject({ added: 2, already: 1, full: 0 });
    expect(result?.slot.files.map((file) => file.name)).toEqual(["a.png", "c.png", "b.png"]);
    // A second add of the same files changes nothing, so a double click never duplicates.
    const again = await appendSlotFiles(env, USER, PROFILE, slot!.id, [image("b.png", "b.png")]);
    expect(again).toMatchObject({ added: 0, already: 1, full: 0 });
    expect(again?.slot.files).toHaveLength(3);
  });

  it("adds what fits under the 12-file cap and counts the rest instead of failing", async () => {
    const { env } = openDb();
    const start = Array.from({ length: 10 }, (_, index) => image(`s${index}.png`, `s${index}.png`));
    const slot = await createSlot(env, USER, PROFILE, { name: "Crowd", files: start });
    const extra = Array.from({ length: 5 }, (_, index) => image(`x${index}.png`, `x${index}.png`));
    const result = await appendSlotFiles(env, USER, PROFILE, slot!.id, [
      image("s0.png", "s0.png"),
      ...extra,
      // Still counted as already in once the slot is full, not as one that did not fit.
      image("s1.png", "s1.png"),
    ]);
    expect(result).toMatchObject({ added: 2, already: 2, full: 3 });
    expect(result?.slot.files).toHaveLength(SLOT_FILES_MAX);
    expect(result?.slot.files.slice(-2).map((file) => file.name)).toEqual(["x0.png", "x1.png"]);
  });

  it("keeps two adds that arrive together from going past the cap or overwriting each other", async () => {
    const { env } = openDb();
    const slot = await createSlot(env, USER, PROFILE, { name: "Pair" });
    const first = Array.from({ length: 8 }, (_, index) => image(`p${index}.png`, `p${index}.png`));
    const second = Array.from({ length: 8 }, (_, index) => image(`q${index}.png`, `q${index}.png`));
    const [one, two] = await Promise.all([
      appendSlotFiles(env, USER, PROFILE, slot!.id, first),
      appendSlotFiles(env, USER, PROFILE, slot!.id, second),
    ]);
    expect((one?.added ?? 0) + (two?.added ?? 0)).toBe(SLOT_FILES_MAX);
    expect((one?.full ?? 0) + (two?.full ?? 0)).toBe(4);
    const [listed] = await listSlots(env, USER, PROFILE);
    expect(listed?.files).toHaveLength(SLOT_FILES_MAX);
    expect(new Set(listed?.files.map((file) => file.key)).size).toBe(SLOT_FILES_MAX);
  });

  it("drops a label the slot already uses instead of failing the add", async () => {
    const { env } = openDb();
    const slot = await createSlot(env, USER, PROFILE, { name: "Loft", files: [image("a.png", "a.png", "wide")] });
    const result = await appendSlotFiles(env, USER, PROFILE, slot!.id, [image("b.png", "b.png", "wide")]);
    expect(result?.added).toBe(1);
    expect(result?.slot.files.map((file) => file.label)).toEqual(["wide", null]);
  });

  it("refuses files the user does not own and slots on another profile or account", async () => {
    const { env, raw } = openDb();
    const slot = await createSlot(env, USER, PROFILE, { name: "Maya" });
    await expect(
      appendSlotFiles(env, USER, PROFILE, slot!.id, [
        image("mine.png", "mine.png"),
        { kind: "image", name: "x.png", key: "u/other/x.png" },
      ]),
    ).rejects.toThrow(/files you own/);
    const [untouched] = await listSlots(env, USER, PROFILE);
    expect(untouched?.files).toEqual([]);
    raw
      .prepare(`INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES ('profile-2', ?, 'Other', 1, 1)`)
      .run(USER);
    expect(await appendSlotFiles(env, USER, "profile-2", slot!.id, [image("a.png", "a.png")])).toBeNull();
    expect(await appendSlotFiles(env, "u2", PROFILE, slot!.id, [image("a.png", "a.png")])).toBeNull();
  });

  it("refuses a slot linked to a gallery, naming the gallery", async () => {
    const { env } = openDb();
    const gallery = await saveGallery(env.DB, USER, {
      name: "Loft",
      handle: "Loft",
      items: [image("floor.png", "floor.png")],
      profileId: PROFILE,
    });
    const slot = await createSlot(env, USER, PROFILE, { name: "Room", galleryId: gallery!.id });
    await expect(appendSlotFiles(env, USER, PROFILE, slot!.id, [image("a.png", "a.png")])).rejects.toThrow(
      /uses the gallery Loft/,
    );
    const [listed] = await listSlots(env, USER, PROFILE);
    expect(listed?.files.map((file) => file.name)).toEqual(["floor.png"]);
    // Once that gallery is gone the slot takes files of its own again.
    await deleteGallery(env.DB, USER, gallery!.id);
    const result = await appendSlotFiles(env, USER, PROFILE, slot!.id, [image("a.png", "a.png")]);
    expect(result?.added).toBe(1);
    expect(result?.slot.galleryId).toBeNull();
  });
});
