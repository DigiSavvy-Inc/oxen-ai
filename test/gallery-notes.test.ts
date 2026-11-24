import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { galleryImageMatch, galleryListMatch } from "../src/lib/gallery-search";
import { resolvePromptNames } from "../worker/api-names";
import {
  acceptGalleryItems,
  acceptGalleryNote,
  getGallery,
  listGalleries,
  saveGallery,
} from "../worker/galleries";
import { GALLERY_CAPTION_MAX, GALLERY_NOTE_MAX } from "../worker/gallery-text";
import type { MediaSlot } from "../worker/schema";
import { createSlot, saveSlotAsGallery } from "../worker/slots";
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
  raw.prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`).run(USER);
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
      raw.prepare(sql).run(...(args as (string | number | null)[]));
      return { success: true, meta: { changes: 1 } };
    },
  });
  const db = {
    prepare(sql: string) {
      return { bind: (...args: unknown[]) => statement(sql, args) };
    },
    async batch(statements: { run(): Promise<unknown> }[]) {
      raw.exec("BEGIN");
      try {
        for (const item of statements) await item.run();
        raw.exec("COMMIT");
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
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
  return { raw, env, db };
}

function image(name: string, extra: { label?: string | null; note?: string | null } = {}) {
  const item: {
    kind: "image";
    name: string;
    key: string;
    role: "character";
    label?: string | null;
    note?: string | null;
  } = {
    kind: "image",
    name,
    key: `u/${USER}/${name}`,
    role: "character",
  };
  if ("label" in extra) item.label = extra.label;
  if ("note" in extra) item.note = extra.note;
  return item;
}

describe("gallery notes and captions", () => {
  it("adds nullable columns on a scratch database and leaves older rows empty", () => {
    const raw = new DatabaseSync(":memory:");
    raw.exec("PRAGMA foreign_keys = OFF");
    const files = readdirSync(new URL("../migrations", import.meta.url))
      .filter((name) => name.endsWith(".sql") && name < "0034")
      .sort();
    for (const file of files) {
      raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    raw.prepare(
      `INSERT INTO galleries (id, user_id, name, created_at, updated_at) VALUES ('g', 'u', 'Old', 1, 1)`,
    ).run();
    raw.prepare(
      `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position)
       VALUES ('i', 'g', 'u', 'image', 'old.png', 'u/u/old.png', 0)`,
    ).run();
    raw.exec(readFileSync(new URL("../migrations/0034_gallery_notes.sql", import.meta.url), "utf8"));
    const gallery = raw.prepare(`SELECT caption FROM galleries WHERE id = 'g'`).get() as { caption: string | null };
    const item = raw.prepare(`SELECT note FROM gallery_items WHERE id = 'i'`).get() as { note: string | null };
    const galleryInfo = raw.prepare(`PRAGMA table_info(galleries)`).all() as { name: string; notnull: number }[];
    const itemInfo = raw.prepare(`PRAGMA table_info(gallery_items)`).all() as { name: string; notnull: number }[];
    expect(gallery.caption).toBeNull();
    expect(item.note).toBeNull();
    expect(galleryInfo.find((column) => column.name === "caption")?.notnull).toBe(0);
    expect(itemInfo.find((column) => column.name === "note")?.notnull).toBe(0);
  });

  it("round-trips a caption and a note, and turns blank text into null", async () => {
    const { db } = openDb();
    const saved = await saveGallery(db, USER, {
      name: "Holds",
      caption: "  evening\u0000 light  ",
      items: [image("keeper.png", { note: "  hold still  " }), image("plain.png", { note: "   " })],
    });
    expect(saved?.caption).toBe("evening light");
    expect(saved?.items.map((item) => item.note)).toEqual(["hold still", null]);
    const loaded = await getGallery(db, USER, saved!.id);
    expect(loaded?.caption).toBe("evening light");
    expect(loaded?.items.map((item) => [item.name, item.note])).toEqual([
      ["keeper.png", "hold still"],
      ["plain.png", null],
    ]);
    const listed = await listGalleries(db, USER, "");
    expect(listed.find((gallery) => gallery.id === saved!.id)?.caption).toBe("evening light");

    const cleared = await saveGallery(db, USER, {
      id: saved!.id,
      name: "Holds",
      caption: "",
      items: [image("keeper.png", { note: null })],
    });
    expect(cleared?.caption).toBeNull();
    expect(cleared?.items[0]?.note).toBeNull();
  });

  it("rejects over-length and non-text values and does not cut them down", async () => {
    const { db } = openDb();
    const saved = await saveGallery(db, USER, {
      name: "Holds",
      caption: "short",
      items: [image("keeper.png", { note: "short note" })],
    });
    await expect(
      saveGallery(db, USER, {
        id: saved!.id,
        name: "Holds",
        caption: "c".repeat(GALLERY_CAPTION_MAX + 1),
        items: [image("keeper.png", { note: "short note" })],
      }),
    ).rejects.toThrow(`A caption can be up to ${GALLERY_CAPTION_MAX} characters.`);
    await expect(
      saveGallery(db, USER, {
        id: saved!.id,
        name: "Holds",
        caption: "short",
        items: [image("keeper.png", { note: "n".repeat(GALLERY_NOTE_MAX + 1) })],
      }),
    ).rejects.toThrow(`A note can be up to ${GALLERY_NOTE_MAX} characters.`);
    await expect(saveGallery(db, USER, { name: "Holds", caption: 12, items: [] })).rejects.toThrow(
      "A caption has to be text.",
    );
    await expect(
      saveGallery(db, USER, { name: "Holds", items: [image("keeper.png", { note: 12 as unknown as string })] }),
    ).rejects.toThrow("A note has to be text.");
    const loaded = await getGallery(db, USER, saved!.id);
    expect(loaded?.caption).toBe("short");
    expect(loaded?.items[0]?.note).toBe("short note");
    expect(acceptGalleryNote("n".repeat(GALLERY_NOTE_MAX))).toHaveLength(GALLERY_NOTE_MAX);
  });

  it("still refuses a label with spaces and accepts a note with spaces", () => {
    expect(
      acceptGalleryItems(USER, [image("keeper.png", { label: "two words", note: "a full sentence" })]),
    ).toBeNull();
    const accepted = acceptGalleryItems(USER, [image("keeper.png", { label: "wide", note: "a full sentence" })]);
    expect(accepted?.[0]).toMatchObject({ label: "wide", note: "a full sentence" });
  });

  it("keeps notes when an item is appended and when a linked slot is saved as a gallery", async () => {
    const { env, db } = openDb();
    const saved = await saveGallery(db, USER, {
      name: "Holds",
      handle: "Holds",
      profileId: PROFILE,
      caption: "evening light",
      items: [image("keeper.png", { label: "wide", note: "premium hold" })],
    });
    await saveGallery(db, USER, {
      id: saved!.id,
      name: "Holds",
      handle: "Holds",
      items: [image("keeper.png", { label: "wide" }), image("new.png")],
    });
    const appended = await getGallery(db, USER, saved!.id);
    expect(appended?.caption).toBe("evening light");
    expect(appended?.items.map((item) => [item.name, item.note, item.label])).toEqual([
      ["keeper.png", "premium hold", "wide"],
      ["new.png", null, null],
    ]);

    const slot = await createSlot(env, USER, PROFILE, { name: "Cast", galleryId: saved!.id });
    expect(slot?.files.map((file) => file.name)).toEqual(["keeper.png", "new.png"]);
    expect((await getGallery(db, USER, saved!.id))?.items[0]?.note).toBe("premium hold");
    const copied = await saveSlotAsGallery(env, USER, PROFILE, slot!.id);
    const gallery = await getGallery(db, USER, copied!.galleryId);
    expect(gallery?.items.map((item) => [item.name, item.note])).toEqual([
      ["keeper.png", "premium hold"],
      ["new.png", null],
    ]);
  });

  it("finds a gallery by a word in an item note or in the caption", async () => {
    const { db } = openDb();
    await saveGallery(db, USER, {
      name: "Other",
      items: [image("keeper.png", { note: "premium hold of the keeper" })],
    });
    await saveGallery(db, USER, {
      name: "Rooms",
      caption: "evening light",
      items: [image("room.png")],
    });
    await saveGallery(db, USER, { name: "Faces", items: [image("face.png", { note: "100% crop" })] });
    expect((await listGalleries(db, USER, "premium")).map((gallery) => gallery.name)).toEqual(["Other"]);
    expect((await listGalleries(db, USER, "evening")).map((gallery) => gallery.name)).toEqual(["Rooms"]);
    expect((await listGalleries(db, USER, "Faces")).map((gallery) => gallery.name)).toEqual(["Faces"]);
    expect((await listGalleries(db, USER, "%")).map((gallery) => gallery.name)).toEqual(["Faces"]);

    expect(
      galleryListMatch({ name: "Other", caption: null, items: [{ note: "premium hold" }] }, "premium"),
    ).toBe(true);
    expect(galleryListMatch({ name: "Rooms", caption: "evening light", items: [] }, "evening")).toBe(true);
    expect(galleryImageMatch({ name: "keeper.png", label: "wide", note: "premium hold" }, null, "premium")).toBe(true);
    expect(galleryImageMatch({ name: "room.png", note: null }, "evening light", "evening")).toBe(true);
    expect(galleryImageMatch({ name: "room.png", note: null }, "evening light", "keeper")).toBe(false);
  });

  it("does not send a caption or an item note to the model", async () => {
    const { env } = openDb();
    await saveGallery(env.DB, USER, {
      name: "Maya",
      handle: "Maya",
      profileId: PROFILE,
      caption: "evening light on the stands",
      items: [image("maya.png", { note: "hold still of the keeper" })],
    });
    const controls: { mentions: boolean; slots: MediaSlot[]; frames: null; imageVideoExclusive: boolean } = {
      mentions: true,
      slots: [{ field: "input_images", kind: "image", required: false, maxItems: 4, asArray: true }],
      frames: null,
      imageVideoExclusive: false,
    };
    const result = await resolvePromptNames(env, USER, PROFILE, {
      prompt: "Use @Maya",
      mode: "reference-to-video",
      modelControls: controls,
    });
    expect(result.prompt).toBe("Use @Image1");
    expect(result.prompt).not.toContain("hold still");
    expect(result.prompt).not.toContain("evening light");
    expect(result.images).toEqual([`u/${USER}/maya.png`]);
  });
});
