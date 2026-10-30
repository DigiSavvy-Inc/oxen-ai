/** ByteDance accepts reference stills from 0.4 to 2.5, width divided by height. */
export const SEEDANCE_IMAGE_RATIO = { min: 0.4, max: 2.5 } as const;

/** Face upload measures the file it downloads. Both edges must sit in this range. */
export const SEEDANCE_IMAGE_EDGE = { min: 300, max: 6000 } as const;

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

/**
 * Size ByteDance will accept. Ratio is cropped first, then the frame is scaled
 * so neither edge falls outside 300–6000. In-range photos keep their pixel size.
 */
export function seedanceOutputSize(
  width: number,
  height: number,
): { width: number; height: number } | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) return null;
  const cropped = fittedImageSize(width, height, SEEDANCE_IMAGE_RATIO) ?? {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  };
  let w = cropped.width;
  let h = cropped.height;
  const { min, max } = SEEDANCE_IMAGE_EDGE;
  const apply = (factor: number) => {
    w = Math.max(1, Math.round(w * factor));
    h = Math.max(1, Math.round(h * factor));
  };
  const small = Math.min(w, h);
  if (small < min) apply(min / small);
  const large = Math.max(w, h);
  if (large > max) apply(max / large);
  return { width: w, height: h };
}

function byteStream(bytes: ArrayBuffer): ReadableStream<Uint8Array> {
  return new Response(bytes).body ?? new ReadableStream();
}

/**
 * Plain JPEG at the real pixel size. Face upload was measuring a smaller
 * embedded preview inside the original file. Null when the size cannot be read.
 */
export async function normalizeSeedanceImage(
  images: ImagesBinding,
  bytes: ArrayBuffer,
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
  const frame = seedanceOutputSize(width, height);
  if (!frame) return null;
  try {
    const result = await images
      .input(byteStream(bytes))
      .transform({ width: frame.width, height: frame.height, fit: "cover", gravity: "center" })
      .output({ format: "image/jpeg", quality: 90 });
    const encoded = await result.response().arrayBuffer();
    if (encoded.byteLength === 0) throw new ImageFrameError(width / height, SEEDANCE_IMAGE_RATIO);
    return { bytes: encoded, contentType: result.contentType() || "image/jpeg" };
  } catch (err) {
    if (err instanceof ImageFrameError) throw err;
    throw new ImageFrameError(width / height, SEEDANCE_IMAGE_RATIO);
  }
}
