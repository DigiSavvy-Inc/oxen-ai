import { describe, expect, it } from "vitest";
import {
  clampVideoThumbSeconds,
  videoStillTime,
  videoThumbMs,
  videoThumbSecondsFromMs,
} from "../worker/video-thumb";

describe("gallery video stills", () => {
  it("clamps the setting to tenths of a second", () => {
    expect(clampVideoThumbSeconds("1.24")).toBe(1.2);
    expect(clampVideoThumbSeconds(-4)).toBe(0);
    expect(clampVideoThumbSeconds(400)).toBe(120);
    expect(clampVideoThumbSeconds("nope")).toBe(1);
    expect(videoThumbMs(1.2)).toBe(1200);
    expect(videoThumbSecondsFromMs(1200)).toBe(1.2);
  });

  it("uses the last moment when the clip is shorter than the setting", () => {
    expect(videoStillTime(1, 8)).toBe(1);
    expect(videoStillTime(5, 1.2)).toBeCloseTo(1.15);
    expect(videoStillTime(0, 4)).toBe(0);
    expect(videoStillTime(2, Number.NaN)).toBe(2);
  });
});