import { Loader } from "./Loader";

export function StatusWait({ label }: { label: string }) {
  return (
    <p className="status-wait">
      <Loader size="sm" label={label} />
    </p>
  );
}
