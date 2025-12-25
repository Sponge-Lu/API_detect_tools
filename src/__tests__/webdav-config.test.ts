/**
 * 输入: 模拟的 WebDAV 配置数据
 * 输出: 属性测试验证结果
 * 定位: 测试层 - WebDAV 配置属性测试，验证配置默认值和填充逻辑
 *
 * 🔄 自引用: 当此文件变更时，更新:
 * - 本文件头注释
 * - src/__tests__/FOLDER_INDEX.md
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  WebDAVConfig,
  DEFAULT_WEBDAV_CONFIG,
  fillWebDAVConfigDefaults,
} from '../shared/types/site';

/**
 * WebDAV Configuration Property Tests
 */

// Arbitrary for generating valid WebDAVConfig objects
const webdavConfigArbitrary = fc.record({
  enabled: fc.boolean(),
  serverUrl: fc.webUrl(),
  username: fc.string({ minLength: 1, maxLength: 50 }),
  password: fc.string({ minLength: 0, maxLength: 100 }),
  remotePath: fc.string({ minLength: 1, maxLength: 200 }).map(s => '/' + s.replace(/^\/+/, '')),
  maxBackups: fc.integer({ min: 1, max: 100 }),
});

describe('WebDAV Config Property Tests', () => {
  /**
   * **Feature: webdav-backup, Property 10: Settings Serialization Round Trip**
   * **Validates: Requirements 1.3, 6.2, 6.4, 6.5**
   *
   * For any valid WebDAVConfig object, serializing to JSON and then
   * deserializing SHALL produce an equivalent configuration object.
   */
  it('Property 10: Settings Serialization Round Trip', () => {
    fc.assert(
      fc.property(webdavConfigArbitrary, (config: WebDAVConfig) => {
        // Serialize to JSON
        const serialized = JSON.stringify(config);

        // Deserialize from JSON
        const deserialized = JSON.parse(serialized) as WebDAVConfig;

        // Verify all fields are equivalent
        expect(deserialized.enabled).toBe(config.enabled);
        expect(deserialized.serverUrl).toBe(config.serverUrl);
        expect(deserialized.username).toBe(config.username);
        expect(deserialized.password).toBe(config.password);
        expect(deserialized.remotePath).toBe(config.remotePath);
        expect(deserialized.maxBackups).toBe(config.maxBackups);
      }),
      { numRuns: 100 }
    );
  });
});

describe('WebDAV Config Default Values Property Tests', () => {
  /**
   * **Feature: webdav-backup, Property 11: Default Values for Missing Fields**
   * **Validates: Requirements 6.3**
   *
   * For any partial WebDAV configuration with missing optional fields,
   * loading the configuration SHALL fill in default values for all missing fields.
   */
  it('Property 11: Default Values for Missing Fields', () => {
    // Arbitrary for generating partial configs with random subset of fields
    const partialConfigArbitrary = fc.record(
      {
        enabled: fc.boolean(),
        serverUrl: fc.webUrl(),
        username: fc.string({ minLength: 1, maxLength: 50 }),
        password: fc.string({ minLength: 0, maxLength: 100 }),
        remotePath: fc
          .string({ minLength: 1, maxLength: 200 })
          .map(s => '/' + s.replace(/^\/+/, '')),
        maxBackups: fc.integer({ min: 1, max: 100 }),
      },
      { requiredKeys: [] } // All fields are optional
    );

    fc.assert(
      fc.property(partialConfigArbitrary, (partialConfig: Partial<WebDAVConfig>) => {
        const filledConfig = fillWebDAVConfigDefaults(partialConfig);

        // Verify all fields are present after filling defaults
        expect(typeof filledConfig.enabled).toBe('boolean');
        expect(typeof filledConfig.serverUrl).toBe('string');
        expect(typeof filledConfig.username).toBe('string');
        expect(typeof filledConfig.password).toBe('string');
        expect(typeof filledConfig.remotePath).toBe('string');
        expect(typeof filledConfig.maxBackups).toBe('number');

        // Verify provided values are preserved
        if (partialConfig.enabled !== undefined) {
          expect(filledConfig.enabled).toBe(partialConfig.enabled);
        } else {
          expect(filledConfig.enabled).toBe(DEFAULT_WEBDAV_CONFIG.enabled);
        }

        if (partialConfig.serverUrl !== undefined) {
          expect(filledConfig.serverUrl).toBe(partialConfig.serverUrl);
        } else {
          expect(filledConfig.serverUrl).toBe(DEFAULT_WEBDAV_CONFIG.serverUrl);
        }

        if (partialConfig.username !== undefined) {
          expect(filledConfig.username).toBe(partialConfig.username);
        } else {
          expect(filledConfig.username).toBe(DEFAULT_WEBDAV_CONFIG.username);
        }

        if (partialConfig.password !== undefined) {
          expect(filledConfig.password).toBe(partialConfig.password);
        } else {
          expect(filledConfig.password).toBe(DEFAULT_WEBDAV_CONFIG.password);
        }

        if (partialConfig.remotePath !== undefined) {
          expect(filledConfig.remotePath).toBe(partialConfig.remotePath);
        } else {
          expect(filledConfig.remotePath).toBe(DEFAULT_WEBDAV_CONFIG.remotePath);
        }

        if (partialConfig.maxBackups !== undefined) {
          expect(filledConfig.maxBackups).toBe(partialConfig.maxBackups);
        } else {
          expect(filledConfig.maxBackups).toBe(DEFAULT_WEBDAV_CONFIG.maxBackups);
        }
      }),
      { numRuns: 100 }
    );
  });
});
