export const THUMB_EDGE = 320;

export function isRasterImage(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return type === "image/jpeg" || type === "image/jpg" || type === "image/png" || type === "image/webp";
}

function toStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body ?? new ReadableStream();
}

export async function createImageThumbnail(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!images || !isRasterImage(contentType) || bytes.byteLength === 0) return null;
  try {
    const result = await images
      .input(toStream(bytes))
      .transform({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "cover" })
      .output({ format: "image/jpeg", quality: 70 });
    const response = result.response();
    return { bytes: await response.arrayBuffer(), contentType: "image/jpeg" };
  } catch {
    return null;
  }
}
