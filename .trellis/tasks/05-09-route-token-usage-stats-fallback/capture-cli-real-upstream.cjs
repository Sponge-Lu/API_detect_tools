const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { once } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const TIMEOUT_MS = 75_000;
const OUTPUT_PATH = path.join(__dirname, 'cli-real-capture-results.json');
const PROMPT = 'Reply with CLI_REAL_CAPTURE_OK only.';

function sha256Fingerprint(value) {
  if (!value) {
    return null;
  }
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);
}

function shellQuote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

function parseJsonSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function getUserDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'api-hub-management-tools');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'api-hub-management-tools');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'api-hub-management-tools');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadCaptureConfig() {
  const userDataDir = getUserDataDir();
  const config = readJson(path.join(userDataDir, 'config.json'));
  const runtimeCache = readJson(path.join(userDataDir, 'runtime-cache.json'));
  const customCli = readJson(path.join(userDataDir, 'custom-cli-configs.json'));

  const prismSite = (config.sites || []).find(site => site.name === 'PrismAI');
  if (!prismSite) {
    throw new Error('PrismAI site not found in config.json');
  }

  const prismAccount = (config.accounts || []).find(account => account.site_id === prismSite.id);
  if (!prismAccount) {
    throw new Error('PrismAI account not found in config.json');
  }

  const prismApiKeys =
    runtimeCache.account_runtime_by_account_id?.[prismAccount.id]?.api_keys || [];
  const cherrystudioKey = prismApiKeys.find(key => key.name === 'cherrystudio')?.key;
  const gemini222Key = prismApiKeys.find(key => key.name === '222')?.key;
  if (!cherrystudioKey) {
    throw new Error('PrismAI API key named cherrystudio not found in runtime-cache.json');
  }
  if (!gemini222Key) {
    throw new Error('PrismAI API key named 222 not found in runtime-cache.json');
  }

  const localCustomConfig = (customCli.configs || []).find(
    item =>
      item.name === '本地' ||
      item.name === 'Local' ||
      item.name === 'CPA' ||
      item.cliSettings?.codex?.model === 'gpt-5.5'
  );
  if (!localCustomConfig?.apiKey || !localCustomConfig?.baseUrl) {
    throw new Error('Custom CLI local config with baseUrl/apiKey not found');
  }

  return {
    userDataDir,
    claude: {
      label: 'PrismAI/cherrystudio',
      baseUrl: prismSite.url,
      apiKey: cherrystudioKey,
      model: 'claude-sonnet-4-6',
      apiKeyFingerprint: sha256Fingerprint(cherrystudioKey),
    },
    gemini: {
      label: 'PrismAI/222',
      baseUrl: prismSite.url,
      apiKey: gemini222Key,
      model: 'gemini-3.1-pro-preview',
      apiKeyFingerprint: sha256Fingerprint(gemini222Key),
    },
    codex: {
      label: `Custom/${localCustomConfig.name}`,
      baseUrl: localCustomConfig.baseUrl,
      apiKey: localCustomConfig.apiKey,
      model: 'gpt-5.5',
      apiKeyFingerprint: sha256Fingerprint(localCustomConfig.apiKey),
    },
  };
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '');
}

function redactHeaders(headers) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/authorization|api-key|x-api-key|x-goog-api-key|cookie/i.test(key)) {
      const text = Array.isArray(value) ? value.join(',') : String(value || '');
      redacted[key] = {
        redacted: true,
        length: text.length,
        fingerprint: sha256Fingerprint(text),
      };
    } else {
      redacted[key] = value;
    }
  }
  return redacted;
}

function collectRequest(req) {
  return new Promise(resolve => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const rawBody = Buffer.concat(chunks);
      const bodyText = rawBody.toString('utf8');
      const jsonBody = parseJsonSafe(bodyText);
      resolve({
        method: req.method,
        url: req.url,
        headers: req.headers,
        rawBody,
        jsonBody,
      });
    });
  });
}

function pickRequestBodySummary(jsonBody, rawBody) {
  if (!jsonBody || typeof jsonBody !== 'object') {
    return {
      json: false,
      bytes: rawBody.length,
    };
  }

  const body = jsonBody;
  const summary = {
    json: true,
    bytes: rawBody.length,
    topLevelKeys: Object.keys(body),
  };

  for (const key of [
    'model',
    'stream',
    'max_tokens',
    'max_output_tokens',
    'store',
    'prompt_cache_key',
  ]) {
    if (body[key] !== undefined && typeof body[key] !== 'object') {
      summary[key] = body[key];
    }
  }

  if (Array.isArray(body.messages)) {
    summary.messagesCount = body.messages.length;
  }
  if (Array.isArray(body.input)) {
    summary.inputCount = body.input.length;
  } else if (typeof body.input === 'string') {
    summary.inputType = 'string';
  }
  if (Array.isArray(body.contents)) {
    summary.contentsCount = body.contents.length;
  }
  if (Array.isArray(body.tools)) {
    summary.toolsCount = body.tools.length;
  }
  if (body.generationConfig && typeof body.generationConfig === 'object') {
    summary.generationConfigKeys = Object.keys(body.generationConfig);
  }
  if (body.reasoning && typeof body.reasoning === 'object') {
    summary.reasoningKeys = Object.keys(body.reasoning);
  }

  return summary;
}

function summarizeObjectShape(value, depth = 0) {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return {
      type: 'array',
      count: value.length,
      first: value.length > 0 && depth < 2 ? summarizeObjectShape(value[0], depth + 1) : undefined,
    };
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (depth >= 2) {
      return { type: 'object', keys };
    }
    const sample = {};
    for (const key of keys.slice(0, 12)) {
      sample[key] = summarizeObjectShape(value[key], depth + 1);
    }
    return { type: 'object', keys, sample };
  }
  return typeof value;
}

function findUsageCandidates(value, pathName = '$', out = []) {
  if (!value || typeof value !== 'object') {
    return out;
  }

  if (value.usage && typeof value.usage === 'object') {
    out.push({ path: `${pathName}.usage`, keys: Object.keys(value.usage), value: value.usage });
  }
  if (value.usageMetadata && typeof value.usageMetadata === 'object') {
    out.push({
      path: `${pathName}.usageMetadata`,
      keys: Object.keys(value.usageMetadata),
      value: value.usageMetadata,
    });
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findUsageCandidates(item, `${pathName}[${index}]`, out));
    return out;
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === 'object' && key !== 'usage' && key !== 'usageMetadata') {
      findUsageCandidates(child, `${pathName}.${key}`, out);
    }
  }
  return out;
}

function parseSseEvents(text) {
  const events = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const trimmed = block.trim();
    if (!trimmed) {
      continue;
    }

    let eventName = null;
    const dataLines = [];
    for (const line of trimmed.split(/\r?\n/)) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }

    const data = dataLines.join('\n');
    if (!data || data === '[DONE]') {
      events.push({ event: eventName, done: data === '[DONE]' });
      continue;
    }

    const parsed = parseJsonSafe(data);
    events.push({
      event: eventName || parsed?.type || null,
      parsed,
      dataBytes: Buffer.byteLength(data),
    });
  }
  return events;
}

function summarizeResponse(status, headers, body) {
  const contentType = String(headers['content-type'] || headers['Content-Type'] || '');
  const text = body.toString('utf8');
  const summary = {
    status,
    contentType,
    bytes: body.length,
    headerKeys: Object.keys(headers || {}),
    usageCandidates: [],
  };

  if (/text\/event-stream/i.test(contentType) || /^event:|^data:/m.test(text)) {
    const events = parseSseEvents(text);
    summary.stream = true;
    summary.eventTypes = events.map(event => event.event || (event.done ? '[DONE]' : null)).filter(Boolean);
    summary.eventCount = events.length;
    summary.jsonEventShapes = events
      .filter(event => event.parsed)
      .slice(0, 5)
      .map(event => ({
        event: event.event || event.parsed.type || null,
        topLevelKeys: Object.keys(event.parsed),
        shape: summarizeObjectShape(event.parsed),
      }));
    for (const event of events) {
      if (event.parsed) {
        findUsageCandidates(event.parsed, `$event:${event.event || event.parsed.type || 'data'}`, summary.usageCandidates);
      }
    }
    return summary;
  }

  const parsed = parseJsonSafe(text);
  if (parsed) {
    summary.stream = false;
    summary.topLevelKeys = Object.keys(parsed);
    summary.shape = summarizeObjectShape(parsed);
    summary.usageCandidates = findUsageCandidates(parsed);
  } else {
    summary.stream = false;
    summary.bodyTextPrefix = text.slice(0, 240);
  }

  return summary;
}

function buildRequestSummary(capture) {
  return {
    method: capture.method,
    url: capture.url,
    headers: redactHeaders(capture.headers),
    body: pickRequestBodySummary(capture.jsonBody, capture.rawBody),
  };
}

function buildUpstreamUrl(baseUrl, requestUrl) {
  const base = new URL(normalizeBaseUrl(baseUrl));
  const original = new URL(requestUrl || '/', 'http://127.0.0.1');
  return new URL(`${original.pathname}${original.search}`, base).toString();
}

function rewriteGeminiApiKey(upstreamUrl, apiKey) {
  const url = new URL(upstreamUrl);
  if (url.searchParams.has('key')) {
    url.searchParams.set('key', apiKey);
  }
  return url.toString();
}

function buildUpstreamHeaders(headers, apiKey, mode) {
  const upstreamHeaders = { ...headers };
  for (const key of Object.keys(upstreamHeaders)) {
    if (/^host$|^content-length$/i.test(key)) {
      delete upstreamHeaders[key];
    }
  }

  if (mode === 'claude') {
    upstreamHeaders['x-api-key'] = apiKey;
    upstreamHeaders.authorization = `Bearer ${apiKey}`;
  } else if (mode === 'gemini') {
    upstreamHeaders['x-goog-api-key'] = apiKey;
    upstreamHeaders.authorization = `Bearer ${apiKey}`;
  } else {
    upstreamHeaders.authorization = `Bearer ${apiKey}`;
  }

  return upstreamHeaders;
}

function forwardRequest({ mode, baseUrl, apiKey, capture }) {
  return new Promise(resolve => {
    let upstreamUrl = buildUpstreamUrl(baseUrl, capture.url);
    if (mode === 'gemini') {
      upstreamUrl = rewriteGeminiApiKey(upstreamUrl, apiKey);
    }

    const parsed = new URL(upstreamUrl);
    const transport = parsed.protocol === 'http:' ? http : https;
    const startedAt = Date.now();
    const req = transport.request(
      parsed,
      {
        method: capture.method || 'POST',
        headers: buildUpstreamHeaders(capture.headers, apiKey, mode),
        timeout: TIMEOUT_MS,
      },
      res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          resolve({
            upstreamUrl: `${parsed.origin}${parsed.pathname}${parsed.search ? '?<redacted-query>' : ''}`,
            status: res.statusCode || 0,
            headers: res.headers,
            body,
            durationMs: Date.now() - startedAt,
            error: null,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error('upstream_timeout'));
    });
    req.on('error', error => {
      resolve({
        upstreamUrl: `${parsed.origin}${parsed.pathname}${parsed.search ? '?<redacted-query>' : ''}`,
        status: 0,
        headers: {},
        body: Buffer.alloc(0),
        durationMs: Date.now() - startedAt,
        error: error.message,
      });
    });
    req.end(capture.rawBody);
  });
}

function killTree(pid) {
  if (!pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

async function runCapture({ label, mode, baseUrl, apiKey, apiKeyLabel, apiKeyFingerprint, model, buildCommand, env }) {
  console.error(`[capture] starting ${label}`);
  const captures = [];
  const server = http.createServer(async (req, res) => {
    const capture = await collectRequest(req);
    const upstream = await forwardRequest({ mode, baseUrl, apiKey, capture });
    const responseSummary = upstream.error
      ? { status: 0, error: upstream.error, durationMs: upstream.durationMs }
      : summarizeResponse(upstream.status, upstream.headers, upstream.body);

    captures.push({
      request: buildRequestSummary(capture),
      upstream: {
        baseUrl: normalizeBaseUrl(baseUrl),
        forwardedUrl: upstream.upstreamUrl,
        apiKeyLabel,
        apiKeyFingerprint,
      },
      response: {
        ...responseSummary,
        durationMs: upstream.durationMs,
      },
    });

    if (upstream.error || upstream.status < 100 || upstream.status > 599) {
      const text = JSON.stringify({ error: upstream.error || `invalid_upstream_status_${upstream.status}` });
      res.writeHead(502, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text) });
      res.end(text);
      return;
    }

    const headers = { ...upstream.headers };
    delete headers['content-encoding'];
    delete headers['transfer-encoding'];
    delete headers.connection;
    res.writeHead(upstream.status, headers);
    res.end(upstream.body);
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const command = buildCommand(port);
  const startedAt = Date.now();
  const child = spawn(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...env(port),
      NO_COLOR: '1',
      FORCE_COLOR: '0',
    },
    shell: true,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', chunk => {
    stderr += chunk.toString();
  });

  const timeout = setTimeout(() => {
    killTree(child.pid);
  }, TIMEOUT_MS);

  const exitCode = await new Promise(resolve => {
    child.on('exit', code => resolve(code));
  });
  clearTimeout(timeout);
  server.close();
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
  await once(server, 'close');

  console.error(`[capture] finished ${label} exit=${exitCode} captures=${captures.length}`);
  return {
    label,
    cliVersion: await getCliVersion(label),
    model,
    command: redactCommand(command),
    durationMs: Date.now() - startedAt,
    exitCode,
    captures,
    stdoutSummary: summarizeCliOutput(stdout),
    stderrPrefix: stderr.slice(0, 1000),
  };
}

function redactCommand(command) {
  return command.replace(/(API_KEY=)[^\s"]+/gi, '$1<redacted>');
}

function summarizeCliOutput(output) {
  const parsed = parseJsonSafe(output.trim());
  if (parsed && typeof parsed === 'object') {
    return {
      json: true,
      topLevelKeys: Object.keys(parsed),
      shape: summarizeObjectShape(parsed),
      usageCandidates: findUsageCandidates(parsed),
    };
  }
  return {
    json: false,
    textPrefix: output.slice(0, 1000),
  };
}

async function getCliVersion(label) {
  const command =
    label === 'claude-code' ? 'claude --version' : label === 'codex-cli' ? 'codex --version' : 'gemini --version';
  return new Promise(resolve => {
    const child = spawn(command, {
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('exit', () => {
      resolve((stdout || stderr).trim().split(/\r?\n/)[0] || 'unknown');
    });
  });
}

async function main() {
  const captureConfig = loadCaptureConfig();
  const selectedLabels = new Set(
    (process.env.CAPTURE_ONLY || 'claude-code,codex-cli,gemini-cli')
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  );
  let results = [];
  if (fs.existsSync(OUTPUT_PATH)) {
    try {
      const previous = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
      results = Array.isArray(previous.results)
        ? previous.results.filter(result => !selectedLabels.has(result.label))
        : [];
    } catch {
      results = [];
    }
  }
  const output = {
    capturedAt: new Date().toISOString(),
    method:
      'CLI -> local redacting proxy -> real upstream. Request and response summaries only; full secrets and full payloads are not persisted.',
    configSummary: {
      claude: {
        baseUrl: normalizeBaseUrl(captureConfig.claude.baseUrl),
        apiKeyLabel: captureConfig.claude.label,
        apiKeyFingerprint: captureConfig.claude.apiKeyFingerprint,
        model: captureConfig.claude.model,
      },
      codex: {
        baseUrl: normalizeBaseUrl(captureConfig.codex.baseUrl),
        apiKeyLabel: captureConfig.codex.label,
        apiKeyFingerprint: captureConfig.codex.apiKeyFingerprint,
        model: captureConfig.codex.model,
      },
      gemini: {
        baseUrl: normalizeBaseUrl(captureConfig.gemini.baseUrl),
        apiKeyLabel: captureConfig.gemini.label,
        apiKeyFingerprint: captureConfig.gemini.apiKeyFingerprint,
        model: captureConfig.gemini.model,
      },
    },
    results,
  };

  async function runAndPersist(options) {
    if (!selectedLabels.has(options.label)) {
      return;
    }
    results.push(await runCapture(options));
    fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  }

  await runAndPersist({
      label: 'claude-code',
      mode: 'claude',
      baseUrl: captureConfig.claude.baseUrl,
      apiKey: captureConfig.claude.apiKey,
      apiKeyLabel: captureConfig.claude.label,
      apiKeyFingerprint: captureConfig.claude.apiKeyFingerprint,
      model: captureConfig.claude.model,
      buildCommand: () =>
        [
          'claude',
          '--bare',
          '--print',
          '--output-format',
          'json',
          '--no-session-persistence',
          '--setting-sources',
          shellQuote(''),
          '--tools',
          shellQuote(''),
          '--model',
          captureConfig.claude.model,
          shellQuote(PROMPT),
        ].join(' '),
      env: port => ({
        ANTHROPIC_API_KEY: 'capture-key',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        CLAUDE_CODE_SIMPLE: '1',
      }),
  });

  await runAndPersist({
      label: 'codex-cli',
      mode: 'codex',
      baseUrl: captureConfig.codex.baseUrl,
      apiKey: captureConfig.codex.apiKey,
      apiKeyLabel: captureConfig.codex.label,
      apiKeyFingerprint: captureConfig.codex.apiKeyFingerprint,
      model: captureConfig.codex.model,
      buildCommand: port =>
        [
          'codex',
          'exec',
          '--ignore-user-config',
          '--ephemeral',
          '--skip-git-repo-check',
          '--sandbox',
          'read-only',
          '-m',
          captureConfig.codex.model,
          '-c',
          shellQuote('model_provider="local_capture"'),
          '-c',
          shellQuote('model_providers.local_capture.name="Local Capture"'),
          '-c',
          shellQuote(`model_providers.local_capture.base_url="http://127.0.0.1:${port}/v1"`),
          '-c',
          shellQuote('model_providers.local_capture.env_key="OPENAI_API_KEY"'),
          '-c',
          shellQuote('model_providers.local_capture.wire_api="responses"'),
          shellQuote(PROMPT),
        ].join(' '),
      env: port => ({
        OPENAI_API_KEY: 'capture-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      }),
  });

  await runAndPersist({
      label: 'gemini-cli',
      mode: 'gemini',
      baseUrl: captureConfig.gemini.baseUrl,
      apiKey: captureConfig.gemini.apiKey,
      apiKeyLabel: captureConfig.gemini.label,
      apiKeyFingerprint: captureConfig.gemini.apiKeyFingerprint,
      model: captureConfig.gemini.model,
      buildCommand: () =>
        [
          'gemini',
          '--skip-trust',
          '--prompt',
          shellQuote(PROMPT),
          '--model',
          captureConfig.gemini.model,
          '--output-format',
          'json',
        ].join(' '),
      env: port => ({
        GEMINI_API_KEY: 'capture-key',
        GOOGLE_API_KEY: 'capture-key',
        GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}`,
      }),
  });

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(output, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
