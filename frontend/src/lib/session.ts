export type UserRole = "user" | "admin";

export type Permission =
  | "viewer.read"
  | "translation.use"
  | "rag.use"
  | "print.use"
  | "index.read"
  | "index.manage"
  | "admin.view";

export type SessionUser = {
  id: string;
  name: string;
  role: UserRole;
};

export const MOCK_SESSIONS: Record<UserRole, SessionUser> = {
  user: { id: "mock-user", name: "일반 사용자", role: "user" },
  admin: { id: "mock-admin", name: "관리자", role: "admin" },
};

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  user: new Set<Permission>([
    "viewer.read",
    "translation.use",
    "rag.use",
    "print.use",
  ]),
  admin: new Set<Permission>([
    "viewer.read",
    "translation.use",
    "rag.use",
    "print.use",
    "index.read",
    "index.manage",
    "admin.view",
  ]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

// Prototype seam for future account DB integration:
// replace MOCK_SESSIONS/current role selection with an authenticated session API,
// while keeping permission checks in the UI unchanged.
export function sessionForRole(role: UserRole): SessionUser {
  return MOCK_SESSIONS[role];
}
