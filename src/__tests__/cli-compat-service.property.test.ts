/**
 * 输入: 模拟的 CLI 兼容性测试参数
 * 输出: 属性测试验证结果
 * 定位: 测试层 - CLI 兼容性服务的属性测试，验证双端点测试完整性
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 *
 * **功能: cli-compatibility-test**
 * 使用 fast-check 进行属性测试，验证设计文档中定义的正确性属性
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
 * 使用正则表达式匹配模型类型
 */
function findModelByType(models: string[], type: 'claude' | 'gpt' | 'gemini'): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  const patterns: Record<string, RegExp[]> = {
    claude: [/^claude[-_]?/i, /^anthropic[-_]?/i, /^claude\d/i],
    gpt: [/^gpt[-_]?/i, /^openai[-_]?/i, /^chatgpt[-_]?/i, /^o[134][-_]?/i, /^gpt\d/i],
    gemini: [/^gemini[-_]?/i, /^google[-_]?/i, /^gemini\d/i],
  };

  const regexList = patterns[type];
  if (!regexList) {
    return null;
  }

  for (const regex of regexList) {
    const matchingModels = models.filter(m => regex.test(m));
    if (matchingModels.length > 0) {
      return matchingModels[0];
    }
  }

  return null;
}

/**
 * 检查响应是否表示 API 支持
 */
function isApiSupported(status: number, data: any): boolean {
  if (status >= 200 && status < 300) {
    if (data?.error) {
      const errorType = data.error.type || data.error.code || '';
      const errorMessage = data.error.message || '';
      const supportedErrors = [
        'invalid_request_error',
        'invalid_api_key',
        'authentication_error',
        'rate_limit_error',
        'insufficient_quota',
      ];
      if (supportedErrors.some(e => errorType.includes(e) || errorMessage.includes(e))) {
        return true;
      }
      return false;
    }
    return true;
  }

  if (status === 401 || status === 403 || status === 429) {
    return true;
  }

  if (status === 400) {
    if (data?.error) {
      const errorType = data.error.type || data.error.code || '';
      const errorMessage = data.error.message || '';
      const supportedErrors = [
        'invalid_request_error',
        'invalid_model',
        'model_not_found',
        'invalid_api_key',
      ];
      if (supportedErrors.some(e => errorType.includes(e) || errorMessage.includes(e))) {
        return true;
      }
    }
  }

  return false;
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
    fc.constantFrom('llama-3', 'mistral-7b', 'qwen-72b', 'claude3', 'gpt4o', 'gemini1.5')
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
   * **Property 1b: Flexible Model Matching**
   * **Validates: Requirements 1.2 (improved)**
   *
   * *For any* list of models, the findModelByType function SHALL
   * match models with various naming conventions (with or without hyphen).
   */
  describe('Property 1b: Flexible Model Matching', () => {
    it('should match models without hyphen (e.g., claude3, gpt4o)', () => {
      const modelsWithoutHyphen = ['claude3', 'gpt4o', 'gemini1.5'];

      expect(findModelByType(modelsWithoutHyphen, 'claude')).toBe('claude3');
      expect(findModelByType(modelsWithoutHyphen, 'gpt')).toBe('gpt4o');
      expect(findModelByType(modelsWithoutHyphen, 'gemini')).toBe('gemini1.5');
    });

    it('should match models with hyphen (e.g., claude-3, gpt-4)', () => {
      const modelsWithHyphen = ['claude-3', 'gpt-4', 'gemini-1.5'];

      expect(findModelByType(modelsWithHyphen, 'claude')).toBe('claude-3');
      expect(findModelByType(modelsWithHyphen, 'gpt')).toBe('gpt-4');
      expect(findModelByType(modelsWithHyphen, 'gemini')).toBe('gemini-1.5');
    });

    it('should match o-series models as GPT', () => {
      const oSeriesModels = ['o1-preview', 'o3-mini', 'o4'];

      expect(findModelByType(oSeriesModels, 'gpt')).toBe('o1-preview');
    });

    it('should return null for empty model list', () => {
      expect(findModelByType([], 'claude')).toBeNull();
      expect(findModelByType([], 'gpt')).toBeNull();
      expect(findModelByType([], 'gemini')).toBeNull();
    });

    it('should return null when no models match', () => {
      const unrelatedModels = ['llama-3', 'mistral-7b', 'qwen-72b'];

      expect(findModelByType(unrelatedModels, 'claude')).toBeNull();
      expect(findModelByType(unrelatedModels, 'gpt')).toBeNull();
      expect(findModelByType(unrelatedModels, 'gemini')).toBeNull();
    });
  });

  /**
   * **Property 2b: Improved Response Validation**
   * **Validates: Requirements 1.3, 1.4 (improved)**
   *
   * *For any* API response, the isApiSupported function SHALL correctly
   * identify whether the API is supported based on status code and response body.
   */
  describe('Property 2b: Improved Response Validation', () => {
    it('should return true for 2xx status codes without error', () => {
      fc.assert(
        fc.property(fc.integer({ min: 200, max: 299 }), status => {
          expect(isApiSupported(status, {})).toBe(true);
          expect(isApiSupported(status, { choices: [] })).toBe(true);
        }),
        { numRuns: 100 }
      );
    });

    it('should return true for 401/403/429 (auth/rate limit errors indicate API exists)', () => {
      expect(isApiSupported(401, {})).toBe(true);
      expect(isApiSupported(403, {})).toBe(true);
      expect(isApiSupported(429, {})).toBe(true);
    });

    it('should return true for 400 with known error types', () => {
      expect(isApiSupported(400, { error: { type: 'invalid_request_error' } })).toBe(true);
      expect(isApiSupported(400, { error: { type: 'invalid_model' } })).toBe(true);
      expect(isApiSupported(400, { error: { code: 'model_not_found' } })).toBe(true);
    });

    it('should return false for 404/500 errors', () => {
      expect(isApiSupported(404, {})).toBe(false);
      expect(isApiSupported(500, {})).toBe(false);
      expect(isApiSupported(502, {})).toBe(false);
      expect(isApiSupported(503, {})).toBe(false);
    });

    it('should return true for 200 with rate_limit_error in body', () => {
      expect(isApiSupported(200, { error: { type: 'rate_limit_error' } })).toBe(true);
      expect(isApiSupported(200, { error: { type: 'insufficient_quota' } })).toBe(true);
    });

    it('should return false for 200 with unknown error in body', () => {
      expect(isApiSupported(200, { error: { type: 'unknown_error' } })).toBe(false);
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

/**
 * **Property 9: Gemini CLI 双端点测试完整性**
 * **Validates: Requirements 1.1, 1.2**
 *
 * *For any* Gemini CLI compatibility test invocation, the system SHALL test both
 * native and proxy endpoints and return a result containing `geminiDetail` with
 * both `native` and `proxy` boolean values.
 */
describe('Property 9: Gemini CLI Dual Endpoint Test Completeness', () => {
  /** Gemini CLI 详细测试结果 */
  interface GeminiTestDetail {
    native: boolean | null;
    proxy: boolean | null;
  }

  /**
   * Arbitrary for generating GeminiTestDetail
   */
  const geminiTestDetailArb: fc.Arbitrary<GeminiTestDetail> = fc.record({
    native: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
    proxy: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  });

  /**
   * Simulates the testGeminiWithDetail logic
   * Returns { supported: boolean, detail: GeminiTestDetail }
   */
  function simulateTestGeminiWithDetail(
    nativeResult: boolean,
    proxyResult: boolean
  ): { supported: boolean; detail: GeminiTestDetail } {
    return {
      supported: proxyResult || nativeResult, // 任一通过即支持
      detail: {
        native: nativeResult,
        proxy: proxyResult,
      },
    };
  }

  it('should return geminiDetail with both native and proxy fields', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (nativeResult, proxyResult) => {
        const result = simulateTestGeminiWithDetail(nativeResult, proxyResult);

        // Verify geminiDetail exists and has both fields
        expect(result.detail).toBeDefined();
        expect('native' in result.detail).toBe(true);
        expect('proxy' in result.detail).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should set supported=true when proxy is true (regardless of native)', () => {
    fc.assert(
      fc.property(fc.boolean(), nativeResult => {
        const result = simulateTestGeminiWithDetail(nativeResult, true);
        expect(result.supported).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should set supported=true when native is true (regardless of proxy)', () => {
    fc.assert(
      fc.property(fc.boolean(), proxyResult => {
        const result = simulateTestGeminiWithDetail(true, proxyResult);
        expect(result.supported).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  it('should set supported=false only when both native and proxy are false', () => {
    const result = simulateTestGeminiWithDetail(false, false);
    expect(result.supported).toBe(false);
    expect(result.detail.native).toBe(false);
    expect(result.detail.proxy).toBe(false);
  });

  it('should correctly reflect individual endpoint results in detail', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.boolean(), (nativeResult, proxyResult) => {
        const result = simulateTestGeminiWithDetail(nativeResult, proxyResult);

        // Detail should exactly match input results
        expect(result.detail.native).toBe(nativeResult);
        expect(result.detail.proxy).toBe(proxyResult);
      }),
      { numRuns: 100 }
    );
  });

  it('should preserve geminiDetail through serialization round trip', () => {
    fc.assert(
      fc.property(geminiTestDetailArb, original => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized) as GeminiTestDetail;

        expect(deserialized.native).toBe(original.native);
        expect(deserialized.proxy).toBe(original.proxy);
      }),
      { numRuns: 100 }
    );
  });

  it('should handle all combinations of native/proxy results correctly', () => {
    // Test all 4 combinations explicitly
    const combinations: [boolean, boolean][] = [
      [false, false],
      [false, true],
      [true, false],
      [true, true],
    ];

    for (const [native, proxy] of combinations) {
      const result = simulateTestGeminiWithDetail(native, proxy);

      // Verify supported logic: either one being true means supported
      expect(result.supported).toBe(native || proxy);

      // Verify detail reflects actual results
      expect(result.detail.native).toBe(native);
      expect(result.detail.proxy).toBe(proxy);
    }
  });

  /**
   * Test that CliCompatibilityResult with geminiDetail preserves correctly
   */
  it('should preserve geminiDetail in CliCompatibilityResult round trip', () => {
    interface CliCompatibilityResultWithGeminiDetail {
      claudeCode: boolean | null;
      codex: boolean | null;
      geminiCli: boolean | null;
      geminiDetail?: GeminiTestDetail;
      testedAt: number | null;
      error?: string;
    }

    const cliCompatibilityResultWithGeminiDetailArb: fc.Arbitrary<CliCompatibilityResultWithGeminiDetail> =
      fc.record({
        claudeCode: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
        codex: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
        geminiCli: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
        geminiDetail: fc.option(geminiTestDetailArb, { nil: undefined }),
        testedAt: fc.oneof(fc.integer({ min: 0, max: Date.now() + 1000000 }), fc.constant(null)),
        error: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
      });

    fc.assert(
      fc.property(cliCompatibilityResultWithGeminiDetailArb, original => {
        const serialized = JSON.stringify(original);
        const deserialized = JSON.parse(serialized) as CliCompatibilityResultWithGeminiDetail;

        // Verify geminiDetail is preserved
        if (original.geminiDetail === undefined) {
          expect(deserialized.geminiDetail).toBeUndefined();
        } else {
          expect(deserialized.geminiDetail).toBeDefined();
          expect(deserialized.geminiDetail!.native).toBe(original.geminiDetail.native);
          expect(deserialized.geminiDetail!.proxy).toBe(original.geminiDetail.proxy);
        }
      }),
      { numRuns: 100 }
    );
  });
});
