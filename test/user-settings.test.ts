import { describe, expect, it } from "vitest";
import { GALLERY_LISTING_PREVIEW_COUNT } from "../worker/gallery-present";
import { DEFAULT_HISTORY_PAGE_SIZE } from "../worker/history-page-size";
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
        omni_reference_task_type: "extend",
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
      omni_reference_task_type: "extend",
    });
    expect(settings.historyPageSize).toBe(36);
    expect(settings.videoThumbSeconds).toBe(1);
  });

  it("keeps history page size on the allowed steps", () => {
    expect(parseStudioSettings("{}", "{}", 48).historyPageSize).toBe(48);
    expect(parseStudioSettings("{}", "{}", 36).historyPageSize).toBe(36);
    expect(parseStudioSettings("{}", "{}", 13).historyPageSize).toBe(36);
    expect(parseStudioSettings("{}", "{}", null).historyPageSize).toBe(36);
    expect(DEFAULT_HISTORY_PAGE_SIZE).toBe(36);
    expect(GALLERY_LISTING_PREVIEW_COUNT).toBe(DEFAULT_HISTORY_PAGE_SIZE);
  });

  it("reads the gallery video still as seconds", () => {
    expect(parseStudioSettings("{}", "{}", 24, 2500).videoThumbSeconds).toBe(2.5);
    expect(parseStudioSettings("{}", "{}", 24, 0).videoThumbSeconds).toBe(0);
    expect(parseStudioSettings("{}", "{}", 24, 999999).videoThumbSeconds).toBe(120);
    expect(parseStudioSettings("{}", "{}", 24, null).videoThumbSeconds).toBe(1);
  });
});
