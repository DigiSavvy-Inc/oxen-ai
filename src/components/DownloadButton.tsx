import type { MouseEvent } from "react";

export function DownloadButton({
  label,
  onDownload,
  className,
  caption,
}: {
  label: string;
  onDownload: () => void;
  className?: string;
  caption?: string;
}) {
  return (
    <button
      type="button"
      className={`media-download${className ? ` ${className}` : ""}`}
      aria-label={label}
      title={label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        event.stopPropagation();
        onDownload();
      }}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
        <path
          d="M8 2v8M5.2 8.2 8 11l2.8-2.8M3 13.5h10"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {caption ? <span>{caption}</span> : null}
    </button>
  );
}
