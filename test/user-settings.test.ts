import { describe, expect, it } from "vitest";
import { parseStudioSettings } from "../worker/user-settings";

describe("parseStudioSettings", () => {
  it("reads optional per-mode defaults and shared last params", () => {
    const settings = parseStudioSettings(
      JSON.stringify({ "text-to-image": "gpt-image-2-5-flare", bogus: 1 }),
      JSON.stringify({
        aspect_ratio: "16:9",
        duration: "8",
        num_generations: 9,
        generate_audio: true,
        extra: "nope",
      }),
    );
    expect(settings.defaultModelByMode["text-to-image"]).toBe("gpt-image-2-5-flare");
    expect(settings.defaultModelByMode).not.toHaveProperty("bogus");
    expect(settings.lastParams).toEqual({
      aspect_ratio: "16:9",
      duration: "8",
      num_generations: 4,
      generate_audio: true,
    });
  });
});
