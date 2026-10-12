const MAX_MESSAGES = 40;
const MAX_TEXT = 32_000;
const MAX_PARTS = 8;
const PDF_BYTES = 24 * 1024 * 1024;

export type ChatPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "file"; file: { file_url?: string; file_data?: string } };

export type ChatMessage = {
  role: "user" | "assistant";
  content: string | ChatPart[];
};

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}

function isImageRef(value: string): boolean {
  if (isHttpsUrl(value)) return true;
  return /^data:image\/(png|jpeg|jpg|gif|webp);base64,/i.test(value) && value.length < 12_000_000;
}

function pdfDataBytes(value: string): number | null {
  const match = /^data:application\/pdf;base64,([a-z0-9+/=\s]+)$/i.exec(value.trim());
  if (!match?.[1]) return null;
  const b64 = match[1].replace(/\s/g, "");
  const bytes = Math.floor((b64.length * 3) / 4);
  if (bytes <= 0 || bytes > PDF_BYTES) return null;
  return bytes;
}

function filePart(value: string): ChatPart | null {
  if (isHttpsUrl(value)) return { type: "file", file: { file_url: value } };
  if (pdfDataBytes(value) == null) return null;
  return { type: "file", file: { file_data: value.trim() } };
}

function sanitizeParts(raw: unknown[]): ChatPart[] | null {
  const files: ChatPart[] = [];
  const images: ChatPart[] = [];
  const texts: ChatPart[] = [];
  for (const part of raw.slice(0, MAX_PARTS)) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      const text = record.text.trim().slice(0, MAX_TEXT);
      if (text) texts.push({ type: "text", text });
      continue;
    }
    if (record.type === "image_url") {
      const image = record.image_url as { url?: unknown } | undefined;
      const url = typeof image?.url === "string" ? image.url.trim() : "";
      if (url && isImageRef(url)) images.push({ type: "image_url", image_url: { url } });
      continue;
    }
    if (record.type === "file") {
      const file = record.file as { file_url?: unknown; file_data?: unknown } | undefined;
      const url = typeof file?.file_url === "string" ? file.file_url.trim() : "";
      const data = typeof file?.file_data === "string" ? file.file_data.trim() : "";
      const next = filePart(data || url);
      if (next) files.push(next);
    }
  }
  const parts = [...files, ...images, ...texts].slice(0, MAX_PARTS);
  return parts.length > 0 ? parts : null;
}

export function sanitizeChatRequest(
  raw: unknown,
): { model: string; messages: ChatMessage[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const body = raw as { model?: unknown; messages?: unknown };
  const model = typeof body.model === "string" ? body.model.trim() : "";
  if (!model || model.length > 200) return null;
  if (!Array.isArray(body.messages)) return null;
  const messages: ChatMessage[] = [];
  for (const item of body.messages.slice(-MAX_MESSAGES)) {
    if (!item || typeof item !== "object") continue;
    const record = item as { role?: unknown; content?: unknown };
    if (record.role !== "user" && record.role !== "assistant") continue;
    if (typeof record.content === "string") {
      const text = record.content.trim().slice(0, MAX_TEXT);
      if (!text) continue;
      messages.push({ role: record.role, content: text });
      continue;
    }
    if (!Array.isArray(record.content) || record.role !== "user") continue;
    const parts = sanitizeParts(record.content);
    if (parts) messages.push({ role: "user", content: parts });
  }
  if (messages.length === 0) return null;
  return { model, messages };
}

export function chatReplyText(data: Record<string, unknown>): string | null {
  const choices = data.choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0];
  if (!first || typeof first !== "object") return null;
  const message = (first as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content.trim() || null;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as { type?: unknown; text?: unknown };
      return record.type === "text" && typeof record.text === "string" ? record.text : "";
    })
    .join("\n")
    .trim();
  return text || null;
}
