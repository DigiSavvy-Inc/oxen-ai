import { describe, expect, it } from "vitest";
import { deleteMentionToken, mentionAtCaret, parseNameMentions, promptContainsToken } from "../src/lib/mentions";
import {
  expandNameText,
  namePickerChoices,
  namePlanNotice,
  nameSourceLabel,
  noteOnlyCatalog,
  orderedNameCatalog,
  planNameAttachments,
  type NameCatalogGallery,
} from "../src/lib/name-mentions";
import type { OxenModel } from "../worker/oxen";
import { mapMediaUrls, parseModelControls } from "../worker/schema";

function image(name: string, key: string, label?: string) {
  return {
    key,
    kind: "image" as const,
    name,
    role: "character" as const,
    label: label ?? null,
    url: `https://studio.example/${key}`,
    thumbUrl: `https://studio.example/${key}.thumb`,
  };
}

const maya: NameCatalogGallery = {
  id: "maya",
  name: "Maya",
  handle: "Maya",
  take: 2,
  items: [image("face.png", "face"), image("turn.png", "turn"), image("wide.png", "wide", "wide")],
};

const loft: NameCatalogGallery = {
  id: "loft",
  name: "Loft",
  handle: "Loft",
  take: 1,
  items: [image("floor.png", "floor", "wide"), image("corner.png", "corner", "corner")],
};

const caps = { image: 4, video: 1, audio: 1 };

describe("name mentions", () => {
  it("parses a handle and a label, and leaves numbered tokens alone", () => {
    expect(parseNameMentions("the woman in @Maya on @Loft.wide beside @Image1")).toEqual([
      { start: 13, end: 18, token: "@Maya", handle: "Maya", label: null },
      { start: 22, end: 32, token: "@Loft.wide", handle: "Loft", label: "wide" },
    ]);
    expect(mentionAtCaret("on @Loft.w", 10)).toEqual({ start: 3, query: "loft.w" });
    expect(promptContainsToken("see @Maya.wide", "@Maya")).toBe(false);
    expect(deleteMentionToken("the woman in @Maya here", 16, "backward")?.next).toBe("the woman in here");
  });

  it("resolves a handle to the first take and a label to that item", () => {
    const plan = planNameAttachments({
      prompt: "the woman in @Maya on the floor of @Loft.wide",
      galleries: [maya, loft],
      hand: [],
      caps,
    });
    expect(plan.files.map((file) => [file.name, file.number, file.token])).toEqual([
      ["face.png", 1, "@Maya"],
      ["turn.png", 2, "@Maya"],
      ["floor.png", 3, "@Loft.wide"],
    ]);
    expect(plan.expanded).toBe("the woman in @Image1 @Image2 on the floor of @Image3");
    expect(plan.unresolved).toEqual([]);
    expect(plan.files.map((file) => file.role)).toEqual(["character", "character", "character"]);
  });

  it("keeps hand-attached numbers and reuses a name that appears twice", () => {
    const plan = planNameAttachments({
      prompt: "@Maya stands near @Image1 and @Maya again",
      galleries: [maya],
      hand: [{ key: "plate", kind: "image", number: 1 }],
      caps,
    });
    expect(plan.files.map((file) => file.number)).toEqual([2, 3]);
    expect(plan.marks).toEqual([]);
    expect(plan.expanded).toBe("@Image2 @Image3 stands near @Image1 and @Image2 @Image3 again");

    const shared = planNameAttachments({
      prompt: "@Maya in @Maya.wide",
      galleries: [{ ...maya, take: 3 }],
      hand: [],
      caps,
    });
    expect(shared.files.map((file) => file.key)).toEqual(["face", "turn", "wide"]);
    expect(shared.expanded).toBe("@Image1 @Image2 @Image3 in @Image3");
  });

  it("uses the hand number when the name points at a file already attached", () => {
    const plan = planNameAttachments({
      prompt: "the woman in @Maya",
      galleries: [maya],
      hand: [
        { key: "face", kind: "image", number: 4 },
        { key: "other", kind: "image" },
      ],
      caps,
    });
    expect(plan.files.map((file) => file.key)).toEqual(["turn"]);
    expect(plan.files[0]?.number).toBe(5);
    expect(plan.marks).toEqual([{ key: "face", token: "@Maya" }]);
    expect(plan.expanded).toBe("the woman in @Image4 @Image5");
  });

  it("shrinks take counts from the end before dropping a whole name", () => {
    const plan = planNameAttachments({
      prompt: "@Maya then @Loft",
      galleries: [
        { ...maya, take: 3 },
        { ...loft, take: 2 },
      ],
      hand: [],
      caps: { image: 3, video: 0, audio: 0 },
    });
    expect(plan.trimmed).toEqual([
      { token: "@Maya", from: 3, to: 2 },
      { token: "@Loft", from: 2, to: 1 },
    ]);
    expect(plan.dropped).toEqual([]);
    expect(plan.files.map((file) => file.key)).toEqual(["face", "turn", "floor"]);
    expect(namePlanNotice(plan)).toBe("Trimmed @Maya to 2. Trimmed @Loft to 1.");

    const dropped = planNameAttachments({
      prompt: "@Maya then @Loft",
      galleries: [
        { ...maya, take: 1 },
        { ...loft, take: 1 },
      ],
      hand: [],
      caps: { image: 1, video: 0, audio: 0 },
    });
    expect(dropped.trimmed).toEqual([]);
    expect(dropped.dropped).toEqual(["@Loft"]);
    expect(dropped.files.map((file) => file.key)).toEqual(["face"]);
    expect(dropped.expanded).toBe("@Image1 then");
    expect(namePlanNotice(dropped)).toBe("Dropped @Loft.");
  });

  it("flags a handle or label that matches nothing", () => {
    const plan = planNameAttachments({
      prompt: "see @Nope and @Loft.missing",
      galleries: [loft],
      hand: [],
      caps,
    });
    expect(plan.unresolved.map((mention) => mention.token)).toEqual(["@Nope", "@Loft.missing"]);
    expect(plan.expanded).toBe("see @Nope and @Loft.missing");
    expect(plan.files).toEqual([]);
  });

  it("lists handles, and labels once a dot is typed", () => {
    expect(namePickerChoices("", [maya, loft]).map((choice) => choice.token)).toEqual(["@Maya", "@Loft"]);
    expect(namePickerChoices("lof", [maya, loft]).map((choice) => choice.token)).toEqual(["@Loft"]);
    expect(namePickerChoices("loft.w", [maya, loft]).map((choice) => choice.token)).toEqual(["@Loft.wide"]);
    expect(namePickerChoices("loft.", [loft]).map((choice) => choice.token)).toEqual([
      "@Loft.wide",
      "@Loft.corner",
    ]);
  });

  it("removes a dropped name and leaves an unknown one in place", () => {
    expect(
      expandNameText(
        "a @Maya b @Nope",
        [],
        [{ handle: "Maya", label: null }],
      ),
    ).toBe("a b @Nope");
  });

  it("puts a slot note in parentheses on the first mention only", () => {
    const plan = planNameAttachments({
      prompt: "the woman in @Maya on @Loft and @Maya again",
      galleries: [
        { ...maya, source: "slot", note: "muscular, black sports bra" },
        { ...loft, source: "slot", note: "empty loft, concrete floor", take: 1 },
      ],
      hand: [],
      caps,
    });
    expect(plan.expanded).toBe(
      "the woman in @Image1 @Image2 (muscular, black sports bra) on @Image3 (empty loft, concrete floor) and @Image1 @Image2 again",
    );
  });

  it("replaces a notes-only slot in place and removes a later mention", () => {
    const skin: NameCatalogGallery = {
      id: "skin",
      name: "Skin",
      handle: "Skin",
      take: 1,
      items: [],
      source: "slot",
      note: "warm skin",
    };
    const plan = planNameAttachments({
      prompt: "@Skin light and @Skin again",
      galleries: [skin],
      hand: [],
      caps,
    });
    expect(plan.files).toEqual([]);
    expect(plan.unresolved).toEqual([]);
    expect(plan.expanded).toBe("warm skin light and again");
    expect(plan.hovers[0]?.kind).toBe("note");
    expect(namePickerChoices("", [skin])[0]).toMatchObject({ source: "slot", note: "warm skin" });
    expect(nameSourceLabel("slot")).toBe("Slot");
    expect(nameSourceLabel("gallery")).toBe("Gallery");
  });

  it("leaves a slot with neither files nor a note unresolved", () => {
    const plan = planNameAttachments({
      prompt: "@Empty",
      galleries: [{ id: "empty", name: "Empty", handle: "Empty", take: 1, items: [], source: "slot", note: "" }],
      hand: [],
      caps,
    });
    expect(plan.unresolved.map((mention) => mention.token)).toEqual(["@Empty"]);
    expect(plan.expanded).toBe("@Empty");
  });

  it("drops a slot note with its files and keeps a notes-only slot", () => {
    const skin: NameCatalogGallery = {
      id: "skin",
      name: "Skin",
      handle: "Skin",
      take: 1,
      items: [],
      source: "slot",
      note: "warm skin",
    };
    const dropped = planNameAttachments({
      prompt: "@Maya then @Skin",
      galleries: [{ ...maya, take: 1, source: "slot", note: "muscular" }, skin],
      hand: [],
      caps: { image: 0, video: 0, audio: 0 },
    });
    expect(dropped.dropped).toEqual(["@Maya"]);
    expect(dropped.expanded).toBe("then warm skin");
    expect(dropped.files).toEqual([]);
  });

  it("writes the note again in each extra prompt", () => {
    const kept = [{ handle: "Skin", label: null, tokens: [] as string[], note: "warm skin" }];
    expect(expandNameText("@Skin here", kept, [])).toBe("warm skin here");
    expect(expandNameText("@Skin there", kept, [])).toBe("warm skin there");
  });

  it("lets a project slot win, then an everywhere slot, then a gallery", () => {
    const project: NameCatalogGallery = {
      id: "project",
      name: "Project Maya",
      handle: "Maya",
      take: 1,
      items: [image("project.png", "project")],
      source: "slot",
    };
    const everywhere: NameCatalogGallery = {
      id: "everywhere",
      name: "Everywhere Maya",
      handle: "Maya",
      take: 1,
      items: [image("everywhere.png", "everywhere")],
      source: "slot",
    };
    const open = orderedNameCatalog({ project: [project], everywhere: [everywhere], galleries: [maya] });
    expect(open.map((entry) => entry.id)).toEqual(["project"]);
    expect(planNameAttachments({ prompt: "@Maya", galleries: open, hand: [], caps }).files.map((file) => file.key)).toEqual([
      "project",
    ]);
    const closed = orderedNameCatalog({ everywhere: [everywhere], galleries: [maya] });
    expect(closed.map((entry) => entry.id)).toEqual(["everywhere"]);
    expect(
      planNameAttachments({ prompt: "@Maya", galleries: closed, hand: [], caps }).files.map((file) => file.key),
    ).toEqual(["everywhere"]);
  });

  it("still writes a note for a model that takes no references, and leaves file names as typed", () => {
    const skin: NameCatalogGallery = {
      id: "skin",
      name: "Skin",
      handle: "Skin",
      take: 1,
      items: [],
      source: "slot",
      note: "visible pores, fine texture",
    };
    const catalog = noteOnlyCatalog([{ ...maya, source: "slot", note: "muscular" }, skin, loft]);
    expect(catalog.map((entry) => [entry.handle, entry.items.length])).toEqual([
      ["Maya", 0],
      ["Skin", 0],
    ]);
    const plan = planNameAttachments({
      prompt: "@Maya on @Loft, @Skin",
      galleries: catalog,
      hand: [],
      caps: { image: 0, video: 0, audio: 0 },
    });
    expect(plan.files).toEqual([]);
    expect(plan.expanded).toBe("muscular on @Loft, visible pores, fine texture");
    expect(namePickerChoices("", catalog).map((choice) => choice.token)).toEqual(["@Maya", "@Skin"]);
    // A name with files only keeps its handle, so a later note under the same handle stays hidden.
    expect(noteOnlyCatalog([{ ...maya, source: "slot" }, { ...skin, handle: "Maya" }])).toEqual([]);
  });

  it("reads a linked gallery through the slot and keeps the slot handle", () => {
    const plan = planNameAttachments({
      prompt: "@Maya.wide",
      galleries: [{ ...maya, id: "slot", source: "slot", galleryId: "gallery-1", note: "a note" }],
      hand: [],
      caps,
    });
    expect(plan.files.map((file) => [file.key, file.galleryId, file.token])).toEqual([["wide", "gallery-1", "@Maya.wide"]]);
    expect(plan.expanded).toBe("@Image1 (a note)");
  });

  describe("names inside notes", () => {
    const hair: NameCatalogGallery = {
      id: "hair",
      name: "Hair",
      handle: "Hair",
      take: 1,
      source: "slot",
      note: "long waves, @Texture",
      items: [image("hair.png", "hair")],
    };
    const texture: NameCatalogGallery = {
      id: "texture",
      name: "Texture",
      handle: "Texture",
      take: 1,
      source: "slot",
      note: "fine strands",
      items: [],
    };
    const nia: NameCatalogGallery = {
      id: "nia",
      name: "Nia",
      handle: "Nia",
      take: 2,
      source: "slot",
      note: "tall, with @Hair",
      items: [image("nia1.png", "nia1"), image("nia2.png", "nia2")],
    };

    it("brings a nested name's files and note, numbered after the outer name's", () => {
      const plan = planNameAttachments({ prompt: "@Nia at the bar", galleries: [nia, hair, texture], hand: [], caps });
      expect(plan.files.map((file) => [file.key, file.number, file.token])).toEqual([
        ["nia1", 1, "@Nia"],
        ["nia2", 2, "@Nia"],
        ["hair", 3, "@Hair"],
      ]);
      expect(plan.expanded).toBe("@Image1 @Image2 (tall, with @Image3 (long waves, fine strands)) at the bar");
      expect(plan.hovers.map((hover) => hover.token)).toEqual(["@Nia"]);
      expect(plan.missing).toEqual([]);
    });

    it("writes a note once when the name is also typed in the prompt", () => {
      const plan = planNameAttachments({
        prompt: "@Hair on @Nia, @Texture",
        galleries: [nia, hair, texture],
        hand: [],
        caps,
      });
      expect(plan.files.map((file) => file.key)).toEqual(["hair", "nia1", "nia2"]);
      expect(plan.expanded).toBe("@Image1 (long waves, fine strands) on @Image2 @Image3 (tall, with @Image1),");
    });

    it("ends a loop at the files instead of running on", () => {
      const a: NameCatalogGallery = { ...nia, note: "with @Hair" };
      const b: NameCatalogGallery = { ...hair, note: "worn by @Nia" };
      const plan = planNameAttachments({ prompt: "@Nia", galleries: [a, b], hand: [], caps });
      expect(plan.files.map((file) => file.key)).toEqual(["nia1", "nia2", "hair"]);
      expect(plan.expanded).toBe("@Image1 @Image2 (with @Image3 (worn by @Image1 @Image2))");
      const self: NameCatalogGallery = { ...texture, note: "like @Texture" };
      expect(planNameAttachments({ prompt: "@Texture", galleries: [self], hand: [], caps }).expanded).toBe("like");
    });

    it("stops following names after three notes", () => {
      const chain = ["A", "B", "C", "D", "E"].map(
        (handle, index, all): NameCatalogGallery => ({
          id: handle,
          name: handle,
          handle,
          take: 1,
          source: "slot",
          note: all[index + 1] ? `${handle.toLowerCase()} @${all[index + 1]}` : "e",
          items: [],
        }),
      );
      const plan = planNameAttachments({ prompt: "@A", galleries: chain, hand: [], caps });
      expect(plan.expanded).toBe("a b c d @E");
    });

    it("trims and drops nested files before the outer name, and flags a name that matches nothing", () => {
      const tight = planNameAttachments({
        prompt: "@Nia",
        galleries: [nia, hair, texture],
        hand: [],
        caps: { image: 2, video: 0, audio: 0 },
      });
      expect(tight.files.map((file) => file.key)).toEqual(["nia1", "hair"]);
      expect(tight.trimmed).toEqual([{ token: "@Nia", from: 2, to: 1 }]);
      const one = planNameAttachments({
        prompt: "@Nia",
        galleries: [nia, hair, texture],
        hand: [],
        caps: { image: 1, video: 0, audio: 0 },
      });
      expect(one.files.map((file) => file.key)).toEqual(["nia1"]);
      expect(one.dropped).toEqual(["@Hair"]);
      expect(one.expanded).toBe("@Image1 (tall, with)");

      const lost: NameCatalogGallery = { ...texture, note: "see @Gone and @Gone" };
      const plan = planNameAttachments({ prompt: "@Texture", galleries: [lost], hand: [], caps });
      expect(plan.expanded).toBe("see @Gone and @Gone");
      expect(plan.unresolved).toEqual([]);
      expect(namePlanNotice(plan)).toBe("@Texture’s note uses @Gone, which isn’t a slot or gallery.");
      expect(
        planNameAttachments({ prompt: "@Texture", galleries: [lost], hand: [], caps, flagMissing: false }).missing,
      ).toEqual([]);
    });
  });

  // A face is marked once, as the Character role on the slot's file. These follow a slot mention
  // through to the model fields, the way App builds images and image_roles for a run.
  describe("slot face images", () => {
    function model(properties: Record<string, unknown>) {
      return parseModelControls({
        id: "test-model",
        request_schema: { type: "object", properties: { prompt: { type: "string" }, ...properties } },
      } as OxenModel);
    }
    const faceModel = model({
      input_face_images: { type: "array", maxItems: 9, items: { type: "string" } },
      input_images: { type: "array", maxItems: 9, items: { type: "string" } },
    });
    const plainModel = model({ input_images: { type: "array", maxItems: 9, items: { type: "string" } } });

    function sendImages(controls: typeof faceModel, files: ReturnType<typeof planNameAttachments>["files"]) {
      const images = files.filter((file) => file.kind === "image");
      // App sends image_roles only when the model has a face image input.
      const face = controls.slots.some((slot) => slot.field === "input_face_images");
      return mapMediaUrls(
        controls.slots,
        { image: images.map((file) => file.url ?? ""), video: [], audio: [] },
        face ? { image: images.map((file) => file.role ?? "character") } : undefined,
      );
    }

    const roled = (name: string, key: string, role: "character" | "background" | "object") => ({
      ...image(name, key),
      role,
    });
    // A slot linked to a gallery carries the gallery's roles; it is reached here through another slot's note.
    const mayaSlot: NameCatalogGallery = {
      id: "slot-maya",
      name: "Maya",
      handle: "Maya",
      take: 2,
      source: "slot",
      galleryId: "gallery-maya",
      items: [roled("outfit.png", "outfit", "object"), roled("face.png", "face", "character")],
    };
    const roomSlot: NameCatalogGallery = {
      id: "slot-room",
      name: "Room",
      handle: "Room",
      take: 1,
      source: "slot",
      note: "with @Maya by the window",
      items: [roled("floor.png", "floor", "background")],
    };

    it("sends a slot's Character image to the face input, through a nested, gallery-linked slot", () => {
      const plan = planNameAttachments({ prompt: "a scene in @Room", galleries: [roomSlot, mayaSlot], hand: [], caps });
      expect(plan.files.map((file) => [file.key, file.role])).toEqual([
        ["floor", "background"],
        ["outfit", "object"],
        ["face", "character"],
      ]);
      expect(sendImages(faceModel, plan.files)).toEqual({
        input_images: ["https://studio.example/floor", "https://studio.example/outfit"],
        input_face_images: ["https://studio.example/face"],
      });
    });

    it("sends the same slot images as ordinary references to a model with no face input", () => {
      const plan = planNameAttachments({ prompt: "a scene in @Room", galleries: [roomSlot, mayaSlot], hand: [], caps });
      expect(sendImages(plainModel, plan.files)).toEqual({
        input_images: [
          "https://studio.example/floor",
          "https://studio.example/outfit",
          "https://studio.example/face",
        ],
      });
    });

    it("keeps the mark on a file that survives a trim, so a face ordered first still reaches the face input", () => {
      const faceFirst: NameCatalogGallery = { ...mayaSlot, items: [...mayaSlot.items].reverse() };
      const plan = planNameAttachments({
        prompt: "@Maya",
        galleries: [faceFirst],
        hand: [],
        caps: { image: 1, video: 0, audio: 0 },
      });
      expect(plan.trimmed).toEqual([{ token: "@Maya", from: 2, to: 1 }]);
      expect(sendImages(faceModel, plan.files)).toEqual({ input_face_images: ["https://studio.example/face"] });
    });
  });

  it("attaches an audio slot file as @Audio1 for a model that takes audio", () => {
    const voice: NameCatalogGallery = {
      id: "slot-voice",
      name: "Voice",
      handle: "Voice",
      take: 1,
      source: "slot",
      items: [{ key: "line", kind: "audio", name: "line.mp3", role: null, label: null, url: "https://studio.example/line" }],
    };
    const plan = planNameAttachments({ prompt: "she says @Voice", galleries: [voice], hand: [], caps });
    expect(plan.files.map((file) => [file.kind, file.number, file.role])).toEqual([["audio", 1, null]]);
    expect(plan.expanded).toBe("she says @Audio1");
    const silent = planNameAttachments({
      prompt: "she says @Voice",
      galleries: [voice],
      hand: [],
      caps: { image: 4, video: 0, audio: 0 },
    });
    expect(silent.files).toEqual([]);
    expect(silent.dropped).toEqual(["@Voice"]);
  });
});
