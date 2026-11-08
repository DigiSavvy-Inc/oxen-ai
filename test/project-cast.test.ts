import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  castNumberMap,
  castRequestBody,
  castWithEntryMoved,
  castWithFiles,
  castWithGallery,
  castWithItemActive,
  castWithoutEntry,
  castWithoutItem,
  droppedMentionNotice,
  flattenCast,
  missingMention,
  rewriteMentions,
  selectCastAttachments,
  type CastEntry,
  type CastGalleryItem,
} from "../src/lib/cast";
import { attachmentForMention, filterMentionItems, tokenForItem } from "../src/lib/mentions";
import { acceptProjectBudget, acceptProjectCast } from "../worker/project-cast";

function galleryItem(
  name: string,
  kind: CastGalleryItem["kind"] = "image",
  extra: Partial<CastGalleryItem> = {},
): CastGalleryItem {
  return {
    id: `gi-${name}`,
    kind,
    name,
    key: `u/user/${name}`,
    url: `https://media/${name}`,
    thumbUrl: null,
    galleryRole: kind === "audio" ? null : "character",
    roleOverride: null,
    active: true,
    excluded: false,
    ...extra,
  };
}

function gallery(id: string, items: CastGalleryItem[], active = true): CastEntry {
  return { type: "gallery", id, name: id, active, items };
}

function file(name: string, kind: CastEntry["type"] extends "file" ? never : "image" | "video" | "audio" = "image"): CastEntry {
  return {
    type: "file",
    id: `f-${name}`,
    kind,
    name,
    key: `u/user/${name}`,
    url: `https://media/${name}`,
    thumbUrl: null,
    role: kind === "audio" ? null : "object",
    active: true,
  };
}

const cast: CastEntry[] = [
  gallery("a", [galleryItem("a1"), galleryItem("a2"), galleryItem("a-clip", "video")]),
  gallery("b", [galleryItem("b1"), galleryItem("b2", "image", { active: false }), galleryItem("b3")]),
  file("loose", "image"),
  file("voice", "audio"),
];

describe("flattenCast", () => {
  it("numbers each kind in project order and keeps inactive items in the count", () => {
    const items = flattenCast(cast);
    expect(items.map((item) => `${item.kind}${item.number}:${item.name}`)).toEqual([
      "image1:a1",
      "image2:a2",
      "video1:a-clip",
      "image3:b1",
      "image4:b2",
      "image5:b3",
      "image6:loose",
      "audio1:voice",
    ]);
    expect(items.find((item) => item.name === "b2")?.active).toBe(false);
  });

  it("leaves excluded gallery items out and gives the next item their number", () => {
    const next = castWithoutItem(cast, flattenCast(cast)[3]!);
    const items = flattenCast(next);
    expect(items.map((item) => item.name)).not.toContain("b1");
    expect(items.find((item) => item.name === "b2")?.number).toBe(3);
    expect(items.find((item) => item.name === "loose")?.number).toBe(5);
  });

  it("turns a whole gallery off without moving any number", () => {
    const before = flattenCast(cast);
    const after = flattenCast(cast.map((entry) => (entry.id === "a" ? { ...entry, active: false } : entry)));
    expect(after.map((item) => item.number)).toEqual(before.map((item) => item.number));
    expect(after.filter((item) => item.entryId === "a").every((item) => !item.active)).toBe(true);
  });

  it("appends a gallery or a file without renumbering", () => {
    const before = flattenCast(cast);
    const withGallery = flattenCast(castWithGallery(cast, { id: "c", name: "c" }));
    expect(withGallery.slice(0, before.length)).toEqual(before);
    const withFile = flattenCast(
      castWithFiles(cast, [{ kind: "image", name: "new", key: "u/user/new", url: null }]),
    );
    expect(withFile.slice(0, before.length)).toEqual(before);
    expect(withFile.at(-1)).toMatchObject({ name: "new", number: 7 });
    const duplicate = castWithFiles(cast, [{ kind: "image", name: "again", key: "u/user/loose", url: null }]);
    expect(duplicate).toHaveLength(cast.length);
  });
});

describe("selectCastAttachments", () => {
  const caps = { image: 50, video: 10, audio: 10 };

  it("attaches active items in order up to the budget", () => {
    const items = flattenCast(cast);
    const selection = selectCastAttachments(items, { budget: 3, caps });
    expect(selection.attached.map((item) => item.name)).toEqual(["a1", "a2", "a-clip"]);
    expect(selection.total).toBe(8);
    expect(selection.overBudget).toBe(4);
  });

  it("skips inactive items and keeps their numbers on the attached ones", () => {
    const selection = selectCastAttachments(flattenCast(cast), { budget: 20, caps });
    expect(selection.attached.map((item) => item.name)).not.toContain("b2");
    expect(selection.attached.find((item) => item.name === "b3")?.number).toBe(5);
  });

  it("cuts each kind at the model's slot limit and skips kinds it cannot take", () => {
    const selection = selectCastAttachments(flattenCast(cast), {
      budget: 20,
      caps: { image: 2, video: 0, audio: 1 },
    });
    expect(selection.attached.map((item) => item.name)).toEqual(["a1", "a2", "voice"]);
    expect(selection.skipped.map((item) => item.name)).toEqual(["a-clip", "b1", "b3", "loose"]);
  });

  it("does not let a skipped item use the budget", () => {
    const selection = selectCastAttachments(flattenCast(cast), {
      budget: 2,
      caps: { image: 50, video: 0, audio: 10 },
    });
    expect(selection.attached.map((item) => item.name)).toEqual(["a1", "a2"]);
  });
});

describe("rewriteMentions", () => {
  it("renumbers mentions above the removed item and drops its own mention", () => {
    const before = flattenCast(cast);
    const removed = before.find((item) => item.name === "b1")!;
    const after = flattenCast(castWithoutItem(cast, removed));
    const map = castNumberMap(before, after);
    const result = rewriteMentions(
      "@Image1 walks past @Image3 @Image5, then @Image6 arrives with @Video1 and @Audio1.",
      map,
    );
    expect(result.next).toBe("@Image1 walks past @Image4, then @Image5 arrives with @Video1 and @Audio1.");
    expect(result.dropped).toEqual(["@Image3"]);
    expect(droppedMentionNotice(result.dropped)).toBe("Removed @Image3 from the prompt.");
  });

  it("leaves a prompt alone when the numbers did not move", () => {
    const items = flattenCast(cast);
    const map = castNumberMap(items, flattenCast(castWithGallery(cast, { id: "z", name: "z" })));
    const result = rewriteMentions("@Image2 and @Image6", map);
    expect(result.changed).toBe(false);
    expect(result.next).toBe("@Image2 and @Image6");
  });

  it("does not touch @Image10 while renumbering @Image1", () => {
    const map = { image: new Map([[1, 2]]), video: new Map(), audio: new Map() };
    expect(rewriteMentions("@Image1 and @Image10", map).next).toBe("@Image2 and @Image10");
  });

  it("drops every mention of a removed gallery", () => {
    const before = flattenCast(cast);
    const after = flattenCast(castWithoutEntry(cast, "a"));
    const result = rewriteMentions("@Image1 @Image2 @Video1 @Image3 @Image6", castNumberMap(before, after));
    expect(result.next).toBe("@Image1 @Image4");
    expect(result.dropped).toEqual(["@Image1", "@Image2", "@Video1"]);
  });

  it("maps a reorder so the mention follows its item", () => {
    const before = flattenCast(cast);
    const after = flattenCast(castWithEntryMoved(cast, 2, 0));
    const result = rewriteMentions("@Image6 then @Image1", castNumberMap(before, after));
    expect(result.next).toBe("@Image1 then @Image2");
  });
});

describe("missingMention", () => {
  it("names the first mention that is not attached", () => {
    const selection = selectCastAttachments(flattenCast(cast), {
      budget: 3,
      caps: { image: 50, video: 10, audio: 10 },
    });
    expect(missingMention("@Image1 and @Image5 at dusk", selection.attached)).toBe("@Image5");
    expect(missingMention("@Image1 and @Image2", selection.attached)).toBeNull();
  });

  it("treats position as the number when items carry none", () => {
    const attached = [{ kind: "image" as const }, { kind: "image" as const }];
    expect(missingMention("@Image2", attached)).toBeNull();
    expect(missingMention("@Image3", attached)).toBe("@Image3");
  });

  it("flags an inactive item that kept its number", () => {
    const selection = selectCastAttachments(flattenCast(cast), {
      budget: 20,
      caps: { image: 50, video: 10, audio: 10 },
    });
    expect(missingMention("@Image4", selection.attached)).toBe("@Image4");
  });
});

describe("mentions with project numbers", () => {
  const attached = selectCastAttachments(flattenCast(cast), {
    budget: 20,
    caps: { image: 50, video: 10, audio: 10 },
  }).attached;

  it("tokens use the project number, not the chip position", () => {
    const b3 = attached.find((item) => item.name === "b3")!;
    expect(tokenForItem(attached, b3, 0)).toBe("@Image5");
  });

  it("resolves a mention by project number", () => {
    expect(attachmentForMention(attached, { kind: "image", index: 4 })?.name).toBe("b3");
    expect(attachmentForMention(attached, { kind: "image", index: 3 })).toBeNull();
  });

  it("filters the picker by project number", () => {
    expect(filterMentionItems("image5", attached).map((item) => item.name)).toEqual(["b3"]);
    expect(filterMentionItems("4", attached)).toEqual([]);
  });
});

describe("cast request and acceptance", () => {
  it("sends only the gallery items that differ from the gallery", () => {
    const toggled = castWithItemActive(cast, flattenCast(cast)[0]!, false);
    const body = castRequestBody(toggled);
    const first = body[0];
    expect(first?.type).toBe("gallery");
    if (first?.type === "gallery") {
      expect(first.items).toEqual([{ key: "u/user/a1", active: false, excluded: false, role: null }]);
    }
    const second = body[1];
    if (second?.type === "gallery") {
      expect(second.items).toEqual([{ key: "u/user/b2", active: false, excluded: false, role: null }]);
    }
  });

  it("accepts a cast whose keys belong to the user and rejects others", () => {
    const body = castRequestBody(cast);
    const accepted = acceptProjectCast("user", body);
    expect(accepted).not.toBeNull();
    expect(accepted?.map((entry) => entry.type)).toEqual(["gallery", "gallery", "file", "file"]);
    expect(acceptProjectCast("someone-else", body)).toBeNull();
    expect(acceptProjectCast("user", [{ type: "mystery" }])).toBeNull();
  });

  it("keeps the budget between 1 and 96 and defaults to 20", () => {
    expect(acceptProjectBudget(undefined)).toBe(20);
    expect(acceptProjectBudget("12")).toBe(12);
    expect(acceptProjectBudget(0)).toBeNull();
    expect(acceptProjectBudget(97)).toBeNull();
  });
});

describe("0025 migration", () => {
  it("moves pinned files after the galleries and adds the budget", () => {
    const raw = new DatabaseSync(":memory:");
    for (const file of ["0001_init.sql", "0009_galleries.sql", "0022_projects.sql", "0024_looks.sql"]) {
      raw.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
    }
    raw.exec(
      `INSERT INTO projects (id, user_id, profile_id, name, prompt, style_id, created_at, updated_at) VALUES ('pr1', 'u1', 'p1', 'Clip', '', NULL, 1, 1);
       INSERT INTO project_galleries (project_id, gallery_id, position) VALUES ('pr1', 'g1', 0);
       INSERT INTO project_media (id, project_id, user_id, kind, name, media_key, role, position)
         VALUES ('m1', 'pr1', 'u1', 'image', 'a.png', 'u/u1/a.png', NULL, 0);`,
    );
    raw.exec(readFileSync(new URL("../migrations/0025_project_cast.sql", import.meta.url), "utf8"));
    expect(raw.prepare(`SELECT position, active FROM project_media WHERE id = 'm1'`).get()).toEqual({
      position: 1,
      active: 1,
    });
    expect(raw.prepare(`SELECT budget FROM projects WHERE id = 'pr1'`).get()).toEqual({ budget: 20 });
  });
});
