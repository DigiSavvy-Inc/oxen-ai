import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gallerySections } from "../src/lib/gallery-sections";

describe("gallery sections", () => {
  it("sorts images, backgrounds and objects, video, and audio", () => {
    const sections = gallerySections([
      { kind: "image" as const, role: "character", name: "face" },
      { kind: "audio" as const, name: "bed" },
      { kind: "image" as const, role: "object", name: "prop" },
      { kind: "video" as const, role: "background", name: "plate" },
      { kind: "video" as const, name: "person" },
      { kind: "image" as const, role: "scene", name: "room" },
      { kind: "image" as const, role: "style", name: "look" },
    ]);
    expect(sections.map((section) => section.id)).toEqual([
      "image-faces",
      "image-scene",
      "video-faces",
      "video-scene",
      "audio",
    ]);
    expect(sections.map((section) => section.title)).toEqual([
      "Images",
      "Backgrounds, objects, styles",
      "Videos",
      "Backgrounds, objects, styles",
      "Audio",
    ]);
    expect(sections[0]?.items.map((entry) => entry.item.name)).toEqual(["face"]);
    expect(sections[0]?.items[0]?.index).toBe(0);
    expect(sections[1]?.items.map((entry) => [entry.item.name, entry.index])).toEqual([
      ["prop", 2],
      ["room", 5],
      ["look", 6],
    ]);
    expect(sections[2]?.items.map((entry) => entry.item.name)).toEqual(["person"]);
    expect(sections[3]?.items.map((entry) => entry.item.name)).toEqual(["plate"]);
    expect(sections[4]?.items.map((entry) => entry.item.name)).toEqual(["bed"]);
  });

  it("offers the same role control in the attachment gallery and the library gallery", () => {
    const drawer = readFileSync(new URL("../src/components/GalleryDrawer.tsx", import.meta.url), "utf8");
    const browser = readFileSync(new URL("../src/components/GalleryBrowser.tsx", import.meta.url), "utf8");
    const role = readFileSync(new URL("../src/components/GalleryRoleSelect.tsx", import.meta.url), "utf8");
    expect(drawer).toContain("GallerySections");
    expect(browser).toContain("GallerySections");
    expect(drawer).toContain("GalleryRoleSelect");
    expect(browser).toContain("GalleryRoleSelect");
    expect(drawer).toContain("Images, video, and audio sort into their own groups.");
    expect(role).toContain("REFERENCE_ROLES.map");
    expect(role).toContain("referenceRoleLabel(role)");
    expect(gallerySections([])).toEqual([]);
  });
});
