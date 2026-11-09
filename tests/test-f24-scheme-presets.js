// tests/test-f24-scheme-presets.js
//
// I preset riproducono le scadenze di oggi con i codici corretti
// (Appendice A della spec). La tabella dei codici attesi qui sotto è scritta a
// mano dall'appendice, non derivata dal codice: è il test che la tiene onesta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const s = require('../src/renderer/f24-scheme');

const GS = { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' };
const INARCASSA = { tipoSoggetto: 'professionista', cassaName: 'Inarcassa' };
const DITTA = { tipoSoggetto: 'ditta_individuale' };
const SOCIETA = { tipoSoggetto: 'societa' };

const trib = (scheme, id) => scheme.tributi.find(t => t.id === id);
const riga = (scheme, tid, rid) => {
  const t = trib(scheme, tid);
  if (!t) return undefined;
  if (rid === 'acconto') return t.acconto;
  return (t.righe || t.periodi || []).find(r => r.id === rid);
};

test('presetIdFor sceglie il preset come oggi si sceglievano le scadenze', () => {
  assert.equal(s.presetIdFor(GS), 'professionista-gs');
  assert.equal(s.presetIdFor(INARCASSA), 'professionista-cassa');
  assert.equal(s.presetIdFor(DITTA), 'ditta');
  assert.equal(s.presetIdFor(SOCIETA), 'solo-iva');
  // tipoSoggetto mancante vale professionista, come in computeTaxes.
  assert.equal(s.presetIdFor({ cassaName: 'Gestione Separata INPS' }), 'professionista-gs');
  assert.equal(s.presetIdFor({}), 'professionista-cassa');
});

test('ogni preset è uno schema valido', () => {
  for (const id of ['professionista-gs', 'professionista-cassa', 'ditta', 'solo-iva']) {
    const res = s.validateScheme(s.presetScheme(id, {}));
    assert.equal(res.ok, true, `${id}: ${res.errors.map(e => e.path + ' ' + e.message).join('; ')}`);
  }
});

const EXPECTED_CODES = {
  'professionista-gs': {
    'irpef/acc1': '4033', 'irpef/acc2': '4034', 'irpef/saldo': '4001',
    'addReg/saldo': '3801', 'addCom/acc1': '3843', 'addCom/saldo': '3844',
    'contributi/acc1': 'PXX', 'contributi/acc2': 'PXX', 'contributi/saldo': 'PXX',
    'iva/q1': '6031', 'iva/q2': '6032', 'iva/q3': '6033', 'iva/q4': '6099', 'iva/acconto': '6035',
  },
  'professionista-cassa': {
    'irpef/acc1': '4033', 'irpef/saldo': '4001', 'addReg/saldo': '3801',
    'contributi/acc1': '', 'contributi/acc2': '', 'contributi/saldo': '',
    'iva/q4': '6099',
  },
  'ditta': {
    'irpef/acc1': '4033', 'irpef/acc2': '4034', 'irpef/saldo': '4001',
    'addReg/saldo': '3801', 'addCom/acc1': '3843', 'addCom/saldo': '3844',
    'inpsFisso/r1': 'AF', 'inpsFisso/r2': 'AF', 'inpsFisso/r3': 'AF', 'inpsFisso/r4': 'AF',
    'inpsEccedente/acc1': 'AP', 'inpsEccedente/acc2': 'AP', 'inpsEccedente/saldo': 'AP',
    'irap/acc1': '3812', 'irap/acc2': '3813', 'irap/saldo': '3800',
    'iva/q1': '6031', 'iva/q2': '6032', 'iva/q3': '6033', 'iva/q4': '6099', 'iva/acconto': '6035',
  },
  'solo-iva': { 'iva/q1': '6031', 'iva/q2': '6032', 'iva/q3': '6033', 'iva/q4': '6099', 'iva/acconto': '6035' },
};

test("i codici dei preset sono quelli dell'Appendice A", () => {
  for (const [pid, codes] of Object.entries(EXPECTED_CODES)) {
    const scheme = s.presetScheme(pid, {});
    for (const [key, code] of Object.entries(codes)) {
      const [tid, rid] = key.split('/');
      const r = riga(scheme, tid, rid);
      assert.ok(r, `${pid}: manca ${key}`);
      assert.equal(r.code, code, `${pid} ${key}`);
    }
  }
  assert.equal(trib(s.presetScheme('ditta', {}), 'contributi'), undefined, 'la ditta non ha contributi da cassa');
  assert.equal(trib(s.presetScheme('professionista-cassa', {}), 'contributi').sezione, 'altri-enti');
  assert.deepEqual(s.presetScheme('solo-iva', {}).tributi.map(t => t.id), ['iva']);
});

test('date e quote dei preset', () => {
  const gs = s.presetScheme('professionista-gs', {});
  const irpef = trib(gs, 'irpef');
  assert.deepEqual(irpef.righe.map(r => [r.id, r.share, r.date, r.yearOffset]),
    [['acc1', 40, '06-30', 0], ['acc2', 60, '11-30', 0], ['saldo', undefined, '06-30', 1]]);
  assert.equal(trib(gs, 'contributi').acconti.pct, 80);
  assert.deepEqual(trib(gs, 'contributi').righe.filter(r => r.quota === 'acconto').map(r => r.share), [50, 50]);
  assert.equal(trib(s.presetScheme('professionista-cassa', {}), 'contributi').acconti.pct, 100);
  const addCom = trib(gs, 'addCom');
  assert.equal(addCom.acconti.pct, 30);
  assert.deepEqual(addCom.righe.filter(r => r.quota === 'acconto').map(r => [r.id, r.share]), [['acc1', 100]]);
  assert.equal(trib(gs, 'addReg').acconti.metodo, 'nessuno');

  const ditta = s.presetScheme('ditta', {});
  assert.deepEqual(trib(ditta, 'inpsFisso').righe.map(r => [r.quota, r.share, r.date, r.yearOffset]),
    [['corrente', 25, '05-16', 0], ['corrente', 25, '08-20', 0], ['corrente', 25, '11-16', 0], ['corrente', 25, '02-16', 1]]);
  const ecc = trib(ditta, 'inpsEccedente');
  assert.equal(ecc.acconti.metodo, 'storico');
  assert.equal(ecc.acconti.pct, 100);
  assert.deepEqual(ecc.righe.map(r => [r.id, r.share, r.date]), [['acc1', 50, '06-30'], ['acc2', 50, '11-30'], ['saldo', undefined, '06-30']]);

  const acc = trib(gs, 'iva').acconto;
  assert.deepEqual([acc.pct, acc.soglia, acc.date, acc.periodo], [88, 103.29, '12-27', 'q4']);
});

test('i ripieghi e la percentuale di acconto arrivano dai campi di oggi', () => {
  const gs = s.presetScheme('professionista-gs', { irpefPrevYear: 700, cassaPrevYear: 17000, cassaAccontoPct: 75 });
  assert.equal(trib(gs, 'irpef').acconti.fallbackPrevYear, 700);
  assert.equal(trib(gs, 'contributi').acconti.fallbackPrevYear, 17000);
  assert.equal(trib(gs, 'contributi').acconti.pct, 75);
});

test('activeScheme: preset, schema salvato, schema salvato invalido', () => {
  const fromPreset = s.activeScheme({}, GS);
  assert.equal(fromPreset.source, 'preset');
  assert.equal(fromPreset.scheme.preset, 'professionista-gs');

  // Review Focus 2: uno schema salvato non segue un cambio di cassa.
  const saved = s.presetScheme('professionista-gs', {});
  const kept = s.activeScheme({ scadenzario: saved }, INARCASSA);
  assert.equal(kept.source, 'saved');
  assert.equal(kept.scheme.preset, 'professionista-gs');
  assert.equal(kept.warning, null);

  // Review Focus 1: uno schema salvato che non regge più ricade sul preset, e lo dice.
  const bad = s.presetScheme('professionista-gs', {});
  bad.tributi[0].base = 'irpefNetta';
  const fallback = s.activeScheme({ scadenzario: bad }, GS);
  assert.equal(fallback.source, 'preset');
  assert.ok(/non valido/.test(fallback.warning), fallback.warning);
  assert.equal(s.validateScheme(fallback.scheme).ok, true);
});

test('schemeSlots elenca le scadenze di un tributo con le date complete', () => {
  const slots = s.schemeSlots(s.presetScheme('professionista-gs', {}), 'irpef', 2026);
  assert.deepEqual(slots.map(x => [x.slot, x.date]), [
    ['irpef/acc1/2026', '2026-06-30'], ['irpef/acc2/2026', '2026-11-30'], ['irpef/saldo/2026', '2027-06-30'],
  ]);
  assert.equal(slots[0].label, '1° acconto IRPEF 2026');
  const iva = s.schemeSlots(s.presetScheme('professionista-gs', {}), 'iva', 2026).map(x => x.slot);
  assert.ok(iva.includes('iva/acconto/2026') && iva.includes('iva/q4/2026'));
});

test('inferTributo deduce il tributo dal codice', () => {
  const gs = s.presetScheme('professionista-gs', {});
  const ditta = s.presetScheme('ditta', {});
  for (const c of ['PXX', 'PXXR', 'P10', '0601']) assert.equal(s.inferTributo(c, gs), 'contributi', c);
  // Nel preset nuovo il 3801 è l'addizionale regionale; letto come dato di prima
  // dello scadenzario era il codice che l'app dava ai contributi.
  assert.equal(s.inferTributo('3801', gs), 'addReg');
  assert.equal(s.inferTributo('3801', gs, { legacy: true }), 'contributi');
  for (const c of ['4001', '4033', '4034']) assert.equal(s.inferTributo(c, gs), 'irpef', c);
  for (const c of ['6031', '6099', '6035', '6007']) assert.equal(s.inferTributo(c, gs), 'iva', c);
  assert.equal(s.inferTributo('3844', gs), 'addCom');
  assert.equal(s.inferTributo('3812', ditta), 'irap');
  assert.equal(s.inferTributo('AF', ditta), 'inpsFisso');
  assert.equal(s.inferTributo('CPR', ditta), 'inpsEccedente');
  assert.equal(s.inferTributo('0601', ditta), 'inpsFisso');
  // Ruling P1: nella ditta il 3801 è l'addizionale regionale vera.
  assert.equal(s.inferTributo('3801', ditta), 'addReg');
  assert.equal(s.inferTributo('9999', gs), null);
});

test('kindOf legge il tipo dal tributo della riga, non dal codice', () => {
  const gs = s.presetScheme('professionista-gs', {});
  assert.equal(s.kindOf({ tributo: 'contributi', code: '4001' }, gs), 'contributo');
  assert.equal(s.kindOf({ tributo: 'irpef', code: '3801' }, gs), 'imposta');
  assert.equal(s.kindOf({ code: '3801' }, gs), null);
  assert.equal(s.kindOf({ tributo: 'sparito' }, gs), null);
});

test('LEGACY_CODES ricorda i codici che usava il generatore di prima', () => {
  assert.equal(s.LEGACY_CODES['iva/q2'], '6031');
  assert.equal(s.LEGACY_CODES['contributi/saldo'], '3801');
  assert.equal(s.LEGACY_CODES['inpsFisso/r3'], '0601');
  assert.equal(s.LEGACY_CODES['irap/acc2'], '3800');
});

test('la ditta commerciante versa con CF e CP', () => {
  const ditta = s.activeScheme({}, { tipoSoggetto: 'ditta_individuale', tipoInps: 'commerciante' }).scheme;
  assert.ok(trib(ditta, 'inpsFisso').righe.every(r => r.code === 'CF'));
  assert.ok(trib(ditta, 'inpsEccedente').righe.every(r => r.code === 'CP'));
  const artigiano = s.activeScheme({}, { tipoSoggetto: 'ditta_individuale' }).scheme;
  assert.ok(trib(artigiano, 'inpsFisso').righe.every(r => r.code === 'AF'));
});

// I4: uno schema salvato non valido va segnalato come tale, perché l'editor
// possa mostrarlo e permettere di correggerlo o ripristinare il preset.
test('activeScheme segnala lo schema salvato non valido', () => {
  const bad = s.presetScheme('professionista-gs', {});
  bad.tributi[0].base = 'irpefNetta';
  const r = s.activeScheme({ scadenzario: bad }, GS);
  assert.equal(r.invalid, true);
  assert.equal(s.activeScheme({}, GS).invalid, false);
  assert.equal(s.activeScheme({ scadenzario: s.presetScheme('professionista-gs', {}) }, GS).invalid, false);
});
