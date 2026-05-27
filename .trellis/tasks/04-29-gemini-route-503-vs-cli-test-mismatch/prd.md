# Gemini Route 503 vs CLI Test Mismatch

## Goal
Diagnose and fix the mismatch where Gemini requests fail with upstream HTTP 503 in the route flow,
while CLI testing the original `duckcoding` model succeeds.

## Requirements
- Trace the Gemini route request path and the CLI test request path for the same site/model.
- Identify why the routed Gemini request gets HTTP 503 while direct CLI testing succeeds.
- Fix the mismatch at the minimal correct layer once the root cause is confirmed.
- Preserve existing route, CLI test, and model-selection behavior outside of the bug fix.

## Acceptance Criteria
- [ ] The root cause of the Gemini route 503 vs CLI test success mismatch is identified.
- [ ] Routed Gemini requests for the affected original model no longer fail for the identified cause.
- [ ] Existing CLI test behavior for the same original model still succeeds.
- [ ] Regression coverage or verification steps cover the identified mismatch.

## Technical Notes
- Expected scope may span renderer, main-process routing, and shared route/model contracts.
- Prefer fixing request/model resolution or route selection logic instead of adding one-off special
  cases unless the evidence proves the issue is site-specific.
