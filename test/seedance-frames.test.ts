import { describe, expect, it } from "vitest";
import { planGalleryAttach } from "../src/lib/gallery-attach";
import { attachKindCap, mergeLibraryRefs } from "../src/lib/library-refs";
import { assignFrames, parseModelControls } from "../worker/schema";

/**
 * Live Seedance 2.5 image-to-video schema: the start frame is one URI
 * (`input_image`) and the end frame is `tail_image_url`. There is no
 * reference-image list, so a third image has nowhere to go.
 */
const seedanceImageToVideo = {
  id: "bytedance-seedance-2-5-image-to-video",
  display_name: "Seedance 2.5 - Image to Video",
  endpoint: "/videos/generate",
  capabilities: { input: ["image", "text"], output: ["video"] },
  request_schema: {
    type: "object",
    required: ["prompt", "input_image"],
    properties: {
      prompt: { type: "string" },
      input_image: {
        type: "string",
        format: "uri",
        title: "Start Frame",
        description: "The URL of the starting frame image. Formats: JPEG, PNG, WebP. Max 30 MB.",
      },
      input_image_has_face: { type: "boolean", default: false },
      tail_image_url: {
        type: "string",
        format: "uri",
        title: "End Frame",
        description:
          "Optional URL of the end-frame image. When provided, the generated video transitions from the start frame to this end frame.",
      },
      tail_image_url_has_face: { type: "boolean", default: false },
    },
  },
};

function image(name: string, index: number) {
  return {
    kind: "image" as const,
    name,
    key: `frame-${index}`,
    url: `https://studio.example/${name}`,
    preview: `https://studio.example/${name}`,
    generationId: `gen-${index}`,
  };
}

describe("Seedance 2.5 image to video frames", () => {
  const controls = parseModelControls(seedanceImageToVideo);
  const model = {
    id: seedanceImageToVideo.id,
    capabilities: seedanceImageToVideo.capabilities,
  };
  const cap = attachKindCap(controls, "reference-to-video", "image", model);

  it("treats the model as first frame plus last frame, so two images fit", () => {
    expect(controls.frames).toEqual({ references: false, firstFace: true, lastFace: true });
    expect(controls.slots).toEqual([
      { field: "input_image", kind: "image", required: true, maxItems: 1, asArray: false },
    ]);
    // The start-frame field itself holds one URI. The cap is two because the
    // second image is the end frame, not a second value in that field.
    expect(cap).toBe(2);
    expect(assignFrames([null], controls.frames)).toEqual(["first"]);
    expect(assignFrames([null, null], controls.frames)).toEqual(["first", "last"]);
  });

  it("keeps a gallery pair in order and skips a third image", () => {
    const items = [image("start.png", 1), image("end.png", 2), image("extra.png", 3)];
    const plan = planGalleryAttach({
      items,
      staged: [],
      caps: { image: cap, video: 0, audio: 0, document: 0 },
      prompt: "hold still",
      faceFirst: false,
    });
    expect(plan.add.map((item) => item.name)).toEqual(["start.png", "end.png"]);
    expect(plan.skipped.map((item) => item.name)).toEqual(["extra.png"]);
    expect(assignFrames(plan.add.map(() => null), controls.frames)).toEqual(["first", "last"]);
  });

  it("keeps a multi-select pair in attach order and drops the extra", () => {
    const merged = mergeLibraryRefs(
      [],
      [image("start.png", 1), image("end.png", 2), image("extra.png", 3)],
      () => cap,
    );
    expect(merged.map((item) => item.name)).toEqual(["start.png", "end.png"]);
  });
});
