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
  CHAT = 'chat',
}

/** CLI 兼容性测试结果 */
export interface CliCompatibilityResult {
  claudeCode: boolean | null; // true=支持, false=不支持, null=未测试
  codex: boolean | null;
  geminiCli: boolean | null;
  chat: boolean | null;
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
      messages: [{ role: 'user', content: 'hi' }],
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
 * 构建 Codex 测试请求
 * 使用 /v1/chat/completions 端点，Bearer 认证，tools 使用 function.parameters 格式
 */
export function buildCodexRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
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
              properties: {
                test: { type: 'string' },
              },
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
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
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
 * 构建基础 Chat 测试请求
 * 使用 /v1/chat/completions 端点，不包含 tools
 */
export function buildChatRequest(baseUrl: string, apiKey: string, model: string): RequestFormat {
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

      // 成功响应（2xx）表示支持
      return response.status >= 200 && response.status < 300;
    } catch (error: any) {
      log.warn(`Claude Code test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试 Codex 兼容性
   */
  async testCodex(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildCodexRequest(url, apiKey, model);
      log.info(`Testing Codex compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      return response.status >= 200 && response.status < 300;
    } catch (error: any) {
      log.warn(`Codex test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试 Gemini CLI 兼容性
   */
  async testGeminiCli(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildGeminiCliRequest(url, apiKey, model);
      log.info(`Testing Gemini CLI compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      return response.status >= 200 && response.status < 300;
    } catch (error: any) {
      log.warn(`Gemini CLI test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试基础 Chat 兼容性
   */
  async testChat(url: string, apiKey: string, model: string): Promise<boolean> {
    try {
      const request = buildChatRequest(url, apiKey, model);
      log.info(`Testing Chat compatibility: ${request.url}`);

      const response = await httpPost(request.url, request.body, {
        headers: request.headers,
        timeout: this.timeout,
      });

      return response.status >= 200 && response.status < 300;
    } catch (error: any) {
      log.warn(`Chat test failed: ${error.message}`);
      return false;
    }
  }

  /**
   * 测试单个站点的所有 CLI 兼容性
   */
  async testSite(config: TestConfig): Promise<CliCompatibilityResult> {
    const { siteUrl, apiKey, models } = config;

    log.info(`Testing CLI compatibility for site: ${siteUrl}`);

    // 为每种 CLI 类型选择最低版本的模型
    const claudeModel = selectLowestModel(models, 'claude-');
    const gptModel = selectLowestModel(models, 'gpt-');
    const geminiModel = selectLowestModel(models, 'gemini-');

    // 对于 Chat，优先使用 gpt 模型，如果没有则使用任意模型
    const chatModel = gptModel || (models.length > 0 ? models[0] : null);

    log.info(
      `Selected models - Claude: ${claudeModel}, GPT: ${gptModel}, Gemini: ${geminiModel}, Chat: ${chatModel}`
    );

    // 并发执行所有测试
    const [claudeCodeResult, codexResult, geminiCliResult, chatResult] = await Promise.all([
      claudeModel ? this.testClaudeCode(siteUrl, apiKey, claudeModel) : Promise.resolve(null),
      gptModel ? this.testCodex(siteUrl, apiKey, gptModel) : Promise.resolve(null),
      geminiModel ? this.testGeminiCli(siteUrl, apiKey, geminiModel) : Promise.resolve(null),
      chatModel ? this.testChat(siteUrl, apiKey, chatModel) : Promise.resolve(null),
    ]);

    const result: CliCompatibilityResult = {
      claudeCode: claudeCodeResult,
      codex: codexResult,
      geminiCli: geminiCliResult,
      chat: chatResult,
      testedAt: Date.now(),
    };

    log.info(`CLI compatibility test completed for ${siteUrl}:`, result);

    return result;
  }
}

// 导出单例实例
export const cliCompatService = new CliCompatService();
