import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('site-type-detector', () => {
  it('应从首页 title 识别 Sub2API', async () => {
    vi.doMock('../main/utils/http-client', () => ({
      httpGet: vi.fn(async () => ({ status: 404, data: null })),
      httpRequest: vi.fn(async () => ({
        status: 200,
        data: '<html><head><title>Sub2API 控制台</title></head></html>',
      })),
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: {
        scope: () => ({ debug: vi.fn() }),
      },
    }));

    const { detectSiteType } = await import('../main/site-type-detector');
    const result = await detectSiteType('https://demo.example.com');

    expect(result).toEqual({
      siteType: 'sub2api',
      detectionMethod: 'title',
      matchedValue: 'Sub2API 控制台',
    });
  });

  it('应从首页 HTML 标记识别未暴露标题的 Sub2API 站点', async () => {
    vi.doMock('../main/utils/http-client', () => ({
      httpGet: vi.fn(async () => ({ status: 404, data: null })),
      httpRequest: vi.fn(async () => ({
        status: 200,
        data: `<!doctype html><html><head><title>AC - AI API Gateway</title>
          <script>window.__APP_CONFIG__={"site_subtitle":"AC_公益站","custom_menu_items":[],"backend_mode_enabled":false};</script>
        </head></html>`,
      })),
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: {
        scope: () => ({ debug: vi.fn() }),
      },
    }));

    const { detectSiteType } = await import('../main/site-type-detector');
    const result = await detectSiteType('https://ai.acmi.run');

    expect(result.siteType).toBe('sub2api');
    expect(result.detectionMethod).toBe('html-marker');
  });

  it('应从 /api/status 识别 New API 家族站点', async () => {
    vi.doMock('../main/utils/http-client', () => ({
      httpGet: vi.fn(async () => ({
        status: 200,
        data: {
          success: true,
          data: {
            system_name: 'My New API',
          },
        },
      })),
      httpRequest: vi.fn(async () => ({
        status: 200,
        data: '<html><head><title>控制台</title></head></html>',
      })),
    }));
    vi.doMock('../main/utils/logger', () => ({
      default: {
        scope: () => ({ debug: vi.fn() }),
      },
    }));

    const { detectSiteType } = await import('../main/site-type-detector');
    const result = await detectSiteType('https://demo.example.com');

    expect(result.siteType).toBe('newapi');
    expect(result.detectionMethod).toBe('api-status');
  });
});
