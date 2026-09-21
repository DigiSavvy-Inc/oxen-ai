export type GenerationNotifyInput = {
  id: string;
  status: string;
  prompt: string | null;
  mediaType: string | null;
  errorMessage: string | null;
};

export function isTerminalNotifyStatus(status: string): boolean {
  return status === "succeeded" || status === "failed";
}

export function shouldNotifyStatusChange(previous: string, next: string): boolean {
  return isTerminalNotifyStatus(next) && previous !== next && !isTerminalNotifyStatus(previous);
}

export function generationNotifyCopy(generation: GenerationNotifyInput): {
  title: string;
  body: string;
  tag: string;
  url: string;
} {
  const kind = generation.mediaType === "video" ? "Video" : "Image";
  const snippet = (generation.prompt || "").replace(/\s+/g, " ").trim();
  const short = snippet.length > 80 ? `${snippet.slice(0, 77)}…` : snippet;

  if (generation.status === "failed") {
    return {
      title: `${kind} generation failed`,
      body: generation.errorMessage?.trim() || short || "Oxen could not finish this job.",
      tag: generation.id,
      url: "/",
    };
  }

  return {
    title: `${kind} is ready`,
    body: short || "Open DS Studio to view it.",
    tag: generation.id,
    url: "/",
  };
}
