// tests/test-studio-template.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { normalizeId } = require('../src/main/fattura-classify');

// data.js seeds a fresh install's studio record (app.jsx: "use template but
// user will fill it in settings"). A placeholder P.IVA/CF there looks like a
// configured identity, so nobody fills it in — and then no document ever
// matches the studio and every invoice is classified passive.
const template = () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'data.js'), 'utf-8');
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.window.APP_DATA.user;
};

test('the studio template ships no placeholder fiscal identity', () => {
  const u = template();
  assert.equal(normalizeId(u.piva), '', 'piva del template deve essere vuota');
  assert.equal(normalizeId(u.cf), '', 'cf del template deve essere vuoto');
});
