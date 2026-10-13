import worker, { OdinSession, OdinRateLimiter } from '../../src/worker.js';

// These subclasses run the production handlers and storage adapter in workerd.
// SQL inspection and alarm invocation are available only through Miniflare's
// direct namespace stubs; they are absent from the production Worker module.
function withSqlInspection(Base) {
  return class extends Base {
    constructor(ctx, env) {
      super(ctx, env);
      this.testStorage = ctx.storage;
      if (Number.isSafeInteger(env.TEST_NOW_MS)) Date.now = () => env.TEST_NOW_MS;
    }

    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/__test/sql') {
        const { sql, params = [] } = await request.json();
        const result = this.testStorage.transactionSync(() => {
          const cursor = this.testStorage.sql.exec(sql, ...params);
          return { rows: cursor.toArray(), rowsWritten: cursor.rowsWritten };
        });
        return Response.json(result);
      }
      if (path === '/__test/alarm') {
        await super.alarm();
        return Response.json({ alarm: await this.testStorage.getAlarm() });
      }
      if (path === '/__test/alarm-time') {
        return Response.json({ alarm: await this.testStorage.getAlarm() });
      }
      if (path === '/__test/failure') {
        this.testFailure = await request.json();
        return Response.json({ ok: true });
      }
      if (path === '/__test/digest-hold') {
        const { target } = await request.json();
        let release;
        this.testDigestGate = { target, started: false, wait: new Promise(resolve => { release = resolve; }), release: () => release() };
        return Response.json({ ok: true });
      }
      if (path === '/__test/digest-status') {
        return Response.json({ started: this.testDigestGate?.started === true });
      }
      if (path === '/__test/digest-release') {
        this.testDigestGate?.release();
        return Response.json({ ok: true });
      }
      if (this.testFailure) {
        const failure = this.testFailure;
        this.testFailure = null;
        if (failure.mode === 'throw') throw new Error('SQL fixture failure; cookie secret; sensitive stack');
        return new Response('SQL fixture failure; cookie secret; sensitive stack', { status: 502, headers: { 'Set-Cookie': 'sensitive=fixture' } });
      }
      const gate = this.testDigestGate;
      if (gate?.target === path && !gate.started) {
        const original = crypto.subtle.digest;
        const held = (...args) => {
          // Restore immediately so competing requests hash normally. Only this
          // request's first real SHA-256 call waits for the fixture's release.
          crypto.subtle.digest = original;
          gate.started = true;
          return gate.wait.then(() => original.apply(crypto.subtle, args));
        };
        crypto.subtle.digest = held;
        try { return await super.fetch(request); }
        finally { if (crypto.subtle.digest === held) crypto.subtle.digest = original; }
      }
      return super.fetch(request);
    }
  };
}

export class TestOdinSession extends withSqlInspection(OdinSession) {}
export class TestOdinRateLimiter extends withSqlInspection(OdinRateLimiter) {}
export default worker;
