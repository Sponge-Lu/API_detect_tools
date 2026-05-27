# brainstorm: route successful path reuse

## Goal

Improve route proxy user experience by avoiding repeated sequential retries from the first
site/account/API key when a later route path has recently succeeded. The design should prefer a
known-good route path on the next matching request while preserving automatic failover, short-window
health suspension, manual recovery, and user-configured priorities.

## What I Already Know

* The current route proxy builds a candidate list for each matched request, then attempts channels in
  order until one succeeds or all fail.
* The current attempt order starts from `sortChannelsByScore(channels)` and then applies
  `buildChannelAttemptPlan(...)`; successful attempts are recorded but do not become the first
  candidate when explicit site/API-key priorities sort ahead of them.
* `sortChannelsByScore()` currently prioritizes `sitePriority`, `siteId`, `apiKeyPriority`,
  `apiKeyOrder`, and `originalModelIndex` before route statistics. This means a lower-priority
  successful route path may stay behind earlier configured paths on future requests.
* The project already has two runtime-state concepts:
  * `routing.stats`: longer-lived channel success/failure/latency counters used for scoring.
  * `routing.routePathStates`: short-window per route path health state used to temporarily disable
    paths by canonical/resolved model.
* The current default route runtime config is:
  * `maxAttemptsPerRoutePath = 1`
  * `successRateWindowMinutes = 5`
  * `disableDurationMinutes = 30`
  * `minSuccessRate = 0.8`
* Existing route health policy already resembles passive health checking / circuit breaker behavior:
  failed route paths can be temporarily disabled, and manual reset can clear path state.
* The user initially requested brainstorming only, then confirmed implementation could continue.

## Research References

* [Envoy outlier detection](https://www.envoyproxy.io/docs/envoy/latest/intro/arch_overview/upstream/outlier.html)
  documents passive health checking, host ejection based on consecutive failures, temporal success
  rate, latency, and automatic return after ejection time.
* [Resilience4j CircuitBreaker](https://resilience4j.readme.io/docs/circuitbreaker) documents
  closed/open/half-open states, sliding windows, minimum calls before calculating failure rate, and
  limited trial calls after an open wait duration.
* [Microsoft Azure Circuit Breaker pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/circuit-breaker)
  documents blocking calls to faulty services, half-open recovery, observability, manual override,
  and resource differentiation concerns.

## Research Notes

### Pattern Fit

* The repo already implements the "avoid bad paths" half of mature routing behavior through
  `routePathStates`.
* The missing behavior is the positive counterpart: prefer recently successful route paths before
  doing another cold ordered scan.
* The design should avoid a naive permanent "last success only" rule because it can mask recovery,
  ignore user priority, and pin traffic to a path that becomes quota-limited or slow.

### Constraints From This Repo

* Route path identity should remain the existing path key dimensions:
  `routeRuleId`, `siteId`, `accountId`, `apiKeyId`, `targetProtocol`, `canonicalModel`,
  `resolvedModel`.
* Probe-lock and bypass flows must not update or consume success affinity; they are diagnostic /
  single-attempt flows.
* The routing UI already depends on `routePathStates`; any added runtime fields should not turn
  display diagnostics into hard suppression unless the backend explicitly owns that behavior.
* If this changes shared route types or runtime config, update backend/frontend specs and tests.

## Feasible Approaches

### Approach A: Pure Score Tuning

Make existing `stats.lastSuccessAt`, success rate, and latency outrank configured priority.

Pros:
* Minimal data-model change.
* Uses existing `routing.stats`.

Cons:
* Blurs user-configured priority with runtime health.
* Hard to express TTL and scope explicitly.
* Existing stats key does not include canonical/resolved model, while route path health does.

### Approach B: Short-Lived Success Affinity (Recommended)

Derive a "preferred successful route path" from existing route path state after an actual successful
upstream response. On the next matching request, move that exact route path to the front if it still
exists, is not disabled, and is not stale. If it fails, immediately fall back to the next candidate
after the preferred path's original priority position, and let existing route path state record the
failure. If all later candidates fail, wrap around to the beginning of the normal priority order and
try earlier candidates that have not been attempted in the current request.

Pros:
* Directly fixes the repeated cold-start scan.
* Keeps user priority as the fallback order, not the fast path.
* Uses the same route path identity as `routePathStates`.
* Easy to bound with TTL and failure invalidation.

Cons:
* Requires careful use of existing `routePathStates` so affinity remains scoped to the same path
  identity as health suspension.
* Needs careful invalidation when rules, model mappings, sites, accounts, API keys, or target protocol
  change.

### Approach C: Adaptive Weighted Router

Replace sequential priority-first routing with weighted selection using success rate, latency, user
priority, and recent failures.

Pros:
* More flexible long term.
* Can balance traffic across multiple good paths.

Cons:
* Larger behavior change.
* Harder to reason about for users who expect priority order.
* More tests and UI explanation would be required.

## Recommended MVP

Implement Approach B: short-lived success affinity.

### Selection Algorithm

1. Build the normal candidate plan exactly as today.
2. Read eligible recent successes from `routing.routePathStates` for candidates in the bounded plan.
3. If a candidate has `lastOutcome === 'success'`, `lastSuccessAt` within 30 minutes, and no active
   `disabledUntil`, move the most recently successful candidate to the front.
4. Attempt channels in that order.
5. On success:
   * Record normal stats and route path outcome as today.
   * `recordRoutePathOutcome()` updates `lastOutcome` and `lastSuccessAt`, which naturally makes the
     successful path eligible for later affinity.
6. On failure of the preferred path:
   * Record the failure as today.
   * `recordRoutePathOutcome()` updates `lastOutcome` to failure, so the failed path is no longer
     eligible as a preferred successful path.
   * Continue in the same request from the next candidate after the preferred path's original position
     in the normal priority order.
   * This may include other accounts/API keys on the preferred path's site when they rank after the
     failed preferred path.
   * If every later candidate fails, wrap around to the first normal-priority candidate and continue
     until every eligible candidate has been attempted once.
   * Do not retry the failed preferred path again in the same request.

### Affinity TTL

Use a `30 minute` default TTL, scoped by the current route path state key: route rule, site, account,
API key, target protocol, canonical model, and resolved model. This keeps the UX fast during active
use while still avoiding indefinite pinning to stale provider/account/key state across long idle
periods.

### Failure / Recovery Behavior

* Existing `routePathStates` remains authoritative for temporary disabling.
* A disabled path cannot be the preferred path.
* Once a disabled path recovers or is manually reset, it returns to the normal candidate pool. It does
  not become preferred again until it succeeds.
* If all paths are disabled, keep the existing `all_route_paths_disabled` behavior.

### Interaction With `maxAttemptsPerRoutePath`

* Success affinity only reorders the bounded normal candidate plan; it must not bypass
  `maxAttemptsPerRoutePath`.
* Build the normal candidate plan with `buildChannelAttemptPlan(..., maxAttemptsPerRoutePath)` before
  applying preferred-path promotion and circular fallback.
* A failed preferred path counts as one attempt for that route path in the current request.
* If `maxAttemptsPerRoutePath = 1`, the same route path must not be attempted again after circular
  fallback wraps around.
* If `maxAttemptsPerRoutePath > 1`, the request may attempt additional allowed candidate entries for
  the same route path only if they exist in the bounded normal candidate plan.
* Do not reinterpret `maxAttemptsPerRoutePath` as a new network retry loop in this MVP; preserve the
  existing meaning as a cap over generated candidate entries per route path.

### Scope

* Include site-backed route paths and custom CLI-backed route paths if they share the same candidate
  identity shape.
* Do not add load balancing or weighted distribution in the MVP.
* Do not change the route UI in the MVP.

## Requirements

* Prefer the last recently successful route path for the same route rule, site, account, API key,
  target protocol, canonical model, and resolved model key.
* Never prefer a path that is no longer in the candidate list or is currently disabled.
* Preserve circular fallback: if the preferred path fails, continue from the next candidate after the
  preferred path's original priority position, then wrap to the first candidate if the later candidates
  all fail.
* Allow other accounts/API keys on the preferred path's site to be tried when they rank after the
  failed preferred path.
* Do not add attempts beyond the bounded candidate plan generated by `maxAttemptsPerRoutePath`.
* Keep user-configured priority as the default/fallback order.
* Bound affinity with a `30 minute` TTL and route path state outcome updates.
* Keep preferred route path affinity backend-only for the MVP; do not add UI display or controls.
* Keep `maxAttemptsPerRoutePath` effective by applying affinity after normal attempt-plan bounding.
* Do not use failed CLI probe samples to suppress runtime route candidates; runtime suppression remains
  owned by route path state.

## Acceptance Criteria

* [x] Given path A fails and path B succeeds, the next matching request attempts path B first.
* [x] Given preferred path B later fails, the same request continues from the next candidate after B's
  original priority position instead of restarting from the first candidate.
* [x] Given another account/API key on B's site ranks after B, the same request may try that candidate
  after B fails.
* [x] Given every candidate after B fails, the same request wraps around and tries earlier candidates
  from the first normal-priority candidate.
* [x] Given preferred path B fails, B is not attempted a second time in the same request.
* [x] Given `maxAttemptsPerRoutePath = 1`, preferred-path promotion and circular fallback do not create
  extra attempts for the same route path.
* [x] Given `maxAttemptsPerRoutePath > 1`, affinity reordering preserves at most that many generated
  candidate entries for the same route path.
* [x] Given preferred path B is disabled by route path state, the request skips it and uses normal
  candidate order.
* [x] Given the successful state is stale or references a removed site/account/API key/model, the
  request ignores it because no current candidate matches that state key.
* [x] Given a successful non-preferred path handles a request, route path state updates make that path
  eligible for later affinity.
* [x] Existing `maxAttemptsPerRoutePath`, route path disable, analytics logging, and probe-lock
  behaviors remain intact.

## Open Questions

* None for MVP scope.

## Definition Of Done

* Unit tests cover successful path promotion, failure invalidation, disabled-path skip, stale state
  skip, circular fallback, and per-request no-duplicate-attempt behavior.
* Existing route proxy tests remain green.
* Shared type/spec updates are included if a new runtime field is added. No new runtime field was
  needed for the implemented MVP.
* No user-facing route priority semantics regress.

## Out Of Scope

* Weighted load balancing across healthy paths.
* UI-heavy traffic strategy controls.
* Displaying the current preferred route path in the route/data UI.
* Provider-specific quota prediction.
* Changing model registry aggregation or CLI probe health semantics.

## Technical Notes

* Task directory: `.trellis/tasks/05-25-route-successful-path-reuse`.
* Current plan construction: `src/main/route-proxy-service.ts`.
* Current route scoring: `src/main/route-stats-service.ts`.
* Current route path state type/key: `src/shared/types/route-proxy.ts`.
* Current runtime contract: `.trellis/spec/backend/route-runtime.md`.
* Existing route path reset behavior: `src/main/unified-config-manager.ts`.

## Decision (ADR-lite Draft)

**Context**: Current requests repeatedly start from configured order even when runtime evidence shows
that a later site/account/API key just worked.

**Decision**: Prefer a short-lived, scoped successful route path before the normal sorted plan, deriving
that preference from existing `routing.routePathStates` instead of adding a separate pointer. Preserve
current priority and health-disable logic as fallback and safety rails.

**Consequences**: The next matching request becomes faster and less noisy after one successful fallback,
while failures still recover through existing path health state. The implementation ignores stale,
failed, disabled, and non-current candidate states to avoid pinning traffic to removed or disabled
paths. The initial affinity TTL is `30 minutes`, and the MVP keeps the behavior backend-only.
Preferred-path failure starts from the next candidate after the preferred path's original priority
position, then wraps around to earlier candidates only after all later candidates fail.
