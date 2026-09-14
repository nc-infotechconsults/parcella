// tests/fixtures/index.js — anonymized FatturaPA fixtures
const fs = require('fs');
const path = require('path');

const dir = __dirname;

// The synthetic studio identity used across all fixtures.
const STUDIO = { piva: '01234567890', cf: 'RSSMRA80A01H501U' };

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf-8');
}

module.exports = { dir, read, STUDIO };
