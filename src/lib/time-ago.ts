/** "just now", "5m ago", "3h ago", or "2d ago" for a unix-seconds timestamp. */
export function timeAgo(at: number, now = Math.floor(Date.now() / 1000)): string {
  const delta = Math.max(0, now - at);
  if (delta < 60) return "just now";
  if (delta < 3600) return `${Math.floor(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.floor(delta / 3600)}h ago`;
  return `${Math.floor(delta / 86400)}d ago`;
}
