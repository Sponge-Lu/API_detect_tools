# brainstorm: route token usage statistics fallback

## Goal

Understand how route request token statistics are currently collected for input, output, and cache tokens, why the values are sometimes missing, and evaluate whether the always-visible request/response payload data can be used as a fallback source.

## What I already know

* The route feature has token statistics for request input, output, and cache tokens.
* The user observes that these token statistics are not available for every request.
* The user also observes that actual request information and response information are visible more consistently.
* The user wants to inspect the current implementation before deciding whether to use request/response data to improve statistics coverage.
* Code evidence: route analytics currently models only prompt, completion, and total tokens. There is no cache-token field in `RouteAnalyticsBucket` or `RouteRequestLogItem`.
* Code evidence: route proxy records token usage from `result.usage` when calling `recordRouteRequest()`.
* Code evidence: `result.usage` is produced by parsing the upstream response body in `extractUsageFromBody()`.
* Code evidence: current usage parsing only reads `usage.prompt_tokens`, `usage.input_tokens`, `usage.completion_tokens`, `usage.output_tokens`, and `usage.total_tokens`.
* Code evidence: route request logs are in-memory metadata only. They do not currently store full request body or response body.
* Code evidence: the route log UI displays tokens from `RouteRequestLogItem`, and data overview explicitly shows the fallback hint "upstream did not return usage or no successful requests" when totals are zero.
* Real capture evidence: Claude Code against PrismAI `cherrystudio` returns Anthropic SSE usage under `message_start.message.usage` and `message_delta.usage`.
* Real capture evidence: Codex CLI against the local custom CLI config (`CPA`, `http://127.0.0.1:8317`) returns OpenAI Responses SSE usage under `response.completed.response.usage`.
* Real capture evidence: Gemini CLI against PrismAI `222` returns Gemini SSE chunks where early chunks may only contain `usageMetadata.trafficType`, and the final chunk contains numeric `usageMetadata`.

## Assumptions (temporary)

* Token statistics currently depend on provider-reported `usage` fields rather than local token counting.
* The proxy has request and response buffers at runtime, but the app does not persist full request/response payloads in route request logs.
* A robust fix may need a fallback policy rather than replacing provider-reported usage outright.
* Cache-token coverage requires extending shared types and UI, not just parser logic.

## Open Questions

* Which fallback behavior should be included in MVP after implementation options are reviewed?

## Requirements (evolving)

* Identify the current route token statistics data flow.
* Identify why token statistics can be missing while request/response details exist.
* Propose feasible implementation approaches with trade-offs.
* Preserve provider-reported exact token usage when available.
* Avoid storing sensitive full request/response payloads unless explicitly chosen.

## Acceptance Criteria (evolving)

* [x] Current implementation is documented with concrete files/functions.
* [x] Missing-token causes are classified by evidence from code.
* [x] At least two feasible approaches are proposed.
* [x] MVP scope is confirmed before implementation.
* [x] Real Claude Code / Codex CLI / Gemini CLI request and response structures are captured through a redacting proxy and documented.
* [x] Official Anthropic / OpenAI / Gemini docs are cross-checked against captured usage paths.

## Definition of Done (team quality bar)

* Tests added/updated if implementation proceeds.
* Lint / typecheck / CI green if code changes are made.
* Docs/notes updated if behavior changes.
* Rollout/rollback considered if risky.

## Out of Scope (explicit)

* Implementing code changes before MVP scope is confirmed.
* Changing provider protocol behavior unrelated to route statistics.

## Technical Notes

* `src/main/route-proxy-service.ts`: `extractUsageFromBody()` parses upstream response usage; successful attempts pass `result.usage` into `recordRouteRequest()`.
* `src/main/route-analytics-service.ts`: `recordRouteRequest()` appends an in-memory request log and aggregates analytics buckets. Missing token values become zero in bucket aggregation.
* `src/shared/types/route-proxy.ts`: analytics/request-log token schema currently supports only prompt, completion, and total tokens.
* `src/main/handlers/route-handlers.ts`: exposes `route:get-request-logs`, `route:get-analytics-summary`, and `route:fetch-latest-log`; `fetch-latest-log` queries upstream site logs separately and returns prompt/completion/quota only.
* `src/renderer/pages/LogsPage.tsx`: route logs display total/input/output tokens from `RouteRequestLogItem`; missing values render as "无".
* `src/renderer/pages/DataOverviewPage.tsx`: token card hint says "上游未返回 usage 或暂无成功请求", which matches the current parser-dependent behavior.
* `.trellis/tasks/05-09-route-token-usage-stats-fallback/capture-cli-real-upstream.cjs`: runs a local redacting proxy and forwards to real upstreams using locally configured API keys. It persists only structure summaries and usage paths in `cli-real-capture-results.json`.
* `docs/CLI_request.md`: documents the fake-upstream and real-upstream capture findings plus official protocol cross-checks.

## Research Notes

### Current data flow

1. Route proxy reads request body into `bodyBuffer`.
2. Proxy rewrites model and optionally adapts AnyRouter/CHY API request format.
3. Proxy sends upstream request and receives `result.body`.
4. `extractUsageFromBody(result.body)` attempts to parse provider-reported usage.
5. Proxy calls `recordRouteRequest()` with parsed prompt/completion/total tokens.
6. Analytics service writes in-memory request log and aggregates hourly buckets.
7. Renderer reads the buckets/logs through route IPC handlers.

### Why values are missing

* If upstream response has no `usage`, current parser returns `undefined`.
* If upstream response exposes usage under an unrecognized shape such as Gemini-style `usageMetadata`, current parser returns `undefined`.
* If usage exists only after the response adapter transforms the body, current stats can miss it because analytics are recorded before transformed response is written.
* Cache-token data is structurally unsupported today: shared route analytics types have no cache token fields.
* Request body can help estimate input tokens, and response body can help estimate output tokens, but exact tokenization depends on model/provider tokenizer and is not equivalent to provider-reported billing usage.

### Feasible approaches here

**Approach A: Extend provider usage parser** (Recommended MVP)

* How it works: expand `extractUsageFromBody()` and/or shared helpers to parse additional usage shapes from raw and transformed response bodies, including Gemini `usageMetadata` and common cache-token subfields where present.
* Pros: preserves exact provider-reported usage; low privacy risk; low storage impact.
* Cons: still cannot recover usage when the provider truly omits it.

**Approach B: Site log reconciliation fallback**

* How it works: after a routed request with missing usage, optionally query the upstream site's latest log endpoint and merge prompt/completion/quota data back into the route request log or analytics bucket.
* Pros: can recover data even when client-facing response omits usage but the site records it.
* Cons: delayed, site-specific, may mismatch under concurrency, needs account/site auth and correlation strategy.

**Approach C: Local request/response estimation**

* How it works: derive approximate input/output tokens from request and response payload text when provider usage is missing.
* Pros: works even when upstream returns no usage and no site log API is available.
* Cons: approximate only without provider-specific tokenizer; cache tokens and billing totals remain uncertain; must avoid persisting sensitive payloads.

## Decision (ADR-lite)

User selected Approach A / 方案 1 as MVP: extend provider-reported usage parsing for JSON/SSE and cache token fields, without local token estimation and without storing full request/response bodies. Approach B remains a possible later phase for providers whose site logs are reliable and can be correlated safely.

## Real Capture Notes

Captured on 2026-05-09 with real base URLs/API keys through a redacting local proxy:

* Claude Code `2.1.112`, PrismAI `cherrystudio`, `claude-sonnet-4-6`: `POST /v1/messages?beta=true`, stream response, usage keys include `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, `claude_cache_creation_5_m_tokens`, and `claude_cache_creation_1_h_tokens`.
* Codex CLI `0.130.0`, custom config `CPA`, `gpt-5.5`: `POST /v1/responses`, stream response, usage keys include `input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`, and `total_tokens`.
* Gemini CLI `0.41.2`, PrismAI `222`, `gemini-3.1-pro-preview`: `POST /v1beta/models/gemini-3.1-pro-preview:streamGenerateContent?alt=sse`, stream response, final numeric usage keys include `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, and `totalTokenCount`.
