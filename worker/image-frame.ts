/** ByteDance accepts reference stills from 0.4 to 2.5, width divided by height. */
export const SEEDANCE_IMAGE_RATIO = { min: 0.4, max: 2.5 } as const;

export type ImageRatioBounds = { min: number; max: number };

export class ImageFrameError extends Error {
  constructor(ratio: number, bounds: ImageRatioBounds) {
    super(
      `Seedance accepts reference images from ${bounds.min} to ${bounds.max} wide-to-tall. This image is ${ratio.toFixed(2)}.`,
    );
    this.name = "ImageFrameError";
  }
}

/**
 * Pixel size that lands inside the ratio bounds.
 * Returns null when the source already fits. Wide images lose the side edges;
 * tall images lose the top and bottom.
 */
export function fittedImageSize(
  width: number,
  height: number,
  bounds: ImageRatioBounds,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const ratio = width / height;
  if (ratio >= bounds.min && ratio <= bounds.max) return null;
  if (ratio > bounds.max) {
    const nextWidth = Math.max(1, Math.floor(height * bounds.max));
    if (nextWidth >= width) return null;
    return { width: nextWidth, height: Math.round(height) };
  }
  const nextHeight = Math.max(1, Math.floor(width / bounds.min));
  if (nextHeight >= height) return null;
  return { width: Math.round(width), height: nextHeight };
}

function byteStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body ?? new ReadableStream();
}

/** Center-crop bytes that sit outside the ratio. In-range images come back unchanged. */
export async function cropImageToRatio(
  images: ImagesBinding,
  bytes: ArrayBuffer,
  bounds: ImageRatioBounds,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  let width = 0;
  let height = 0;
  try {
    const info = await images.info(byteStream(bytes));
    if (!("width" in info) || !("height" in info)) return null;
    width = info.width;
    height = info.height;
  } catch {
    return null;
  }
  const frame = fittedImageSize(width, height, bounds);
  if (!frame) return null;
  try {
    const result = await images
      .input(byteStream(bytes))
      .transform({ width: frame.width, height: frame.height, fit: "cover", gravity: "center" })
      .output({ format: "image/jpeg", quality: 90 });
    const encoded = await result.response().arrayBuffer();
    if (encoded.byteLength === 0) throw new ImageFrameError(width / height, bounds);
    return { bytes: encoded, contentType: result.contentType() || "image/jpeg" };
  } catch (err) {
    if (err instanceof ImageFrameError) throw err;
    throw new ImageFrameError(width / height, bounds);
  }
}
