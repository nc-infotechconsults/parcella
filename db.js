// SQLite database module for Electron main process
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class AppDB {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this._migrate();
  }

  _migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS kv (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        ts    INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS clients (
        id   TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        ts   INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS activities (
        id        TEXT PRIMARY KEY,
        client_id TEXT,
        month_key TEXT,
        data      TEXT NOT NULL,
        ts        INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE TABLE IF NOT EXISTS expenses (
        id        TEXT PRIMARY KEY,
        client_id TEXT,
        month_key TEXT,
        data      TEXT NOT NULL,
        ts        INTEGER DEFAULT (strftime('%s','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_act_month ON activities(month_key);
      CREATE INDEX IF NOT EXISTS idx_exp_month ON expenses(month_key);
    `);
  }

  loadAll() {
    const clients    = this.db.prepare('SELECT data FROM clients ORDER BY rowid').all().map(r => JSON.parse(r.data));
    const activities = this.db.prepare('SELECT data FROM activities ORDER BY month_key, ts').all().map(r => JSON.parse(r.data));
    const expenses   = this.db.prepare('SELECT data FROM expenses ORDER BY month_key, ts').all().map(r => JSON.parse(r.data));
    const studio     = this._getKV('studio');
    const fiscal     = this._getKV('fiscal');
    return { clients, activities, expenses, studio, fiscal, empty: clients.length === 0 && !studio };
  }

  _getKV(key) {
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : null;
  }

  _setKV(key, value) {
    this.db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(value));
  }

  saveCollection(key, data) {
    const allowed = ['clients', 'activities', 'expenses'];
    if (!allowed.includes(key)) throw new Error('Unknown collection: ' + key);

    const isClients = key === 'clients';
    const upsert = isClients
      ? this.db.prepare(`INSERT OR REPLACE INTO clients (id, data, ts) VALUES (?, ?, strftime('%s','now'))`)
      : this.db.prepare(`INSERT OR REPLACE INTO ${key} (id, client_id, month_key, data, ts) VALUES (?, ?, ?, ?, strftime('%s','now'))`);

    this.db.transaction(() => {
      if (data.length > 0) {
        const ids = data.map(d => d.id);
        this.db.prepare(`DELETE FROM ${key} WHERE id NOT IN (${ids.map(() => '?').join(',')})`).run(...ids);
      } else {
        this.db.prepare(`DELETE FROM ${key}`).run();
      }
      for (const item of data) {
        if (isClients) {
          upsert.run(item.id, JSON.stringify(item));
        } else {
          upsert.run(item.id, item.clientId || null, item.monthKey || null, JSON.stringify(item));
        }
      }
    })();
  }

  saveKV(key, value) {
    this._setKV(key, value);
  }

  exportJSON() {
    return JSON.stringify(this.loadAll(), null, 2);
  }

  importJSON(json) {
    const data = JSON.parse(json);
    this.db.transaction(() => {
      if (data.clients)    this.saveCollection('clients', data.clients);
      if (data.activities) this.saveCollection('activities', data.activities);
      if (data.expenses)   this.saveCollection('expenses', data.expenses);
      if (data.studio)     this._setKV('studio', data.studio);
      if (data.fiscal)     this._setKV('fiscal', data.fiscal);
    })();
  }

  stats() {
    return {
      clients:    this.db.prepare('SELECT COUNT(*) as n FROM clients').get().n,
      activities: this.db.prepare('SELECT COUNT(*) as n FROM activities').get().n,
      expenses:   this.db.prepare('SELECT COUNT(*) as n FROM expenses').get().n,
      sizeBytes:  fs.statSync(this.dbPath).size,
    };
  }

  close() {
    try { this.db.close(); } catch {}
  }
}

module.exports = AppDB;
