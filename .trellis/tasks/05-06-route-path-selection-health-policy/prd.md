# brainstorm: resilient route path selection

## Goal

Design a route path health and selection policy that avoids repeatedly sending real user requests to recently failing sites or custom CLI paths, quickly prefers paths that have recently succeeded, and does not return `all_route_paths_disabled` while any route path is still practically usable.

## What I already know

* The current user-facing failure mode is frequent `all_route_paths_disabled`.
* The desired behavior must cover both site-backed route paths and custom CLI-backed route paths.
* The user explicitly requested brainstorming only; no application code should be changed in this task.
* Route runtime state is documented as backend-owned runtime state, including route path suspension state and health.
* Current default runtime config is strict: `maxAttemptsPerRoutePath = 1`,
  `successRateWindowMinutes = 5`, `disableDurationMinutes = 30`, `minSuccessRate = 0.8`.
* Current `recordRoutePathOutcome()` disables a route path after any failure that makes the short-window
  success rate fall below the threshold. In an empty 5-minute window, one failure produces
  `successRate = 0` and `disabledUntil = now + 30 minutes`.
* Current `handleRequest()` sorts candidates, builds the attempt plan, then filters every candidate
  where `isRoutePathDisabled(channel)` is true. If the filtered list is empty, it returns
  `503 / all_route_paths_disabled`.
* Current `sortChannelsByScore()` respects saved site priority and API key priority before health
  score; health score only decides ordering after priority/order ties.
* Runtime tests confirm this behavior: route stats tests assert one failure disables the path, and
  route proxy tests assert the default route runtime config.

## Assumptions (temporary)

* `all_route_paths_disabled` is produced when the current routing resolver filters all candidate paths because of disabled/suspended health state, not because no route rule matched.
* Some failed paths may recover, so a permanent or long hard-disable policy is likely too strict for real use.
* The practical target is a policy with soft avoidance, fast success affinity, and controlled probing rather than simple on/off disabling.

## Open Questions

* Which failover policy should be the MVP: conservative cooldown, adaptive scoring, or hybrid quarantine plus probe?

## Requirements (evolving)

* Avoid frequent requests to sites/custom CLI paths that recently failed.
* Prefer sites/custom CLI paths that recently succeeded.
* Avoid `all_route_paths_disabled` when at least one configured route path is still potentially usable.
* Keep this brainstorm non-invasive: inspect code and write planning notes only.

## Acceptance Criteria (evolving)

* [x] Existing `all_route_paths_disabled` trigger conditions are identified from code or tests.
* [x] 2-3 feasible route selection policies are compared with trade-offs.
* [ ] MVP recommendation includes edge-case behavior for fully failed, partially failed, and recovering path sets.
* [ ] No source code is modified during brainstorming.

## Definition of Done (team quality bar)

* Tests added/updated if implementation follows later.
* Lint / typecheck / CI green if implementation follows later.
* Specs/docs updated if route runtime behavior changes.
* Rollout/rollback considered if route behavior becomes riskier.

## Out of Scope (explicit)

* Implementing or editing runtime route code in this brainstorm step.
* UI redesign for route health visualization unless needed to clarify the policy.
* Changing CLI compatibility test execution semantics.

## Technical Notes

* Task directory: `.trellis/tasks/05-06-route-path-selection-health-policy`.
* Initial broad search found Route-related ownership in `PROJECT_INDEX.md` and runtime storage guidance in `.trellis/spec/backend/storage-runtime.md`.
* Route runtime contract: `.trellis/spec/backend/route-runtime.md`.
* Current disable check: `src/main/route-stats-service.ts` (`isRoutePathDisabled()`).
* Current disable update: `src/main/route-stats-service.ts` (`recordRoutePathOutcome()`).
* Current routing failure response: `src/main/route-proxy-service.ts` (`all_route_paths_disabled` branch).
* Current route score: `src/main/route-stats-service.ts` (`computeScore()` and `sortChannelsByScore()`).
* Current candidate resolver includes custom CLI virtual channels through `src/main/route-channel-resolver.ts`
  and `src/main/custom-cli-config-service.ts`.
* Runtime verification run: `npm test -- src/__tests__/route-stats-service.test.ts src/__tests__/route-proxy-service.test.ts`
  passed with 21 tests.

## Research Notes

### What similar systems do

* Envoy outlier detection ejects unhealthy upstream hosts based on error/consecutive-failure signals,
  but caps ejection with `max_ejection_percent`, meaning the system is designed to avoid blindly
  ejecting every host in a cluster. Source: Envoy official documentation, OutlierDetection API.
* Envoy load balancing also has panic-threshold behavior: when the healthy host percentage drops
  below a configured threshold, Envoy routes to all hosts because refusing to route can be worse than
  trying degraded capacity. Source: Envoy official documentation, Panic threshold architecture.
* Resilience4j circuit breaker uses closed/open/half-open states. Open avoids requests for a wait
  duration; half-open allows a limited number of trial calls to determine recovery. Source:
  Resilience4j official documentation, CircuitBreaker.
* AWS retry guidance recommends capped exponential backoff with jitter so clients do not repeatedly
  hammer the same failing target or retry in synchronized bursts. Source: AWS Architecture Blog,
  Exponential Backoff and Jitter.

### Constraints from this repo/project

* Route paths are already specific enough to separate rule, site, account, API key, canonical model,
  and resolved model; the policy should stay at this route-path granularity.
* Route candidate suppression must remain independent from `routing.cliProbe.latest`; the route
  runtime spec explicitly says CLI probe samples are display/diagnostics cache only.
* Saved site priority and API key priority are user intent. A health policy should not silently
  erase this ordering, but can temporarily lower or quarantine a failing route path.
* Custom CLI route paths use virtual site/account/API key ids, so the same policy can apply if it
  only depends on `RouteChannelKey` / `RoutePathState`.

### Feasible approaches here

**Approach A: Soft Cooldown + Last-Resort Fallback**

* How it works:
  * Replace "disabled means filtered out" with two candidate tiers.
  * Tier 1: healthy / not cooling-down route paths, sorted by priority plus health score.
  * Tier 2: cooling-down route paths, sorted by earliest retry time, recent success, and lower failure
    count.
  * Normal routing tries Tier 1. If Tier 1 is empty but route paths exist, try exactly one Tier 2 path
    instead of returning `all_route_paths_disabled`.
* Pros:
  * Minimal conceptual change from the current state model.
  * Directly fixes the `all_route_paths_disabled` symptom while still avoiding repeated hits to known
    bad paths.
  * Easy to explain in UI: "cooling down, but used as last resort."
* Cons:
  * Recovery discovery is passive unless real traffic arrives.
  * If all paths are genuinely broken, the last-resort path still receives occasional user requests.

**Approach B: Circuit Breaker with Half-Open Probe**

* How it works:
  * Route path state becomes `closed | open | halfOpen`.
  * `closed`: normal candidate.
  * `open`: avoid user traffic until `nextProbeAt`.
  * `halfOpen`: allow one limited trial request; success closes it, failure reopens it with backoff.
  * If every path is open, pick the path whose `nextProbeAt` is earliest and treat the request as a
    half-open trial instead of returning `all_route_paths_disabled`.
* Pros:
  * Best match for "do not frequently request failed paths, but recover quickly."
  * Clear recovery semantics and less arbitrary than fixed 30-minute disables.
  * Can add exponential backoff + jitter per path to avoid synchronized retries.
* Cons:
  * More state and tests than Approach A.
  * Requires careful handling so concurrent requests do not all become half-open probes.

**Approach C: Adaptive Score Ranking, No Hard Disable**

* How it works:
  * Stop filtering disabled paths entirely.
  * Compute a score from priority, recent success, success rate, consecutive failures, latency, and
    backoff penalty.
  * Failed paths remain candidates but sink to the bottom until their penalty decays.
* Pros:
  * Almost eliminates `all_route_paths_disabled` by construction.
  * Very simple request flow: sort candidates and try them.
  * Naturally prefers recently successful paths.
* Cons:
  * Without a hard gate, a failing path may still be touched more often than desired under high
    traffic.
  * Score tuning can become opaque unless the UI exposes enough explanation.

## Expansion Sweep

### Future evolution

* Add per-redirection runtime presets: "fast recovery", "balanced", "conservative", instead of exposing
  many numeric fields first.
* Add route-path health explanation in request logs so users can see why a path was selected despite
  cooldown.

### Related scenarios

* The same policy should cover site-backed API keys and custom CLI virtual route channels.
* Resetting route stats should clear route path cooldown/circuit state, preserving the existing reset
  contract.

### Failure & edge cases

* If at least one non-cooling path exists, never try cooling paths for the same request.
* If every path is cooling/open, allow a bounded last-resort/half-open attempt rather than returning
  `all_route_paths_disabled`.
* If no channels exist or credentials are missing for all channels, keep returning concrete errors
  like `no_channels` or final upstream failure; do not relabel those as available-route fallback.
