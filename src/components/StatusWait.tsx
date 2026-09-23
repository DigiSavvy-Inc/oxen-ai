export function StatusWait({ label }: { label: string }) {
  return (
    <p className="status-wait" role="status" aria-live="polite">
      <span className="status-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      {label}
    </p>
  );
}
