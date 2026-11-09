// Loads the renderer's non-module scripts into a VM so Node can call the plain
// functions inside .jsx files (computeTaxes, computeInvoiceAmounts). They are
// browser globals with no exports, and transpiling them with the project's own
// vendored Babel is the only way to exercise them the way the app runs them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');

function loadRenderer() {
  const sb = {
    console, Math, Date, JSON, Number, String, Object, Array, Boolean, RegExp, Error,
    parseInt, parseFloat, isNaN, isFinite, setTimeout, clearTimeout,
    navigator: { userAgent: 'node' },
  };
  sb.self = sb; sb.window = sb; sb.global = sb; sb.globalThis = sb;
  sb.React = { useState: () => [null, () => {}], useEffect: () => {}, useMemo: f => f(), createElement: () => null, Fragment: 'F' };
  vm.createContext(sb);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'vendor/babel.min.js'), 'utf8'), sb);

  const run = (rel, jsx) => {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    vm.runInContext(jsx ? sb.Babel.transform(src, { presets: ['react'] }).code : src, sb);
  };
  run('src/shared/categories.js');
  run('src/renderer/fiscal.js');
  run('src/renderer/f24-scheme.js');
  sb.t = k => k; sb.fmtEUR = n => n; sb.fmtNum = n => n; sb.fmtH = n => n;
  sb.Icon = () => null; sb.Modal = () => null;
  run('src/renderer/components/shared.jsx', true);
  run('src/renderer/components/taxes.jsx', true);
  return sb;
}

// Caveat for callers: values returned from this sandbox belong to the VM's
// realm, so their prototypes differ from the host's. assert.deepStrictEqual
// compares prototypes and will fail even on two structurally identical arrays
// or objects. Assert on primitives — lengths, fields, numbers — instead.
module.exports = { loadRenderer };
