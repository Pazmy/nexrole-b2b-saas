import { ROLE } from "./constants";

export type Permission =
  | "workspace:read"
  | "transactions:read"
  | "workspace:update"
  | "members:invite"
  | "keys:manage"
  | "billing:manage";

const READ_PERMISSIONS: readonly Permission[] = ["workspace:read", "transactions:read"];
const ROLE_PERMISSIONS: Record<string, readonly Permission[]> = {
  [ROLE.SUPER_ADMIN]: [...READ_PERMISSIONS, "workspace:update", "members:invite", "keys:manage", "billing:manage"],
  [ROLE.MEMBER]: READ_PERMISSIONS,
  [ROLE.DEVELOPER]: READ_PERMISSIONS,
};

export function isWorkspaceRole(role: string): boolean {
  return Object.hasOwn(ROLE_PERMISSIONS, role);
}

export function hasPermission(role: string, permission: Permission): boolean {
  return isWorkspaceRole(role) && ROLE_PERMISSIONS[role].includes(permission);
}
