import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

function nonempty(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${name} must be nonempty`);
  return value;
}

function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a nonnegative safe integer`);
  return value;
}

function json(value, name) {
  if (value === undefined) throw new TypeError(`${name} is required`);
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new TypeError(`${name} must be JSON`);
    if (typeof item === 'undefined' || typeof item === 'function' || typeof item === 'symbol') throw new TypeError(`${name} must be JSON`);
    return item;
  });
}

function request(row) {
  return {
    id: row.id, card: row.card, model: row.model, role: row.role,
    maximumNano: row.maximum_nano, price: JSON.parse(row.price), bounds: JSON.parse(row.bounds),
    state: row.state, usage: row.usage === null ? null : JSON.parse(row.usage),
    costNano: row.cost_nano, reason: row.reason,
    costBasis: row.state === 'unknown' && row.cost_nano !== null ? 'reservation maximum; actual usage unknown' : row.cost_nano === null ? 'unsettled' : 'reported usage',
  };
}

export class CardLedger {
  constructor({ path, card }) {
    this.card = nonempty(card, 'card');
    this.db = new DatabaseSync(nonempty(path, 'path'));
    this.db.exec(`
      PRAGMA busy_timeout = 10000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS requests (
        card TEXT NOT NULL, id TEXT NOT NULL, model TEXT NOT NULL, role TEXT NOT NULL,
        maximum_nano INTEGER NOT NULL CHECK(maximum_nano >= 0),
        price TEXT NOT NULL, bounds TEXT NOT NULL,
        state TEXT NOT NULL CHECK(state IN ('reserved', 'unknown', 'settled', 'accounting_failure')),
        usage TEXT, cost_nano INTEGER CHECK(cost_nano >= 0), reason TEXT,
        PRIMARY KEY(card, id)
      );
    `);
  }

  transaction(action) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  get(id) {
    nonempty(id, 'id');
    const row = this.db.prepare('SELECT * FROM requests WHERE card = ? AND id = ?').get(this.card, id);
    if (!row) throw new Error('Unknown reservation');
    return request(row);
  }

  reserve({ model, role, maximumNano, price, bounds }) {
    nonempty(model, 'model');
    nonempty(role, 'role');
    integer(maximumNano, 'maximumNano');
    const priceJson = json(price, 'price');
    const boundsJson = json(bounds, 'bounds');
    return this.transaction(() => {
      const id = randomUUID();
      this.db.prepare(`INSERT INTO requests
        (card,id,model,role,maximum_nano,price,bounds,state) VALUES (?,?,?,?,?,?,?,'reserved')`)
        .run(this.card, id, model, role, maximumNano, priceJson, boundsJson);
      return this.get(id);
    });
  }

  settle(id, { usage, costNano }) {
    integer(costNano, 'costNano');
    const usageJson = usage === undefined ? null : json(usage, 'usage');
    return this.transaction(() => {
      const current = this.get(id);
      if (current.state === 'unknown' && current.costNano !== null) throw new Error('Maximum-charge recovery is final; actual usage remains unknown');
      if (current.state === 'settled' || current.state === 'accounting_failure') {
        if (current.costNano !== costNano || !isDeepStrictEqual(current.usage, usageJson === null ? null : JSON.parse(usageJson))) {
          throw new Error('Settlement differs from recorded settlement');
        }
        return current;
      }
      if (current.maximumNano > 0 && (usage === undefined || usage === null)) throw new Error('Priced settlement requires usage');
      this.db.prepare('UPDATE requests SET state = ?, usage = ?, cost_nano = ?, reason = ? WHERE card = ? AND id = ?')
        .run('settled', usageJson, costNano, null, this.card, id);
      return this.get(id);
    });
  }

  unknown(id, reason) {
    nonempty(reason, 'reason');
    return this.transaction(() => {
      const current = this.get(id);
      if (current.state === 'settled' || current.state === 'accounting_failure') throw new Error('Reservation already settled');
      this.db.prepare("UPDATE requests SET state = 'unknown', reason = ? WHERE card = ? AND id = ?").run(reason, this.card, id);
      return this.get(id);
    });
  }

  chargeUnknownMaximum(id) {
    return this.transaction(() => {
      const current = this.get(id);
      if (current.state !== 'unknown') throw new Error('Only an unknown request can consume its reserved maximum');
      if (current.costNano !== null) return current;
      this.db.prepare('UPDATE requests SET cost_nano = maximum_nano, reason = ? WHERE card = ? AND id = ?')
        .run(`${current.reason}; full reserved maximum charged; actual usage unavailable`, this.card, id);
      return this.get(id);
    });
  }

  snapshot() {
    const requests = this.db.prepare('SELECT * FROM requests WHERE card = ? ORDER BY rowid').all(this.card).map(request);
    let spent = 0n;
    let held = 0n;
    const spendByModel = {};
    for (const row of requests) {
      spent += BigInt(row.costNano ?? 0);
      if (row.costNano) spendByModel[row.model] = (spendByModel[row.model] ?? 0) + row.costNano;
      if (row.state === 'reserved' || row.state === 'unknown') held += BigInt(row.maximumNano) - BigInt(row.costNano ?? 0);
    }
    const numeric = (value) => value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
    return {
      card: this.card,
      stopped: false,
      spentNano: numeric(spent),
      heldNano: numeric(held),
      spendByModel,
      requests,
    };
  }

  close() { this.db.close(); }
}
