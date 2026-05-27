# Brainstorm: CLI Target Protocol Routing

## Goal

Allow each site CLI config item and custom CLI config item to choose the upstream target protocol endpoint used after local route proxy selection, so CLI requests can be routed through sites that only support a subset of protocol endpoints while keeping the local CLI client protocol unchanged.

This replaces the current CHY API public-site special case with a generic per-channel protocol adapter system.

## What I Already Know

- Current route CLI source types are `claudeCode`, `codex`, and `geminiCli`.
- Current local route proxy source path detection maps:
  - `claudeCode` -> `/v1/messages`.
  - `codex` -> `/v1/responses`.
  - `geminiCli` -> `/v1beta/`.
- Current site/account CLI config items contain API key, model, test model/result, enabled state, edited files, and apply mode fields.
- Current custom CLI settings are stored per CLI under `cliSettings.claudeCode`, `cliSettings.codex`, and `cliSettings.geminiCli`.
- Current route proxy has CHY API special-case logic that rewrites requests to `/v1/chat/completions`.
- Current route CLI probes and site manual CLI compatibility tests call site URLs directly, then persist results into route probe history.
- Custom CLI configs are already represented as synthetic route channels using structured virtual IDs, so protocol lookup should use channel IDs rather than inferring ownership from `baseUrl/apiKey`.

## Requirements

### Target Protocol Configuration

- Add a shared target protocol enum:
  - `native`
  - `anthropic-messages`
  - `openai-chat-completions`
  - `openai-responses`
- Store `targetProtocol?: CliTargetProtocol` on each site/account `CliConfigItem`.
- Store `targetProtocol?: CliTargetProtocol` on each `CustomCliSettings`.
- Normalize missing `targetProtocol` to `native` at runtime.
- New configs default to `native`.
- The v2.1.24-to-latest migration script must explicitly write `targetProtocol: 'native'` for migrated CLI config items.
- Do not automatically migrate CHY API public-site configs to any non-native protocol.

### Endpoint Semantics

- The user-selected endpoint is the upstream target endpoint used after routing.
- The local CLI still calls the local route proxy through its own native endpoint.
- `native` means transparent passthrough of the source CLI request path/body/response, except for existing route model and credential substitution.
- Explicit target protocols mean the route proxy converts the source CLI request into the selected target protocol and converts the upstream response back into the source CLI protocol.
- If the selected target endpoint is equivalent to the source CLI's native endpoint, runtime behavior is native passthrough and UI must explain this equivalence.
- Endpoint labels must be derived from target protocol plus source CLI type, not stored as raw endpoint strings.

### Shared UI Options

- All CLI config items show the same selectable protocol list.
- Effective displayed endpoints:
  - `native`: source CLI native endpoint.
  - `anthropic-messages`: `POST /v1/messages`.
  - `openai-chat-completions`: `POST /v1/chat/completions`.
  - `openai-responses`: `POST /v1/responses`.
- Site CLI config dialog: place the endpoint selector next to each CLI's API key selector.
- Custom CLI editor: each CLI config block gets its own endpoint selector before that CLI's preview action.
- The UI must clarify that the selected endpoint is the upstream endpoint, not the local CLI entrypoint.

### Route Proxy Behavior

- Resolve target protocol from the selected routed channel:
  - Account-level CLI config first.
  - Site-level CLI config second.
  - Custom CLI config settings for synthetic custom CLI channels.
  - `native` fallback.
- Do not infer target protocol ownership from `baseUrl/apiKey` except as a future best-effort recovery path.
- Allow different candidate channels under the same route rule to use different target protocols.
- Use the selected channel's resolved upstream model in adapted request bodies.
- Preserve the existing local route proxy unified API key authentication model.
- Replace upstream credentials internally with the target channel's API key.

### Protocol Adapter Matrix

- Implement real CLI usable conversion across all source CLIs and explicit target protocols:
  - Source CLIs: Claude Code, Codex, Gemini CLI.
  - Targets: Anthropic Messages, OpenAI Chat Completions, OpenAI Responses.
  - Native passthrough for each source CLI.
- Required conversion support:
  - Streaming SSE response conversion.
  - Non-streaming upstream JSON converted into source-compatible streaming output when the source CLI expects streaming.
  - Text message conversion.
  - Core tool/function definition conversion.
  - Core tool call and tool result conversion.
  - Error response conversion back to source CLI compatible shape.
  - Usage preservation where available.
- Best-effort conversion:
  - Reasoning/thinking metadata.
  - Provider-specific metadata.
  - Multimodal content only when a safe equivalent exists.
- Unsupported content must fail explicitly with an adapter error rather than being silently dropped.
- Usage/token analytics prefer upstream target protocol usage, then converted response usage, then fallback estimates.

### Retry and Error Handling

- Include conversion direction in logs and user-facing errors:
  - Source CLI type.
  - Source endpoint.
  - Target protocol.
  - Target endpoint.
  - Site/account/API key identifiers.
  - Adapter stage: `request-adapt`, `upstream`, `response-adapt`.
- If request adaptation fails before writing client response bytes, mark the current channel failed and try the next candidate channel.
- If upstream response adaptation fails before writing client response bytes, mark the current channel failed and try the next candidate channel.
- If streaming response bytes have already been written to the client, do not retry another channel; terminate the response and record failure.

### CLI Detection Through Local Route Proxy

- Site manual CLI tests and route automatic CLI probes must go through the local route proxy.
- Detection must target the exact site/account/API key/model under test.
- Add internal probe-lock metadata accepted only by the route proxy:
  - Target site ID.
  - Target account ID.
  - Target API key ID.
  - Target model.
  - Source CLI type.
- Probe-lock metadata must:
  - Require route unified API key authentication.
  - Require loopback client address.
  - Use internal header names.
  - Never be forwarded upstream.
  - Not be documented as a user route-control feature.
- Probe-lock tests build a temporary target channel and do not require an existing route rule.
- Probe-lock tests do not retry or fallback to another channel.
- CLI detection requests authenticate to the local route proxy with the route unified API key only; upstream API keys are resolved internally by ID.
- If CLI detection needs the route proxy and it is disabled, enable the route proxy setting directly.
- If route unified API key is missing when enabling route proxy for detection, generate and save one.
- If the configured route proxy port is occupied, return a clear error instead of silently changing the port.

### Probe and Availability State

- Store `targetProtocol` and effective `targetEndpoint` on route CLI probe samples.
- Store and match current availability by target protocol.
- Samples whose target protocol differs from current config do not contribute to current availability state.
- Keep historical samples even when endpoint changes.
- History bars do not show endpoint text directly.
- Tooltips/hover details show endpoint/protocol and explain when a historical sample differs from current config.
- Manual tests may test disabled API keys and should report that status.
- Automatic probes skip disabled sites/accounts/API keys.
- Route runtime disabled path state must not block probe-lock tests.
- Probe success does not automatically clear runtime disabled path state; use the existing "restore path" route control.

### Route Runtime State and Analytics

- Include target protocol in route runtime path state matching.
- Include target protocol in route analytics/statistics bucket matching.
- Old runtime state without target protocol is treated as `native`.
- Endpoint-specific failures must not disable or reduce health for another endpoint on the same site/account/API key/model.

### CHY API Special Case Removal

- Remove all CHY API public-site special-case route proxy branches.
- Remove CHY-specific adapter file naming.
- Remove CHY-specific tests.
- Generalize any reusable conversion logic into a neutral CLI protocol adapter module.
- Update folder/project indexes that currently mention CHY-specific protocol handling.

## Acceptance Criteria

- [ ] Site/account CLI config items persist and restore `targetProtocol`.
- [ ] Custom CLI settings persist and restore `targetProtocol` per CLI.
- [ ] Missing `targetProtocol` normalizes to `native`.
- [ ] The v2.1.24 migration script writes `targetProtocol: 'native'` into migrated CLI config items.
- [ ] Site CLI config dialog shows endpoint selection next to each CLI API key selector.
- [ ] Custom CLI editor shows one endpoint selector per CLI block before that CLI preview action.
- [ ] UI displays effective endpoint labels derived from protocol and source CLI type.
- [ ] Route proxy resolves target protocol from the selected channel.
- [ ] Native passthrough remains behaviorally compatible with current route proxy behavior.
- [ ] All explicit target protocol conversions are covered by unit tests for Claude Code, Codex, and Gemini CLI source requests.
- [ ] Streaming upstream responses convert back into source CLI compatible streaming responses.
- [ ] Non-streaming upstream JSON can be converted into source CLI compatible streaming output when required.
- [ ] Core tool definitions, tool calls, and tool results survive protocol conversion.
- [ ] Unsupported content fails explicitly rather than being silently dropped.
- [ ] Route proxy logs include conversion direction and adapter stage for adapter failures.
- [ ] Site manual CLI detection and route automatic probes execute through local route proxy.
- [ ] Probe-lock metadata targets the exact site/account/API key/model without requiring a route rule.
- [ ] Probe-lock metadata is accepted only for authenticated loopback requests and stripped before upstream forwarding.
- [ ] Detection auto-enables route proxy and creates a missing route unified API key.
- [ ] Detection reports port conflicts clearly.
- [ ] Probe samples store target protocol and target endpoint.
- [ ] Current availability ignores samples with a different target protocol than current config.
- [ ] Tooltip details show endpoint/protocol while the history bar stays compact.
- [ ] Route runtime disabled path and analytics keys include target protocol.
- [ ] CHY-specific route proxy branch, files, tests, and index references are removed or replaced with generic adapter references.
- [ ] Existing route proxy, CLI config, custom CLI, migration, and route probe tests are updated.

## Definition of Done

- Tests added or updated for shared type normalization, migration, UI persistence, protocol adapter conversion, route proxy integration, probe-lock detection, and analytics/path-state target protocol keys.
- Lint, typecheck, and relevant Vitest suites pass.
- `PROJECT_INDEX.md` and affected `FOLDER_INDEX.md` files are updated for new/removed modules.
- Configuration import/export and backup behavior preserves `targetProtocol`.
- Release/manual validation notes include real Claude Code, Codex, and Gemini CLI smoke tests through local route proxy.

## Technical Approach

Add a shared protocol configuration layer first, then insert a neutral protocol adapter between route channel selection and upstream forwarding.

The route proxy continues to identify the incoming source CLI from the local request path. After selecting or probe-locking a channel, it resolves the target protocol from that channel's CLI settings, derives the upstream endpoint, adapts the request, forwards with the channel's upstream credentials, adapts the response back to the source CLI protocol, and records stats keyed by target protocol.

CLI detection should use the same route proxy path as real CLI traffic, with internal probe-lock metadata to force the exact channel under test.

## Decision (ADR-lite)

**Context**: Some sites only support specific upstream protocol endpoints such as `/v1/chat/completions`, while local CLI clients still emit their own native protocols. Existing CHY API handling solved one site through a special-case branch, but this does not scale and causes route/detection behavior to diverge.

**Decision**: Add per-CLI target protocol selection to site/account and custom CLI configs. Keep local CLI entrypoints native. Adapt upstream requests/responses inside the route proxy according to the selected channel's target protocol. Route all CLI detection through the local route proxy using internal probe-lock metadata. Remove CHY-specific special handling.

**Consequences**: The design provides consistent route and detection behavior and replaces a site-specific workaround with a general capability. It also requires a full protocol conversion matrix, target-protocol-aware health/statistics state, and careful streaming/tool-call tests.

## Out of Scope

- Public user-facing route-control headers for manually pinning channels.
- Automatic CHY API public-site migration to a non-native target protocol.
- Silent conversion or dropping of unsupported multimodal content.
- Automated CI execution of real Claude Code, Codex, or Gemini CLI binaries.
- Adding a new "restore path" UI control; the existing route "restore path" control remains the recovery path.
- Changing local route proxy authentication semantics.

## Technical Notes

Likely affected files from code inspection:

- `src/shared/types/cli-config.ts`
- `src/shared/types/custom-cli-config.ts`
- `src/shared/types/site.ts`
- `src/shared/types/route-proxy.ts`
- `src/main/route-proxy-service.ts`
- `src/main/route-channel-resolver.ts`
- `src/main/route-cli-probe-service.ts`
- `src/main/cli-compat-service.ts`
- `src/main/cli-wrapper-compat-service.ts`
- `src/main/handlers/cli-compat-handlers.ts`
- `src/main/unified-config-manager.ts`
- `src/main/chy-api-request-rewriter.ts`
- `src/renderer/components/dialogs/UnifiedCliConfigDialog.tsx`
- `src/renderer/components/dialogs/CustomCliConfigEditorDialog.tsx`
- `src/renderer/pages/CustomCliPage.tsx`
- `src/renderer/services/cli-compat-projection.ts`
- Migration scripts/tests for v2.1.24 to latest configuration.

Recommended new/renamed module:

- `src/main/cli-protocol-adapter.ts`

Existing CHY conversion tests should become generic protocol adapter tests rather than site-name-specific tests.

## Implementation Plan

1. Add shared protocol enum, endpoint label helpers, config normalization, and migration coverage.
2. Add neutral protocol adapter contracts and native passthrough tests.
3. Generalize reusable CHY conversion logic into protocol adapter code with CHY naming removed.
4. Complete all explicit target protocol conversions with focused unit tests.
5. Integrate target protocol resolution into route proxy forwarding.
6. Add internal probe-lock routing and detection through local route proxy.
7. Add target protocol to probe projection, runtime path state, and analytics keys.
8. Update site/custom CLI UI and persistence.
9. Remove CHY-specific branches/tests/index entries.
10. Run focused tests, lint/typecheck, and update project indexes.
