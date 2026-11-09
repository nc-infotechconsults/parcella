// tests/test-f24-scheme-schedule.js
//
// Le proposte di imposte e contributi, e soprattutto i saldi: il saldo chiude
// la differenza contro gli acconti COSÌ COME SONO — l'importo registrato quando
// c'è, la proposta dove non c'è ancora niente — e mai contro acconti che
// nessuno ha versato. Importi calcolati a mano.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/renderer/f24-scheme');

const near = (a, b, tol = 0.006) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const bases = { irpef: 8000, addReg: 1700, addCom: 800, contribCassa: 13000, contribFisso: 0, contribVar: 0, irap: 0 };
const prevBases = { irpef: 5000, addReg: 1500, addCom: 700, contribCassa: 17000, contribFisso: 0, contribVar: 0, irap: 0 };
const gs = (over) => {
  const sc = s.presetScheme('professionista-gs', {});
  if (over) over(sc);
  return sc;
};
const run = (o = {}) => s.scheduleFromScheme({
  scheme: gs(), year: 2026, bases, prevBases, ivaPeriods: null, prevIvaPeriods: null,
  recorded: [], basedOn: 'su 2025 effettivo', ...o,
});
const bySlot = (res, slot) => res.proposals.find(p => p.slot === slot);
const trib = (sc, id) => sc.tributi.find(t => t.id === id);
const noAcconti = (id) => (sc) => {
  const t = trib(sc, id);
  t.acconti.metodo = 'nessuno';
  t.righe = t.righe.filter(r => r.quota !== 'acconto');
};

test('acconti IRPEF storici 40/60 e saldo l\'anno dopo', () => {
  const res = run();
  near(bySlot(res, 'irpef/acc1/2026').amount, 2000);
  near(bySlot(res, 'irpef/acc2/2026').amount, 3000);
  const saldo = bySlot(res, 'irpef/saldo/2026');
  near(saldo.amount, 3000);
  assert.equal(saldo.date, '2027-06-30');
  assert.equal(saldo.code, '4001');
  assert.equal(saldo.kind, 'imposta');
  assert.equal(saldo.tributo, 'irpef');
  assert.equal(saldo.id, '_irpef/saldo/2026');
  assert.equal(saldo._generated, true);
});

test('acconti contributi all\'80% in due metà; il saldo negativo è un credito', () => {
  const res = run();
  near(bySlot(res, 'contributi/acc1/2026').amount, 6800);
  near(bySlot(res, 'contributi/acc2/2026').amount, 6800);
  assert.equal(bySlot(res, 'contributi/saldo/2026'), undefined);
  near(res.saldi.contributi, -600);
  near(res.crediti.contributi, 600);
  near(res.acconti.contributi, 13600);
});

test('l\'addizionale regionale non ha acconti', () => {
  const res = run();
  assert.equal(res.proposals.filter(p => p.tributo === 'addReg' && p.slot !== 'addReg/saldo/2026').length, 0);
  near(bySlot(res, 'addReg/saldo/2026').amount, 1700);
});

test('l\'addizionale comunale ha un acconto del 30%', () => {
  const res = run();
  near(bySlot(res, 'addCom/acc1/2026').amount, 210);
  near(bySlot(res, 'addCom/saldo/2026').amount, 590);
});

test('senza acconti il saldo è l\'imposta intera', () => {
  const res = run({ scheme: gs(noAcconti('irpef')) });
  near(res.saldi.irpef, 8000);
  assert.equal(res.proposals.filter(p => /^irpef\/acc/.test(p.slot)).length, 0);
});

test('senza anno prima si usa il ripiego del tributo', () => {
  const res = run({ prevBases: null, scheme: gs(sc => { trib(sc, 'irpef').acconti.fallbackPrevYear = 700; }) });
  near(bySlot(res, 'irpef/acc1/2026').amount, 280);
  near(bySlot(res, 'irpef/acc2/2026').amount, 420);
});

test('sotto la soglia gli acconti non sono dovuti', () => {
  const res = run({
    prevBases: { ...prevBases, irpef: 50 },
    scheme: gs(sc => { trib(sc, 'irpef').acconti.soglia = 51.65; }),
  });
  assert.equal(res.proposals.filter(p => /^irpef\/acc/.test(p.slot)).length, 0);
  near(res.saldi.irpef, 8000);
});

test('le etichette portano l\'anno, e gli acconti su che base sono calcolati', () => {
  const res = run();
  assert.equal(bySlot(res, 'irpef/saldo/2026').desc, 'Saldo IRPEF 2026');
  assert.ok(bySlot(res, 'irpef/acc1/2026').desc.startsWith('1° acconto IRPEF 2026'));
  assert.ok(bySlot(res, 'irpef/acc1/2026').desc.endsWith('(su 2025 effettivo)'));
});

const paid = (slot, amount, over = {}) => ({
  id: 'f' + slot, slot, tributo: slot.split('/')[0], status: 'paid', amount, date: '2026-07-10', code: 'X', ...over,
});

test('una riga registrata versata sostituisce la proposta e ne fissa l\'importo', () => {
  const res = run({ recorded: [paid('irpef/acc1/2026', 1500)] });
  assert.equal(bySlot(res, 'irpef/acc1/2026'), undefined);
  near(res.saldi.irpef, 8000 - 1500 - 3000);
});

test('spostare di data una riga registrata non la scollega dalla sua scadenza', () => {
  const res = run({ recorded: [paid('irpef/acc1/2026', 1500, { date: '2026-12-30' })] });
  assert.equal(bySlot(res, 'irpef/acc1/2026'), undefined);
  near(res.saldi.irpef, 3500);
});

test('una riga stimata non è un fatto', () => {
  const res = run({ recorded: [paid('irpef/acc1/2026', 1500, { status: 'estimated' })] });
  near(bySlot(res, 'irpef/acc1/2026').amount, 2000);
  near(res.saldi.irpef, 3000);
});

test('un acconto versato fuori programma riduce il saldo del suo anno', () => {
  const extra = { id: 'x1', tributo: 'contributi', anno: 2026, status: 'paid', amount: 1000, date: '2026-12-30', code: 'PXX' };
  near(run({ recorded: [extra] }).saldi.contributi, -1600);
  const senzaAnno = { ...extra, anno: undefined };
  near(run({ recorded: [senzaAnno] }).saldi.contributi, -600);
  near(run({ recorded: [{ ...extra, anno: 2025 }] }).saldi.contributi, -600);
});

test('una riga con uno slot che lo schema non ha più riduce comunque il saldo', () => {
  // Review Focus 4: un acconto pagato prima di passare a "nessun acconto".
  const res = run({ scheme: gs(noAcconti('irpef')), recorded: [paid('irpef/acc1/2026', 1000)] });
  near(res.saldi.irpef, 7000);
});

test('gli importi registrati come stringa valgono come numeri', () => {
  // Review Focus 3: dati scritti prima che upsertF24Entry normalizzasse.
  near(run({ recorded: [paid('irpef/acc1/2026', '1500')] }).saldi.irpef, 3500);
  near(run({ recorded: [paid('irpef/acc1/2026', '1500,5')] }).saldi.irpef, 3499.5);
});

test('le righe correnti dividono la base dell\'anno e non hanno saldo', () => {
  const res = s.scheduleFromScheme({
    scheme: s.presetScheme('ditta', {}), year: 2026,
    bases: { ...bases, contribFisso: 4427 }, prevBases, ivaPeriods: null, prevIvaPeriods: null, recorded: [], basedOn: '',
  });
  const rate = res.proposals.filter(p => p.tributo === 'inpsFisso');
  assert.deepEqual(rate.map(p => p.date), ['2026-05-16', '2026-08-20', '2026-11-16', '2027-02-16']);
  rate.forEach(p => near(p.amount, 1106.75));
  assert.equal(res.saldi.inpsFisso, undefined);
});

test('le proposte sono ordinate per data', () => {
  const dates = run().proposals.map(p => p.date);
  assert.deepEqual(dates, dates.slice().sort());
});
