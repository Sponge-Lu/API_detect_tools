import { describe, it, expect } from 'vitest';
import {
  urlSchema,
  siteNameSchema,
  userIdSchema,
  siteConfigSchema,
  createApiTokenSchema,
  settingsSchema,
  validateUrl,
  validateSiteConfig,
} from '../shared/schemas';

describe('URL Schema', () => {
  it('should accept valid https URLs', () => {
    const result = urlSchema.safeParse('https://api.example.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://api.example.com');
    }
  });

  it('should accept valid http URLs', () => {
    const result = urlSchema.safeParse('http://localhost:3000');
    expect(result.success).toBe(true);
  });

  it('should auto-prepend https:// to URLs without protocol', () => {
    const result = urlSchema.safeParse('api.example.com');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('https://api.example.com');
    }
  });

  it('should reject empty strings', () => {
    const result = urlSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject invalid URLs', () => {
    const result = urlSchema.safeParse('not a valid url !!!');
    expect(result.success).toBe(false);
  });
});

describe('Site Name Schema', () => {
  it('should accept valid names', () => {
    const result = siteNameSchema.safeParse('My API Site');
    expect(result.success).toBe(true);
  });

  it('should trim whitespace', () => {
    const result = siteNameSchema.safeParse('  My Site  ');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('My Site');
    }
  });

  it('should reject empty names', () => {
    const result = siteNameSchema.safeParse('');
    expect(result.success).toBe(false);
  });

  it('should reject names over 50 characters', () => {
    const longName = 'a'.repeat(51);
    const result = siteNameSchema.safeParse(longName);
    expect(result.success).toBe(false);
  });
});

describe('User ID Schema', () => {
  it('should accept valid numeric strings', () => {
    const result = userIdSchema.safeParse('12345');
    expect(result.success).toBe(true);
  });

  it('should accept empty strings', () => {
    const result = userIdSchema.safeParse('');
    expect(result.success).toBe(true);
  });

  it('should reject non-numeric strings', () => {
    const result = userIdSchema.safeParse('abc');
    expect(result.success).toBe(false);
  });

  it('should reject negative numbers', () => {
    const result = userIdSchema.safeParse('-1');
    expect(result.success).toBe(false);
  });
});

describe('Site Config Schema', () => {
  it('should validate a complete site config', () => {
    const config = {
      name: 'Test Site',
      url: 'https://api.example.com',
      api_key: 'sk-test123',
      system_token: 'token123',
      user_id: '100',
      enabled: true,
      group: 'default',
    };

    const result = siteConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
  });

  it('should apply defaults for optional fields', () => {
    const config = {
      name: 'Minimal Site',
      url: 'https://api.example.com',
    };

    const result = siteConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.group).toBe('default');
      expect(result.data.has_checkin).toBe(false);
    }
  });

  it('should reject completely invalid URL', () => {
    const config = {
      name: 'Test Site',
      url: '',
    };

    const result = siteConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  it('should accept URL without protocol and auto-prepend https', () => {
    const config = {
      name: 'Test Site',
      url: 'api.example.com',
    };

    const result = siteConfigSchema.safeParse(config);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.url).toBe('https://api.example.com');
    }
  });
});

describe('Create API Token Schema', () => {
  it('should validate token with unlimited quota', () => {
    const data = {
      name: 'My Token',
      group: 'default',
      unlimitedQuota: true,
    };

    const result = createApiTokenSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should validate token with limited quota', () => {
    const data = {
      name: 'My Token',
      group: 'default',
      unlimitedQuota: false,
      quota: '100',
    };

    const result = createApiTokenSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('should reject empty token name', () => {
    const data = {
      name: '',
      group: 'default',
      unlimitedQuota: true,
    };

    const result = createApiTokenSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('Settings Schema', () => {
  it('should validate valid settings', () => {
    const settings = {
      timeout: 30,
      concurrent: true,
      show_disabled: true,
      auto_refresh: false,
      refresh_interval: 300,
    };

    const result = settingsSchema.safeParse(settings);
    expect(result.success).toBe(true);
  });

  it('should reject timeout below minimum', () => {
    const settings = {
      timeout: 1,
      concurrent: true,
      show_disabled: true,
      auto_refresh: false,
      refresh_interval: 300,
    };

    const result = settingsSchema.safeParse(settings);
    expect(result.success).toBe(false);
  });
});

describe('Validation Helper Functions', () => {
  describe('validateUrl', () => {
    it('should return success for valid URL', () => {
      const result = validateUrl('https://example.com');
      expect(result.success).toBe(true);
    });

    it('should return error for invalid URL', () => {
      const result = validateUrl('');
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBeDefined();
      }
    });
  });

  describe('validateSiteConfig', () => {
    it('should return success for valid config', () => {
      const result = validateSiteConfig({
        name: 'Test',
        url: 'https://example.com',
      });
      expect(result.success).toBe(true);
    });

    it('should return errors array for invalid config', () => {
      const result = validateSiteConfig({
        // name 是必填项，空字符串会验证失败
        name: '',
        url: 'https://example.com',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0]).toContain('站点名称');
      }
    });
  });
});
