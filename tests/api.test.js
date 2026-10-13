import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRuntime, call as request, session as createSession, readSamples, sessionStub, sql } from './helpers/durable.js';

let mf;
let samples;

before(async () => {
  mf = createRuntime();
  samples = await readSamples();
});

after(async () => { await mf?.dispose(); });

function call(path, options) {
  return request(mf, path, options);
}

function session(ip = '192.0.2.1') {
  return createSession(mf, ip);
}

test('SQLite Durable Object sessions have opaque HttpOnly cookies and isolate visitors', async () => {
  const first = await session();
  const second = await session();
  const setCookie = first.response.headers.get('Set-Cookie');
  assert.match(setCookie, /^odin_close_session=[a-f0-9]{64};/);
  assert.match(setCookie, /HttpOnly; SameSite=Strict; Max-Age=86400/);
  assert.equal(first.response.headers.get('Cache-Control'), 'no-store');
  assert.match(first.response.headers.get('Content-Security-Policy'), /script-src 'self'/);
  const changed = await call('/api/fee', { cookie: first.cookie, body: { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: first.body.state.revision } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.state.revision, first.body.state.revision + 1);
  const untouched = await call('/api/state', { cookie: second.cookie });
  assert.deepEqual(untouched.body.state, second.body.state);
  assert.deepEqual(Object.keys(changed.body).sort(), ['queue', 'reconciliations', 'state']);
  const rows = await sql(await sessionStub(mf, first.cookie), 'SELECT id, state_json FROM odin_sessions');
  assert.equal(rows.length, 1);
  assert.ok(rows.every(row => !row.id.includes(first.cookie.split('=')[1])));
});

test('the Worker preserves static asset responses and adds document security headers', async () => {
  const result = await call('/');
  assert.equal(result.status, 200);
  assert.match(result.body, /Synthetic asset fixture/);
  assert.equal(result.response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(result.response.headers.get('Cache-Control'), 'public, max-age=60');
  assert.match(result.response.headers.get('Content-Security-Policy'), /script-src 'self'; style-src 'self'/);
  assert.match(result.response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(result.response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(result.response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(result.response.headers.get('X-Frame-Options'), 'DENY');
});

test('revision CAS rejects stale concurrent writes and expired sessions', async () => {
  const own = await session();
  const body = { dealId: 'DEMO-AURORA', payer: 'investors', expectedRevision: own.body.state.revision };
  const outcomes = await Promise.all([call('/api/fee', { cookie: own.cookie, body }), call('/api/fee', { cookie: own.cookie, body })]);
  assert.deepEqual(outcomes.map(result => result.status).sort(), [200, 409]);
  assert.equal(outcomes.find(result => result.status === 409).body.error.code, 'STALE_REVISION');
  const staleReset = await call('/api/reset', { cookie: own.cookie, body: { expectedRevision: own.body.state.revision } });
  assert.equal(staleReset.status, 409);
  const current = await call('/api/state', { cookie: own.cookie });
  const reset = await call('/api/reset', { cookie: own.cookie, body: { expectedRevision: current.body.state.revision } });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.state.revision, current.body.state.revision + 1);
  const stub = await sessionStub(mf, own.cookie);
  await sql(stub, 'UPDATE odin_sessions SET created_at = 0, expires_at = 1');
  assert.equal((await call('/api/state', { cookie: own.cookie })).status, 401);
  assert.deepEqual(await sql(stub, "SELECT name FROM sqlite_master WHERE name LIKE 'odin_%'"), []);
});

test('preview binds exact files and revision; rejected imports are atomic; duplicates are idempotent', async () => {
  const own = await session();
  const input = { ...samples, expectedRevision: own.body.state.revision };
  const preview = await call('/api/import/preview', { cookie: own.cookie, body: input });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.valid, true, JSON.stringify(preview.body.errors));
  assert.match(preview.body.previewHash, /^[a-f0-9]{64}$/);
  assert.equal(Object.hasOwn(preview.body, 'nextState'), false);
  assert.equal(preview.body.revision, input.expectedRevision);
  const wrongHash = await call('/api/import', { cookie: own.cookie, body: { ...input, previewHash: '0'.repeat(64) } });
  assert.equal(wrongHash.status, 409);
  const invalid = await call('/api/import', { cookie: own.cookie, body: { ...input, paymentsCsv: 'event_id,deal_id\nREAL-PAYMENT,REAL-COMPANY', previewHash: preview.body.previewHash } });
  assert.equal(invalid.status, 422);
  assert.deepEqual((await call('/api/state', { cookie: own.cookie })).body.state, own.body.state);
  const imported = await call('/api/import', { cookie: own.cookie, body: { ...input, previewHash: preview.body.previewHash } });
  assert.equal(imported.status, 200);
  const duplicateInput = { ...samples, expectedRevision: imported.body.state.revision };
  const duplicatePreview = await call('/api/import/preview', { cookie: own.cookie, body: duplicateInput });
  assert.equal(duplicatePreview.body.valid, true);
  const duplicate = await call('/api/import', { cookie: own.cookie, body: { ...duplicateInput, previewHash: duplicatePreview.body.previewHash } });
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicate.body.state, imported.body.state);
});

test('write guards reject cross origin, unknown fields, wrong content type and actual oversized bytes', async () => {
  const own = await session();
  const body = { expectedRevision: own.body.state.revision };
  assert.equal((await call('/api/reset', { cookie: own.cookie, body, headers: { Origin: 'https://attacker.example' } })).status, 403);
  assert.equal((await call('/api/reset', { cookie: own.cookie, body: { ...body, email: 'person@example.com' } })).status, 400);
  assert.equal((await call('/api/reset', { cookie: own.cookie, body, headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await call('/api/import/preview', { cookie: own.cookie, body: { ...body, commitmentsCsv: 'x'.repeat(71 * 1024), paymentsCsv: '' } })).status, 413);
  assert.equal((await call('/api/import/preview', { cookie: own.cookie, body: { ...body, commitmentsCsv: 'x'.repeat(33 * 1024), paymentsCsv: '' } })).status, 413);
  const textIdentifier = await call('/api/import/preview', { cookie: own.cookie, body: { ...body, ...samples, paymentsCsv: samples.paymentsCsv.replace('DEMO-BANK-A003', 'DEMO-BANK-JOHN-SMITH') } });
  assert.equal(textIdentifier.status, 200);
  assert.equal(textIdentifier.body.valid, false);
  assert.ok(textIdentifier.body.errors.some(error => error.code === 'INVALID_SYNTHETIC_ID'));
  assert.equal((await call('/api/reset', { cookie: own.cookie })).status, 405);
  assert.equal((await call('/api/state')).status, 401);
});

test('current reviewed revision is required before JSON or ledger exports', async () => {
  const own = await session();
  const revision = own.body.state.revision;
  assert.equal((await call(`/api/export?dealId=DEMO-CEDAR&revision=${revision}`, { cookie: own.cookie })).status, 409);
  const requested = await call('/api/review/request', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', expectedRevision: revision } });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const approved = await call('/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: requested.body.state.revision } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const current = approved.body.state.revision;
  assert.equal((await call(`/api/export?dealId=DEMO-CEDAR&revision=${revision}`, { cookie: own.cookie })).status, 409);
  const packet = await call(`/api/export?dealId=DEMO-CEDAR&revision=${current}`, { cookie: own.cookie });
  assert.equal(packet.status, 200);
  assert.match(packet.response.headers.get('Content-Disposition'), /DEMO-CEDAR-reviewed-r/);
  const ledger = await call(`/api/export/ledger?dealId=DEMO-CEDAR&revision=${current}`, { cookie: own.cookie });
  assert.equal(ledger.status, 200);
  assert.match(ledger.body, /"event_id","deal_id"/);
  await call('/api/fee', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', payer: 'investors', expectedRevision: current } });
  assert.equal((await call(`/api/export?dealId=DEMO-CEDAR&revision=${current + 1}`, { cookie: own.cookie })).status, 409);
});

test('reviewed ledger output neutralizes hostile cells and preserves quoted commas and newlines', async () => {
  const own = await session();
  const fixture = structuredClone(own.body.state);
  // Bypass the public identifier validator deliberately to test output protection
  // against hostile data already present inside a trusted storage fixture.
  const cedar = fixture.events.filter(event => event.dealId === 'DEMO-CEDAR');
  cedar[0].bankReference = '=SUM(A1:A2)';
  cedar[1].bankReference = ' +SUM("A1","A2")';
  cedar[2].bankReference = '\t@SUM(A1:A2)\nnext,line';
  await sql(await sessionStub(mf, own.cookie), 'UPDATE odin_sessions SET state_json = ?', JSON.stringify(fixture));
  const requested = await call('/api/review/request', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', expectedRevision: fixture.revision } });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  const approved = await call('/api/review/approve', { cookie: own.cookie, body: { dealId: 'DEMO-CEDAR', reviewer: 'DEMO-REVIEWER-01', confirmed: true, expectedRevision: requested.body.state.revision } });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  const ledger = await call(`/api/export/ledger?dealId=DEMO-CEDAR&revision=${approved.body.state.revision}`, { cookie: own.cookie });
  assert.equal(ledger.status, 200);
  assert.ok(ledger.body.includes('"\'=SUM(A1:A2)"'));
  assert.ok(ledger.body.includes('"\' +SUM(""A1"",""A2"")"'));
  assert.ok(ledger.body.includes('"\'\t@SUM(A1:A2)\nnext,line"'));
  assert.ok(!ledger.body.includes(',"=SUM(A1:A2)",'));
});

test('SQLite Durable Object rate limits cap session creation per IP and requests per session', async () => {
  for (let i = 0; i < 10; i++) await session('198.51.100.77');
  const limited = await call('/api/session', { body: {}, headers: { 'CF-Connecting-IP': '198.51.100.77' } });
  assert.equal(limited.status, 429);
  const own = await session('203.0.113.99');
  for (let i = 0; i < 120; i++) assert.equal((await call('/api/state', { cookie: own.cookie })).status, 200);
  assert.equal((await call('/api/state', { cookie: own.cookie })).status, 429);
});
