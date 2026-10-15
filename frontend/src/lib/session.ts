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
  username?: string;
  name: string;
  role: UserRole;
  groups?: string[];
};

export const MOCK_SESSIONS: Record<UserRole, SessionUser> = {
  user: { id: "mock-user", username: "mock-user", name: "일반 사용자", role: "user", groups: [] },
  admin: { id: "mock-admin", username: "mock-admin", name: "관리자", role: "admin", groups: [] },
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

export function sessionForRole(role: UserRole): SessionUser {
  return MOCK_SESSIONS[role];
}

export function roleFromGroups(groups: string[], userGroup: string, adminGroup: string): UserRole | null {
  if (groups.includes(adminGroup)) return "admin";
  if (groups.includes(userGroup)) return "user";
  return null;
}
