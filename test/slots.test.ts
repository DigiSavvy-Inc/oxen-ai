import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { deleteGallery, GalleryRejected, saveGallery } from "../worker/galleries";
import { createProject, deleteProject, getProject, readShare, createShare } from "../worker/projects";
import {
  createSlot,
  deleteSlot,
  forgetSlotFiles,
  listSlots,
  saveProjectSlotsAsGallery,
  saveSlotAsGallery,
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
