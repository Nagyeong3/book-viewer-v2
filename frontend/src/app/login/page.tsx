"use client";

import { useEffect, useState } from "react";

import { beginLogin, getValidAccessToken, isKeycloakMode } from "../../lib/auth";

export default function LoginPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isKeycloakMode()) return;
    void getValidAccessToken().then((token) => {
      if (token) window.location.replace("/");
    });
  }, []);

  const login = async () => {
    setLoading(true);
    setError("");
    try {
      const returnTo = new URLSearchParams(window.location.search).get("returnTo") || "/";
      await beginLogin(returnTo.startsWith("/") ? returnTo : "/");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLoading(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <div className="login-brand">
          <span className="auth-brand-mark" aria-hidden="true">B</span>
          <div><strong>기술문서 AI Viewer</strong><span>BOOK VIEWER</span></div>
        </div>
        <div className="login-copy">
          <span className="login-eyebrow">SECURE ACCESS</span>
          <h1>사내 계정으로 로그인</h1>
          <p>기술문서 열람, 번역 및 AI 질의응답 서비스를 이용하려면 사내 인증이 필요합니다.</p>
        </div>
        {error ? <div className="login-error">{error}</div> : null}
        {isKeycloakMode() ? (
          <button className="auth-primary-button login-button" type="button" onClick={() => void login()} disabled={loading}>
            {loading ? "로그인 페이지로 이동 중..." : "사내 계정 로그인"}
          </button>
        ) : (
          <button className="auth-primary-button login-button" type="button" onClick={() => window.location.assign("/")}>프로토타입 열기</button>
        )}
        <div className="login-meta">
          <span>계정과 권한은 Keycloak 사내 인증 시스템에서 관리됩니다.</span>
          <span>관리자 권한은 지정된 관리자 그룹에 따라 자동 적용됩니다.</span>
        </div>
      </section>
      <aside className="login-sidecopy" aria-hidden="true">
        <span>DOCUMENT INTELLIGENCE</span>
        <strong>문서를 찾고,<br />읽고,<br />질문하는 하나의 공간.</strong>
        <p>PostgreSQL 기반 원문과 RAG 검색을 연결한 폐쇄망 기술문서 AI 서비스</p>
      </aside>
    </main>
  );
}
