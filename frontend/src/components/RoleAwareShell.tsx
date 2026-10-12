"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";

import { hasPermission, sessionForRole, UserRole } from "../lib/session";
import IndexManagementPanel from "./IndexManagementPanel";
import ProductToolbar from "./ProductToolbar";
import WorkspaceV3 from "./WorkspaceV3";

const ROLE_STORAGE_KEY = "book-viewer-prototype-role-v1";

function RoleSwitcher({ role, onChange }: { role: UserRole; onChange: (role: UserRole) => void }) {
  const session = sessionForRole(role);
  return (
    <div className="prototype-role-switcher" data-current-role={role}>
      <span className="prototype-role-label">프로토타입 권한</span>
      <select
        aria-label="프로토타입 사용자 권한"
        value={role}
        onChange={(event) => onChange(event.target.value as UserRole)}
      >
        <option value="user">일반 사용자</option>
        <option value="admin">관리자</option>
      </select>
      <span className={`prototype-role-badge role-${role}`}>{session.name}</span>
    </div>
  );
}

export default function RoleAwareShell() {
  // Keep the existing product surface as the default for regression tests/demo.
  // A real authenticated session can replace this mock role source later.
  const [role, setRole] = useState<UserRole>("admin");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [permissionNotice, setPermissionNotice] = useState("");

  const canManageIndex = useMemo(() => hasPermission(role, "index.manage"), [role]);

  useEffect(() => {
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (saved === "user" || saved === "admin") setRole(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(ROLE_STORAGE_KEY, role);
    setPermissionNotice("");
  }, [role]);

  useEffect(() => {
    const locate = () => setPortalTarget(document.querySelector<HTMLElement>(".topbar-actions"));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (canManageIndex) return;
    const onIndexRequired = () => {
      setPermissionNotice("선택한 문서의 벡터 DB 구축이 필요합니다. 관리자에게 구축을 요청하세요.");
    };
    window.addEventListener("book-viewer:index-required", onIndexRequired);
    return () => window.removeEventListener("book-viewer:index-required", onIndexRequired);
  }, [canManageIndex]);

  return (
    <>
      <WorkspaceV3 />
      <ProductToolbar />
      {canManageIndex ? <IndexManagementPanel /> : null}
      {portalTarget ? createPortal(<RoleSwitcher role={role} onChange={setRole} />, portalTarget) : null}
      {permissionNotice ? (
        <div className="permission-notice" role="status">
          <div>
            <strong>관리자 권한 필요</strong>
            <span>{permissionNotice}</span>
          </div>
          <button type="button" onClick={() => setPermissionNotice("")} aria-label="권한 안내 닫기">×</button>
        </div>
      ) : null}
    </>
  );
}
