// tests/test-db-path.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveDbPath } = require('../src/main/db-path');

const USER_DATA = '/Users/tizio/Library/Application Support/parcella';

test('without an override the database stays at the standard path', () => {
  assert.equal(resolveDbPath(USER_DATA, {}), path.join(USER_DATA, 'timesheet.db'));
});

test('PARCELLA_DB opens a different database instead', () => {
  assert.equal(
    resolveDbPath(USER_DATA, { PARCELLA_DB: '/tmp/parallelo.db' }),
    '/tmp/parallelo.db',
  );
});

test('a blank PARCELLA_DB is ignored rather than opening an unnamed file', () => {
  assert.equal(resolveDbPath(USER_DATA, { PARCELLA_DB: '   ' }), path.join(USER_DATA, 'timesheet.db'));
});

test('a relative PARCELLA_DB is resolved against the user data directory', () => {
  assert.equal(
    resolveDbPath(USER_DATA, { PARCELLA_DB: 'timesheet-dev.db' }),
    path.join(USER_DATA, 'timesheet-dev.db'),
  );
});
