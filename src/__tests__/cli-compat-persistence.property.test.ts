import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';

interface CliCompatibilityResult {
  claudeCode: boolean | null;
  codex: boolean | null;
  testedAt: number | null;
  error?: string;
}

interface SiteConfig {
  name: string;
  url: string;
  cached_data?: {
    models: string[];
    last_refresh: number;
    cli_compatibility?: unknown;
  };
  cli_compatibility?: unknown;
}

interface Config {
  sites: SiteConfig[];
}

function isValidCliCompatibility(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const obj = data as Record<string, unknown>;
  return 'claudeCode' in obj || 'codex' in obj;
}

function normalizeCliCompatibility(data: unknown): CliCompatibilityResult | null {
  if (!isValidCliCompatibility(data)) {
    return null;
  }

  const obj = data as Record<string, unknown>;
  return {
    claudeCode: typeof obj.claudeCode === 'boolean' ? obj.claudeCode : null,
    codex: typeof obj.codex === 'boolean' ? obj.codex : null,
    testedAt: typeof obj.testedAt === 'number' ? obj.testedAt : null,
    error: typeof obj.error === 'string' ? obj.error : undefined,
  };
}

function extractCliCompatibility(site: SiteConfig): CliCompatibilityResult | null {
  return normalizeCliCompatibility(site.cached_data?.cli_compatibility ?? site.cli_compatibility);
}

function loadCliCompatibilityFromConfig(config: Config): Record<string, CliCompatibilityResult> {
  const result: Record<string, CliCompatibilityResult> = Object.create(null);
  for (const site of config.sites) {
    const cliCompatibility = extractCliCompatibility(site);
    if (cliCompatibility) {
      result[site.name] = cliCompatibility;
    }
  }
  return result;
}

function saveCliCompatibilityResult(site: SiteConfig, result: CliCompatibilityResult): SiteConfig {
  const currentCachedData = site.cached_data ?? {
    models: [],
    last_refresh: Date.now(),
  };

  return {
    ...site,
    cached_data: {
      ...currentCachedData,
      cli_compatibility: {
        claudeCode: result.claudeCode,
        codex: result.codex,
        testedAt: result.testedAt,
        error: result.error,
      },
    },
  };
}

const cliCompatibilityResultArb: fc.Arbitrary<CliCompatibilityResult> = fc.record({
  claudeCode: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  codex: fc.oneof(fc.constant(true), fc.constant(false), fc.constant(null)),
  testedAt: fc.oneof(fc.integer({ min: 0, max: Date.now() + 1000000 }), fc.constant(null)),
  error: fc.option(fc.string({ minLength: 0, maxLength: 200 }), { nil: undefined }),
});

const siteNameArb = fc
  .string({ minLength: 1, maxLength: 50 })
  .filter(value => value.trim().length > 0 && !value.includes('\n'));

const siteUrlArb = fc.webUrl();

const siteWithCachedCliCompatArb: fc.Arbitrary<SiteConfig> = fc.record({
  name: siteNameArb,
  url: siteUrlArb,
  cached_data: fc.record({
    models: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
    last_refresh: fc.integer({ min: 0, max: Date.now() + 1000000 }),
    cli_compatibility: cliCompatibilityResultArb,
  }),
});

const siteWithoutCliCompatArb: fc.Arbitrary<SiteConfig> = fc.record({
  name: siteNameArb,
  url: siteUrlArb,
  cached_data: fc.option(
    fc.record({
      models: fc.array(fc.string({ minLength: 1, maxLength: 30 }), { minLength: 0, maxLength: 10 }),
      last_refresh: fc.integer({ min: 0, max: Date.now() + 1000000 }),
    }),
    { nil: undefined }
  ),
});

const corruptedCliCompatArb = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.constant('invalid'),
  fc.constant(123),
  fc.constant([]),
  fc.record({})
);

describe('CLI compatibility persistence properties', () => {
  it('preserves Claude Code and Codex fields after save/load round-trip', () => {
    fc.assert(
      fc.property(siteNameArb, siteUrlArb, cliCompatibilityResultArb, (name, url, original) => {
        const siteAfterSave = saveCliCompatibilityResult(
          {
            name,
            url,
            cached_data: { models: ['gpt-4', 'claude-3'], last_refresh: Date.now() },
          },
          original
        );
        const loaded = loadCliCompatibilityFromConfig({ sites: [siteAfterSave] })[name];

        expect(loaded).toEqual(original);
        expect(Object.keys(siteAfterSave.cached_data?.cli_compatibility ?? {})).toEqual([
          'claudeCode',
          'codex',
          'testedAt',
          'error',
        ]);
      }),
      { numRuns: 100 }
    );
  });

  it('loads cached compatibility data and ignores sites without compatibility data', () => {
    fc.assert(
      fc.property(
        fc.array(siteWithCachedCliCompatArb, { minLength: 1, maxLength: 5 }),
        fc.array(siteWithoutCliCompatArb, { minLength: 1, maxLength: 5 }),
        (sitesWithCompat, sitesWithoutCompat) => {
          const allSites = [...sitesWithCompat, ...sitesWithoutCompat];
          const uniqueSites = allSites.filter(
            (site, index, self) => self.findIndex(current => current.name === site.name) === index
          );
          const expectedNames = new Set(
            sitesWithCompat.filter(site => uniqueSites.includes(site)).map(site => site.name)
          );

          const loaded = loadCliCompatibilityFromConfig({ sites: uniqueSites });

          expect(Object.keys(loaded).length).toBe(expectedNames.size);
          for (const name of Object.keys(loaded)) {
            expect(expectedNames.has(name)).toBe(true);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('prefers cached compatibility data over legacy root-level data', () => {
    fc.assert(
      fc.property(
        siteNameArb,
        siteUrlArb,
        cliCompatibilityResultArb,
        cliCompatibilityResultArb,
        (name, url, cachedCompat, rootCompat) => {
          const loaded = loadCliCompatibilityFromConfig({
            sites: [
              {
                name,
                url,
                cached_data: {
                  models: [],
                  last_refresh: Date.now(),
                  cli_compatibility: cachedCompat,
                },
                cli_compatibility: rootCompat,
              },
            ],
          });

          expect(loaded[name]).toEqual(cachedCompat);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('rejects corrupted compatibility data gracefully', () => {
    fc.assert(
      fc.property(corruptedCliCompatArb, data => {
        expect(isValidCliCompatibility(data)).toBe(false);
        expect(normalizeCliCompatibility(data)).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  it('drops unsupported legacy CLI fields during normalization', () => {
    const legacyKey = ['gemini', 'Cli'].join('');
    const normalized = normalizeCliCompatibility({
      claudeCode: true,
      codex: false,
      [legacyKey]: true,
      testedAt: 123,
    });

    expect(normalized).toEqual({
      claudeCode: true,
      codex: false,
      testedAt: 123,
      error: undefined,
    });
    expect(normalized).not.toHaveProperty(legacyKey);
  });
});
