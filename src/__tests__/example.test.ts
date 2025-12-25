/**
 * 输入: 基础测试数据
 * 输出: 测试验证结果
 * 定位: 测试层 - 示例测试文件，验证测试框架基本功能
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 */

import { describe, it, expect } from 'vitest';

describe('Example Test Suite', () => {
  it('should pass a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should handle strings', () => {
    const siteName = 'API Hub';
    expect(siteName).toContain('API');
  });

  it('should handle arrays', () => {
    const models = ['gpt-4', 'gpt-3.5-turbo', 'claude-3'];
    expect(models).toHaveLength(3);
    expect(models).toContain('gpt-4');
  });

  it('should handle objects', () => {
    const site = {
      name: 'Test Site',
      url: 'https://api.example.com',
      enabled: true,
    };
    expect(site).toHaveProperty('name');
    expect(site.enabled).toBe(true);
  });
});

describe('URL Validation', () => {
  const isValidUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  };

  it('should validate correct URLs', () => {
    expect(isValidUrl('https://api.example.com')).toBe(true);
    expect(isValidUrl('http://localhost:3000')).toBe(true);
  });

  it('should reject invalid URLs', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
    expect(isValidUrl('ftp://example.com')).toBe(false);
  });
});
