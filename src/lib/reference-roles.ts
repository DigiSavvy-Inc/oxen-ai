import { mentionOrdered, tokenForItem, type MentionItem } from "./mentions";
import { normalizeMediaRole, type MediaRole } from "../../worker/schema";

export function referenceRoleTitle(role: MediaRole): string {
  switch (role) {
    case "character":
      return "Character. A tight headshot only. A full body, a pose, or the room marked Character sends the wrong face.";
    case "clothing":
      return "Clothing. The outfit only. A face or a full body marked Clothing sends the wrong thing.";
    case "background":
      return "Background. The empty place. The prompt has to say this file is the room.";
    case "object":
      return "Object. A prop, a body, or a pose. The prompt has to say which, and that it is not a face.";
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
    case "clothing":
      return `${token} is the clothing. Use it for the outfit only, not the face or the body.`;
    case "background":
      return `${token} is the place. Keep it fixed.`;
    case "object":
      return `${token} is not a face. Use it only for the body, prop, or pose named in this prompt.`;
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
