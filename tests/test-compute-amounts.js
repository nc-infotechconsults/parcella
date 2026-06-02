// tests/test-compute-amounts.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

// Inline the function to test it in Node.js (it lives in a browser-side .jsx file with no exports)
function computeInvoiceAmounts(client, hours) {
  let imponibile;
  if (client.billingType === 'monthly') {
    imponibile = client.monthlyRate || 0;
  } else if (client.billingType === 'project') {
    imponibile = client.projectMonthlyAmount || 0;
  } else {
    imponibile = hours * (client.hourlyRate || 0);
  }
  let cassa = 0, iva = 0, withholding = 0;
  if (client.cassaIncluded) {
    iva = (imponibile * (client.vatPct || 0)) / 100;
  } else {
    cassa = (imponibile * (client.cassaPct || 0)) / 100;
    iva = ((imponibile + cassa) * (client.vatPct || 0)) / 100;
  }
  if (client.withholding) withholding = (imponibile + cassa) * 0.20;
  const total = imponibile + cassa + iva - withholding;
  return { imponibile, cassa, iva, withholding, total };
}

const base = { cassaPct: 4, cassaIncluded: false, vatPct: 22, withholding: false };

test('hourly: imponibile = hours * rate', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'hourly', hourlyRate: 100 }, 10);
  assert.equal(r.imponibile, 1000);
});

test('hourly: default (no billingType) same as hourly', () => {
  const r = computeInvoiceAmounts({ ...base, hourlyRate: 80 }, 5);
  assert.equal(r.imponibile, 400);
});

test('monthly: imponibile = monthlyRate regardless of hours', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'monthly', monthlyRate: 6000 }, 80);
  assert.equal(r.imponibile, 6000);
});

test('project: imponibile = projectMonthlyAmount', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'project', projectMonthlyAmount: 1500 }, 30);
  assert.equal(r.imponibile, 1500);
});

test('monthly: cassa and IVA computed on monthlyRate', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'monthly', monthlyRate: 6000 }, 0);
  assert.equal(r.cassa, 240);
  assert.equal(r.iva, (6000 + 240) * 0.22);
});

test('monthly: zero monthlyRate returns zero imponibile', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'monthly', monthlyRate: 0 }, 10);
  assert.equal(r.imponibile, 0);
});
