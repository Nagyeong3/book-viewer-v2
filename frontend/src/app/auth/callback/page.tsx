"use client";

import { useEffect, useState } from "react";

import { clearAuthSession, completeLogin, switchAccount } from "../../../lib/auth";

export default function AuthCallbackPage() {
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void completeLogin(window.location.search)
      .then((returnTo) => {
        if (!cancelled) window.location.replace(returnTo || "/");
      })
      .catch((cause) => {
        if (!cancelled) {
          clearAuthSession();
          const message = cause instanceof Error ? cause.message : "";
          setError(message.includes("access_denied") || message.includes("cancel")
            ? "로그인이 취소되었습니다. 다른 계정으로 다시 로그인할 수 있습니다."
            : "로그인을 완료하지 못했습니다. 인증 정보를 확인한 뒤 다시 로그인해 주세요.");
        }
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <main className="auth-state-shell">
      <section className="auth-state-card">
        <span className="auth-brand-mark" aria-hidden="true">B</span>
        <h1>{error ? "로그인을 완료하지 못했습니다" : "로그인 처리 중"}</h1>
        <p>{error || "Keycloak 인증 결과를 확인하고 있습니다."}</p>
        {error ? <button className="auth-primary-button" type="button" onClick={() => void switchAccount()}>다른 계정으로 로그인</button> : null}
      </section>
    </main>
  );
}
