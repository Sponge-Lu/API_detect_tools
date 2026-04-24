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
  type CommandRunOptions,
} from '../main/cli-wrapper-compat-service';

describe('CliWrapperCompatService', () => {
  it('writes isolated Claude settings and treats replies containing 2 as success', async () => {
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      const settingsPath = path.join(options.env.HOME!, '.claude', 'settings.json');
      const settings = JSON.parse(await fs.readFile(settingsPath, 'utf-8'));

      expect(settings.env.ANTHROPIC_BASE_URL).toBe('https://duckcoding.ai');
      expect(settings.env.ANTHROPIC_API_KEY).toBe('claude-key');
      expect(settings.env.ANTHROPIC_AUTH_TOKEN).toBe('claude-key');
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

  it('maps Gemini wrapper success to native=true and proxy=null', async () => {
    const service = new CliWrapperCompatService(1000, async (options: CommandRunOptions) => {
      expect(options.env.GEMINI_CLI_HOME).toContain('.gemini');
      expect(options.env.GEMINI_API_KEY).toBe('gemini-key');
      expect(options.env.GOOGLE_GEMINI_BASE_URL).toBe('https://duckcoding.ai');

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
