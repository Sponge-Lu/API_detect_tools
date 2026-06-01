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
import { Logger } from './utils/logger';
import type {
  ClaudeTestDetail,
  CliCompatibilityResult,
  CodexTestDetail,
  GeminiTestDetail,
} from './cli-compat-service';
import {
  clearRouteProbeLockTerminalFailure,
  getRouteProbeLockFirstUpstreamResult,
  hasRouteProbeLockUpstreamAttempt,
  subscribeRouteProbeLockRequest,
  subscribeRouteProbeLockTerminalFailure,
  waitForRouteProbeLockFirstUpstreamResult,
  type RouteProbeLockUpstreamResult,
} from './route-probe-lock';

const TEST_PROMPT = 'What is 1+1? Reply with only 2. Do not use tools.';
const EXPECTED_ANSWER = '2';
const log = Logger.scope('CliWrapperCompatService');
const WORKSPACE_CLEANUP_RETRY_DELAYS_MS = [50, 150, 500, 1000];
const TRANSIENT_WORKSPACE_CLEANUP_ERROR_CODES = new Set(['EBUSY', 'ENOTEMPTY', 'EPERM', 'EACCES']);
const EARLY_TERMINATION_GRACE_MS = 2000;
const PROBE_LOCK_FIRST_UPSTREAM_RESULT_WAIT_MS = 120000;
const TERMINAL_CLI_ERROR_CODE_PATTERN =
  /\b(?:all_channels_failed|all_route_paths_disabled|bad_response_status_code|invalid_api_key|no_channels|no_matching_rule|probe_lock_cli_mismatch|probe_lock_forbidden)\b/i;
const TERMINAL_HTTP_STATUS_PATTERN =
  /\b(?:http(?:\s+status)?|response\s+status|status(?:\s+code)?|unexpected\s+status)\D*([45]\d{2})\b/i;
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_PATTERN =
  /\bprobe_lock_upstream_attempt_exhausted\b|CLI probe-lock allows onl[yu] one upstream request per model test/i;
const PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_SUMMARY =
  'HTTP 400（应用侧 probe-lock 限制）：CLI 在一次模型测试中发起了多次上游请求，应用只允许一次真实上游请求。';

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
  abortSignal?: AbortSignal;
}

export interface CommandRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnError?: string;
  terminalError?: string;
  observedProbeRequest?: boolean;
  probeLockFirstUpstreamResult?: RouteProbeLockUpstreamResult;
}

type CommandRunner = (options: CommandRunOptions) => Promise<CommandRunResult>;
type WorkspaceCleaner = (rootDir: string) => Promise<void>;

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

function collectProbeResponseText(value: unknown, keyHint = '', depth = 0): string[] {
  if (depth > 6 || value === undefined || value === null) {
    return [];
  }

  const textLeafKeys = new Set([
    'result',
    'response',
    'content',
    'text',
    'output_text',
    'completion',
  ]);
  const textContainerKeys = new Set([
    'message',
    'delta',
    'output',
    'choices',
    'candidates',
    'parts',
  ]);

  if (typeof value === 'string') {
    return textLeafKeys.has(keyHint) ? [value] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap(item => collectProbeResponseText(item, '', depth + 1));
  }

  if (typeof value !== 'object') {
    return [];
  }

  const texts: string[] = [];
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (textLeafKeys.has(key) || textContainerKeys.has(key)) {
      texts.push(...collectProbeResponseText(nestedValue, key, depth + 1));
    }
  }
  return texts;
}

function parseSseDataCandidates(raw: string): unknown[] {
  const parsed: unknown[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) {
      continue;
    }

    const payload = trimmed.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') {
      continue;
    }

    try {
      parsed.push(JSON.parse(payload));
    } catch {
      parsed.push(payload);
    }
  }
  return parsed;
}

function extractProbeLockResponseText(raw: string | undefined): string | null {
  const normalized = normalizeReplyText(raw);
  if (!normalized) {
    return null;
  }

  if (!normalized.includes('{') && !normalized.includes('[')) {
    return normalized;
  }

  const candidates = [...parseJsonCandidates(raw || ''), ...parseSseDataCandidates(raw || '')];
  const texts = candidates.flatMap(candidate => collectProbeResponseText(candidate));
  return normalizeReplyText(texts.join(' ')) || null;
}

function getProbeLockExpectedReplyText(result?: RouteProbeLockUpstreamResult): string | null {
  if (!result?.success) {
    return null;
  }

  const responseText = extractProbeLockResponseText(result.responseSummary);
  return isExpectedAnswer(responseText) ? responseText : null;
}

function summarizeProbeLockUpstreamFailure(
  result?: RouteProbeLockUpstreamResult
): string | undefined {
  if (!result || result.success) {
    return undefined;
  }

  return (
    summarizeTerminalError(result.error) ??
    summarizeTerminalError(result.responseSummary) ??
    (result.statusCode ? `HTTP ${result.statusCode}` : undefined)
  );
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

function extractJsonErrorSummary(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === 'object' &&
      parsed.is_error === true &&
      typeof parsed.result === 'string'
    ) {
      return summarizeCliErrorCandidate(parsed.result) ?? parsed.result.trim();
    }

    const error = parsed?.error;
    const message =
      typeof error?.message === 'string'
        ? error.message.trim()
        : typeof parsed?.message === 'string'
          ? parsed.message.trim()
          : '';
    const code =
      typeof error?.code === 'string'
        ? error.code.trim()
        : typeof error?.type === 'string'
          ? error.type.trim()
          : typeof parsed?.code === 'string'
            ? parsed.code.trim()
            : '';

    if (!message) {
      return null;
    }

    return code && !message.includes(code) ? `${message} (${code})` : message;
  } catch {
    return null;
  }
}

function summarizeCliErrorCandidate(raw: string): string | null {
  const normalized = normalizeReplyText(raw.replace(/^(?:ERROR|API Error):\s*/i, ''));
  if (!normalized || /^Reconnecting\.\.\./i.test(normalized)) {
    return null;
  }

  if (isProbeLockUpstreamAttemptExhausted(normalized)) {
    return PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_SUMMARY;
  }

  return extractJsonErrorSummary(normalized) ?? normalized;
}

function summarizeCliErrorOutput(raw: string): string | undefined {
  let latestUpstreamSummary: string | undefined;
  let latestProbeLockSummary: string | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!/^(?:ERROR|API Error):\s*/i.test(trimmed)) {
      continue;
    }

    const summary = summarizeCliErrorCandidate(trimmed);
    if (!summary) {
      continue;
    }

    if (summary === PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_SUMMARY) {
      latestProbeLockSummary = summary;
      continue;
    }

    latestUpstreamSummary = summary;
  }

  return latestUpstreamSummary ?? latestProbeLockSummary;
}

function summarizeStructuredCliErrorOutput(raw: string): string | undefined {
  const parsed = parseJsonCandidates(raw);
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const isStructuredError =
      record.is_error === true ||
      record.error !== undefined ||
      record.api_error_status !== undefined;
    if (!isStructuredError) {
      continue;
    }

    const summary = summarizeCliErrorCandidate(JSON.stringify(record));
    if (summary) {
      return summary;
    }
  }
  return undefined;
}

function summarizeCliFailureOutput(raw: string): string | undefined {
  return summarizeCliErrorOutput(raw) ?? summarizeStructuredCliErrorOutput(raw);
}

function summarizeTerminalError(raw: string | undefined): string | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  return summarizeCliErrorCandidate(raw) ?? normalizeReplyText(raw);
}

export function shouldAbortCliCommandOnOutput(raw: string): boolean {
  const normalized = normalizeReplyText(raw);
  if (!normalized) {
    return false;
  }

  if (isOnlyProbeLockUpstreamAttemptExhaustedError(raw)) {
    return false;
  }

  return (
    TERMINAL_CLI_ERROR_CODE_PATTERN.test(normalized) ||
    TERMINAL_HTTP_STATUS_PATTERN.test(normalized)
  );
}

function isProbeLockUpstreamAttemptExhausted(raw: string): boolean {
  return PROBE_LOCK_UPSTREAM_ATTEMPT_EXHAUSTED_PATTERN.test(raw);
}

function isOnlyProbeLockUpstreamAttemptExhaustedError(raw: string): boolean {
  const candidates = [raw];
  const jsonResult = extractJsonStringField(raw, ['result']);
  if (jsonResult) {
    candidates.push(jsonResult);
  }

  if (!candidates.some(candidate => isProbeLockUpstreamAttemptExhausted(candidate))) {
    return false;
  }

  for (const line of candidates.join('\n').split(/\r?\n/)) {
    const normalized = normalizeReplyText(line.replace(/^(?:ERROR|API Error):\s*/i, ''));
    if (!normalized || /^Reconnecting\.\.\./i.test(normalized)) {
      continue;
    }
    if (isProbeLockUpstreamAttemptExhausted(normalized)) {
      continue;
    }
    if (
      TERMINAL_CLI_ERROR_CODE_PATTERN.test(normalized) ||
      TERMINAL_HTTP_STATUS_PATTERN.test(normalized)
    ) {
      return false;
    }
  }

  return true;
}

function buildFailureMessage(label: string, result: CommandRunResult, fallback?: string): string {
  const stderr = result.stderr.trim();
  const stderrSummary = stderr ? summarizeCliFailureOutput(stderr) : undefined;
  const terminalErrorSummary = summarizeTerminalError(result.terminalError);
  const upstreamFailureSummary = summarizeProbeLockUpstreamFailure(
    result.probeLockFirstUpstreamResult
  );
  const stdout = result.stdout.trim();
  const stdoutSummary = stdout ? summarizeCliFailureOutput(stdout) : undefined;

  if (terminalErrorSummary) {
    return `${label} 执行失败: ${terminalErrorSummary}`;
  }
  if (upstreamFailureSummary) {
    return `${label} 执行失败: ${upstreamFailureSummary}`;
  }

  if (result.timedOut) {
    if (stderrSummary) {
      return `${label} 执行失败: ${stderrSummary}`;
    }
    return `${label} 测试超时`;
  }
  if (result.spawnError) {
    return `${label} 启动失败: ${result.spawnError}`;
  }

  if (stderr) {
    return `${label} 执行失败: ${stderrSummary ?? stderr}`;
  }

  if (result.observedProbeRequest === false) {
    return `${label} 执行失败: CLI 未向本地路由代理发起请求，请检查 CLI 是否已登录、是否支持环境变量代理配置，以及本机是否能执行该 CLI。`;
  }

  if (stdout) {
    if (stdoutSummary) {
      return `${label} 执行失败: ${stdoutSummary}`;
    }
    return `${label} 输出异常: ${stdout}`;
  }

  if (fallback?.trim()) {
    return `${label} 执行失败: ${fallback.trim()}`;
  }

  return `${label} 执行失败`;
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getAbortSignalReason(signal: AbortSignal | undefined): string | undefined {
  if (!signal || !('reason' in signal)) {
    return undefined;
  }

  const reason = signal.reason as unknown;
  if (typeof reason === 'string') {
    return reason;
  }
  if (reason instanceof Error) {
    return reason.message;
  }
  if (reason !== undefined) {
    return String(reason);
  }
  return undefined;
}

function isTransientWorkspaceCleanupError(error: unknown): boolean {
  const code = getErrorCode(error);
  return Boolean(code && TRANSIENT_WORKSPACE_CLEANUP_ERROR_CODES.has(code));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeWorkspaceRoot(rootDir: string): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= WORKSPACE_CLEANUP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await fs.rm(rootDir, {
        recursive: true,
        force: true,
        maxRetries: process.platform === 'win32' ? 2 : 0,
        retryDelay: 100,
      });
      return;
    } catch (error) {
      lastError = error;
      const retryDelay = WORKSPACE_CLEANUP_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined || !isTransientWorkspaceCleanupError(error)) {
        break;
      }
      await sleep(retryDelay);
    }
  }

  throw lastError;
}

async function cleanupWorkspace(rootDir: string): Promise<void> {
  try {
    await removeWorkspaceRoot(rootDir);
  } catch (error) {
    log.warn(
      `Failed to remove isolated CLI workspace ${rootDir}; leaving it for OS temp cleanup: ${getErrorMessage(error)}`
    );
  }
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
    let earlyTerminationRequested = false;
    let earlyTerminationTimeoutHandle: ReturnType<typeof setTimeout> | undefined;
    let terminalError: string | undefined;
    let abortListener: (() => void) | undefined;

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
      if (earlyTerminationTimeoutHandle) {
        clearTimeout(earlyTerminationTimeoutHandle);
      }
      if (abortListener) {
        options.abortSignal?.removeEventListener('abort', abortListener);
      }
      resolve(result);
    };

    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      terminateChildProcess(child.pid);
    }, options.timeoutMs);

    const requestEarlyTermination = (reason?: string) => {
      if (settled || timedOut || earlyTerminationRequested) return;
      terminalError = reason ?? terminalError;
      earlyTerminationRequested = true;
      clearTimeout(timeoutHandle);
      terminateChildProcess(child.pid);
      earlyTerminationTimeoutHandle = setTimeout(() => {
        settle({
          exitCode: null,
          stdout,
          stderr,
          timedOut: false,
          terminalError,
        });
      }, EARLY_TERMINATION_GRACE_MS);
    };

    const inspectOutputForTerminalError = () => {
      if (shouldAbortCliCommandOnOutput(`${stdout}\n${stderr}`)) {
        requestEarlyTermination();
      }
    };

    abortListener = () => {
      requestEarlyTermination(getAbortSignalReason(options.abortSignal));
    };
    if (options.abortSignal?.aborted) {
      abortListener();
    } else {
      options.abortSignal?.addEventListener('abort', abortListener, { once: true });
    }

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      inspectOutputForTerminalError();
    });

    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      inspectOutputForTerminalError();
    });

    child.on('error', error => {
      settle({
        exitCode: null,
        stdout,
        stderr,
        timedOut,
        spawnError: error.message,
        terminalError,
      });
    });

    child.on('close', exitCode => {
      settle({
        exitCode,
        stdout,
        stderr,
        timedOut,
        terminalError,
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
    private readonly commandRunner: CommandRunner = runCliCommand,
    private readonly workspaceCleaner: WorkspaceCleaner = cleanupWorkspace
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
      try {
        await this.workspaceCleaner(rootDir);
      } catch (error) {
        log.warn(
          `Failed to remove isolated CLI workspace ${rootDir}; leaving it for OS temp cleanup: ${getErrorMessage(error)}`
        );
      }
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

  private async runCommandWatchingProbeLockFailure(
    routeApiKey: string,
    options: Omit<CommandRunOptions, 'abortSignal'>
  ): Promise<CommandRunResult> {
    const abortController = new AbortController();
    let observedProbeRequest = false;
    clearRouteProbeLockTerminalFailure(routeApiKey);
    const unsubscribeRequest = subscribeRouteProbeLockRequest(routeApiKey, () => {
      observedProbeRequest = true;
    });
    const unsubscribe = subscribeRouteProbeLockTerminalFailure(routeApiKey, failure => {
      if (!abortController.signal.aborted) {
        abortController.abort(failure.terminalError);
      }
    });

    try {
      const result = await this.commandRunner({
        ...options,
        abortSignal: abortController.signal,
      });
      let probeLockFirstUpstreamResult = getRouteProbeLockFirstUpstreamResult(routeApiKey);
      if (
        observedProbeRequest &&
        !probeLockFirstUpstreamResult &&
        hasRouteProbeLockUpstreamAttempt(routeApiKey) &&
        isOnlyProbeLockUpstreamAttemptExhaustedError(`${result.stdout}\n${result.stderr}`)
      ) {
        probeLockFirstUpstreamResult = await waitForRouteProbeLockFirstUpstreamResult(
          routeApiKey,
          PROBE_LOCK_FIRST_UPSTREAM_RESULT_WAIT_MS
        );
      }
      return {
        ...result,
        observedProbeRequest,
        ...(probeLockFirstUpstreamResult ? { probeLockFirstUpstreamResult } : {}),
      };
    } finally {
      unsubscribe();
      unsubscribeRequest();
    }
  }

  async testClaudeCode(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testClaudeCodeWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testClaudeCodeWithDetail(
    url: string,
    apiKey: string,
    model: string,
    timeoutMs?: number
  ): Promise<{ supported: boolean; detail: ClaudeTestDetail; message?: string }> {
    return this.testClaudeCodeWithMessage(url, apiKey, model, timeoutMs);
  }

  async testClaudeCodeWithMessage(
    url: string,
    apiKey: string,
    model: string,
    timeoutMs?: number
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

      const env = this.buildIsolatedEnv(workspace.homeDir, {
        ANTHROPIC_BASE_URL: normalizeBaseUrl(url),
        ANTHROPIC_API_KEY: apiKey,
        ANTHROPIC_AUTH_TOKEN: apiKey,
      });
      const commandResult = await this.runCommandWatchingProbeLockFailure(apiKey, {
        command: 'claude',
        args: ['--bare', '--print', '--output-format', 'json', '--model', model],
        cwd: workspace.workDir,
        env,
        timeoutMs: timeoutMs ?? this.timeoutMs,
        stdin: `${TEST_PROMPT}\n`,
      });

      const content = extractClaudeResult(commandResult.stdout);
      const probeLockReplyText = getProbeLockExpectedReplyText(
        commandResult.probeLockFirstUpstreamResult
      );
      const replyText = summarizeReplyText(content) ?? summarizeReplyText(probeLockReplyText);
      const supported =
        (commandResult.exitCode === 0 && isExpectedAnswer(content)) || Boolean(probeLockReplyText);
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
    model: string,
    timeoutMs?: number
  ): Promise<{ supported: boolean; detail: CodexTestDetail; message?: string }> {
    return this.testCodexWithMessage(url, apiKey, model, timeoutMs);
  }

  async testCodex(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testCodexWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testCodexWithMessage(
    url: string,
    apiKey: string,
    model: string,
    timeoutMs?: number
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

      const commandResult = await this.runCommandWatchingProbeLockFailure(apiKey, {
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
          '-',
        ],
        cwd: workspace.workDir,
        env,
        timeoutMs: timeoutMs ?? this.timeoutMs,
        stdin: `${TEST_PROMPT}\n`,
      });

      const output = (await readFileIfExists(outputFile)) ?? commandResult.stdout;
      const probeLockReplyText = getProbeLockExpectedReplyText(
        commandResult.probeLockFirstUpstreamResult
      );
      const replyText = summarizeReplyText(output) ?? summarizeReplyText(probeLockReplyText);
      const supported =
        (commandResult.exitCode === 0 && isExpectedAnswer(output)) || Boolean(probeLockReplyText);
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
    model: string,
    timeoutMs?: number
  ): Promise<{ supported: boolean; detail: GeminiTestDetail; message?: string }> {
    return this.testGeminiWithMessage(url, apiKey, model, timeoutMs);
  }

  async testGeminiCli(url: string, apiKey: string, model: string): Promise<boolean> {
    const result = await this.testGeminiWithMessage(url, apiKey, model);
    return result.supported;
  }

  async testGeminiWithMessage(
    url: string,
    apiKey: string,
    model: string,
    timeoutMs?: number
  ): Promise<{ supported: boolean; detail: GeminiTestDetail; message?: string }> {
    return this.withIsolatedWorkspace('api-detect-gemini-wrapper', async workspace => {
      const geminiHome = path.join(workspace.homeDir, '.gemini');
      await fs.mkdir(geminiHome, { recursive: true });
      await fs.writeFile(
        path.join(geminiHome, 'settings.json'),
        JSON.stringify(
          {
            security: {
              auth: {
                selectedType: 'gemini-api-key',
              },
            },
          },
          null,
          2
        ),
        'utf-8'
      );

      const env = this.buildIsolatedEnv(workspace.homeDir, {
        GEMINI_API_KEY: apiKey,
        GOOGLE_GEMINI_BASE_URL: normalizeBaseUrl(url),
        GEMINI_SANDBOX: 'false',
        GEMINI_CLI_TRUST_WORKSPACE: 'true',
      });

      const commandResult = await this.runCommandWatchingProbeLockFailure(apiKey, {
        command: 'gemini',
        args: ['--skip-trust', '-m', model, '--output-format', 'json', '--approval-mode', 'plan'],
        cwd: workspace.workDir,
        env,
        timeoutMs: timeoutMs ?? this.timeoutMs,
        stdin: `${TEST_PROMPT}\n`,
      });

      const content = extractGeminiResponse(commandResult.stdout);
      const probeLockReplyText = getProbeLockExpectedReplyText(
        commandResult.probeLockFirstUpstreamResult
      );
      const replyText = summarizeReplyText(content) ?? summarizeReplyText(probeLockReplyText);
      const supported =
        (commandResult.exitCode === 0 && isExpectedAnswer(content)) || Boolean(probeLockReplyText);
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
