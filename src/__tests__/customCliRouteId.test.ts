/**
 * customCliRouteId 共享工具单元测试
 */

import { describe, it, expect } from 'vitest';
import {
  CUSTOM_CLI_ROUTE_ACCOUNT_PREFIX,
  CUSTOM_CLI_ROUTE_API_KEY_PREFIX,
  CUSTOM_CLI_ROUTE_SITE_PREFIX,
  buildCustomCliRouteAccountId,
  buildCustomCliRouteApiKeyId,
  buildCustomCliRouteSiteId,
  isCustomCliRouteChannel,
  isCustomCliRouteSiteId,
  parseCustomCliRouteConfigId,
} from '../shared/utils/customCliRouteId';

describe('customCliRouteId helpers', () => {
  it('build* helpers 使用一致前缀 + encodeURIComponent', () => {
    const id = 'cfg-123';
    expect(buildCustomCliRouteSiteId(id)).toBe(`${CUSTOM_CLI_ROUTE_SITE_PREFIX}cfg-123`);
    expect(buildCustomCliRouteAccountId(id)).toBe(`${CUSTOM_CLI_ROUTE_ACCOUNT_PREFIX}cfg-123`);
    expect(buildCustomCliRouteApiKeyId(id)).toBe(`${CUSTOM_CLI_ROUTE_API_KEY_PREFIX}cfg-123`);
  });

  it('build* helpers 处理含特殊字符的 id（含中文）', () => {
    const id = '配置 #1/路径';
    const encoded = encodeURIComponent(id);
    expect(buildCustomCliRouteSiteId(id)).toBe(`${CUSTOM_CLI_ROUTE_SITE_PREFIX}${encoded}`);
  });

  it('空 / 全空白 id 落到 unknown 占位', () => {
    expect(buildCustomCliRouteSiteId('')).toBe(`${CUSTOM_CLI_ROUTE_SITE_PREFIX}unknown`);
    expect(buildCustomCliRouteSiteId('   ')).toBe(`${CUSTOM_CLI_ROUTE_SITE_PREFIX}unknown`);
  });

  it('parseCustomCliRouteConfigId 反向解析合成 site id', () => {
    const id = 'cfg-abc';
    const siteId = buildCustomCliRouteSiteId(id);
    expect(parseCustomCliRouteConfigId(siteId)).toBe(id);
  });

  it('parseCustomCliRouteConfigId 对非自定义 CLI siteId 返回 null', () => {
    expect(parseCustomCliRouteConfigId('site-real-001')).toBeNull();
    expect(parseCustomCliRouteConfigId('')).toBeNull();
  });

  it('isCustomCliRouteSiteId 判定前缀', () => {
    expect(isCustomCliRouteSiteId(buildCustomCliRouteSiteId('x'))).toBe(true);
    expect(isCustomCliRouteSiteId('site-real')).toBe(false);
    expect(isCustomCliRouteSiteId(undefined)).toBe(false);
    expect(isCustomCliRouteSiteId(null)).toBe(false);
  });

  it('isCustomCliRouteChannel 三元组完整匹配才返回 true', () => {
    const id = 'cfg-1';
    const siteId = buildCustomCliRouteSiteId(id);
    const accountId = buildCustomCliRouteAccountId(id);
    const apiKeyId = buildCustomCliRouteApiKeyId(id);
    expect(isCustomCliRouteChannel(siteId, accountId, apiKeyId)).toBe(true);
    expect(isCustomCliRouteChannel(siteId, accountId, 'wrong')).toBe(false);
    expect(isCustomCliRouteChannel(siteId, 'wrong', apiKeyId)).toBe(false);
    expect(isCustomCliRouteChannel('site-real', accountId, apiKeyId)).toBe(false);
  });
});
