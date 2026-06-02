// tests/test-doc-counter.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AppDB = require('../src/main/db');

function makeTempDB() {
  const p = path.join(os.tmpdir(), `parcella-test-${Date.now()}.db`);
  const db = new AppDB(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(p); } catch {} } };
}

test('nextDocNumber starts at 1', () => {
  const { db, cleanup } = makeTempDB();
  try { assert.equal(db.nextDocNumber(2026), 1); } finally { cleanup(); }
});

test('nextDocNumber increments', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.nextDocNumber(2026); db.nextDocNumber(2026);
    assert.equal(db.nextDocNumber(2026), 3);
  } finally { cleanup(); }
});

test('counters are independent per year', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.nextDocNumber(2025); db.nextDocNumber(2025);
    assert.equal(db.nextDocNumber(2026), 1);
  } finally { cleanup(); }
});

test('getDocCounter returns 0 when uninitialised', () => {
  const { db, cleanup } = makeTempDB();
  try { assert.equal(db.getDocCounter(2026), 0); } finally { cleanup(); }
});

test('resetDocCounter sets counter to 0, next call returns 1', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.nextDocNumber(2026); db.nextDocNumber(2026);
    db.resetDocCounter(2026);
    assert.equal(db.getDocCounter(2026), 0);
    assert.equal(db.nextDocNumber(2026), 1);
  } finally { cleanup(); }
});

test('nextDocNumber throws when year is missing', () => {
  const { db, cleanup } = makeTempDB();
  try { assert.throws(() => db.nextDocNumber(undefined), /year required/); } finally { cleanup(); }
});
