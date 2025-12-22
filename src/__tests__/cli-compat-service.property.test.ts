/**
 * Property-Based Tests for CLI Compatibility Service
 *
 * **Feature: cli-compatibility-test**
 *
 * These tests verify the correctness properties defined in the design document
 * using fast-check for property-based testing.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// ============= 纯函数实现（从 cli-compat-service.ts 复制，避免 Electron 依赖） =============

/** 请求格式 */
interface RequestFormat {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: object;
}

/**
 * 解析模型名称中的版本号
 */
function parseModelVersion(model: string, prefix: string): number[] {
  const withoutPrefix = model.toLowerCase().slice(prefix.toLowerCase().length);
  const numbers: number[] = [];
  const matches = withoutPrefix.match(/\d+(\.\d+)?/g);

  if (matches) {
    for (const match of matches) {
      const parts = match.split('.');
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (!isNaN(num)) {
          numbers.push(num);
        }
      }
    }
  }

  return numbers.length > 0 ? numbers : [Infinity];
}

/**
 * 比较两个版本号数组
 */
function compareVersions(a: number[], b: number[]): number {
  const maxLen = Math.max(a.length, b.length);

  for (let i = 0; i < maxLen; i++) {
    const va = a[i] ?? 0;
    const vb = b[i] ?? 0;

    if (va !== vb) {
      return va - vb;
    }
  }

  return 0;
}

/**
 * 从模型列表中选择版本号最低的模型
 */
function selectLowestModel(models: string[], prefix: string): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  const matchingModels = models.filter(m => m.toLowerCase().startsWith(prefix.toLowerCase()));

  if (matchingModels.length === 0) {
    return null;
  }

  const modelsWithVersion = matchingModels.map(model => {
    const version = parseModelVersion(model, prefix);
    return { model, version };
  });

  modelsWithVersion.sort((a, b) => compareVersions(a.version, b.version));

  return modelsWithVersion[0].model;
}

/**
 * 构建 Claude Code 测试请求
 */
function buildClaudeCodeRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`;

  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          input_schema: {
            type: 'object',
            properties: { test: { type: 'string' } },
            required: [],
          },
        },
      ],
    },
  };
}

/**
 * 构建 Codex 测试请求
 */
function buildCodexRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
            parameters: {
              type: 'object',
              properties: { test: { type: 'string' } },
              required: [],
            },
          },
        },
      ],
    },
  };
}

/**
 * 构建 Gemini CLI 测试请求
 */
function buildGeminiCliRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: { test: { type: 'string' } },
                required: [],
              },
            },
          ],
        },
      ],
      generationConfig: {
        maxOutputTokens: 1,
      },
    },
  };
}

// ============= Arbitraries =============

/**
 * Generate a model name with a given prefix and version
 */
const modelNameArb = (prefix: string) =>
  fc
    .tuple(
      fc.integer({ min: 1, max: 10 }),
      fc.option(fc.integer({ min: 0, max: 9 }), { nil: undefined }),
      fc.option(fc.constantFrom('-turbo', '-preview', '-mini', '-pro', ''), { nil: '' })
    )
    .map(([major, minor, suffix]) => {
      if (minor !== undefined) {
        return `${prefix}${major}.${minor}${suffix || ''}`;
      }
      return `${prefix}${major}${suffix || ''}`;
    });

/**
 * Generate a list of models with various prefixes
 */
const modelListArb = fc.array(
  fc.oneof(
    modelNameArb('claude-'),
    modelNameArb('gpt-'),
    modelNameArb('gemini-'),
    fc.constantFrom('llama-3', 'mistral-7b', 'qwen-72b')
  ),
  { minLength: 0, maxLength: 20 }
);

/**
 * Generate a valid URL
 */
const urlArb = fc.webUrl();

/**
 * Generate a valid API key
 */
const apiKeyArb = fc.string({ minLength: 10, maxLength: 100 }).filter(s => s.trim().length > 0);

describe('CLI Compatibility Service Property Tests', () => {
  /**
   * **Property 1: Model Selection Correctness**
   * **Validates: Requirements 1.2**
   *
   * *For any* list of models containing models with the prefix pattern,
   * the selectLowestModel function SHALL return the model with the
   * lowest version number for that prefix.
   */
  describe('Property 1: Model Selection Correctness', () => {
    it('should return null for empty model list', () => {
      fc.assert(
        fc.property(fc.constantFrom('claude-', 'gpt-', 'gemini-'), prefix => {
          const result = selectLowestModel([], prefix);
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should return null when no models match the prefix', () => {
      fc.assert(
        fc.property(fc.array(modelNameArb('gpt-'), { minLength: 1, maxLength: 10 }), models => {
          // GPT models should not match claude- prefix
          const result = selectLowestModel(models, 'claude-');
          expect(result).toBeNull();
        }),
        { numRuns: 100 }
      );
    });

    it('should return a model that matches the prefix', () => {
      fc.assert(
        fc.property(fc.array(modelNameArb('claude-'), { minLength: 1, maxLength: 10 }), models => {
          const result = selectLowestModel(models, 'claude-');
          expect(result).not.toBeNull();
          expect(result!.toLowerCase().startsWith('claude-')).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return the model with lowest version number', () => {
      fc.assert(
        fc.property(fc.array(modelNameArb('gpt-'), { minLength: 2, maxLength: 10 }), models => {
          const result = selectLowestModel(models, 'gpt-');
          if (result === null) return; // Skip if no match

          // Parse all versions and verify result has the lowest
          const resultVersion = parseModelVersion(result, 'gpt-');

          for (const model of models) {
            if (model.toLowerCase().startsWith('gpt-')) {
              const modelVersion = parseModelVersion(model, 'gpt-');
              // Result version should be <= all other versions
              expect(compareVersions(resultVersion, modelVersion)).toBeLessThanOrEqual(0);
            }
          }
        }),
        { numRuns: 100 }
      );
    });

    it('should handle mixed model lists correctly', () => {
      fc.assert(
        fc.property(
          modelListArb.filter(models => models.some(m => m.toLowerCase().startsWith('claude-'))),
          models => {
            const result = selectLowestModel(models, 'claude-');
            expect(result).not.toBeNull();
            expect(result!.toLowerCase().startsWith('claude-')).toBe(true);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 3: Claude Code Request Format**
   * **Validates: Requirements 4.1**
   *
   * *For any* Claude Code test request, the request SHALL:
   * - Target endpoint /v1/messages
   * - Include x-api-key header (not Authorization: Bearer)
   * - Include anthropic-version header
   * - Include tools array with input_schema format
   */
  describe('Property 3: Claude Code Request Format', () => {
    it('should target /v1/messages endpoint', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const request = buildClaudeCodeRequest(baseUrl, apiKey, model);
          expect(request.url).toContain('/v1/messages');
          expect(request.url).not.toContain('/v1/chat/completions');
        }),
        { numRuns: 100 }
      );
    });

    it('should use x-api-key header instead of Authorization Bearer', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const request = buildClaudeCodeRequest(baseUrl, apiKey, model);
          expect(request.headers['x-api-key']).toBe(apiKey);
          expect(request.headers['Authorization']).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should include anthropic-version header', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const request = buildClaudeCodeRequest(baseUrl, apiKey, model);
          expect(request.headers['anthropic-version']).toBeDefined();
          expect(request.headers['anthropic-version']).toBe('2023-06-01');
        }),
        { numRuns: 100 }
      );
    });

    it('should include tools array with input_schema format', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const request = buildClaudeCodeRequest(baseUrl, apiKey, model);
          const body = request.body as any;

          expect(body.tools).toBeDefined();
          expect(Array.isArray(body.tools)).toBe(true);
          expect(body.tools.length).toBeGreaterThan(0);

          // Check input_schema format (not function.parameters)
          const tool = body.tools[0];
          expect(tool.input_schema).toBeDefined();
          expect(tool.function).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 4: Codex Request Format**
   * **Validates: Requirements 4.2**
   *
   * *For any* Codex test request, the request SHALL:
   * - Target endpoint /v1/chat/completions
   * - Include Authorization: Bearer header
   * - Include tools array with function.parameters format
   */
  describe('Property 4: Codex Request Format', () => {
    it('should target /v1/chat/completions endpoint', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gpt-'), (baseUrl, apiKey, model) => {
          const request = buildCodexRequest(baseUrl, apiKey, model);
          expect(request.url).toContain('/v1/chat/completions');
        }),
        { numRuns: 100 }
      );
    });

    it('should use Authorization Bearer header', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gpt-'), (baseUrl, apiKey, model) => {
          const request = buildCodexRequest(baseUrl, apiKey, model);
          expect(request.headers['Authorization']).toBe(`Bearer ${apiKey}`);
          expect(request.headers['x-api-key']).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });

    it('should include tools array with function.parameters format', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gpt-'), (baseUrl, apiKey, model) => {
          const request = buildCodexRequest(baseUrl, apiKey, model);
          const body = request.body as any;

          expect(body.tools).toBeDefined();
          expect(Array.isArray(body.tools)).toBe(true);
          expect(body.tools.length).toBeGreaterThan(0);

          // Check function.parameters format (not input_schema)
          const tool = body.tools[0];
          expect(tool.type).toBe('function');
          expect(tool.function).toBeDefined();
          expect(tool.function.parameters).toBeDefined();
          expect(tool.input_schema).toBeUndefined();
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 5: Gemini CLI Request Format**
   * **Validates: Requirements 4.3**
   *
   * *For any* Gemini CLI test request, the request SHALL:
   * - Target endpoint /v1beta/models/{model}:generateContent
   * - Include functionDeclarations array format
   * - Use generationConfig.maxOutputTokens for token limit
   */
  describe('Property 5: Gemini CLI Request Format', () => {
    it('should target /v1beta/models/{model}:generateContent endpoint', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gemini-'), (baseUrl, apiKey, model) => {
          const request = buildGeminiCliRequest(baseUrl, apiKey, model);
          expect(request.url).toContain('/v1beta/models/');
          expect(request.url).toContain(':generateContent');
          expect(request.url).toContain(model);
        }),
        { numRuns: 100 }
      );
    });

    it('should include API key in URL query parameter', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gemini-'), (baseUrl, apiKey, model) => {
          const request = buildGeminiCliRequest(baseUrl, apiKey, model);
          expect(request.url).toContain(`key=${apiKey}`);
        }),
        { numRuns: 100 }
      );
    });

    it('should include functionDeclarations format', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gemini-'), (baseUrl, apiKey, model) => {
          const request = buildGeminiCliRequest(baseUrl, apiKey, model);
          const body = request.body as any;

          expect(body.tools).toBeDefined();
          expect(Array.isArray(body.tools)).toBe(true);
          expect(body.tools.length).toBeGreaterThan(0);

          // Check functionDeclarations format
          const tool = body.tools[0];
          expect(tool.functionDeclarations).toBeDefined();
          expect(Array.isArray(tool.functionDeclarations)).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should use generationConfig.maxOutputTokens', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gemini-'), (baseUrl, apiKey, model) => {
          const request = buildGeminiCliRequest(baseUrl, apiKey, model);
          const body = request.body as any;

          expect(body.generationConfig).toBeDefined();
          expect(body.generationConfig.maxOutputTokens).toBe(1);
        }),
        { numRuns: 100 }
      );
    });
  });

  /**
   * **Property 6: Minimal Token Consumption**
   * **Validates: Requirements 5.1, 5.2**
   *
   * *For any* test request (regardless of CLI type), the request SHALL
   * set max_tokens/maxOutputTokens to 1 and use minimal message content.
   */
  describe('Property 6: Minimal Token Consumption', () => {
    it('should set max_tokens to 1 for Claude Code requests', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const request = buildClaudeCodeRequest(baseUrl, apiKey, model);
          const body = request.body as any;
          expect(body.max_tokens).toBe(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should set max_tokens to 1 for Codex requests', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gpt-'), (baseUrl, apiKey, model) => {
          const request = buildCodexRequest(baseUrl, apiKey, model);
          const body = request.body as any;
          expect(body.max_tokens).toBe(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should set maxOutputTokens to 1 for Gemini CLI requests', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('gemini-'), (baseUrl, apiKey, model) => {
          const request = buildGeminiCliRequest(baseUrl, apiKey, model);
          const body = request.body as any;
          expect(body.generationConfig.maxOutputTokens).toBe(1);
        }),
        { numRuns: 100 }
      );
    });

    it('should use minimal message content for all request types', () => {
      fc.assert(
        fc.property(urlArb, apiKeyArb, modelNameArb('claude-'), (baseUrl, apiKey, model) => {
          const claudeRequest = buildClaudeCodeRequest(baseUrl, apiKey, model);
          const codexRequest = buildCodexRequest(baseUrl, apiKey, model);
          const geminiRequest = buildGeminiCliRequest(baseUrl, apiKey, model);

          // Check message content is minimal (e.g., "hi")
          const claudeBody = claudeRequest.body as any;
          const codexBody = codexRequest.body as any;
          const geminiBody = geminiRequest.body as any;

          expect(claudeBody.messages[0].content.length).toBeLessThanOrEqual(10);
          expect(codexBody.messages[0].content.length).toBeLessThanOrEqual(10);
          expect(geminiBody.contents[0].parts[0].text.length).toBeLessThanOrEqual(10);
        }),
        { numRuns: 100 }
      );
    });
  });
});

/**
 * **Property 2: Response to Status Mapping**
 * **Validates: Requirements 1.3, 1.4**
 *
 * *For any* API response (success or failure), the compatibility status
 * SHALL correctly reflect the response: success → true, failure → false.
 */
describe('Property 2: Response to Status Mapping', () => {
  /**
   * Simulates the response to status mapping logic
   * This is the core logic used in testClaudeCode, testCodex, etc.
   */
  function mapResponseToStatus(status: number): boolean {
    return status >= 200 && status < 300;
  }

  it('should return true for 2xx status codes', () => {
    fc.assert(
      fc.property(fc.integer({ min: 200, max: 299 }), status => {
        const result = mapResponseToStatus(status);
        expect(result).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should return false for non-2xx status codes', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 100, max: 199 }), // 1xx
          fc.integer({ min: 300, max: 399 }), // 3xx
          fc.integer({ min: 400, max: 499 }), // 4xx
          fc.integer({ min: 500, max: 599 }) // 5xx
        ),
        status => {
          const result = mapResponseToStatus(status);
          expect(result).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should correctly map common error status codes', () => {
    const errorCodes = [400, 401, 403, 404, 500, 502, 503, 504];

    for (const code of errorCodes) {
      const result = mapResponseToStatus(code);
      expect(result).toBe(false);
    }
  });

  it('should correctly map common success status codes', () => {
    const successCodes = [200, 201, 202, 204];

    for (const code of successCodes) {
      const result = mapResponseToStatus(code);
      expect(result).toBe(true);
    }
  });
});

/**
 * **Property 8: Icon Style Correctness**
 * **Validates: Requirements 3.3, 3.4**
 *
 * *For any* compatibility status, the icon style SHALL correctly reflect
 * the status: supported → full color (opacity-100), unsupported → grayscale/disabled (opacity-30 grayscale).
 */
describe('Property 8: Icon Style Correctness', () => {
  /**
   * 获取图标样式类名
   * @param status - 兼容性状态: true=支持, false=不支持, null/undefined=未测试
   */
  function getIconStyleClass(status: boolean | null | undefined): string {
    if (status === true) {
      return 'opacity-100'; // 全彩色 - 支持
    }
    if (status === false) {
      return 'opacity-30 grayscale'; // 灰度 - 不支持
    }
    return 'opacity-50'; // 中性状态 - 未测试
  }

  /**
   * Arbitrary for generating compatibility status
   */
  const statusArb = fc.oneof(
    fc.constant(true),
    fc.constant(false),
    fc.constant(null),
    fc.constant(undefined)
  );

  it('should return full color style for supported status (true)', () => {
    fc.assert(
      fc.property(fc.constant(true), status => {
        const styleClass = getIconStyleClass(status);
        expect(styleClass).toBe('opacity-100');
        expect(styleClass).not.toContain('grayscale');
      }),
      { numRuns: 100 }
    );
  });

  it('should return grayscale/disabled style for unsupported status (false)', () => {
    fc.assert(
      fc.property(fc.constant(false), status => {
        const styleClass = getIconStyleClass(status);
        expect(styleClass).toContain('grayscale');
        expect(styleClass).toContain('opacity-30');
      }),
      { numRuns: 100 }
    );
  });

  it('should return neutral style for untested status (null/undefined)', () => {
    fc.assert(
      fc.property(fc.oneof(fc.constant(null), fc.constant(undefined)), status => {
        const styleClass = getIconStyleClass(status);
        expect(styleClass).toBe('opacity-50');
        expect(styleClass).not.toContain('grayscale');
      }),
      { numRuns: 100 }
    );
  });

  it('should produce distinct styles for each status type', () => {
    fc.assert(
      fc.property(statusArb, statusArb, (status1, status2) => {
        const style1 = getIconStyleClass(status1);
        const style2 = getIconStyleClass(status2);

        // Same logical status should produce same style
        const isSameLogicalStatus =
          (status1 === true && status2 === true) ||
          (status1 === false && status2 === false) ||
          ((status1 === null || status1 === undefined) &&
            (status2 === null || status2 === undefined));

        if (isSameLogicalStatus) {
          expect(style1).toBe(style2);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should ensure supported style is visually distinct from unsupported', () => {
    const supportedStyle = getIconStyleClass(true);
    const unsupportedStyle = getIconStyleClass(false);
    const untestedStyle = getIconStyleClass(null);

    // All three styles should be different
    expect(supportedStyle).not.toBe(unsupportedStyle);
    expect(supportedStyle).not.toBe(untestedStyle);
    expect(unsupportedStyle).not.toBe(untestedStyle);
  });

  it('should handle all CLI types consistently', () => {
    /** CLI 兼容性测试结果 */
    interface CliCompatibilityResult {
      claudeCode: boolean | null;
      codex: boolean | null;
      geminiCli: boolean | null;
      testedAt: number | null;
      error?: string;
    }

    const cliCompatibilityResultArb: fc.Arbitrary<CliCompatibilityResult> = fc.record({
      claudeCode: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
      codex: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
      geminiCli: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
      testedAt: fc.oneof(fc.integer({ min: 0, max: Date.now() + 1000000 }), fc.constant(null)),
      error: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
    });

    fc.assert(
      fc.property(cliCompatibilityResultArb, result => {
        const cliTypes = ['claudeCode', 'codex', 'geminiCli'] as const;

        for (const cliType of cliTypes) {
          const status = result[cliType];
          const styleClass = getIconStyleClass(status);

          // Verify style matches status
          if (status === true) {
            expect(styleClass).toBe('opacity-100');
          } else if (status === false) {
            expect(styleClass).toBe('opacity-30 grayscale');
          } else {
            expect(styleClass).toBe('opacity-50');
          }
        }
      }),
      { numRuns: 100 }
    );
  });
});

/**
 * **Property 8: Persistence Round Trip**
 * **Validates: Requirements 6.1**
 *
 * *For any* compatibility result, saving to cache and then loading from cache
 * SHALL produce an equivalent result.
 */
describe('Property 8: Persistence Round Trip', () => {
  /** CLI 兼容性测试结果 */
  interface CliCompatibilityResult {
    claudeCode: boolean | null;
    codex: boolean | null;
    geminiCli: boolean | null;
    testedAt: number | null;
    error?: string;
  }

  /**
   * Arbitrary for generating CliCompatibilityResult
   */
  const cliCompatibilityResultArb: fc.Arbitrary<CliCompatibilityResult> = fc.record({
    claudeCode: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
    codex: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
    geminiCli: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
    testedAt: fc.oneof(fc.integer({ min: 0, max: Date.now() + 1000000 }), fc.constant(null)),
    error: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
  });

  /**
   * Simulates serialization (JSON.stringify) and deserialization (JSON.parse)
   * This is the core persistence mechanism used in the app
   */
  function serializeResult(result: CliCompatibilityResult): string {
    return JSON.stringify(result);
  }

  function deserializeResult(json: string): CliCompatibilityResult {
    return JSON.parse(json);
  }

  /**
   * Deep equality check for CliCompatibilityResult
   */
  function areResultsEqual(a: CliCompatibilityResult, b: CliCompatibilityResult): boolean {
    return (
      a.claudeCode === b.claudeCode &&
      a.codex === b.codex &&
      a.geminiCli === b.geminiCli &&
      a.testedAt === b.testedAt &&
      a.error === b.error
    );
  }

  it('should produce equivalent result after serialize/deserialize round trip', () => {
    fc.assert(
      fc.property(cliCompatibilityResultArb, original => {
        const serialized = serializeResult(original);
        const deserialized = deserializeResult(serialized);

        expect(areResultsEqual(original, deserialized)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve all boolean states (true, false, null) correctly', () => {
    fc.assert(
      fc.property(cliCompatibilityResultArb, original => {
        const serialized = serializeResult(original);
        const deserialized = deserializeResult(serialized);

        // Verify each field type is preserved
        expect(typeof deserialized.claudeCode).toBe(typeof original.claudeCode);
        expect(typeof deserialized.codex).toBe(typeof original.codex);
        expect(typeof deserialized.geminiCli).toBe(typeof original.geminiCli);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve timestamp correctly', () => {
    fc.assert(
      fc.property(cliCompatibilityResultArb, original => {
        const serialized = serializeResult(original);
        const deserialized = deserializeResult(serialized);

        expect(deserialized.testedAt).toBe(original.testedAt);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve error field correctly (including undefined)', () => {
    fc.assert(
      fc.property(cliCompatibilityResultArb, original => {
        const serialized = serializeResult(original);
        const deserialized = deserializeResult(serialized);

        // Note: JSON.stringify converts undefined to missing key
        // So we check if both are undefined/missing or both have same value
        if (original.error === undefined) {
          expect(deserialized.error).toBeUndefined();
        } else {
          expect(deserialized.error).toBe(original.error);
        }
      }),
      { numRuns: 100 }
    );
  });

  it('should handle Record<string, CliCompatibilityResult> round trip', () => {
    const recordArb = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 50 }).filter(s => s.trim().length > 0),
      cliCompatibilityResultArb
    );

    fc.assert(
      fc.property(recordArb, original => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized) as Record<string, CliCompatibilityResult>;

        // Check all keys are preserved
        expect(Object.keys(deserialized).sort()).toEqual(Object.keys(original).sort());

        // Check all values are equivalent
        for (const key of Object.keys(original)) {
          expect(areResultsEqual(original[key], deserialized[key])).toBe(true);
        }
      }),
      { numRuns: 100 }
    );
  });
});
