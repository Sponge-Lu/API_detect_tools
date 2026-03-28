# API Key Unmask Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure masked API keys returned by `/api/token/` are resolved to raw values by calling `POST /api/token/{id}/key` before downstream detection, caching, and routing consume them.

**Architecture:** Keep the change inside `TokenService.fetchApiTokens()` so all existing callers benefit without handler-level branching. Parse the token list as before, then enrich only masked entries with an ID by calling the raw-key endpoint and replacing the masked value only when the follow-up response returns a non-masked key.

**Tech Stack:** TypeScript, Vitest, Electron main-process services, existing HTTP/browser fallback helpers

---

### Task 1: Add failing regression tests for masked key enrichment

**Files:**
- Modify: `src/__tests__/token-service.test.ts`
- Test: `src/__tests__/token-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('fetchApiTokens 遇到脱敏 key 时应按 id 再获取明文 key', async () => {
  const { TokenService } = await loadTokenServiceModule(null, {
    httpGetImpl: async () => ({
      status: 200,
      data: {
        data: [{ id: 55092, name: 'demo', group: 'default', key: 'sk-demo****5678', status: 1 }],
      },
    }),
    httpPostImpl: async () => ({
      status: 200,
      data: { success: true, data: { key: 'sk-demo-raw-12345678' } },
    }),
  });

  const service = new TokenService({ createPage: vi.fn() } as any);
  const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'access-token');

  expect(tokens[0]?.key).toBe('sk-demo-raw-12345678');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/token-service.test.ts -t "fetchApiTokens"`
Expected: FAIL because the current implementation returns the masked key and never calls the raw-key endpoint.

- [ ] **Step 3: Write minimal implementation**

```ts
const tokens = await this.enrichMaskedApiKeys(baseUrl, userId, accessToken, parsedTokens, context);
return tokens;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/token-service.test.ts -t "fetchApiTokens"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/token-service.test.ts src/main/token-service.ts docs/superpowers/plans/2026-03-26-api-key-unmask-fetch.md
git commit -m "fix(token): resolve masked api keys by id"
```

### Task 2: Keep degraded behavior safe when raw-key fetch fails

**Files:**
- Modify: `src/__tests__/token-service.test.ts`
- Modify: `src/main/token-service.ts`
- Test: `src/__tests__/token-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it('fetchApiTokens 在明文补拉失败时应保留原脱敏值', async () => {
  const { TokenService } = await loadTokenServiceModule(null, {
    httpGetImpl: async () => ({
      status: 200,
      data: {
        data: [{ id: 55092, name: 'demo', group: 'default', key: 'sk-demo****5678', status: 1 }],
      },
    }),
    httpPostImpl: async () => {
      throw new Error('HTTP 404');
    },
  });

  const service = new TokenService({ createPage: vi.fn() } as any);
  const tokens = await service.fetchApiTokens('https://demo.example.com', 1, 'access-token');

  expect(tokens[0]?.key).toBe('sk-demo****5678');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/__tests__/token-service.test.ts -t "fetchApiTokens"`
Expected: FAIL because the current implementation never attempts the enrichment request.

- [ ] **Step 3: Write minimal implementation**

```ts
try {
  const rawValue = await this.fetchRawApiKeyValue(baseUrl, userId, accessToken, tokenId);
  if (rawValue && !isMaskedApiKeyValue(rawValue)) {
    return { ...token, key: rawValue };
  }
} catch (error) {
  Logger.warn('...', error);
}
return token;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/__tests__/token-service.test.ts -t "fetchApiTokens"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/__tests__/token-service.test.ts src/main/token-service.ts docs/superpowers/plans/2026-03-26-api-key-unmask-fetch.md
git commit -m "test(token): cover masked api key fallback"
```
