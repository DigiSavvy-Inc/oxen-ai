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
    expect(settings.historyPageSize).toBe(24);
  });

  it("keeps history page size on the allowed steps", () => {
    expect(parseStudioSettings("{}", "{}", 48).historyPageSize).toBe(48);
    expect(parseStudioSettings("{}", "{}", 13).historyPageSize).toBe(24);
    expect(parseStudioSettings("{}", "{}", null).historyPageSize).toBe(24);
  });
});
