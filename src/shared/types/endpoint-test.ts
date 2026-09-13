/** Shared contracts for manual upstream endpoint tests. */

export const ENDPOINT_TEST_PROTOCOLS = [
  'anthropic-messages',
  'openai-responses',
  'openai-chat-completions',
] as const;

export type EndpointTestProtocol = (typeof ENDPOINT_TEST_PROTOCOLS)[number];

export type EndpointTestTarget =
  | { kind: 'managed'; siteId: string; accountId: string }
  | { kind: 'direct'; configId: string };

export interface EndpointTestApiKeyOption {
  id: string;
  label: string;
  /** Display-only masked credential; the raw key must never cross the IPC boundary. */
  maskedApiKey?: string;
  group?: string;
  models?: string[];
}

export interface EndpointTestResult {
  success: boolean;
  endpoint: string;
  apiKeyId: string;
  apiKeyLabel: string;
  model: string;
  testedAt: number;
  latencyMs: number;
  statusCode?: number;
  summary?: string;
  error?: string;
}

export interface EndpointTestSelectionState {
  apiKeyId: string | null;
  model: string | null;
  curl?: string;
  latest?: EndpointTestResult;
}

export interface EndpointTestTargetState {
  targetKey: string;
  protocols: Partial<Record<EndpointTestProtocol, EndpointTestSelectionState>>;
  updatedAt: number;
}

export interface EndpointTestStateView {
  target: EndpointTestTarget;
  targetKey: string;
  baseUrl: string;
  apiKeys: EndpointTestApiKeyOption[];
  models: string[];
  protocols: Record<EndpointTestProtocol, EndpointTestSelectionState>;
}

export interface EndpointTestSelectionInput {
  target: EndpointTestTarget;
  protocol: EndpointTestProtocol;
  apiKeyId: string;
  model: string;
  curl?: string;
}
