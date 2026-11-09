// tests/test-f24-scheme-iva.js
//
// IVA per periodo e acconto del 27 dicembre (correzione 2 della spec):
// l'acconto è l'88% del saldo dell'ultimo periodo dell'anno prima, al lordo
// dell'acconto di quell'anno, e il periodo su cui grava si paga al netto.
// Importi calcolati a mano.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/renderer/f24-scheme');

const near = (a, b, tol = 0.006) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const Q = (saldi) => saldi.map((saldo, i) => ({ months: [1, 2, 3].map(k => String(i * 3 + k).padStart(2, '0')), saldo }));
const solo = (over) => {
  const sc = s.presetScheme('solo-iva', {});
  if (over) over(sc.tributi[0]);
  return sc;
};
const run = (o = {}) => s.scheduleFromScheme({
  scheme: solo(), year: 2026, bases: {}, prevBases: null,
  ivaPeriods: Q([4000, 6000, 2000, 3000]), prevIvaPeriods: Q([1, 1, 1, 3120]),
  recorded: [], basedOn: '', ...o,
});
const bySlot = (res, slot) => res.proposals.find(p => p.slot === slot);

test('i primi tre trimestri con la maggiorazione dell\'1%', () => {
  const res = run();
  const q1 = bySlot(res, 'iva/q1/2026');
  near(q1.amount, 4040);
  assert.equal(q1.date, '2026-05-16');
  assert.equal(q1.code, '6031');
  assert.equal(q1.kind, 'iva');
  near(bySlot(res, 'iva/q2/2026').amount, 6060);
  assert.equal(bySlot(res, 'iva/q2/2026').code, '6032');
  near(bySlot(res, 'iva/q3/2026').amount, 2020);
  assert.equal(bySlot(res, 'iva/q3/2026').date, '2026-11-16');
});

test('l\'acconto di dicembre è l\'88% dell\'ultimo trimestre dell\'anno prima', () => {
  const acc = bySlot(run(), 'iva/acconto/2026');
  near(acc.amount, 2745.6);
  assert.equal(acc.date, '2026-12-27');
  assert.equal(acc.code, '6035');
});

test('il quarto trimestre si paga al netto dell\'acconto', () => {
  const q4 = bySlot(run(), 'iva/q4/2026');
  near(q4.amount, 256.94);   // (3000 − 2745,60) × 1,01
  assert.equal(q4.date, '2027-03-16');
  assert.equal(q4.code, '6099');
});

test('un acconto registrato a un importo diverso vale quell\'importo', () => {
  const recorded = [{ id: 'f1', slot: 'iva/acconto/2026', tributo: 'iva', status: 'paid', amount: 2000, date: '2026-12-27', code: '6035' }];
  const res = run({ recorded });
  assert.equal(bySlot(res, 'iva/acconto/2026'), undefined);
  near(bySlot(res, 'iva/q4/2026').amount, 1010);
});

test('sotto i 103,29 euro l\'acconto non è dovuto', () => {
  const res = run({ prevIvaPeriods: Q([1, 1, 1, 100]) });
  assert.equal(bySlot(res, 'iva/acconto/2026'), undefined);
  near(bySlot(res, 'iva/q4/2026').amount, 3030);
});

test('un acconto maggiore della liquidazione lascia un credito, non una riga', () => {
  const res = run({ ivaPeriods: Q([4000, 6000, 2000, 1000]) });
  assert.equal(bySlot(res, 'iva/q4/2026'), undefined);
  assert.ok(res.crediti.iva > 0);
  near(res.crediti.iva, 1745.6);
});

test('senza documenti dell\'anno prima l\'acconto usa il ripiego', () => {
  const con = run({ prevIvaPeriods: null, scheme: solo(t => { t.acconto.fallbackPrevYear = 3120; }) });
  near(bySlot(con, 'iva/acconto/2026').amount, 2745.6);
  const senza = run({ prevIvaPeriods: null });
  assert.equal(bySlot(senza, 'iva/acconto/2026'), undefined);
  near(bySlot(senza, 'iva/q4/2026').amount, 3030);
});

test('un trimestre a credito non è una scadenza', () => {
  assert.equal(bySlot(run({ ivaPeriods: Q([4000, -500, 2000, 3000]) }), 'iva/q2/2026'), undefined);
});

test('uno schema mensile: dodici periodi e acconto su dicembre', () => {
  const mm = n => String(n).padStart(2, '0');
  const scheme = solo(t => {
    t.maggiorazionePct = 0;
    t.periodi = Array.from({ length: 12 }, (_, i) => ({
      id: `m${mm(i + 1)}`, months: [mm(i + 1)],
      date: i === 11 ? '01-16' : `${mm(i + 2)}-16`, yearOffset: i === 11 ? 1 : 0,
      code: `60${mm(i + 1)}`, label: `IVA ${mm(i + 1)}/{anno}`,
    }));
    Object.assign(t.acconto, { periodo: 'm12', code: '6013' });
  });
  const monthly = Array.from({ length: 12 }, (_, i) => ({ months: [mm(i + 1)], saldo: 1000 }));
  assert.equal(s.validateScheme(scheme).ok, true);
  const res = run({ scheme, ivaPeriods: monthly, prevIvaPeriods: monthly });
  near(bySlot(res, 'iva/m03/2026').amount, 1000);
  assert.equal(bySlot(res, 'iva/m03/2026').date, '2026-04-16');
  near(bySlot(res, 'iva/acconto/2026').amount, 880);
  assert.equal(bySlot(res, 'iva/acconto/2026').code, '6013');
  const dic = bySlot(res, 'iva/m12/2026');
  near(dic.amount, 120);
  assert.equal(dic.date, '2027-01-16');
});

test('liquidazioni mensili sommate in uno schema trimestrale', () => {
  const mm = n => String(n).padStart(2, '0');
  const monthly = Array.from({ length: 12 }, (_, i) => ({ months: [mm(i + 1)], saldo: 1000 }));
  near(bySlot(run({ ivaPeriods: monthly, prevIvaPeriods: null }), 'iva/q1/2026').amount, 3030);
});
