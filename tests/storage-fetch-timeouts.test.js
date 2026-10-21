import test from 'node:test';
import assert from 'node:assert/strict';
import { createStorageFetch } from '../config/storageFetch.js';

test('Supabase Storage requests abort at their deadline and preserve authentication and payload', async () => {
  const alive = setTimeout(() => {}, 1000);
  try {
    const body = Buffer.from('file');
    const guarded = createStorageFetch(async (url, options) => {
      assert.equal(options.body, body); assert.equal(options.headers.Authorization, 'Bearer test');
      return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
    }, { timeoutMs: 5 });
    await assert.rejects(guarded('https://storage.example.test/storage/v1/object/bucket/file', { method: 'POST', body, headers: { Authorization: 'Bearer test' } }), error => error.name === 'TimeoutError');
  } finally { clearTimeout(alive); }
});

test('Storage delete cleanup uses its shorter deadline and caller cancellation survives', async () => {
  const alive = setTimeout(() => {}, 1000);
  try {
    const guarded = createStorageFetch((_, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true })), { timeoutMs: 500, deleteTimeoutMs: 5 });
    await assert.rejects(guarded(new URL('https://storage.example.test/storage/v1/object/bucket'), { method: 'DELETE' }), error => error.name === 'TimeoutError');
    const controller = new AbortController(); const pending = guarded('https://storage.example.test/storage/v1/object/bucket/file', { signal: controller.signal }); controller.abort();
    await assert.rejects(pending, error => error.name === 'AbortError');
  } finally { clearTimeout(alive); }
});

test('non-storage Supabase requests retain their original options', async () => {
  const options = { headers: { apikey: 'test' } }; let forwarded;
  const guarded = createStorageFetch(async (url, value) => { forwarded = value; return 'response'; });
  assert.equal(await guarded('https://storage.example.test/auth/v1/token', options), 'response'); assert.equal(forwarded, options);
});
