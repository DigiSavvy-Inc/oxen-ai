/**
 * Fit a custom logo inside a circle.
 * Uploaded marks often sit in a loose tile, but scaling the glyph until it
 * fills the circle clips it. Keep the whole glyph visible, with a little
 * padding, and serve that one image to the header, favicon, and sign-in page.
 */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export type RgbaImage = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

export async function frameLogoPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  const image = await decodePng(bytes);
  if (!image) return null;
  const framed = frameRgba(image);
  if (!framed) return null;
  return encodePng(framed);
}

function frameRgba(image: RgbaImage): RgbaImage | null {
  const background = borderColor(image);
  const box = contentBox(image, background);
  if (!box) return null;
  const fitted = fitInsideCircle(image, box, background);
  circleMask(fitted);
  return fitted;
}

type Box = { left: number; top: number; right: number; bottom: number };

/** Opaque pixels that are not the tile color behind the glyph. */
function contentBox(
  image: RgbaImage,
  background: [number, number, number] | null,
): Box | null {
  const { width, height } = image;
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isGlyph(image, x, y, background)) continue;
      count += 1;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }
  if (count < 8 || right < left || bottom < top) return null;
  return { left, top, right, bottom };
}

function isGlyph(
  image: RgbaImage,
  x: number,
  y: number,
  background: [number, number, number] | null,
): boolean {
  const i = (y * image.width + x) * 4;
  const alpha = image.rgba[i + 3] ?? 0;
  // Ignore the translucent fringe of a rounded tile. The glyph itself is opaque.
  if (alpha < 160) return false;
  if (background && colorDistance(image.rgba, i, background) <= 42) return false;
  return true;
}

function borderColor(image: RgbaImage): [number, number, number] | null {
  const { width, height, rgba } = image;
  const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
  const edge = Math.max(2, Math.round(Math.min(width, height) * 0.04));
  function sample(x: number, y: number) {
    const i = (y * width + x) * 4;
    const alpha = rgba[i + 3] ?? 0;
    if (alpha < 200) return;
    const r = rgba[i] ?? 0;
    const g = rgba[i + 1] ?? 0;
    const b = rgba[i + 2] ?? 0;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    bucket.n += 1;
    bucket.r += r;
    bucket.g += g;
    bucket.b += b;
    buckets.set(key, bucket);
  }
  for (let y = 0; y < height; y++) {
    const onEdge = y < edge || y >= height - edge;
    for (let x = 0; x < width; x++) {
      if (!onEdge && x >= edge && x < width - edge) continue;
      sample(x, y);
    }
  }
  let best: { n: number; r: number; g: number; b: number } | null = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.n > best.n) best = bucket;
  }
  if (!best || best.n < 8) return null;
  return [
    Math.round(best.r / best.n),
    Math.round(best.g / best.n),
    Math.round(best.b / best.n),
  ];
}

function colorDistance(rgba: Uint8Array, index: number, color: [number, number, number]): number {
  return Math.max(
    Math.abs((rgba[index] ?? 0) - color[0]),
    Math.abs((rgba[index + 1] ?? 0) - color[1]),
    Math.abs((rgba[index + 2] ?? 0) - color[2]),
  );
}

/** Extra radius past the farthest glyph pixel, so the mark is not cropped flush. */
const FIT_PAD = 0.18;

/**
 * Place the whole glyph inside the circle. Never scale it up: a wide mark
 * keeps its ends, and the circle is only as large as the glyph plus a little pad.
 */
function fitInsideCircle(
  image: RgbaImage,
  box: Box,
  background: [number, number, number] | null,
): RgbaImage {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  let farthest = 1;
  for (let y = box.top; y <= box.bottom; y++) {
    for (let x = box.left; x <= box.right; x++) {
      if (!isGlyph(image, x, y, background)) continue;
      const dx = x - cx;
      const dy = y - cy;
      const distance = dx * dx + dy * dy;
      if (distance > farthest) farthest = distance;
    }
  }
  const needed = Math.ceil(Math.sqrt(farthest) * (1 + FIT_PAD) * 2);
  const side = Math.min(512, Math.max(8, needed));
  const scale = side / needed;
  const rgba = new Uint8Array(side * side * 4);
  const fill = background ?? [0, 0, 0];
  for (let y = 0; y < side; y++) {
    const sy = cy + (y - (side - 1) / 2) / scale;
    for (let x = 0; x < side; x++) {
      const sx = cx + (x - (side - 1) / 2) / scale;
      const dest = (y * side + x) * 4;
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      if (ix < 0 || iy < 0 || ix >= image.width || iy >= image.height) {
        rgba[dest] = fill[0];
        rgba[dest + 1] = fill[1];
        rgba[dest + 2] = fill[2];
        rgba[dest + 3] = background ? 255 : 0;
        continue;
      }
      const src = (iy * image.width + ix) * 4;
      rgba[dest] = image.rgba[src] ?? 0;
      rgba[dest + 1] = image.rgba[src + 1] ?? 0;
      rgba[dest + 2] = image.rgba[src + 2] ?? 0;
      rgba[dest + 3] = image.rgba[src + 3] ?? 0;
    }
  }
  return { width: side, height: side, rgba };
}

function circleMask(image: RgbaImage) {
  const { width, height, rgba } = image;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const radius = Math.min(width, height) / 2;
  const limit = radius * radius;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > limit) rgba[(y * width + x) * 4 + 3] = 0;
    }
  }
}

export async function decodePng(bytes: Uint8Array): Promise<RgbaImage | null> {
  if (bytes.byteLength < 8) return null;
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return null;
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.byteLength) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4] ?? 0,
      bytes[offset + 5] ?? 0,
      bytes[offset + 6] ?? 0,
      bytes[offset + 7] ?? 0,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.byteLength) return null;
    const data = bytes.subarray(start, end);
    if (type === "IHDR") {
      width = readUint32(data, 0);
      height = readUint32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? 0;
      interlace = data[12] ?? 0;
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = end + 4;
  }
  if (width < 1 || height < 1 || width > 4096 || height > 4096) return null;
  if (bitDepth !== 8 || interlace !== 0) return null;
  const bpp = bytesPerPixel(colorType);
  if (!bpp) return null;
  const compressed = concat(idat);
  const inflated = await inflate(compressed);
  const raw = unfilter(inflated, width, height, bpp);
  return { width, height, rgba: toRgba(raw, width, height, colorType) };
}

function bytesPerPixel(colorType: number): number | null {
  switch (colorType) {
    case 0:
      return 1;
    case 2:
      return 3;
    case 4:
      return 2;
    case 6:
      return 4;
    default:
      return null;
  }
}

function toRgba(raw: Uint8Array, width: number, height: number, colorType: number): Uint8Array {
  if (colorType === 6) return raw;
  const rgba = new Uint8Array(width * height * 4);
  const bpp = bytesPerPixel(colorType) ?? 4;
  for (let p = 0; p < width * height; p++) {
    const s = p * bpp;
    const d = p * 4;
    if (colorType === 2) {
      rgba[d] = raw[s] ?? 0;
      rgba[d + 1] = raw[s + 1] ?? 0;
      rgba[d + 2] = raw[s + 2] ?? 0;
      rgba[d + 3] = 255;
    } else if (colorType === 0) {
      const gray = raw[s] ?? 0;
      rgba[d] = gray;
      rgba[d + 1] = gray;
      rgba[d + 2] = gray;
      rgba[d + 3] = 255;
    } else if (colorType === 4) {
      const gray = raw[s] ?? 0;
      rgba[d] = gray;
      rgba[d + 1] = gray;
      rgba[d + 2] = gray;
      rgba[d + 3] = raw[s + 1] ?? 255;
    }
  }
  return rgba;
}

function unfilter(data: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = data[src++] ?? 0;
    const row = y * stride;
    for (let i = 0; i < stride; i++) {
      const value = data[src++] ?? 0;
      const left = i >= bpp ? (out[row + i - bpp] ?? 0) : 0;
      const up = y > 0 ? (out[row - stride + i] ?? 0) : 0;
      const upLeft = y > 0 && i >= bpp ? (out[row - stride + i - bpp] ?? 0) : 0;
      let next = value;
      if (filter === 1) next = value + left;
      else if (filter === 2) next = value + up;
      else if (filter === 3) next = value + Math.floor((left + up) / 2);
      else if (filter === 4) next = value + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error("Unsupported PNG filter");
      out[row + i] = next & 255;
    }
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDist = Math.abs(estimate - left);
  const upDist = Math.abs(estimate - up);
  const upLeftDist = Math.abs(estimate - upLeft);
  if (leftDist <= upDist && leftDist <= upLeftDist) return left;
  if (upDist <= upLeftDist) return up;
  return upLeft;
}

export async function encodePng(image: RgbaImage): Promise<Uint8Array> {
  const { width, height, rgba } = image;
  const stride = width * 4;
  const raw = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const dest = y * (stride + 1);
    raw[dest] = 0;
    raw.set(rgba.subarray(y * stride, y * stride + stride), dest + 1);
  }
  const compressed = await deflate(raw);
  const ihdr = new Uint8Array(13);
  writeUint32(ihdr, 0, width);
  writeUint32(ihdr, 4, height);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const chunks = [chunk("IHDR", ihdr), chunk("IDAT", compressed), chunk("IEND", new Uint8Array())];
  const size = PNG_SIGNATURE.length + chunks.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  out.set(PNG_SIGNATURE);
  let offset = PNG_SIGNATURE.length;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.byteLength);
  writeUint32(out, 0, data.byteLength);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.byteLength));
  writeUint32(out, 8 + data.byteLength, crc);
  return out;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

function readUint32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) << 24) |
    ((data[offset + 1] ?? 0) << 16) |
    ((data[offset + 2] ?? 0) << 8) |
    (data[offset + 3] ?? 0)
  ) >>> 0;
}

function writeUint32(data: Uint8Array, offset: number, value: number) {
  data[offset] = (value >>> 24) & 255;
  data[offset + 1] = (value >>> 16) & 255;
  data[offset + 2] = (value >>> 8) & 255;
  data[offset + 3] = value & 255;
}
