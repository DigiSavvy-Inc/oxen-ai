import { describe, expect, it } from "vitest";
import { slotGroup, slotMatchesFilter } from "../src/lib/slot-groups";

const image = { kind: "image" as const };
const video = { kind: "video" as const };
const audio = { kind: "audio" as const };

describe("slot groups", () => {
  it("groups a slot by the kind it has the most of, and notes-only slots as notes", () => {
    expect(slotGroup({ note: "warm skin", files: [] })).toBe("note");
    expect(slotGroup({ note: "", files: [] })).toBe("empty");
    expect(slotGroup({ note: "a note", files: [image, image, audio] })).toBe("image");
    expect(slotGroup({ note: "", files: [audio] })).toBe("audio");
    expect(slotGroup({ note: "", files: [video, video, image] })).toBe("video");
  });

  it("lets a filter find a mixed slot by either file kind, and keeps notes to words with no files", () => {
    const mixed = { note: "muscular", files: [image, audio] };
    expect(slotMatchesFilter(mixed, "image")).toBe(true);
    expect(slotMatchesFilter(mixed, "audio")).toBe(true);
    expect(slotMatchesFilter(mixed, "video")).toBe(false);
    expect(slotMatchesFilter(mixed, "note")).toBe(false);
    expect(slotMatchesFilter({ note: "warm skin", files: [] }, "note")).toBe(true);
    expect(slotMatchesFilter({ note: "", files: [audio] }, "all")).toBe(true);
  });
});
