export function MediaDeleteGroup({
  onStudio,
  onOxen,
}: {
  onStudio: () => void;
  onOxen: () => void;
}) {
  return (
    <div
      className="media-delete-group"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <button
        type="button"
        className="media-delete"
        aria-label="Remove from Studio"
        title="Remove from Studio"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onStudio();
        }}
      >
        ×
      </button>
      <button
        type="button"
        className="media-delete media-delete-oxen"
        aria-label="Remove from Studio and Oxen"
        title="Remove from Studio and Oxen"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onOxen();
        }}
      >
        Oxen
      </button>
    </div>
  );
}
