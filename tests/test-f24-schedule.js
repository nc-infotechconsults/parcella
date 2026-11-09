// tests/test-f24-schedule.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');

const r = loadRenderer();

const activeInvoice = (over = {}) => ({
  id: 'a1', direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-02-20', monthKey: '2026-02', clientId: null, linkedMonthKey: null,
  totals: { imponibile: 10000, imposta: 2200, documento: 12200 },
  vatSummary: [{ vatPct: 22, imponibile: 10000, imposta: 2200 }],
  withholding: null, cassa: null, payment: null, counterparty: { name: 'C' },
  fiscal: null, settlement: { status: 'settled', date: '2026-03-01', amount: 12200 },
  ...over,
});

const studio = { tipoSoggetto: 'professionista' };
const run = (fiscal, invoices) => r.computeTaxes([], [], fiscal, '2026', [], studio, invoices);

test('a recorded F24 payment replaces the generated estimate for the same deadline', () => {
  const fiscal = {
    cassaContribPct: 26.07, ivaLiquidazione: 'trimestrale',
    f24History: [{ id: 'f1', date: '2026-05-16', code: '6031', desc: 'IVA 1° trim 2026', amount: 1800, status: 'paid' }],
  };
  const rows = run(fiscal, [activeInvoice()]).f24All;
  const q1 = rows.filter(f => f.date === '2026-05-16' && f.code === '6031');
  assert.equal(q1.length, 1, 'the deadline must appear once, not as estimate plus record');
  assert.equal(q1[0].amount, 1800);
  assert.equal(q1[0].status, 'paid');
});

test('no two F24 entries share a date and a tributo code', () => {
  const fiscal = {
    cassaContribPct: 26.07, irpefPrevYear: 28400,
    f24History: [
      { id: 'f1', date: '2026-05-16', code: '6031', desc: 'IVA 1° trim', amount: 4280, status: 'paid' },
      { id: 'f2', date: '2026-06-30', code: '4001', desc: 'Saldo IRPEF 2025', amount: 8640, status: 'scheduled' },
      { id: 'f3', date: '2026-08-20', code: '6031', desc: 'IVA 2° trim', amount: 0, status: 'estimated' },
    ],
  };
  const rows = run(fiscal, [activeInvoice(), activeInvoice({ id: 'a2', date: '2026-05-10', monthKey: '2026-05' })]).f24All;
  const seen = new Set();
  for (const f of rows) {
    const key = f.date + '|' + f.code;
    assert.ok(!seen.has(key), `duplicate deadline ${key}`);
    seen.add(key);
  }
});

test('a deadline worth nothing is not listed', () => {
  // withholding exceeding gross IRPEF drives irpefNetta to zero, which used to
  // emit 0,00 instalments as if they were something to pay.
  const fiscal = { cassaContribPct: 26.07 };
  const rows = run(fiscal, [activeInvoice({ withholding: { importo: 9000, aliquota: 20 } })]).f24All;
  const zeros = rows.filter(f => !f.amount);
  // equal on .length, not deepEqual on the array: these objects come from the
  // VM realm, so deepStrictEqual compares prototypes and fails on two empty
  // arrays. See tests/helpers/load-renderer.js.
  assert.equal(zeros.length, 0,
    'generated entries with no amount must be dropped, got ' + JSON.stringify(zeros.map(z => z.desc)));
});

test('a stale saved estimate does not hide a liability the invoices show', () => {
  // The user's own history holds "IVA 2 trim = 0, estimated" from an older
  // reckoning. The computed figure is better informed and must win.
  const fiscal = {
    cassaContribPct: 26.07, ivaLiquidazione: 'trimestrale',
    f24History: [{ id: 'f5', date: '2026-08-20', code: '6031', desc: 'IVA 2° trim', amount: 0, status: 'estimated' }],
  };
  const res = run(fiscal, [activeInvoice({ id: 'a3', date: '2026-05-10', monthKey: '2026-05' })]);
  // Il 2° trimestre si versa con il 6032 (Appendice A della spec); la riga
  // stimata salvata porta ancora il 6031 che usava l'app di prima.
  const q2 = res.f24All.filter(f => f.date === '2026-08-20' && (f.code === '6031' || f.code === '6032'));
  assert.equal(q2.length, 1);
  assert.ok(q2[0].amount > 0, 'the computed instalment must replace the stale zero, got ' + q2[0].amount);
});

test('a recorded payment still beats the computed estimate', () => {
  const fiscal = {
    cassaContribPct: 26.07, ivaLiquidazione: 'trimestrale',
    f24History: [{ id: 'f2', date: '2026-05-16', code: '6031', desc: 'IVA 1° trim', amount: 4280, status: 'paid' }],
  };
  const res = run(fiscal, [activeInvoice()]);
  const q1 = res.f24All.filter(f => f.date === '2026-05-16' && f.code === '6031');
  assert.equal(q1.length, 1);
  assert.equal(q1[0].amount, 4280);
  assert.equal(q1[0].status, 'paid');
});

test('the IVA instalment carries the quarterly surcharge over the liquidation saldo', () => {
  const fiscal = { cassaContribPct: 26.07, ivaLiquidazione: 'trimestrale' };
  const res = run(fiscal, [activeInvoice()]);
  const q1 = res.f24All.find(f => f.date === '2026-05-16' && f.code === '6031');
  const expected = Math.round(res.trimestri[0].balance * 1.01 * 100) / 100;
  assert.equal(q1.amount, expected);
});
