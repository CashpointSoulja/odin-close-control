import { createSeedState, reconcile, queue, prepareImport, applyMutation, applyImport, packet } from '../public/shared/domain.js';

const COOKIE = 'odin_close_session';
const SESSION_TTL = 24 * 60 * 60;
const MAX_BODY_BYTES = 70 * 1024;
const MAX_CSV_BYTES = 32 * 1024;
const encoder = new TextEncoder();
const ROUTES = {
  '/api/import/preview': ['commitmentsCsv', 'paymentsCsv', 'expectedRevision'],
  '/api/import': ['commitmentsCsv', 'paymentsCsv', 'previewHash', 'expectedRevision'],
  '/api/match': ['dealId', 'eventId', 'commitmentId', 'expectedRevision'],
  '/api/event/resolve': ['eventId', 'resolution', 'expectedRevision'],
  '/api/legal': ['dealId', 'metadata', 'expectedRevision'],
  '/api/attest': ['dealId', 'kind', 'attested', 'actor', 'expectedRevision'],
  '/api/fee': ['dealId', 'payer', 'expectedRevision'],
  '/api/review/request': ['dealId', 'expectedRevision'],
  '/api/review/approve': ['dealId', 'reviewer', 'confirmed', 'expectedRevision'],
  '/api/reset': ['expectedRevision']
};
const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'X-Frame-Options': 'DENY'
};

class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

function response(body, status = 200, extras = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extras }
  });
}

function protectedResponse(result) {
  const headers = new Headers(result.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
}

async function hash(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}

function validateOrigin(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if ((origin && origin !== new URL(request.url).origin) || (site && site !== 'same-origin' && site !== 'none')) {
    throw new ApiError(403, 'ORIGIN_REJECTED', 'Use this application from its own origin.');
  }
}

async function readJson(request, allowed, { optional = false } = {}) {
  const type = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (type !== 'application/json') throw new ApiError(415, 'JSON_REQUIRED', 'Send application/json.');
  const declared = request.headers.get('Content-Length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'The request body must be at most 70 KiB.');
  }
  let size = 0;
  const chunks = [];
  const reader = request.body?.getReader();
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new ApiError(413, 'BODY_TOO_LARGE', 'The request body must be at most 70 KiB.');
      }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = size ? JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) : (optional ? {} : null); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'The request must contain valid UTF-8 JSON.'); }
  if (!body || Array.isArray(body) || typeof body !== 'object') throw new ApiError(400, 'INVALID_JSON', 'The request must contain a JSON object.');
  if (Object.keys(body).some(key => !allowed.includes(key))) throw new ApiError(400, 'UNKNOWN_FIELD', 'The request contains an unsupported field.');
  return body;
}

async function takeRate(db, key, maximum, duration, now) {
  const window = Math.floor(now / duration);
  const row = await db.prepare(`INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?)
    ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`)
    .bind(`${key}:${window}`, (window + 1) * duration, maximum).first();
  if (!row) throw new ApiError(429, 'RATE_LIMITED', 'Please wait before trying again.');
}

function cookieSecret(request) {
  const values = (request.headers.get('Cookie') || '').split(';').map(value => value.trim());
  const cookie = values.find(value => value.startsWith(`${COOKIE}=`));
  const secret = cookie?.slice(COOKIE.length + 1);
  return secret && /^[a-f0-9]{64}$/.test(secret) ? secret : null;
}

async function loadSession(request, db, now) {
  const secret = cookieSecret(request);
  if (!secret) return null;
  const id = await hash(secret);
  const row = await db.prepare('SELECT id, state_json, revision FROM sessions WHERE id = ? AND expires_at > ?').bind(id, now).first();
  if (!row) return null;
  const state = JSON.parse(row.state_json);
  if (state.revision !== row.revision) throw new Error('Session revision integrity failure');
  return { id, revision: row.revision, state };
}

function statePayload(state) {
  return {
    state,
    queue: queue(state),
    reconciliations: Object.fromEntries(state.deals.map(deal => [deal.id, reconcile(state, deal.id)]))
  };
}

function expectedRevision(body, session) {
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw new ApiError(400, 'REVISION_REQUIRED', 'Supply the current expectedRevision.');
  }
  if (body.expectedRevision !== session.revision) {
    throw new ApiError(409, 'STALE_REVISION', 'This session changed. Reload its state before continuing.');
  }
}

function validateCsv(body) {
  for (const field of ['commitmentsCsv', 'paymentsCsv']) {
    if (typeof body[field] !== 'string') throw new ApiError(400, 'CSV_REQUIRED', 'Supply both synthetic CSV files.');
    if (encoder.encode(body[field]).byteLength > MAX_CSV_BYTES) throw new ApiError(413, 'CSV_TOO_LARGE', 'Each CSV must be at most 32 KiB.');
    if (body[field].split(/\r\n|\n|\r/).filter(line => line.trim()).length > 101) {
      throw new ApiError(413, 'CSV_TOO_MANY_ROWS', 'Each CSV may contain at most 100 data rows.');
    }
  }
}

async function preview(session, body) {
  validateCsv(body);
  const prep = prepareImport(session.state, body.commitmentsCsv, body.paymentsCsv);
  const previewHash = prep.valid ? await hash(JSON.stringify([session.id, session.revision, body.commitmentsCsv, body.paymentsCsv])) : null;
  return { prep, payload: { valid: prep.valid, errors: prep.errors, summary: prep.summary, diff: prep.diff, previewHash, revision: session.revision } };
}

async function saveSession(db, session, nextState, now) {
  const unchanged = nextState.revision === session.revision && JSON.stringify(nextState) === JSON.stringify(session.state);
  if (!unchanged && nextState.revision !== session.revision + 1) throw new Error('Mutation must advance the revision exactly once');
  const result = await db.prepare('UPDATE sessions SET state_json = ?, revision = ? WHERE id = ? AND revision = ? AND expires_at > ?')
    .bind(JSON.stringify(nextState), nextState.revision, session.id, session.revision, now).run();
  if (result.meta.changes !== 1) throw new ApiError(409, 'STALE_REVISION', 'This session changed. Reload its state before continuing.');
}

function csvCell(value) {
  let text = value == null ? '' : String(value);
  if (/^[\s]*[=+\-@]|^[\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function ledgerCsv(state, dealId) {
  const columns = ['event_id', 'deal_id', 'commitment_id', 'currency', 'amount_minor', 'type', 'parent_event_id', 'bank_reference', 'resolution'];
  const rows = state.events.filter(event => event.dealId === dealId).map(event => [event.id, event.dealId, event.commitmentId, event.currency, event.amountMinor, event.type, event.parentEventId, event.bankReference, event.resolution]);
  return [columns, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return protectedResponse(await env.ASSETS.fetch(request));
    }
    try {
      if (!env.DB) throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'The synthetic session database is unavailable.');
      const path = url.pathname;
      const writes = path === '/api/session' || Object.hasOwn(ROUTES, path);
      const reads = ['/api/state', '/api/export', '/api/export/ledger'].includes(path);
      if (!writes && !reads) throw new ApiError(404, 'NOT_FOUND', 'This API route does not exist.');
      if (request.method !== (writes ? 'POST' : 'GET')) return response({ error: { code: 'METHOD_NOT_ALLOWED', message: 'This route does not support that method.' } }, 405, { Allow: writes ? 'POST' : 'GET' });
      if (writes) validateOrigin(request);
      const now = Math.floor(Date.now() / 1000);
      // Cleanup and fixed-window counters are storage-bound, not browser-local state.
      await env.DB.batch([
        env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
        env.DB.prepare('DELETE FROM rate_limits WHERE expires_at <= ?').bind(now)
      ]);
      let session = await loadSession(request, env.DB, now);
      if (path === '/api/session') {
        await readJson(request, [], { optional: true });
        if (session) {
          await takeRate(env.DB, `session:${session.id}`, 120, 60, now);
          return response(statePayload(session.state));
        }
        const ipKey = await hash(request.headers.get('CF-Connecting-IP') || 'local-development');
        await takeRate(env.DB, `create:${ipKey}`, 10, 3600, now);
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        const secret = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
        const id = await hash(secret);
        const state = createSeedState();
        await env.DB.prepare('INSERT INTO sessions (id, state_json, revision, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
          .bind(id, JSON.stringify(state), state.revision, now, now + SESSION_TTL).run();
        const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
        const cookie = `${COOKIE}=${secret}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL}${local ? '' : '; Secure'}`;
        return response(statePayload(state), 201, { 'Set-Cookie': cookie });
      }
      if (!session) throw new ApiError(401, 'SESSION_REQUIRED', 'Start a new synthetic session.');
      await takeRate(env.DB, `session:${session.id}`, 120, 60, now);
      if (path === '/api/state') return response(statePayload(session.state));
      if (reads) {
        if ([...url.searchParams.keys()].some(key => !['dealId', 'revision'].includes(key)) || url.searchParams.getAll('dealId').length !== 1 || url.searchParams.getAll('revision').length !== 1) {
          throw new ApiError(400, 'INVALID_EXPORT_QUERY', 'Supply one dealId and one revision.');
        }
        const requested = url.searchParams.get('revision');
        if (!/^(0|[1-9]\d*)$/.test(requested || '') || Number(requested) !== session.revision) throw new ApiError(409, 'STALE_REVISION', 'Export the currently reviewed revision.');
        const dealId = url.searchParams.get('dealId');
        const reviewedPacket = await packet(session.state, dealId);
        const filename = `${dealId}-reviewed-r${session.revision}`;
        if (path === '/api/export') return response(reviewedPacket, 200, { 'Content-Disposition': `attachment; filename="${filename}.json"` });
        return new Response(ledgerCsv(session.state, dealId), { headers: { ...SECURITY_HEADERS, 'Cache-Control': 'no-store', 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}-ledger.csv"` } });
      }
      await takeRate(env.DB, `write:${session.id}`, 40, 60, now);
      const body = await readJson(request, ROUTES[path]);
      expectedRevision(body, session);
      let nextState;
      if (path === '/api/import/preview' || path === '/api/import') {
        const prepared = await preview(session, body);
        if (path.endsWith('/preview')) return response(prepared.payload);
        if (!prepared.prep.valid) throw new ApiError(422, 'IMPORT_INVALID', 'Correct the synthetic import before applying it.', prepared.prep.errors);
        if (typeof body.previewHash !== 'string' || body.previewHash !== prepared.payload.previewHash) throw new ApiError(409, 'PREVIEW_MISMATCH', 'Preview these exact files at the current revision before importing.');
        nextState = await applyImport(session.state, prepared.prep);
      } else {
        const { expectedRevision: ignored, ...payload } = body;
        nextState = await applyMutation(session.state, path.slice('/api/'.length), payload);
      }
      await saveSession(env.DB, session, nextState, Math.floor(Date.now() / 1000));
      return response(statePayload(nextState));
    } catch (error) {
      // Domain errors are deliberately safe validation messages. Unexpected storage
      // or runtime failures never echo SQL, cookies, submitted text or stack traces.
      const safe = error instanceof ApiError || (Number.isInteger(error.status) && error.status >= 400 && error.status < 500 && typeof error.code === 'string');
      return response({ error: safe ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) } : { code: 'INTERNAL_ERROR', message: 'The request could not be completed. Please try again.' } }, safe ? error.status : 500);
    }
  }
};
