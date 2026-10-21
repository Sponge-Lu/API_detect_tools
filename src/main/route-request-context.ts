/**
 * 路由请求上下文
 * 输入: 单个下游 HTTP 请求/响应对象
 * 输出: 请求生命周期状态（取消、尝试计数、日志上下文）与统一的记账入口
 * 定位: 服务层 - 把 handleRequest 内散落的闭包状态收敛为一个对象
 */

import type * as http from 'http';
import Logger from './utils/logger';
import { recordRouteRequest } from './route-analytics-service';
import { recordRoutePathOutcome } from './route-stats-service';
import type { RouteCliType } from '../shared/types/route-proxy';
import type { ConcreteCliTargetProtocol } from './route-proxy-shared';

const log = Logger.scope('RouteProxyService');

export const ROUTE_CLIENT_CANCELLED_ERROR_CODE = 'route_client_cancelled';
export const ROUTE_CLIENT_CANCELLED_STATUS_CODE = 499;

let requestSequence = 0;

export function nextRequestId(cliType: RouteCliType): string {
  requestSequence += 1;
  return `${cliType}-${Date.now()}-${requestSequence}`;
}

export class RouteClientCancelledError extends Error {
  constructor(message = 'Route client cancelled request') {
    super(message);
    this.name = 'RouteClientCancelledError';
  }
}

export function isRouteClientCancelledError(error: unknown): boolean {
  return (
    error instanceof RouteClientCancelledError ||
    (error instanceof Error && error.name === 'RouteClientCancelledError')
  );
}

export function createRouteClientCancelledError(): RouteClientCancelledError {
  return new RouteClientCancelledError(ROUTE_CLIENT_CANCELLED_ERROR_CODE);
}

/**
 * 终结错误码按响应对象记录，供「Route request completed」诊断行读取。
 * 不能用 res.getHeader：writeHead 直传的头不会进入内部缓存（Node 文档明示）。
 */
const terminalErrorByResponse = new WeakMap<http.ServerResponse, string>();

export function markRouteTerminalError(res: http.ServerResponse, error: string): void {
  terminalErrorByResponse.set(res, error);
}

export type RouteRequestLogParams = Parameters<typeof recordRouteRequest>[0];
export type RouteRequestLogContext = Omit<
  RouteRequestLogParams,
  | 'requestSelectionStartedAt'
  | 'agentId'
  | 'agentName'
  | 'routeInstanceId'
  | 'outcome'
  | 'statusCode'
  | 'error'
  | 'at'
>;

export interface RouteRequestDiagnostic {
  requestId: string;
  method: string | undefined;
  path: string;
  sourceProtocol: ConcreteCliTargetProtocol | null;
}

export class RouteRequestContext {
  readonly startedAt = Date.now();
  readonly requestId: string;
  readonly abortController = new AbortController();
  /** 当前尝试的日志上下文；客户端取消时据此补一条 499 记录 */
  readonly logContext: RouteRequestLogContext;
  upstreamAttemptCount = 0;
  agentId?: string;
  agentName?: string;
  instanceLogId?: string;
  requestBodyRead = false;
  clientCancelled = false;
  streamCompletionDelivered = false;
  private handlingDone = false;
  private clientCancellationLogged = false;
  private diagnosticLogged = false;
  private readonly recordedAttempts = new Set<number>();

  constructor(
    private readonly req: http.IncomingMessage,
    private readonly res: http.ServerResponse,
    initialCliType: RouteCliType,
    private readonly diagnostic: RouteRequestDiagnostic
  ) {
    this.requestId = diagnostic.requestId;
    this.logContext = {
      requestId: this.requestId,
      attempt: 0,
      cliType: initialCliType,
      canonicalModel: null,
      requestKind: 'inference',
    };
    res.once('close', this.handleResponseClose);
    res.once('finish', this.finish);
    req.on('aborted', this.cancel);
    log.debug('Route request received', diagnostic);
    res.once('finish', this.recordDiagnostic);
    res.once('close', this.recordDiagnostic);
    req.once('aborted', this.recordDiagnostic);
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  recordRequest(params: RouteRequestLogParams): void {
    if (this.clientCancellationLogged) {
      return;
    }
    recordRouteRequest({
      ...params,
      requestSelectionStartedAt: this.startedAt,
      agentId: this.agentId,
      agentName: this.agentName,
      routeInstanceId: this.instanceLogId,
    });
    this.recordedAttempts.add(params.attempt);
  }

  recordClientCancellation(): void {
    if (this.clientCancellationLogged || this.recordedAttempts.has(this.logContext.attempt)) {
      return;
    }
    this.clientCancellationLogged = true;
    this.recordedAttempts.add(this.logContext.attempt);
    recordRouteRequest({
      ...this.logContext,
      requestSelectionStartedAt: this.startedAt,
      agentId: this.agentId,
      agentName: this.agentName,
      routeInstanceId: this.instanceLogId,
      outcome: 'neutral',
      statusCode: ROUTE_CLIENT_CANCELLED_STATUS_CODE,
      error: ROUTE_CLIENT_CANCELLED_ERROR_CODE,
    });
  }

  recordPathOutcome(
    key: Parameters<typeof recordRoutePathOutcome>[0],
    outcome: Parameters<typeof recordRoutePathOutcome>[1],
    meta: Parameters<typeof recordRoutePathOutcome>[2],
    nowOrRuntimeConfig?: Parameters<typeof recordRoutePathOutcome>[3],
    runtimeConfig?: Parameters<typeof recordRoutePathOutcome>[4]
  ): ReturnType<typeof recordRoutePathOutcome> {
    const nextMeta = { ...(meta ?? {}), requestSelectionStartedAt: this.startedAt };
    if (nowOrRuntimeConfig === undefined) {
      return recordRoutePathOutcome(key, outcome, nextMeta);
    }
    return runtimeConfig === undefined
      ? recordRoutePathOutcome(key, outcome, nextMeta, nowOrRuntimeConfig)
      : recordRoutePathOutcome(key, outcome, nextMeta, nowOrRuntimeConfig, runtimeConfig);
  }

  readonly finish = (): void => {
    this.handlingDone = true;
    this.res.off('close', this.handleResponseClose);
    this.res.off('finish', this.finish);
    this.req.off('aborted', this.cancel);
  };

  readonly cancel = (): void => {
    if (this.handlingDone || this.clientCancelled) {
      return;
    }
    this.clientCancelled = true;
    this.recordClientCancellation();
    this.abortUpstream();
  };

  /** 客户端已取消则收尾并返回 true，调用方应立即 return。 */
  stopIfClientCancelled(): boolean {
    if (!this.clientCancelled && !this.signal.aborted) {
      return false;
    }
    this.clientCancelled = true;
    this.recordClientCancellation();
    this.abortUpstream();
    this.finish();
    return true;
  }

  private abortUpstream(): void {
    if (this.requestBodyRead && !this.signal.aborted) {
      this.abortController.abort(createRouteClientCancelledError());
    }
  }

  private readonly handleResponseClose = (): void => {
    if (this.res.writableEnded || this.streamCompletionDelivered) {
      this.finish();
      return;
    }
    this.cancel();
  };

  private readonly recordDiagnostic = (): void => {
    if (this.diagnosticLogged) return;
    this.diagnosticLogged = true;
    this.res.off('finish', this.recordDiagnostic);
    this.res.off('close', this.recordDiagnostic);
    this.req.off('aborted', this.recordDiagnostic);
    const statusCode = this.res.headersSent ? this.res.statusCode : null;
    const terminalError = terminalErrorByResponse.get(this.res);
    // 失败终结统一升为 warn：终结分支本身不再各自打日志，主日志靠这一行定位 CLI 报错原因。
    const logFailedRequest = statusCode !== null && statusCode >= 400;
    log[logFailedRequest ? 'warn' : 'debug']('Route request completed', {
      ...this.diagnostic,
      durationMs: Math.max(0, Date.now() - this.startedAt),
      statusCode,
      termination:
        this.res.writableEnded || this.streamCompletionDelivered ? 'completed' : 'client_cancelled',
      attemptCount: this.upstreamAttemptCount,
      ...(terminalError ? { error: terminalError } : {}),
    });
  };
}
