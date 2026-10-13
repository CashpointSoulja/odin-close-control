import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

// Freeze the fixture clock ahead of the real scheduler so rate-limit tests do
// not randomly cross a minute boundary or trigger alarms during a restart.
const TEST_NOW_MS = Date.now() + 10 * 60 * 1000;

export function createRuntime({ persistencePath } = {}) {
  return new Miniflare(convertV4MiniflareOptions({
    name: 'odin-close-control-tests',
    modules: [
      { type: 'ESModule', path: 'tests/fixtures/durable-worker.js' },
      { type: 'ESModule', path: 'src/worker.js' },
      { type: 'ESModule', path: 'src/storage.js' },
      { type: 'ESModule', path: 'public/shared/domain.js' }
    ],
    compatibilityDate: '2026-10-12',
    bindings: { TEST_NOW_MS },
    durableObjects: {
      ODIN_SESSIONS: { className: 'TestOdinSession', useSQLite: true },
      ODIN_RATE_LIMITERS: { className: 'TestOdinRateLimiter', useSQLite: true }
    },
    // Miniflare 5 derives the isolated DO directory from this persistence root
    // when shared storage is disabled (its default).
    ...(persistencePath ? { resourcePersistencePath: persistencePath } : {}),
    serviceBindings: {
      ASSETS: { node: (request, result) => {
        if (new URL(request.url, 'http://localhost').pathname !== '/') {
          result.writeHead(404, { 'Content-Type': 'text/plain' });
          result.end('Not found');
          return;
        }
        result.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=60' });
        result.end('<!doctype html><html><body>Synthetic asset fixture</body></html>');
      } }
    }
  }));
}

export async function call(mf, path, { cookie, body, method = body === undefined ? 'GET' : 'POST', headers = {} } = {}) {
  const response = await mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: 'http://localhost' }), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const contentType = response.headers.get('Content-Type') || '';
  return { response, status: response.status, body: contentType.includes('application/json') ? await response.json() : await response.text() };
}

export async function session(mf, ip = '192.0.2.1') {
  const result = await call(mf, '/api/session', { body: {}, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return { cookie: result.response.headers.get('Set-Cookie').split(';', 1)[0], ...result };
}

export async function readSamples() {
  const [commitmentsCsv, paymentsCsv] = await Promise.all([
    readFile('public/samples/commitments.csv', 'utf8'),
    readFile('public/samples/payments.csv', 'utf8')
  ]);
  return { commitmentsCsv, paymentsCsv };
}

export function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function sessionStub(mf, cookie) {
  const namespace = await mf.getDurableObjectNamespace('ODIN_SESSIONS');
  return namespace.get(namespace.idFromName(`session:${digest(cookie.split('=')[1])}`));
}

export async function rateStub(mf, ip) {
  const namespace = await mf.getDurableObjectNamespace('ODIN_RATE_LIMITERS');
  return namespace.get(namespace.idFromName(`create:${digest(ip)}`));
}

export async function sql(stub, statement, ...params) {
  const response = await stub.fetch('http://test-harness/__test/sql', {
    method: 'POST',
    body: JSON.stringify({ sql: statement, params }),
    headers: { 'Content-Type': 'application/json' }
  });
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).rows;
}

export async function invokeAlarm(stub) {
  const response = await stub.fetch('http://test-harness/__test/alarm');
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
}

export async function alarmTime(stub) {
  const response = await stub.fetch('http://test-harness/__test/alarm-time');
  assert.equal(response.status, 200, await response.clone().text());
  return (await response.json()).alarm;
}

export async function holdDigest(stub, target) {
  const response = await stub.fetch('http://test-harness/__test/digest-hold', { method: 'POST', body: JSON.stringify({ target }), headers: { 'Content-Type': 'application/json' } });
  assert.equal(response.status, 200);
}

export async function waitForDigest(stub) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const response = await stub.fetch('http://test-harness/__test/digest-status');
    assert.equal(response.status, 200);
    if ((await response.json()).started) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('production SHA-256 did not reach the test barrier');
}

export async function releaseDigest(stub) {
  const response = await stub.fetch('http://test-harness/__test/digest-release');
  assert.equal(response.status, 200);
}
