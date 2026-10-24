/**
 * Distance from the bottom of the visual viewport to the help button.
 * When the composer covers that corner, lift the button to just above it.
 */
export function helpFabLift(
  composer: { top: number; bottom: number } | null,
  viewHeight: number,
): number {
  const min = 16;
  const fab = 36;
  const margin = 12;
  const navClearance = 64;
  if (!composer || viewHeight <= 0) return min;
  const coversBottom = composer.top < viewHeight - min && composer.bottom > viewHeight - 80;
  if (!coversBottom) return min;
  const lift = viewHeight - composer.top + margin;
  const maxLift = Math.max(min, viewHeight - fab - navClearance);
  return Math.round(Math.min(Math.max(lift, min), maxLift));
}
