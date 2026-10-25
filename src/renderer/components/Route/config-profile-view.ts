import type {
  ConfigFileDefinition,
  ConfigFileProfile,
  ConfigFileTarget,
} from '../../../shared/types/config-file-profile';
import { DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS } from '../../../shared/types/config-file-profile';

export function createFile(profileId: string): ConfigFileDefinition {
  return {
    id: `${profileId}:file:${crypto.randomUUID()}`,
    path: '',
    template: '',
    format: 'auto',
  };
}

export function createProfile(): ConfigFileProfile {
  const now = Date.now();
  const id = crypto.randomUUID();
  return {
    id,
    name: '新建配置',
    files: [createFile(id)],
    sessionRecordConnectors: [],
    sessionRecordPaths: [],
    target: { kind: 'local-route', model: null },
    createdAt: now,
    updatedAt: now,
  };
}

export function encodeTarget(target: ConfigFileTarget): string {
  if (target.kind === 'local-route') return 'local-route';
  if (target.kind === 'direct') return `direct:${target.configId}`;
  return `managed:${target.siteId}:${target.accountId}`;
}

export function decodeTarget(value: string): ConfigFileTarget {
  const [kind, first, second] = value.split(':');
  if (kind === 'direct') return { kind: 'direct', configId: first, model: null };
  if (kind === 'managed') {
    return { kind: 'managed', siteId: first, accountId: second, model: null };
  }
  return { kind: 'local-route', model: null };
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function renderTemplatePreview(
  template: string,
  values: { baseUrl: string; apiKey: string; model: string }
): string {
  return template
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.baseUrl)
    .join(values.baseUrl)
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.apiKey)
    .join(values.apiKey)
    .split(DEFAULT_CONFIG_FILE_REPLACEMENT_TOKENS.model)
    .join(values.model);
}

export type DiffLine = { kind: 'same' | 'add' | 'del'; text: string };

/** 轻量行级 diff（LCS），不引入第三方库。 */
export function computeLineDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const table: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
    new Array<number>(newLines.length + 1).fill(0)
  );
  for (let i = oldLines.length - 1; i >= 0; i -= 1) {
    for (let j = newLines.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        oldLines[i] === newLines[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      result.push({ kind: 'same', text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      result.push({ kind: 'del', text: oldLines[i] });
      i += 1;
    } else {
      result.push({ kind: 'add', text: newLines[j] });
      j += 1;
    }
  }
  while (i < oldLines.length) {
    result.push({ kind: 'del', text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    result.push({ kind: 'add', text: newLines[j] });
    j += 1;
  }
  return result;
}

export function diffSummary(lines: DiffLine[]): { added: number; removed: number } {
  return lines.reduce(
    (acc, line) => {
      if (line.kind === 'add') acc.added += 1;
      if (line.kind === 'del') acc.removed += 1;
      return acc;
    },
    { added: 0, removed: 0 }
  );
}
