import * as fs from 'fs/promises';
import * as path from 'path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../main/utils/logger', () => ({
  Logger: {
    scope: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    }),
  },
}));

import {
  CliWrapperCompatService,
  shouldAbortCliCommandOnOutput,
  type CommandRunOptions,
} from '../main/cli-wrapper-compat-service';
import {
  buildProbeLockRouteApiKey,
  notifyRouteProbeLockRequest,
  notifyRouteProbeLockTerminalFailure,
  recordRouteProbeLockFirstUpstreamResult,
} from '../main/route-probe-lock';

describe('CliWrapperCompatService', () => {
  it('writes isolated Claude settings and treats replies containing 2 as success', async () => {
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      const settingsPath = path.join(options.env.HOME!, '.claude', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://duckcoding.ai');
      expect(settings.env.ANTHROPIC_API_KEY).toBe('claude-key');
      expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('claude-key');
      expect(options.env.ANTHROPIC_BASE_URL).toBe('https://duckcoding.ai');
      expect(options.env.ANTHROPIC_API_KEY).toBe('claude-key');
      expect(options.env.ANTHROPIC_AUTH_TOKEN).toBe('claude-key');
      expect(options.stdin).toContain('1+1');

      return {
        exitCode: 0,
        stdout: '{"result":"答案是 2"}\n',
        stderr: '',
        timedOut: false,
      };
    });

    await expect(
      service.testClaudeCodeWithDetail('https://duckcoding.ai/', 'claude-key', 'claude-haiku-test')
    ).resolves.toEqual({
      supported: true,
      detail: {
        replyText: '答案是 2',
      },
    });
  });

  it('builds Codex temporary proxy config and reads the output file', async () => {
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      const configPath = path.join(options.env.CODEX_HOME!, 'config.toml');
      const config = await fs.readFile(configPath, 'utf-8');

      expect(config).toContain('model_provider = "proxy"');
      expect(config).toContain('model_reasoning_effort = "xhigh"');
      expect(config).toContain('forced_login_method = "api"');
      expect(config).toContain('base_url = "https://duckcoding.ai/v1"');
      expect(config).toContain('wire_api = "responses"');
      expect(config).toContain('supports_websockets = false');
      expect(options.args[options.args.length - 1]).toBe('-');
      expect(options.stdin).toContain('1+1');

      const outputIndex = options.args.indexOf('-o');
      const outputPath = options.args[outputIndex + 1];
      await fs.writeFile(outputPath, '2', 'utf-8');

      return {
        exitCode: 0,
        stdout: '',
        stderr: '',
        timedOut: false,
      };
    });

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toEqual({
      supported: true,
      detail: {
        responses: true,
        replyText: '2',
      },
    });
  });

  it('does not turn Codex workspace cleanup EBUSY into a test failure', async () => {
    const cleanupError = Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' });
    const cleanupPaths: string[] = [];
    const workspaceCleaner = vi.fn(async (rootDir: string) => {
      cleanupPaths.push(rootDir);
      throw cleanupError;
    });
    const service = new CliWrapperCompatService(
      1000,
      async (options: CommandRunOptions) => {
        const outputIndex = options.args.indexOf('-o');
        const outputPath = options.args[outputIndex + 1];
        await fs.writeFile(outputPath, '2', 'utf-8');

        return {
          exitCode: 0,
          stdout: '',
          stderr: '',
          timedOut: false,
        };
      },
      workspaceCleaner
    );

    try {
      await expect(
        service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
      ).resolves.toEqual({
        supported: true,
        detail: {
          responses: true,
          replyText: '2',
        },
      });

      expect(workspaceCleaner).toHaveBeenCalledTimes(1);
    } finally {
      await Promise.all(
        cleanupPaths.map(rootDir => fs.rm(rootDir, { recursive: true, force: true }))
      );
    }
  });

  it('surfaces Codex JSON upstream errors before the CLI banner', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: [
        'OpenAI Codex v0.130.0',
        '--------',
        'ERROR: {"error":{"message":"Responses API is not supported by this provider.","type":"bad_response_status_code","code":"bad_response_status_code"}}',
      ].join('\n'),
      timedOut: false,
    }));

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toMatchObject({
      supported: false,
      message:
        'Codex 执行失败: Responses API is not supported by this provider. (bad_response_status_code)',
    });
  });

  it('surfaces Codex upstream status errors instead of reconnect noise', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: [
        'WARNING: proceeding, even though we could not update PATH',
        'ERROR: Reconnecting... 1/5',
        'ERROR: unexpected status 403 Forbidden: 无权访问 codex 分组 (request id: req-1)',
      ].join('\n'),
      timedOut: false,
    }));

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toMatchObject({
      supported: false,
      message:
        'Codex 执行失败: unexpected status 403 Forbidden: 无权访问 codex 分组 (request id: req-1)',
    });
  });

  it('detects terminal upstream errors without aborting on reconnect noise alone', () => {
    expect(shouldAbortCliCommandOnOutput('ERROR: Reconnecting... 1/5')).toBe(false);
    expect(
      shouldAbortCliCommandOnOutput('ERROR: unexpected status 403 Forbidden: 无权访问 codex 分组')
    ).toBe(true);
    expect(
      shouldAbortCliCommandOnOutput(
        'ERROR: {"error":{"message":"Responses API is not supported.","code":"bad_response_status_code"}}'
      )
    ).toBe(true);
    expect(
      shouldAbortCliCommandOnOutput(
        'API Error: 400 CLI probe-lock allows onlu one upstream request per model test'
      )
    ).toBe(false);
    expect(
      shouldAbortCliCommandOnOutput(
        [
          'ERROR: unexpected status 403 Forbidden: upstream rejected the model',
          'API Error: 400 CLI probe-lock allows only one upstream request per model test',
        ].join('\n')
      )
    ).toBe(true);
  });

  it('surfaces terminal Codex status errors even when the CLI process times out', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: null,
      stdout: '',
      stderr: [
        'ERROR: Reconnecting... 1/5',
        'ERROR: unexpected status 503 Service Unavailable: upstream overloaded',
      ].join('\n'),
      timedOut: true,
    }));

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toMatchObject({
      supported: false,
      message: 'Codex 执行失败: unexpected status 503 Service Unavailable: upstream overloaded',
    });
  });

  it('keeps the upstream failure ahead of later probe-lock request-budget noise', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: [
        'ERROR: unexpected status 403 Forbidden: upstream rejected the model',
        'API Error: 400 CLI probe-lock allows only one upstream request per model test',
      ].join('\n'),
      timedOut: false,
    }));

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toMatchObject({
      supported: false,
      message: 'Codex 执行失败: unexpected status 403 Forbidden: upstream rejected the model',
    });
  });

  it('explains a standalone probe-lock request-budget failure as an app-side limit', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: 'API Error: 400 CLI probe-lock allows onlu one upstream request per model test',
      timedOut: false,
    }));

    await expect(
      service.testCodexWithDetail('https://duckcoding.ai', 'codex-key', 'gpt-5.3-codex')
    ).resolves.toMatchObject({
      supported: false,
      message:
        'Codex 执行失败: HTTP 400（应用侧 probe-lock 限制）：CLI 在一次模型测试中发起了多次上游请求，应用只允许一次真实上游请求。',
    });
  });

  it('keeps a successful first probe-lock upstream response when later CLI requests exceed the budget', async () => {
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'codex',
      canonicalModel: 'gpt-4.1-mini',
      rawModel: 'gpt-4.1-mini',
    });
    const service = new CliWrapperCompatService(1000, async () => {
      notifyRouteProbeLockRequest(routeApiKey);
      recordRouteProbeLockFirstUpstreamResult({
        routeApiKey,
        cliType: 'codex',
        statusCode: 200,
        success: true,
        responseSummary:
          '{"id":"resp_1","output":[{"content":[{"type":"output_text","text":"2"}]}]}',
        finishedAt: Date.now(),
      });
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'API Error: 400 CLI probe-lock allows only one upstream request per model test',
        timedOut: false,
      };
    });

    await expect(
      service.testCodexWithDetail('http://127.0.0.1:3210', routeApiKey, 'gpt-4.1-mini')
    ).resolves.toEqual({
      supported: true,
      detail: {
        responses: true,
        replyText: '2',
      },
    });
  });

  it('aborts Claude wrapper when the route proxy reports a probe-lock upstream failure', async () => {
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
    });
    const terminalError = JSON.stringify({
      error: {
        type: 'bad_response_status_code',
        message: 'bad response status code 503 (request id: req-503)',
      },
      type: 'error',
    });
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      return await new Promise(resolve => {
        options.abortSignal?.addEventListener('abort', () => {
          resolve({
            exitCode: null,
            stdout: '',
            stderr: '',
            timedOut: false,
            terminalError:
              typeof options.abortSignal?.reason === 'string'
                ? options.abortSignal.reason
                : String(options.abortSignal?.reason),
          });
        });

        notifyRouteProbeLockTerminalFailure({
          routeApiKey,
          cliType: 'claudeCode',
          statusCode: 503,
          terminalError,
        });
      });
    });

    await expect(
      service.testClaudeCodeWithDetail('http://127.0.0.1:3210', routeApiKey, 'claude-sonnet-4-6')
    ).resolves.toMatchObject({
      supported: false,
      message:
        'Claude Code 执行失败: bad response status code 503 (request id: req-503) (bad_response_status_code)',
    });
  });

  it('explains when Claude Code exits without calling the local route proxy', async () => {
    const service = new CliWrapperCompatService(1000, async () => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      timedOut: false,
    }));

    await expect(
      service.testClaudeCodeWithDetail('http://127.0.0.1:3210', 'sk-route', 'claude-sonnet-4-6')
    ).resolves.toMatchObject({
      supported: false,
      message:
        'Claude Code 执行失败: CLI 未向本地路由代理发起请求，请检查 CLI 是否已登录、是否支持环境变量代理配置，以及本机是否能执行该 CLI。',
    });
  });

  it('does not report a missing local route proxy request after the proxy observes the probe-lock key', async () => {
    const routeApiKey = buildProbeLockRouteApiKey('sk-route', {
      siteId: 'site-1',
      accountId: 'acc-1',
      apiKeyId: 'key-1',
      cliType: 'claudeCode',
      canonicalModel: 'claude-sonnet-4-6',
      rawModel: 'claude-sonnet-4-6',
    });
    const service = new CliWrapperCompatService(1000, async () => {
      notifyRouteProbeLockRequest(routeApiKey);
      return {
        exitCode: 1,
        stdout: '',
        stderr: '',
        timedOut: false,
      };
    });

    await expect(
      service.testClaudeCodeWithDetail('http://127.0.0.1:3210', routeApiKey, 'claude-sonnet-4-6')
    ).resolves.toMatchObject({
      supported: false,
      message: 'Claude Code 执行失败: reply=null',
    });
  });

  it('maps Gemini wrapper success to native=true and proxy=null', async () => {
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      const settingsPath = path.join(options.env.HOME!, '.gemini', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(settings.security.auth.selectedType).toBe('gemini-api-key');
      expect(options.env.GEMINI_CLI_HOME).toBeUndefined();
      expect(options.env.GEMINI_API_KEY).toBe('gemini-key');
      expect(options.env.GOOGLE_GEMINI_BASE_URL).toBe('https://duckcoding.ai');
      expect(options.env.GEMINI_SANDBOX).toBe('false');
      expect(options.env.GEMINI_CLI_TRUST_WORKSPACE).toBe('true');
      expect(options.args).toContain('--skip-trust');
      expect(options.args).not.toContain('-p');
      expect(options.stdin).toContain('1+1');

      return {
        exitCode: 0,
        stdout: '{"response":"计算结果是2"}\n',
        stderr: '',
        timedOut: false,
      };
    });

    await expect(
      service.testGeminiWithDetail('https://duckcoding.ai/', 'gemini-key', 'gemini-2.5-flash')
    ).resolves.toEqual({
      supported: true,
      detail: {
        native: true,
        proxy: null,
        replyText: '计算结果是2',
      },
    });
  });
});
