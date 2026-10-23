import { describe, expect, it } from "vitest";
import { parseComposerPrefs, parseStudioSettings } from "../worker/user-settings";

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
    expect(settings.historyPageSize).toBe(24);
    expect(settings.composerPrefs).toEqual({
      favoriteOrder: [],
      presets: [],
      activePresetId: null,
    });
  });

  it("keeps a favorite order and named presets", () => {
    const prefs = parseComposerPrefs(
      JSON.stringify({
        favoriteOrder: ["wan-v3-0-video-prime", "wan-v3-0-video", ""],
        activePresetId: "p1",
        presets: [
          {
            id: "p1",
            name: "  4× studio  ",
            numGenerations: 9,
            aspectRatio: "16:9",
            quality: "high",
            resolution: "1K",
          },
          { id: "", name: "skip" },
        ],
      }),
    );
    expect(prefs.favoriteOrder).toEqual(["wan-v3-0-video-prime", "wan-v3-0-video"]);
    expect(prefs.activePresetId).toBe("p1");
    expect(prefs.presets).toEqual([
      {
        id: "p1",
        name: "4× studio",
        numGenerations: 4,
        aspectRatio: "16:9",
        quality: "high",
        resolution: "1K",
      },
    ]);
    expect(parseComposerPrefs(JSON.stringify({ activePresetId: "missing", presets: [] })).activePresetId).toBe(
      null,
    );
  });

  it("keeps history page size on the allowed steps", () => {
    expect(parseStudioSettings("{}", "{}", 48).historyPageSize).toBe(48);
    expect(parseStudioSettings("{}", "{}", 13).historyPageSize).toBe(24);
    expect(parseStudioSettings("{}", "{}", null).historyPageSize).toBe(24);
  });
});
