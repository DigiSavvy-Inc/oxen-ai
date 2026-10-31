import { describe, expect, it } from "vitest";
import {
  acceptsSwipePointer,
  pointerHitsVideoControls,
  pointerSwipe,
  stripOffset,
  wheelPixels,
  wheelSwipe,
} from "../src/lib/slide-swipe";

describe("slide swipe", () => {
  it("accepts touch and pen, and leaves mouse clicks alone", () => {
    expect(acceptsSwipePointer("touch")).toBe(true);
    expect(acceptsSwipePointer("pen")).toBe(true);
    expect(acceptsSwipePointer("mouse")).toBe(false);
    expect(acceptsSwipePointer("")).toBe(false);
  });

  it("advances on a leftward finger swipe and goes back on a rightward one", () => {
    expect(pointerSwipe({ x: 200, y: 100 }, { x: 120, y: 108 })).toBe(1);
    expect(pointerSwipe({ x: 80, y: 100 }, { x: 160, y: 90 })).toBe(-1);
  });

  it("ignores a tap, a short drag, and a vertical move", () => {
    expect(pointerSwipe({ x: 40, y: 40 }, { x: 44, y: 42 })).toBe(0);
    expect(pointerSwipe({ x: 40, y: 40 }, { x: 70, y: 40 })).toBe(0);
    expect(pointerSwipe({ x: 40, y: 40 }, { x: 50, y: 160 })).toBe(0);
    expect(pointerSwipe({ x: 40, y: 40 }, { x: 110, y: 140 })).toBe(0);
  });

  it("turns line and page wheel deltas into pixels", () => {
    expect(wheelPixels(2, 0)).toBe(2);
    expect(wheelPixels(2, 1)).toBe(32);
    expect(wheelPixels(1, 2)).toBe(800);
  });

  it("accumulates a horizontal trackpad flick and clears on a vertical scroll", () => {
    const accum = { x: 0, y: 0 };
    expect(wheelSwipe(accum, 30, 4)).toBe(0);
    expect(accum.x).toBe(30);
    expect(wheelSwipe(accum, 40, 2)).toBe(1);
    expect(accum).toEqual({ x: 0, y: 0, locked: true });
    expect(wheelSwipe(accum, 90, 0)).toBe(0);
    expect(wheelSwipe(accum, 40, 2)).toBe(0);

    accum.locked = false;
    expect(wheelSwipe(accum, -40, -4)).toBe(0);
    expect(wheelSwipe(accum, -30, 0)).toBe(-1);

    accum.locked = false;
    accum.x = 40;
    expect(wheelSwipe(accum, 2, 30)).toBe(0);
    expect(accum).toEqual({ x: 0, y: 0, locked: false });
  });

  it("leaves the video picture free to swipe and keeps the control strip", () => {
    expect(pointerHitsVideoControls(100, 0, 400)).toBe(false);
    expect(pointerHitsVideoControls(370, 0, 400)).toBe(true);
    expect(pointerHitsVideoControls(20, 0, 0)).toBe(true);
  });

  it("treats a mouse-wheel line tick as enough to step once it crosses the threshold", () => {
    const accum = { x: 0, y: 0 };
    expect(wheelSwipe(accum, 4, 0, 1)).toBe(1);
  });

  it("keeps only the current slide and its two neighbors in the strip", () => {
    expect(stripOffset(0, 0, 4)).toBe(0);
    expect(stripOffset(1, 0, 4)).toBe(1);
    expect(stripOffset(3, 0, 4)).toBe(-1);
    expect(stripOffset(2, 0, 4)).toBeNull();
    expect(stripOffset(0, 3, 4)).toBe(1);
    expect(stripOffset(1, 0, 2, 1)).toBe(1);
    expect(stripOffset(1, 0, 2, -1)).toBe(-1);
    expect(stripOffset(1, 1, 2, -1)).toBe(0);
    expect(stripOffset(0, 1, 2, -1)).toBe(-1);
  });
});
