/** Widths the media route will encode. Anything else is served unchanged. */
export const GALLERY_SERVE_WIDTHS = [96, 160] as const;

export function parseServedThumbWidth(raw: string | undefined): number | null {
  const width = Number(raw);
  if (width === 96 || width === 160) return width;
  return null;
}

export async function resizeServedImage(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
  width: number,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!images || bytes.byteLength === 0) return null;
  try {
    const result = await images
      .input(new Response(bytes).body ?? new ReadableStream())
      .transform({ width })
      .output({ format: "image/webp", quality: 55 });
    const encoded = await result.response().arrayBuffer();
    if (encoded.byteLength === 0) return null;
    return { bytes: encoded, contentType: result.contentType() || "image/webp" };
  } catch (err) {
    console.error("gallery thumb resize", err);
    return null;
  }
}
