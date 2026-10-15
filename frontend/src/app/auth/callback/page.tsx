"use client";

import { useEffect, useState } from "react";

import { completeLogin } from "../../../lib/auth";

export default function AuthCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void completeLogin(window.location.search)
      .then((returnTo) => {
        if (!cancelled) window.location.replace(returnTo || "/");
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="auth-state-shell">
      <section className="auth-state-card">
        <span className="auth-brand-mark" aria-hidden="true">B</span>
        <h1>{error ? "로그인을 완료하지 못했습니다" : "로그인 처리 중"}</h1>
        <p>{error || "Keycloak 인증 결과를 확인하고 있습니다."}</p>
        {error ? <button className="auth-primary-button" type="button" onClick={() => window.location.replace("/login")}>로그인으로 돌아가기</button> : null}
      </section>
    </main>
  );
}
