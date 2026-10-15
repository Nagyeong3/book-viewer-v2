import { roleFromGroups, SessionUser } from "./session";

export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE ?? "mock";
export const KEYCLOAK_BASE_URL = (process.env.NEXT_PUBLIC_KEYCLOAK_BASE_URL ?? "").replace(/\/$/, "");
export const KEYCLOAK_REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM ?? "";
export const KEYCLOAK_CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID ?? "";
export const KEYCLOAK_USER_GROUP = process.env.NEXT_PUBLIC_KEYCLOAK_USER_GROUP ?? "";
export const KEYCLOAK_ADMIN_GROUP = process.env.NEXT_PUBLIC_KEYCLOAK_ADMIN_GROUP ?? "";

const TOKEN_KEY = "book-viewer-keycloak-token-v1";
const PKCE_KEY = "book-viewer-keycloak-pkce-v1";

export type TokenSet = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
};

type StoredPkce = {
  state: string;
  verifier: string;
  redirectUri: string;
  returnTo: string;
};

type JwtClaims = {
  sub?: string;
  preferred_username?: string;
  name?: string;
  email?: string;
  groups?: string[];
  exp?: number;
};

function assertKeycloakConfig() {
  const missing = [
    ["NEXT_PUBLIC_KEYCLOAK_BASE_URL", KEYCLOAK_BASE_URL],
    ["NEXT_PUBLIC_KEYCLOAK_REALM", KEYCLOAK_REALM],
    ["NEXT_PUBLIC_KEYCLOAK_CLIENT_ID", KEYCLOAK_CLIENT_ID],
    ["NEXT_PUBLIC_KEYCLOAK_USER_GROUP", KEYCLOAK_USER_GROUP],
    ["NEXT_PUBLIC_KEYCLOAK_ADMIN_GROUP", KEYCLOAK_ADMIN_GROUP],
  ].filter(([, value]) => !value).map(([name]) => name);
  if (missing.length) throw new Error(`Keycloak 설정이 없습니다: ${missing.join(", ")}`);
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function randomString(size = 32): string {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function decodeJwt(token: string): JwtClaims {
  const parts = token.split(".");
  if (parts.length < 2) throw new Error("잘못된 JWT 형식입니다.");
  const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return JSON.parse(decodeURIComponent(Array.from(atob(padded)).map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`).join(""))) as JwtClaims;
}

function saveTokenSet(tokens: TokenSet) {
  sessionStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

function loadTokenSet(): TokenSet | null {
  const raw = sessionStorage.getItem(TOKEN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TokenSet;
  } catch {
    sessionStorage.removeItem(TOKEN_KEY);
    return null;
  }
}

export function clearAuthSession() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(PKCE_KEY);
}

export function isKeycloakMode(): boolean {
  return AUTH_MODE === "keycloak";
}

export async function beginLogin(returnTo = "/") {
  assertKeycloakConfig();
  const redirectUri = `${window.location.origin}/auth/callback`;
  const verifier = randomString(48);
  const state = randomString(24);
  const challenge = await pkceChallenge(verifier);
  const pkce: StoredPkce = { state, verifier, redirectUri, returnTo };
  sessionStorage.setItem(PKCE_KEY, JSON.stringify(pkce));

  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  window.location.assign(`${KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/auth?${params.toString()}`);
}

export async function completeLogin(search: string): Promise<string> {
  assertKeycloakConfig();
  const query = new URLSearchParams(search);
  const error = query.get("error");
  if (error) throw new Error(query.get("error_description") || error);
  const code = query.get("code");
  const state = query.get("state");
  const raw = sessionStorage.getItem(PKCE_KEY);
  if (!code || !state || !raw) throw new Error("로그인 요청 정보를 확인할 수 없습니다.");

  const pkce = JSON.parse(raw) as StoredPkce;
  if (pkce.state !== state) throw new Error("로그인 state 검증에 실패했습니다.");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: KEYCLOAK_CLIENT_ID,
    code,
    redirect_uri: pkce.redirectUri,
    code_verifier: pkce.verifier,
  });
  const response = await fetch(`${KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) throw new Error(`Keycloak token 교환 실패 (${response.status})`);
  const tokens = await response.json() as TokenSet;
  if (!tokens.access_token) throw new Error("Keycloak access token이 없습니다.");
  saveTokenSet(tokens);
  sessionStorage.removeItem(PKCE_KEY);
  return pkce.returnTo || "/";
}

async function refresh(tokens: TokenSet): Promise<TokenSet | null> {
  if (!tokens.refresh_token) return null;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: KEYCLOAK_CLIENT_ID,
    refresh_token: tokens.refresh_token,
  });
  const response = await fetch(`${KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) return null;
  const next = await response.json() as TokenSet;
  if (!next.access_token) return null;
  saveTokenSet(next);
  return next;
}

export async function getValidAccessToken(): Promise<string | null> {
  if (!isKeycloakMode() || typeof window === "undefined") return null;
  let tokens = loadTokenSet();
  if (!tokens?.access_token) return null;
  try {
    const claims = decodeJwt(tokens.access_token);
    if (!claims.exp || claims.exp * 1000 > Date.now() + 30_000) return tokens.access_token;
  } catch {
    clearAuthSession();
    return null;
  }
  tokens = await refresh(tokens);
  if (!tokens) {
    clearAuthSession();
    return null;
  }
  return tokens.access_token;
}

export async function getAuthorizationHeader(): Promise<Record<string, string>> {
  const token = await getValidAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function getLocalSession(): Promise<SessionUser | null> {
  const token = await getValidAccessToken();
  if (!token) return null;
  const claims = decodeJwt(token);
  const groups = Array.isArray(claims.groups) ? claims.groups : [];
  const role = roleFromGroups(groups, KEYCLOAK_USER_GROUP, KEYCLOAK_ADMIN_GROUP);
  if (!role || !claims.sub) return null;
  return {
    id: claims.sub,
    username: claims.preferred_username ?? claims.email ?? claims.sub,
    name: claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub,
    role,
    groups,
  };
}

export async function logout() {
  const tokens = loadTokenSet();
  clearAuthSession();
  if (!isKeycloakMode()) {
    window.location.assign("/");
    return;
  }
  assertKeycloakConfig();
  const postLogout = `${window.location.origin}/login`;
  const params = new URLSearchParams({
    client_id: KEYCLOAK_CLIENT_ID,
    post_logout_redirect_uri: postLogout,
  });
  if (tokens?.id_token) params.set("id_token_hint", tokens.id_token);
  window.location.assign(`${KEYCLOAK_BASE_URL}/realms/${encodeURIComponent(KEYCLOAK_REALM)}/protocol/openid-connect/logout?${params.toString()}`);
}
