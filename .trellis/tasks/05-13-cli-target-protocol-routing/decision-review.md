# Decision Review: CLI Target Protocol Routing

## Review Status

Approved for PRD capture with implementation constraints.

The confirmed decisions are coherent as a product direction: CLI clients keep using their native local route proxy endpoints, while each routed upstream channel can select a target protocol endpoint and the route proxy performs request/response adaptation in both directions.

The feature is high-risk because it touches routing, protocol conversion, persisted configuration, CLI detection, health/statistics keys, migration, and UI. Implementation should be split into small reviewable slices and guarded by protocol-level tests.

## Confirmed Decisions

- Store a target protocol mode per CLI config item, not as a raw endpoint string.
- UI displays the effective target endpoint directly.
- Site CLI config places the endpoint selector next to each CLI's API key selector.
- Custom CLI config places an endpoint selector in each CLI config block before that CLI's preview action.
- The shared selectable target protocols are:
  - `native` -> the source CLI's native endpoint.
  - `anthropic-messages` -> `POST /v1/messages`.
  - `openai-chat-completions` -> `POST /v1/chat/completions`.
  - `openai-responses` -> `POST /v1/responses`.
- When a selected target protocol is equivalent to the source CLI's native endpoint, runtime behavior is native passthrough and the UI should explain that equivalence.
- Source CLI local entrypoints remain native:
  - Claude Code enters local route proxy through `/v1/messages`.
  - Codex enters local route proxy through `/v1/responses`.
  - Gemini CLI enters local route proxy through `/v1beta/models/{model}:streamGenerateContent`.
- The selected endpoint is the upstream target endpoint after routing, not the endpoint used by the local CLI client.
- The route proxy must adapt request and response bodies both ways for non-native targets.
- First implementation scope includes the full matrix from all three source CLI protocols to all explicit target protocols, at a real CLI usability level.
- Required protocol behavior includes streaming, core tool calling, text messages, error conversion, and usage preservation where possible.
- Multimodal content is best-effort; unsupported content must fail explicitly rather than being silently dropped.
- If an upstream responds non-streaming to a source CLI streaming request, the adapter may synthesize source-compatible streaming output.
- Usage/token analytics should prefer upstream target protocol usage, then fall back to converted response usage or estimates.
- Real CLI authentication remains unchanged: local route proxy authenticates with the route unified API key, then substitutes the target channel's upstream API key internally.
- Real route requests use the target protocol from the selected routed channel, not a global CLI setting.
- Different channels under the same route rule may use different target protocols.
- Protocol conversion failures before response bytes are written may fail the current channel and retry another candidate.
- Protocol conversion failures after streaming has started cannot safely retry and should terminate the current response.
- CLI detection must go through the local route proxy for both site manual tests and route probe tests.
- CLI detection may use internal probe-lock metadata to target an exact site/account/API key/model/channel.
- Probe-lock metadata is internal only, requires loopback plus route unified API key authentication, and must never be forwarded upstream.
- Probe-lock tests construct a temporary target channel and do not require an existing route rule.
- Probe-lock tests do not retry or fallback to other channels.
- Manual tests may test disabled API keys, but automatic probes skip disabled sites/accounts/API keys.
- Route runtime disabled paths do not block probing.
- Successful probing does not automatically clear route runtime disabled state; the existing "restore path" route UI remains the recovery control.
- Probe samples must store `targetProtocol` and effective `targetEndpoint`.
- Current availability state must ignore samples whose endpoint/protocol differs from current configuration.
- History remains retained; endpoint details are only shown in hover/tooltip context, not in the history bar.
- Route runtime path state and analytics keys must include target protocol to avoid mixing endpoint health.
- Default for new and old configs is `native`.
- The v2.1.24-to-latest migration script should explicitly write `targetProtocol: 'native'` into migrated CLI config items.
- No automatic CHY API migration should occur.
- CHY API special-case logic, naming, and dedicated tests must be removed completely.
- Reusable CHY conversion logic may be generalized into a neutral protocol adapter module, but no CHY-specific branches or tests should remain.
- Tests should be protocol-level HTTP simulations plus integration tests; automated real CLI process execution is out of scope for CI and should be manual release validation.

## Review Findings

### Accepted Strengths

- The endpoint selection is tied to the upstream channel, which matches the actual capability boundary: endpoint support belongs to a site/API key/channel, not to the local CLI process.
- Keeping the local CLI entrypoint native avoids breaking real CLI clients that cannot arbitrarily switch protocols.
- Recording target protocol in probe and runtime state prevents stale health data from one endpoint being reused for another endpoint.
- Replacing CHY-specific behavior with a generic adapter reduces long-term special-case maintenance.
- The internal probe-lock design solves precise CLI detection without weakening normal route rule behavior.

### Required Constraints

- The persisted configuration must use protocol enums, not endpoint strings.
- Endpoint display must be derived from protocol enum and source CLI type.
- Any unsupported content conversion must fail explicitly with a typed adapter error.
- Probe-lock headers must be stripped before forwarding upstream.
- Runtime stats, disabled path state, analytics, and latest probe projection must all include target protocol in matching logic.
- Migration must be backward-compatible and deterministic.

### Implementation Risks

- Full matrix protocol conversion is substantially larger than the original `/v1/chat/completions` problem.
- Streaming event conversion can become the highest-risk part because retry behavior changes after bytes are written.
- Tool call round-trips differ across Anthropic Messages, OpenAI Chat Completions, OpenAI Responses, and Gemini native source requests.
- Current CHY tests may only cover part of the required matrix and must not be mistaken for full coverage.
- If UI current-state projection ignores target protocol in one path, stale success states will be shown after endpoint changes.

### Recommended Implementation Slices

1. Add shared target protocol types, endpoint derivation helpers, config normalization, and migration tests.
2. Introduce a neutral CLI protocol adapter module with native passthrough and request/response adapter contracts.
3. Port and generalize existing CHY conversion behavior into the new adapter without CHY naming.
4. Implement the remaining target protocol matrix with focused protocol tests.
5. Add route proxy target protocol resolution per selected channel.
6. Add probe-lock execution through local route proxy and route proxy auto-enable behavior for CLI detection.
7. Add target protocol into probe samples, availability projection, runtime path keys, and analytics.
8. Update site/custom CLI UI and tooltip behavior.
9. Remove CHY-specific files/tests/index entries.
10. Add final integration tests and documentation/index updates.

## Open Implementation Notes

- The adapter should expose both high-level routing hooks and low-level pure conversion functions so tests can cover conversion behavior without starting an HTTP server.
- The route proxy should report adapter stage in route logs: `request-adapt`, `upstream`, or `response-adapt`.
- If multiple target protocols are implemented in one PR, test failures will be hard to localize. Prefer small incremental commits.
