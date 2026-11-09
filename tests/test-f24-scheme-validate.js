// tests/test-f24-scheme-validate.js
//
// Uno schema rotto non deve produrre in silenzio zero scadenze: validateScheme è
// il punto in cui l'editor lo ferma prima del salvataggio e in cui activeScheme
// lo scarta al caricamento. Ogni test rompe uno schema valido in un punto solo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateScheme } = require('../src/renderer/f24-scheme');

const validScheme = () => ({
  version: 1,
  preset: 'professionista-gs',
  tributi: [
    {
      id: 'irpef', label: 'IRPEF', kind: 'imposta', base: 'irpef', sezione: 'erario',
      acconti: { metodo: 'storico', pct: 100, fallbackPrevYear: 0, soglia: 0 },
      righe: [
        { id: 'acc1', quota: 'acconto', share: 40, date: '06-30', yearOffset: 0, code: '4033', label: '1° acconto IRPEF {anno}' },
        { id: 'acc2', quota: 'acconto', share: 60, date: '11-30', yearOffset: 0, code: '4034', label: '2° acconto IRPEF {anno}' },
        { id: 'saldo', quota: 'saldo', date: '06-30', yearOffset: 1, code: '4001', label: 'Saldo IRPEF {anno}' },
      ],
    },
    {
      id: 'iva', label: 'IVA', kind: 'iva', base: 'ivaPeriodo', sezione: 'erario', maggiorazionePct: 1,
      acconto: { metodo: 'storico', pct: 88, soglia: 103.29, fallbackPrevYear: 0, date: '12-27', yearOffset: 0, code: '6035', label: 'Acconto IVA {anno}', periodo: 'q1' },
      periodi: [
        { id: 'q1', months: ['01', '02', '03'], date: '05-16', yearOffset: 0, code: '6031', label: 'IVA 1° trim {anno}' },
      ],
    },
  ],
});

const broken = (mutate) => { const s = validScheme(); mutate(s); return validateScheme(s); };
const failsAt = (res, path) => {
  assert.equal(res.ok, false, 'lo schema doveva risultare invalido');
  assert.ok(res.errors.some(e => e.path === path),
    `nessun errore su ${path}: ${res.errors.map(e => e.path + ' ' + e.message).join('; ')}`);
};

test('uno schema valido passa', () => {
  const res = validateScheme(validScheme());
  assert.equal(res.ok, true, res.errors.map(e => e.path + ' ' + e.message).join('; '));
  assert.equal(res.errors.length, 0);
});

test('tributo duplicato', () => failsAt(broken(s => { s.tributi[1].id = 'irpef'; }), 'tributi[1].id'));
test('riga duplicata', () => failsAt(broken(s => { s.tributi[0].righe[1].id = 'acc1'; }), 'tributi[0].righe[1].id'));
test('kind sconosciuto', () => failsAt(broken(s => { s.tributi[0].kind = 'tassa'; }), 'tributi[0].kind'));
test('base sconosciuta', () => failsAt(broken(s => { s.tributi[0].base = 'irpefNetta'; }), 'tributi[0].base'));
test('ivaPeriodo con kind imposta', () => failsAt(broken(s => { s.tributi[1].kind = 'imposta'; }), 'tributi[1].base'));
test('kind iva con base irpef', () => failsAt(broken(s => { s.tributi[1].base = 'irpef'; }), 'tributi[1].base'));

test('data non MM-GG', () => {
  for (const bad of ['6-30', '13-01', '02-30', '02-29']) {
    failsAt(broken(s => { s.tributi[0].righe[0].date = bad; }), 'tributi[0].righe[0].date');
  }
});

test('yearOffset 2', () => failsAt(broken(s => { s.tributi[0].righe[2].yearOffset = 2; }), 'tributi[0].righe[2].yearOffset'));
test('code vuoto', () => failsAt(broken(s => { s.tributi[0].righe[0].code = ''; }), 'tributi[0].righe[0].code'));
test('share 101', () => failsAt(broken(s => { s.tributi[0].righe[0].share = 101; }), 'tributi[0].righe[0].share'));
test('share -1', () => failsAt(broken(s => { s.tributi[0].righe[0].share = -1; }), 'tributi[0].righe[0].share'));
test('acconto con metodo nessuno', () =>
  failsAt(broken(s => { s.tributi[0].acconti.metodo = 'nessuno'; }), 'tributi[0].righe[0].quota'));
test('due saldi', () =>
  failsAt(broken(s => { s.tributi[0].righe[1] = { ...s.tributi[0].righe[2], id: 'saldo2' }; }), 'tributi[0].righe[2].quota'));
test('mese IVA non valido', () => failsAt(broken(s => { s.tributi[1].periodi[0].months = ['01', '13']; }), 'tributi[1].periodi[0].months'));
test('mese in due periodi', () => failsAt(broken(s => {
  s.tributi[1].periodi.push({ id: 'q2', months: ['03', '04'], date: '08-20', yearOffset: 0, code: '6032', label: 'x' });
}), 'tributi[1].periodi[1].months'));
test('acconto IVA su periodo inesistente', () => failsAt(broken(s => { s.tributi[1].acconto.periodo = 'q9'; }), 'tributi[1].acconto.periodo'));
test('acconto IVA pct 120', () => failsAt(broken(s => { s.tributi[1].acconto.pct = 120; }), 'tributi[1].acconto.pct'));
test('soglia negativa', () => failsAt(broken(s => { s.tributi[0].acconti.soglia = -1; }), 'tributi[0].acconti.soglia'));
test('fallbackPrevYear negativo', () =>
  failsAt(broken(s => { s.tributi[0].acconti.fallbackPrevYear = -5; }), 'tributi[0].acconti.fallbackPrevYear'));

test('code vuoto ammesso per una cassa privata', () => {
  const s = validScheme();
  s.tributi.push({
    id: 'contributi', label: 'Contributi', kind: 'contributo', base: 'contribCassa', sezione: 'altri-enti',
    acconti: { metodo: 'storico', pct: 100, fallbackPrevYear: 0, soglia: 0 },
    righe: [{ id: 'saldo', quota: 'saldo', date: '06-30', yearOffset: 1, code: '', label: 'Saldo' }],
  });
  const res = validateScheme(s);
  assert.equal(res.ok, true, res.errors.map(e => e.path + ' ' + e.message).join('; '));
});

test('quote degli acconti che non sommano a 100: avviso, non errore', () => {
  const res = broken(s => { s.tributi[0].righe[1].share = 50; });
  assert.equal(res.ok, true);
  assert.equal(res.warnings[0].path, 'tributi[0].acconti');
});
