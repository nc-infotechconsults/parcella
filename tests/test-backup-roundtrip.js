// tests/test-backup-roundtrip.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AppDB = require('../src/main/db');
const AppDBJson = require('../src/main/db-json');

let seq = 0;
function makeTempDB() {
  const p = path.join(os.tmpdir(), `parcella-backup-${Date.now()}-${seq++}.db`);
  const db = new AppDB(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(p); } catch {} } };
}

function makeTempJsonDB() {
  const p = path.join(os.tmpdir(), `parcella-backup-json-${Date.now()}-${seq++}.db`);
  const db = new AppDBJson(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(db.filePath); } catch {} } };
}

test('a full backup carries every collection, counters and supplier rules', () => {
  const a = makeTempDB();
  const b = makeTempDB();
  try {
    a.db.saveCollection('clients', [{ id: 'c1', name: 'Alfa', piva: 'IT09876543210' }]);
    a.db.saveCollection('activities', [{ id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 8, day: 3 }]);
    a.db.saveCollection('expenses', [{ id: 'e1', monthKey: '2026-07', amount: 10, billable: false, deductPct: 100, vatPct: 22 }]);
    a.db.saveCollection('invoices', [{
      id: 'inv_1', dedupKey: 'K|TD01|1|2026-07-31', direction: 'active', monthKey: '2026-07',
      date: '2026-07-31', tipoDoc: 'TD01', sign: 1, totals: { imponibile: 100, imposta: 22, documento: 122 },
      counterparty: { name: 'Alfa' }, settlement: { status: 'open', date: null, amount: 122 },
    }]);
    a.db.saveKV('studio', { piva: '01234567890', cf: 'RSSMRA80A01H501U' });
    a.db.saveKV('supplierRules', { '05550001112': { category: 'Utenze', deductPct: 100 } });
    a.db.nextDocNumber(2026);

    b.db.importJSON(a.db.exportJSON());
    const loaded = b.db.loadAll();

    assert.equal(loaded.clients.length, 1);
    assert.equal(loaded.activities.length, 1);
    assert.equal(loaded.expenses.length, 1);
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].dedupKey, 'K|TD01|1|2026-07-31');
    assert.equal(loaded.supplierRules['05550001112'].category, 'Utenze');
    assert.equal(loaded.studio.piva, '01234567890');
    assert.equal(b.db.getDocCounter(2026), 1);
    assert.equal(b.db.stats().invoices, 1);
  } finally { a.cleanup(); b.cleanup(); }
});

test('a full backup carries every collection, counters and supplier rules — JSON fallback', () => {
  // Same scenario as above, run against db-json.js — the storage this sandbox
  // actually falls back to at runtime (better-sqlite3 ABI mismatch with Electron).
  const a = makeTempJsonDB();
  const b = makeTempJsonDB();
  try {
    a.db.saveCollection('clients', [{ id: 'c1', name: 'Alfa', piva: 'IT09876543210' }]);
    a.db.saveCollection('activities', [{ id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 8, day: 3 }]);
    a.db.saveCollection('expenses', [{ id: 'e1', monthKey: '2026-07', amount: 10, billable: false, deductPct: 100, vatPct: 22 }]);
    a.db.saveCollection('invoices', [{
      id: 'inv_1', dedupKey: 'K|TD01|1|2026-07-31', direction: 'active', monthKey: '2026-07',
      date: '2026-07-31', tipoDoc: 'TD01', sign: 1, totals: { imponibile: 100, imposta: 22, documento: 122 },
      counterparty: { name: 'Alfa' }, settlement: { status: 'open', date: null, amount: 122 },
    }]);
    a.db.saveKV('studio', { piva: '01234567890', cf: 'RSSMRA80A01H501U' });
    a.db.saveKV('supplierRules', { '05550001112': { category: 'Utenze', deductPct: 100 } });
    a.db.nextDocNumber(2026);

    b.db.importJSON(a.db.exportJSON());
    const loaded = b.db.loadAll();

    assert.equal(loaded.clients.length, 1);
    assert.equal(loaded.activities.length, 1);
    assert.equal(loaded.expenses.length, 1);
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].dedupKey, 'K|TD01|1|2026-07-31');
    assert.equal(loaded.supplierRules['05550001112'].category, 'Utenze');
    assert.equal(loaded.studio.piva, '01234567890');
    assert.equal(b.db.getDocCounter(2026), 1);
    assert.equal(b.db.stats().invoices, 1);
  } finally { a.cleanup(); b.cleanup(); }
});
