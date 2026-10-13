export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

const missingSession = () => new ApiError(401, 'SESSION_REQUIRED', 'Start a new synthetic session.');
const staleRevision = () => new ApiError(409, 'STALE_REVISION', 'This session changed. Reload its state before continuing.');

// Every instance owns only its Odin namespace's SQLite database. The financial
// model remains a single revision-bound JSON value; counters are separate rows.
export class OdinSqlStore {
  constructor(storage, { sessions = false } = {}) {
    this.storage = storage;
    this.sql = storage.sql;
    this.sessions = sessions;
  }

  transaction(callback) {
    try { return this.storage.transactionSync(callback); }
    catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(503, 'STORAGE_UNAVAILABLE', 'Synthetic session storage is unavailable. Please try again later.');
    }
  }

  hasSchema() {
    return this.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      this.sessions ? 'odin_sessions' : 'odin_rate_limits').toArray().length === 1;
  }

  initialize() {
    if (this.sessions) this.sql.exec(`CREATE TABLE IF NOT EXISTS odin_sessions (
        id TEXT PRIMARY KEY NOT NULL,
        state_json TEXT NOT NULL CHECK (json_valid(state_json)),
        revision INTEGER NOT NULL CHECK (revision >= 0),
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        CHECK (expires_at > created_at)
      )`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS odin_rate_limits (
        key TEXT PRIMARY KEY NOT NULL,
        count INTEGER NOT NULL CHECK (count > 0),
        expires_at INTEGER NOT NULL
      )`);
  }

  expireExpired(now) {
    return this.transaction(() => {
      if (!this.hasSchema()) return null;
      if (this.sessions) this.sql.exec('DELETE FROM odin_sessions WHERE expires_at <= ?', now);
      this.sql.exec('DELETE FROM odin_rate_limits WHERE expires_at <= ?', now);
      const sessionExpiry = this.sessions
        ? this.sql.exec('SELECT MIN(expires_at) AS expiry FROM odin_sessions').toArray()[0].expiry
        : null;
      const rateExpiry = this.sql.exec('SELECT MIN(expires_at) AS expiry FROM odin_rate_limits').toArray()[0].expiry;
      const expiries = [sessionExpiry, rateExpiry].filter(value => value !== null);
      return expiries.length ? Math.min(...expiries) : null;
    });
  }

  loadSession(id, now) {
    return this.transaction(() => {
      if (!this.hasSchema()) return null;
      this.sql.exec('DELETE FROM odin_sessions WHERE expires_at <= ?', now);
      this.sql.exec('DELETE FROM odin_rate_limits WHERE expires_at <= ?', now);
      const row = this.sql.exec('SELECT id, state_json, revision, expires_at FROM odin_sessions WHERE id = ?', id).toArray()[0];
      if (!row) return null;
      const state = JSON.parse(row.state_json);
      if (state.revision !== row.revision) throw new Error('Session revision integrity failure');
      return { id: row.id, revision: row.revision, state, expiresAt: row.expires_at };
    });
  }

  hasActiveSession(now) {
    return this.transaction(() => {
      if (!this.hasSchema()) return false;
      this.sql.exec('DELETE FROM odin_sessions WHERE expires_at <= ?', now);
      return this.sql.exec('SELECT id FROM odin_sessions LIMIT 1').toArray().length !== 0;
    });
  }

  createSession(id, state, now, ttl) {
    this.transaction(() => {
      this.initialize();
      // Creation is used only for a newly generated opaque identity. Neither
      // reads nor mutations initialize absent or expired visitor state.
      this.sql.exec('INSERT INTO odin_sessions (id, state_json, revision, created_at, expires_at) VALUES (?, ?, ?, ?, ?)',
        id, JSON.stringify(state), state.revision, now, now + ttl);
    });
  }

  assertCurrent(session, now) {
    const current = this.loadSession(session.id, now);
    if (!current) throw missingSession();
    if (current.revision !== session.revision) throw staleRevision();
  }

  saveSession(session, nextState, now) {
    const serialized = JSON.stringify(nextState);
    const unchanged = nextState.revision === session.revision && serialized === JSON.stringify(session.state);
    if (!unchanged && nextState.revision !== session.revision + 1) throw new Error('Mutation must advance the revision exactly once');
    const result = this.transaction(() => {
      // Expiry and revision are checked again here after asynchronous domain
      // hashing. An expired row is removed before returning an explicit 401.
      if (!this.hasSchema()) return 'missing';
      this.sql.exec('DELETE FROM odin_sessions WHERE expires_at <= ?', now);
      const current = this.sql.exec('SELECT revision FROM odin_sessions WHERE id = ?', session.id).toArray()[0];
      if (!current) return 'missing';
      if (current.revision !== session.revision) return 'stale';
      const updated = this.sql.exec(`UPDATE odin_sessions SET state_json = ?, revision = ?
        WHERE id = ? AND revision = ? AND expires_at > ? RETURNING revision`,
      serialized, nextState.revision, session.id, session.revision, now).toArray();
      return updated.length === 1 ? 'saved' : 'stale';
    });
    if (result === 'missing') throw missingSession();
    if (result !== 'saved') throw staleRevision();
  }

  takeRate(key, maximum, duration, now) {
    const window = Math.floor(now / duration);
    const expiresAt = (window + 1) * duration;
    const accepted = this.transaction(() => {
      if (!this.hasSchema()) this.initialize();
      this.sql.exec('DELETE FROM odin_rate_limits WHERE expires_at <= ?', now);
      const rows = this.sql.exec(`INSERT INTO odin_rate_limits (key, count, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(key) DO UPDATE SET count = count + 1 WHERE count < ? RETURNING count`,
      `${key}:${window}`, expiresAt, maximum).toArray();
      return rows.length === 1;
    });
    if (!accepted) throw new ApiError(429, 'RATE_LIMITED', 'Please wait before trying again.');
    return expiresAt;
  }
}
