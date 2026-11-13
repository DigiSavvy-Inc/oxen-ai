import { mentionOrdered, tokenForItem, type MentionItem } from "./mentions";
import { normalizeMediaRole, type MediaRole } from "../../worker/schema";

export function referenceRoleTitle(role: MediaRole): string {
  switch (role) {
    case "character":
      return "Character. A tight headshot only. A full body, a pose, or the room marked Character sends the wrong face.";
    case "background":
      return "Background. The empty place. The prompt has to say this file is the room.";
    case "object":
      return "Object. A prop, a body, a pose, or the outfit. The prompt has to say which, and that it is not a face.";
    case "style":
      return "Style. Light and color only. It will also copy the people and the room unless the prompt forbids that.";
    default: {
      const _never: never = role;
      return _never;
    }
  }
}

export function referenceBindingLine(
  kind: MentionItem["kind"],
  role: MediaRole,
  token: string,
): string | null {
  if (kind === "audio") return null;
  switch (role) {
    case "character":
      return kind === "video"
        ? `${token} is this person's face and motion.`
        : `${token} is a face only.`;
    case "background":
      return `${token} is the place. Keep it fixed.`;
    case "object":
      return `${token} is not a face. Use it only for the outfit, body, prop, or pose named in this prompt.`;
    case "style":
      return `${token} is light and color only. Do not copy the people or the room.`;
    default: {
      const _never: never = role;
      return _never;
    }
  }
}

export function voiceBindingLine(tokens: string[]): string | null {
  if (tokens.length < 2) return null;
  const list =
    tokens.length === 2
      ? `${tokens[0]} and ${tokens[1]}`
      : `${tokens.slice(0, -1).join(", ")}, and ${tokens[tokens.length - 1]}`;
  return `${list} are different voices. Name who speaks on every line. A voice with no face stays off camera.`;
}

/** Lines for the chips the model will actually number, with characters first when that model does. */
export function referenceBindingText(
  items: MentionItem[],
  options: { faceFirst: boolean; roleKinds: Array<"image" | "video"> },
): string {
  const ordered = mentionOrdered(items, options.faceFirst);
  const roleKinds = new Set(options.roleKinds);
  const lines: string[] = [];
  for (const item of ordered) {
    if (item.kind === "audio" || !roleKinds.has(item.kind)) continue;
    const line = referenceBindingLine(item.kind, normalizeMediaRole(item.role), tokenForItem(ordered, item, 0));
    if (line) lines.push(line);
  }
  const voices = voiceBindingLine(
    ordered.filter((item) => item.kind === "audio").map((item) => tokenForItem(ordered, item, 0)),
  );
  if (voices) lines.push(voices);
  return lines.join("\n");
}

const MENTION_TOKEN = /^@(?:Image|Video|Audio)\d+$/;

/**
 * A line Insert bindings would write: one role sentence, or the shared voice line.
 * The check uses those same sentences, so a wording change stays in one place.
 */
export function isReferenceBindingLine(line: string): boolean {
  const text = line.trim();
  const role = text.match(/^(@(?:Image|Video|Audio)\d+) (.*)$/);
  if (role) {
    const token = role[1] ?? "";
    if (!token.startsWith("@Audio")) {
      const kind = token.startsWith("@Video") ? "video" : "image";
      for (const mediaRole of ["character", "background", "object", "style"] as const) {
        if (referenceBindingLine(kind, mediaRole, token) === text) return true;
      }
    }
  }
  const tokens = text.match(/@(?:Image|Video|Audio)\d+/g);
  if (!tokens || tokens.length < 2) return false;
  if (!tokens.every((token) => MENTION_TOKEN.test(token))) return false;
  return voiceBindingLine(tokens) === text;
}

/**
 * The prompt as the user wrote it. A copy leaves out role lines from Insert bindings.
 * The field and the request keep those lines.
 */
export function promptTextForCopy(text: string): string {
  if (!text.split("\n").some((line) => isReferenceBindingLine(line))) return text;
  const kept = text.split("\n").filter((line) => !isReferenceBindingLine(line));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/^\n+|\n+$/g, "");
}

/** Prepend binding lines that are not already in the prompt. Exact lines are left alone. */
export function prependMissingBindings(
  prompt: string,
  block: string,
): { next: string; caret: number } | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;
  const existing = new Set(
    prompt
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missing = lines.filter((line) => !existing.has(line));
  if (missing.length === 0) return null;
  const addition = missing.join("\n");
  const body = prompt.trim();
  const next = body ? `${addition}\n\n${body}` : addition;
  return { next, caret: addition.length };
}
