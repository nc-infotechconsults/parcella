// tests/test-irpef-brackets.js
//
// The top IRPEF bracket has no ceiling, and the stored profile writes that as
// upTo: null. Math.min(reddito, null) is 0, so the top rate applied to nothing
// and every euro above the second bracket was taxed at zero.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');

const r = loadRenderer();
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const fyWith = reddito => ({
  consuntivo: { ricaviIncassati: reddito, costiDeducibili: 0, ritenutaIncassata: 0 },
});
const scaglioni = [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: null, rate: 43 }];
const run = (reddito, over = {}) => r.taxLiability(
  fyWith(reddito), { cassaContribPct: 0, irpefBrackets: scaglioni, ...over }, 'professionista');

test('income above the last ceiling is taxed at the top rate', () => {
  near(run(120000).irpefLorda, 28000 * 0.23 + 22000 * 0.35 + 70000 * 0.43);
});

test('a ceiling written as Infinity behaves the same as one written as null', () => {
  const asInfinity = [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: Infinity, rate: 43 }];
  near(run(120000).irpefLorda, run(120000, { irpefBrackets: asInfinity }).irpefLorda);
});

test('income inside a middle bracket stops there', () => {
  near(run(40000).irpefLorda, 28000 * 0.23 + 12000 * 0.35);
  near(run(28000).irpefLorda, 28000 * 0.23);
});

test('a single open-ended bracket is a flat rate', () => {
  near(run(50000, { irpefBrackets: [{ upTo: null, rate: 30 }] }).irpefLorda, 15000);
});

test('an empty bracket table falls back to the statutory scale', () => {
  near(run(40000, { irpefBrackets: [] }).irpefLorda, run(40000).irpefLorda);
});

test('a cleared rate counts as zero, not as NaN', () => {
  const l = run(40000, { irpefBrackets: [{ upTo: 28000, rate: 23 }, { upTo: null, rate: null }] });
  near(l.irpefLorda, 28000 * 0.23);
});

test('a cleared addizionale falls back to zero and does not poison the total', () => {
  const l = run(40000, { addRegPct: null, addComPct: null });
  assert.equal(l.aliquote.addRegPct, 0);
  near(l.addReg, 0, 0.001);
  assert.ok(Number.isFinite(l.irpefLordaTot));
});

test('an addizionale explicitly set to zero stays zero', () => {
  assert.equal(run(40000, { addComPct: 0 }).aliquote.addComPct, 0);
});

test('a configured contribution rate is the one applied', () => {
  const l = r.taxLiability(fyWith(100000), { cassaContribPct: 26.07, irpefBrackets: scaglioni }, 'professionista');
  assert.equal(l.aliquote.cassaContribPct, 26.07);
  near(l.contribCassa, 26070);
});
