# Keycloak authentication

Book Viewer V2 can run in two authentication modes.

- `mock`: frontend prototype role switcher, used by local/UI smoke tests.
- `keycloak`: real OIDC login against the closed-network Keycloak server.

## Current closed-network configuration

```text
Keycloak: http://166.103.117.128:4420
Realm: kai
Client ID: book-viewer-v2
User group: /teams/ips-260703-test
Admin group: /teams/ips-260703-test/admins
Frontend: http://166.103.117.128:3002
Backend: http://166.103.117.128:9056
```

The Keycloak client must use the standard authorization-code flow as a public client. The client redirect URI is `http://166.103.117.128:3002/*`, the web origin is `http://166.103.117.128:3002`, and the dedicated client scope includes a Group Membership mapper with token claim name `groups`, full group path enabled, and the claim added to access token, ID token, and userinfo.

## Role rule

1. A user in `/teams/ips-260703-test/admins` is an administrator.
2. Otherwise, a user in `/teams/ips-260703-test` is a normal user.
3. Any other authenticated account receives HTTP 403 and cannot use Book Viewer.

The admin group is checked first so an administrator remains an administrator even if the token does not separately list the parent group.

## Frontend production environment

These values are build-time variables for Next.js and must be present before `npm run build`.

```env
NEXT_PUBLIC_API_BASE_URL=http://166.103.117.128:9056
NEXT_PUBLIC_SEAWEEDFS_FILER_URL=http://166.103.117.128:6097
NEXT_PUBLIC_AUTH_MODE=keycloak
NEXT_PUBLIC_KEYCLOAK_BASE_URL=http://166.103.117.128:4420
NEXT_PUBLIC_KEYCLOAK_REALM=kai
NEXT_PUBLIC_KEYCLOAK_CLIENT_ID=book-viewer-v2
NEXT_PUBLIC_KEYCLOAK_USER_GROUP=/teams/ips-260703-test
NEXT_PUBLIC_KEYCLOAK_ADMIN_GROUP=/teams/ips-260703-test/admins
```

The browser uses Authorization Code + PKCE. Access/refresh tokens are stored in browser `sessionStorage`, refreshed when the access token is near expiry, and attached as Bearer tokens to backend API and SSE requests.

## Backend environment

```env
AUTH_MODE=keycloak
KEYCLOAK_BASE_URL=http://166.103.117.128:4420
KEYCLOAK_REALM=kai
KEYCLOAK_CLIENT_ID=book-viewer-v2
KEYCLOAK_USER_GROUP=/teams/ips-260703-test
KEYCLOAK_ADMIN_GROUP=/teams/ips-260703-test/admins
KEYCLOAK_TIMEOUT=10
CORS_ALLOWED_ORIGINS=http://166.103.117.128:3002
```

The backend validates a Bearer token by calling the Realm `userinfo` endpoint. This intentionally uses the already-installed `httpx` dependency, so this phase does not add a new Python package to the closed-network environment. The returned `groups` claim is mapped to the application role.

The following API groups require an authenticated Book Viewer user:

- viewer/document APIs
- search
- RAG
- Agent
- translation

Index management APIs require the administrator role. Health and readiness remain unauthenticated for operations monitoring.

## Future realm migration

Realm name, Keycloak base URL, client ID, and group paths are environment-driven. If Book Viewer later moves from `kai` to a dedicated Realm, update the Keycloak client/mapper and the environment values; the application permission model does not need to change.
