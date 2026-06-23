/**
 * 配置字段加密测试
 */

import { describe, it, expect } from 'vitest';
import {
  encryptField,
  decryptField,
  encryptConfigFields,
  decryptConfigFields,
  encryptCustomCliConfigs,
  decryptCustomCliConfigs,
} from '../main/config-field-crypto';
import type { UnifiedConfig, UnifiedSite, AccountCredential } from '../shared/types/site';
import type { CustomCliConfig } from '../shared/types/custom-cli-config';

describe('ConfigFieldCrypto', () => {
  describe('encryptField / decryptField', () => {
    it('should encrypt and decrypt a field', () => {
      const plaintext = 'sk-test-key-12345';
      const encrypted = encryptField(plaintext);

      expect(encrypted).toMatch(/^encrypted:v1:/);
      expect(encrypted).not.toContain(plaintext);

      const decrypted = decryptField(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should return empty string for empty input', () => {
      expect(encryptField('')).toBe('');
      expect(decryptField('')).toBe('');
    });

    it('should handle plaintext as backward compatible', () => {
      const plaintext = 'sk-test-key-67890';
      const decrypted = decryptField(plaintext);
      expect(decrypted).toBe(plaintext);
    });

    it('should generate different ciphertext for same plaintext', () => {
      const plaintext = 'sk-test-key-unique';
      const encrypted1 = encryptField(plaintext);
      const encrypted2 = encryptField(plaintext);

      expect(encrypted1).not.toBe(encrypted2);
      expect(decryptField(encrypted1)).toBe(plaintext);
      expect(decryptField(encrypted2)).toBe(plaintext);
    });
  });

  describe('encryptConfigFields / decryptConfigFields', () => {
    it('should encrypt and decrypt config fields', () => {
      const config: UnifiedConfig = {
        version: '3.1',
        sites: [
          {
            id: 'site1',
            name: 'Test Site',
            url: 'https://api.example.com',
            enabled: true,
            group: 'default',
            api_key: 'sk-site-key-123',
            access_token: 'token-abc-456',
            created_at: Date.now(),
            updated_at: Date.now(),
          } as UnifiedSite,
        ],
        accounts: [
          {
            id: 'acc1',
            site_id: 'site1',
            account_name: 'Test Account',
            user_id: 'user123',
            access_token: 'acc-token-xyz-789',
            auth_source: 'manual',
            status: 'active',
            created_at: Date.now(),
            updated_at: Date.now(),
          } as AccountCredential,
        ],
        siteGroups: [{ id: 'default', name: '默认分组' }],
        settings: {
          timeout: 30,
          concurrent: true,
          show_disabled: false,
        },
        last_updated: Date.now(),
      };

      const encrypted = encryptConfigFields(config);

      expect(encrypted.sites[0].api_key).toMatch(/^encrypted:v1:/);
      expect(encrypted.sites[0].access_token).toMatch(/^encrypted:v1:/);
      expect(encrypted.accounts[0].access_token).toMatch(/^encrypted:v1:/);

      const decrypted = decryptConfigFields(encrypted);

      expect(decrypted.sites[0].api_key).toBe('sk-site-key-123');
      expect(decrypted.sites[0].access_token).toBe('token-abc-456');
      expect(decrypted.accounts[0].access_token).toBe('acc-token-xyz-789');
    });

    it('should handle undefined sensitive fields', () => {
      const config: UnifiedConfig = {
        version: '3.1',
        sites: [
          {
            id: 'site2',
            name: 'Test Site 2',
            url: 'https://api2.example.com',
            enabled: true,
            group: 'default',
            created_at: Date.now(),
            updated_at: Date.now(),
          } as UnifiedSite,
        ],
        accounts: [],
        siteGroups: [],
        settings: {
          timeout: 30,
          concurrent: true,
          show_disabled: false,
        },
        last_updated: Date.now(),
      };

      const encrypted = encryptConfigFields(config);
      const decrypted = decryptConfigFields(encrypted);

      expect(decrypted.sites[0].api_key).toBeUndefined();
      expect(decrypted.sites[0].access_token).toBeUndefined();
    });
  });

  describe('encryptCustomCliConfigs / decryptCustomCliConfigs', () => {
    it('should encrypt and decrypt custom CLI configs', () => {
      const configs: CustomCliConfig[] = [
        {
          id: 'cli1',
          name: 'Custom CLI 1',
          baseUrl: 'https://api.custom.com',
          apiKey: 'sk-custom-key-abc',
          models: ['gpt-4'],
          cliSettings: {
            claudeCode: { enabled: true, model: null },
            codex: { enabled: true, model: null },
            geminiCli: { enabled: true, model: null },
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const encrypted = encryptCustomCliConfigs(configs);

      expect(encrypted[0].apiKey).toMatch(/^encrypted:v1:/);
      expect(encrypted[0].apiKey).not.toContain('sk-custom-key-abc');

      const decrypted = decryptCustomCliConfigs(encrypted);

      expect(decrypted[0].apiKey).toBe('sk-custom-key-abc');
    });

    it('should handle empty apiKey', () => {
      const configs: CustomCliConfig[] = [
        {
          id: 'cli2',
          name: 'Custom CLI 2',
          baseUrl: 'https://api2.custom.com',
          apiKey: '',
          models: [],
          cliSettings: {
            claudeCode: { enabled: true, model: null },
            codex: { enabled: true, model: null },
            geminiCli: { enabled: true, model: null },
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
      ];

      const encrypted = encryptCustomCliConfigs(configs);
      const decrypted = decryptCustomCliConfigs(encrypted);

      expect(decrypted[0].apiKey).toBe('');
    });
  });
});
