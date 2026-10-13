import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Agent, request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createRuntime, call, session, readSamples, sessionStub, rateStub, sql, invokeAlarm, alarmTime, holdDigest, waitForDigest, releaseDigest } from './helpers/durable.js';

async function runtime(t, options) {
  const mf = createRuntime(options);
  t.after(() => mf.dispose());
  await mf.ready;
  return mf;
}

// Separate HTTP agents model two browser clients that share one copied cookie.
function httpClient(t, origin, cookie) {
  const agent = new Agent({ keepAlive: true });
  t.after(() => agent.destroy());
  return (path, body) => new Promise((resolveResponse, reject) => {
    const text = JSON.stringify(body);
    const request = httpRequest(new URL(path, origin), {
      agent, method: 'POST',
      headers: { Origin: origin.origin, Cookie: cookie, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text) }
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolveResponse({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    request.end(text);
  });
}

async function persistenceDirectory(t) {
  await mkdir('work', { recursive: true });
  const path = await mkdtemp(resolve('work', 'durable-test-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

async function sqliteFiles(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await sqliteFiles(path));
    else if (entry.name.endsWith('.sqlite')) paths.push(path);
  }
  return paths;
}

async function approvedCedar(mf, own) {
  const requested = await call(mf, '/api/review/request', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', expectedRevision: own.body.state.revision } });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const approved = await call(mf, '/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: requested.body.state.revision } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  return approved;
}

test('two independent HTTP clients sharing a cookie can commit a revision exactly once', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const origin = await mf.ready;
  const first = httpClient(t, origin, own.cookie);
  const second = httpClient(t, origin, own.cookie);
  const results = await Promise.all([
    first('/api/fee', { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: own.body.state.revision }),
    second('/api/fee', { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: own.body.state.revision })
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409).body.error.code, 'STALE_REVISION');
  const current = await call(mf, '/api/state', { cookie: own.cookie });
  assert.equal(current.body.state.revision, own.body.state.revision + 1);
  assert.deepEqual(current.body.state, results.find(result => result.status === 200).body.state);
  assert.equal(current.body.state.deals.filter(deal => deal.feePayer === 'investors').length, 1);
  const row = (await sql(await sessionStub(mf, own.cookie), 'SELECT revision, state_json FROM odin_sessions'))[0];
  assert.equal(row.revision, current.body.state.revision);
  assert.deepEqual(JSON.parse(row.state_json), current.body.state);
});

test('different visitors write independently into separate real SQLite objects', async t => {
  const mf = await runtime(t);
  const first = await session(mf, '192.0.2.11');
  const second = await session(mf, '192.0.2.12');
  const firstStub = await sessionStub(mf, first.cookie);
  const secondStub = await sessionStub(mf, second.cookie);
  assert.notEqual(firstStub.id.toString(), secondStub.id.toString());
  const results = await Promise.all([
    call(mf, '/api/fee', { cookie: first.cookie, body: { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: first.body.state.revision } }),
    call(mf, '/api/fee', { cookie: second.cookie, body: { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: second.body.state.revision }, headers: { 'X-Odin-Session-Id': 'forged' } })
  ]);
  assert.deepEqual(results.map(result => result.status), [200, 200]);
  assert.equal(results[0].body.state.deals.find(deal => deal.id === 'DEMO-CEDAR').feePayer, 'lead');
  assert.equal(results[1].body.state.deals.find(deal => deal.id === 'DEMO-AURORA').feePayer, 'lead');
  for (const [stub, result] of [[firstStub, results[0]], [secondStub, results[1]]]) {
    const rows = await sql(stub, 'SELECT id, revision, state_json FROM odin_sessions');
    assert.equal(rows.length, 1);
    assert.deepEqual(JSON.parse(rows[0].state_json), result.body.state);
    assert.match((await sql(stub, "SELECT sql FROM sqlite_master WHERE name = 'odin_sessions'"))[0].sql, /CHECK \(json_valid\(state_json\)\)/);
  }
});

test('disposing and recreating Miniflare preserves state, audit, approved review and exact export hash', async t => {
  const persistencePath = await persistenceDirectory(t);
  let mf = createRuntime({ persistencePath });
  t.after(() => mf.dispose());
  const own = await session(mf);
  const approved = await approvedCedar(mf, own);
  const exportPath = `/api/export?dealId=DEMO-CEDAR&revision=${approved.body.state.revision}`;
  const before = await call(mf, exportPath, { cookie: own.cookie });
  assert.equal(before.status, 200);
  assert.match(before.body.snapshotHash, /^[a-f0-9]{64}$/);
  assert.equal(before.body.review.approvedHash, before.body.snapshotHash);
  await mf.dispose();
  const files = await sqliteFiles(persistencePath);
  assert.ok(files.length >= 2, 'session and limiter must persist as SQLite databases');
  for (const path of files) assert.equal((await readFile(path)).subarray(0, 16).toString('utf8'), 'SQLite format 3\0');
  mf = createRuntime({ persistencePath });
  const current = await call(mf, '/api/state', { cookie: own.cookie });
  assert.equal(current.status, 200);
  assert.deepEqual(current.body.state, approved.body.state);
  const after = await call(mf, exportPath, { cookie: own.cookie });
  assert.equal(after.status, 200);
  assert.deepEqual(after.body, before.body);
  const stub = await sessionStub(mf, own.cookie);
  assert.deepEqual(JSON.parse((await sql(stub, 'SELECT state_json FROM odin_sessions'))[0].state_json), approved.body.state);
  assert.ok(await alarmTime(stub) > Date.now());
});

test('expired session cookies fail closed and a subsequent explicit session gets a new identity', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  await sql(stub, 'UPDATE odin_sessions SET created_at = 0, expires_at = 1');
  const expired = await call(mf, '/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: own.body.state.revision } });
  assert.equal(expired.status, 401);
  assert.equal(expired.body.error.code, 'SESSION_REQUIRED');
  assert.match(expired.response.headers.get('Set-Cookie'), /odin_close_session=;.*Max-Age=0/);
  assert.deepEqual(await sql(stub, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
  assert.equal((await call(mf, '/api/session', { cookie: own.cookie, body: {} })).status, 401);
  const fresh = await session(mf);
  assert.notEqual(fresh.cookie, own.cookie);
  assert.deepEqual(fresh.body.state, own.body.state);
});

test('session alarms delete expired SQL state and rate counters without an incoming API request', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  assert.ok(await alarmTime(stub) > Date.now());
  await sql(stub, 'UPDATE odin_sessions SET created_at = 0, expires_at = 1');
  await sql(stub, 'INSERT INTO odin_rate_limits (key, count, expires_at) VALUES (?, ?, ?)', 'expired', 17, 1);
  await invokeAlarm(stub);
  assert.deepEqual(await sql(stub, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
  assert.equal(await alarmTime(stub), null);
});

test('invalid CSV and mismatched previews leave every persisted state byte unchanged', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  const samples = await readSamples();
  const input = { ...samples, expectedRevision: own.body.state.revision };
  const preview = await call(mf, '/api/import/preview', { cookie: own.cookie, body: input });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true);
  const before = await sql(stub, 'SELECT id, state_json, revision, created_at, expires_at FROM odin_sessions');
  const invalid = await call(mf, '/api/import', { cookie: own.cookie, body: { ...input, paymentsCsv: 'event_id,deal_id\nREAL-PAYMENT,REAL-COMPANY', previewHash: preview.body.previewHash } });
  assert.equal(invalid.status, 422);
  assert.equal(invalid.body.error.code, 'IMPORT_INVALID');
  assert.deepEqual(await sql(stub, 'SELECT id, state_json, revision, created_at, expires_at FROM odin_sessions'), before);
  const wrong = await call(mf, '/api/import', { cookie: own.cookie, body: { ...input, previewHash: '0'.repeat(64) } });
  assert.equal(wrong.status, 409);
  assert.deepEqual(await sql(stub, 'SELECT id, state_json, revision, created_at, expires_at FROM odin_sessions'), before);
});

test('intervening mutations reject stale approval and clear the requested review', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const requested = await call(mf, '/api/review/request', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', expectedRevision: own.body.state.revision } });
  assert.equal(requested.status, 200);
  const changed = await call(mf, '/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: requested.body.state.revision } });
  assert.equal(changed.status, 200);
  const stale = await call(mf, '/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: requested.body.state.revision } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');
  const missingReview = await call(mf, '/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: changed.body.state.revision } });
  assert.equal(missingReview.status, 409);
  assert.equal(missingReview.body.error.code, 'STALE_REVIEW');
  const current = await call(mf, '/api/state', { cookie: own.cookie });
  assert.deepEqual(current.body.state, changed.body.state);
  assert.equal(current.body.state.deals.find(deal => deal.id === 'DEMO-CEDAR').review, null);
  assert.equal((await call(mf, `/api/export?dealId=DEMO-CEDAR&revision=${changed.body.state.revision}`, { cookie: own.cookie })).status, 409);
});

test('SQLite rate counters expire and alarm cleanup preserves live windows', async t => {
  const mf = await runtime(t);
  const ip = '198.51.100.121';
  const own = await session(mf, ip);
  const creation = await rateStub(mf, ip);
  const initial = await sql(creation, 'SELECT key, count, expires_at FROM odin_rate_limits');
  assert.equal(initial.length, 1);
  assert.equal(initial[0].count, 1);
  assert.ok(initial[0].expires_at > Math.floor(Date.now() / 1000));
  await sql(creation, 'UPDATE odin_rate_limits SET count = 10, expires_at = 1');
  await invokeAlarm(creation);
  assert.deepEqual(await sql(creation, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
  assert.equal(await alarmTime(creation), null);
  await session(mf, ip);
  assert.equal((await sql(creation, 'SELECT count FROM odin_rate_limits'))[0].count, 1);
  const stub = await sessionStub(mf, own.cookie);
  assert.equal((await call(mf, '/api/state', { cookie: own.cookie })).status, 200);
  const future = Math.floor(Date.now() / 1000) + 600;
  await sql(stub, 'INSERT INTO odin_rate_limits (key, count, expires_at) VALUES (?, ?, ?)', 'old-window', 120, 1);
  await sql(stub, 'INSERT INTO odin_rate_limits (key, count, expires_at) VALUES (?, ?, ?)', 'live-window', 2, future);
  await invokeAlarm(stub);
  assert.deepEqual(await sql(stub, 'SELECT key FROM odin_rate_limits WHERE key = ?', 'old-window'), []);
  assert.equal((await sql(stub, 'SELECT count FROM odin_rate_limits WHERE key = ?', 'live-window'))[0].count, 2);
  assert.equal((await sql(stub, 'SELECT count(*) AS total FROM odin_sessions'))[0].total, 1);
  assert.ok(await alarmTime(stub) > Date.now());
});

test('rejected writes consume durable limits and cannot reset them by restarting workerd', async t => {
  const persistencePath = await persistenceDirectory(t);
  let mf = createRuntime({ persistencePath });
  t.after(() => mf.dispose());
  const own = await session(mf);
  for (let index = 0; index < 40; index++) {
    const rejected = await call(mf, '/api/reset', { cookie: own.cookie, body: { expectedRevision: own.body.state.revision, unsupported: true } });
    assert.equal(rejected.status, 400);
  }
  await mf.dispose();
  mf = createRuntime({ persistencePath });
  const limited = await call(mf, '/api/reset', { cookie: own.cookie, body: { expectedRevision: own.body.state.revision } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  const current = await call(mf, '/api/state', { cookie: own.cookie });
  assert.equal(current.status, 200);
  assert.deepEqual(current.body.state, own.body.state);
});

test('an export held during real SHA-256 rejects a concurrently changed reviewed revision', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const approved = await approvedCedar(mf, own);
  const stub = await sessionStub(mf, own.cookie);
  await holdDigest(stub, '/api/export');
  const pending = call(mf, `/api/export?dealId=DEMO-CEDAR&revision=${approved.body.state.revision}`, { cookie: own.cookie });
  await waitForDigest(stub);
  const changed = await call(mf, '/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: approved.body.state.revision } });
  assert.equal(changed.status, 200);
  await releaseDigest(stub);
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, changed.body.state);
});

test('a preview held during real SHA-256 rejects a concurrently changed revision', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  await holdDigest(stub, '/api/import/preview');
  const pending = call(mf, '/api/import/preview', { cookie: own.cookie, body: { ...await readSamples(), expectedRevision: own.body.state.revision } });
  await waitForDigest(stub);
  const changed = await call(mf, '/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: own.body.state.revision } });
  assert.equal(changed.status, 200);
  await releaseDigest(stub);
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, changed.body.state);
});

test('review approval and reviewed export held during SHA-256 fail closed if SQL expiry passes', async t => {
  for (const operation of ['approve', 'export']) {
    const mf = await runtime(t);
    const own = await session(mf);
    let current = await call(mf, '/api/review/request', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', expectedRevision: own.body.state.revision } });
    assert.equal(current.status, 200);
    if (operation === 'export') {
      current = await call(mf, '/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: current.body.state.revision } });
      assert.equal(current.status, 200);
    }
    const stub = await sessionStub(mf, own.cookie);
    const target = operation === 'approve' ? '/api/review/approve' : '/api/export';
    await holdDigest(stub, target);
    const pending = operation === 'approve'
      ? call(mf, target, { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: current.body.state.revision } })
      : call(mf, `${target}?dealId=DEMO-CEDAR&revision=${current.body.state.revision}`, { cookie: own.cookie });
    await waitForDigest(stub);
    await sql(stub, 'UPDATE odin_sessions SET created_at = 0, expires_at = 1');
    await releaseDigest(stub);
    const expired = await pending;
    assert.equal(expired.status, 401, operation);
    assert.equal(expired.body.error.code, 'SESSION_REQUIRED');
    assert.match(expired.response.headers.get('Set-Cookie'), /Max-Age=0/);
    assert.deepEqual(await sql(stub, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
  }
});

test('valid-shaped unknown cookies never seed sessions or leave SQLite schema behind', async t => {
  const mf = await runtime(t);
  const cookie = `odin_close_session=${'b'.repeat(64)}`;
  const result = await call(mf, '/api/state', { cookie });
  assert.equal(result.status, 401);
  assert.equal(result.body.error.code, 'SESSION_REQUIRED');
  const stub = await sessionStub(mf, cookie);
  assert.deepEqual(await sql(stub, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
  assert.equal(await alarmTime(stub), null);
});

test('a duplicate import held during SHA-256 cannot overwrite an intervening successful write', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const samples = await readSamples();
  const firstInput = { ...samples, expectedRevision: own.body.state.revision };
  const firstPreview = await call(mf, '/api/import/preview', { cookie: own.cookie, body: firstInput });
  const imported = await call(mf, '/api/import', { cookie: own.cookie, body: { ...firstInput, previewHash: firstPreview.body.previewHash } });
  assert.equal(imported.status, 200);
  const input = { ...samples, expectedRevision: imported.body.state.revision };
  const preview = await call(mf, '/api/import/preview', { cookie: own.cookie, body: input });
  assert.equal(preview.body.valid, true);
  const stub = await sessionStub(mf, own.cookie);
  await holdDigest(stub, '/api/import');
  const pending = call(mf, '/api/import', { cookie: own.cookie, body: { ...input, previewHash: preview.body.previewHash } });
  await waitForDigest(stub);
  const changed = await call(mf, '/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: imported.body.state.revision } });
  assert.equal(changed.status, 200);
  await releaseDigest(stub);
  const stale = await pending;
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'STALE_REVISION');
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, changed.body.state);
});

test('returned and thrown Durable Object storage failures produce only a safe 503 response', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  for (const mode of ['return', 'throw']) {
    assert.equal((await stub.fetch('http://test-harness/__test/failure', { method: 'POST', body: JSON.stringify({ mode }) })).status, 200);
    const failed = await call(mf, '/api/state', { cookie: own.cookie });
    assert.equal(failed.status, 503, mode);
    assert.deepEqual(failed.body, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Synthetic session storage is unavailable. Please try again later.' } });
    assert.equal(failed.response.headers.get('Set-Cookie'), null);
    assert.equal(failed.response.headers.get('Cache-Control'), 'no-store');
  }
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, own.body.state);
});

test('malformed session creation requests consume the persistent per-IP attempt limit', async t => {
  const mf = await runtime(t);
  const ip = '203.0.113.201';
  for (let index = 0; index < 10; index++) {
    const rejected = await mf.dispatchFetch('http://localhost/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', 'CF-Connecting-IP': ip }, body: '{' });
    assert.equal(rejected.status, 400);
  }
  const limited = await call(mf, '/api/session', { body: {}, headers: { 'CF-Connecting-IP': ip } });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  assert.equal((await sql(await rateStub(mf, ip), 'SELECT count FROM odin_rate_limits'))[0].count, 10);
});

test('malformed existing-session requests consume its persisted request limit without changing state', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  for (let index = 0; index < 120; index++) {
    const rejected = await mf.dispatchFetch('http://localhost/api/session', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost', Cookie: own.cookie }, body: '{' });
    assert.equal(rejected.status, 400);
  }
  const limited = await call(mf, '/api/session', { cookie: own.cookie, body: {} });
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, 'RATE_LIMITED');
  const row = (await sql(await sessionStub(mf, own.cookie), 'SELECT state_json, revision FROM odin_sessions'))[0];
  assert.equal(row.revision, own.body.state.revision);
  assert.deepEqual(JSON.parse(row.state_json), own.body.state);
});

test('a real SQLite update failure rolls back state and returns a safe 503 without a fallback write', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  const stub = await sessionStub(mf, own.cookie);
  const before = await sql(stub, 'SELECT * FROM odin_sessions');
  await sql(stub, "CREATE TRIGGER test_reject_update BEFORE UPDATE ON odin_sessions BEGIN SELECT RAISE(ABORT, 'private SQL failure fixture'); END");
  const body = { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: own.body.state.revision };
  const failed = await call(mf, '/api/fee', { cookie: own.cookie, body });
  assert.equal(failed.status, 503);
  assert.deepEqual(failed.body, { error: { code: 'STORAGE_UNAVAILABLE', message: 'Synthetic session storage is unavailable. Please try again later.' } });
  assert.deepEqual(await sql(stub, 'SELECT * FROM odin_sessions'), before);
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, own.body.state);
  await sql(stub, 'DROP TRIGGER test_reject_update');
  const retried = await call(mf, '/api/fee', { cookie: own.cookie, body });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.state.revision, own.body.state.revision + 1);
});

test('the public Worker never exposes internal Durable Object or test fixture routes', async t => {
  const mf = await runtime(t);
  const own = await session(mf);
  for (const path of ['/__test/sql', '/__test/failure', '/__test/digest-release', '/internal/create', '/internal/rate', '/api/__test/sql', '/api/internal/create']) {
    const result = await call(mf, path, { cookie: own.cookie, body: {} });
    assert.equal(result.status, 404, path);
  }
  assert.deepEqual((await call(mf, '/api/state', { cookie: own.cookie })).body.state, own.body.state);
});
