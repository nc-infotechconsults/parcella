// tests/test-acconti.js
//
// Acconti are paid on the METODO STORICO: in June you pay an instalment sized
// on last year's income, and the difference against how this year actually went
// is settled the following June. The schedule used to size the June instalment
// on the current year's own figures, which is neither what is owed nor what the
// panel beside it displayed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');

const r = loadRenderer();
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const active = (over = {}) => ({
  id: 'a1', direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-02-20', monthKey: '2026-02', clientId: null, linkedMonthKey: null,
  totals: { imponibile: 10000, imposta: 2200, documento: 12200 },
  vatSummary: [{ vatPct: 22, imponibile: 10000, imposta: 2200 }],
  withholding: null, cassa: null, payment: null, counterparty: { name: 'C' },
  fiscal: null, settlement: { status: 'settled', date: '2026-03-01', amount: 12200 },
  ...over,
});
// Last year deliberately four times this one, so an instalment sized on the
// wrong year cannot pass by coincidence.
const prevYear = (over = {}) => active({
  id: 'p1', date: '2025-02-20', monthKey: '2025-02',
  totals: { imponibile: 40000, imposta: 8800, documento: 48800 },
  vatSummary: [{ vatPct: 22, imponibile: 40000, imposta: 8800 }],
  settlement: { status: 'settled', date: '2025-03-01', amount: 48800 },
  ...over,
});

const gestioneSeparata = { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' };
const inarcassa = { tipoSoggetto: 'professionista', cassaName: 'Inarcassa' };
const base = { cassaContribPct: 26.07, irpefPrevYear: 28400, cassaPrevYear: 6800, f24History: [] };

const run = (fiscal, invoices, studio) =>
  r.computeTaxes([], [], { ...base, ...fiscal }, '2026', [], studio || gestioneSeparata, invoices);
const row = (rows, date, code) => rows.filter(f => f.date === date && f.code === code);

test('without prior-year data the acconto falls back to the stored figure', () => {
  const tax = run({}, [active()]);
  // Gestione Separata: 80% of last year's contributo, in two equal instalments.
  near(tax.accontiCassa, 6800 * 0.8);
  const giu = row(tax.f24All, '2026-06-30', '3801');
  assert.equal(giu.length, 1);
  near(giu[0].amount, 6800 * 0.8 / 2);
});

test('the June instalment is sized on last year, not on this year', () => {
  const tax = run({}, [active(), prevYear()]);
  assert.ok(tax.prevYear.contribCassa > 0, 'last year must be computed from its own documents');
  assert.notEqual(Math.round(tax.prevYear.contribCassa), Math.round(tax.contribCassa));
  near(row(tax.f24All, '2026-06-30', '3801')[0].amount, tax.prevYear.contribCassa * 0.8 / 2);
});

test('real documents for last year beat the stored estimate', () => {
  const tax = run({ cassaPrevYear: 99999 }, [active(), prevYear()]);
  assert.ok(tax.accontiCassa < 99999 * 0.8, 'the stored figure is only a fallback');
  near(tax.prevYear.contribCassa, 10428);   // 40.000 × 26,07%
});

test('the delta against the real year is settled the following June', () => {
  const tax = run({}, [active()]);
  near(tax.saldoCassa, tax.contribCassa - tax.accontiCassa);
  const saldo = row(tax.f24All, '2027-06-30', '3801');
  if (tax.saldoCassa > 0) {
    assert.equal(saldo.length, 1, 'a positive delta is a payment due next June');
    near(saldo[0].amount, tax.saldoCassa);
  }
});

test('a year that went worse than the last leaves a credit, not a deadline', () => {
  // One small invoice against a large stored prior year.
  const tax = run({ cassaPrevYear: 40000 }, [active({ totals: { imponibile: 1000, imposta: 220, documento: 1220 } })]);
  assert.ok(tax.saldoCassa < 0, 'overpaid instalments are a credit');
  assert.equal(row(tax.f24All, '2027-06-30', '3801').length, 0);
});

test('IRPEF instalments are 40/60 of last year, not of this year', () => {
  const tax = run({}, [active()]);
  near(row(tax.f24All, '2026-06-30', '4033')[0].amount, 28400 * 0.4);
  near(row(tax.f24All, '2026-11-30', '4034')[0].amount, 28400 * 0.6);
  near(tax.accontiIrpef, 28400);
});

test('a private cassa keeps the full prior-year contributo in two halves', () => {
  const tax = run({}, [active()], inarcassa);
  near(tax.accontiCassa, 6800);
  near(row(tax.f24All, '2026-06-30', '3801')[0].amount, 3400);
});

test('an instalment the user marked versato is not shown as still due', () => {
  const tax = run({ cassaAcconto1Paid: true, irpefAcconto1Paid: true }, [active()]);
  assert.equal(row(tax.f24All, '2026-06-30', '3801')[0].status, 'paid');
  assert.equal(row(tax.f24All, '2026-06-30', '4033')[0].status, 'paid');
  assert.equal(row(tax.f24All, '2026-11-30', '4034')[0].status, 'estimated');
});

test('an acconto the user recorded himself still wins over the computation', () => {
  const tax = run({
    f24History: [{ id: 'f4', date: '2026-06-30', code: '3801', desc: 'acconto', amount: 5000, status: 'scheduled' }],
  }, [active()]);
  const giu = row(tax.f24All, '2026-06-30', '3801');
  assert.equal(giu.length, 1);
  near(giu[0].amount, 5000);
  assert.equal(giu[0].status, 'scheduled');
});

// Un 2025 fatto di sole fatture passive bastava a far scattare la derivazione:
// la base veniva calcolata da un anno senza compensi, dava zero, e scavalcava
// in silenzio il valore scritto in Impostazioni. Da lì rate a zero, e spuntare
// "Versato" non deduceva niente perché la rata da dedurre valeva zero.
const prevPassive = (over = {}) => ({
  id: 'pp1', direction: 'passive', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2025-03-10', monthKey: '2025-03', clientId: null, linkedMonthKey: null,
  totals: { imponibile: 200, imposta: 44, documento: 244 },
  vatSummary: [{ vatPct: 22, imponibile: 200, imposta: 44 }],
  withholding: null, cassa: null, payment: null, counterparty: { name: 'Fornitore' },
  fiscal: { category: 'Altro', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'settled', date: '2025-03-10', amount: 244 },
  ...over,
});

test('un anno precedente di soli costi non è una base: resta il valore memorizzato', () => {
  const tax = run({}, [active(), prevPassive()]);
  near(tax.accontiCassa, 6800 * 0.8);
  near(tax.accontiIrpef, 28400);
});

test('senza ricavi l\'anno prima, spuntare Versato deduce comunque la rata', () => {
  const tax = run({ cassaAcconto1Paid: true }, [active(), prevPassive()]);
  near(tax.contributiVersati, 6800 * 0.8 / 2);
});

test('un solo documento attivo dell\'anno prima basta invece a fare testo', () => {
  const tax = run({ cassaPrevYear: 99999 }, [active(), prevPassive(), prevYear()]);
  assert.ok(tax.accontiCassa < 99999 * 0.8, 'i documenti veri restano la base migliore');
  // 40.000 di compensi meno i 200 di costo del documento passivo, al 26,07%.
  near(tax.prevYear.contribCassa, (40000 - 200) * 0.2607);
});
