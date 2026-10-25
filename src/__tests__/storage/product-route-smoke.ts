import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as fs from 'node:fs';
import path from 'node:path';
import type { UnifiedConfigManager } from '../../main/unified-config-manager';
import type { ConfigFileProfile } from '../../shared/types/config-file-profile';

export async function runProductRouteSmoke(
  root: string,
  manager: UnifiedConfigManager,
  moduleAt: (name: string) => any
): Promise<void> {
  const bundles = moduleAt('app-storage-bundle.js');
  const before = await bundles.createAppStorageBundleContent({
    mode: 'full-manifest',
    includeSecrets: true,
  });
  const endpoints = ['/v1/messages', '/v1/responses', '/v1/chat/completions'];
  const protocols = ['anthropic-messages', 'openai-responses', 'openai-chat-completions'] as const;
  const seen: string[] = [];
  const upstream = http.createServer((request, response) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
    });
    request.on('end', () => {
      assert.equal(JSON.parse(body).model, 'smoke-model');
      assert.ok(
        request.headers.authorization === 'Bearer upstream-test-key' ||
          request.headers['x-api-key'] === 'upstream-test-key'
      );
      seen.push(request.url!);
      const text = 'packaged-route-ok';
      const usage = { input_tokens: 1, output_tokens: 1 };
      const result =
        request.url === '/v1/messages'
          ? {
              id: 'msg_smoke',
              type: 'message',
              role: 'assistant',
              model: 'smoke-model',
              content: [{ type: 'text', text }],
              stop_reason: 'end_turn',
              usage,
            }
          : request.url === '/v1/responses'
            ? {
                id: 'resp_smoke',
                object: 'response',
                model: 'smoke-model',
                status: 'completed',
                output: [
                  {
                    id: 'out_smoke',
                    type: 'message',
                    role: 'assistant',
                    status: 'completed',
                    content: [{ type: 'output_text', text, annotations: [] }],
                  },
                ],
                usage: { ...usage, total_tokens: 2 },
              }
            : {
                id: 'chat_smoke',
                object: 'chat.completion',
                model: 'smoke-model',
                choices: [
                  {
                    index: 0,
                    message: { role: 'assistant', content: text },
                    finish_reason: 'stop',
                  },
                ],
                usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
              };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    });
  });
  const listen = (server: http.Server) =>
    new Promise<number>(resolve =>
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))
    );
  const close = (server: http.Server) =>
    new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  const upstreamPort = await listen(upstream);
  const reservation = http.createServer();
  const proxyPort = await listen(reservation);
  await close(reservation);
  const proxy = moduleAt('route-proxy-service.js');
  const clients = moduleAt('config-file-profile-service.js');
  try {
    const account = manager.getAccountsBySiteId('one')[0];
    await manager.updateSite('one', { url: `http://127.0.0.1:${upstreamPort}` });
    await manager.updateAccount(account.id, {
      api_key: 'upstream-test-key',
      local_api_keys: [
        {
          id: 'smoke-upstream',
          key: 'upstream-test-key',
          name: 'Smoke',
          models: ['smoke-model'],
          group: 'default',
          groupMultiplier: 1,
          source: 'local',
          status: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      supportedProtocols: [...protocols],
      routeTargetProtocol: 'native',
    });
    await manager.updateAccountCachedData(account.id, () => ({
      models: ['smoke-model'],
      last_refresh: Date.now(),
    }));
    await moduleAt('route-model-registry-service.js').syncModelRegistrySources(true);
    const registry = structuredClone(manager.getRoutingConfig().modelRegistry);
    const sources = registry.sources.filter(
      source => source.siteId === 'one' && source.originalModel === 'smoke-model'
    );
    assert.ok(sources.length > 0);
    registry.displayItems = [
      {
        id: 'smoke-redirect',
        canonicalName: 'smoke-model',
        vendor: sources[0].vendor,
        sourceKeys: sources.map(source => source.sourceKey),
        mode: 'manual',
        createdAt: 1,
        updatedAt: 1,
      },
    ];
    await manager.updateRouteModelRegistry(registry);
    await moduleAt('route-model-registry-service.js').syncModelRegistrySources(true);
    for (const protocol of protocols)
      await manager.upsertRouteRule({
        id: `smoke-${protocol}`,
        name: 'Smoke',
        sourceProtocol: protocol,
        enabled: true,
        patternType: 'exact',
        pattern: 'smoke-model',
        priority: -100,
        allowedSiteIds: ['one'],
        createdAt: 1,
        updatedAt: 1,
      });
    const clientPath = path.join(root, 'protocol-client.json');
    const profile: ConfigFileProfile = {
      id: 'protocol-client',
      name: 'Protocol smoke',
      authMode: 'third-party',
      files: [
        {
          id: 'settings',
          path: clientPath,
          format: 'json',
          template: '{"baseUrl":"{{BASE_URL}}","apiKey":"{{API_KEY}}","model":"{{MODEL}}"}',
        },
      ],
      sessionRecordConnectors: [],
      sessionRecordPaths: [],
      target: { kind: 'local-route', model: 'smoke-model' },
      localRouteCredential: { id: 'protocol-key', apiKey: 'sk-protocol-client', createdAt: 1 },
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    await manager.updateRouteServerConfig({ enabled: true, host: '127.0.0.1', port: proxyPort });
    const saved = await clients.upsertConfigFileProfile({ profile });
    await manager.updateRouteClientRouting(saved.id, { mode: 'client', modelId: 'smoke-model' });
    const preview = await clients.previewConfigFileProfile({
      profileId: saved.id,
      expectedRevision: saved.revision,
      applyMode: 'overwrite',
    });
    await clients.commitConfigFileProfile({ transactionId: preview.transactionId });
    assert.equal(JSON.parse(fs.readFileSync(clientPath, 'utf8')).apiKey, 'sk-protocol-client');
    await proxy.startProxyServer();
    for (const endpoint of endpoints) {
      const input =
        endpoint === '/v1/responses'
          ? { input: 'hello', store: false }
          : { messages: [{ role: 'user', content: 'hello' }], max_tokens: 32 };
      const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
        const request = http.request(
          {
            host: '127.0.0.1',
            port: proxyPort,
            path: endpoint,
            method: 'POST',
            headers: {
              authorization: 'Bearer sk-protocol-client',
              'content-type': 'application/json',
            },
          },
          response => {
            let body = '';
            response.on('data', chunk => {
              body += chunk;
            });
            response.on('end', () => resolve({ status: response.statusCode!, body }));
          }
        );
        request.setTimeout(10000, () => request.destroy(new Error('Packaged route timed out')));
        request.on('error', reject);
        request.end(JSON.stringify({ ...input, model: 'smoke-model', stream: false }));
      });
      assert.equal(result.status, 200, result.body);
      assert.ok(result.body.includes('packaged-route-ok'), result.body);
    }
    assert.deepEqual(seen, endpoints);
    const storage = moduleAt('storage/application-storage.js').getApplicationStorage();
    const version = storage.coordinator.version('config-file-profiles');
    storage.database.connection.exec(
      "CREATE TRIGGER smoke_delete_failure BEFORE DELETE ON profile_files WHEN OLD.profile_id = 'protocol-client' BEGIN SELECT RAISE(ABORT, 'injected profile delete failure'); END"
    );
    await assert.rejects(
      clients.deleteConfigFileProfile({ profileId: saved.id }),
      /injected profile delete failure/
    );
    assert.deepEqual(storage.coordinator.version('config-file-profiles'), version);
    assert.ok(
      (await clients.loadConfigFileProfiles()).some(
        (item: ConfigFileProfile) => item.id === saved.id
      )
    );
    storage.database.connection.exec('DROP TRIGGER smoke_delete_failure');
    await clients.deleteConfigFileProfile({ profileId: saved.id });
    assert.equal(
      (await clients.loadConfigFileProfiles()).some(
        (item: ConfigFileProfile) => item.id === saved.id
      ),
      false
    );
    assert.equal(JSON.parse(fs.readFileSync(clientPath, 'utf8')).apiKey, 'sk-protocol-client');
  } finally {
    await proxy.stopProxyServer();
    await close(upstream);
    await bundles.restoreAppStorageBackupContent(before, path.join(root, 'config.json'));
  }
}
