import { describe, expect, it } from "vitest";
import { chatReplyText, sanitizeChatRequest } from "../worker/chat";
import { sniffSafeMediaType } from "../worker/media";
import { parseModelControls } from "../worker/schema";

describe("sanitizeChatRequest", () => {
  it("keeps user and assistant text and drops other roles", () => {
    const request = sanitizeChatRequest({
      model: "claude",
      messages: [
        { role: "system", content: "ignore" },
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    });
    expect(request).toEqual({
      model: "claude",
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi" },
      ],
    });
  });

  it("puts a PDF before the question and accepts an image", () => {
    const request = sanitizeChatRequest({
      model: "claude",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
            {
              type: "file",
              file: { file_data: "data:application/pdf;base64,JVBERi0x" },
            },
          ],
        },
      ],
    });
    expect(request?.messages[0]?.content).toEqual([
      { type: "file", file: { file_data: "data:application/pdf;base64,JVBERi0x" } },
      { type: "image_url", image_url: { url: "https://example.com/cat.png" } },
      { type: "text", text: "What is this?" },
    ]);
  });

  it("rejects a non-https file url and file_id", () => {
    const request = sanitizeChatRequest({
      model: "claude",
      messages: [
        {
          role: "user",
          content: [
            { type: "file", file: { file_url: "http://example.com/secret.pdf" } },
            { type: "file", file: { file_id: "file_123" } },
            { type: "text", text: "Read this" },
          ],
        },
      ],
    });
    expect(request?.messages[0]?.content).toEqual([{ type: "text", text: "Read this" }]);
  });
});

describe("chatReplyText", () => {
  it("reads the assistant string", () => {
    expect(
      chatReplyText({
        choices: [{ message: { role: "assistant", content: "A red barn." } }],
      }),
    ).toBe("A red barn.");
  });
});

describe("chat and draft controls", () => {
  it("sniffs a PDF from its header", () => {
    const bytes = new TextEncoder().encode("%PDF-1.7\n");
    expect(sniffSafeMediaType(bytes)).toBe("application/pdf");
  });

  it("marks Seedance 2.5 as draft-capable and Kling multi_prompt as multi-shot", () => {
    const seedance = parseModelControls({
      id: "bytedance-seedance-2-5-text-to-video",
      request_schema: { type: "object", properties: { prompt: { type: "string" } } },
    });
    expect(seedance.draft).toBe(true);
    expect(seedance.multiPrompt).toBe(false);

    const kling = parseModelControls({
      id: "kling-video-o3-pro",
      request_schema: {
        type: "object",
        properties: {
          multi_prompt: {
            type: "array",
            items: {
              type: "object",
              properties: { prompt: { type: "string" }, duration: { type: "integer" } },
            },
          },
        },
      },
    });
    expect(kling.multiPrompt).toBe(true);
    expect(kling.draft).toBe(false);
  });
});
