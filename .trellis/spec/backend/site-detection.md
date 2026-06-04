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
