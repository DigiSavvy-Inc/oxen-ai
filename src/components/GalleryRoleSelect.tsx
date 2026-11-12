import { REFERENCE_ROLES, normalizeMediaRole, referenceRoleLabel, type MediaRole } from "../../worker/schema";
import { referenceRoleTitle } from "../lib/reference-roles";

type Props = {
  name: string;
  role?: string | null;
  onChange: (role: MediaRole) => void;
};

export function GalleryRoleSelect(props: Props) {
  const value = normalizeMediaRole(props.role);
  const select = (
    <select
      className="gallery-role"
      aria-label={`Reference role for ${props.name}`}
      title={referenceRoleTitle(value)}
      value={value}
      onMouseDown={(event) => event.stopPropagation()}
      onChange={(event) => props.onChange(normalizeMediaRole(event.target.value))}
    >
      {REFERENCE_ROLES.map((role) => (
        <option key={role} value={role} title={referenceRoleTitle(role)}>
          {referenceRoleLabel(role)}
        </option>
      ))}
    </select>
  );
  return (
    <span className={`gallery-role-chip is-${value}`}>
      <RoleGlyph role={value} />
      {select}
    </span>
  );
}

function RoleGlyph({ role }: { role: MediaRole }) {
  switch (role) {
    case "character":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="8" cy="5.2" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path
            d="M3.6 13.2c.6-2.4 2.2-3.6 4.4-3.6s3.8 1.2 4.4 3.6"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      );
    case "background":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M2.4 11.6 5.6 8.2l2.2 2.1 2.3-2.8 3.5 4.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path d="M2.2 13.2h11.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      );
    case "object":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 2.4 13 5.2v5.6L8 13.6 3 10.8V5.2L8 2.4z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
          <path d="M8 8.2 13 5.2M8 8.2 3 5.2M8 8.2v5.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
        </svg>
      );
    case "style":
      return (
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path
            d="M8 2.2c2.6 2.4 3.8 4.2 3.8 6.1A3.8 3.8 0 1 1 4.2 8.3C4.2 6.4 5.4 4.6 8 2.2z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
      );
    default: {
      const unreachable: never = role;
      return unreachable;
    }
  }
}
