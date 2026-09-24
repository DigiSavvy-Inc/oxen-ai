export function MediaDeleteGroup({
  onStudio,
  onOxen,
  oxen = true,
}: {
  onStudio: () => void;
  onOxen?: () => void;
  oxen?: boolean;
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
      {oxen && onOxen ? (
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
      ) : null}
    </div>
  );
}
