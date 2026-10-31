import { REFERENCE_ROLES, normalizeMediaRole, referenceRoleLabel, referenceRoleUsesFace, type MediaRole } from "../../worker/schema";
import { referenceRoleTitle } from "../lib/reference-roles";

type Props = {
  name: string;
  role?: string | null;
  onChange: (role: MediaRole) => void;
};

export function GalleryRoleSelect(props: Props) {
  const value = normalizeMediaRole(props.role);
  return (
    <select
      className={`attach-role gallery-role${referenceRoleUsesFace(value) ? "" : " is-plain"}`}
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
}
