import { describe, expect, it } from "vitest";
import { deleteMentionToken, mentionAtCaret, parseNameMentions, promptContainsToken } from "../src/lib/mentions";
import {
  expandNameText,
  namePickerChoices,
  namePlanNotice,
  planNameAttachments,
  type NameCatalogGallery,
} from "../src/lib/name-mentions";

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
});
