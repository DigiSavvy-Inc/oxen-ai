export type SwipePoint = {
  x: number;
  y: number;
};

export type WheelAccum = {
  x: number;
  y: number;
};

/** -1 previous, 1 next, 0 stay. */
export type SwipeStep = -1 | 0 | 1;

const DOMINANCE = 1.15;
const POINTER_THRESHOLD = 48;
const WHEEL_THRESHOLD = 64;

/** Touch and pen. A mouse drag stays a click. */
export function acceptsSwipePointer(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** Native video controls sit on the bottom edge. A swipe there would fight the scrubber. */
export function pointerHitsVideoControls(clientY: number, top: number, height: number): boolean {
  if (!(height > 0)) return true;
  const band = Math.min(48, height * 0.22);
  return clientY > top + height - band;
}

/**
 * Finger moving left (negative dx) advances. A mostly vertical move stays put
 * so the actual-size scroller and a sloppy tap still work.
 */
export function pointerSwipe(start: SwipePoint, end: SwipePoint, threshold = POINTER_THRESHOLD): SwipeStep {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.abs(dx) < threshold) return 0;
  if (Math.abs(dx) < Math.abs(dy) * DOMINANCE) return 0;
  return dx < 0 ? 1 : -1;
}

/** DOM_DELTA_PIXEL = 0, DOM_DELTA_LINE = 1, DOM_DELTA_PAGE = 2. */
export function wheelPixels(delta: number, mode: number): number {
  if (mode === 1) return delta * 16;
  if (mode === 2) return delta * 800;
  return delta;
}

/**
 * Trackpad and horizontal wheel. Positive deltaX (content moves left, the
 * natural-scroll match for a finger moving left) advances. Vertical motion
 * clears the accumulator.
 */
export function wheelSwipe(
  accum: WheelAccum,
  deltaX: number,
  deltaY: number,
  mode = 0,
  threshold = WHEEL_THRESHOLD,
): SwipeStep {
  const x = wheelPixels(deltaX, mode);
  const y = wheelPixels(deltaY, mode);
  if (Math.abs(y) > Math.abs(x)) {
    accum.x = 0;
    accum.y = 0;
    return 0;
  }
  accum.x += x;
  accum.y += y;
  if (Math.abs(accum.x) < threshold) return 0;
  if (Math.abs(accum.x) < Math.abs(accum.y) * DOMINANCE) {
    accum.x = 0;
    accum.y = 0;
    return 0;
  }
  const step: SwipeStep = accum.x > 0 ? 1 : -1;
  accum.x = 0;
  accum.y = 0;
  return step;
}
