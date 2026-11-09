// tests/test-invoices-db.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AppDB = require('../src/main/db');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

let seq = 0;
function makeTempDB() {
  const p = path.join(os.tmpdir(), `parcella-inv-${Date.now()}-${seq++}.db`);
  const db = new AppDB(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(p); } catch {} } };
}

const invoice = (over = {}) => ({
  id: 'inv_1',
  dedupKey: 'IE1111111AA|TD18|28/AU|2026-08-24',
  direction: 'passive',
  reverseCharge: true,
  tipoDoc: 'TD18',
  number: '28/AU',
  date: '2026-08-24',
  monthKey: '2026-08',
  sign: 1,
  counterparty: { name: 'FORNITORE ESTERO LIMITED', vat: 'IE1111111AA' },
  totals: { imponibile: 180, imposta: 39.6, documento: 219.6 },
  fiscal: { category: 'Software', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'open', date: null, amount: 219.6 },
  ...over,
});

test('saveCollection persists invoices and loadAll returns them', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    const { invoices } = db.loadAll();
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].dedupKey, 'IE1111111AA|TD18|28/AU|2026-08-24');
    near(invoices[0].totals.imposta, 39.6);
  } finally { cleanup(); }
});

test('invoices removed from the array are deleted', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice(), invoice({ id: 'inv_2', dedupKey: 'X|TD01|1|2026-01-01' })]);
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.loadAll().invoices.length, 1);
  } finally { cleanup(); }
});

test('stats counts invoices', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.stats().invoices, 1);
  } finally { cleanup(); }
});

test('supplierRules round-trip through kv', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveKV('supplierRules', { IE1111111AA: { category: 'Software', deductPct: 100 } });
    assert.equal(db.getKV('supplierRules').IE1111111AA.category, 'Software');
    assert.equal(db.loadAll().supplierRules.IE1111111AA.deductPct, 100);
  } finally { cleanup(); }
});

test('getKV returns null for a missing key', () => {
  const { db, cleanup } = makeTempDB();
  try { assert.equal(db.getKV('studio'), null); } finally { cleanup(); }
});

test('exportJSON/importJSON carry invoices and supplierRules', () => {
  const a = makeTempDB();
  const b = makeTempDB();
  try {
    a.db.saveCollection('invoices', [invoice()]);
    a.db.saveKV('supplierRules', { IE1111111AA: { category: 'Software', deductPct: 100 } });
    b.db.importJSON(a.db.exportJSON());
    const loaded = b.db.loadAll();
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].tipoDoc, 'TD18');
    assert.equal(loaded.supplierRules.IE1111111AA.category, 'Software');
  } finally { a.cleanup(); b.cleanup(); }
});

test('loadAll reports empty:false when only invoices exist', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.loadAll().empty, false);
  } finally { cleanup(); }
});
