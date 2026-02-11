/**
 * 输入: HttpClient (HTTP 请求), Logger (日志记录)
 * 输出: CliCompatibilityResult, CodexTestDetail, GeminiTestDetail, CliCompatService, 请求构建函数
 * 定位: 服务层 - CLI 工具兼容性测试服务，支持 Claude Code、Codex（Responses API）、Gemini CLI（双端点）
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

/**
 * CLI 兼容性测试服务
 * 用于检测站点是否支持 Claude Code、Codex、Gemini CLI 等 CLI 工具
 */

import { httpPost } from './utils/http-client';
import { Logger } from './utils/logger';

const log = Logger.scope('CliCompatService');

// ============= 类型定义 =============

/** CLI 工具类型 */
export enum CliType {
  CLAUDE_CODE = 'claudeCode',
  CODEX = 'codex',
  GEMINI_CLI = 'geminiCli',
}

/** Codex 详细测试结果 */
export interface CodexTestDetail {
  responses: boolean | null; // Responses API 测试结果
}

/** Gemini CLI 详细测试结果 */
export interface GeminiTestDetail {
  native: boolean | null; // Google 原生格式测试结果
  proxy: boolean | null; // OpenAI 兼容格式测试结果
}

/** CLI 兼容性测试结果 */
export interface CliCompatibilityResult {
  claudeCode: boolean | null; // true=支持, false=不支持, null=未测试
  codex: boolean | null;
  codexDetail?: CodexTestDetail; // Codex 详细测试结果（responses）
  geminiCli: boolean | null;
  geminiDetail?: GeminiTestDetail; // Gemini CLI 详细测试结果（native/proxy）
  testedAt: number | null; // Unix timestamp
  error?: string; // 测试错误信息（可选）
}

/** 测试配置 */
export interface TestConfig {
  siteUrl: string;
  apiKey: string;
  models: string[]; // 站点可用的模型列表
}

/** 请求格式 */
export interface RequestFormat {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: object;
}

// ============= 请求构建函数 =============

/**
 * 从模型列表中选择版本号最低的模型
 * @param models 模型列表
 * @param prefix 模型前缀 (如 'claude-', 'gpt-', 'gemini-')
 * @returns 最低版本的模型名称，如果没有匹配则返回 null
 */
export function selectLowestModel(models: string[], prefix: string): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  // 过滤出匹配前缀的模型
  const matchingModels = models.filter(m => m.toLowerCase().startsWith(prefix.toLowerCase()));

  if (matchingModels.length === 0) {
    return null;
  }

  // 解析版本号并排序
  const modelsWithVersion = matchingModels.map(model => {
    const version = parseModelVersion(model, prefix);
    return { model, version };
  });

  // 按版本号升序排序，返回最低版本
  modelsWithVersion.sort((a, b) => compareVersions(a.version, b.version));

  return modelsWithVersion[0].model;
}

/**
 * 使用正则表达式匹配模型类型
 * 支持更灵活的模型名称格式
 * @param models 模型列表
 * @param type 模型类型 ('claude' | 'gpt' | 'gemini')
 * @returns 匹配的模型名称，如果没有匹配则返回 null
 */
export function findModelByType(
  models: string[],
  type: 'claude' | 'gpt' | 'gemini'
): string | null {
  if (!models || models.length === 0) {
    return null;
  }

  // 定义各类型的匹配模式
  const patterns: Record<string, RegExp[]> = {
    claude: [/^claude[-_]?/i, /^anthropic[-_]?/i, /^claude\d/i],
    gpt: [/^gpt[-_]?/i, /^openai[-_]?/i, /^chatgpt[-_]?/i, /^o[134][-_]?/i, /^gpt\d/i],
    gemini: [/^gemini[-_]?/i, /^google[-_]?/i, /^gemini\d/i],
  };

  const regexList = patterns[type];
  if (!regexList) {
    return null;
  }

  // 尝试每个正则表达式
  for (const regex of regexList) {
    const matchingModels = models.filter(m => regex.test(m));
    if (matchingModels.length > 0) {
      // 返回第一个匹配的模型（可以进一步优化为选择最低版本）
      return matchingModels[0];
    }
  }

  return null;
}

/**
 * 检查响应是否表示 API 支持
 * @param status HTTP 状态码
 * @param data 响应数据
 * @returns true 表示 API 支持，false 表示不支持
 */
export function isApiSupported(status: number, data: any): boolean {
  // 2xx 状态码通常表示成功
  if (status >= 200 && status < 300) {
    // 检查响应体是否包含错误
    if (data?.error) {
      // 某些错误类型表示 API 存在但请求有问题
      const errorType = data.error.type || data.error.code || '';
      const errorMessage = data.error.message || '';

      // 这些错误表示 API 存在，只是请求参数有问题
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

  // 401/403 通常表示认证问题，但 API 存在
  if (status === 401 || status === 403) {
    return true;
  }

  // 429 表示速率限制，API 存在
  if (status === 429) {
    return true;
  }

  // 500 内部服务器错误 - 检查是否是中转站的内容验证错误
  // 这种错误说明请求格式正确，只是模型响应有问题
  if (status === 500) {
    // 检查是否是内容验证错误（中转站特有的错误）
    const errorMessage = data?.error?.message || data?.message || '';
    const errorCode = data?.error?.code || data?.code || '';

    // 这些错误表示 API 格式正确，只是响应内容有问题
    const contentValidationErrors = [
      'content_validation_error',
      'EMPTY_RESPONSE',
      'Response content validation failed',
    ];

    if (contentValidationErrors.some(e => errorMessage.includes(e) || errorCode.includes(e))) {
      return true;
    }
  }

  // 400 可能表示参数错误，需要检查响应体
  if (status === 400) {
    if (data?.error) {
      const errorType = data.error.type || data.error.code || '';
      const errorMessage = data.error.message || '';

      // 这些错误表示 API 存在
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
 * 解析模型名称中的版本号
 * @param model 模型名称
 * @param prefix 模型前缀
 * @returns 版本号数组，如 [3, 5] 表示 3.5
 */
export function parseModelVersion(model: string, prefix: string): number[] {
  // 移除前缀
  const withoutPrefix = model.toLowerCase().slice(prefix.toLowerCase().length);

  // 提取数字部分
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

  // 如果没有找到数字，返回一个很大的版本号（排在最后）
  return numbers.length > 0 ? numbers : [Infinity];
}

/**
 * 比较两个版本号数组
 * @returns 负数表示 a < b，正数表示 a > b，0 表示相等
 */
export function compareVersions(a: number[], b: number[]): number {
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

// ============= 请求构建函数 =============

/**
 * 构建 Claude Code 测试请求
 * 使用 /v1/messages 端点，x-api-key 认证，tools 使用 input_schema 格式
 */
export function buildClaudeCodeRequest(
  baseUrl: string,
  apiKey: string,
  model: string
): RequestFormat {
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
      messages: [{ role: 'user', content: '1+1=?' }],
      tools: [
        {
          name: 'test_tool',
          description: 'A test tool',
          input_schema: {
            type: 'object',
            properties: {
              test: { type: 'string' },
            },
            required: [],
          },
        },
      ],
    },
  };
}

/**
 * 构建 Codex Responses API 测试请求
 * 使用 /v1/responses 端点，Bearer 认证
 */
export function buildCodexResponsesRequest(
  baseUrl: string,
  apiKey: string,
  model: string
): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/responses`;

  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: {
      model,
      input: '1+1=?',
    },
  };
}

/**
 * 构建 Gemini CLI 测试请求
 * 使用 /v1beta/models/{model}:generateContent 端点，functionDeclarations 格式
 */
export function buildGeminiCliRequest(
  baseUrl: string,
  apiKey: string,
  model: string
): RequestFormat {
  const url = `${baseUrl.replace(/\/$/, '')}/v1beta/models/${model}:generateContent?key=${apiKey}`;

  return {
    url,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: {
      contents: [{ role: 'user', parts: [{ text: '1+1=?' }] }],
      tools: [
        {
          functionDeclarations: [
            {
              name: 'test_tool',
              description: 'A test tool',
              parameters: {
                type: 'object',
                properties: {
                  test: { type: 'string' },
                },
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

/**
 * 构建 Gemini CLI 测试请求（OpenAI 兼容格式，用于中转站）
 * 使用 /v1/chat/completions 端点
 */
export function buildGeminiCliProxyRequest(
  baseUrl: string,
  apiKey: string,
  model: string
): RequestFormat {
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
      messages: [{ role: 'user', content: '1+1=?' }],
    },
  };
}

// ============= CLI 兼容性服务类 =============

/**
 * CLI 兼容性测试服务
 */
export class CliCompatService {
  private timeout: number;

  constructor(timeout: number = 30000) {
    this.timeout = timeout;
  }

  /**
   * 测试 Claude Code 兼容性
   */
  async testClaudeCode(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildClaudeCodeRequest(url, apiKey, model);
      log.info(`Testing Claude Code compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      // 使用改进的响应验证
      const supported = isApiSupported(response.status, response.data);
      log.info(`Claude Code test result: status=${response.status}, supported=${supported}`);
      return supported;
    } catch (error: any) {
      log.warn(`Claude Code test failed: ${error.message}`);
      // 网络错误等不代表不支持，返回 null 更合适，但为了兼容性返回 false
      return false;
    }
  }

  /**
   * 测试 Codex 兼容性（Responses API）
   */
  async testCodexResponses(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildCodexResponsesRequest(url, apiKey, model);
      log.info(`Testing Codex (Responses) compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      const supported = isApiSupported(response.status, response.data);
      log.info(`Codex (Responses) test result: status=${response.status}, supported=${supported}`);
      return supported;
    } catch (error: any) {
      log.warn(`Codex (Responses) test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试 Codex 兼容性（仅测试 Responses API，chat 模式已废弃）
   * @returns 包含详细测试结果的对象
   */
  async testCodexWithDetail(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: CodexTestDetail }> {
    const responsesResult = await this.testCodexResponses(url, apiKey, model);

    return {
      supported: responsesResult,
      detail: {
        responses: responsesResult,
      },
    };
  }

  /**
   * 测试 Codex 兼容性
   * 仅测试 Responses API（chat 模式已废弃）
   */
  async testCodex(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testCodexWithDetail(url, apiKey, model);
    return result.supported;
  }

  /**
   * 测试 Gemini CLI 兼容性（Google 原生格式）
   */
  async testGeminiNative(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildGeminiCliRequest(url, apiKey, model);
      log.info(`Testing Gemini CLI (Native) compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      const supported = isApiSupported(response.status, response.data);
      log.info(
        `Gemini CLI (Native) test result: status=${response.status}, supported=${supported}`
      );
      return supported;
    } catch (error: any) {
      log.warn(`Gemini CLI (Native) test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试 Gemini CLI 兼容性（OpenAI 兼容格式，用于中转站）
   */
  async testGeminiProxy(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildGeminiCliProxyRequest(url, apiKey, model);
      log.info(`Testing Gemini CLI (Proxy) compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      const supported = isApiSupported(response.status, response.data);
      log.info(`Gemini CLI (Proxy) test result: status=${response.status}, supported=${supported}`);
      return supported;
    } catch (error: any) {
      log.warn(`Gemini CLI (Proxy) test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试 Gemini CLI 兼容性（同时测试 Native 和 Proxy 端点）
   * 注意：Gemini CLI 实际只使用 Native 格式，Proxy 测试仅供参考
   * @returns 包含详细测试结果的对象
   */
  async testGeminiWithDetail(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: GeminiTestDetail }> {
    // 并发测试两种端点
    const [proxyResult, nativeResult] = await Promise.all([
      this.testGeminiProxy(url, apiKey, model),
      this.testGeminiNative(url, apiKey, model),
    ]);

    return {
      // Gemini CLI 只使用 native 格式，所以支持状态只基于 native 测试结果
      supported: nativeResult === true,
      detail: {
        native: nativeResult,
        proxy: proxyResult,
      },
    };
  }

  /**
   * 测试 Gemini CLI 兼容性
   * 同时测试 Native 和 Proxy 端点，任一通过即支持
   */
  async testGeminiCli(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testGeminiWithDetail(url, apiKey, model);
    return result.supported;
  }

  /**
   * 测试单个站点的所有 CLI 兼容性
   */
  async testSite(config: TestConfig): Promise<CliCompatibilityResult> {
    const { siteUrl, apiKey, models } = config;

    log.info(`Testing CLI compatibility for site: ${siteUrl}`);

    // 使用改进的模型匹配逻辑
    // 先尝试使用正则匹配，如果失败再使用前缀匹配
    let claudeModel = findModelByType(models, 'claude');
    let gptModel = findModelByType(models, 'gpt');
    let geminiModel = findModelByType(models, 'gemini');

    // 如果正则匹配失败，回退到前缀匹配
    if (!claudeModel) {
      claudeModel = selectLowestModel(models, 'claude-');
    }
    if (!gptModel) {
      gptModel = selectLowestModel(models, 'gpt-');
    }
    if (!geminiModel) {
      geminiModel = selectLowestModel(models, 'gemini-');
    }

    log.info(`Selected models - Claude: ${claudeModel}, GPT: ${gptModel}, Gemini: ${geminiModel}`);

    // 并发执行所有测试
    const [claudeCodeResult, codexResultWithDetail, geminiResultWithDetail] = await Promise.all([
      claudeModel ? this.testClaudeCode(siteUrl, apiKey, claudeModel) : Promise.resolve(null),
      gptModel
        ? this.testCodexWithDetail(siteUrl, apiKey, gptModel)
        : Promise.resolve({ supported: null, detail: { responses: null } }),
      geminiModel
        ? this.testGeminiWithDetail(siteUrl, apiKey, geminiModel)
        : Promise.resolve({ supported: null, detail: { native: null, proxy: null } }),
    ]);

    const result: CliCompatibilityResult = {
      claudeCode: claudeCodeResult,
      codex: codexResultWithDetail.supported,
      codexDetail: codexResultWithDetail.detail,
      geminiCli: geminiResultWithDetail.supported,
      geminiDetail: geminiResultWithDetail.detail,
      testedAt: Date.now(),
    };

    log.info(`CLI compatibility test completed for ${siteUrl}:`, result);

    return result;
  }
}

// 导出单例实例
export const cliCompatService = new CliCompatService();
