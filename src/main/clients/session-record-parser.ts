import type {
  ConfigSessionRecord,
  SessionRecordConnector,
} from '../../shared/types/config-file-profile';

export function readRecordPath(value: unknown, pathname?: string): unknown {
  if (!pathname) return value;
  let current = value;
  for (const segment of pathname
    .split('.')
    .map(item => item.trim())
    .filter(Boolean)) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment];
    } else return undefined;
  }
  return current;
}

export function stringRecordValue(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const normalized = String(value).trim();
  const containsControlCharacter = Array.from(normalized).some(character => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!normalized || normalized.length > 512 || containsControlCharacter) {
    return undefined;
  }
  return normalized;
}

export function recordTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 0 && value < 10_000_000_000 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function recordOpenState(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'open', 'opened', 'active', 'current', 'selected'].includes(normalized)) {
    return true;
  }
  if (
    ['false', '0', 'closed', 'close', 'inactive', 'ended', 'complete', 'completed'].includes(
      normalized
    )
  ) {
    return false;
  }
  return undefined;
}

export function parseSessionRecords(
  content: string,
  connector: SessionRecordConnector
): { items: unknown[]; windowOpen?: boolean; currentSessionIds?: Set<string> } {
  if (connector.format === 'jsonl') {
    return {
      items: content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => JSON.parse(line)),
    };
  }
  const parsed = JSON.parse(content) as unknown;
  const records = readRecordPath(parsed, connector.recordsPath);
  const windowOpen = connector.windowOpenPath
    ? recordOpenState(readRecordPath(parsed, connector.windowOpenPath))
    : undefined;
  const currentValue = connector.currentSessionIdPath
    ? readRecordPath(parsed, connector.currentSessionIdPath)
    : undefined;
  const currentValues = Array.isArray(currentValue) ? currentValue : [currentValue];
  const currentSessionIds =
    connector.currentSessionIdPath && currentValue !== undefined
      ? new Set(
          currentValues
            .map(stringRecordValue)
            .filter((value): value is string => value !== undefined)
        )
      : undefined;
  return {
    items: Array.isArray(records)
      ? records
      : records && typeof records === 'object'
        ? [records]
        : [],
    windowOpen,
    currentSessionIds,
  };
}

export function extractSessionRecords(
  content: string,
  connector: SessionRecordConnector
): ConfigSessionRecord[] {
  const records: ConfigSessionRecord[] = [];
  const parsed = parseSessionRecords(content, connector);
  for (const item of parsed.items) {
    const sessionId = stringRecordValue(readRecordPath(item, connector.sessionIdPath));
    if (!sessionId) continue;
    const recordState = connector.activePath
      ? recordOpenState(readRecordPath(item, connector.activePath))
      : undefined;
    const isOpen =
      parsed.windowOpen === false
        ? false
        : parsed.windowOpen === true && parsed.currentSessionIds !== undefined
          ? parsed.currentSessionIds.has(sessionId)
          : recordState;
    records.push({
      connectorId: connector.id,
      namespace: connector.namespace,
      sessionId,
      displayName: stringRecordValue(readRecordPath(item, connector.displayNamePath)),
      workspace: stringRecordValue(readRecordPath(item, connector.workspacePath)),
      updatedAt: recordTimestamp(readRecordPath(item, connector.updatedAtPath)),
      ...(isOpen === undefined ? {} : { isOpen }),
    });
  }
  return records;
}
