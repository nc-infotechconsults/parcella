// tests/test-irpef-base.js
//
// Il reddito imponibile IRPEF è: compensi incassati, meno i costi di esercizio
// dell'anno, meno le quote di ammortamento (anche di acquisti di anni
// precedenti), meno i CONTRIBUTI VERSATI nell'anno. Il contributo si deduce per
// cassa (art. 10 TUIR): si deduceva invece quello maturato sull'anno corrente,
// che nessuno ha ancora pagato.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');

const r = loadRenderer();
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const active = (over = {}) => ({
  id: 'a1', direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-02-20', monthKey: '2026-02', clientId: null, linkedMonthKey: null,
  totals: { imponibile: 100000, imposta: 22000, documento: 122000 },
  vatSummary: [{ vatPct: 22, imponibile: 100000, imposta: 22000 }],
  withholding: null, cassa: null, payment: null, counterparty: { name: 'C' },
  fiscal: null, settlement: { status: 'settled', date: '2026-03-01', amount: 122000 },
  ...over,
});
// Spesa di esercizio: €1.220 lordi al 22% → €1.000 netti, interamente dedotti.
const spesa = (over = {}) => ({
  id: 'e1', monthKey: '2026-04', category: 'Altro', amount: 1220, vatPct: 22,
  deductPct: 100, amortize: false, billable: false, ...over,
});
// Cespite 2023: €2.000 netti su 4 anni → quota piena €500 nel 2026.
const cespite2023 = (over = {}) => ({
  id: 'e_hw', monthKey: '2023-03', category: 'Hardware', amount: 2440, vatPct: 22,
  deductPct: 100, amortize: true, amortYears: 4, billable: false, ...over,
});
const f24 = (date, code, amount, status = 'paid') => ({ id: 'h' + date + code, date, code, desc: 'x', amount, status });

const studio = { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' };
const FISC = { cassaContribPct: 26.07, addRegPct: 0, addComPct: 0, cassaPrevYear: 0, irpefPrevYear: 0 };
const run = (over = {}, expenses = []) =>
  r.computeTaxes([], expenses, { ...FISC, f24History: [], ...over }, '2026', [], studio, [active()]);

test('senza contributi versati non si deduce nulla per i contributi', () => {
  const t = run();
  near(t.contributiVersati, 0);
  near(t.redditoImpIrpef, 100000);
});

test('i contributi versati nell anno riducono la base IRPEF', () => {
  const t = run({ f24History: [f24('2026-06-30', '3801', 8000)] });
  near(t.contributiVersati, 8000);
  near(t.redditoImpIrpef, 92000);
});

test('il contributo maturato ma non versato non si deduce', () => {
  const t = run();
  near(t.contribCassa, 26070);        // maturato sull anno
  near(t.contributiVersati, 0);       // ma non versato
  near(t.redditoImpIrpef, 100000);    // quindi non dedotto
});

test('un saldo dell anno prima pagato quest anno si deduce quest anno', () => {
  const t = run({ f24History: [f24('2026-06-30', '3801', 5000), f24('2026-11-30', '3801', 3000)] });
  near(t.contributiVersati, 8000);
  near(t.redditoImpIrpef, 92000);
});

test('un versamento datato in un altro anno non entra', () => {
  const t = run({ f24History: [f24('2025-06-30', '3801', 9000), f24('2027-06-30', '3801', 9000)] });
  near(t.contributiVersati, 0);
  near(t.redditoImpIrpef, 100000);
});

test('un F24 programmato ma non pagato non si deduce', () => {
  const t = run({ f24History: [f24('2026-06-30', '3801', 9000, 'scheduled')] });
  near(t.contributiVersati, 0);
});

test('solo i tributi contributivi riducono la base: IVA e IRPEF no', () => {
  const t = run({ f24History: [f24('2026-05-16', '6031', 20000), f24('2026-06-30', '4033', 15000)] });
  near(t.contributiVersati, 0);
  near(t.redditoImpIrpef, 100000);
});

test('il flag Versato conta la rata anche senza una riga F24', () => {
  const t = run({ cassaPrevYear: 10000, cassaAcconto1Paid: true });
  near(t.accontiCassa, 8000);            // 80% di 10.000
  near(t.contributiVersati, 4000);       // una sola delle due rate
  near(t.redditoImpIrpef, 96000);
});

test('costi di esercizio e quote di ammortamento si sommano nella deduzione', () => {
  const t = run({ f24History: [f24('2026-06-30', '3801', 8000)] }, [spesa(), cespite2023()]);
  near(t.costiEsercizio, 1000);
  near(t.quoteAmmortamento, 500);
  near(t.costiDeducibili, 1500);
  near(t.redditoImpIrpef, 100000 - 1000 - 500 - 8000);
});

test('la scomposizione dei costi torna sempre al totale dedotto', () => {
  const t = run({}, [spesa(), cespite2023()]);
  near(t.costiEsercizio + t.quoteAmmortamento, t.costiDeducibili);
});

test('la base non va sotto zero', () => {
  const t = run({ f24History: [f24('2026-06-30', '3801', 500000)] });
  assert.equal(t.redditoImpIrpef, 0);
  assert.equal(t.irpefLordaTot, 0);
});
