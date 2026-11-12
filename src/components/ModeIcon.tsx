import type { ReactNode } from "react";
import type { GenerationMode } from "../lib/api";
import {
  MODE_GLYPHS,
  MODE_ICON_LABELS,
  modeIconRow,
  modeIconsLabel,
  type ModeGlyph,
} from "../lib/mode-icons";

const FRAME = <rect x="1.9" y="2.9" width="12.2" height="10.2" rx="2" />;
/** The frame with its lower right corner left open for a pencil or a play mark. */
const FRAME_OPEN = <path d="M14.1 6.6V4.9a2 2 0 0 0-2-2H3.9a2 2 0 0 0-2 2v6.2a2 2 0 0 0 2 2h3.4" />;
const SUN = <circle cx="5.4" cy="6.3" r="1.05" fill="currentColor" stroke="none" />;
const PENCIL = <path d="M8.9 14.1l.5-2.3 4-4a.9.9 0 0 1 1.3 0l.5.5a.9.9 0 0 1 0 1.3l-4 4-2.3.5z" />;

function glyphShapes(glyph: ModeGlyph): ReactNode {
  switch (glyph) {
    case "image":
      return (
        <>
          {FRAME}
          {SUN}
          <path d="M2.3 11.3 5.9 8.4l2.2 1.9 2-1.8 3.6 3.1" />
        </>
      );
    case "image-pencil":
      return (
        <>
          {FRAME_OPEN}
          {SUN}
          <path d="M2.3 10.9 5.3 8.5l1.9 1.6" />
          {PENCIL}
        </>
      );
    case "film":
      return (
        <>
          {FRAME}
          <path d="M6.7 5.7v4.6l4-2.3z" fill="currentColor" />
        </>
      );
    case "image-play":
      return (
        <>
          {FRAME_OPEN}
          {SUN}
          <path d="M2.3 10.9 5.3 8.5l1.9 1.6" />
          <path d="M10.2 9v5l4.4-2.5z" fill="currentColor" />
        </>
      );
    case "film-pencil":
      return (
        <>
          {FRAME_OPEN}
          <path d="M5.3 5.6v4l3.5-2z" fill="currentColor" />
          {PENCIL}
        </>
      );
    case "waveform":
      return <path d="M2.6 6.7v2.6M5.3 4.6v6.8M8 2.7v10.6M10.7 5.3v5.4M13.4 6.7v2.6" />;
    case "bubble":
      return (
        <path d="M4 2.9h8a2 2 0 0 1 2 2v4.4a2 2 0 0 1-2 2H7.6l-3.1 2.5v-2.5H4a2 2 0 0 1-2-2V4.9a2 2 0 0 1 2-2z" />
      );
    default: {
      const unreachable: never = glyph;
      return unreachable;
    }
  }
}

/** One mode's icon, with the mode as its tooltip and accessible name. */
export function ModeIcon({ mode }: { mode: GenerationMode }) {
  const label = MODE_ICON_LABELS[mode];
  return (
    <svg
      className="mode-icon"
      viewBox="0 0 16 16"
      role="img"
      aria-label={label}
      data-mode={mode}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      <title>{label}</title>
      {glyphShapes(MODE_GLYPHS[mode])}
    </svg>
  );
}

/**
 * A model's kinds as a short row in pill order. Past the row limit the rest become a
 * count whose tooltip names them. Renders nothing for an empty list.
 */
export function ModeIcons({ modes, className }: { modes: readonly GenerationMode[]; className?: string }) {
  const row = modeIconRow(modes);
  if (row.shown.length === 0) return null;
  return (
    <span className={`mode-icons${className ? ` ${className}` : ""}`}>
      {row.shown.map((mode) => (
        <ModeIcon key={mode} mode={mode} />
      ))}
      {row.more.length > 0 ? (
        <span
          className="mode-icons-more"
          role="img"
          title={modeIconsLabel(row.more)}
          aria-label={`and ${modeIconsLabel(row.more)}`}
        >
          +{row.more.length}
        </span>
      ) : null}
    </span>
  );
}

/** A model's name with its kind icons ahead of it. The name truncates; the icons do not. */
export function ModelName({
  name,
  modes,
  className,
}: {
  name: string;
  modes: readonly GenerationMode[];
  className?: string;
}) {
  return (
    <span className={`model-name${className ? ` ${className}` : ""}`}>
      <ModeIcons modes={modes} />
      <span className="model-name-text">{name}</span>
    </span>
  );
}
