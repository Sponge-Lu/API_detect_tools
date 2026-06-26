# Site Detection Runtime

## Scenario: Model Response Shape And Account Check-In Credentials

### 1. Scope / Trigger

- Trigger: site refresh can receive non-object model endpoint payloads such as an empty body, HTML,
  or a top-level array, and account-level check-in actions can start from a renderer `SiteConfig`
  whose legacy site-level `system_token` is empty.
- Files: `src/main/api-service.ts`, `src/main/handlers/detection-handlers.ts`,
  `src/renderer/hooks/useCheckIn.ts`, `src/__tests__/token-service.test.ts`,
  `src/__tests__/useCheckIn.test.ts`.

### 2. Signatures

```ts
// src/main/api-service.ts
private async getModels(
  site: SiteConfig,
  timeout: number,
  forceAcceptEmpty?: boolean,
  context?: DetectionRequestContext
): Promise<{ models: string[]; page?: any; pageRelease?: () => void }>;

// src/main/handlers/detection-handlers.ts
ipcMain.handle('checkin-and-refresh', async (_, site, timeout, accountId?: string) => {
  // accountId selects account.access_token/user_id before TokenService.checkIn(...)
});

// src/renderer/hooks/useCheckIn.ts
handleCheckIn(site: SiteConfig, accountId?: string): Promise<void>;
```

### 3. Contracts

- `getModels()` must not use the `in` operator until the payload is proven to be a non-array
  object.
- A top-level array response is a valid model list and must be normalized before the "missing data"
  branch.
- Primitive, null, empty-string, or HTML-like model responses should become an empty model result,
  then flow through the existing empty-response error path. They must not mask the real condition
  with a JavaScript `TypeError`.
- A successful site detection with missing or empty extension payloads must not erase previously
  cached `api_keys`, `user_groups`, or `model_pricing`. Empty extension payloads mean "not refreshed
  this round" unless the upstream protected endpoint returns a clear authentication failure.
- For NewAPI-compatible sites, an empty system-token model endpoint such as `/api/user/models` is
  recoverable. Detection must continue to fetch balance, API keys, user groups, and model pricing;
  then restore `models` from `/api/pricing`, a representative API key's `/v1/models`, or the
  previous cache before reporting the refresh as successful.
- NewAPI-compatible sites must not be reclassified as `sub2api` solely because localStorage contains
  generic `auth_user` or `auth_token` fields. A `sub2api` type hint requires stronger site evidence
  such as the registered Sub2API envelope or `__APP_CONFIG__` markers.
- Detection must pass the effective `site.site_type` explicitly into TokenService extension calls
  for API keys, user groups, and model pricing. An explicit site type overrides URL-based lookup so
  duplicate or stale same-origin site records cannot force NewAPI refreshes onto Sub2API endpoints.
- NewAPI-compatible protected endpoints that return a failure envelope such as
  `{ success: false, message: 'Unauthorized, invalid access token' }` must be treated as
  login-expired/authentication failure. Model parsing must not convert that envelope into an empty
  model response, API key parsing must not return `[]`, and user-group parsing must not treat the
  envelope as a direct group object.
- Sub2api API key endpoints that return 401/403, `TOKEN_EXPIRED`, or equivalent unauthorized
  messages must throw the login-expired error path instead of returning an empty API key list.
- Renderer check-in credential preflight only applies to site-level check-in. When `accountId` is
  present, the renderer must call `checkinAndRefresh(site, timeout, accountId)` and let the main
  handler resolve the account credentials.
- `checkin-and-refresh` must return a structured failed `checkinResult` when `accountId` does not
  resolve or the account lacks `access_token`/`user_id`.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Model endpoint returns `''` | API parse response | No `TypeError`; `getModels()` throws the existing empty-data login-expiry message unless empty data is explicitly accepted |
| Model endpoint returns `[{ id: 'gpt-4o-mini' }]` | API parse response | Returns `models: ['gpt-4o-mini']` |
| Model endpoint returns `{ success: true, message: 'ok' }` | API parse response | Treat as empty endpoint response and try the next endpoint |
| NewAPI `/api/user/models` returns empty but `/api/pricing` has models | detection flow | Continue refresh and return models from pricing instead of raising login-expired auth error |
| NewAPI system model endpoint is empty and pricing/API-key model fallback is unavailable | detection flow/cache save | Keep refresh successful and preserve existing cached models when available |
| Extension API key endpoint returns `[]` while cache has keys | cache save | Preserve existing cached `api_keys` instead of replacing them with `[]` |
| Extension user-group endpoint is unavailable | cache save | Preserve existing `user_groups` for the cache owner |
| Extension model-pricing endpoint returns `{ data: {} }` while cache has pricing | cache save | Preserve existing `model_pricing` instead of replacing it with an empty payload |
| NewAPI localStorage contains `auth_user` / `auth_token` only | browser login/site type | Do not infer `sub2api`; keep detector result or default NewAPI unless stronger Sub2API evidence exists |
| Current site object has `site_type: 'newapi'` but URL lookup finds stale same-origin `sub2api` | detection -> token service | Use explicit `newapi` and call NewAPI endpoints (`/api/token/...`, `/api/pricing`) |
| NewAPI model endpoint returns `{ success: false, message: 'Unauthorized, invalid access token' }` | API parse response | Throw the login-expired/authentication failure path; do not treat as recoverable empty model data |
| NewAPI API Key endpoint returns `{ success: false, message: 'Unauthorized, invalid access token' }` | token service -> detection | Throw the login-expired/authentication failure path; do not return `[]` |
| NewAPI user-group endpoint returns `{ success: false, message: 'Unauthorized, invalid access token' }` | token service -> detection | Throw the login-expired/authentication failure path; do not return `{ message, success }` as group data |
| Sub2api API key endpoint returns 401 / token expired | token service -> detection | Surface login-expired failure so account token refresh/re-auth flows can run |
| Account card has `accountId` but site-level `system_token` is empty | renderer -> IPC | Renderer calls `checkinAndRefresh(..., accountId)` instead of opening manual check-in immediately |
| IPC receives unknown `accountId` | main handler | Returns `{ checkinResult: { success: false, needManualCheckIn: true } }` |
| IPC receives account without access token or user id | main handler | Returns a failed `checkinResult` asking the user to refresh site information |

### 5. Good / Base / Bad Cases

- Good: a New API site whose model endpoint returns a top-level OpenAI-style array refreshes models
  without hitting the "missing data" branch.
- Good: a NewAPI-compatible site whose `/api/user/models` returns empty but `/api/pricing` lists
  models refreshes successfully and stores the pricing-derived model ids.
- Base: a stale access token that causes an empty model response still produces the existing
  login-expiry/refresh-token retry path.
- Base: a stale NewAPI access token that returns an explicit Unauthorized envelope fails the
  refresh and preserves previous cached API keys/user groups instead of saving empty or fake
  extension data.
- Bad: logging `hasSuccess: 'success' in data` before checking that `data` is an object; this hides
  the upstream response behind `Cannot use 'in' operator...`.
- Bad: an account card with a fresh account access token opens manual check-in because the legacy
  site-level `system_token` is empty.

### 6. Tests Required

- `src/__tests__/token-service.test.ts`
  - Assert a non-object model response does not throw an `in` operator `TypeError`.
  - Assert a top-level array model response returns normalized model ids.
  - Assert NewAPI empty system-token model responses recover from model pricing and still persist
    API keys/user groups.
  - Assert successful detection with empty API key/group/pricing extension payloads preserves the
    existing cache.
  - Assert explicit NewAPI site type overrides URL lookup that would otherwise resolve as Sub2API
    for API key and model-pricing endpoints.
  - Assert NewAPI Unauthorized envelopes from model, API key, and user-group endpoints surface the
    login-expired path rather than empty/fake data.
  - Assert sub2api API key auth failures surface the login-expired path.
- `src/__tests__/browser-login-flow.test.ts`
  - Assert `auth_user` / `auth_token` alone do not set a `sub2api` site type hint.
- `src/__tests__/useCheckIn.test.ts`
  - Assert account-level check-in with empty site-level credentials still invokes
    `checkinAndRefresh(site, timeout, accountId)`.

### 7. Wrong vs Correct

#### Wrong

```ts
Logger.info({ hasSuccess: 'success' in data });
if (!data || !('data' in data)) return [];
if (Array.isArray(data)) return data.map(model => model.id);
```

#### Correct

```ts
const payload = asObjectPayload(data);
if (Array.isArray(data)) return data.map(model => model.id || model.name || model);
if (!payload || !('data' in payload)) return [];
Logger.info({ hasSuccess: 'success' in payload });
```

## Scenario: Smart Add Browser Login Verification

### 1. Scope / Trigger

- Trigger: smart site add launches a browser for user login, then main-process services must decide
  whether the browser profile is authenticated.
- Files: `src/main/chrome-manager.ts`, `src/main/token-service.ts`,
  `src/__tests__/browser-login-flow.test.ts`.

### 2. Signatures

```ts
// src/main/chrome-manager.ts
async getLocalStorageData(
  url: string,
  waitForLogin?: boolean,
  maxWaitTime?: number,
  onStatus?: (status: string) => void,
  options?: { loginMode?: boolean; siteType?: SiteType }
): Promise<LocalStorageData>;

private async getUserDataFromApi(
  page: Page,
  baseUrl: string,
  siteType?: SiteType,
  loginMode?: boolean
): Promise<LocalStorageData>;
```

### 3. Contracts

- Browser profile/session is the source of truth for smart-add login state.
- Protected initialization endpoints must be requested from the Electron main process with cookies
  derived from the active Puppeteer page's CDP cookie jar. For Electron net requests, copy those
  cookies into a request-scoped Electron `Session` and use `credentials: 'include'`; a manual
  `Cookie` header is only valid for transports that permit caller-managed cookie headers.
- Cookie selection is URL-scope based: domain, subdomain, path, secure flag, and expiry. It must not
  depend on cookie names containing `session`, `token`, `auth`, or any site-specific string.
- Page-context `fetch` is not a reliable login verifier because site CSP/CORS can block it even when
  browser cookies are valid. Node `fetch` can also fail at the transport layer for sites that the
  Chromium network stack can reach, so smart-add verification should prefer Electron net with the
  browser cookies projected into the request session. Page JavaScript may still be used to read
  localStorage hints, but not as the protected API transport.
- Main-process protected API requests should include the same user-id headers currently used by
  compatible NewAPI/Veloera/VOAPI sites when a user id hint is available. If that request fails while
  a user id hint was present, retry once without those user-id headers before treating the endpoint
  as failed.
- Browser-closed and abort errors remain terminal and must not be converted into retryable login
  polling failures.

### 4. Validation & Error Matrix

| Case | Expected behavior |
|------|-------------------|
| localStorage has `userId` but no `accessToken` | Verify by protected API with browser cookies; do not trust or reject solely on cookie name |
| Browser cookie name is `new-api-user`, framework-specific, or otherwise not auth-like | Cookie is still sent if URL-visible; login can complete |
| Page-context API fetch would be blocked by CSP/CORS | Login verification still succeeds via main-process request |
| Node `fetch` times out while the login browser can load the site | Login verification still uses Electron net with request-session cookies before falling back |
| Stale localStorage user id causes protected endpoint failure | Retry once without user-id headers |
| Protected endpoint returns 401/403 after cookie request and retry | Continue waiting for login or surface the existing login-expired path |
| Browser is closed during verification | Throw browser-closed/cancel error immediately |

### 5. Good / Base / Bad Cases

- Good: user completes login in the popup browser, protected `/api/user/self` succeeds through
  Electron net using request-session browser cookies, and smart add proceeds within the next polling
  pass.
- Base: localStorage is readable and supplies user id / username hints, while browser cookies supply
  the real authenticated session.
- Bad: checking only for cookies whose names include `session`, `token`, or `auth` before attempting
  the protected API; this reintroduces the stuck `等待登录中` bug for valid sessions with different
  cookie names.
- Bad: using `page.evaluate(fetch(...))` as the only API verification path; CSP/CORS can make a valid
  logged-in session look unauthenticated.
- Bad: using bare Node `fetch` as the only main-process transport; a site can be reachable in
  Chromium/Electron while Undici reports `fetch failed` or connect timeout.

### 6. Tests Required

- `src/__tests__/browser-login-flow.test.ts`
  - Assert `getUserDataFromApi()` uses the page's effective HTTPS origin for protected API requests.
  - Assert a non-auth-like cookie name is copied into the main-process request session, the protected
    request uses `credentials: 'include'`, and login data is parsed without using page-context API
    fetch.
  - Assert existing login browser selection and token creation tests continue passing.

### 7. Wrong vs Correct

#### Wrong

```ts
const hasCookie = cookies.some(cookie => /session|token|auth/i.test(cookie.name));
if (localData.userId && hasCookie) return localData;
await page.evaluate(url => fetch(url, { credentials: 'include' }), apiUrl);
```

#### Correct

```ts
const requestSession = projectCdpCookiesIntoElectronSession(cdpCookies, apiUrl);
const request = net.request({
  method: 'GET',
  url: apiUrl,
  session: requestSession,
  credentials: 'include',
});
request.setHeader('New-API-User', String(userId));
```

## Scenario: Managed Site CLI Config Is Account Scoped

### 1. Scope / Trigger

- Trigger: managed-site CLI config is edited from the site-management side panel and later consumed
  by manual CLI tests, scheduled route CLI probes, and route-channel target protocol resolution.
- Files: `src/shared/types/site.ts`, `src/main/handlers/cli-compat-handlers.ts`,
  `src/main/route-cli-probe-service.ts`, `src/main/route-channel-resolver.ts`,
  `src/renderer/hooks/useDataLoader.ts`, `src/renderer/services/cli-compat-projection.ts`.

### 2. Contracts

- The durable managed-site CLI config owner is `accounts[].cli_config`.
- `sites[].cli_config` is legacy migration/fallback data only. New save paths must not write
  managed-site CLI config back to the site record.
- `cli-compat:save-config(siteUrl, cliConfig, accountId)` must resolve a target account for the
  site, validate that it belongs to that site, and update `AccountCredential.cli_config`.
- Scheduled route CLI probes must resolve CLI settings as
  `account.cli_config[cliType] ?? site.cli_config[cliType]`.
- Route channel target protocol resolution must use the same account-first order so manual tests,
  probes, and live routing agree on `targetProtocol`.
- When an account-level CLI item exists with `enabled: false`, consumers must treat that as an
  explicit account-level disable and must not fall back to a site-level legacy item.

### 3. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Save config with valid `accountId` | renderer -> main IPC | `accounts[].cli_config` is updated; `sites[].cli_config` is unchanged |
| Save config without `accountId` but site has active accounts | main IPC | pick the active/default account and update that account |
| Save config with account from another site | main IPC | return `Account not found` and do not write site config |
| Account config enables Codex and legacy site config disables Codex | route CLI probe | Codex probe runs using account models |
| Account config disables Codex and legacy site config enables Codex | route CLI probe | Codex probe does not run |
| Account lacks CLI config and legacy site config exists | route CLI probe / resolver | legacy site config is used as fallback only |

### 4. Tests Required

- `src/__tests__/cli-compat-handlers.test.ts`
  - Assert `cli-compat:save-config` writes to `updateAccount(..., { cli_config })` and not
    `updateSite(...)`.
- `src/__tests__/route-cli-probe-service.test.ts`
  - Assert account-level CLI config controls selected probe models.
  - Assert account-level disabled settings suppress site-level fallback.
  - Assert site-level legacy config remains a fallback when the account lacks CLI config.
- `src/__tests__/useDataLoader.test.ts`
  - Assert renderer startup loads account CLI config into the account card key.

### 5. Wrong vs Correct

#### Wrong

```ts
await unifiedConfigManager.updateSite(site.id, { cli_config });
const item = site.cli_config?.[cliType];
```

#### Correct

```ts
await unifiedConfigManager.updateAccount(account.id, { cli_config });
const item = account.cli_config?.[cliType] ?? site.cli_config?.[cliType];
```
