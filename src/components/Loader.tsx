import { Blocks } from "loading-dev";

const SIZES = {
  sm: 16,
  md: 22,
  lg: 36,
} as const;

export function Loader({
  size = "md",
  label,
}: {
  size?: keyof typeof SIZES;
  label?: string;
}) {
  return (
    <span className={`loader${label ? " has-label" : ""}`} role={label ? "status" : undefined}>
      <span className="loader-mark" aria-hidden="true">
        <Blocks size={SIZES[size]} duration={1400} />
      </span>
      {label ? <span>{label}</span> : null}
    </span>
  );
}
