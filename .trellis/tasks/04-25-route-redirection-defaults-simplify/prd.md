# Simplify route redirection defaults

## Goal

Reduce the default visual and mental load of the route model redirection page. Instead of auto-seeding
three redirect cards per vendor and presenting the page as vendor-grouped sections, show a much smaller
starting point. The current user intent is to keep only `claude-opus-4-6` as the example/default
redirect and let users add other redirects manually.

## What I already know

* The current page is vendor-grouped in the renderer. `ModelRedirectionTab` builds `VendorSection[]`
  and renders one collapsible section per vendor, each with summary chips, expanded cards, a vendor
  priority button, and an add button.
* The current default display behavior is not just UI fallback. It is seeded in the main-process
  registry service via `buildSeededDisplayItems()`, which currently takes the top 3 entries for every
  vendor.
* The renderer also contains a fallback path that derives top-3 items per vendor when
  `registry.displayItems` is empty. This means the current "vendor top three" behavior exists in both
  main and renderer layers.
* The redirect editor candidate list is already global, not vendor-limited. `buildVendorSections()`
  currently sets `candidateGroups: buildVendorCandidateGroups(sourcePool)` for every section, and tests
  already assert that non-top3 models remain available as candidates.
* Existing tests explicitly lock in the current vendor-top3 behavior, so changing this feature will
  require test updates rather than only a UI tweak.
* The existing source-detail data already distinguishes:
  * `availableUserGroups`: groups that can use the original model
  * `availableApiKeys`: only groups that currently have eligible API keys
  This is enough to show "group exists but no API key" reminders without adding a new backend field.

## Assumptions (temporary)

* Internal `vendor` metadata may still exist for model inference and compatibility, even if the
  redirection UI no longer classifies or groups by vendor.
* A redirect card may continue to contain multiple selected original models.
* The integrated detail dialog should be organized around site/account/API-key entries for the current
  redirect card, and each entry should show which selected original models it can serve.

## Open Questions

* None for MVP.

## Requirements (evolving)

* Remove the current default behavior that auto-generates three redirect cards for each vendor.
* Remove vendor-based grouping/classification from the redirection page UI.
* Reduce the initial redirection surface so the page starts from one example/default rather than many
  auto-generated cards.
* `claude-opus-4-6` must be a real seeded redirect card that is created and restored by the system
  reset/default flow.
* Each `canonicalName` must map to exactly one redirect card. Duplicate cards for the same redirect
  name are not allowed.
* Keep manual creation of additional redirect cards as the primary path for all other models.
* Preserve the ability to pick any source model from the candidate list when users create or edit a
  redirect.
* Integrate the current "site priority" workflow into the redirect card detail experience instead of a
  separate vendor-priority entry dialog.
* The integrated detail dialog must be grouped by site/account/API-key entries for the current
  redirect card.
* Each site/account/API-key entry must show which original models selected in "edit model redirection"
  are available through that entry.
* Priority persistence and route selection must be refactored from `vendor` scope to the current
  redirect-card scope.
* Users can edit site priority and API-key priority inside that integrated dialog.
* If a user group can use one of the card's selected original models but no eligible API key exists
  for that group, show a text reminder under the corresponding site/account block.
* User groups without eligible API keys must not participate in priority editing inputs.
* Keep the implementation scoped to model redirection behavior and its tests; do not mix this with
  unrelated route workbench redesign changes.

## Acceptance Criteria (evolving)

* [ ] The route redirection page no longer shows seeded top-3 redirect cards per vendor.
* [ ] The route redirection page no longer groups cards by vendor.
* [ ] The initial/default state only surfaces the single approved example behavior for
      `claude-opus-4-6`.
* [ ] The UI and persistence layer prevent multiple redirect cards from existing for the same
      `canonicalName`.
* [ ] Users can still add redirects for any other available source model manually.
* [ ] Reset/default regeneration behavior matches the new simplified rule.
* [ ] The integrated detail dialog is grouped by site/account/API-key entries for the current
      redirect card.
* [ ] Each entry clearly shows which selected original models it can serve.
* [ ] Groups without eligible API keys are shown as reminder text only and do not get editable
      priority controls.
* [ ] Site priority and API-key priority are user-editable within the integrated dialog.
* [ ] Priority persistence and route resolution no longer depend on `vendor`-scoped priority config
      and instead follow the current redirect-card scope.
* [ ] Renderer and main-process registry behavior are consistent.
* [ ] Relevant tests are updated to reflect the new default behavior.

## Definition of Done (team quality bar)

* Tests added or updated for the changed default behavior
* Lint / typecheck / CI-relevant checks green
* Task notes updated if behavior changes materially

## Out of Scope (explicit)

* Reworking canonical-name inference or vendor matching rules
* Changing how source candidates are discovered from sites/accounts
* Broad redesign of the route workbench outside the model redirection surface

## Research Notes

### Constraints from the current codebase

* `src/main/route-model-registry-service.ts` seeds defaults in `buildSeededDisplayItems()` by vendor
  and top-3 ordering.
* `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx` re-derives vendor top-3 fallback
  items when `registry.displayItems` is empty and also renders the page as vendor sections.
* Vendor priority is currently a real runtime behavior, not just a presentation detail. The channel
  resolver reads `registry.vendorPriorities[entry.vendor]` when ranking site/account/api-key
  candidates, so changing the UI scope alone is not enough.
* The current source-detail dialog is card-scoped, but it groups the current display item's
  `entry.sources` by original model and site rather than by site/account/API key.
* The current vendor-priority dialog is launched from each vendor section and builds editable site/API
  key groups from that section's vendor-scoped sources across all display items in the section.
* The current detail-data shape can already represent "group exists but no API key":
  * `availableUserGroups` may be non-empty
  * `availableApiKeys` may be empty
  * existing test fixtures already cover this shape
* Current routing logic is canonical-model-scoped, not display-item-scoped:
  * `resolveChannels(rule, canonicalModel)` is called from route proxy and route health flows
  * `buildCanonicalDisplayItems()` returns all `displayItems` with the same `canonicalName`
  * `canChannelServeModel()` uses the same canonical-model-scoped display item set
  This means card-scoped priority requires either a unique card per canonical name or a new runtime
  way to identify the target card.
* `src/__tests__/route-workbench-redesign.test.tsx` contains assertions for:
  * vendor top-3 summary and expanded list
  * persisted display items taking precedence over top-3 derivation
  * non-top3 models remaining available as source candidates

### Feasible approaches here

**Approach A: Keep internal vendor metadata for inference, but refactor priority semantics to redirect-card scope** (recommended)

* How it works:
  * Stop seeding per-vendor top-3 display items.
  * Seed only one default/example item for `claude-opus-4-6` when available.
  * Replace vendor-section rendering with a flat redirect list or single collection view.
  * Integrate priority editing into the detail dialog and organize the modal around site/account/API
    key entries for the current redirect card.
  * Each entry lists the selected original models it supports.
  * Replace `vendorPriorities` with a redirect-card-scoped priority config keyed by the current card
    (or an equivalent persistent card-scoped key).
* Pros:
  * Matches the requested UI scope and runtime behavior.
  * Keeps redirect card mental model coherent.
* Cons:
  * Cross-layer refactor touching shared types, IPC, persistence, resolver, renderer, and tests.

**Approach B: Keep current backend vendor-priority semantics and only narrow the dialog presentation**

* How it works:
  * Integrate priority editing into the detail dialog and only show the current card's site/account/API
    key rows.
  * Continue persisting to vendor-scoped priority data under the hood.
* Pros:
  * Smaller implementation.
* Cons:
  * Violates the newly confirmed requirement because the edited values would still affect other models
    in the same vendor bucket.

## Technical Notes

* Code references:
  * `src/main/route-model-registry-service.ts` - `buildSeededDisplayItems()`
  * `src/main/route-channel-resolver.ts` - vendor priority affects channel ranking
  * `src/main/route-proxy-service.ts` - runtime route selection calls `resolveChannels(rule, canonicalModel)`
  * `src/main/route-health-service.ts` - health probing also calls `resolveChannels(rule, canonicalModel)`
  * `src/main/unified-config-manager.ts` - vendor priority persistence
  * `src/main/handlers/route-handlers.ts` - vendor priority IPC contract
  * `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx` - `buildVendorSections()`
  * `src/renderer/components/Route/Redirection/ModelRedirectionTab.tsx` - vendor section render tree
  * `src/__tests__/route-workbench-redesign.test.tsx` - current top-3 and candidate-list coverage
* Evidence captured from code:
  * Main service currently seeds `vendorEntries.slice(0, 3)`.
  * Renderer fallback currently also derives `vendorEntries.slice(0, 3)`.
  * Candidate list already includes non-top3/global models, so this requirement is already satisfied.
  * User decision confirmed: use `claude-opus-4-6` as a real seeded default card, not just helper
    copy.
  * User direction confirmed: merge the site-priority editing flow into the redirect card detail
    dialog because the structures are similar.
  * User correction confirmed: no vendor classification in the UI; the integrated dialog should be
    organized by site/account/API key and show which selected original models are available on each
    entry.
  * Existing fixtures already include a source shape where `availableUserGroups = ['team-alpha']` and
    `availableApiKeys = []`, which supports the requested reminder-only behavior.
  * User decision confirmed: priority semantics must also move away from vendor scope and follow the
    current redirect-card scope.
  * Route impact identified: current runtime resolution only knows `canonicalModel`, so card-scoped
    priorities need an unambiguous mapping from canonical model to redirect card.

## Technical Approach

1. Replace vendor-grouped renderer sections with a flat redirection collection that renders persisted
   display items directly.
2. Change seeded default generation so reset/bootstrap produces only the single
   `claude-opus-4-6` example card when that canonical model exists.
3. Make redirect-card identity unambiguous for runtime routing by enforcing one redirect card per
   `canonicalName`.
4. Replace vendor-scoped priority types/storage/IPC with redirect-card-scoped equivalents.
5. In the integrated detail dialog:
   * group data by site/account/API-key entries for the current redirect card
   * show which selected original models each entry can serve
   * show reminder text under the corresponding site/account block for user groups that can use a
     selected original model but have no eligible API keys
   * exclude reminder-only groups from editable priority controls
6. Update route resolution and channel-serve checks to read the new redirect-card-scoped priority
   config without blending multiple cards for the same canonical name.
7. Update regression tests across renderer and main process.

## Decision (ADR-lite)

**Context**: The current page is overloaded because it seeds three redirect cards per vendor and renders
everything under vendor-grouped sections. The requested direction is to stop showing so many defaults
and keep only one example/default.

**Decision**: The system should seed and reset to a single real default redirect card for
`claude-opus-4-6`. Other redirects are manual. The redirection UI must no longer classify cards by
vendor, and priority editing/resolution must move to the current redirect-card scope. The integrated
dialog should be organized by site/account/API-key entries and show which selected original models are
served by each entry. Each `canonicalName` must correspond to exactly one redirect card.

**Consequences**:

* Main-process seeding and renderer fallback both need to stop generating vendor top-3 defaults.
* Tests that currently assert vendor top-3 behavior must be rewritten.
* This is now a cross-layer refactor rather than a renderer-only cleanup.
* Old vendor-scoped priority data becomes legacy behavior and should not remain the active runtime
  contract once the new redirect-card-scoped flow ships.
* Runtime routing must not blend multiple display items for the same canonical name; uniqueness is now
  part of the product contract.
