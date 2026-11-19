import { describe, expect, it } from "vitest";
import { pastedImages } from "../src/lib/clipboard";

function clip(files: File[], text = "") {
  return { files, getData: (format: string) => (format === "text/plain" ? text : "") };
}

const STAMP = new Date(2026, 10, 19, 9, 5, 7).getTime();

describe("pasting an image into the prompt", () => {
  it("attaches a screenshot and gives it a name that tells pasted images apart", () => {
    const shot = new File([new Uint8Array([1, 2, 3])], "image.png", { type: "image/png" });
    const result = pastedImages(clip([shot]), STAMP);
    expect(result.files.map((file) => file.name)).toEqual(["pasted-090507.png"]);
    expect(result.files[0]?.type).toBe("image/png");
    expect(result.files[0]?.size).toBe(3);
    expect(result.unsupported).toBe(0);
  });

  it("keeps a real file name, and numbers several nameless images", () => {
    const named = new File([""], "moodboard.webp", { type: "image/webp" });
    const first = new File([""], "", { type: "image/jpeg" });
    const second = new File([""], "image.gif", { type: "image/gif" });
    const result = pastedImages(clip([first, named, second]), STAMP);
    expect(result.files.map((file) => file.name)).toEqual([
      "pasted-090507.jpg",
      "moodboard.webp",
      "pasted-090507-3.gif",
    ]);
  });

  it("does not attach a format Studio cannot store, and says so", () => {
    const tiff = new File([""], "image.tiff", { type: "image/tiff" });
    const heic = new File([""], "photo.heic", { type: "image/heic" });
    const result = pastedImages(clip([tiff, heic]), STAMP);
    expect(result.files).toEqual([]);
    expect(result.unsupported).toBe(2);
  });

  it("leaves a text paste alone, even when the app copied a picture of that text beside it", () => {
    const picture = new File([""], "image.png", { type: "image/png" });
    const result = pastedImages(clip([picture], "Quarterly numbers"), STAMP);
    expect(result.text).toBe(true);
    expect(result.files).toEqual([]);
    expect(result.unsupported).toBe(0);
  });

  it("ignores files that are not images, so nothing is attached or blocked", () => {
    const pdf = new File([""], "brief.pdf", { type: "application/pdf" });
    expect(pastedImages(clip([pdf]), STAMP)).toEqual({ files: [], unsupported: 0, text: false });
    expect(pastedImages(null, STAMP)).toEqual({ files: [], unsupported: 0, text: false });
  });
});
