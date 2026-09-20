export type MediaKind = "image" | "video" | "audio";

export function kindFromFile(file: File): MediaKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  const name = file.name.toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|bmp)$/.test(name)) return "image";
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(name)) return "video";
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) return "audio";
  return null;
}

export function filesFromList(list: FileList | File[] | null | undefined): File[] {
  if (!list) return [];
  return Array.from(list);
}

export function shortenFileName(name: string, max = 22): string {
  const trimmed = name.trim();
  if (!trimmed) return "audio";
  if (trimmed.length <= max) return trimmed;
  const dot = trimmed.lastIndexOf(".");
  const ext = dot > 0 ? trimmed.slice(dot) : "";
  const base = ext ? trimmed.slice(0, dot) : trimmed;
  const keep = Math.max(4, max - ext.length - 1);
  return `${base.slice(0, keep)}…${ext}`;
}

export function formatAudioClock(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return "";
  return `${Math.round(seconds)}s`;
}
