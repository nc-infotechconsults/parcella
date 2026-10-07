// tests/test-amort-carryforward.js
//
// A bene strumentale bought in an earlier year must keep deducting its quota in
// every later year of its schedule. Imported invoices already did; manual
// expenses were filtered to the current year before their quota was taken, so
// everything after the year of purchase was lost for good.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeFiscalYear, buildExpenseAmortSchedule, amortQuotaFor,
} = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// €2.440 gross at 22% → €2.000 net, fully deductible, over 4 years.
const laptop = (over = {}) => ({
  id: 'e_hw', monthKey: '2023-03', category: 'Hardware', desc: 'Workstation',
  amount: 2440, vatPct: 22, vatExempt: false, deductPct: 100,
  amortize: true, amortYears: 4, billable: false,
  ...over,
});

const fy = (year, expenses, invoices) => computeFiscalYear({
  year, invoices: invoices || [], activities: [], expenses: expenses || [],
  clients: [], fiscal: {},
});

test('a manual cespite bought in an earlier year still deducts in this one', () => {
  const y = fy(2026, [laptop()]);
  near(y.consuntivo.costiDeducibili, 500);
});

test('its quotas span the whole schedule and total the deductible cost', () => {
  const years = [2023, 2024, 2025, 2026, 2027, 2028];
  const quotas = years.map(y => fy(y, [laptop()]).consuntivo.costiDeducibili);
  // art. 102 TUIR: half in the first year, which pushes a half quota into 2027.
  near(quotas[0], 250);
  near(quotas[1], 500);
  near(quotas[2], 500);
  near(quotas[3], 500);
  near(quotas[4], 250);
  near(quotas[5], 0, 0.001);
  near(quotas.reduce((s, q) => s + q, 0), 2000);
});

test('the year of purchase takes the quota once, not quota plus whole cost', () => {
  // The flat yearlyDeducted and the schedule quota must not both be counted.
  near(fy(2023, [laptop()]).consuntivo.costiDeducibili, 250);
});

test('a prior-year cespite is listed among the cespiti with its residual', () => {
  const y = fy(2026, [laptop()]);
  const c = y.cespiti.find(x => x.id === 'e_hw');
  assert.ok(c, 'the manual cespite must appear in the cespiti list');
  assert.equal(c.startYear, 2023);
  near(c.quotaYear, 500);
  near(c.residual, 250);   // only the 2027 half quota is left
  near(c.cost, 2000);
});

test('a deductPct below 100 shrinks the base, not the schedule', () => {
  const s = buildExpenseAmortSchedule(laptop({ deductPct: 50 }));
  near(s.cost, 1000);
  near(amortQuotaFor(s, 2023), 125);
  near(amortQuotaFor(s, 2025), 250);
});

test('an ordinary prior-year expense does not leak into this year', () => {
  const rent = laptop({ id: 'e_rent', category: 'Altro', amortize: false, amount: 1220 });
  near(fy(2026, [rent]).consuntivo.costiDeducibili, 0, 0.001);
  near(fy(2023, [rent]).consuntivo.costiDeducibili, 1000);
});

test('a billable expense is re-invoiced, never amortized as an asset', () => {
  const y = fy(2026, [laptop({ billable: true })]);
  assert.equal(y.cespiti.filter(c => c.id === 'e_hw').length, 0);
  near(y.consuntivo.costiDeducibili, 0, 0.001);
});
