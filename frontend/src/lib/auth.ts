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

function rotateRight(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

function sha256Fallback(input: Uint8Array): Uint8Array {
  const constants = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ]);
  const bytes = Array.from(input);
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((high >>> shift) & 0xff);
  for (let shift = 24; shift >= 0; shift -= 8) bytes.push((low >>> shift) & 0xff);

  let hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = new Uint32Array(64);
    for (let index = 0; index < 16; index += 1) {
      const position = offset + index * 4;
      words[index] = (
        (bytes[position] << 24)
        | (bytes[position + 1] << 16)
        | (bytes[position + 2] << 8)
        | bytes[position + 3]
      ) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15];
      const y = words[index - 2];
      const sigma0 = (rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3)) >>> 0;
      const sigma1 = (rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10)) >>> 0;
      words[index] = (words[index - 16] + sigma0 + words[index - 7] + sigma1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = (rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)) >>> 0;
      const choose = ((e & f) ^ (~e & g)) >>> 0;
      const temp1 = (h + sigma1 + choose + constants[index] + words[index]) >>> 0;
      const sigma0 = (rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)) >>> 0;
      const majority = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const temp2 = (sigma0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    hash = [
      (hash[0] + a) >>> 0,
      (hash[1] + b) >>> 0,
      (hash[2] + c) >>> 0,
      (hash[3] + d) >>> 0,
      (hash[4] + e) >>> 0,
      (hash[5] + f) >>> 0,
      (hash[6] + g) >>> 0,
      (hash[7] + h) >>> 0,
    ];
  }

  const digest = new Uint8Array(32);
  hash.forEach((value, index) => {
    const position = index * 4;
    digest[position] = value >>> 24;
    digest[position + 1] = value >>> 16;
    digest[position + 2] = value >>> 8;
    digest[position + 3] = value;
  });
  return digest;
}

async function pkceChallenge(verifier: string): Promise<string> {
  const input = new TextEncoder().encode(verifier);
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    const digest = await subtle.digest("SHA-256", input);
    return base64Url(new Uint8Array(digest));
  }
  return base64Url(sha256Fallback(input));
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
  const returned = await response.json() as TokenSet;
  if (!returned.access_token) return null;
  const next: TokenSet = {
    ...tokens,
    ...returned,
    refresh_token: returned.refresh_token || tokens.refresh_token,
    id_token: returned.id_token || tokens.id_token,
  };
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
