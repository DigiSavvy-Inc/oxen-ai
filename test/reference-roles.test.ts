import { describe, expect, it } from "vitest";
import {
  prependMissingBindings,
  referenceBindingText,
  referenceRoleTitle,
} from "../src/lib/reference-roles";

const wrestling = [
  { name: "maya-face.png", kind: "image" as const, role: "character" },
  { name: "jess-face.png", kind: "image" as const, role: "character" },
  { name: "maya-body.png", kind: "image" as const, role: "object" },
  { name: "room.png", kind: "image" as const, role: "scene" },
  { name: "hold.png", kind: "image" as const, role: "object" },
  { name: "grade.png", kind: "image" as const, role: "style" },
  { name: "move.mp4", kind: "video" as const, role: "object" },
  { name: "maya.mp3", kind: "audio" as const },
  { name: "jess.mp3", kind: "audio" as const },
  { name: "coach.mp3", kind: "audio" as const },
];

describe("reference bindings", () => {
  it("describes each Seedance role with character files numbered first", () => {
    expect(referenceRoleTitle("character")).toContain("tight headshot");
    expect(referenceRoleTitle("object")).toContain("not a face");
    const text = referenceBindingText(wrestling, { faceFirst: true, roleKinds: ["image", "video"] });
    expect(text).toBe(
      [
        "@Image1 is a face only.",
        "@Image2 is a face only.",
        "@Image3 is not a face. Use it only for the body, prop, or pose named in this prompt.",
        "@Image4 is the place. Keep it fixed.",
        "@Image5 is not a face. Use it only for the body, prop, or pose named in this prompt.",
        "@Image6 is light and color only. Do not copy the people or the room.",
        "@Video1 is not a face. Use it only for the body, prop, or pose named in this prompt.",
        "@Audio1, @Audio2, and @Audio3 are different voices. Name who speaks on every line. A voice with no face stays off camera.",
      ].join("\n"),
    );
  });

  it("treats a character video as face and motion", () => {
    expect(
      referenceBindingText([{ name: "walk.mp4", kind: "video", role: "character" }], {
        faceFirst: true,
        roleKinds: ["video"],
      }),
    ).toBe("@Video1 is this person's face and motion.");
  });

  it("skips role lines when the model has no face input, and still binds two voices", () => {
    const text = referenceBindingText(
      [
        { name: "a.png", kind: "image", role: "character" },
        { name: "one.mp3", kind: "audio" },
        { name: "two.mp3", kind: "audio" },
      ],
      { faceFirst: false, roleKinds: [] },
    );
    expect(text).toBe(
      "@Audio1 and @Audio2 are different voices. Name who speaks on every line. A voice with no face stays off camera.",
    );
  });

  it("does not add a voice line for a single clip", () => {
    expect(
      referenceBindingText([{ name: "one.mp3", kind: "audio" }], {
        faceFirst: false,
        roleKinds: [],
      }),
    ).toBe("");
  });

  it("prepends only the lines that are not already in the prompt", () => {
    const block = "@Image1 is a face only.\n@Image2 is the place. Keep it fixed.";
    expect(prependMissingBindings("They hold still.", block)).toEqual({
      next: "@Image1 is a face only.\n@Image2 is the place. Keep it fixed.\n\nThey hold still.",
      caret: "@Image1 is a face only.\n@Image2 is the place. Keep it fixed.".length,
    });
    expect(prependMissingBindings("@Image1 is a face only.\n\nThey hold still.", block)).toEqual({
      next: "@Image2 is the place. Keep it fixed.\n\n@Image1 is a face only.\n\nThey hold still.",
      caret: "@Image2 is the place. Keep it fixed.".length,
    });
    expect(prependMissingBindings(block, block)).toBeNull();
    expect(prependMissingBindings("shot", "")).toBeNull();
  });
});
