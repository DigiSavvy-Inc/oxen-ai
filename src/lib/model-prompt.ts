import { mentionOrdered, tokenForItem, type MentionItem } from "./mentions";
import { prependMissingBindings, referenceBindingText } from "./reference-roles";
import { normalizeMediaRole, referenceRoleLabel, referenceRoleUsesFace } from "../../worker/schema";

/**
 * Look block, then the project prompts that are on, then role lines the model will not get as
 * inputs, then the prompt.
 */
export function composeModelPrompt(
  prompt: string,
  lookBlock: string,
  bindingBlock: string,
  promptBlock = "",
): string {
  const withBindings = prependMissingBindings(prompt, bindingBlock);
  const base = withBindings?.next ?? prompt;
  const projectText = promptBlock.trim();
  const scene = base.trim();
  const withPrompts = projectText ? (scene ? `${projectText}\n\n${scene}` : projectText) : base;
  const withLooks = prependMissingBindings(withPrompts, lookBlock);
  return withLooks?.next ?? withPrompts;
}

export function deliveryForRun(input: {
  prompt: string;
  /** Applied looks already joined into sentences, in chip order. */
  lookBlock: string;
  /** Project prompts that are on, joined in list order with their names already resolved. */
  promptBlock?: string;
  attachments: MentionItem[];
  /** Kinds whose roles already map onto the model's own inputs. */
  routedKinds: Array<"image" | "video">;
  faceFirst: boolean;
}): { prompt: string; notes: string[] } {
  const routed = new Set(input.routedKinds);
  const explained = (["image", "video"] as const).filter((kind) => !routed.has(kind));
  const bindingBlock = referenceBindingText(input.attachments, {
    faceFirst: input.faceFirst,
    roleKinds: explained,
  });
  const ordered = mentionOrdered(input.attachments, input.faceFirst);
  const notes: string[] = [];
  for (const item of ordered) {
    if (item.kind !== "image" && item.kind !== "video") continue;
    if (!routed.has(item.kind)) continue;
    const token = tokenForItem(ordered, item, 0);
    const role = normalizeMediaRole(item.role);
    const inputName = referenceRoleUsesFace(role) ? "face input" : "reference input";
    notes.push(`${token} ${referenceRoleLabel(role)} goes to the ${inputName}.`);
  }
  return {
    prompt: composeModelPrompt(input.prompt, input.lookBlock, bindingBlock, input.promptBlock ?? ""),
    notes,
  };
}
