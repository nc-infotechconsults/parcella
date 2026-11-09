// tests/test-amortize-threshold.js
//
// Art. 102 c.5 TUIR: un bene il cui costo NON È SUPERIORE a 516,46 € si deduce
// integralmente nell'esercizio. L'ammortamento non dipende quindi dalla sola
// categoria: serve anche che l'importo superi la soglia. La soglia era
// applicata solo al momento della proposta d'import, con il confronto >= in un
// modulo e > nell'altro, e nessun controllo quando la casella veniva spuntata
// a mano sulla fattura.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const cats = require('../src/shared/categories');
const {
  computeFiscalYear, computeExpenseFiscals, invoiceCostFiscals,
  exceedsAmortizeThreshold,
} = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const SOGLIA = 516.46;

// Fattura passiva Hardware, pagata nell'anno, con la casella già spuntata:
// è il caso di chi la marca a mano nel drawer.
const hw = (imponibile, over = {}) => ({
  id: 'p1', direction: 'passive', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-03-10', monthKey: '2026-03', causale: 'Cavo',
  totals: { imponibile, imposta: imponibile * 0.22, documento: imponibile * 1.22 },
  vatSummary: [{ vatPct: 22, imponibile, imposta: imponibile * 0.22 }],
  withholding: null, cassa: null, payment: null, counterparty: { name: 'F' },
  fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  settlement: { status: 'settled', date: '2026-03-20', amount: imponibile * 1.22 },
  ...over,
});
const fy = (year, invoices, expenses) => computeFiscalYear({
  year, invoices: invoices || [], activities: [], expenses: expenses || [], clients: [], fiscal: {},
});

test('la soglia si supera, non si raggiunge', () => {
  assert.equal(exceedsAmortizeThreshold(SOGLIA), false);
  assert.equal(exceedsAmortizeThreshold(SOGLIA + 0.01), true);
  assert.equal(exceedsAmortizeThreshold(SOGLIA - 0.01), false);
});

test('esattamente 516,46 non è un cespite: si deduce tutto nell anno', () => {
  const y = fy(2026, [hw(SOGLIA)]);
  assert.equal(y.cespiti.length, 0);
  near(y.consuntivo.costiEsercizio, SOGLIA);
  near(y.consuntivo.quoteAmmortamento, 0, 0.001);
});

test('un centesimo sopra la soglia è un cespite', () => {
  const y = fy(2026, [hw(SOGLIA + 0.01)]);
  assert.equal(y.cespiti.length, 1);
  near(y.consuntivo.quoteAmmortamento, (SOGLIA + 0.01) / 4 / 2);
  near(y.consuntivo.costiEsercizio, 0, 0.001);
});

test('un cavo da 30 euro spuntato a mano non diventa un cespite', () => {
  const y = fy(2026, [hw(30)]);
  assert.equal(y.cespiti.length, 0);
  // E soprattutto il costo non si perde: senza questa regola la fattura
  // risultava in ammortamento (deducibile 0) senza alcun piano che la deduca.
  near(y.consuntivo.costiDeducibili, 30);
});

test('il costo sotto soglia non si perde in nessun anno', () => {
  const inv = [hw(30)];
  const totale = [2025, 2026, 2027, 2028, 2029, 2030]
    .reduce((s, y) => s + fy(y, inv).consuntivo.costiDeducibili, 0);
  near(totale, 30);
});

test('invoiceCostFiscals non mette in ammortamento un importo sotto soglia', () => {
  assert.equal(invoiceCostFiscals(hw(30)).inAmortization, false);
  near(invoiceCostFiscals(hw(30)).deductible, 30);
  assert.equal(invoiceCostFiscals(hw(SOGLIA + 0.01)).inAmortization, true);
  near(invoiceCostFiscals(hw(SOGLIA + 0.01)).deductible, 0);
});

test('fiscalForCategory non propone l ammortamento alla soglia esatta', () => {
  assert.equal(cats.fiscalForCategory('Hardware', { sign: 1, imponibile: SOGLIA }).amortize, false);
  assert.equal(cats.fiscalForCategory('Hardware', { sign: 1, imponibile: SOGLIA + 0.01 }).amortize, true);
});

test('i due moduli danno la stessa risposta al confine', () => {
  // categories.js usava >=, fiscal.js usava >: a 516,46 esatti si
  // contraddicevano, e la fattura finiva in ammortamento per uno e no per l altro.
  for (const importo of [SOGLIA - 0.01, SOGLIA, SOGLIA + 0.01, 1200]) {
    const proposta = cats.fiscalForCategory('Hardware', { sign: 1, imponibile: importo }).amortize;
    const motore = invoiceCostFiscals(hw(importo)).inAmortization;
    assert.equal(proposta, motore, `disaccordo a ${importo}`);
  }
});

test('una spesa manuale sotto soglia si deduce per intero nel suo anno', () => {
  // €366 lordi al 22% → €300 netti, sotto soglia: nessun piano.
  const spesa = { id: 'e1', monthKey: '2024-05', category: 'Hardware', amount: 366,
    vatPct: 22, deductPct: 100, amortize: true, amortYears: 4, billable: false };
  near(computeExpenseFiscals(spesa).yearlyDeducted, 300);
  assert.equal(computeExpenseFiscals(spesa).inAmortization, false);
  assert.equal(fy(2024, [], [spesa]).cespiti.length, 0);
  near(fy(2024, [], [spesa]).consuntivo.costiDeducibili, 300);
  near(fy(2026, [], [spesa]).consuntivo.costiDeducibili, 0, 0.001);
});

test('una nota di credito non apre un piano nemmeno sopra soglia', () => {
  const nc = hw(2000, { sign: -1, tipoDoc: 'TD04' });
  assert.equal(invoiceCostFiscals(nc).inAmortization, false);
  assert.equal(fy(2026, [nc]).cespiti.length, 0);
});
