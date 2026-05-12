/**
 * AnyRouter User Hash 自动提取器
 * 输入: 站点 URL、API Key、模型名称
 * 输出: 提取的 64 位十六进制 user hash
 * 定位: 服务层 - 通过临时拦截代理 + 隔离 Claude Code 自动提取 AnyRouter 账户的 user hash
 *
 * 工作原理:
 * 1. 启动临时拦截代理（随机端口）
 * 2. 创建隔离 workspace（临时 HOME）
 * 3. 配置临时 Claude Code 指向拦截代理
 * 4. 执行 Claude Code 发送测试请求
 * 5. 拦截代理提取 metadata.user_id 中的 hash
 * 6. 原样转发到真实 AnyRouter
 * 7. 清理临时环境
 *
 * 注意:
 * - 必须使用独立拦截代理，不能通过路由代理提取
 * - 路由代理会根据规则自动选择站点/账户，无法保证提取指定账户
 * - 路由代理会应用 AnyRouter 改写逻辑，覆盖原始 user_id（循环依赖）
 */

import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Logger from './utils/logger';

const log = Logger.scope('AnyRouterHashExtractor');

interface InterceptProxyResult {
  server: http.Server;
  port: number;
  hashPromise: Promise<string>;
}

/**
 * 启动临时拦截代理
 *
 * 功能：
 * 1. 拦截 POST /v1/messages 请求
 * 2. 提取 metadata.user_id 中的 hash
 * 3. 原样转发到真实 AnyRouter（不做任何改写）
 * 4. 返回真实响应
 */
function startInterceptProxy(upstreamUrl: string): InterceptProxyResult {
  let resolveHash: (hash: string) => void;
  let rejectHash: (error: Error) => void;
  let hashExtracted = false;
  let serverInstance: http.Server;

  const hashPromise = new Promise<string>((resolve, reject) => {
    resolveHash = resolve;
    rejectHash = reject;
  });

  const server = http.createServer(async (req, res) => {
    // 只拦截 POST /v1/messages
    if (req.method === 'POST' && req.url?.includes('/v1/messages')) {
      const chunks: Buffer[] = [];

      req.on('data', chunk => chunks.push(chunk));

      req.on('end', async () => {
        const bodyBuffer = Buffer.concat(chunks);
        const bodyText = bodyBuffer.toString('utf-8');

        try {
          // 提取 hash
          if (!hashExtracted) {
            const body = JSON.parse(bodyText);
            const userId = body.metadata?.user_id;

            if (userId) {
              let extractedHash: string | null = null;

              // 处理三种格式：
              // 1. 字符串格式: "user_HASH_account__session_UUID"
              // 2. JSON 对象格式: {"device_id":"...", "account_uuid":"...", "session_id":"..."}
              // 3. JSON 字符串格式: '{"device_id":"...", "account_uuid":"...", "session_id":"..."}'
              if (typeof userId === 'string') {
                // 先尝试正则匹配字符串格式
                const match = userId.match(/^user_([a-f0-9]{64})_account__session_/i);
                if (match) {
                  extractedHash = match[1];
                } else {
                  // 尝试解析为 JSON 对象
                  try {
                    const userIdObj = JSON.parse(userId);
                    if (userIdObj.device_id && typeof userIdObj.device_id === 'string') {
                      if (/^[a-f0-9]{64}$/i.test(userIdObj.device_id)) {
                        extractedHash = userIdObj.device_id;
                        log.info('[HashExtract] Using device_id from JSON string as hash');
                      } else {
                        log.warn('[HashExtract] device_id format unexpected:', userIdObj.device_id);
                      }
                    } else {
                      log.warn('[HashExtract] user_id JSON string missing device_id:', userId);
                    }
                  } catch {
                    log.warn('[HashExtract] user_id string format unexpected:', userId);
                  }
                }
              } else if (typeof userId === 'object' && userId.device_id) {
                // JSON 对象格式：device_id 就是 hash
                const deviceId = userId.device_id;
                if (typeof deviceId === 'string' && /^[a-f0-9]{64}$/i.test(deviceId)) {
                  extractedHash = deviceId;
                  log.info('[HashExtract] Using device_id from object as hash');
                } else {
                  log.warn('[HashExtract] device_id format unexpected:', deviceId);
                }
              } else {
                log.warn('[HashExtract] user_id format unexpected:', userId);
              }

              // 如果成功提取 hash，立即返回成功响应，不再转发
              if (extractedHash) {
                log.info('[HashExtract] Extracted hash:', extractedHash.substring(0, 16) + '...');
                hashExtracted = true;
                resolveHash(extractedHash);

                // 立即返回成功响应给 Claude Code，不转发到上游
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(
                  JSON.stringify({
                    id: 'msg_' + Date.now(),
                    type: 'message',
                    role: 'assistant',
                    content: [{ type: 'text', text: 'Hash extraction successful' }],
                    model: 'claude-opus-4-6',
                    stop_reason: 'end_turn',
                    usage: { input_tokens: 10, output_tokens: 5 },
                  })
                );

                // 延迟关闭服务器，给响应时间发送
                setTimeout(() => {
                  serverInstance.close(() => {
                    log.info('[HashExtract] Intercept proxy closed after successful extraction');
                  });
                }, 100);

                return; // 不再转发到上游
              }
            } else {
              log.warn('[HashExtract] No metadata.user_id in request');
            }
          }

          // 如果没有提取到 hash，转发到真实 AnyRouter
          await forwardToUpstream(req, res, bodyBuffer, upstreamUrl);
        } catch (error: any) {
          log.error('[HashExtract] Failed to process request:', error);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              error: 'intercept_proxy_error',
              message: error.message,
            })
          );
        }
      });
    } else {
      // 其他请求直接转发
      await forwardToUpstream(req, res, null, upstreamUrl);
    }
  });

  // 监听随机端口
  serverInstance = server;
  server.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  log.info(`[HashExtract] Intercept proxy started on port ${port}`);

  // 30 秒超时
  setTimeout(() => {
    if (!hashExtracted) {
      rejectHash(new Error('Timeout: No valid request received within 30 seconds'));
    }
  }, 30000);

  return { server, port, hashPromise };
}

/**
 * 转发请求到上游（原样转发，不做任何改写）
 */
async function forwardToUpstream(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bodyBuffer: Buffer | null,
  upstreamUrl: string
): Promise<void> {
  const url = new URL(upstreamUrl);

  // 构造上游请求
  const options: https.RequestOptions = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      host: url.hostname, // 修正 host 头
    },
    // HTTPS 请求忽略证书验证
    rejectUnauthorized: false,
    // 允许所有 TLS 版本
    minVersion: 'TLSv1',
    maxVersion: 'TLSv1.3',
  };

  const protocol = url.protocol === 'https:' ? https : http;

  const proxyReq = protocol.request(options, (proxyRes: http.IncomingMessage) => {
    // 转发响应头
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);

    // 转发响应体（流式）
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (error: Error) => {
    log.error('[HashExtract] Upstream request failed:', error);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: 'bad_gateway',
          message: `Failed to connect to upstream: ${error.message}`,
        })
      );
    }
  });

  // 转发请求体
  if (bodyBuffer) {
    proxyReq.write(bodyBuffer);
  } else if (req.method !== 'GET' && req.method !== 'HEAD') {
    req.pipe(proxyReq);
    return;
  }

  proxyReq.end();
}

/**
 * 提取 AnyRouter 账户的 user hash
 *
 * 策略：使用用户真实的 Claude Code 环境（不创建临时环境）
 * 原因：
 * 1. device_id 是设备指纹，每个环境都不同
 * 2. 需要提取用户真实环境的 device_id 作为固定 hash
 * 3. 临时环境的 device_id 无法用于后续的路由代理
 */
export async function extractUserHash(
  siteUrl: string,
  apiKey: string,
  model: string = 'claude-opus-4-6'
): Promise<string> {
  log.info('[HashExtract] Starting hash extraction for:', siteUrl);

  // 启动临时拦截代理
  const { server, port, hashPromise } = startInterceptProxy(siteUrl);

  try {
    // 使用真实的 Claude Code 环境（不设置临时 HOME）
    const proxyUrl = `http://127.0.0.1:${port}`;

    log.info('[HashExtract] Starting Claude Code with real environment');
    log.info('[HashExtract] Proxy URL:', proxyUrl);

    // 临时修改用户的 Claude Code 配置（settings.json）
    const userHome = os.homedir();
    const claudeConfigDir = path.join(userHome, '.claude');
    const settingsPath = path.join(claudeConfigDir, 'settings.json');
    const backupPath = path.join(claudeConfigDir, 'settings.json.backup-hash-extract');

    let originalSettings: any = {};
    let settingsModified = false;

    try {
      // 备份原始配置
      if (fs.existsSync(settingsPath)) {
        const settingsContent = fs.readFileSync(settingsPath, 'utf-8');
        originalSettings = JSON.parse(settingsContent);
        fs.writeFileSync(backupPath, settingsContent);
        log.info('[HashExtract] Original settings backed up');
      }

      // 修改配置，指向拦截代理
      const modifiedSettings = {
        ...originalSettings,
        env: {
          ...(originalSettings.env || {}),
          ANTHROPIC_BASE_URL: proxyUrl,
          ANTHROPIC_AUTH_TOKEN: apiKey,
        },
      };

      fs.writeFileSync(settingsPath, JSON.stringify(modifiedSettings, null, 2));
      settingsModified = true;
      log.info('[HashExtract] Settings modified to use intercept proxy');
      log.info('[HashExtract] ANTHROPIC_BASE_URL:', proxyUrl);
      log.info('[HashExtract] ANTHROPIC_AUTH_TOKEN:', apiKey.substring(0, 10) + '...');
    } catch (error) {
      log.error('[HashExtract] Failed to modify settings:', error);
      throw new Error('Failed to modify Claude Code settings');
    }

    // 启动 Claude Code 进程
    const claudeProcess = spawn('claude', ['hello'], {
      env: {
        ...process.env,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: true,
    });

    // 监听进程输出
    claudeProcess.stdout.on('data', (data: Buffer) => {
      log.debug('[HashExtract] Claude stdout:', data.toString().trim());
    });

    claudeProcess.stderr.on('data', (data: Buffer) => {
      log.debug('[HashExtract] Claude stderr:', data.toString().trim());
    });

    claudeProcess.on('error', (error: Error) => {
      log.error('[HashExtract] Claude process error:', error);
    });

    claudeProcess.on('exit', (code: number | null) => {
      log.info('[HashExtract] Claude process exited with code:', code);
    });

    log.info('[HashExtract] Waiting for hash extraction...');

    try {
      // 等待拦截代理提取 hash（最多 30 秒）
      const hash = await Promise.race([
        hashPromise,
        new Promise<string>((_, reject) =>
          setTimeout(
            () => reject(new Error('Timeout: No valid request received within 30 seconds')),
            30000
          )
        ),
      ]);

      log.info('[HashExtract] Successfully extracted hash from real environment');

      return hash;
    } finally {
      // 清理 Claude Code 进程
      claudeProcess.kill('SIGTERM');
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!claudeProcess.killed) {
        claudeProcess.kill('SIGKILL');
      }

      // 恢复原始配置
      if (settingsModified) {
        try {
          if (fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, settingsPath);
            fs.unlinkSync(backupPath);
            log.info('[HashExtract] Original settings restored');
          }
        } catch (error) {
          log.error('[HashExtract] Failed to restore settings:', error);
        }
      }
    }
  } finally {
    // 关闭拦截代理
    server.close();
    log.info('[HashExtract] Intercept proxy closed');
  }
}
