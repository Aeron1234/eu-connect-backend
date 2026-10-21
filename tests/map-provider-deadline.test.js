import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteProviderRequester } from '../features/map/routeProviderRequest.js';
const base = 'https://routing.example.test/';
const good = async () => ({ ok: true, json: async () => ({ code: 'Ok' }) });

test('a non-responsive provider cannot block the queue permanently', async () => {
  const request = createRouteProviderRequester({ timeoutMs: 10, intervalMs: 0 });
  await assert.rejects(request('route', () => new Promise(() => {}), base), error => error.status === 504 && error.code === 'ROUTING_TIMEOUT');
  assert.equal((await request('route', good, base)).code, 'Ok');
});

test('deadlines include queue wait and expired requests never contact the provider', async () => {
  let calls = 0; const request = createRouteProviderRequester({ timeoutMs: 10, intervalMs: 100 });
  const fetcher = async (...args) => { calls++; return good(...args); };
  await request('route', fetcher, base);
  await assert.rejects(request('route', fetcher, base), error => error.status === 504);
  assert.equal(calls, 1);
});

test('route-provider errors distinguish unreachable roads from an unavailable service', async () => {
  const request = createRouteProviderRequester({ intervalMs: 0 });
  await assert.rejects(request('route', async () => ({ ok: true, json: async () => ({ code: 'NoRoute' }) }), base), error => error.status === 422);
  await assert.rejects(request('route', async () => { throw Error('private upstream failure'); }, base), error => error.status === 503 && !error.message.includes('private'));
});
