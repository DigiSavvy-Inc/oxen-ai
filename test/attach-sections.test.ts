import { describe, expect, it } from "vitest";
import {
  attachSectionCount,
  attachSections,
  dropsBefore,
  sectionMoveTarget,
} from "../src/lib/attach-sections";
import { moveItem, tokenForItem } from "../src/lib/mentions";

type Chip = { kind: "image" | "video" | "audio"; name: string };

const shot: Chip[] = [
  { kind: "image", name: "hero" },
  { kind: "audio", name: "voice-1" },
  { kind: "image", name: "room" },
  { kind: "video", name: "walk" },
  { kind: "audio", name: "voice-2" },
  { kind: "image", name: "prop" },
];

const tokens = (items: Chip[]) => items.map((item, index) => `${item.name}=${tokenForItem(items, item, index)}`);

describe("attached media sections", () => {
  it("groups interleaved chips into Images, Videos, Audio in that order and skips empty kinds", () => {
    const sections = attachSections(shot, { image: 30, video: 2, audio: 10 });
    expect(sections.map((section) => section.label)).toEqual(["Images", "Videos", "Audio"]);
    expect(sections[0]!.entries.map((entry) => entry.item.name)).toEqual(["hero", "room", "prop"]);
    // Each chip keeps its place in the full list, which reorder and Remove act on.
    expect(sections[0]!.entries.map((entry) => entry.index)).toEqual([0, 2, 5]);
    expect(sections[2]!.entries.map((entry) => entry.index)).toEqual([1, 4]);
    expect(attachSections([{ kind: "audio", name: "a" }], {}).map((section) => section.kind)).toEqual(["audio"]);
    expect(attachSections([], { image: 4 })).toEqual([]);
  });

  it("puts Documents last, after the media kinds", () => {
    const sections = attachSections(
      [
        { kind: "document" as const, name: "brief.pdf" },
        { kind: "image" as const, name: "hero" },
      ],
      { image: 4, document: 4 },
    );
    expect(sections.map((section) => section.label)).toEqual(["Images", "Documents"]);
  });

  it("counts against the model's limit, or alone when no limit is known", () => {
    expect(attachSectionCount(10, 30)).toBe("10 of 30");
    expect(attachSectionCount(3, null)).toBe("3");
    expect(attachSectionCount(1, 0)).toBe("1");
  });

  it("marks a kind the model takes none of as unused so it can be dimmed but still removed", () => {
    const sections = attachSections(shot, { image: 4, video: 0, audio: 3 });
    expect(sections.map((section) => [section.kind, section.unused])).toEqual([
      ["image", false],
      ["video", true],
      ["audio", false],
    ]);
    // An unknown limit is not the same as a model that takes none.
    expect(attachSections(shot, {}).some((section) => section.unused)).toBe(false);
  });

  it("moves a chip within its section and leaves other kinds' numbers alone", () => {
    const images = [0, 2, 5];
    // Drag "prop" (Image 3) before "hero" (Image 1).
    const to = sectionMoveTarget(images, 5, 0);
    const next = moveItem(shot, 5, to);
    expect(tokens(next)).toEqual(
      expect.arrayContaining(["prop=@Image1", "hero=@Image2", "room=@Image3", "walk=@Video1", "voice-1=@Audio1", "voice-2=@Audio2"]),
    );

    // Drag "hero" to the end of the Images section.
    const last = moveItem(shot, 0, sectionMoveTarget(images, 0, images.length));
    expect(last.filter((item) => item.kind === "image").map((item) => item.name)).toEqual(["room", "prop", "hero"]);
    expect(last.filter((item) => item.kind === "audio").map((item) => item.name)).toEqual(["voice-1", "voice-2"]);

    // Dropping a chip next to itself is not a move.
    expect(sectionMoveTarget(images, 2, 1)).toBe(2);
    expect(sectionMoveTarget(images, 2, 2)).toBe(2);
  });

  it("splits a drop left and right in a row, and top and bottom in a single column", () => {
    const rect = { left: 0, top: 0, width: 260, height: 48 };
    expect(dropsBefore(rect, { x: 40, y: 40 }, 800)).toBe(true);
    expect(dropsBefore(rect, { x: 200, y: 4 }, 800)).toBe(false);
    const wide = { left: 0, top: 0, width: 340, height: 48 };
    expect(dropsBefore(wide, { x: 300, y: 10 }, 340)).toBe(true);
    expect(dropsBefore(wide, { x: 10, y: 40 }, 340)).toBe(false);
  });
});
