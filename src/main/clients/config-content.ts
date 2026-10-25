import * as TOML from '@iarna/toml';

import {
  applyEdits as applyJsonEdits,
  modify as modifyJson,
  parse as parseJsonc,
  printParseErrorCode,
  type ParseError,
} from 'jsonc-parser';

import * as path from 'path';
import type {
  ConfigFileDefinition,
  ConfigFileApplyMode,
  ConfigFileFormat,
} from '../../shared/types/config-file-profile';

import { normalizeTomlContent } from '../utils/toml-parser';
import { parseDocument } from 'yaml';

export interface FileState {
  path: string;
  exists: boolean;
  content: string;
  hash: string;
  mtimeMs: number | null;
  mode: number | null;
}

export function resolveFileFormat(
  definition: ConfigFileDefinition
): Exclude<ConfigFileFormat, 'auto'> {
  if (definition.format && definition.format !== 'auto') return definition.format;
  const extension = path.extname(definition.path).toLowerCase();
  if (extension === '.json') return 'json';
  if (extension === '.toml') return 'toml';
  if (extension === '.env') return 'env';
  return 'text';
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function parseJsonObject(content: string, label: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const value = parseJsonc(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    const first = errors[0];
    throw new Error(
      `${label} JSON 解析失败: ${printParseErrorCode(first.error)} (位置 ${first.offset})`
    );
  }
  if (!isRecord(value)) throw new Error(`${label} JSON 解析失败: 根节点必须是对象`);
  return value;
}

export function mergeJsonPreservingSource(current: string, generated: string): string {
  parseJsonObject(current, '本地文件');
  const template = parseJsonObject(generated, '模板');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const indentation = current.match(/\r?\n([ \t]+)"/)?.[1] || '  ';
  const formattingOptions = {
    eol: newline,
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  };
  const updates: Array<{ path: string[]; value: unknown }> = [];
  const collectUpdates = (value: unknown, targetPath: string[]) => {
    if (isRecord(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) collectUpdates(child, [...targetPath, key]);
      return;
    }
    updates.push({ path: targetPath, value });
  };
  collectUpdates(template, []);
  let result = current;
  for (const update of updates) {
    result = applyJsonEdits(
      result,
      modifyJson(result, update.path, update.value, { formattingOptions })
    );
  }
  parseJsonObject(result, '合并结果');
  return result;
}

export function parseTomlObject(content: string, label: string): Record<string, unknown> {
  try {
    const value = TOML.parse(normalizeTomlContent(content)) as unknown;
    if (!isRecord(value)) throw new Error('根节点必须是对象');
    return value;
  } catch (error) {
    throw new Error(
      `${label} TOML 解析失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export function parseEnvAssignments(content: string, label: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
    if (!match) throw new Error(`${label} ENV 解析失败: 无法识别 ${rawLine}`);
    result.set(match[1], match[2]);
  }
  return result;
}

export function envCommentSuffix(value: string): string {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character !== '#' || (index > 0 && !/\s/.test(value[index - 1]))) continue;
    let suffixStart = index;
    while (suffixStart > 0 && /\s/.test(value[suffixStart - 1])) suffixStart -= 1;
    return value.slice(suffixStart);
  }
  return '';
}

export function mergeEnv(current: string, generated: string): string {
  const replacements = parseEnvAssignments(generated, '模板');
  if (!current) return generated;
  parseEnvAssignments(current, '本地文件');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const used = new Set<string>();
  const lines = current.split(/\r?\n/).map(line => {
    const match = line.match(/^(\s*)(export\s+)?([A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)(.*)$/);
    if (!match || !replacements.has(match[3])) return line;
    used.add(match[3]);
    const suffix = envCommentSuffix(match[5]);
    return `${match[1]}${match[2] || ''}${match[3]}${match[4]}${replacements.get(match[3])?.trim()}${suffix}`;
  });
  const finalEmptyLine = lines.at(-1) === '' ? lines.pop() : undefined;
  for (const [key, value] of replacements) if (!used.has(key)) lines.push(`${key}=${value}`);
  if (finalEmptyLine !== undefined) lines.push(finalEmptyLine);
  return lines.join(newline);
}

export function parseTomlKeyPath(input: string): string[] | null {
  const segments: string[] = [];
  let cursor = 0;
  const skipWhitespace = () => {
    while (/\s/.test(input[cursor] || '')) cursor += 1;
  };
  skipWhitespace();
  while (cursor < input.length) {
    let segment = '';
    const quote = input[cursor];
    if (quote === '"' || quote === "'") {
      const start = cursor;
      cursor += 1;
      let escaped = false;
      while (cursor < input.length) {
        const character = input[cursor];
        cursor += 1;
        if (quote === '"' && escaped) {
          escaped = false;
        } else if (quote === '"' && character === '\\') {
          escaped = true;
        } else if (character === quote) {
          const raw = input.slice(start, cursor);
          segment = quote === '"' ? (JSON.parse(raw) as string) : raw.slice(1, -1);
          break;
        }
      }
      if (!segment && input[cursor - 1] !== quote) return null;
    } else {
      const start = cursor;
      while (cursor < input.length && !/[.\s]/.test(input[cursor])) cursor += 1;
      segment = input.slice(start, cursor);
    }
    if (!segment) return null;
    segments.push(segment);
    skipWhitespace();
    if (cursor >= input.length) break;
    if (input[cursor] !== '.') return null;
    cursor += 1;
    skipWhitespace();
  }
  return segments;
}

export function tomlPathIdentity(pathSegments: string[]): string {
  return JSON.stringify(pathSegments);
}

export function tomlAssignmentEqualsIndex(line: string): number {
  let quote: '"' | "'" | null = null;
  let escaped = false;
  for (let cursor = 0; cursor < line.length; cursor += 1) {
    const character = line[cursor];
    if (quote === '"' && escaped) {
      escaped = false;
      continue;
    }
    if (quote === '"' && character === '\\') {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === '#') break;
    if (character === '=') return cursor;
  }
  return -1;
}

export function replaceTomlAssignmentValue(localLine: string, templateLine: string): string {
  const localEquals = tomlAssignmentEqualsIndex(localLine);
  const templateEquals = tomlAssignmentEqualsIndex(templateLine);
  if (localEquals < 0 || templateEquals < 0) return templateLine;
  const localValue = localLine.slice(localEquals + 1);
  const localSpacing = localValue.match(/^\s*/)?.[0] || '';
  const localComment = envCommentSuffix(localValue);
  const templateValue = templateLine.slice(templateEquals + 1).trim();
  const templateComment = envCommentSuffix(templateValue);
  const value = templateComment
    ? templateValue.slice(0, -templateComment.length).trimEnd()
    : templateValue;
  return `${localLine.slice(0, localEquals + 1)}${localSpacing}${value}${localComment}`;
}

export function parseTomlLineDocument(content: string): {
  lines: string[];
  assignments: Map<string, number>;
  sections: Map<string, { header: string; path: string[]; start: number; end: number }>;
} {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const assignments = new Map<string, number>();
  const sections = new Map<
    string,
    { header: string; path: string[]; start: number; end: number }
  >();
  let sectionPath: string[] = [];
  let sectionStart = 0;
  let sectionHeader = '';

  const closeSection = (end: number) => {
    sections.set(tomlPathIdentity(sectionPath), {
      header: sectionHeader,
      path: sectionPath,
      start: sectionStart,
      end,
    });
  };

  lines.forEach((line, index) => {
    const sectionMatch = line.match(/^\s*\[([^[]+)]\s*(?:#.*)?$/);
    if (sectionMatch) {
      const parsedSection = parseTomlKeyPath(sectionMatch[1]);
      if (!parsedSection) return;
      closeSection(index);
      sectionPath = parsedSection;
      sectionStart = index;
      sectionHeader = line;
      return;
    }
    const equalsIndex = tomlAssignmentEqualsIndex(line);
    if (equalsIndex < 0) return;
    const keyPath = parseTomlKeyPath(line.slice(0, equalsIndex));
    if (keyPath) assignments.set(tomlPathIdentity([...sectionPath, ...keyPath]), index);
  });
  closeSection(lines.length);
  return { lines, assignments, sections };
}

export function mergeTomlPreservingSource(current: string, generated: string): string {
  parseTomlObject(current, '本地文件');
  const templateObject = parseTomlObject(generated, '模板');
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const hasFinalNewline = /\r?\n$/.test(current);
  const local = parseTomlLineDocument(current);
  const template = parseTomlLineDocument(generated);
  const missingBySection = new Map<string, { path: string[]; lines: string[] }>();

  for (const [identity, templateIndex] of template.assignments) {
    const localIndex = local.assignments.get(identity);
    if (localIndex !== undefined) {
      local.lines[localIndex] = replaceTomlAssignmentValue(
        local.lines[localIndex],
        template.lines[templateIndex]
      );
      continue;
    }
    const fullPath = JSON.parse(identity) as string[];
    const templateValue = fullPath.reduce<unknown>(
      (value, segment) => (isRecord(value) ? value[segment] : undefined),
      templateObject
    );
    const inlineTableEntries = isRecord(templateValue) ? Object.entries(templateValue) : [];
    if (
      local.sections.has(identity) &&
      inlineTableEntries.length > 0 &&
      inlineTableEntries.every(([, value]) => !isRecord(value))
    ) {
      const missing = missingBySection.get(identity) || { path: fullPath, lines: [] };
      for (const [key, value] of inlineTableEntries) {
        const childIdentity = tomlPathIdentity([...fullPath, key]);
        const serialized = TOML.stringify({
          [key]: value,
        } as Parameters<typeof TOML.stringify>[0]).trimEnd();
        const childLocalIndex = local.assignments.get(childIdentity);
        if (childLocalIndex !== undefined) {
          local.lines[childLocalIndex] = replaceTomlAssignmentValue(
            local.lines[childLocalIndex],
            serialized
          );
        } else {
          missing.lines.push(serialized);
        }
      }
      if (missing.lines.length > 0) missingBySection.set(identity, missing);
      continue;
    }
    const section = Array.from(template.sections.values())
      .filter(item => item.path.every((segment, index) => fullPath[index] === segment))
      .sort((left, right) => right.path.length - left.path.length)[0];
    const sectionPath = section?.path || [];
    const sectionIdentity = tomlPathIdentity(sectionPath);
    const missing = missingBySection.get(sectionIdentity) || { path: sectionPath, lines: [] };
    missing.lines.push(template.lines[templateIndex]);
    missingBySection.set(sectionIdentity, missing);
  }

  const existingInsertions = Array.from(missingBySection.entries())
    .filter(([section]) => local.sections.has(section))
    .map(([section, missing]) => ({
      index: local.sections.get(section)!.end,
      lines: missing.lines,
    }))
    .sort((left, right) => right.index - left.index);
  for (const insertion of existingInsertions) {
    local.lines.splice(insertion.index, 0, ...insertion.lines);
  }

  const impliedSections = new Set<string>();
  const rootIdentity = tomlPathIdentity([]);
  const impliedLines: string[] = [];
  for (const [section, missing] of missingBySection) {
    if (local.sections.has(section) || missing.path.length === 0) continue;
    const hasDottedAssignment = Array.from(local.assignments.keys()).some(identity => {
      const assignmentPath = JSON.parse(identity) as string[];
      return (
        assignmentPath.length > missing.path.length &&
        missing.path.every((segment, index) => assignmentPath[index] === segment)
      );
    });
    if (!hasDottedAssignment) continue;
    const header = template.sections.get(section)?.header;
    const dottedPrefix = header
      ?.trim()
      .replace(/^\[/, '')
      .replace(/]\s*(?:#.*)?$/, '');
    if (!dottedPrefix) continue;
    impliedSections.add(section);
    impliedLines.push(...missing.lines.map(line => `${dottedPrefix}.${line.trimStart()}`));
  }
  if (impliedLines.length > 0) {
    local.lines.splice(local.sections.get(rootIdentity)?.end ?? 0, 0, ...impliedLines);
  }

  for (const [section, missing] of missingBySection) {
    if (local.sections.has(section) || impliedSections.has(section)) continue;
    if (local.lines.length > 0 && local.lines.at(-1)?.trim()) local.lines.push('');
    const header = template.sections.get(section)?.header || `[${section}]`;
    if (missing.path.length > 0) local.lines.push(header);
    local.lines.push(...missing.lines);
  }

  const result = local.lines.join(newline) + (hasFinalNewline ? newline : '');
  try {
    parseTomlObject(result, '合并结果');
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}。本地 TOML 与模板存在结构冲突，请选择覆盖模式或调整冲突项。`
    );
  }
  return result;
}

export function removeObsoleteBuiltinManagedFields(
  definition: ConfigFileDefinition,
  current: string,
  generated: string
): string {
  const normalizedPath = definition.path.replace(/\\/g, '/').toLowerCase();
  if (normalizedPath.endsWith('/.claude/settings.json')) {
    const currentObject = parseJsonObject(current, '本地文件');
    const generatedObject = parseJsonObject(generated, '模板');
    const currentEnv = isRecord(currentObject.env) ? currentObject.env : null;
    const generatedEnv = isRecord(generatedObject.env) ? generatedObject.env : null;
    if (currentEnv && generatedEnv) {
      for (const key of ['HTTPS_PROXY', 'HTTP_PROXY']) {
        if (generatedEnv[key] === undefined && currentEnv[key] === 'http://127.0.0.1:7890') {
          delete currentEnv[key];
        }
      }
    }
    return JSON.stringify(currentObject, null, 2) + (current.endsWith('\n') ? '\n' : '');
  }

  if (!normalizedPath.endsWith('/.grok/config.toml')) return current;
  const local = parseTomlLineDocument(current);
  const template = parseTomlLineDocument(generated);
  const managedModels = new Set([
    'api-detect-grok-responses',
    'api-detect-grok-chat',
    'api-detect-grok-messages',
  ]);
  const obsoleteIndexes = [...local.assignments.entries()]
    .filter(([identity]) => {
      const pathSegments = JSON.parse(identity) as string[];
      return (
        pathSegments.length === 3 &&
        pathSegments[0] === 'model' &&
        managedModels.has(pathSegments[1]) &&
        ['api_key', 'extra_headers'].includes(pathSegments[2]) &&
        !template.assignments.has(identity)
      );
    })
    .map(([, index]) => index)
    .sort((left, right) => right - left);
  for (const index of obsoleteIndexes) local.lines.splice(index, 1);
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  return local.lines.join(newline) + (/\r?\n$/.test(current) ? newline : '');
}

export function mergeConfigContent(
  definition: ConfigFileDefinition,
  state: FileState,
  generated: string,
  mode: ConfigFileApplyMode
): string {
  const format = resolveFileFormat(definition);
  if (format === 'yaml') {
    const doc = parseDocument(generated);
    if (doc.errors.length) throw new Error(`YAML 模板解析失败：${doc.errors[0].message}`);
    if (state.exists && mode === 'merge')
      throw new Error('普通 YAML 文件请使用覆盖模式；DSH 由专用配置流程合并');
    return generated;
  }
  if (mode === 'overwrite' || !state.exists) {
    if (format === 'json') parseJsonObject(generated, '模板');
    if (format === 'toml') parseTomlObject(generated, '模板');
    if (format === 'env') parseEnvAssignments(generated, '模板');
    return generated;
  }
  if (format === 'text') throw new Error(`文本文件不支持合并，请选择覆盖: ${definition.path}`);
  if (format === 'json') {
    return mergeJsonPreservingSource(
      removeObsoleteBuiltinManagedFields(definition, state.content, generated),
      generated
    );
  }
  if (format === 'toml') {
    return mergeTomlPreservingSource(
      removeObsoleteBuiltinManagedFields(definition, state.content, generated),
      generated
    );
  }
  return mergeEnv(state.content, generated);
}
