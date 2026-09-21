export const THUMB_EDGE = 256;
export const THUMB_MAX_BYTES = 80_000;

const THUMB_FORMATS = ["image/avif", "image/webp", "image/jpeg"] as const;

export function isRasterImage(contentType: string | null | undefined): boolean {
  if (!contentType) return false;
  const type = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    type === "image/jpeg" ||
    type === "image/jpg" ||
    type === "image/png" ||
    type === "image/webp" ||
    type === "image/avif"
  );
}

function toStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body ?? new ReadableStream();
}

function thumbWidth(srcW: number, srcH: number): number {
  const long = Math.max(srcW, srcH);
  if (!Number.isFinite(long) || long <= 0) return THUMB_EDGE;
  if (long <= THUMB_EDGE) return Math.max(1, Math.round(srcW));
  return Math.max(1, Math.round((srcW * THUMB_EDGE) / long));
}

async function encodeThumb(
  images: ImagesBinding,
  bytes: ArrayBuffer,
  width: number,
  format: (typeof THUMB_FORMATS)[number],
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  try {
    const result = await images
      .input(toStream(bytes))
      .transform({ width })
      .output({ format, quality: 50 });
    const encoded = await result.response().arrayBuffer();
    if (encoded.byteLength === 0) return null;
    if (encoded.byteLength > THUMB_MAX_BYTES) return null;
    if (encoded.byteLength >= bytes.byteLength && bytes.byteLength > THUMB_MAX_BYTES) {
      return null;
    }
    return { bytes: encoded, contentType: result.contentType() || format };
  } catch (err) {
    console.error("thumbnail encode error", format, err);
    return null;
  }
}

/** Shrink large reference stills for the Oxen enqueue body. Stored R2 files stay original. */
export async function encodeImageForOxen(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const skipBelow = 2_500_000;
  if (!images || !isRasterImage(contentType) || bytes.byteLength <= skipBelow) {
    return { bytes, contentType };
  }
  try {
    const stream = toStream(bytes);
    const result = await images.input(stream).output({ format: "image/jpeg", quality: 88 });
    const encoded = await result.response().arrayBuffer();
    if (encoded.byteLength > 0 && encoded.byteLength < bytes.byteLength) {
      return { bytes: encoded, contentType: result.contentType() || "image/jpeg" };
    }
  } catch (err) {
    console.error("oxen image encode error", err);
  }
  return { bytes, contentType };
}

export async function createImageThumbnail(
  images: ImagesBinding | undefined,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  if (!images || !isRasterImage(contentType) || bytes.byteLength === 0) return null;
  let width = THUMB_EDGE;
  try {
    const info = await images.info(toStream(bytes));
    if ("width" in info && "height" in info) width = thumbWidth(info.width, info.height);
  } catch {
    /* local Images may not implement info(); still resize by long edge */
  }
  for (const format of THUMB_FORMATS) {
    const encoded = await encodeThumb(images, bytes, width, format);
    if (encoded) return encoded;
  }
  return null;
}
