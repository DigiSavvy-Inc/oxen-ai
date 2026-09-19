export function ExpandMediaButton({
  label,
  preview,
  kind,
}: {
  label: string;
  preview: string;
  kind: "image" | "video";
}) {
  return (
    <button type="button" className="attach-zoom" aria-label={label}>
      <MagnifierPlusIcon />
      <span className="attach-zoom-pop" role="tooltip">
        {kind === "video" ? (
          <video src={preview} muted playsInline />
        ) : (
          <img src={preview} alt="" />
        )}
      </span>
    </button>
  );
}

function MagnifierPlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
      <circle cx="6.5" cy="6.5" r="4.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M6.5 4.7v3.6M4.7 6.5h3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M9.7 9.7 14 14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
