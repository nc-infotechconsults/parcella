// tests/test-f24-migrate-wiring.js
//
// C2 della revisione finale, sul collegamento vero (migrateFiscalWithData, che
// app.jsx chiama al caricamento): la riga nata da una spunta deve valere quanto
// la rata che l'app mostrava prima della migrazione. Con le proposte calcolate
// a storico vuoto, un contributo versato l'anno prima spariva dal calcolo
// dell'IRPEF di quell'anno e la rata migrata veniva gonfiata.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');
const { SCENARIOS } = require('./helpers/f24-scenarios');

const r = loadRenderer();
const near = (a, b, tol = 0.006) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('la spunta migrata vale la rata che l\'app mostrava', () => {
  const sc = SCENARIOS.find(s => s.name === 'gs-con-anno-prima');
  const fiscal = {
    ...sc.fiscal, year: 2026, irpefAcconto1Paid: true,
    f24History: [{ id: 'c25', date: '2025-07-01', code: 'PXX', desc: 'Contributi 2025', amount: 8000, status: 'paid', tributo: 'contributi' }],
  };
  const shown = r.computeTaxes([], [], fiscal, '2026', [], sc.studio, sc.invoices)
    .f24All.find(f => f.slot === 'irpef/acc1/2026').amount;
  const { fiscal: migrated } = r.migrateFiscalWithData({
    fiscal, studio: sc.studio, activities: [], expenses: [], clients: [], invoices: sc.invoices, now: new Date('2026-11-09'),
  });
  near(migrated.f24History.find(f => f.slot === 'irpef/acc1/2026').amount, shown);
});
