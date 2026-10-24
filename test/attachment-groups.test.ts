import { describe, expect, it } from "vitest";
import { groupAttachments, groupCountLabel } from "../src/lib/attachment-groups";
import { indexAfterInsertBefore } from "../src/lib/mentions";

const items = [
  { kind: "image" as const, name: "a.png" },
  { kind: "audio" as const, name: "voice.mp3" },
  { kind: "image" as const, name: "b.png" },
  { kind: "video" as const, name: "walk.mp4" },
];

describe("groupAttachments", () => {
  it("orders sections Images, Videos, Audio and keeps flat indices", () => {
    const groups = groupAttachments(items, { image: 30, video: 10, audio: 10 });
    expect(groups.map((g) => g.label)).toEqual(["Images", "Videos", "Audio"]);
    expect(groups[0].items.map((e) => e.index)).toEqual([0, 2]);
    expect(groups[0].endInsertBefore).toBe(3);
    expect(groupCountLabel(groups[0])).toBe("2/30");
    expect(groupCountLabel(groups[2])).toBe("1/10");
  });

  it("hides empty kinds and flags kinds the model does not take", () => {
    const groups = groupAttachments(items.slice(0, 3), { image: 9, video: 0, audio: 0 });
    expect(groups.map((g) => g.kind)).toEqual(["image", "audio"]);
    expect(groups[1].supported).toBe(false);
    expect(groupCountLabel(groups[1])).toBe("1 · not used by this model");
  });

  it("drop at a group's end keeps same-kind order correct across interleaved kinds", () => {
    const groups = groupAttachments(items, { image: 30 });
    // move first image after the second image
    const to = indexAfterInsertBefore(0, groups[0].endInsertBefore);
    const next = [...items];
    const [moved] = next.splice(0, 1);
    next.splice(to, 0, moved);
    expect(next.filter((i) => i.kind === "image").map((i) => i.name)).toEqual(["b.png", "a.png"]);
  });
});
