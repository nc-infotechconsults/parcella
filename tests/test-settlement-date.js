// tests/test-settlement-date.js
//
// Marcare "incassata/pagata" una fattura di un anno pregresso le stampava la
// data di OGGI: il costo di un acquisto 2023 finiva nella cassa 2026 e un
// ricavo 2023 nei compensi 2026. La data predefinita non deve mai spostare un
// documento da un anno all'altro.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { settlementDateFor } = require('../src/renderer/fiscal');

const OGGI = '2026-10-07';
const doc = (over = {}) => ({ date: '2023-03-10', payment: { dueDate: '2023-04-09' }, ...over });

test('quella scelta dall utente vince su tutto', () => {
  assert.equal(settlementDateFor(doc(), '2024-01-15', OGGI), '2024-01-15');
});

test('senza scelta vale la scadenza indicata in fattura', () => {
  assert.equal(settlementDateFor(doc(), null, OGGI), '2023-04-09');
});

test('senza scadenza vale la data del documento, non oggi', () => {
  assert.equal(settlementDateFor(doc({ payment: null }), null, OGGI), '2023-03-10');
});

test('una scadenza futura non è una prova di pagamento', () => {
  // Fattura di dicembre con scadenza a gennaio: segnarla pagata oggi non può
  // datarla nell'anno dopo, o il ricavo scivola nell'esercizio successivo.
  const d = { date: '2026-09-30', payment: { dueDate: '2027-01-31' } };
  assert.equal(settlementDateFor(d, null, OGGI), '2026-09-30');
});

test('la data predefinita resta nell anno del documento', () => {
  for (const anno of ['2021', '2023', '2025', '2026']) {
    const got = settlementDateFor({ date: anno + '-05-20', payment: null }, null, OGGI);
    assert.equal(got.slice(0, 4), anno, `un documento ${anno} non può risultare incassato in un altro anno`);
  }
});

test('un documento senza date cade su oggi', () => {
  assert.equal(settlementDateFor({ date: null, payment: null }, null, OGGI), OGGI);
  assert.equal(settlementDateFor(null, null, OGGI), OGGI);
});

test('una stringa vuota non conta come scelta dell utente', () => {
  assert.equal(settlementDateFor(doc(), '', OGGI), '2023-04-09');
});

// ── Conseguenza fiscale ────────────────────────────────────────────────────
const { computeFiscalYear } = require('../src/renderer/fiscal');

const passiva2023 = () => ({
  id: 'p1', direction: 'passive', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2023-03-10', monthKey: '2023-03', causale: 'Consulenza',
  totals: { imponibile: 5000, imposta: 1100, documento: 6100 },
  vatSummary: [{ vatPct: 22, imponibile: 5000, imposta: 1100 }],
  withholding: null, cassa: null, payment: { dueDate: '2023-04-09' },
  counterparty: { name: 'Fornitore' },
  fiscal: { category: 'Consulenze', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'open', date: null, amount: 6100 },
});
const costiIn = (anno, inv) => computeFiscalYear({
  year: anno, invoices: [inv], activities: [], expenses: [], clients: [], fiscal: {},
}).consuntivo.costiDeducibili;

test('un acquisto 2023 marcato pagato si deduce nel 2023, non in questo anno', () => {
  const inv = passiva2023();
  inv.settlement = {
    ...inv.settlement, status: 'settled',
    date: settlementDateFor(inv, null, OGGI),
  };
  assert.equal(inv.settlement.date, '2023-04-09');
  assert.equal(costiIn(2023, inv), 5000);
  assert.equal(costiIn(2026, inv), 0);
});

test('con la vecchia data di oggi lo stesso costo cadeva nel 2026', () => {
  // Il comportamento che il difetto produceva, qui come guardia di regressione.
  const inv = passiva2023();
  inv.settlement = { ...inv.settlement, status: 'settled', date: OGGI };
  assert.equal(costiIn(2023, inv), 0);
  assert.equal(costiIn(2026, inv), 5000);
});
