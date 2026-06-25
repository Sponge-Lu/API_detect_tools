# Cross-Layer Thinking Guide

> **Purpose**: Think through data flow across layers before implementing.

---

## The Problem

**Most bugs happen at layer boundaries**, not within layers.

Common cross-layer bugs:
- API returns format A, frontend expects format B
- Database stores X, service transforms to Y, but loses data
- Multiple layers implement the same logic differently

---

## Before Implementing Cross-Layer Features

### Step 1: Map the Data Flow

Draw out how data moves:

```
Source → Transform → Store → Retrieve → Transform → Display
```

For each arrow, ask:
- What format is the data in?
- What could go wrong?
- Who is responsible for validation?

### Step 2: Identify Boundaries

| Boundary | Common Issues |
|----------|---------------|
| API ↔ Service | Type mismatches, missing fields |
| Service ↔ Database | Format conversions, null handling |
| Backend ↔ Frontend | Serialization, date formats |
| Component ↔ Component | Props shape changes |

### Step 3: Define Contracts

For each boundary:
- What is the exact input format?
- What is the exact output format?
- What errors can occur?

---

## Common Cross-Layer Mistakes

### Mistake 1: Implicit Format Assumptions

**Bad**: Assuming date format without checking

**Good**: Explicit format conversion at boundaries

### Mistake 2: Scattered Validation

**Bad**: Validating the same thing in multiple layers

**Good**: Validate once at the entry point

### Mistake 3: Leaky Abstractions

**Bad**: Component knows about database schema

**Good**: Each layer only knows its neighbors

### Mistake 4: Mixing Capability State with Runtime State

**Bad**: Reusing one field to mean both "feature is supported" and "feature is currently available"

Examples:
- `has_checkin` inferred from `can_check_in`
- stale cached stats kept after the feature is disabled upstream

**Good**: Persist capability state and runtime state separately, then define who owns each refresh path

Checklist:
- `has_*` answers whether the feature exists for this site/account
- `can_*` answers whether the feature can be executed right now
- when capability turns off, clear runtime-only payloads that would otherwise keep old UI affordances alive

### Mistake 5: Brute-Forcing Cross-Layer Endpoints Instead of Using the Registered Contract

**Bad**: Calling multiple incompatible endpoints in sequence and hoping the first failure is harmless

Examples:
- trying `veloera` and `newapi` check-in endpoints for the same site
- browser fallback opening a page, hitting the wrong endpoint first, then closing before the correct family is tried

**Good**: Resolve the site/account contract first (`site_type`, feature profile, account scope), then call only the endpoints that belong to that contract

Checklist:
- resolve `site_type` before building endpoint lists
- keep fallback order inside one family, not across incompatible families
- if a feature is unsupported for the resolved type, return early instead of probing unrelated endpoints

### Mistake 6: Confusing the Real Auth Session with a Cached Login Hint

**Bad**: Treating one in-memory or persisted field as the only source of truth for login state when
the real authenticated session lives elsewhere

Examples:
- renderer/main uses a stored cookie string as the sole `isLoggedIn` signal, but the real session is
  the persistent browser profile
- login flow waits for one specific cookie (for example `cf_clearance`) before trying the protected
  API, even though a successful API response is the actual proof of login

**Good**: Define which layer owns the real session, and treat cached auth hints only as UI recovery
signals

Checklist:
- identify the true session owner first: browser profile, cookie jar, localStorage, token store, or
  backend session
- let cached data restore the UI only as a fallback; a successful live probe may override it, but a
  failed probe must not silently erase unrelated cache unless the auth contract is definitively
  invalid
- clear auth-dependent cache when a protected endpoint confirms 401/403, so the next startup does
  not show contradictory state
- do not gate login success on one named cookie when the real contract is “protected API returns
  authenticated user data”

### Mistake 7: One-Way Projection From A Canonical Runtime Cache

**Bad**: Writing the same runtime result into one shared cache, then refreshing only the page that
initiated the write.

Examples:
- site-management manual CLI model tests write `routing.cliProbe.latest`, but only refresh the
  site card compatibility summary
- route/site detection writes `routing.cliProbe.latest`, but the site-management CLI config dialog
  keeps showing stale per-model `cli_config.testResults` slots
- a site card receives a newer projected compatibility summary, but its icon component still gives
  unconditional priority to older persisted `cli_config.testResults`
- custom CLI config saves update `custom-cli-configs.json`, but route model dropdowns still read the
  persisted `routing.modelRegistry` projection unless the save path rebuilds that registry

**Good**: Treat the shared cache as the canonical latest-result source and define every consumer
projection explicitly.

Checklist:
- identify the canonical key tuple first, for example `siteId + accountId + cliType + model`
- list every UI surface that displays the data, including dialogs and per-slot controls, not just
  page-level cards
- after any writer updates the canonical cache, refresh or re-project every mounted consumer that
  can display the affected tuple
- if a consumer also persists local UI state, define whether canonical latest results override,
  merge with, or only annotate that local state
- when a display combines canonical projection and local persisted fallback, select by an explicit
  freshness field such as `testedAt` instead of hard-coding one source to always win
- when a stable user-intent file feeds a derived registry, save operations on the intent file must
  also refresh the derived registry or emit a consumer-visible invalidation event
- add tests for both write directions: A updates B, and B updates A

### Mistake 8: Letting A Derived Projection Override The Write Contract

**Bad**: Reconstructing a UI contract from a derived or stale projection while ignoring the original
write intent.

Examples:
- `routing.modelRegistry.overrides` contains multiple source-level redirects for one canonical
  model, but `registry.entries[canonicalName].sources` is stale and lists only one source
- the redirection UI rebuilds an override-only card from the partial entry alone, so the card shows
  only one original model and hides other selected site/custom CLI sources
- the UI trusts a persisted `RouteModelDisplayItem` whose `sourceKeys` and `originalModelOrder`
  were saved before all per-source overrides finished, so a multi-source redirect reopens as a
  single-source card
- the save flow writes per-source overrides before the card-level display item, so an interrupted
  save leaves write-intent and display projection out of sync

**Good**: Treat write-intent records and derived projections as peers at compatibility boundaries,
then merge by stable identity before displaying or re-saving. Persist the card-level write contract
before lower-level compatibility records when the card is the user-visible routing unit.

Checklist:
- identify which record is write intent, for example one override per `sourceKey`
- identify which record is a derived projection or compatibility projection, for example
  `entries[canonicalName].sources` or a persisted legacy `displayItem.sourceKeys`
- when supporting legacy data, union write-intent and projection records by stable identity instead
  of allowing either side to replace the other wholesale
- when one UI action writes multiple related records, save the record that owns the user-visible
  unit first, then update compatibility records
- add a regression test where the derived projection is intentionally stale or partial

### Mistake 9: Treating Transport Model Names As User Intent

**Bad**: Assuming the model name extracted from a CLI transport path is always the model the user
intended to route.

Examples:
- Gemini CLI sends `/v1beta/models/gemini-2.5-flash-lite:generateContent` for an internal
  helper/default request while the app-selected Gemini CLI model is `gemini-3.1-pro-preview`
- Gemini CLI 0.41.2 maps internal utility configs such as `classifier`, `prompt-completion`,
  `fast-ack-helper`, `edit-corrector`, `summarizer-default`, `summarizer-shell`, and
  `chat-compression-2.5-flash-lite` to `gemini-2.5-flash-lite`, so repeated wire requests for that
  model can be CLI utility traffic rather than user chat traffic
- the proxy matches only the extracted path model, finds no rule, returns `no_matching_rule`, and
  the CLI retries indefinitely

**Good**: Separate "transport model observed on the wire" from "routing intent selected in app
state", then define the fallback order explicitly.

Checklist:
- preserve the transport model as diagnostic data such as `requestedModel`
- inspect the request role/body and CLI model config source before concluding that the user selected
  the observed transport model
- resolve canonical routing intent from registry aliases first; before falling back to explicit CLI
  selection, apply billing guards for known CLI internal utility/fallback models such as Gemini
  `gemini-2.5-flash-lite`
- keep unknown-model safety: do not fall back to generic site/account channels when registry data
  exists and no selected CLI model rule matches
- avoid returning retryable 5xx for expected non-routable helper/default models when the intended
  outcome is terminal; Gemini CLI retries 5xx utility failures, so terminal billing guards must use
  non-retryable 4xx responses and must not forward upstream
- add integration tests that drive the real request shape through rule matching, channel resolution,
  and upstream path rewriting

### Mistake 10: Editing A Similar Component Instead Of The Active UX Entrypoint

**Bad**: Finding a component with a plausible name and implementing the behavior there without
proving that it is mounted by the route the user described.

Examples:
- adding Custom CLI controls to a legacy editor drawer while the actual Custom CLI navigation renders
  a left-right page layout
- updating a dialog test while the regression should belong to the page-level workflow test

**Good**: Treat the UI entrypoint as a cross-layer contract: navigation route -> page component ->
rendered controls -> persistence/test bridge.

Checklist:
- start from the route or app shell and identify the mounted page before editing
- search for runtime imports and tests for that page, not only same-domain component names
- when multiple same-domain surfaces exist, document which one is active, legacy, or secondary
- add a regression at the active workflow boundary so missing UI controls fail where the user sees
  them

### Mistake 11: Migrating A Configuration Owner In Only One Layer

**Bad**: Moving a persisted setting from one owner to another, then updating only the editor or only
the runtime reader.

Examples:
- managed-site CLI config moves from `sites[].cli_config` to `accounts[].cli_config`, but the save
  handler still writes the site record
- scheduled CLI probes read `site.cli_config` while the side panel saves `account.cli_config`
- renderer startup loads account CLI config into the bare site-name store key, so an account card
  cannot see its own saved settings
- route target protocol resolution reads a different owner than manual CLI tests and probe samples

**Good**: Treat ownership migrations as a full data-flow change and update every producer,
consumer, projection, and regression test in the same task.

Checklist:
- identify the canonical persisted owner and any legacy fallback owner
- update save handlers first, then loaders, projections, scheduled jobs, route resolvers, and bridge
  typings
- make fallback order explicit, for example `account.config ?? site.legacyConfig`
- when a child owner explicitly disables a feature, do not fall back to a parent legacy enable
- add tests for write path, load projection key, scheduler/runtime selection, and legacy fallback

---

## Checklist for Cross-Layer Features

Before implementation:
- [ ] Mapped the complete data flow
- [ ] Identified all layer boundaries
- [ ] Defined format at each boundary
- [ ] Decided where validation happens

After implementation:
- [ ] Tested with edge cases (null, empty, invalid)
- [ ] Verified error handling at each boundary
- [ ] Checked data survives round-trip
- [ ] Confirmed cached capability flags and live runtime flags are updated independently
- [ ] Confirmed endpoint selection is driven by the resolved contract (`site_type`, account scope, feature profile), not by broad trial-and-error
- [ ] Confirmed cached login hints, browser session state, and protected-endpoint validation do not contradict each other
- [ ] Confirmed every writer to a canonical runtime cache re-projects the latest result to all
      display surfaces, including dialog-local and slot-level views
- [ ] Confirmed compatibility projections do not drop write-intent records when the projection is
      stale or partial
- [ ] Confirmed CLI transport model names are not blindly treated as user routing intent when the
      app has an explicit selected model fallback
- [ ] Confirmed configuration ownership migrations update save handlers, loaders, projections,
      scheduled jobs, route resolvers, and tests together

---

## When to Create Flow Documentation

Create detailed flow docs when:
- Feature spans 3+ layers
- Multiple teams are involved
- Data format is complex
- Feature has caused bugs before
