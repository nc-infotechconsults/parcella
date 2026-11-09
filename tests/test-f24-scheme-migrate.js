// tests/test-f24-scheme-migrate.js
//
// La migrazione porta i dati di prima nello scadenzario senza cambiarne i
// numeri: le spunte "Versato" diventano righe registrate con lo stesso importo,
// e le righe vecchie ricevono tributo, slot e anno. È idempotente e non salva
// nessuno schema: finché l'utente non lo modifica, vale il preset.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/renderer/f24-scheme');

const GS = { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' };
const NOW = new Date('2026-11-09T10:00:00Z');
// Proposte fisse, come le darebbe computeTaxes con lo storico vuoto.
const PROPOSALS = {
  2025: [
    { slot: 'contributi/saldo/2025', tributo: 'contributi', date: '2026-06-30', code: 'PXX', amount: 3000, desc: 'Saldo INPS 2025' },
    { slot: 'irpef/saldo/2025', tributo: 'irpef', date: '2026-06-30', code: '4001', amount: 700, desc: 'Saldo IRPEF 2025' },
  ],
  2026: [
    { slot: 'iva/q1/2026', tributo: 'iva', date: '2026-05-16', code: '6031', amount: 4040, desc: 'IVA 1° trim 2026' },
    { slot: 'irpef/acc1/2026', tributo: 'irpef', date: '2026-06-30', code: '4033', amount: 11360, desc: '1° acconto IRPEF 2026' },
    { slot: 'contributi/acc1/2026', tributo: 'contributi', date: '2026-06-30', code: 'PXX', amount: 6800, desc: '1° acconto INPS 2026' },
    { slot: 'contributi/acc2/2026', tributo: 'contributi', date: '2026-11-30', code: 'PXX', amount: 6800, desc: '2° acconto INPS 2026' },
  ],
};
const proposalsFor = y => (PROPOSALS[y] || []).map(p => ({ ...p, id: '_' + p.slot, _generated: true }));
const migrate = (fiscal, over = {}) => s.migrateFiscal({ fiscal, studio: GS, proposalsFor, now: NOW, ...over });
const row = (over) => ({ id: 'h1', date: '2026-05-16', code: '6031', desc: 'x', amount: 100, status: 'paid', ...over });

test('una seconda migrazione non cambia niente', () => {
  const once = migrate({ year: 2026, cassaAcconto1Paid: true, f24History: [row(), row({ id: 'h2', code: '9999' })] });
  assert.equal(once.changed, true);
  const twice = migrate(once.fiscal);
  assert.equal(twice.changed, false);
  assert.equal(JSON.stringify(twice.fiscal), JSON.stringify(once.fiscal));
});

test('una spunta diventa una riga versata con lo stesso importo', () => {
  const { fiscal } = migrate({ year: 2026, cassaAcconto1Paid: true, f24History: [] });
  const r = fiscal.f24History.find(f => f.slot === 'contributi/acc1/2026');
  assert.ok(r, 'manca la riga della spunta');
  assert.equal(r.status, 'paid');
  assert.equal(r.tributo, 'contributi');
  assert.equal(r.anno, 2026);
  assert.equal(r.amount, 6800);
  assert.equal(r.date, '2026-06-30');
  assert.equal('cassaAcconto1Paid' in fiscal, false);
});

test("l'importo IVA scritto a mano vince su quello calcolato", () => {
  const { fiscal } = migrate({ year: 2026, ivaQ1Paid: true, ivaQ1Amount: 4280, f24History: [] });
  assert.equal(fiscal.f24History.find(f => f.slot === 'iva/q1/2026').amount, 4280);
  assert.equal('ivaQ1Amount' in fiscal, false);
});

test('una spunta senza scadenza nello schema si scarta, e lo dice', () => {
  const scheme = s.presetScheme('professionista-gs', {});
  const irpef = scheme.tributi.find(t => t.id === 'irpef');
  irpef.acconti.metodo = 'nessuno';
  irpef.righe = irpef.righe.filter(r => r.quota !== 'acconto');
  const { fiscal, log } = migrate({ year: 2026, scadenzario: scheme, irpefAcconto1Paid: true, f24History: [] });
  assert.equal(fiscal.f24History.length, 0);
  assert.equal('irpefAcconto1Paid' in fiscal, false);
  assert.ok(log.some(l => /irpefAcconto1Paid/.test(l)), log.join('\n'));
});

test('una spunta non raddoppia una riga che esiste già', () => {
  const esistente = row({ id: 'h9', date: '2026-07-01', code: 'PXX', amount: 6500, slot: 'contributi/acc1/2026', tributo: 'contributi', anno: 2026 });
  const { fiscal } = migrate({ year: 2026, cassaAcconto1Paid: true, f24History: [esistente] });
  assert.equal(fiscal.f24History.filter(f => f.slot === 'contributi/acc1/2026').length, 1);
  assert.equal(fiscal.f24History[0].amount, 6500);
});

test("senza fiscal.year le spunte valgono per l'anno in corso", () => {
  const { fiscal } = migrate({ cassaAcconto2Paid: true, f24History: [] });
  assert.ok(fiscal.f24History.find(f => f.slot === 'contributi/acc2/2026'));
});

test('le righe vecchie ricevono il tributo dal codice, letto come lo usava l\'app di prima', () => {
  const { fiscal } = migrate({ f24History: [row({ id: 'a', date: '2026-12-30', code: '3801' }), row({ id: 'b', date: '2026-12-30', code: '9999' })] });
  const a = fiscal.f24History.find(f => f.id === 'a');
  const b = fiscal.f24History.find(f => f.id === 'b');
  assert.equal(a.tributo, 'contributi');
  assert.equal(a.code, '3801', 'il codice non si riscrive');
  assert.equal(b.tributo, null);
});

test('una riga vecchia nella data di una scadenza ne prende lo slot', () => {
  const { fiscal } = migrate({ f24History: [row()] });
  assert.equal(fiscal.f24History[0].slot, 'iva/q1/2026');
  assert.equal(fiscal.f24History[0].anno, 2026);
});

test('al 30 giugno decide la descrizione: saldo dell\'anno prima o acconto di quest\'anno', () => {
  const saldo = migrate({ f24History: [row({ id: 's', date: '2026-06-30', code: '3801', desc: 'Saldo INPS 2025' })] });
  assert.equal(saldo.fiscal.f24History[0].slot, 'contributi/saldo/2025');
  assert.equal(saldo.fiscal.f24History[0].anno, 2025);
  assert.ok(saldo.log.some(l => /descrizione/.test(l)), saldo.log.join('\n'));
  const acc = migrate({ f24History: [row({ id: 'c', date: '2026-06-30', code: '3801', desc: '1° acconto INPS' })] });
  assert.equal(acc.fiscal.f24History[0].slot, 'contributi/acc1/2026');
  assert.ok(acc.log.some(l => /descrizione/.test(l)));
});

// La spec diceva "anno della data", ma sui dati veri un "Saldo IRPEF 2025"
// versato a giugno 2026 (nessuna proposta: il saldo 2025 calcolato è un
// credito) diventava un acconto IRPEF 2026 e ne riduceva il saldo. Prima dello
// scadenzario una riga così non toccava il saldo: senza scadenza, la migrazione
// non inventa l'anno, e la riga resta fuori dai saldi finché l'utente non lo
// indica.
test('senza scadenza corrispondente: niente slot e niente anno', () => {
  const { fiscal } = migrate({ f24History: [
    row({ id: 'x', date: '2026-12-30', code: '3801' }),
    row({ id: 'y', date: '2026-06-30', code: '4001', desc: 'Saldo IRPEF 2025', amount: 700 }),
  ] });
  for (const h of fiscal.f24History) {
    if (h.id === 'y' && h.slot) continue;   // con la proposta del 2025 il saldo si collega
    assert.equal(h.slot, undefined, h.id);
    assert.equal(h.anno, undefined, h.id);
  }
});

test('senza proposta, un saldo dell\'anno prima non diventa un acconto di quest\'anno', () => {
  const { fiscal } = migrate({ f24History: [row({ id: 'y', date: '2026-06-30', code: '4001', desc: 'Saldo IRPEF 2025', amount: 700 })] },
    { proposalsFor: () => [] });
  assert.equal(fiscal.f24History[0].anno, undefined);
});

test('una riga di cui si conosce il tributo prende solo scadenze di quel tributo', () => {
  // Nel preset nuovo il 3801 è l'addizionale regionale; un "Saldo INPS"
  // registrato con il 3801 di prima resta un saldo contributi.
  const proposte = { 2026: [
    { slot: 'addReg/saldo/2026', tributo: 'addReg', date: '2027-06-30', code: '3801', amount: 1300, desc: 'Saldo addizionale regionale 2026' },
    { slot: 'contributi/saldo/2026', tributo: 'contributi', date: '2027-06-30', code: 'PXX', amount: 8500, desc: 'Saldo INPS 2026' },
  ] };
  const { fiscal } = migrate({ f24History: [row({ date: '2027-06-30', code: '3801', desc: 'Saldo INPS 2026', status: 'estimated' })] },
    { proposalsFor: y => proposte[y] || [] });
  assert.equal(fiscal.f24History[0].tributo, 'contributi');
  assert.equal(fiscal.f24History[0].slot, 'contributi/saldo/2026');
});

test('la migrazione non salva nessuno schema', () => {
  const { fiscal } = migrate({ year: 2026, cassaAcconto1Paid: true, f24History: [row()] });
  assert.equal(fiscal.scadenzario, undefined);
});
