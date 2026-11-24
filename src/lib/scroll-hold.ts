/** Phone layout. Desktop keeps the browser's own focus scroll. */
export const PHONE_LAYOUT_QUERY = "(max-width: 860px)";

export type HoldReason = {
  placing: boolean;
  attachChanged: boolean;
  mentionsChanged: boolean;
};

/**
 * A phone caret move, a new attachment, or the mention picker opening.
 * Desktop never holds: the prompt is already on screen and focus scroll is a no-op there.
 */
export function shouldHoldPage(phone: boolean, reason: HoldReason): boolean {
  return phone && (reason.placing || reason.attachChanged || reason.mentionsChanged);
}

/**
 * How far the page scroller must move so an anchor that was at `targetTop` stays there.
 * Positive when the anchor dropped and the scroller should follow it down.
 */
export function anchorHoldDelta(targetTop: number | null, currentTop: number): number {
  if (targetTop == null || !Number.isFinite(targetTop) || !Number.isFinite(currentTop)) return 0;
  const delta = currentTop - targetTop;
  return Math.abs(delta) < 1 ? 0 : delta;
}

export type ViewportWatch = {
  /** Prompt top we are holding, in viewport pixels. */
  targetTop: number;
  /** Last visual viewport height. A keyboard change adopts the new top. */
  height: number;
};

export type ViewportSample = {
  anchorTop: number;
  height: number;
  /** The user touched or wheeled, so the hold must let go. */
  userGesture: boolean;
};

export type ViewportDecision =
  | { action: "restore"; delta: number; next: ViewportWatch }
  | { action: "adopt"; next: ViewportWatch }
  | { action: "idle"; next: ViewportWatch };

/**
 * Android scrolls the focused caret into the visual viewport when a mention is
 * inserted or a file picker closes, which pans the prompt away. A keyboard
 * resize is a real height change and is kept. A finger or wheel means the user
 * is scrolling on purpose.
 */
export function decideScrollHold(watch: ViewportWatch, sample: ViewportSample): ViewportDecision {
  if (sample.userGesture) {
    return { action: "idle", next: { targetTop: sample.anchorTop, height: sample.height } };
  }
  if (Math.abs(sample.height - watch.height) > 1) {
    return { action: "adopt", next: { targetTop: sample.anchorTop, height: sample.height } };
  }
  const delta = anchorHoldDelta(watch.targetTop, sample.anchorTop);
  if (delta === 0) return { action: "idle", next: watch };
  return { action: "restore", delta, next: watch };
}

/** Move the page scroller so `delta` pixels of anchor drift are undone. */
export function applyAnchorDelta(el: HTMLElement, delta: number): void {
  if (delta === 0) return;
  const scroller = el.closest(".main");
  if (scroller instanceof HTMLElement) {
    const before = el.getBoundingClientRect().top;
    scroller.scrollTop += delta;
    const moved = before - el.getBoundingClientRect().top;
    const remain = delta - moved;
    if (Math.abs(remain) >= 1) window.scrollBy(0, remain);
    return;
  }
  window.scrollBy(0, delta);
}

const HOLD_MS = 500;

/**
 * Keep the prompt at `targetTop` through the delayed scroll Android applies
 * after focus and setSelectionRange. Gives up when the user scrolls, the
 * keyboard resizes the viewport, or the hold window ends.
 */
export function holdPromptAnchor(el: HTMLElement, targetTop: number, onDone: (top: number) => void): () => void {
  let watch: ViewportWatch = {
    targetTop,
    height: window.visualViewport?.height ?? window.innerHeight,
  };
  let userGesture = false;
  let stopped = false;
  let ticking = false;

  const tick = () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const decision = decideScrollHold(watch, {
        anchorTop: el.getBoundingClientRect().top,
        height: window.visualViewport?.height ?? window.innerHeight,
        userGesture,
      });
      watch = decision.next;
      if (decision.action === "restore") applyAnchorDelta(el, decision.delta);
    } finally {
      ticking = false;
    }
  };

  const markUser = () => {
    userGesture = true;
  };

  const listen: AddEventListenerOptions = { capture: true, passive: true };
  window.addEventListener("pointerdown", markUser, listen);
  window.addEventListener("wheel", markUser, listen);
  window.addEventListener("touchstart", markUser, listen);
  const scroller = el.closest(".main");
  scroller?.addEventListener("scroll", tick, { passive: true });
  window.addEventListener("scroll", tick, { passive: true });
  window.visualViewport?.addEventListener("scroll", tick, { passive: true });
  window.visualViewport?.addEventListener("resize", tick, { passive: true });

  tick();
  const raf = requestAnimationFrame(tick);
  const timers = [0, 50, 150, 400].map((ms) => window.setTimeout(tick, ms));
  const finish = window.setTimeout(stop, HOLD_MS);

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.clearTimeout(finish);
    for (const id of timers) window.clearTimeout(id);
    window.removeEventListener("pointerdown", markUser, listen);
    window.removeEventListener("wheel", markUser, listen);
    window.removeEventListener("touchstart", markUser, listen);
    scroller?.removeEventListener("scroll", tick);
    window.removeEventListener("scroll", tick);
    window.visualViewport?.removeEventListener("scroll", tick);
    window.visualViewport?.removeEventListener("resize", tick);
    onDone(el.isConnected ? el.getBoundingClientRect().top : watch.targetTop);
  }

  return stop;
}
