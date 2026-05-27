# Route Runtime

## Scenario: Route Path Ordering And Temporary Disable

### 1. Scope / Trigger

- Trigger: route proxy requests for Claude Code, Codex, and Gemini CLI must try high-priority sites first, avoid repeated attempts against a known-bad path, and expose path suspension state in the redirection UI.
- A route path is identified by rule, site, account, API key, canonical model, and resolved upstream model. It is more specific than the legacy channel stats key.
- This contract spans `src/shared/types/route-proxy.ts`, `src/main/route-channel-resolver.ts`, `src/main/route-stats-service.ts`, `src/main/route-proxy-service.ts`, `src/main/route-probe-lock.ts`, `src/main/anyrouter-request-rewriter.ts`, `src/main/cli-protocol-adapter.ts`, `src/main/unified-config-manager.ts`, and `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx`.

### 2. Signatures

```ts
// src/shared/types/route-proxy.ts
export interface RoutePathState extends RouteChannelKey {
  cliType?: RouteCliType;
  canonicalModel?: string;
  resolvedModel?: string;
  windowStartedAt: number;
  windowRequestCount: number;
  windowSuccessCount: number;
  successRate: number;
  disabledUntil?: number;
  disabledReason?: 'success_rate_below_threshold';
  lastOutcome?: RouteOutcome;
  lastStatusCode?: number;
  lastLatencyMs?: number;
  lastError?: string;
  lastUsedAt?: number;
  lastSuccessAt?: number;
  lastFailureAt?: number;
  updatedAt: number;
}

export interface RoutingConfig {
  server: RouteProxyServerConfig;
  routePathStates: Record<string, RoutePathState>;
}

export interface RouteProxyServerConfig {
  upstreamProxyUrl?: string;
}

export interface RouteRuntimeConfig {
  maxAttemptsPerRoutePath: number;
  successRateWindowMinutes: number;
  disableDurationMinutes: number;
  minSuccessRate: number;
}

export interface RouteModelDisplayItem {
  runtimeConfig?: RouteRuntimeConfig;
}

export function buildRoutePathStateKey(
  key: RouteChannelKey & {
    canonicalModel?: string;
    resolvedModel?: string;
    targetProtocol?: CliTargetProtocol;
  }
): string;

// src/main/route-stats-service.ts
export const ROUTE_PATH_HEALTH_WINDOW_MS = 5 * 60 * 1000;
export const ROUTE_PATH_DISABLE_MS = 30 * 60 * 1000;
export const ROUTE_PATH_MIN_SUCCESS_RATE = 0.8;

export function isRoutePathDisabled(
  key: RouteChannelKey & {
    canonicalModel?: string;
    resolvedModel?: string;
    targetProtocol?: CliTargetProtocol;
  },
  now?: number
): boolean;

export function recordRoutePathOutcome(
  key: RouteChannelKey & {
    cliType?: RouteCliType;
    canonicalModel?: string;
    resolvedModel?: string;
    targetProtocol?: CliTargetProtocol;
  },
  outcome: RouteOutcome,
  meta?: { statusCode?: number; latencyMs?: number; error?: string },
  nowOrRuntimeConfig?: number | Partial<RouteRuntimeConfig>,
  runtimeConfig?: Partial<RouteRuntimeConfig>
): Promise<RoutePathState>;

// src/shared/types/route-proxy.ts
export interface RoutePathStateResetParams {
  routeRuleId?: string;
  canonicalModel?: string;
}

// src/main/unified-config-manager.ts
export function resetRoutePathStates(params?: RoutePathStateResetParams): Promise<number>;

// src/main/route-proxy-service.ts
export const ROUTE_SUCCESSFUL_PATH_AFFINITY_MS = 30 * 60 * 1000;
export function buildChannelAttemptPlan<T>(channels: T[], maxAttemptsPerRoutePath?: number): T[];
export function applySuccessfulRoutePathAffinity<
  T extends RouteChannelKey & {
    canonicalModel?: string;
    resolvedModel?: string;
    targetProtocol?: RoutePathState['targetProtocol'];
  },
>(
  channels: T[],
  routePathStates: Record<string, RoutePathState> | null | undefined,
  now?: number
): T[];
export function buildUpstreamRequestUrl(
  targetBaseUrl: string,
  requestUrl: string | undefined,
  cliType: RouteCliType,
  upstreamModel: string | undefined,
  apiKey: string
): { url: string; host: string };
export function resolveRouteRuntimeConfig(
  routing: Pick<RoutingConfig, 'modelRegistry'> | null | undefined,
  canonicalModel: string | null | undefined
): RouteRuntimeConfig;

// src/main/route-probe-lock.ts
export interface RouteProbeLock {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  probeRunId?: string;
  canonicalModel: string;
  rawModel: string;
  targetProtocol?: CliTargetProtocol;
  upstreamBaseUrl?: string;
  upstreamApiKey?: string;
}

export interface RouteProbeLockTerminalFailure {
  routeApiKey: string;
  cliType: RouteCliType;
  statusCode?: number;
  terminalError: string;
  lock?: RouteProbeLock;
}

export interface RouteProbeLockUpstreamResult {
  routeApiKey: string;
  cliType: RouteCliType;
  statusCode?: number;
  success: boolean;
  responseSummary?: string;
  error?: string;
  finishedAt: number;
  lock?: RouteProbeLock;
}

export function buildProbeLockRouteApiKey(unifiedApiKey: string, lock: RouteProbeLock): string;
export function parseProbeLockRouteApiKey(
  token: string,
  unifiedApiKey: string
): RouteProbeLock | null;
export function subscribeRouteProbeLockRequest(
  routeApiKey: string,
  listener: () => void
): () => void;
export function notifyRouteProbeLockRequest(routeApiKey: string): void;
export function subscribeRouteProbeLockTerminalFailure(
  routeApiKey: string,
  listener: (failure: RouteProbeLockTerminalFailure) => void
): () => void;
export function notifyRouteProbeLockTerminalFailure(
  failure: RouteProbeLockTerminalFailure
): void;
export function getRouteProbeLockTerminalFailure(
  routeApiKey: string
): RouteProbeLockTerminalFailure | undefined;
export function clearRouteProbeLockTerminalFailure(routeApiKey: string): void;
export function getRouteProbeLockFirstUpstreamResult(
  routeApiKey: string
): RouteProbeLockUpstreamResult | undefined;
export function recordRouteProbeLockFirstUpstreamResult(
  result: RouteProbeLockUpstreamResult
): RouteProbeLockUpstreamResult;
export function consumeRouteProbeLockUpstreamAttempt(routeApiKey: string): boolean;

// src/main/cli-protocol-adapter.ts
export function adaptRequestToTargetProtocol(
  bodyBuffer: Buffer,
  cliType: RouteCliType,
  targetProtocol: 'anthropic-messages' | 'openai-chat-completions' | 'openai-responses',
  requestUrl?: string,
  upstreamModel?: string
): {
  body: Buffer;
  headers: Record<string, string>;
  upstreamMethod: 'POST';
  upstreamPath: string;
  responseAdapter: object;
};
export function transformTargetProtocolResponse(params: {
  body: Buffer;
  headers: Record<string, string | string[] | undefined>;
  statusCode: number;
  adapter: object;
}): { body: Buffer; headers: Record<string, string | string[] | undefined> };

// src/main/utils/http-client.ts
export function httpRawRequest(
  url: string,
  config: {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: Buffer | string;
    timeout?: number;
    proxyUrl?: string;
    preferElectronNet?: boolean;
  }
): Promise<{
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  firstByteLatencyMs?: number;
}>;

export function httpRawStreamRequest(
  url: string,
  config: {
    method?: string;
    headers?: Record<string, string | string[] | undefined>;
    body?: Buffer | string;
    timeout?: number;
    proxyUrl?: string;
    preferElectronNet?: boolean;
    onResponse?: (response: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[]>;
    }) => boolean | void;
    onChunk?: (chunk: Buffer) => void | Promise<void>;
  }
): Promise<{
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
  firstByteLatencyMs?: number;
}>;

// src/main/utils/electron-fetch.ts
export function normalizeProxyUrl(proxyUrl?: string | null): string | undefined;
export function electronFetchRawStream(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string | string[]>;
    body?: string | Buffer;
    timeout?: number;
    proxyUrl?: string;
    onResponse?: (response: {
      status: number;
      statusText: string;
      headers: Record<string, string | string[]>;
    }) => boolean | void;
    onData?: (chunk: Buffer) => void | Promise<void>;
  }
): Promise<{
  status: number;
  statusText: string;
  body: Buffer;
  headers: Record<string, string | string[]>;
  firstByteLatencyMs?: number;
}>;
```

### 3. Contracts

- `normalizeRoutingConfig()` must always backfill `routing.routePathStates = {}` for old config files.
- `normalizeRoutingConfig()` must always backfill `routing.server.upstreamProxyUrl = ''` for old config files and trim non-empty persisted values.
- `buildRoutePathStateKey()` must include `routeRuleId`, `siteId`, `accountId`, `apiKeyId`, normalized `targetProtocol`, `canonicalModel`, and `resolvedModel`; target protocol plus canonical and resolved model fields use `encodeURIComponent`.
- Local route forwarding must use `httpRawRequest(..., { preferElectronNet: true, proxyUrl: routing.server.upstreamProxyUrl })` instead of Node `http.request` / `https.request`, so packaged route traffic uses Chromium/Electron's network stack and preserves raw response bodies for transparent forwarding.
- `electronFetchRaw()` must treat `timeout` as a connection/idle timeout, not a total response-duration timeout. Re-arm the timer when the response starts and after every `data` chunk so long-running SSE CLI responses are not aborted while the upstream is actively streaming.
- Local route streaming requests must keep the initial upstream wait bounded by the configured/site-specific request timeout. After the first SSE data chunk is received, active streams use an idle timeout of at least 10 minutes so healthy long-running streams are not aborted between chunks.
- AnyRouter site-name detection must normalize spaces, repeated spaces, hyphens, and underscores so both `Any Router` and `AnyRouter` activate the same AnyRouter request rewrite path. Do not match names with extra prefix/suffix text.
- Local route SSE passthrough must use `httpRawStreamRequest()` / `electronFetchRawStream()` only when the original request is streaming (`body.stream === true` or a Gemini `:streamGenerateContent` path), the upstream response status is classified as `success`, the upstream `content-type` contains `text/event-stream`, and both the AnyRouter and target-protocol response adapters are `transparent`.
- For streaming passthrough, `handleRequest()` must validate the upstream `onResponse` callback but defer downstream response headers until the first accepted SSE chunk is about to be forwarded. Hop-by-hop headers plus `content-length` and `transfer-encoding` must be stripped so the downstream response can remain streaming/chunked, and a first-chunk timeout can fail/fallback before any downstream bytes are written.
- `httpRawStreamRequest()` and `electronFetchRawStream()` must invoke chunk callbacks as bytes arrive while still retaining the complete response `body` and `firstByteLatencyMs` for analytics, usage extraction, and failure logs.
- If the upstream streaming candidate is not a success SSE response, no downstream bytes may be written. The proxy must keep buffering the full response so existing failure classification, path suspension, response adaptation, and fallback attempts continue to work.
- Once downstream streaming bytes have been written, the current request cannot fall back to another channel. Any later upstream or write error must end the downstream response if it is not already ended.
- Electron net request headers must drop Chromium-restricted, browser-managed, and hop-by-hop request headers before `ClientRequest.setHeader()`, including `Host`, `Content-Length`, `Connection`, `Transfer-Encoding`, `Upgrade`, `Trailer`, `TE`, `Keep-Alive`, `Proxy-Connection`, `Cookie`, `Cookie2`, `Accept-Encoding`, `Origin`, `Referer`, `Expect`, `Date`, `DNT`, `Via`, `Permissions-Policy`, and `Sec-*` / `Proxy-*` headers; passing them through can fail before upstream I/O with `net::ERR_INVALID_ARGUMENT`.
- `routing.server.upstreamProxyUrl` is upstream-only. It must affect requests from the local route proxy to the selected upstream site, not the local listener host/port and not CLI clients connecting to `127.0.0.1`.
- `normalizeProxyUrl()` accepts bare `host:port` as `http://host:port`, supports `http`, `https`, `socks4`, and `socks5` schemes for Electron net sessions, and rejects unsupported schemes.
- The axios fallback in `httpRawRequest()` may use only `http` / `https` proxy configuration; SOCKS proxy support is owned by the Electron net path.
- `sortChannelsByScore()` must order candidates by:
  1. `sitePriority` ascending (`0` before `1`)
  2. stable `siteId` tie-breakers when two channels still share the same explicit site priority
  3. `apiKeyPriority` ascending
  4. `apiKeyOrder` ascending
  5. `originalModelIndex` ascending
  6. health score and stable tie-breakers
- Canonical-model channel resolution must treat `displayItem.priorityConfig.sitePriorities` as the sole source of site ordering semantics. If a current source has no explicit saved site priority yet, assign it a synthetic priority after the highest explicit site priority for that display item, preserving current source discovery order only for those missing-priority additions.
- Canonical-model channel resolution must treat `displayItem.priorityConfig.apiKeyPriorities` as the source of API key ordering semantics. If a current API key under a site has no explicit saved priority yet, assign it a synthetic priority after the highest explicit API key priority already saved for that site, preserving current discovery order only among those missing-priority additions.
- Canonical-model channel resolution must skip any site listed in `displayItem.priorityConfig.disabledSiteIds` and any API key listed in `displayItem.priorityConfig.disabledApiKeyPriorityKeys`. Disabled site/API-key ids are route-intent exclusions, not low-priority candidates.
- When `routing.modelRegistry` contains any routing data (`sources`, `entries`, or `displayItems`), `resolveChannels(rule, canonicalModel)` must not fall back to generic site/account/API-key channels if `canonicalModel` has no registry entry. Unknown requested models such as a Gemini CLI default path model must produce no candidates instead of being forwarded through an unrelated site.
- `RouteModelDisplayItem.runtimeConfig` owns per-redirection runtime behavior. Missing fields normalize to `maxAttemptsPerRoutePath = 1`, `successRateWindowMinutes = 5`, `disableDurationMinutes = 30`, and `minSuccessRate = 0.8`.
- `handleRequest()` must resolve `RouteRuntimeConfig` from the matched canonical model's display item and pass `runtimeConfig.maxAttemptsPerRoutePath` into `buildChannelAttemptPlan(sortChannelsByScore(channels), ...)`.
- Successful route path affinity is derived from existing `routing.routePathStates`, not a separate preferred-path pointer. A candidate is eligible only when its route path state has `lastOutcome === 'success'`, `lastSuccessAt` is within `ROUTE_SUCCESSFUL_PATH_AFFINITY_MS`, and `disabledUntil` is not active.
- `handleRequest()` must apply successful path affinity after normal priority sorting, after `buildChannelAttemptPlan(..., maxAttemptsPerRoutePath)`, and after disabled-path filtering. Affinity may reorder the bounded candidate plan but must not add attempts or bypass `maxAttemptsPerRoutePath`.
- `applySuccessfulRoutePathAffinity()` must promote the most recently successful eligible path to the front, then preserve circular fallback order from that path's original position: promoted path, later candidates, then earlier candidates. If no eligible successful state exists or the eligible path is already first, keep the input order unchanged.
- Gemini CLI may send path-only requests for its own helper/default model even when the user has
  selected another model in the app. Gemini CLI 0.41.2 binds multiple internal utility model configs
  (`classifier`, `prompt-completion`, `fast-ack-helper`, `edit-corrector`, `summarizer-default`,
  `summarizer-shell`, and `chat-compression-2.5-flash-lite`) to `gemini-2.5-flash-lite`; this is
  distinct from the user-selected chat model such as `gemini-3.1-pro-preview`.
- If the extracted Gemini path model is a known Gemini CLI internal utility/fallback model
  (`gemini-2.5-flash-lite`, `gemini-2.5-flash`, or `gemini-2.5-pro`), has no matching rule, differs
  from `routing.cliModelSelections.geminiCli`, and
  `routing.server.blockGeminiCliInternalUtilityRequests !== false`, `handleRequest()` must return
  HTTP `400` with `gemini_cli_internal_utility_blocked` before selected-model fallback. This prevents
  CLI idle/helper traffic from being silently billed through the app-selected model.
- If the extracted Gemini path model has no matching rule, is not blocked by the internal utility
  guard, and `routing.cliModelSelections.geminiCli` has a configured model whose rule matches,
  `handleRequest()` may route the request using that selected canonical model while preserving the
  extracted path model as `requestedModel` in logs. This prevents retry loops where Gemini repeatedly
  calls a non-terminal default path and the proxy returns `no_matching_rule`.
- `no_matching_rule` uses HTTP `502`, and Gemini CLI treats 5xx responses as retryable for utility
  calls. Do not rely on `502` to stop internal helper retries; route through the selected CLI model
  rule when safe, or return an explicitly non-retryable CLI-native error only for intentional
  terminal states.
- `handleRequest()` must filter candidates with `isRoutePathDisabled()` before upstream forwarding.
- `handleRequest()` must re-check `isRoutePathDisabled()` inside the attempt loop before every upstream forwarding attempt. If an earlier attempt in the same request records a failure and suspends that route path, any remaining pre-planned attempts for the same path must be skipped. If no planned route path remains enabled, respond `400` with a CLI-native `all_route_paths_disabled` error shape instead of forwarding again, falling through to `all_channels_failed`, or returning a retriable `503`.
- `handleRequest()` must treat any upstream non-2xx/3xx status as a route path `failure`; otherwise a `400`/`422` from one key can short-circuit fallback and prevent later API keys from being tried.
- For AnyRouter sites, `handleRequest()` must route CLI requests through `anyrouter-request-rewriter.ts` using protocol-specific behavior:
  - Claude Code targets `/v1/messages?beta=true`, uses Anthropic-style `x-api-key`, preserves native Claude Code request fields such as `system`, `tools`, `tool_choice`, `stop_sequences`, `temperature`, and `metadata`, and adds the required `anthropic-beta` plus `metadata.user_id` Claude Code fingerprint fields.
  - Codex keeps the native Responses API path/auth/response shape and does not inject AnyRouter hash data.
  - Gemini CLI keeps the native Gemini path/auth/response shape; route path rewriting still owns model and query-key replacement.
  Non-AnyRouter sites keep their native CLI protocol and path behavior.
- When a channel's configured `targetProtocol` is not native-equivalent for the current CLI,
  `handleRequest()` must route the request through `cli-protocol-adapter.ts` before upstream
  forwarding and convert the upstream response back to the caller's native CLI protocol.
- `cli-protocol-adapter.ts` must throw `CliProtocolAdapterError` (not silently pass the source
  body through) when `adaptRequestToTargetProtocol()` cannot parse or normalize the request body.
  The error must carry `stage` ∈ {`request-adapt`, `response-adapt`}, source `cliType`,
  `targetProtocol`, and a short `reason` code.
- `handleRequest()` must wrap `adaptRequestToTargetProtocol()` and
  `transformTargetProtocolResponse()` in try/catch. On failure before response bytes are written,
  it must mark the current route path failed, record the outcome, and continue to the next planned
  channel. On failure after streaming bytes have been written it must terminate the response
  without retry.
- `handleRequest()` adapter and upstream failure logs must include the fields
  `{ stage, cliType, sourceEndpoint, targetProtocol, targetEndpoint, siteId, accountId, apiKeyId,
  resolvedModel }` plus a `reason` or `error` string. `stage` ∈ {`request-adapt`, `upstream`,
  `response-adapt`}. `sourceEndpoint` is the local route proxy request pathname.
- Probe-lock metadata may be encoded as a `{unifiedApiKey}.probe.{base64url(payload)}` suffix on
  the route API key token. Implementations using this encoding still satisfy the "internal probe-
  lock metadata" contract as long as: the suffix is only accepted from loopback clients, parse
  failure is treated as an invalid key, `deleteAuthHeaders()` strips it before upstream
  forwarding, and the Gemini `?key=` query param is rewritten to the upstream key by
  `buildGeminiUpstreamPath()` so the lock never leaks.
- `RouteProbeLock` payloads must retain the tested route identity: `siteId`, `accountId`,
  `apiKeyId`, `cliType`, optional `probeRunId`, `canonicalModel`, `rawModel`, optional
  `targetProtocol`, and optional upstream base URL/key diagnostics. This lets the wrapper, proxy
  logs, and persisted CLI probe samples correlate one CLI execution with the exact route path under
  test.
- `notifyRouteProbeLockRequest(routeApiKey)` must fire when a parsed probe-lock request reaches the
  local route proxy. Real CLI wrapper tests subscribe through `subscribeRouteProbeLockRequest()` and
  must use that signal to avoid reporting a false "CLI did not connect to local proxy" diagnostic.
- Probe-lock terminal failures are deterministic failures for the current wrapper test, not general
  route health. `notifyRouteProbeLockTerminalFailure()` must cache the failure for 5 minutes by the
  full probe-lock route API key and notify subscribers. `clearRouteProbeLockTerminalFailure()` must
  clear the terminal-failure cache, first-upstream-result cache, and upstream-attempt budget for
  that token before a new wrapper run.
- Probe-lock first upstream results are the authoritative single generated-response facts for the
  current wrapper test. `recordRouteProbeLockFirstUpstreamResult()` must only keep the first real
  selected-model upstream result for the full route API key during the 5-minute window; later
  probe-limit responses must not overwrite it.
- The route proxy must notify a probe-lock terminal failure for non-loopback probe-lock traffic,
  CLI/target protocol mismatch, invalid route API key payloads, unavailable upstream credentials,
  upstream non-success status/body that is returned to the CLI, and thrown terminal aggregate
  failures such as `all_channels_failed`.
- When `getRouteProbeLockTerminalFailure(routeApiKey)` returns a cached failure, later requests with
  the same probe-lock token must short-circuit with the cached status/body instead of forwarding to
  upstream again. This keeps wrapper tests deterministic after the first terminal error is known.
- Probe-lock upstream forwarding has a single real upstream-attempt budget per full route API key for
  5 minutes. `consumeRouteProbeLockUpstreamAttempt(routeApiKey)` returns `true` only for the first
  attempt in that window; later attempts must return HTTP `400` with
  `X-Route-Proxy-Error: probe_lock_upstream_attempt_exhausted`.
- Gemini CLI internal utility/default requests that carry a probe-lock token must be blocked before
  upstream forwarding just like ordinary route traffic. The block is terminal for the wrapper run
  and must not consume the single upstream-attempt budget for the selected model request.
- `recordRoutePathOutcome()` must use `runtimeConfig.successRateWindowMinutes`, `runtimeConfig.disableDurationMinutes`, and `runtimeConfig.minSuccessRate` when resetting the health window and deciding whether to suspend a route path.
- `routing.cliProbe.latest` is a display and diagnostics cache only. Route candidate resolution must not use failed CLI probe samples from `routeProbe`, `siteManual`, or `legacyCache` to suppress sites, accounts, API keys, or original models. Runtime suppression is owned by `routePathStates`.
- Display item source keys are model selections, not a fixed account allowlist. Runtime and registry rebuilds must expand a selected original model to all current sources with that same `originalModel`, so newly added accounts under the same site are routable without recreating the redirect.
- Override-backed display items are compatibility projections, not a stronger source of truth than the saved overrides. When reconstructing a card from legacy data, merge `registry.entries[canonicalName].sources`, persisted `displayItem.sourceKeys`, and grouped override sources by `sourceKey`; never let a stale partial entry or stale display item replace the override group and drop other original models or custom CLI sources.
- The redirection editor save flow must persist the `RouteModelDisplayItem` before writing per-source mapping overrides. `RouteModelDisplayItem` is the routing/display unit, so a long multi-source save that is interrupted after some override writes must not leave the card stuck on the previous single-model `originalModelOrder`.
- `recordRoutePathOutcome()` counts only `success` and `failure` in the 5-minute health window; `neutral` preserves last outcome metadata but must not change `windowRequestCount`.
- A failing outcome disables the route path for 30 minutes only after at least two counted
  `success`/`failure` samples exist in the active health window and `successRate < 0.8`. The first
  failure after a manual recovery must stay enabled so the CLI receives the real upstream response
  instead of immediately falling back into `all_route_paths_disabled`.
- `resetRouteStats(ruleId?)` must clear both `routing.stats` and matching `routing.routePathStates`.
- `resetRoutePathStates(params?)` must clear only `routing.routePathStates`, never `routing.stats`. When `params.canonicalModel` is provided, clear every path state for that redirection card's canonical model. When `params.routeRuleId` is also provided, both filters must match.
- `route:get-config` must include `routePathStates` so the redirection UI can show active suspensions and enable the rule-scoped recovery button from current runtime state.
- `recordRouteRequest()` must broadcast the appended `RouteRequestLogItem` immediately over
  `route:request-log-appended` after it writes the in-memory request log. The debounced
  `route-overview` invalidation remains for dashboards and must not be the route-log page's live
  update mechanism.
- `window.electronAPI.route.onRequestLogAppended(callback)` is the renderer bridge for route log
  live updates. The route log page must merge pushed items by log `id` into its 200-row view instead
  of reloading `route:get-request-logs` for each `route-overview` notification.
- The redirection UI must display active path suspensions in the priority table's API-key row,
  appended inside the matching original model's parenthesized details. Do not append suspension
  labels to site names, API key names, or original model chips. Suspension tooltip/details may
  include the resolved model and runtime window.
- The redirection card must expose a rule/path recovery button when the card has active suspensions. Clicking it must call the route path-state reset IPC for the current card's `canonicalName`, refresh route config, and leave route statistics intact.

### 4. Validation & Error Matrix

| Case | Validation | Expected behavior |
|------|------------|-------------------|
| No matching rule | `matchRule()` returns null | Respond `502` with `error: 'no_matching_rule'`; do not record route path state because no path exists |
| No channels | resolved rule has no candidate channel | Respond `503` with `error: 'no_channels'` |
| Unknown canonical with active registry | `resolveChannels(rule, 'gemini-2.5-flash-lite')` and registry already has sources/display items but no `gemini-2.5-flash-lite` entry | Return no channels; do not use generic channels from unrelated sites such as `nhh` |
| Gemini internal utility guard enabled | request path extracts `gemini-2.5-flash-lite`, `cliModelSelections.geminiCli = 'gemini-3.1-pro-preview'`, no explicit `gemini-2.5-flash-lite` rule matches, and `blockGeminiCliInternalUtilityRequests !== false` | Respond `400` with `gemini_cli_internal_utility_blocked`; do not resolve channels or forward upstream |
| Gemini helper/default path model has no rule and guard is disabled | request path extracts a helper/default model, `cliModelSelections.geminiCli = 'gemini-3.1-pro-preview'`, the selected model has a matching rule, and `blockGeminiCliInternalUtilityRequests === false` | Match and route through `gemini-3.1-pro-preview`; keep `requestedModel` as the extracted path model for diagnostics |
| Gemini internal utility request fails before fallback | Gemini CLI 0.41.2 utility request for `classifier`, `prompt-completion`, `fast-ack-helper`, `edit-corrector`, `summarizer-*`, or chat compression reaches the proxy as `gemini-2.5-flash-lite` | Treat the path model as transport evidence, not user intent; prefer non-retryable blocking when billing avoidance is enabled, otherwise use selected-model fallback if available and never send it through unrelated generic channels |
| Gemini helper request receives `502 no_matching_rule` | proxy returns retriable 5xx before a route path exists | Expect Gemini CLI to retry and potentially flood route logs; this is a proxy classification/routing contract failure, not proof that the user selected `gemini-2.5-flash-lite` |
| All paths disabled | every planned route path has active `disabledUntil > now` | Respond `400` with a non-retryable CLI-native `all_route_paths_disabled` error shape |
| Path disabled during current request | first planned attempt fails, `recordRoutePathOutcome()` sets `disabledUntil`, and remaining planned attempts target only disabled route paths | Do not make another upstream request; respond `400` with a non-retryable CLI-native `all_route_paths_disabled` error shape |
| User resets current rule paths | renderer calls `resetRoutePathStates({ canonicalModel })` from a redirection card | Matching `routePathStates` are deleted, `stats` are preserved, redirection config is refreshed |
| Upstream TLS fails in Node but succeeds in CLI/Electron | route proxy forwarding | Forward with Electron net raw client before classifying the route attempt, preserving status/body/headers |
| Long upstream SSE stays active past `requestTimeoutMs` | upstream emits data chunks before each timeout interval | Keep the Electron raw request alive until `end`; do not abort only because total elapsed time exceeded `requestTimeoutMs` |
| Transparent streaming request receives successful SSE | original request is streaming, adapters are transparent, upstream status is `2xx/3xx`, and `content-type` includes `text/event-stream` | Write downstream headers immediately with hop-by-hop/content-length headers stripped, forward each chunk as it arrives, retain the complete body for analytics, then end the downstream response |
| Streaming request receives failed SSE | upstream status is not classified as `success` | Do not write downstream bytes; buffer the body, record failure, suspend/update the path, and try the next enabled channel when available |
| Streaming request requires response adaptation | AnyRouter or protocol response adapter is not `transparent` | Do not stream passthrough; buffer the full body and run the normal response adaptation path before writing downstream |
| Upstream proxy configured | `routing.server.upstreamProxyUrl = 'http://127.0.0.1:7890'` | Only upstream forwarding uses that proxy; local CLI clients still connect directly to the route proxy |
| Unsupported upstream proxy scheme | `normalizeProxyUrl()` returns `undefined` | Treat as no explicit upstream proxy instead of passing invalid proxy rules to Electron |
| AnyRouter Codex route | request path is `/v1/responses` and selected site is AnyRouter | Keep `/v1/responses` and Bearer auth, clean `[undefined]`, do not inject hash-derived fields, and return upstream Responses API JSON/SSE transparently |
| AnyRouter Claude Code route with tools | request path is `/v1/messages`, selected site is AnyRouter, and body includes `tools` / `tool_choice` | Keep the Claude Code tool schema and request controls in the upstream body, add `metadata.user_id` and required beta headers, and stream the upstream Anthropic SSE transparently |
| AnyRouter Gemini route | request path is `/v1beta/models/{model}:generateContent` or `:streamGenerateContent` and selected site is AnyRouter | Keep native Gemini protocol, rewrite only the path model/query API key through `buildGeminiUpstreamPath()`, and return upstream Gemini JSON/SSE transparently |
| Explicit target protocol adaptation | channel `targetProtocol` differs from the CLI's native-equivalent upstream protocol | Convert request/response via `cli-protocol-adapter.ts`; if conversion fails before bytes are written, the current path may fail and the proxy may try fallback paths |
| Upstream success | HTTP status classified as `success` | Record channel stats and route path state; clear future disable only after the existing disable expires |
| Recent successful path exists | bounded enabled plan is `A, B, C, D`, and `C` has the most recent successful `routePathStates` entry within 30 minutes | Attempt order becomes `C, D, A, B` for the current request |
| Stale, failed, or disabled success affinity | route path state is older than `ROUTE_SUCCESSFUL_PATH_AFFINITY_MS`, has `lastOutcome !== 'success'`, or has active `disabledUntil` | Ignore that state and keep normal candidate order unless another eligible successful path exists |
| Upstream failure | HTTP status outside 2xx/3xx or thrown error | Record failure, update the 5-minute success rate, and disable the path for 30 minutes only when at least two counted samples are below threshold |
| Custom runtime config | Display item has `runtimeConfig = { maxAttemptsPerRoutePath: 2, successRateWindowMinutes: 12, disableDurationMinutes: 45, minSuccessRate: 0.75 }` | Try each route path at most twice for the current request, then suspend failed low-success paths for 45 minutes when at least two samples in the 12-minute success-rate window are below 75% |
| Successful affinity with `maxAttemptsPerRoutePath = 1` | the same route path appears multiple times before affinity is applied | `buildChannelAttemptPlan()` removes extra entries first; affinity reorders only the bounded plan and does not create a second attempt for that route path |
| Neutral sample | non-forwarding/manual caller records `neutral` | Record state metadata without incrementing the success-rate denominator |
| Legacy config | `routePathStates` missing | Normalize to `{}` before reads and writes |
| Probe-lock reaches proxy | parsed probe-lock token and loopback client | Notify request subscribers before upstream forwarding so wrapper diagnostics know the CLI connected to the local proxy |
| Probe-lock from non-loopback client | parsed probe-lock token and remote address is not loopback | Return `403 probe_lock_forbidden`, notify terminal failure, and do not forward upstream |
| Probe-lock terminal failure already cached | same full probe-lock route API key within 5 minutes | Replay cached status/error without resolving another upstream route |
| Probe-lock first selected-model upstream attempt | `consumeRouteProbeLockUpstreamAttempt(routeApiKey) === true` | Allow exactly one real upstream forwarding attempt for that token |
| Probe-lock second selected-model upstream attempt | same full route API key within the 5-minute attempt window | Return `400` with `X-Route-Proxy-Error: probe_lock_upstream_attempt_exhausted`; do not call upstream |
| Probe-lock Gemini internal utility request | helper/default raw model differs from the locked selected raw model | Return non-retryable internal utility block before upstream forwarding and notify terminal failure |

### 5. Good/Base/Bad Cases

- Good: priority `0` site with API keys `A`, `B` is tried as `site0/A -> site0/B -> site1/...`; score cannot move `site1` ahead of an enabled `site0` path.
- Good: if a display item already saved `site-1 => 4` and `site-2 => 9`, then a newly discovered `site-3` with no saved priority must be tried after both as synthetic priority `10`, not by falling back to its `siteOrder`.
- Good: if `site-1` already saved API key priorities `key-b => 9`, then newly discovered `key-a` and `key-c` under the same site must be appended as synthetic priorities `10` and `11` in their current source order.
- Good: a redirect card with `maxAttemptsPerRoutePath = 2` may try `site0/A` twice before moving to `site0/B`, but the same card with the default value tries each path once.
- Good: if `site2/keyC` was the most recent successful enabled path in the last 30 minutes, the next matching request starts with `site2/keyC`, then continues with candidates after its original position before wrapping to earlier priority candidates.
- Good: if `site0/A` fails and is suspended during the first attempt, the second pre-planned `site0/A` attempt is skipped; route proxy either moves to the next enabled path or returns `all_route_paths_disabled`.
- Good: a card-level "restore paths" action for `claude-opus-4-6` clears suspended path states whose `canonicalModel` is `claude-opus-4-6` without clearing success/failure counters.
- Good: a redirect card with `successRateWindowMinutes = 12` resets its success-rate denominator after 12 minutes, not after the default 5-minute window.
- Good: a Codex route configured with `openai-chat-completions` sends `/v1/chat/completions`
  upstream while still returning native Responses API shape to Codex.
- Good: a native CLI SSE route that receives one chunk every 30 seconds may run longer than the configured 60-second request timeout without being aborted by `electronFetchRaw()`.
- Good: a native transparent Codex SSE route writes `text/event-stream` headers and forwards each `data:` chunk before the upstream stream ends.
- Good: the first streaming upstream returns `503 text/event-stream`; the proxy buffers that failed body, writes nothing to the client, marks the path failed, and streams chunks from the second successful channel.
- Good: an AnyRouter Claude Code route preserves the source `tools` array while adding `metadata.user_id`; the model can still emit tool_use events and the CLI does not terminate as a plain chat response.
- Good: a real CLI wrapper sends a probe-lock token, the route proxy observes the request, the first
  selected-model upstream attempt returns `401`, and the wrapper terminates early from the
  terminal-failure notification instead of waiting for process timeout.
- Good: if the first selected-model upstream attempt returns a successful response containing the
  expected probe answer, later CLI auxiliary/retry traffic that hits
  `probe_lock_upstream_attempt_exhausted` does not change the wrapper result to failure.
- Good: a repeated request with the same probe-lock token within 5 minutes replays the cached
  terminal failure and does not create a second paid upstream request.
- Base: a path fails once in an empty 5-minute window; success rate is `0%`, but the path remains
  enabled until another counted sample confirms the low-success window.
- Base: a CLI exits without any observed probe-lock request; the wrapper reports the local-proxy
  connectivity diagnostic because no request subscriber fired.
- Bad: the same site/account/key/model path appears multiple times because several sources produce it; the attempt planner must keep only one attempt for that path in the current request.
- Bad: applying successful path affinity before `buildChannelAttemptPlan()` can resurrect duplicate attempts and make `maxAttemptsPerRoutePath = 1` ineffective.
- Bad: a disabled path remains visible as a warning in the UI but must not be forwarded to until `disabledUntil` expires.
- Bad: a stale display item has `sourceKeys` for only `site-1/acc-1/raw-a` while `site-1/acc-2/raw-a` now exists. The route resolver must include both accounts because the selected unit is `raw-a`.
- Bad: a legacy override-backed card has overrides for `gpt-5-latest` and custom CLI `duckcoding`, while `registry.entries['mixed-route'].sources` or the persisted display item still contains only `gpt-5-latest`. The UI must show both original models and both source groups by unioning entry, display-item, and override sources, not by trusting the stale projection alone.
- Bad: a Gemini CLI request for `gemini-2.5-flash-lite` has no model redirection entry, but a wildcard Gemini route causes `buildGenericChannels()` to forward it through the first active site.
- Bad: a Gemini CLI helper/default path model has no matching rule, while the app-selected Gemini
  CLI model does have a rule, and the proxy still returns `502 no_matching_rule`; Gemini CLI can
  retry this forever and flood route logs.
- Bad: interpreting repeated `gemini-2.5-flash-lite` requests from Gemini CLI as a changed user
  model selection without checking whether the request is an internal utility call.
- Bad: implementing `electronFetchRaw()` with one fixed `setTimeout()` from request start, which can abort a healthy long-running SSE stream and make CLI conversations end without an upstream error body.
- Bad: using the buffered `httpRawRequest()` path for successful SSE responses, which makes the CLI receive nothing until upstream `end` and can look like a stalled or abruptly ended conversation.
- Bad: writing a failed upstream SSE chunk to the downstream response before classifying status, because fallback becomes impossible after bytes are sent.
- Bad: rebuilding an AnyRouter Claude Code request from only `model/messages/system/metadata`, because this drops Claude Code tool definitions and can make the CLI session end even though the upstream returned a successful SSE response.
- Bad: letting a probe-lock wrapper test retry the same selected model through upstream multiple
  times after the first deterministic failure, which wastes quota and hides the original failure
  reason.
- Bad: reporting "CLI did not connect to local proxy" after the request observer fired, because that
  turns a real upstream/auth failure into a misleading local configuration diagnosis.

### 6. Tests Required

- `src/__tests__/route-proxy-service.test.ts`: assert one attempt per route path while preserving distinct API keys and sites.
- `src/__tests__/route-proxy-service.test.ts`: assert recent successful path affinity promotes the most recently successful eligible path and preserves circular fallback order.
- `src/__tests__/route-proxy-service.test.ts`: assert stale, failed, and disabled route path states are ignored for successful path affinity.
- `src/__tests__/route-proxy-service.test.ts`: assert affinity is applied after `maxAttemptsPerRoutePath` bounding and does not add duplicate attempts.
- `src/__tests__/route-proxy-service.test.ts`: assert `handleRequest()` uses the affinity-reordered plan while still falling back to later and then earlier candidates in the same request.
- `src/__tests__/route-proxy-service.test.ts`: assert a failure that disables the current route path prevents remaining pre-planned attempts for that disabled path from making another upstream request.
- `src/__tests__/route-proxy-service.test.ts`: assert OpenAI-compatible paths are preserved and Gemini native paths replace the model segment and query API key before upstream forwarding.
- `src/__tests__/route-proxy-service.test.ts`: assert an unmatched Gemini CLI internal
  utility/fallback raw model returns non-retryable `400 gemini_cli_internal_utility_blocked` by
  default, without resolving channels or forwarding upstream.
- `src/__tests__/route-proxy-service.test.ts`: assert disabling the Gemini internal utility guard
  allows a Gemini path-only raw model with no matching rule to fall back to the configured Gemini CLI
  model rule and rewrite the upstream Gemini path to the selected model.
- `src/__tests__/unified-config-manager.test.ts`: assert `resetRoutePathStates({ canonicalModel })` deletes only matching path states and preserves `stats`.
- `src/__tests__/route-workbench-redesign.test.tsx`: assert the card-level recovery button calls the reset action for the current card's `canonicalName`.
- `src/__tests__/anyrouter-rewriter.test.ts`: assert AnyRouter Claude Code request rewrites to `/v1/messages?beta=true` with Anthropic beta headers, Codex native Responses requests keep `/v1/responses` without hash injection, and Gemini native requests remain transparent.
- `src/__tests__/route-proxy-service.test.ts`: assert explicit non-native target protocols invoke
  protocol adaptation and still preserve CLI-native downstream response handling.
- `src/__tests__/electron-fetch.test.ts`: assert upstream proxy URL normalization for bare `host:port`, supported proxy schemes, and unsupported schemes.
- `src/__tests__/electron-fetch.test.ts`: assert raw Electron forwarding skips Chromium-managed Gemini CLI browser headers while preserving upstream auth and API client headers.
- `src/__tests__/electron-fetch.test.ts`: assert active raw streaming responses re-arm the timeout after each data chunk and are not aborted only because total elapsed time exceeds the timeout.
- `src/__tests__/electron-fetch.test.ts`: assert `electronFetchRawStream()` calls `onResponse`/`onData` in streaming order while retaining the complete response body.
- `src/__tests__/http-client.test.ts`: assert raw forwarding uses Electron net when requested and passes `proxyUrl` through to `electronFetchRaw()`.
- `src/__tests__/http-client.test.ts`: assert raw streaming uses Electron net when requested and passes `proxyUrl`, `onResponse`, and chunk callbacks through to `electronFetchRawStream()`.
- `src/__tests__/anyrouter-timeout.test.ts`: assert AnyRouter site detection accepts `Any Router`, `AnyRouter`, repeated spaces, hyphens, and underscores while rejecting prefixed/suffixed names.
- `src/__tests__/route-proxy-service.test.ts`: assert transparent successful SSE route requests use `httpRawStreamRequest()`, write headers before chunks, strip `content-length`/`transfer-encoding`, and record analytics from the retained body.
- `src/__tests__/route-proxy-service.test.ts`: assert failed SSE upstream responses are buffered without downstream writes and fallback attempts can still stream successful chunks.
- `src/__tests__/route-proxy-service.test.ts`: assert Claude Code requests routed through AnyRouter preserve tool schemas and request controls in the upstream body while streaming Anthropic SSE, including bounded initial timeout and the 10-minute active stream idle timeout floor.
- `src/__tests__/anyrouter-rewriter.test.ts`: assert Claude Code AnyRouter rewrite preserves native tool/request fields and only injects/overrides the required AnyRouter fields.
- `src/__tests__/route-stats-service.test.ts`: assert 5-minute success-rate tracking and 30-minute disable state.
- `src/__tests__/route-stats-service.test.ts`: assert custom `successRateWindowMinutes`, `disableDurationMinutes`, and `minSuccessRate` change suspension behavior.
- `src/__tests__/route-workbench-redesign.test.tsx`: assert redirection cards show path suspension, priority dialog shows balance/ratio/probe status, route-rule dialog saves `runtimeConfig`, and reset defaults calls rebuild with `{ resetDefaults: true }`.
- `src/__tests__/logs-page.test.tsx`: assert pushed `route:request-log-appended` items are added to
  the route log list without another `route:get-request-logs` snapshot fetch.
- `src/__tests__/route-workbench-redesign.test.tsx`: assert override-backed display reconstruction preserves every grouped override source even when `registry.entries[canonicalName].sources` or the persisted display item is stale or partial, and assert editor save persists the display item before per-source overrides.
- `src/__tests__/route-model-registry-service.test.ts`: assert the seeded `claude-opus-4-6` display item maps to the current raw opus source after default reset.
- `src/__tests__/route-model-registry-service.test.ts`: assert an unknown requested model does not resolve to generic channels when model registry routing data exists, while an empty legacy registry can still use generic routing.
- `src/__tests__/route-model-registry-service.test.ts`: assert missing site priorities append after the highest explicit site priority and missing API key priorities append after the highest explicit site-level API key priority.
- `src/__tests__/unified-config-manager.test.ts`: assert route selections normalize aliases and route rules are ensured for selected CLI models.
- `src/__tests__/route-proxy-service.test.ts`: assert non-loopback probe-lock requests notify a
  terminal failure and return `403 probe_lock_forbidden` without upstream I/O.
- `src/__tests__/route-proxy-service.test.ts`: assert cached probe-lock terminal failures
  short-circuit later requests with the same route API key for the 5-minute TTL.
- `src/__tests__/route-proxy-service.test.ts`: assert a probe-lock token can consume only one real
  selected-model upstream attempt and later attempts return
  `probe_lock_upstream_attempt_exhausted` without overwriting the first upstream result.
- `src/__tests__/route-proxy-service.test.ts`: assert probe-lock Gemini internal utility requests
  are blocked before upstream forwarding and do not consume the selected-model attempt budget.
- `src/__tests__/cli-wrapper-compat-service.test.ts`: assert the wrapper aborts/returns promptly
  when `subscribeRouteProbeLockTerminalFailure()` receives a deterministic proxy failure.
- `src/__tests__/cli-wrapper-compat-service.test.ts`: assert an observed probe-lock request prevents
  the false "CLI did not connect to local proxy" diagnostic.
- `src/__tests__/cli-wrapper-compat-service.test.ts`: assert a successful first probe-lock upstream
  response remains a successful wrapper result even when later CLI traffic exceeds the probe-lock
  request budget.

### 7. Wrong vs Correct

#### Wrong

```ts
// Groups attempts only by resolved model, so a high-priority site's second API key can be skipped.
buildChannelAttemptPlan(sortChannelsByScore(channels), routing.server.retryCount + 1);
```

#### Correct

```ts
// Groups attempts by full route path, removes disabled paths, then applies short-lived success affinity.
const boundedChannels = buildChannelAttemptPlan(sortChannelsByScore(channels), 1).filter(
  channel => !isRoutePathDisabled(channel)
);
const sortedChannels = applySuccessfulRoutePathAffinity(boundedChannels, routing.routePathStates);
```

#### Wrong

```ts
// Reintroducing site-name-specific protocol branches couples routing to an upstream alias.
if (site.name === 'special upstream') {
  // ...
}
```

#### Correct

```ts
// Protocol adaptation is driven only by the channel's configured target protocol.
if (!isCliTargetProtocolNativeEquivalent(cliType, activeChannel.targetProtocol ?? 'native')) {
  const rewritten = adaptRequestToTargetProtocol(
    finalBody,
    cliType,
    activeChannel.targetProtocol!,
    req.url,
    ch.resolvedModel
  );
  methodOverride = rewritten.upstreamMethod;
  requestUrlOverride = rewritten.upstreamPath;
  protocolResponseAdapter = rewritten.responseAdapter;
}
```

#### Wrong

```ts
const timeoutId = setTimeout(() => {
  request.abort();
  reject(new Error(`Request timeout after ${timeout}ms`));
}, timeout);
```

#### Correct

```ts
const armIdleTimeout = () => {
  clearRequestTimeout();
  timeoutId = setTimeout(() => {
    request.abort();
    rejectOnce(new Error(`Request timeout after ${timeout}ms`));
  }, timeout);
};

request.on('response', response => {
  armIdleTimeout();
  response.on('data', chunk => {
    armIdleTimeout();
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
});
```

#### Wrong

```ts
// Buffers a successful SSE response until upstream end, so the CLI cannot consume tokens as they arrive.
const result = await httpRawRequest(target.url, requestConfig);
res.writeHead(result.statusCode, result.headers);
res.end(result.body);
```

#### Correct

```ts
// Stream only transparent successful SSE responses; keep failures buffered for fallback.
const result = await httpRawStreamRequest(target.url, {
  ...requestConfig,
  onResponse: upstreamResponse => {
    if (classifyRouteStatusCode(upstreamResponse.status) !== 'success') return false;
    if (!isEventStreamResponse(upstreamResponse.headers)) return false;

    res.writeHead(upstreamResponse.status, buildStreamingResponseHeaders(upstreamResponse.headers));
    return true;
  },
  onChunk: chunk => writeResponseChunk(res, chunk),
});
```

## Scenario: Claude Count Tokens Fallback And Usage Accounting

### 1. Scope / Trigger

- Trigger: Claude Code may call `/v1/messages/count_tokens` before the real `/v1/messages` request, but many proxy/newapi-compatible upstream sites support `/v1/messages` while returning `404` or `403` for `/v1/messages/count_tokens`.
- This contract spans `src/main/route-proxy-service.ts`, `src/main/route-stats-service.ts`, `src/main/route-analytics-service.ts`, `src/main/anyrouter-request-rewriter.ts`, and `src/__tests__/route-proxy-service.test.ts`.
- `count_tokens` is a preflight input-token estimate. It must not be treated as the same signal as post-response `usage` extracted from the real generation response.
- Unsupported `count_tokens` support is a route endpoint capability state. It is persisted separately from route path health so later preflight calls can skip the known-unsupported upstream endpoint without degrading normal `/v1/messages` generation routing.

### 2. Signatures

```ts
// src/main/route-proxy-service.ts
export interface RouteUsageStats {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
  cachedTokens?: number;
}

export function extractUsageFromBody(body: Buffer): RouteUsageStats | undefined;

export function estimateClaudeCountTokens(body: Buffer): {
  input_tokens: number;
  estimated: true;
  method: 'local';
};

// src/shared/types/route-proxy.ts
export type RouteEndpointCapabilityName = 'claude_messages_count_tokens';

export interface RouteEndpointCapabilityState {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  endpoint: RouteEndpointCapabilityName;
  status: 'unsupported';
  reason?: string;
  statusCode?: number;
  lastError?: string;
  firstObservedAt: number;
  lastObservedAt: number;
  updatedAt: number;
}

export function buildRouteEndpointCapabilityKey(params: {
  siteId: string;
  accountId: string;
  apiKeyId: string;
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  endpoint: RouteEndpointCapabilityName;
}): string;

// src/main/route-stats-service.ts
export function isRouteEndpointUnsupported(
  key: RouteChannelKey & { cliType: RouteCliType; targetProtocol?: CliTargetProtocol },
  endpoint: RouteEndpointCapabilityName
): boolean;

export function recordRouteEndpointUnsupported(
  key: RouteChannelKey & { cliType: RouteCliType; targetProtocol?: CliTargetProtocol },
  endpoint: RouteEndpointCapabilityName,
  meta?: { statusCode?: number; error?: string; reason?: string },
  now?: number
): Promise<RouteEndpointCapabilityState>;
```

### 3. Contracts

- `/v1/messages/count_tokens` is request-preflight behavior. If an upstream returns an explicit unsupported-endpoint response such as `404 Invalid URL (POST /v1/messages/count_tokens)` or `403 count_tokens is not enabled`, the route proxy must not continue failing through unrelated generation channels just to answer the count request.
- The accepted fallback for unsupported `count_tokens` is local estimation only. Do not fallback `count_tokens` to a different upstream provider, and do not send a synthetic `max_tokens: 1` real generation request unless a future user-facing setting explicitly opts into that cost.
- A local `count_tokens` fallback response must preserve the Anthropic-compatible shape:

```json
{ "input_tokens": 1234 }
```

- Local estimates must be marked internally as estimated for analytics/debugging. They must not be used as final billing or usage truth when a later `/v1/messages` response includes real `usage`.
- The real `/v1/messages` response `usage` is the authoritative route token accounting source. `extractUsageFromBody()` must continue to parse JSON and SSE usage fields, including Anthropic `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, OpenAI-style `prompt_tokens` / `completion_tokens`, and Gemini `usageMetadata`.
- `count_tokens` unsupported responses are endpoint-capability failures, not model or route-path failures. They must not lower the health score for normal `/v1/messages` generation on the same site/account/API key.
- Once a site/account/API-key/custom-CLI target is known not to support `claude_messages_count_tokens`, later Claude Code `/v1/messages/count_tokens` requests for the same `siteId + accountId + apiKeyId + cliType + targetProtocol + endpoint` must return the local estimate directly without calling upstream or trying later route candidates.
- Non-Anthropic target protocols such as OpenAI Responses or chat completions cannot answer Anthropic `count_tokens`; mark that target as `target_protocol_unsupported` and use the local estimate.
- AnyRouter selected-channel rewriting must not turn `/v1/messages/count_tokens` into a real `/v1/messages` generation request. AnyRouter count-token requests must pass through to `/v1/messages/count_tokens` unless that exact upstream response proves the endpoint is unsupported.
- AnyRouter special rewriting remains selected-channel behavior only. Do not introduce an implicit AnyRouter fallback for `count_tokens`; if the selected route path is not usable for count preflight, use the local estimator.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| Upstream supports `/v1/messages/count_tokens` | proxy -> upstream | return upstream `input_tokens` response |
| Upstream returns count-token `404` unsupported endpoint | proxy endpoint handling | return local estimated `{ input_tokens }`; do not mark `/v1/messages` path unhealthy |
| Upstream returns count-token `403 count_tokens is not enabled` | proxy endpoint handling | return local estimated `{ input_tokens }`; do not try unrelated generation fallbacks |
| Later request hits cached unsupported count-token capability | endpoint capability cache | return local estimated `{ input_tokens }` without resolving credentials or calling upstream |
| Custom CLI target protocol is OpenAI-compatible | endpoint capability cache | mark `target_protocol_unsupported`; return local estimated `{ input_tokens }` |
| AnyRouter supports `/v1/messages/count_tokens` | selected-channel passthrough | forward the original count-token endpoint; do not force local estimation |
| Real `/v1/messages` response contains `usage` | response analytics | record real usage values; prefer them over any earlier estimate |
| Real `/v1/messages` response lacks `usage` | response analytics | keep usage undefined rather than fabricating final billing data |
| AnyRouter is first route path | selected-channel rewrite | only selected AnyRouter channels get AnyRouter rewrite; unsupported count preflight still uses local estimate |

### 5. Good/Base/Bad Cases

- Good: Claude Code asks `/v1/messages/count_tokens`, the selected upstream returns `404 Invalid URL`, and the proxy responds immediately with a conservative local `{ input_tokens }` estimate without trying every fallback site.
- Good: the next `count_tokens` call for the same site/account/API-key/custom-CLI target reads `routeEndpointCapabilities` and returns the local estimate without probing the unsupported upstream endpoint again.
- Good: the later `/v1/messages` response streams Anthropic `message_start` and `message_delta` usage chunks; route analytics records the real `input_tokens`, `output_tokens`, and cache token fields from the retained SSE body.
- Base: a non-streaming Claude response contains `usage`; route analytics records it from the JSON body.
- Bad: treating a `count_tokens` 404 as a route-path failure and disabling a site that can successfully serve `/v1/messages`.
- Bad: using local estimated `input_tokens` as the final token accounting value after real response `usage` is available.
- Bad: falling back from an unsupported `count_tokens` request to a different paid upstream provider, making count preflight depend on unrelated account balances and rate limits.

### 6. Tests Required

- `src/__tests__/route-proxy-service.test.ts`: assert `count_tokens` unsupported `404` returns a local Anthropic-compatible `{ input_tokens }` response.
- `src/__tests__/route-proxy-service.test.ts`: assert `count_tokens` unsupported `403` does not record a route-path failure for normal `/v1/messages`.
- `src/__tests__/route-proxy-service.test.ts`: assert no secondary upstream site is called after a known unsupported `count_tokens` response when local estimation is available.
- `src/__tests__/route-proxy-service.test.ts`: assert a cached unsupported endpoint marker short-circuits future `count_tokens` requests without upstream I/O.
- `src/__tests__/route-proxy-service.test.ts`: assert non-Anthropic custom CLI targets are marked local-only for Claude `count_tokens`.
- `src/__tests__/route-stats-service.test.ts`: assert endpoint capability state is keyed by site/account/API key/CLI/target protocol/endpoint and stays separate from route path disable state.
- `src/__tests__/route-proxy-service.test.ts`: assert real `/v1/messages` JSON and SSE `usage` remains the authoritative analytics source.
- `src/__tests__/route-proxy-service.test.ts`: assert local estimates are conservative and deterministic for the same request body.

### 7. Wrong vs Correct

#### Wrong

```ts
// Treats endpoint incompatibility as a broken generation channel.
if (pathname === '/v1/messages/count_tokens' && statusCode === 404) {
  await recordRoutePathOutcome(channel, 'failure', { statusCode });
  continue;
}
```

#### Correct

```ts
// Count-token unsupported is an endpoint capability gap; answer preflight locally.
if (pathname === '/v1/messages/count_tokens' && isUnsupportedCountTokensResponse(result)) {
  writeAnthropicCountTokensEstimate(res, estimateClaudeCountTokens(originalBody));
  return;
}
```

#### Wrong

```ts
// Uses a preflight estimate as final billing truth.
recordRouteRequest({ totalTokens: estimated.input_tokens });
```

#### Correct

```ts
// Final accounting comes only from real upstream response usage.
recordRouteRequest({
  promptTokens: result.usage?.promptTokens,
  completionTokens: result.usage?.completionTokens,
  totalTokens: result.usage?.totalTokens,
});
```

## Scenario: CLI Probe Run Grouping For Usability History

### 1. Scope / Trigger

- Trigger: site-management manual CLI tests and route CLI probes share `routing.cliProbe` history,
  and the route usability UI must render one history bar per detection run instead of one bar per
  tested model.
- This contract spans `src/shared/types/route-proxy.ts`,
  `src/main/route-cli-probe-service.ts`, `src/main/handlers/cli-compat-handlers.ts`,
  `src/renderer/store/routeStore.ts`, `src/renderer/services/cli-compat-sync.ts`, and
  `src/renderer/components/Route/Usability/CliUsabilityTab.tsx`.

### 2. Signatures

```ts
// src/shared/types/route-proxy.ts
export interface RouteCliProbeSample {
  sampleId: string;
  probeRunId?: string;
  probeKey: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  targetEndpoint?: string;
  canonicalModel: string;
  rawModel: string;
  success: boolean;
  source: RouteCliProbeSource;
  statusCode?: number;
  endpointPingMs?: number;
  firstByteLatencyMs?: number;
  totalLatencyMs?: number;
  error?: string;
  claudeDetail?: ClaudeTestDetail;
  codexDetail?: CodexTestDetail;
  geminiDetail?: GeminiTestDetail;
  testedAt: number;
}

export interface RouteCliProbeLatest {
  probeKey: string;
  siteId: string;
  accountId: string;
  cliType: RouteCliType;
  targetProtocol?: CliTargetProtocol;
  targetEndpoint?: string;
  canonicalModel: string;
  rawModel: string;
  healthy: boolean;
  lastSample: RouteCliProbeSample;
  lastSuccessAt?: number;
  lastFailureAt?: number;
}

export function buildProbeKey(
  siteId: string,
  accountId: string,
  cliType: RouteCliType,
  canonicalModel: string,
  targetProtocol?: CliTargetProtocol
): string;

// src/main/route-cli-probe-service.ts
export function generateProbeRunId(prefix?: string): string;
export function persistCliProbeSamples(samples: RouteCliProbeSample[]): Promise<void>;
export function runCliProbeNow(params?: {
  siteId?: string;
  accountId?: string;
  cliType?: RouteCliType;
}): Promise<{
  startedAt: number;
  finishedAt: number;
  totalSamples: number;
  successSamples: number;
  failureSamples: number;
}>;

// src/main/unified-config-manager.ts
export function persistRouteCliProbeSamples(
  samples: RouteCliProbeSample[],
  latestList: RouteCliProbeLatest[]
): Promise<void>;

// src/renderer/store/routeStore.ts
fetchCliProbeData(timeRange: '24h' | '7d', force?: boolean): Promise<void>;
```

### 3. Contracts

- `probeRunId` identifies a single generated CLI probe batch. All samples produced by one
  `runCliProbeNow()` call must use the same `route_*` id.
- All samples persisted by one `cli-compat:save-result` manual site-management test must use the
  same `manual_*` id.
- `buildProbeKey()` must include normalized `targetProtocol` in the key. The same
  `site/account/CLI/model` tested through native and adapted protocols must not overwrite each
  other's latest result.
- Route probe and manual site-management samples must preserve `targetProtocol`, `targetEndpoint`,
  protocol-specific detail (`claudeDetail`, `codexDetail`, `geminiDetail`), latency fields, status
  code, and error text in `RouteCliProbeSample.lastSample` so site management and route usability
  render the same diagnostics.
- Route probe execution must choose account API keys through shared `isApiKeyActive()` semantics and
  require a real `key` or `token` value. Unknown status is treated as usable for backward
  compatibility, while explicit inactive/disabled/revoked states are excluded.
- Route probe execution must build a probe-lock route API key with the same `probeRunId` that is
  stored on the produced samples. The proxy/wrapper failure path and persisted history must be
  correlatable by that run id.
- `persistCliProbeSamples(samples)` is the canonical writer for CLI probe samples. It must derive
  the corresponding `RouteCliProbeLatest[]` from the same sample list and call
  `unifiedConfigManager.persistRouteCliProbeSamples(samples, latestList)` once.
- `persistRouteCliProbeSamples(samples, latestList)` must update `routing.cliProbe.history` and
  `routing.cliProbe.latest`, prune history by `routing.cliProbe.config.retentionDays`, and persist
  the route probes sidecar through `saveRouteProbesState()`. It must not rewrite stable
  `config.json` or trigger a config backup for diagnostics-only samples.
- The route usability page is a 7-day surface. It should fetch `7d`, not use the previous `24h`
  default, and should not render a `24h` time-range option.
- `CliUsabilityTab` groups history bars by `probeRunId`. Samples without `probeRunId` are legacy
  data and are not required to participate in grouped history rendering.
- A grouped history bar color is derived from all samples in the group: all success is green, all
  failure is red, mixed success/failure is warning/orange.
- Grouped history tooltip content must list each model result in the run. Each per-model history
  summary must be truncated to 295 characters.
- The individual model row tooltip below the history bar remains the existing single-model tooltip
  path and should not adopt grouped tooltip formatting.
- The route usability page exposes timer controls in the app page header actions, not in a separate
  row above the matrix. The controls are the scheduled probe switch, the interval input, and the
  immediate probe button.
- The route usability interval input is an hour-based UI over the persisted
  `RouteCliProbeConfig.intervalMinutes` contract. New default config is `240` minutes, UI minimum is
  `2` hours / `120` minutes, and the existing `24` hour / `1440` minute upper bound is preserved.
- Route usability timer setting changes auto-save after a valid edit. The UI must not render a
  "save settings" button for this surface.
- Manual test persistence refreshes the route usability cache with `7d` so site management and route
  usability surfaces read the same latest `routing.cliProbe` state.
- `routing.cliProbe.latest` is the canonical latest-result source for CLI model test display across
  route usability and site management. A result must not be considered synchronized merely because
  the initiating page updated its own local state.
- Site-management CLI config dialogs must project `routing.cliProbe.latest` back into the matching
  configured test-model slots by `siteId`, `accountId`, `cliType`, and `canonicalModel`. A fresher
  route/site detection sample for that tuple must display in the dialog slot even if
  `cli_config.[cli].testResults` still contains an older manual-test result.
- Site-management manual CLI tests and route/site detection probes must be symmetric writers:
  manual tests update route usability latest/history, and route/site detection probes update the
  corresponding site-management CLI config dialog model result display.
- Summary projection and slot projection are separate consumers. Updating
  `cliCompatibility[storeKey]` for the site card does not satisfy the per-model dialog-slot
  contract.

### 4. Validation & Error Matrix

| Case | Boundary | Expected behavior |
|------|----------|-------------------|
| One route probe run tests multiple models | service -> persisted samples | every sample has the same `route_*` `probeRunId` |
| One manual site-management test saves multiple models | IPC handler -> persisted samples | every sample has the same `manual_*` `probeRunId` |
| Same model tested through different target protocols | sample keying | latest/history use distinct `probeKey` values because normalized `targetProtocol` is part of the key |
| Route probe sees API key with `status_str: 'disabled'` | API-key selection | exclude the key from execution even if numeric `status` is absent |
| Route probe sees legacy API key without status fields | API-key selection | treat availability as unknown/usable if a real key/token value exists |
| Probe samples are persisted | persistence boundary | update latest and history in one route-probes sidecar write; do not rewrite stable config |
| Probe history exceeds retention window | persistence boundary | prune old history entries during `persistRouteCliProbeSamples()` |
| New grouped history contains all successes | renderer history bar | one green bar for the run |
| New grouped history contains all failures | renderer history bar | one red bar for the run |
| New grouped history contains success and failure | renderer history bar | one warning/orange bar for the run |
| History sample lacks `probeRunId` | renderer history bar | legacy sample is not required to render as a grouped bar |
| Long model error/reply summary | renderer history tooltip | per-model summary is capped at 295 characters |
| User changes route usability interval to `6` | renderer -> config | auto-save persists `{ intervalMinutes: 360 }` |
| User enters an interval below `2` hours | renderer -> config | auto-save clamps to `120` minutes |
| Route usability page header renders controls | renderer layout | no separate settings row is rendered above the matrix, and no save button is visible |
| Manual test persists from site management | renderer sync | `fetchCliProbeData('7d', true)` refreshes the route usability cache |
| Manual test persists from site management | canonical cache -> site detection display | the matching route usability/site detection model row shows the manual result as latest |
| Route/site detection probe persists a newer sample | canonical cache -> site-management dialog | the matching CLI config dialog test-model slot shows the probe result as latest |
| Probe result targets another account or model | projection filter | the unrelated CLI config dialog slot remains unchanged |

### 5. Good/Base/Bad Cases

- Good: a Codex manual test for `gpt-4.1` and `gpt-4.1-mini` writes two samples with the same
  `manual_*` id; the Codex history track shows one mixed orange bar whose tooltip lists both
  models.
- Good: an immediate route probe over two accounts and three CLIs writes one `route_*` id for the
  whole run; each CLI/account cell groups the subset of samples visible in that cell by the same id.
- Good: a route/site detection probe for `site-1 / account-a / codex / gpt-4.1-mini` is newer than
  the dialog's persisted `testResults`; opening that site's Codex config dialog shows the newer
  success/failure beside the `gpt-4.1-mini` test-model selector.
- Good: a site-management manual test for the same tuple writes `source: siteManual`; the route
  usability row and history read it from `routing.cliProbe` without a separate compatibility cache.
- Good: native Codex Responses and adapted OpenAI chat-completions probes for the same canonical
  model write different `probeKey` values and keep separate latest diagnostics.
- Good: one manual test with three model samples updates route probe history/latest with a single
  sidecar save, so route usability and site-management dialog slots refresh from the same cache.
- Base: only one model is tested in a run; the grouped bar still renders as a single-sample group.
- Bad: grouping by timestamp buckets only. A slow sequential run can be split across buckets, while
  two separate runs close in time can be merged incorrectly.
- Bad: refreshing manual-test results with the stale `cliProbeTimeRange` when the UI no longer
  supports `24h`.
- Bad: projecting `routing.cliProbe.latest` only to `cliCompatibility[storeKey]` while the
  `UnifiedCliConfigDialog` initializes model slots solely from persisted `cli_config.testResults`.
- Bad: using `siteName` alone to match latest probe samples. Account-scoped sites must use account
  ids, and site-scoped entries must use the site-scoped probe account id helper.
- Bad: filtering active API keys with only `status === 1`; many current site payloads expose
  activity through `status_str`, `state`, or `enabled`.
- Bad: appending history and updating latest through separate writes, because a crash between writes
  can make route usability and site-management display disagree.

### 6. Tests Required

- `src/__tests__/route-cli-probe-service.test.ts`
  - Assert samples persisted from one `runCliProbeNow()` call share exactly one `probeRunId`.
  - Assert probe-lock route API keys carry the same `probeRunId` as the persisted samples.
  - Assert API key selection uses shared availability semantics and excludes explicit inactive
    status fields while preserving legacy unknown-status keys.
  - Assert target protocol participates in `probeKey` and same model/different protocol probes do
    not overwrite each other's latest result.
  - Assert `persistCliProbeSamples()` updates latest/history through one
    `persistRouteCliProbeSamples()` call.
- `src/__tests__/unified-config-manager.test.ts`
  - Assert `persistRouteCliProbeSamples()` writes route-probes sidecar state, prunes old history,
    and does not rewrite stable config for diagnostics-only samples.
- `src/__tests__/cli-usability-tab.test.tsx`
  - Assert the `24h` / `7d` toggle is absent from route usability.
  - Assert a shared `probeRunId` across two model samples renders one history bar.
  - Assert mixed results use warning/orange styling.
  - Assert grouped tooltip lists both models and truncates a long summary.
  - Assert header timer settings use hours, default to `4`, auto-save to minutes, and omit the save
    button.
- `src/__tests__/useCliCompatTest.test.ts` and
  `src/__tests__/unified-cli-config-dialog.test.tsx`
  - Assert manual test persistence refreshes route usability with `7d`.
  - Assert route/site detection probe results from `routing.cliProbe.latest` appear in the matching
    CLI config dialog test-model slot.
  - Assert manual dialog tests appear as latest in route usability for the same
    `siteId + accountId + cliType + model` tuple.
- Build:
  - `npm run build:main`
  - `npm run build:renderer`

### 7. Wrong vs Correct

#### Wrong

```ts
// Infers "same run" from timestamps, so adjacent runs can be merged.
const bucketKey = Math.floor(sample.testedAt / bucketMs);
```

#### Correct

```ts
// New samples carry an explicit run identity from the producer.
const probeRunId = generateProbeRunId('route');
const sample: RouteCliProbeSample = {
  sampleId: generateSampleId(),
  probeRunId,
  probeKey,
  siteId,
  accountId,
  cliType,
  canonicalModel,
  rawModel,
  success,
  source: 'routeProbe',
  testedAt: Date.now(),
};
```
