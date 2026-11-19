import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  orderedNameCatalog,
  planNameAttachments,
  type NameCatalogEntry,
  noteOnlyCatalog,
} from "../src/lib/name-mentions";
import { mediaKindCap } from "../src/lib/kind-caps";
import { resolvePromptNames, type PromptNamesInput } from "../worker/api-names";
import { getGallery, listGalleries, saveGallery } from "../worker/galleries";
import { createProject } from "../worker/projects";
import { createSlot, listSlots } from "../worker/slots";
import type { MediaSlot } from "../worker/schema";
import type { Env } from "../worker/types";

const USER = "u1";
const PROFILE = "profile-1";
const OTHER_PROFILE = "profile-2";

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
    .prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES (?, 1, 'ada', 1, 1)`)
    .run(USER);
  raw
    .prepare(`INSERT INTO users (id, github_id, login, created_at, updated_at) VALUES ('u2', 2, 'bo', 1, 1)`)
    .run();
  for (const [id, user] of [
    [PROFILE, USER],
    [OTHER_PROFILE, USER],
    ["profile-u2", "u2"],
  ]) {
    raw
      .prepare(`INSERT INTO profiles (id, user_id, name, created_at, updated_at) VALUES (?, ?, 'P', 1, 1)`)
      .run(id, user);
  }
  const sql: string[] = [];
  const statement = (text: string, args: unknown[]) => ({
    async first() {
      sql.push(text);
      return raw.prepare(text).get(...(args as (string | number | null)[])) ?? null;
    },
    async all() {
      sql.push(text);
      return { results: raw.prepare(text).all(...(args as (string | number | null)[])) };
    },
    async run() {
      sql.push(text);
      const info = raw.prepare(text).run(...(args as (string | number | null)[]));
      return { success: true, meta: { changes: Number(info.changes) } };
    },
  });
  const db = {
    prepare(text: string) {
      return { bind: (...args: unknown[]) => statement(text, args), ...statement(text, []) };
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
  return { raw, env, sql };
}

function key(name: string, user = USER) {
  return `u/${user}/${name}`;
}

function image(name: string, label?: string, role = "character") {
  return { kind: "image" as const, name, key: key(name), label: label ?? null, role };
}

function audio(name: string) {
  return { kind: "audio" as const, name, key: key(name), label: null, role: null };
}

function video(name: string) {
  return { kind: "video" as const, name, key: key(name), label: null, role: null };
}

function slot(kind: MediaSlot["kind"], maxItems: number, field: MediaSlot["field"]): MediaSlot {
  return { field, kind, required: false, maxItems, asArray: maxItems > 1 };
}

const refs: PromptNamesInput["modelControls"] = {
  mentions: true,
  slots: [slot("image", 4, "input_images"), slot("video", 1, "input_videos"), slot("audio", 1, "input_audios")],
  frames: null,
  imageVideoExclusive: false,
};

const exclusive: PromptNamesInput["modelControls"] = {
  mentions: true,
  slots: [slot("image", 4, "input_images"), slot("video", 1, "input_videos")],
  frames: null,
  imageVideoExclusive: true,
};

const framesNoRefs: PromptNamesInput["modelControls"] = {
  mentions: true,
  slots: [slot("image", 1, "input_image")],
  frames: { references: false, firstFace: false, lastFace: false },
  imageVideoExclusive: false,
};

async function seed(env: Env) {
  const maya = await saveGallery(env.DB, USER, {
    name: "Maya",
    handle: "Maya",
    takeCount: 2,
    profileId: PROFILE,
    // The first item is the featured one.
    items: [image("maya-face.png"), image("maya-turn.png"), image("maya-wide.png", "wide")],
  });
  const loft = await saveGallery(env.DB, USER, {
    name: "Loft",
    handle: "Loft",
    takeCount: 1,
    profileId: PROFILE,
    items: [image("loft-floor.png", "floor", "background"), image("loft-wide.png", "wide", "background")],
  });
  await createSlot(env, USER, PROFILE, { name: "Texture", note: "fine pores" });
  await createSlot(env, USER, PROFILE, { name: "Skin", note: "warm, @Texture" });
  await createSlot(env, USER, PROFILE, {
    name: "Hair",
    note: "long waves, @Skin",
    files: [image("hair.png", undefined, "object")],
  });
  await createSlot(env, USER, PROFILE, { name: "Song", files: [audio("song.mp3")] });
  return { maya: maya!, loft: loft! };
}

function run(env: Env, input: Partial<PromptNamesInput> & { prompt: string }, profile: string | null = PROFILE) {
  return resolvePromptNames(env, USER, profile, { modelControls: refs, mode: "reference-to-video", ...input });
}

describe("resolvePromptNames", () => {
  it("turns handles into @Image numbers and writes each note once, three notes deep", async () => {
    const { env } = openDb();
    await seed(env);
    const result = await run(env, { prompt: "@Maya with @Hair, then @Maya and @Hair again" });
    expect(result.prompt).toBe(
      "@Image1 @Image2 with @Image3 (long waves, warm, fine pores), then @Image1 @Image2 and @Image3 again",
    );
    expect(result.images).toEqual([key("maya-face.png"), key("maya-turn.png"), key("hair.png")]);
    expect(result.roles.image).toEqual(["character", "character", "object"]);
    expect(result.notes.map((note) => note.token)).toEqual(["@Hair", "@Skin", "@Texture"]);
    expect(result.missing).toEqual([]);
    expect(result.trimmed).toEqual([]);
  });

  it("lists handles that matched nothing in plain words", async () => {
    const { env } = openDb();
    await seed(env);
    await createSlot(env, USER, PROFILE, { name: "Lost", note: "near @Nowhere" });
    const result = await run(env, { prompt: "@Nobody at @Loft.attic, @Lost" });
    expect(result.missing).toEqual(["@Nobody", "@Loft.attic", "@Nowhere in @Lost’s note"]);
    expect(result.prompt).toBe("@Nobody at @Loft.attic, near @Nowhere");
    expect(result.images).toEqual([]);
  });

  it("keeps hand files on their numbers and numbers named files after them", async () => {
    const { env } = openDb();
    await seed(env);
    const result = await run(env, {
      prompt: "@Image1 beside @Loft and @Maya",
      images: ["https://elsewhere.test/hand.png", key("maya-face.png")],
    });
    // The featured Maya file was attached by hand, so it keeps Image 2 and is not sent twice.
    expect(result.prompt).toBe("@Image1 beside @Image3 and @Image2 @Image4");
    expect(result.images).toEqual([
      "https://elsewhere.test/hand.png",
      key("maya-face.png"),
      key("loft-floor.png"),
      key("maya-turn.png"),
    ]);
    expect(result.roles.image).toEqual([null, null, "background", "character"]);
  });

  it("skips kinds the model does not take and applies its per-kind limits", async () => {
    const { env } = openDb();
    await seed(env);
    const imagesOnly = { ...refs, slots: [slot("image", 2, "input_images")] };
    const result = await run(env, {
      prompt: "@Maya at @Loft with @Song",
      modelControls: imagesOnly,
      images: [],
    });
    expect(result.images).toEqual([key("maya-face.png"), key("loft-floor.png")]);
    expect(result.audios).toEqual([]);
    expect(result.prompt).toBe("@Image1 at @Image2 with");
    expect(result.trimmed).toEqual(["Trimmed @Maya from 2 to 1 file", "Dropped @Song; the model can’t take more files"]);

    const tooMany = await run(env, {
      prompt: "@Loft",
      modelControls: imagesOnly,
      images: [key("a.png"), key("b.png"), key("c.png")],
    });
    expect(tooMany.images).toEqual([key("a.png"), key("b.png")]);
    expect(tooMany.trimmed).toEqual([
      "Left out 1 attached image; the model takes 2",
      "Dropped @Loft; the model can’t take more files",
    ]);
  });

  it("adds a slot's note and no image on a frames-only model", async () => {
    const { env } = openDb();
    await seed(env);
    // First/last-frame models take no references, so the app expands notes only (mentions is off).
    const framesOnly: PromptNamesInput["modelControls"] = {
      mentions: false,
      slots: [slot("image", 1, "input_image")],
      frames: { references: false, firstFace: false, lastFace: false },
      imageVideoExclusive: false,
    };
    await createSlot(env, USER, PROFILE, { name: "Mood", note: "golden hour" });
    const result = await run(env, { prompt: "@Mood light", modelControls: framesOnly });
    expect(result.prompt).toBe("golden hour light");
    expect(result.images).toEqual([]);

    // A slot with an image and a note keeps the note; the hand frames stay as sent.
    const frames = [key("first.png"), key("last.png")];
    const both = await run(env, { prompt: "@Hair at dusk", modelControls: framesOnly, images: frames });
    expect(both.prompt).toBe("long waves, warm, fine pores at dusk");
    expect(both.images).toEqual(frames);
    expect(both.roles.image).toEqual([null, null]);
    expect(both.missing).toEqual([]);
    expect(both.trimmed).toEqual([]);

    // A name with files and no note has no words to add, so it stays as typed, as in the app.
    const noNote = await run(env, { prompt: "@Mood on @Loft", modelControls: framesOnly });
    expect(noNote.prompt).toBe("golden hour on @Loft");
    expect(noNote.images).toEqual([]);
    expect(noNote.missing).toEqual([]);
    expect(noNote.trimmed).toEqual(["Left @Loft as typed; the model takes no files"]);

    // A frames model whose schema still allows mentions: the app plans with no room for images,
    // so a name that holds images is dropped whole. The server does the same.
    const mentionsOn = { ...framesOnly, mentions: true };
    const dropped = await run(env, { prompt: "@Mood on @Loft", modelControls: mentionsOn });
    expect(dropped.prompt).toBe("golden hour on");
    expect(dropped.images).toEqual([]);
    expect(dropped.trimmed).toEqual(["Dropped @Loft; the model can’t take more files"]);
  });

  it("lets the mode decide between keyframes and a continuation clip, as the app does", async () => {
    const { env } = openDb();
    await seed(env);
    await saveGallery(env.DB, USER, { name: "Clip", handle: "Clip", profileId: PROFILE, items: [video("clip.mp4")] });

    // Reference-to-video takes the images and no clip.
    const keyframes = await run(env, { prompt: "@Maya then @Clip", modelControls: exclusive, mode: "reference-to-video" });
    // As in the app, takes shrink before a name is dropped.
    expect(keyframes.images).toEqual([key("maya-face.png")]);
    expect(keyframes.videos).toEqual([]);
    expect(keyframes.prompt).toBe("@Image1 then");
    expect(keyframes.trimmed).toEqual([
      "Trimmed @Maya from 2 to 1 file",
      "Dropped @Clip; the model can’t take more files",
    ]);

    // Video-to-video takes the clip and no images.
    const continuation = await run(env, { prompt: "@Clip then @Maya", modelControls: exclusive, mode: "video-to-video" });
    expect(continuation.videos).toEqual([key("clip.mp4")]);
    expect(continuation.images).toEqual([]);
    expect(continuation.prompt).toBe("@Video1 then");

    // A hand file of the kind the mode does not take is left out, and the result says why.
    const handBoth = await run(env, {
      prompt: "@Image1 near @Maya",
      modelControls: exclusive,
      mode: "reference-to-video",
      images: [key("a.png")],
      videos: [key("hand.mp4")],
    });
    expect(handBoth.prompt).toBe("@Image1 near @Image2 @Image3");
    expect(handBoth.images).toEqual([key("a.png"), key("maya-face.png"), key("maya-turn.png")]);
    expect(handBoth.videos).toEqual([]);
    expect(handBoth.trimmed).toEqual([
      "Left out 1 attached video; keyframes and a continuation clip can’t be used together",
    ]);
  });

  it("leaves names as typed with no mode or in chat, as the app does", async () => {
    const { env } = openDb();
    await seed(env);
    for (const mode of [null, "chat"] as const) {
      const result = await run(env, { prompt: "@Maya at @Loft", mode });
      expect(result.prompt).toBe("@Maya at @Loft");
      expect(result.images).toEqual([]);
      expect(result.notes).toEqual([]);
    }
  });

  it("follows take, labels, the featured file, and whole-gallery slots", async () => {
    const { env } = openDb();
    const { loft } = await seed(env);
    await createSlot(env, USER, PROFILE, { name: "Set", takeCount: 2, galleryId: loft.id, note: "a loft" });
    const take = await run(env, { prompt: "@Maya" });
    expect(take.images).toEqual([key("maya-face.png"), key("maya-turn.png")]);
    const label = await run(env, { prompt: "@Loft.wide and @Maya.wide" });
    expect(label.images).toEqual([key("loft-wide.png"), key("maya-wide.png")]);
    expect(label.prompt).toBe("@Image1 and @Image2");
    const whole = await run(env, { prompt: "@Set" });
    expect(whole.images).toEqual([key("loft-floor.png"), key("loft-wide.png")]);
    expect(whole.prompt).toBe("@Image1 @Image2 (a loft)");
  });

  it("reads only the caller's profile, and returns only the user's own media keys", async () => {
    const { env, raw } = openDb();
    await seed(env);
    await saveGallery(env.DB, USER, {
      name: "Elsewhere",
      handle: "Elsewhere",
      profileId: OTHER_PROFILE,
      items: [image("other.png")],
    });
    await saveGallery(env.DB, "u2", {
      name: "Theirs",
      handle: "Theirs",
      profileId: "profile-u2",
      items: [{ kind: "image", name: "x.png", key: "u/u2/x.png" }],
    });
    // A row that points at someone else's file, and a slot linked across profiles.
    const maya = (await listGalleries(env.DB, USER, "", PROFILE)).find((g) => g.handle === "Maya")!;
    raw
      .prepare(
        `INSERT INTO gallery_items (id, gallery_id, user_id, kind, name, media_key, position) VALUES ('bad', ?, ?, 'image', 'x', 'u/u2/x.png', -1)`,
      )
      .run(maya.id, USER);
    const elsewhere = (await listGalleries(env.DB, USER, "", OTHER_PROFILE))[0]!;
    raw
      .prepare(
        `INSERT INTO slots (id, user_id, profile_id, project_id, name, handle, take_count, note, gallery_id, position, created_at, updated_at)
         VALUES ('cross', ?, ?, NULL, 'Cross', 'Cross', 1, '', ?, 99, 1, 1)`,
      )
      .run(USER, PROFILE, elsewhere.id);

    const result = await run(env, { prompt: "@Elsewhere @Theirs @Maya @Cross" });
    expect(result.missing).toEqual(["@Elsewhere", "@Theirs", "@Cross"]);
    expect(result.images).toEqual([key("maya-face.png"), key("maya-turn.png")]);
    expect(result.images.every((value) => value.startsWith(`u/${USER}/`))).toBe(true);

    const project = await createProject(env.DB, USER, PROFILE, "Film");
    await createSlot(env, USER, PROFILE, { name: "Maya", projectId: project, files: [image("on-set.png")] });
    expect((await run(env, { prompt: "@Maya" })).images).toEqual([key("maya-face.png"), key("maya-turn.png")]);
    expect((await run(env, { prompt: "@Maya", projectId: project })).images).toEqual([key("on-set.png")]);
    expect((await run(env, { prompt: "@Maya" }, null)).images).toEqual([]);
  });

  it("returns a prompt with no handles unchanged and reads nothing", async () => {
    const { env, sql } = openDb();
    await seed(env);
    sql.length = 0;
    const input = { prompt: "a cat on @Image1 at noon", images: [key("cat.png")], audios: ["https://x.test/a.mp3"] };
    const result = await run(env, input);
    expect(result).toEqual({
      prompt: input.prompt,
      images: input.images,
      videos: [],
      audios: input.audios,
      roles: { image: [null], video: [] },
      notes: [],
      missing: [],
      trimmed: [],
    });
    expect(sql).toEqual([]);

    // A model with no references reads names but none of their files.
    await run(env, { prompt: "@Hair", modelControls: { ...refs, mentions: false } });
    expect(sql.some((text) => /slot_files|gallery_items/.test(text))).toBe(false);
  });

  it("matches the app: same catalog and prompt give the same prompt and files in the same order", async () => {
    const { env } = openDb();
    await seed(env);
    const project = await createProject(env.DB, USER, PROFILE, "Film");
    await createSlot(env, USER, PROFILE, {
      name: "Lead",
      projectId: project,
      takeCount: 2,
      note: "in @Loft.wide, @Hair",
      files: [image("lead-1.png"), image("lead-2.png"), audio("lead.mp3")],
    });
    const prompt = "@Lead meets @Maya.wide and @Maya at @Loft with @Song; @Image1 watches @Nobody";
    const hand = [key("hand.png")];

    // The catalog the app builds in App.tsx: project slots, Everywhere slots, then galleries.
    const summaries = await listGalleries(env.DB, USER, "", PROFILE);
    const galleries: NameCatalogEntry[] = [];
    for (const summary of summaries) {
      const detail = await getGallery(env.DB, USER, summary.id);
      galleries.push({
        id: summary.id,
        name: summary.name,
        handle: summary.handle,
        take: detail?.takeCount || summary.takeCount || 1,
        items: (detail?.items ?? []).map((item) => ({ ...item, role: item.role ?? null })),
      });
    }
    const slots = await listSlots(env, USER, PROFILE);
    const entry = (s: (typeof slots)[number]): NameCatalogEntry => ({
      id: s.id,
      name: s.name,
      handle: s.handle,
      take: s.take,
      note: s.note,
      source: "slot",
      galleryId: s.galleryId,
      items: s.files,
    });
    const catalog = orderedNameCatalog({
      project: slots.filter((s) => s.projectId === project).map(entry),
      everywhere: slots.filter((s) => s.projectId == null).map(entry),
      galleries,
    });
    // Exactly what App.tsx does: the app's limits for the model and mode, no room for named
    // images on a frames-only model, and notes only when the model takes no references.
    const compare = async (
      text: string,
      modelControls: PromptNamesInput["modelControls"],
      mode: "reference-to-video" | "video-to-video" | "image-to-image",
      images: string[],
    ) => {
      const framesOnly = Boolean(modelControls.frames && !modelControls.frames.references);
      const app = planNameAttachments({
        prompt: text,
        galleries: modelControls.mentions ? catalog : noteOnlyCatalog(catalog),
        hand: images.map((value) => ({ key: value, kind: "image" as const })),
        caps: {
          image: framesOnly ? 0 : mediaKindCap(modelControls, mode, "image"),
          video: mediaKindCap(modelControls, mode, "video"),
          audio: mediaKindCap(modelControls, mode, "audio"),
        },
        flagMissing: modelControls.mentions,
      });
      const server = await run(env, { prompt: text, images, projectId: project, modelControls, mode });
      expect(server.prompt).toBe(app.expanded);
      const appFiles = [...app.files].sort((a, b) => a.number - b.number);
      const ofKind = (kind: "image" | "video" | "audio") => appFiles.filter((f) => f.kind === kind);
      expect(server.images).toEqual([...images, ...ofKind("image").map((f) => f.key)]);
      expect(server.videos).toEqual(ofKind("video").map((f) => f.key));
      expect(server.audios).toEqual(ofKind("audio").map((f) => f.key));
      expect(server.roles.image.slice(images.length)).toEqual(ofKind("image").map((f) => f.role));
      return app;
    };

    const app = await compare(prompt, refs, "reference-to-video", hand);
    expect(app.files.length).toBeGreaterThan(2);

    // Frames-only with mentions on: a slot holding images and a note, the case the two sides
    // must agree on. The app drops the name; so does the server.
    const framesWithAudio = { ...framesNoRefs, slots: [...framesNoRefs.slots, slot("audio", 1, "input_audios")] };
    await compare("@Hair at dusk with @Song", framesWithAudio, "reference-to-video", [key("first.png")]);
    const frames = await compare("@Texture light with @Song on @Loft", framesWithAudio, "reference-to-video", [key("first.png")]);
    expect(frames.expanded).toBe("fine pores light with @Audio1 on");
    // Frames-only with mentions off, as real first/last-frame models are: notes only.
    await compare("@Hair at dusk on @Loft", { ...framesNoRefs, mentions: false }, "reference-to-video", [key("first.png")]);

    // Keyframes or a continuation clip: the mode decides, on both sides.
    await saveGallery(env.DB, USER, { name: "Clip", handle: "Clip", profileId: PROFILE, items: [video("clip.mp4")] });
    const clipCatalog = await getGallery(
      env.DB,
      USER,
      (await listGalleries(env.DB, USER, "", PROFILE)).find((g) => g.handle === "Clip")!.id,
    );
    catalog.push({ id: clipCatalog!.id, name: "Clip", handle: "Clip", take: 1, items: clipCatalog!.items });
    const keyframes = await compare("@Maya then @Clip", exclusive, "reference-to-video", []);
    expect(keyframes.files.map((f) => f.kind)).toEqual(["image"]);
    const continuation = await compare("@Clip then @Maya", exclusive, "video-to-video", []);
    expect(continuation.files.map((f) => f.kind)).toEqual(["video"]);
  });
});
