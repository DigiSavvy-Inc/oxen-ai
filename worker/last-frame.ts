import { paramsJsonForStorage } from "./oxen";

export const LAST_FRAME_MAX_BYTES = 4_000_000;

export function captureLastFrameRequested(paramsJson: string | null | undefined): boolean {
  if (!paramsJson) return false;
  try {
    const parsed = JSON.parse(paramsJson) as { capture_last_frame?: unknown };
    return parsed.capture_last_frame === true;
  } catch {
    return false;
  }
}

/** Persist the Studio flag beside the Oxen payload. The flag is not an Oxen field. */
export function generationParamsForStorage(
  payload: Record<string, unknown>,
  captureLastFrame: boolean,
): string {
  if (!captureLastFrame) return paramsJsonForStorage(payload);
  return paramsJsonForStorage({ ...payload, capture_last_frame: true });
}

export function sniffImageContentType(bytes: Uint8Array, declared: string): string | null {
  const type = declared.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type === "image/jpeg" || type === "image/png" || type === "image/webp") return type;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

/** Null when the upload can be stored. Otherwise a client-facing reason. */
export function rejectLastFrameUpload(input: {
  mediaType: string | null;
  status: string;
  paramsJson: string | null;
  contentType: string | null;
  size: number;
}): string | null {
  if (input.mediaType !== "video") return "Last frame is only saved for a video";
  if (input.status !== "succeeded") return "Last frame is saved after the video finishes";
  if (!captureLastFrameRequested(input.paramsJson)) return "This generation did not ask for a last frame";
  if (!input.contentType) return "Last frame must be an image";
  if (input.size <= 0 || input.size > LAST_FRAME_MAX_BYTES) return "Last frame image is too large";
  return null;
}
