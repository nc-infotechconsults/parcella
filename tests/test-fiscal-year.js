// tests/test-fiscal-year.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFiscalYear } = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// Stand-in for shared.jsx:computeInvoiceAmounts — hourly clients only.
const computeInvoiceAmounts = (client, hours) => {
  const imponibile = hours * (client.hourlyRate || 0);
  const cassa = imponibile * (client.cassaPct || 0) / 100;
  const iva = (imponibile + cassa) * (client.vatPct || 0) / 100;
  return { imponibile, cassa, iva, withholding: 0, total: imponibile + cassa + iva };
};

const CLIENTS = [{ id: 'c1', name: 'Alfa', hourlyRate: 100, cassaPct: 4, vatPct: 22, billingType: 'hourly' }];

const activeInvoice = (over = {}) => ({
  id: 'inv_a', direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-07-31', monthKey: '2026-07', clientId: 'c1', linkedMonthKey: '2026-07',
  totals: { imponibile: 6240, imposta: 1372.80, documento: 7612.80 },
  vatSummary: [{ vatPct: 22, imponibile: 6240, imposta: 1372.80 }],
  withholding: { importo: 1248, aliquota: 20 },
  cassa: { importo: 240, imponibile: 6000 },
  payment: { dueDate: '2026-08-30' },
  counterparty: { name: 'Alfa' },
  fiscal: null, settlement: { status: 'open', date: null, amount: 7612.80 },
  ...over,
});

const passiveInvoice = (over = {}) => ({
  id: 'inv_p', direction: 'passive', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-08-31', monthKey: '2026-08',
  totals: { imponibile: 100, imposta: 22, documento: 122 },
  vatSummary: [{ vatPct: 22, imponibile: 100, imposta: 22 }],
  withholding: null, cassa: null, payment: { dueDate: '2026-09-30' },
  counterparty: { name: 'Fornitore', vat: '05550001112' },
  fiscal: { category: 'Utenze', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'settled', date: '2026-09-05', amount: 122 },
  ...over,
});

const reverseCharge = (over = {}) => ({
  id: 'inv_rc', direction: 'passive', reverseCharge: true, sign: 1, tipoDoc: 'TD18',
  date: '2026-08-24', monthKey: '2026-08',
  totals: { imponibile: 180, imposta: 39.60, documento: 219.60 },
  vatSummary: [{ vatPct: 22, imponibile: 180, imposta: 39.60 }],
  withholding: null, cassa: null, payment: null,
  counterparty: { name: 'Fornitore Estero', vat: 'IE1111111AA' },
  fiscal: { category: 'Software', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'settled', date: '2026-08-24', amount: 219.60 },
  ...over,
});

const run = over => computeFiscalYear({
  year: 2026, invoices: [], activities: [], expenses: [], clients: CLIENTS,
  fiscal: { ivaLiquidazione: 'trimestrale' }, computeInvoiceAmounts, ...over,
});

test('active invoices make the consuntivo revenue, cassa rivalsa included', () => {
  const r = run({ invoices: [activeInvoice()] });
  near(r.consuntivo.ricavi, 6240);
  near(r.consuntivo.cassaRivalsa, 240);
  near(r.consuntivo.ivaDebito, 1372.80);
  near(r.consuntivo.ritenutaSubita, 1248);
});

test('reverse charge is neutral on IVA and is never revenue', () => {
  const r = run({ invoices: [reverseCharge()] });
  near(r.consuntivo.ricavi, 0);                 // P3
  near(r.consuntivo.ivaDebito, 39.60);
  near(r.consuntivo.ivaCredito, 39.60);
  near(r.consuntivo.ivaSaldo, 0);
  near(r.consuntivo.ivaReverse, 39.60);
  near(r.consuntivo.costiDeducibili, 180);      // the imponibile is a cost
});

test('an invoiced month suppresses its timesheet forecast', () => {
  const activities = [
    { id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 60, day: 3 },
    { id: 'a2', clientId: 'c1', monthKey: '2026-09', hours: 10, day: 4 },
  ];
  const r = run({ invoices: [activeInvoice()], activities });
  near(r.consuntivo.ricavi, 6240);
  near(r.previsionale.ricavi, 1000);            // only September survives
  assert.equal(r.coveredMonths['c1|2026-07'], 'inv_a');
  assert.equal(r.previsionale.months.length, 1);
  assert.equal(r.previsionale.months[0].monthKey, '2026-09');
});

test('without any invoice every worked month is forecast', () => {
  const activities = [{ id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 60, day: 3 }];
  const r = run({ activities });
  near(r.consuntivo.ricavi, 0);
  near(r.previsionale.ricavi, 6000);
});

test('a credit note subtracts from revenue and from IVA a debito', () => {
  const nc = activeInvoice({
    id: 'inv_nc', tipoDoc: 'TD04', sign: -1, linkedMonthKey: null,
    totals: { imponibile: 1000, imposta: 220, documento: 1220 },
    vatSummary: [{ vatPct: 22, imponibile: 1000, imposta: 220 }],
    withholding: null, cassa: null,
  });
  const r = run({ invoices: [activeInvoice(), nc] });
  near(r.consuntivo.ricavi, 5240);
  near(r.consuntivo.ivaDebito, 1152.80);
});

test('costs follow settlement date, IVA follows document date', () => {
  const unpaid = passiveInvoice({ id: 'inv_u', settlement: { status: 'open', date: null, amount: 122 } });
  const r = run({ invoices: [unpaid] });
  near(r.consuntivo.ivaCredito, 22);        // detracted on the document date
  near(r.consuntivo.costiDeducibili, 0);    // not yet paid, so not yet deducted
  near(r.consuntivo.costiCompetenza, 100);
});

test('partial VAT detraction reduces the credit', () => {
  const r = run({ invoices: [passiveInvoice({ fiscal: { category: 'Auto', deductPct: 20, vatDetractPct: 40, amortize: false } })] });
  near(r.consuntivo.ivaCredito, 8.80);
  near(r.consuntivo.costiDeducibili, 20);
});

test('quarterly periods split IVA by document date', () => {
  const r = run({ invoices: [activeInvoice(), passiveInvoice()] });
  const q3 = r.periods.find(p => p.id === 'Q3');
  near(q3.ivaDebito, 1372.80);
  near(q3.ivaCredito, 22);
  near(q3.saldo, 1350.80);
  const q1 = r.periods.find(p => p.id === 'Q1');
  near(q1.saldo, 0);
});

test('monthly liquidation produces twelve periods', () => {
  const r = run({ invoices: [activeInvoice()], fiscal: { ivaLiquidazione: 'mensile' } });
  assert.equal(r.periods.length, 12);
  near(r.periods[6].ivaDebito, 1372.80);   // July
});

test('a cespite contributes its yearly quota, not its full cost', () => {
  const cespite = passiveInvoice({
    id: 'inv_c', date: '2026-05-15',
    totals: { imponibile: 2400, imposta: 528, documento: 2928 },
    vatSummary: [{ vatPct: 22, imponibile: 2400, imposta: 528 }],
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
    settlement: { status: 'settled', date: '2026-05-15', amount: 2928 },
  });
  const r = run({ invoices: [cespite] });
  near(r.consuntivo.costiDeducibili, 300);
  near(r.consuntivo.ivaCredito, 528);
  assert.equal(r.cespiti.length, 1);
  near(r.cespiti[0].quotaYear, 300);
  near(r.cespiti[0].residual, 2100);
});

test('an earlier cespite still contributes in later years', () => {
  const cespite = passiveInvoice({
    id: 'inv_c', date: '2025-05-15', monthKey: '2025-05',
    totals: { imponibile: 2400, imposta: 528, documento: 2928 },
    vatSummary: [{ vatPct: 22, imponibile: 2400, imposta: 528 }],
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
    settlement: { status: 'settled', date: '2025-05-15', amount: 2928 },
  });
  const r = run({ invoices: [cespite] });
  near(r.consuntivo.costiDeducibili, 600);   // 2026 is a full-quota year
  near(r.consuntivo.ivaCredito, 0);          // the 2025 document is not in this year's IVA
});

test('manual expenses still count and are grouped by category', () => {
  const expenses = [
    { id: 'e1', monthKey: '2026-03', amount: 122, vatPct: 22, vatExempt: false, deductPct: 100, billable: false, amortize: false, category: 'Cancelleria' },
    { id: 'e2', monthKey: '2026-03', amount: 100, vatPct: 22, vatExempt: false, deductPct: 100, billable: true, amortize: false, category: 'Trasferta' },
  ];
  const r = run({ invoices: [passiveInvoice()], expenses });
  near(r.consuntivo.costiDeducibili, 200);          // 100 invoice + 100 expense; billable excluded
  near(r.costiPerCategoria['Utenze'], 100);
  near(r.costiPerCategoria['Cancelleria'], 100);
  assert.equal(r.costiPerCategoria['Trasferta'], undefined);
});

test('open invoices with a due date become scadenze, newest last', () => {
  const r = run({ invoices: [activeInvoice(), passiveInvoice({ settlement: { status: 'open', date: null, amount: 122 } })] });
  assert.deepEqual(r.scadenze.map(s => s.date), ['2026-08-30', '2026-09-30']);
  assert.equal(r.scadenze[0].direction, 'active');
});

test('cash-basis revenue counts only settled invoices', () => {
  const settled = activeInvoice({ id: 'inv_s', settlement: { status: 'settled', date: '2026-09-15', amount: 7612.80 } });
  const r = run({ invoices: [activeInvoice(), settled] });
  near(r.consuntivo.ricavi, 12480);
  near(r.consuntivo.ricaviIncassati, 6240);
  near(r.consuntivo.ritenutaIncassata, 1248);
});
