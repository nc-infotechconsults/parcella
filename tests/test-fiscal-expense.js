// tests/test-fiscal-expense.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExpenseFiscals, invoiceCostFiscals,
  buildAmortSchedule, amortQuotaFor, amortResidualAt,
} = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('computeExpenseFiscals keeps the existing behaviour for a studio expense', () => {
  const f = computeExpenseFiscals({ amount: 122, vatPct: 22, vatExempt: false, deductPct: 80, billable: false, amortize: false });
  near(f.net, 100);
  near(f.vat, 22);
  near(f.vatDetracted, 17.6);
  near(f.yearlyDeducted, 80);
  near(f.nonDeductible, 20);
});

test('computeExpenseFiscals recovers full VAT on billable expenses', () => {
  const f = computeExpenseFiscals({ amount: 122, vatPct: 22, vatExempt: false, deductPct: 20, billable: true, amortize: false });
  near(f.vatDetracted, 22);
});

test('invoiceCostFiscals applies deductPct and vatDetractPct', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: 1,
    totals: { imponibile: 100, imposta: 22 },
    fiscal: { category: 'Telefonia', deductPct: 80, vatDetractPct: 100, amortize: false },
  });
  near(f.imponibile, 100);
  near(f.vatDetracted, 22);
  near(f.deductible, 80);
});

test('invoiceCostFiscals signs a credit note negatively', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: -1,
    totals: { imponibile: 65.58, imposta: 14.43 },
    fiscal: { category: 'Altro', deductPct: 100, vatDetractPct: 100, amortize: false },
  });
  near(f.imponibile, -65.58);
  near(f.deductible, -65.58);
  near(f.vatDetracted, -14.43);
});

test('an amortized invoice deducts nothing in the current-cost sense', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: 1,
    totals: { imponibile: 2400, imposta: 528 },
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  assert.equal(f.inAmortization, true);
  near(f.deductible, 0);          // the deduction comes from the schedule instead
  near(f.vatDetracted, 528);      // but VAT is detracted in full, immediately
});

test('buildAmortSchedule halves the first and final year', () => {
  const s = buildAmortSchedule({
    id: 'inv_x', date: '2026-05-15', causale: 'MacBook', lines: [{ desc: 'MacBook Pro' }],
    totals: { imponibile: 2400 },
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  assert.equal(s.startYear, 2026);
  assert.deepEqual(s.quotas.map(q => q.year), [2026, 2027, 2028, 2029, 2030]);
  near(s.quotas[0].amount, 300);
  near(s.quotas[1].amount, 600);
  near(s.quotas[4].amount, 300);
  near(s.quotas.reduce((t, q) => t + q.amount, 0), 2400);
});

test('buildAmortSchedule without the half rule spreads evenly', () => {
  const s = buildAmortSchedule({
    id: 'inv_y', date: '2026-05-15', totals: { imponibile: 2400 }, lines: [],
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: false },
  });
  assert.equal(s.quotas.length, 4);
  near(s.quotas[0].amount, 600);
});

test('amortQuotaFor and amortResidualAt read the schedule', () => {
  const s = buildAmortSchedule({
    id: 'inv_z', date: '2026-05-15', totals: { imponibile: 2400 }, lines: [],
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  near(amortQuotaFor(s, 2026), 300);
  near(amortQuotaFor(s, 2031), 0);
  near(amortResidualAt(s, 2026), 2100);
  near(amortResidualAt(s, 2030), 0);
});

test('deductPct reduces the amortizable base', () => {
  const s = buildAmortSchedule({
    id: 'inv_w', date: '2026-01-01', totals: { imponibile: 1000 }, lines: [],
    fiscal: { deductPct: 20, amortize: true, amortYears: 4, firstYearHalf: false },
  });
  near(s.quotas.reduce((t, q) => t + q.amount, 0), 200);
});
