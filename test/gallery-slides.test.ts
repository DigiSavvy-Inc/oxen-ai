import { describe, expect, it } from "vitest";
import { gallerySwipeSlides } from "../src/lib/gallery-slides";

describe("gallery swipe slides", () => {
  it("keeps images and videos in order and leaves audio out", () => {
    expect(
      gallerySwipeSlides([
        { id: "a", kind: "image", name: "hero", url: "https://studio.example/a.png", preview: "https://studio.example/a-t.png" },
        { id: "b", kind: "audio", name: "bed", url: "https://studio.example/b.mp3" },
        { id: "c", kind: "video", name: "walk", url: "https://studio.example/c.mp4", preview: "" },
        { id: "d", kind: "image", name: "empty", url: "" },
      ]),
    ).toEqual([
      {
        id: "a",
        src: "https://studio.example/a.png",
        alt: "hero",
        mediaType: "image",
        poster: "https://studio.example/a-t.png",
      },
      {
        id: "c",
        src: "https://studio.example/c.mp4",
        alt: "walk",
        mediaType: "video",
        poster: null,
      },
    ]);
  });
});
