import type {
  CliCompatibilityResult,
  ClaudeTestDetail,
  CodexTestDetail,
  GeminiTestDetail,
} from '../../store/detectionStore';

export interface CliCompatibilityMetaInput {
  name: string;
  enabled: boolean;
  configured: boolean;
  status: boolean | null | undefined;
  testedAt?: number | null;
  claudeDetail?: ClaudeTestDetail;
  codexDetail?: CodexTestDetail;
  geminiDetail?: GeminiTestDetail;
  sourceLabel?: string;
  error?: string;
}

export function getCliCompatibilityIconClass(input: {
  enabled: boolean;
  configured: boolean;
  status: boolean | null | undefined;
}): string {
  if (!input.enabled) return 'opacity-15 grayscale';
  if (!input.configured) return 'opacity-25 grayscale';
  if (input.status === null || input.status === undefined) return 'opacity-50 grayscale';
  if (input.status === false) return 'opacity-70 grayscale brightness-75';
  return 'opacity-100';
}

export function getCliCompatibilityStatusText(input: {
  enabled: boolean;
  configured: boolean;
  status: boolean | null | undefined;
}): string {
  if (!input.enabled) return '未启用';
  if (!input.configured) return '未配置';
  if (input.status === true) return '支持';
  if (input.status === false) return '不支持';
  return '已配置，待测试';
}

function formatReplyText(replyText?: string): string {
  const normalized = replyText?.replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return '';
  return normalized.length <= 48 ? normalized : `${normalized.slice(0, 45)}...`;
}

export function getClaudeDetailText(compatibility: CliCompatibilityResult | undefined): string {
  const detail = compatibility?.claudeDetail;
  const replyText = formatReplyText(detail?.replyText);
  if (!replyText) return '';
  return ` [回答: ${replyText}]`;
}

export function getCodexDetailText(compatibility: CliCompatibilityResult | undefined): string {
  const detail = compatibility?.codexDetail;
  if (!detail) return '';

  const responsesStatus = detail.responses === true ? '✓' : detail.responses === false ? '✗' : '?';
  const replyText = formatReplyText(detail.replyText);
  return ` [responses: ${responsesStatus}${replyText ? `, 回答: ${replyText}` : ''}]`;
}

export function getGeminiDetailText(compatibility: CliCompatibilityResult | undefined): string {
  const detail = compatibility?.geminiDetail;
  if (!detail) return '';

  const nativeStatus = detail.native === true ? '✓' : detail.native === false ? '✗' : '?';
  const proxyStatus = detail.proxy === true ? '✓' : detail.proxy === false ? '✗' : '?';

  let hint = '';
  if (detail.native === true) {
    hint = ' (原生格式可用)';
  } else if (detail.native === false && detail.proxy === true) {
    hint = ' (仅兼容格式可用，CLI可能不工作)';
  } else if (detail.native === false && detail.proxy === false) {
    hint = ' (均不可用)';
  }

  const replyText = formatReplyText(detail.replyText);
  return ` [native: ${nativeStatus}, proxy: ${proxyStatus}${replyText ? `, 回答: ${replyText}` : ''}]${hint}`;
}

export function formatCliCompatibilityTestedAt(timestamp: number | null | undefined): string {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return '刚刚测试';
  if (minutes < 60) return `${minutes} 分钟前测试`;
  if (hours < 24) return `${hours} 小时前测试`;
  return `${days} 天前测试`;
}

export function buildCliCompatibilityTooltip(input: CliCompatibilityMetaInput): string {
  const statusText = getCliCompatibilityStatusText(input);
  const testedAtText =
    input.testedAt && input.configured
      ? ` (${formatCliCompatibilityTestedAt(input.testedAt)})`
      : '';
  const claudeDetailText = input.claudeDetail
    ? getClaudeDetailText({ claudeDetail: input.claudeDetail } as CliCompatibilityResult)
    : '';
  const codexDetailText = input.codexDetail
    ? getCodexDetailText({ codexDetail: input.codexDetail } as CliCompatibilityResult)
    : '';
  const geminiDetailText = input.geminiDetail
    ? getGeminiDetailText({ geminiDetail: input.geminiDetail } as CliCompatibilityResult)
    : '';
  const sourceText = input.sourceLabel ? ` [${input.sourceLabel}]` : '';
  const errorText = input.error?.trim() ? `\n错误: ${input.error.trim()}` : '';
  return `${input.name}: ${statusText}${claudeDetailText}${codexDetailText}${geminiDetailText}${testedAtText}${sourceText}${errorText}`;
}
