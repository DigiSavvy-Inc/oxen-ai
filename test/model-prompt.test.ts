import { describe, expect, it } from "vitest";
import { composeModelPrompt, deliveryForRun } from "../src/lib/model-prompt";
import { promptTextForCopy } from "../src/lib/reference-roles";
import { shareExpiresAt, shareIsOpen } from "../worker/projects";

describe("model prompt", () => {
  it("puts the look and the role lines ahead of the prompt", () => {
    const sent = composeModelPrompt(
      "Hold still.",
      "Shot on 35mm.",
      "@Image1 is not a face. Use it only for the outfit, body, prop, or pose named in this prompt.",
    );
    expect(sent).toBe(
      "Shot on 35mm.\n\n@Image1 is not a face. Use it only for the outfit, body, prop, or pose named in this prompt.\n\nHold still.",
    );
    expect(promptTextForCopy(sent)).toBe("Shot on 35mm.\n\nHold still.");
  });

  it("still sends role lines that were written into the prompt", () => {
    const written = "@Image2 is a face only.\n@Image3 is a face only.\n\nHold still.";
    const sent = composeModelPrompt(written, "Shot on 35mm.", "@Image2 is a face only.\n@Image3 is a face only.");
    expect(sent).toBe("Shot on 35mm.\n\n@Image2 is a face only.\n@Image3 is a face only.\n\nHold still.");
    expect(promptTextForCopy(written)).toBe("Hold still.");
  });

  it("explains an outfit as an object when the model has no role inputs", () => {
    const delivery = deliveryForRun({
      prompt: "Hold still.",
      lookBlock: "",
      attachments: [{ name: "coat.png", kind: "image", role: "clothing" }],
      routedKinds: [],
      faceFirst: false,
    });
    expect(delivery.prompt).toContain("@Image1 is not a face.");
    expect(delivery.prompt).toContain("outfit");
    expect(delivery.notes).toEqual([]);
  });

  it("keeps routed roles out of the prompt and lists where they go", () => {
    const delivery = deliveryForRun({
      prompt: "Hold still.",
      lookBlock: "",
      attachments: [
        { name: "face.png", kind: "image", role: "character" },
        { name: "coat.png", kind: "image", role: "object" },
      ],
      routedKinds: ["image"],
      faceFirst: true,
    });
    expect(delivery.prompt).toBe("Hold still.");
    expect(delivery.notes).toEqual([
      "@Image1 Character goes to the face input.",
      "@Image2 Object goes to the reference input.",
    ]);
  });
});

describe("project share expiry", () => {
  it("closes a revoked or expired link and clamps the window", () => {
    expect(shareExpiresAt(1_000, null)).toBeNull();
    expect(shareExpiresAt(1_000, 1)).toBe(1_000 + 86400);
    expect(shareExpiresAt(1_000, 400)).toBe(1_000 + 90 * 86400);
    expect(shareIsOpen({ expires_at: null, revoked_at: null }, 50)).toBe(true);
    expect(shareIsOpen({ expires_at: 40, revoked_at: null }, 50)).toBe(false);
    expect(shareIsOpen({ expires_at: null, revoked_at: 10 }, 50)).toBe(false);
  });
});
