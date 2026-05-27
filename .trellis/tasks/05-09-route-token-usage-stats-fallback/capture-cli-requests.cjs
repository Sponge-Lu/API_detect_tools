const http = require('http');
const { spawn } = require('child_process');
const { once } = require('events');

const TIMEOUT_MS = 30_000;

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

function redactHeaders(headers) {
  const redacted = {};
  for (const [key, value] of Object.entries(headers)) {
    if (/authorization|api-key|x-api-key|x-goog-api-key|cookie/i.test(key)) {
      redacted[key] = '<redacted>';
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
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      resolve({
        method: req.method,
        url: req.url,
        headers: redactHeaders(req.headers),
        rawBody,
        jsonBody: parseJsonSafe(rawBody),
      });
    });
  });
  if (child.stdin) {
    child.stdin.end();
  }
}

function anthropicResponse() {
  return {
    id: 'msg_capture_001',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5',
    content: [{ type: 'text', text: 'capture-ok' }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 11,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
      output_tokens: 5,
    },
  };
}

function openAiResponse() {
  return {
    id: 'resp_capture_001',
    object: 'response',
    created_at: Math.floor(Date.now() / 1000),
    status: 'completed',
    model: 'gpt-5.2',
    output: [
      {
        id: 'msg_capture_001',
        type: 'message',
        status: 'completed',
        role: 'assistant',
        content: [
          {
            type: 'output_text',
            text: 'capture-ok',
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 13,
      input_tokens_details: { cached_tokens: 4 },
      output_tokens: 7,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 20,
    },
  };
}

function geminiResponse() {
  return {
    candidates: [
      {
        content: {
          role: 'model',
          parts: [{ text: 'capture-ok' }],
        },
        finishReason: 'STOP',
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 17,
      cachedContentTokenCount: 6,
      candidatesTokenCount: 8,
      thoughtsTokenCount: 3,
      totalTokenCount: 31,
    },
    modelVersion: 'gemini-2.5-flash',
  };
}

function respondJson(res, body) {
  const text = JSON.stringify(body);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function respondSse(res, events) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const event of events) {
    if (event.event) {
      res.write(`event: ${event.event}\n`);
    }
    res.write(`data: ${JSON.stringify(event.data)}\n\n`);
  }
  res.write('data: [DONE]\n\n');
  res.end();
}

function respondGeminiSse(res, payloads) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  });
  for (const payload of payloads) {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  res.end();
}

function killTree(pid) {
  if (!pid) {
    return;
  }

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
  } else {
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
}

async function runCapture(label, buildCommand, env, responder) {
  const captures = [];
  const server = http.createServer(async (req, res) => {
    const capture = await collectRequest(req);
    captures.push(capture);
    responder(req, res, capture);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  const preparedEnv = env(port);
  const startedAt = Date.now();

  const command = buildCommand(port);
  const child = spawn(command, {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ...preparedEnv,
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
  await once(server, 'close');

  return {
    label,
    command,
    durationMs: Date.now() - startedAt,
    exitCode,
    captures,
    stdout: stdout.slice(0, 4000),
    stderr: stderr.slice(0, 4000),
  };
}

async function main() {
  const prompt = 'Reply with capture-ok only.';
  const results = [];

  results.push(
    await runCapture(
      'claude-code',
      () => [
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
        'claude-sonnet-4-5',
        shellQuote(prompt),
      ].join(' '),
      port => ({
        ANTHROPIC_API_KEY: 'capture-key',
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
        CLAUDE_CODE_SIMPLE: '1',
      }),
      (_req, res) => respondJson(res, anthropicResponse())
    )
  );

  results.push(
    await runCapture(
      'codex-cli',
      port => [
        'codex',
        'exec',
        '--ignore-user-config',
        '--ephemeral',
        '--skip-git-repo-check',
        '--sandbox',
        'read-only',
        '-m',
        'gpt-5.2',
        '-c',
        shellQuote(`model_provider="openai_capture"`),
        '-c',
        shellQuote(`model_providers.openai_capture.name="OpenAI Capture"`),
        '-c',
        shellQuote(`model_providers.openai_capture.base_url="http://127.0.0.1:${port}/v1"`),
        '-c',
        shellQuote(`model_providers.openai_capture.env_key="OPENAI_API_KEY"`),
        '-c',
        shellQuote(`model_providers.openai_capture.wire_api="responses"`),
        shellQuote(prompt),
      ].join(' '),
      port => ({
        OPENAI_API_KEY: 'capture-key',
        OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      }),
      (req, res, capture) => {
        if (capture.jsonBody?.stream === true || /stream/i.test(req.url || '')) {
          respondSse(res, [
            { event: 'response.created', data: { type: 'response.created', response: openAiResponse() } },
            {
              event: 'response.output_text.delta',
              data: {
                type: 'response.output_text.delta',
                item_id: 'msg_capture_001',
                output_index: 0,
                content_index: 0,
                delta: 'capture-ok',
              },
            },
            {
              event: 'response.completed',
              data: { type: 'response.completed', response: openAiResponse() },
            },
          ]);
        } else {
          respondJson(res, openAiResponse());
        }
      }
    )
  );

  results.push(
    await runCapture(
      'gemini-cli',
      () => [
        'gemini',
        '--skip-trust',
        '--prompt',
        shellQuote(prompt),
        '--model',
        'gemini-2.5-flash',
        '--output-format',
        'json',
      ].join(' '),
      port => ({
        GEMINI_API_KEY: 'capture-key',
        GOOGLE_API_KEY: 'capture-key',
        GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${port}`,
      }),
      (req, res, capture) => {
        if (/streamGenerateContent/.test(capture.url || '') || /alt=sse/.test(capture.url || '')) {
          respondGeminiSse(res, [geminiResponse()]);
        } else {
          respondJson(res, geminiResponse());
        }
      }
    )
  );

  console.log(JSON.stringify({ capturedAt: new Date().toISOString(), results }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
