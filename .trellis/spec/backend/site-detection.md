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
| Account card has `accountId` but site-level `system_token` is empty | renderer -> IPC | Renderer calls `checkinAndRefresh(..., accountId)` instead of opening manual check-in immediately |
| IPC receives unknown `accountId` | main handler | Returns `{ checkinResult: { success: false, needManualCheckIn: true } }` |
| IPC receives account without access token or user id | main handler | Returns a failed `checkinResult` asking the user to refresh site information |

### 5. Good / Base / Bad Cases

- Good: a New API site whose model endpoint returns a top-level OpenAI-style array refreshes models
  without hitting the "missing data" branch.
- Base: a stale access token that causes an empty model response still produces the existing
  login-expiry/refresh-token retry path.
- Bad: logging `hasSuccess: 'success' in data` before checking that `data` is an object; this hides
  the upstream response behind `Cannot use 'in' operator...`.
- Bad: an account card with a fresh account access token opens manual check-in because the legacy
  site-level `system_token` is empty.

### 6. Tests Required

- `src/__tests__/token-service.test.ts`
  - Assert a non-object model response does not throw an `in` operator `TypeError`.
  - Assert a top-level array model response returns normalized model ids.
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
