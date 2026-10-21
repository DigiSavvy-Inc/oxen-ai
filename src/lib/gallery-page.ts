/** Which slice of a gallery's items belongs on this page. */
export function galleryPageWindow(
  total: number,
  page: number,
  pageSize: number,
): { page: number; pageCount: number; start: number; end: number } {
  const size = Math.max(1, Math.floor(pageSize) || 1);
  const count = Math.max(0, Math.floor(total) || 0);
  const pageCount = Math.max(1, Math.ceil(count / size));
  const current = Math.min(pageCount, Math.max(1, Math.floor(page) || 1));
  const start = (current - 1) * size;
  return { page: current, pageCount, start, end: Math.min(count, start + size) };
}
