// tests/test-doc-counter.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function makeDB() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER DEFAULT (strftime('%s','now')))`);
  return {
    nextDocNumber(year) {
      const key = `docCounter_${year}`;
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      const next = (row ? JSON.parse(row.value) : 0) + 1;
      db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(next));
      return next;
    },
    getDocCounter(year) {
      const key = `docCounter_${year}`;
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : 0;
    },
    resetDocCounter(year) {
      const key = `docCounter_${year}`;
      db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(0));
    },
  };
}

test('nextDocNumber starts at 1', () => {
  const d = makeDB();
  assert.equal(d.nextDocNumber(2026), 1);
});

test('nextDocNumber increments', () => {
  const d = makeDB();
  d.nextDocNumber(2026); d.nextDocNumber(2026);
  assert.equal(d.nextDocNumber(2026), 3);
});

test('counters are independent per year', () => {
  const d = makeDB();
  d.nextDocNumber(2025); d.nextDocNumber(2025);
  assert.equal(d.nextDocNumber(2026), 1);
});

test('getDocCounter returns 0 when uninitialised', () => {
  const d = makeDB();
  assert.equal(d.getDocCounter(2026), 0);
});

test('resetDocCounter sets counter to 0, next call returns 1', () => {
  const d = makeDB();
  d.nextDocNumber(2026); d.nextDocNumber(2026);
  d.resetDocCounter(2026);
  assert.equal(d.getDocCounter(2026), 0);
  assert.equal(d.nextDocNumber(2026), 1);
});
