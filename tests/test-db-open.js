// tests/test-db-open.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { openDatabase } = require('../src/main/db-open');

let seq = 0;
const tmpPath = () => path.join(os.tmpdir(), `parcella-open-${Date.now()}-${seq++}.db`);
const cleanup = p => { for (const f of [p, p.replace(/\.db$/, '.json')]) { try { fs.unlinkSync(f); } catch {} } };

// A class that resolves fine but explodes on construction — exactly how a
// version-mismatched better-sqlite3 behaves, because it dlopens its native
// addon inside the Database constructor rather than at require time.
class ThrowsOnConstruct {
  constructor() { throw new Error("NODE_MODULE_VERSION 127. This version of Node.js requires NODE_MODULE_VERSION 133."); }
}

test('falls back to JSON when the SQLite class throws at CONSTRUCTION', () => {
  const p = tmpPath();
  const warnings = [];
  try {
    const db = openDatabase(p, { loadSqlite: () => ThrowsOnConstruct, warn: (...a) => warnings.push(a.join(' ')) });
    assert.equal(db._type, 'json');
    assert.deepEqual(db.loadAll().invoices, []);      // usable, not a corpse
    assert.match(warnings.join(' '), /NODE_MODULE_VERSION/);
  } finally { cleanup(p); }
});

test('falls back to JSON when requiring SQLite throws', () => {
  const p = tmpPath();
  try {
    const db = openDatabase(p, { loadSqlite: () => { throw new Error('Cannot find module'); }, warn: () => {} });
    assert.equal(db._type, 'json');
  } finally { cleanup(p); }
});

test('uses SQLite when it actually works', () => {
  const p = tmpPath();
  try {
    const db = openDatabase(p);
    assert.equal(db._type, 'sqlite');
    db.saveKV('studio', { piva: '01234567890' });
    assert.equal(db.getKV('studio').piva, '01234567890');
    db.close();
  } finally { cleanup(p); }
});

test('the fallback instance carries the full interface the IPC handlers call', () => {
  const p = tmpPath();
  try {
    const db = openDatabase(p, { loadSqlite: () => ThrowsOnConstruct, warn: () => {} });
    for (const m of ['loadAll', 'getKV', 'saveKV', 'saveCollection', 'stats', 'exportJSON', 'importJSON', 'nextDocNumber', 'close']) {
      assert.equal(typeof db[m], 'function', `missing ${m}`);
    }
  } finally { cleanup(p); }
});
