import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { anchorHoldDelta, decideScrollHold, shouldHoldPage, type ViewportWatch } from "../src/lib/scroll-hold";

const watch: ViewportWatch = { targetTop: 520, height: 700 };

describe("phone scroll hold", () => {
  it("holds the page only on a phone, and only when the prompt, mention, or attachment changed", () => {
    const reason = { placing: true, attachChanged: false, mentionsChanged: false };
    expect(shouldHoldPage(false, reason)).toBe(false);
    expect(shouldHoldPage(true, { placing: false, attachChanged: false, mentionsChanged: false })).toBe(false);
    expect(shouldHoldPage(true, reason)).toBe(true);
    expect(shouldHoldPage(true, { placing: false, attachChanged: true, mentionsChanged: false })).toBe(true);
    expect(shouldHoldPage(true, { placing: false, attachChanged: false, mentionsChanged: true })).toBe(true);
  });

  it("scrolls the page back when Android moves the prompt to the top", () => {
    // The caret was in view. Focusing it pans the prompt from 520px to 96px.
    const jumped = decideScrollHold(watch, { anchorTop: 96, height: 700, userGesture: false });
    expect(jumped).toEqual({ action: "restore", delta: 96 - 520, next: watch });
    expect(anchorHoldDelta(520, 96)).toBe(96 - 520);
  });

  it("ignores a sub-pixel wobble", () => {
    expect(anchorHoldDelta(520, 520.4)).toBe(0);
    expect(decideScrollHold(watch, { anchorTop: 520.4, height: 700, userGesture: false })).toEqual({
      action: "idle",
      next: watch,
    });
  });

  it("keeps a keyboard resize instead of pinning the old top", () => {
    const resized = decideScrollHold(watch, { anchorTop: 280, height: 420, userGesture: false });
    expect(resized).toEqual({ action: "adopt", next: { targetTop: 280, height: 420 } });
  });

  it("lets go when the user scrolls on purpose", () => {
    const user = decideScrollHold(watch, { anchorTop: 200, height: 700, userGesture: true });
    expect(user).toEqual({ action: "idle", next: { targetTop: 200, height: 700 } });
  });

  it("does not invent a target before the prompt has been measured", () => {
    expect(anchorHoldDelta(null, 400)).toBe(0);
  });

  it("lengthens the phone column for attachments and keeps the file input on the button", () => {
    const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
    expect(css).toMatch(/min-height:\s*calc\(100% \+ var\(--composer-grow,\s*0px\) \+ var\(--attach-grow,\s*0px\)\)/);
    const phone = css.slice(css.indexOf("A display:none file input has no box"));
    expect(phone).toMatch(
      /\.attach input\s*\{[^}]*display:\s*block;[^}]*position:\s*absolute;[^}]*inset:\s*0;[^}]*opacity:\s*0/,
    );
    // Desktop still hides the input. The phone rule is the last one and wins there only.
    expect(css).toMatch(/\.attach input\s*\{\s*display:\s*none;\s*\}/);
    const composer = readFileSync(new URL("../src/components/Composer.tsx", import.meta.url), "utf8");
    expect(composer).toContain('el.focus({ preventScroll: true })');
    expect(composer).toContain("holdPromptAnchor");
    expect(composer).toContain("--attach-grow");
  });
});
