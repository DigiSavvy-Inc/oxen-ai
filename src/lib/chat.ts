export type ChatAttachment = { url: string; name: string };

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  images: ChatAttachment[];
  files: ChatAttachment[];
};

export function chatMessagesFromTurns(turns: ChatTurn[]) {
  return turns.map((turn) => {
    if (turn.role === "assistant" || (turn.images.length === 0 && turn.files.length === 0)) {
      return { role: turn.role, content: turn.text };
    }
    return {
      role: "user" as const,
      content: [
        ...turn.files.map((file) => ({ type: "file" as const, file: { file_url: file.url } })),
        ...turn.images.map((image) => ({
          type: "image_url" as const,
          image_url: { url: image.url },
        })),
        ...(turn.text.trim() ? [{ type: "text" as const, text: turn.text }] : []),
      ],
    };
  });
}
