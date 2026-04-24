/**
 * 输入: CLI 测试配置、child_process、临时文件系统
 * 输出: 基于真实 CLI wrapper 的兼容性测试结果
 * 定位: 服务层 - 通过隔离环境拉起真实 Claude Code / Codex / Gemini CLI，验证站点可用性
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/main/FOLDER_INDEX.md
 * - PROJECT_INDEX.md
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type {
  ClaudeTestDetail,
  CliCompatibilityResult,
  CodexTestDetail,
  GeminiTestDetail,
} from './cli-compat-service';

const TEST_PROMPT = 'What is 1+1? Reply with only 2. Do not use tools.';
const EXPECTED_ANSWER = '2';

export interface CliWrapperTestConfig {
  cliType: 'claudeCode' | 'codex' | 'geminiCli';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface TestWithWrapperParams {
  siteUrl: string;
  configs: CliWrapperTestConfig[];
}

export interface CommandRunOptions {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
  stdin?: string;
}

export interface CommandRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
}

type CommandRunner = (options: CommandRunOptions) => Promise<CommandRunResult>;

interface IsolatedWorkspace {
  rootDir: string;
  homeDir: string;
  workDir: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

function ensureOpenAiBaseUrl(baseUrl: string): string {
  const normalized = normalizeBaseUrl(baseUrl);
  return normalized.endsWith('/v1') ? normalized : `${normalized}/v1`;
}

function escapeTomlString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseJsonCandidates(raw: string): any[] {
  const candidates = new Set<string>();
  const trimmed = raw.trim();
  if (trimmed) {
    candidates.add(trimmed);
  }

  for (const line of raw.split(/\r?\n/)) {
    const lineTrimmed = line.trim();
    if (lineTrimmed) {
      candidates.add(lineTrimmed);
    }
  }

  const parsed: any[] = [];
  for (const candidate of candidates) {
    try {
      parsed.push(JSON.parse(candidate));
    } catch {
      // Ignore non-JSON lines.
    }
  }
  return parsed;
}

function normalizeReplyText(value: string | null | undefined): string {
  return value?.replace(/\s+/g, ' ').trim() ?? '';
}

function summarizeReplyText(value: string | null | undefined): string | undefined {
  const normalized = normalizeReplyText(value);
  if (!normalized) {
    return undefined;
  }

  return normalized.length <= 160 ? normalized : `${normalized.slice(0, 157)}...`;
}

function isExpectedAnswer(value: string | null | undefined): boolean {
  const normalized = normalizeReplyText(value);
  if (!normalized) {
    return false;
  }

  return normalized === EXPECTED_ANSWER || normalized.includes(EXPECTED_ANSWER);
}

function extractJsonStringField(raw: string, fieldNames: string[]): string | null {
  const parsed = parseJsonCandidates(raw);
  for (const item of parsed) {
    for (const fieldName of fieldNames) {
      if (typeof item?.[fieldName] === 'string') {
        return item[fieldName].trim();
      }
    }
  }
  return null;
}

function extractClaudeResult(stdout: string): string | null {
  const directText = normalizeReplyText(stdout);
  if (directText && !stdout.includes('{')) {
    return directText;
  }

  return extractJsonStringField(stdout, ['result', 'response', 'content', 'text']);
}

function extractGeminiResponse(stdout: string): string | null {
  const directText = normalizeReplyText(stdout);
  if (directText && !stdout.includes('{')) {
    return directText;
  }

  return extractJsonStringField(stdout, ['response', 'result', 'content', 'text']);
}

function buildFailureMessage(label: string, result: CommandRunResult, fallback?: string): string {
  if (result.timedOut) {
    return `${label} 测试超时`;
  }
  if (result.spawnError) {
    return `${label} 启动失败: ${result.spawnError}`;
  }

  const stderr = result.stderr.trim();
  if (stderr) {
    return `${label} 执行失败: ${stderr}`;
  }

  const stdout = result.stdout.trim();
  if (stdout) {
    return `${label} 输出异常: ${stdout}`;
  }

  if (fallback?.trim()) {
    return `${label} 执行失败: ${fallback.trim()}`;
  }

  return `${label} 执行失败`;
}

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

function terminateChildProcess(pid: number | undefined): void {
  if (!pid) return;

  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.unref();
      return;
    }
    process.kill(pid, 'SIGKILL');
  } catch {
    // Ignore cleanup failures for already-exited processes.
  }
}

export async function runCliCommand(options: CommandRunOptions): Promise<CommandRunResult> {
  return new Promise(resolve => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;

    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'pipe',
      windowsHide: true,
      shell: process.platform === 'win32',
    });

    const settle = (result: CommandRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminateChildProcess(child.pid);
    }, options.timeoutMs);

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      settle({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error.message,
      });
    });

    child.on('close', exitCode => {
      settle({
        exitCode,
        stdout,
        stderr,
        timedOut,
      });
    });

    if (options.stdin) {
      child.stdin?.write(options.stdin);
    }
    child.stdin?.end();
  });
}

export class CliWrapperCompatService {
  constructor(
    private readonly timeoutMs: number = 60000,
    private readonly commandRunner: CommandRunner = runCliCommand
  ) {}

  private async withIsolatedWorkspace<T>(
    prefix: string,
    action: (workspace: IsolatedWorkspace) => Promise<T>
  ): Promise<T> {
    const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
    const homeDir = path.join(rootDir, 'home');
    const workDir = path.join(rootDir, 'workspace');

    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(workDir, { recursive: true });

    try {
      return await action({ rootDir, homeDir, workDir });
    } finally {
      await fs.rm(rootDir, { recursive: true, force: true });
    }
  }

  private buildIsolatedEnv(homeDir: string, overrides: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return {
      ...process.env,
      HOME: homeDir,
      USERPROFILE: homeDir,
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
      XDG_CACHE_HOME: path.join(homeDir, '.cache'),
      ...overrides,
    };
  }

  async testClaudeCode(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testClaudeCodeWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testClaudeCodeWithDetail(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: ClaudeTestDetail; message?: string }> {
    return this.testClaudeCodeWithMessage(url, apiKey, model);
  }

  async testClaudeCodeWithMessage(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: ClaudeTestDetail; message?: string }> {
    return this.withIsolatedWorkspace('api-detect-claude-wrapper', async workspace => {
      const settingsDir = path.join(workspace.homeDir, '.claude');
      await fs.mkdir(settingsDir, { recursive: true });
      await fs.writeFile(
        path.join(settingsDir, 'settings.json'),
        JSON.stringify(
          {
            env: {
              ANTHROPIC_BASE_URL: normalizeBaseUrl(url),
              ANTHROPIC_API_KEY: apiKey,
              ANTHROPIC_AUTH_TOKEN: apiKey,
            },
          },
          null,
          2
        ),
        'utf-8'
      );

      const env = this.buildIsolatedEnv(workspace.homeDir, {});
      const commandResult = await this.commandRunner({
        command: 'claude',
        args: ['--bare', '--print', '--output-format', 'json', '--model', model],
        cwd: workspace.workDir,
        env,
        timeoutMs: this.timeoutMs,
        stdin: `${TEST_PROMPT}\n`,
      });

      const content = extractClaudeResult(commandResult.stdout);
      const replyText = summarizeReplyText(content);
      const supported = commandResult.exitCode === 0 && isExpectedAnswer(content);
      const message = supported
        ? undefined
        : buildFailureMessage(
            'Claude Code',
            commandResult,
            `reply=${replyText ?? (normalizeReplyText(content) || 'null')}`
          );

      return {
        supported,
        detail: {
          replyText,
        },
        ...(message ? { message } : {}),
      };
    });
  }

  async testCodexWithDetail(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: CodexTestDetail; message?: string }> {
    return this.testCodexWithMessage(url, apiKey, model);
  }

  async testCodex(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testCodexWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testCodexWithMessage(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: CodexTestDetail; message?: string }> {
    return this.withIsolatedWorkspace('api-detect-codex-wrapper', async workspace => {
      const codexHome = path.join(workspace.homeDir, '.codex');
      await fs.mkdir(codexHome, { recursive: true });

      const outputFile = path.join(workspace.rootDir, 'codex-output.txt');
      const configPath = path.join(codexHome, 'config.toml');
      const configContent = [
        `model = "${escapeTomlString(model)}"`,
        'model_provider = "proxy"',
        'model_reasoning_effort = "xhigh"',
        'forced_login_method = "api"',
        '',
        '[model_providers.proxy]',
        'name = "DuckCodingProxy"',
        `base_url = "${escapeTomlString(ensureOpenAiBaseUrl(url))}"`,
        'env_key = "OPENAI_API_KEY"',
        'wire_api = "responses"',
        'supports_websockets = false',
        '',
      ].join('\n');

      await fs.writeFile(configPath, configContent, 'utf-8');

      const env = this.buildIsolatedEnv(workspace.homeDir, {
        CODEX_HOME: codexHome,
        OPENAI_API_KEY: apiKey,
      });

      const commandResult = await this.commandRunner({
        command: 'codex',
        args: [
          'exec',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '--ephemeral',
          '-C',
          workspace.workDir,
          '-o',
          outputFile,
          TEST_PROMPT,
        ],
        cwd: workspace.workDir,
        env,
        timeoutMs: this.timeoutMs,
      });

      const output = (await readFileIfExists(outputFile)) ?? commandResult.stdout;
      const replyText = summarizeReplyText(output);
      const supported = commandResult.exitCode === 0 && isExpectedAnswer(output);
      const message = supported
        ? undefined
        : buildFailureMessage('Codex', commandResult, `reply=${replyText ?? 'missing output'}`);

      return {
        supported,
        detail: {
          responses: supported,
          replyText,
        },
        ...(message ? { message } : {}),
      };
    });
  }

  async testGeminiWithDetail(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: GeminiTestDetail; message?: string }> {
    return this.testGeminiWithMessage(url, apiKey, model);
  }

  async testGeminiCli(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testGeminiWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testGeminiWithMessage(
    url: string,
    apiKey: string,
    model: string
  ): Promise<{ supported: boolean; detail: GeminiTestDetail; message?: string }> {
    return this.withIsolatedWorkspace('api-detect-gemini-wrapper', async workspace => {
      const geminiHome = path.join(workspace.homeDir, '.gemini');
      await fs.mkdir(geminiHome, { recursive: true });

      const env = this.buildIsolatedEnv(workspace.homeDir, {
        GEMINI_CLI_HOME: geminiHome,
        GEMINI_API_KEY: apiKey,
        GOOGLE_GEMINI_BASE_URL: normalizeBaseUrl(url),
      });

      const commandResult = await this.commandRunner({
        command: 'gemini',
        args: [
          '-p',
          TEST_PROMPT,
          '-m',
          model,
          '--output-format',
          'json',
          '--approval-mode',
          'plan',
        ],
        cwd: workspace.workDir,
        env,
        timeoutMs: this.timeoutMs,
      });

      const content = extractGeminiResponse(commandResult.stdout);
      const replyText = summarizeReplyText(content);
      const supported = commandResult.exitCode === 0 && isExpectedAnswer(content);
      const message = supported
        ? undefined
        : buildFailureMessage(
            'Gemini CLI',
            commandResult,
            `reply=${replyText ?? (normalizeReplyText(content) || 'null')}`
          );

      return {
        supported,
        detail: {
          native: supported,
          proxy: null,
          replyText,
        },
        ...(message ? { message } : {}),
      };
    });
  }

  async testSite(params: TestWithWrapperParams): Promise<CliCompatibilityResult> {
    const result: CliCompatibilityResult = {
      claudeCode: null,
      claudeDetail: undefined,
      codex: null,
      codexDetail: undefined,
      geminiCli: null,
      geminiDetail: undefined,
      testedAt: Date.now(),
    };

    for (const config of params.configs) {
      const testUrl = config.baseUrl || params.siteUrl;

      if (config.cliType === 'claudeCode') {
        const claude = await this.testClaudeCodeWithDetail(testUrl, config.apiKey, config.model);
        result.claudeCode = claude.supported;
        result.claudeDetail = claude.detail;
      } else if (config.cliType === 'codex') {
        const codex = await this.testCodexWithDetail(testUrl, config.apiKey, config.model);
        result.codex = codex.supported;
        result.codexDetail = codex.detail;
      } else if (config.cliType === 'geminiCli') {
        const gemini = await this.testGeminiWithDetail(testUrl, config.apiKey, config.model);
        result.geminiCli = gemini.supported;
        result.geminiDetail = gemini.detail;
      }
    }

    return result;
  }
}

export const cliWrapperCompatService = new CliWrapperCompatService();
