"use client";

import { createPortal } from "react-dom";
import { useEffect, useMemo, useState } from "react";

import { getValidAccessToken, isKeycloakMode, logout } from "../lib/auth";
import { api } from "../lib/api";
import { hasPermission, sessionForRole, SessionUser, UserRole } from "../lib/session";
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

function SignedInUser({ user }: { user: SessionUser }) {
  return (
    <div className="signed-in-user" data-current-role={user.role}>
      <span className="signed-in-copy">
        <strong>{user.name}</strong>
        <small>{user.role === "admin" ? "관리자" : "일반 사용자"}</small>
      </span>
      <button type="button" onClick={() => void logout()}>로그아웃</button>
    </div>
  );
}

function AuthState({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <main className="auth-state-shell">
      <section className="auth-state-card">
        <span className="auth-brand-mark" aria-hidden="true">B</span>
        <h1>{title}</h1>
        <p>{description}</p>
        {action}
      </section>
    </main>
  );
}

export default function RoleAwareShell() {
  const keycloakMode = isKeycloakMode();
  const [mockRole, setMockRole] = useState<UserRole>("admin");
  const [session, setSession] = useState<SessionUser | null>(keycloakMode ? null : sessionForRole("admin"));
  const [authState, setAuthState] = useState<"loading" | "ready" | "denied" | "error">(keycloakMode ? "loading" : "ready");
  const [authMessage, setAuthMessage] = useState("");
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [permissionNotice, setPermissionNotice] = useState("");

  const role = session?.role ?? mockRole;
  const canManageIndex = useMemo(() => hasPermission(role, "index.manage"), [role]);

  useEffect(() => {
    if (keycloakMode) return;
    const saved = window.localStorage.getItem(ROLE_STORAGE_KEY);
    if (saved === "user" || saved === "admin") {
      setMockRole(saved);
      setSession(sessionForRole(saved));
    }
  }, [keycloakMode]);

  useEffect(() => {
    if (keycloakMode) return;
    window.localStorage.setItem(ROLE_STORAGE_KEY, mockRole);
    setSession(sessionForRole(mockRole));
    setPermissionNotice("");
  }, [keycloakMode, mockRole]);

  useEffect(() => {
    if (!keycloakMode) return;
    let cancelled = false;
    const resolveSession = async () => {
      const token = await getValidAccessToken();
      if (!token) {
        const returnTo = encodeURIComponent(`${window.location.pathname}${window.location.search}`);
        window.location.replace(`/login?returnTo=${returnTo}`);
        return;
      }
      try {
        const user = await api.getCurrentUser();
        if (cancelled) return;
        setSession({ id: user.id, username: user.username, name: user.name, role: user.role, groups: user.groups });
        setAuthState("ready");
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("HTTP 403")) {
          setAuthState("denied");
          setAuthMessage("이 계정은 Book Viewer 사용 그룹에 등록되어 있지 않습니다.");
        } else if (message.includes("HTTP 401")) {
          window.location.replace("/login");
        } else {
          setAuthState("error");
          setAuthMessage(message);
        }
      }
    };
    void resolveSession();
    return () => { cancelled = true; };
  }, [keycloakMode]);

  useEffect(() => {
    if (authState !== "ready") return;
    const locate = () => setPortalTarget(document.querySelector<HTMLElement>(".topbar-actions"));
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [authState]);

  useEffect(() => {
    if (canManageIndex) return;
    const onIndexRequired = () => {
      setPermissionNotice("선택한 문서의 벡터 DB 구축이 필요합니다. 관리자에게 구축을 요청하세요.");
    };
    window.addEventListener("book-viewer:index-required", onIndexRequired);
    return () => window.removeEventListener("book-viewer:index-required", onIndexRequired);
  }, [canManageIndex]);

  if (authState === "loading") {
    return <AuthState title="로그인 확인 중" description="사내 인증 정보를 확인하고 있습니다." />;
  }

  if (authState === "denied") {
    return (
      <AuthState
        title="접근 권한이 없습니다"
        description={authMessage}
        action={<button className="auth-primary-button" type="button" onClick={() => void logout()}>다른 계정으로 로그인</button>}
      />
    );
  }

  if (authState === "error") {
    return (
      <AuthState
        title="인증 정보를 확인할 수 없습니다"
        description={authMessage || "잠시 후 다시 시도하세요."}
        action={<button className="auth-primary-button" type="button" onClick={() => window.location.reload()}>다시 시도</button>}
      />
    );
  }

  return (
    <>
      <WorkspaceV3 />
      <ProductToolbar />
      {canManageIndex ? <IndexManagementPanel /> : null}
      {portalTarget ? createPortal(
        keycloakMode && session
          ? <SignedInUser user={session} />
          : <RoleSwitcher role={mockRole} onChange={setMockRole} />,
        portalTarget,
      ) : null}
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
