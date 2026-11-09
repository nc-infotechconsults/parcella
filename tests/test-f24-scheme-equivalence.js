// tests/test-f24-scheme-equivalence.js
//
// Il calendario nato dallo schema deve ridare le stesse date e gli stessi
// importi del generatore cablato che c'era prima (fotografato in
// tests/fixtures/f24-legacy.json), su tutte le righe che le Correzioni fiscali
// della spec non toccano. Le righe corrette hanno test propri, qui sotto.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');
const { SCENARIOS } = require('./helpers/f24-scenarios');
const LEGACY = require('./fixtures/f24-legacy.json');

const r = loadRenderer();
const near = (a, b, tol = 0.006) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const run = sc => r.computeTaxes([], [], sc.fiscal, sc.year, [], sc.studio, sc.invoices);

// Riga di prima → slot di adesso. Restano fuori, per nome, le righe che le
// Correzioni fiscali cambiano di proposito: il quarto trimestre IVA (ora al
// netto dell'acconto di dicembre), gli acconti IRPEF (ora senza addizionali),
// l'INPS eccedente e l'IRAP della ditta (ora sull'anno prima).
const MAP = {
  _q1: 'iva/q1', _q2: 'iva/q2', _q3: 'iva/q3',
  _cassa_acc1: 'contributi/acc1', _cassa_acc2: 'contributi/acc2', _cassa_saldo: 'contributi/saldo',
  _inps_f1: 'inpsFisso/r1', _inps_f2: 'inpsFisso/r2', _inps_f3: 'inpsFisso/r3', _inps_f4: 'inpsFisso/r4',
};
const EXCLUDED = /^_(q4|irpef_|inps_v|irap_)/;

for (const sc of SCENARIOS) {
  test(`stesse scadenze di prima: ${sc.name}`, () => {
    const tax = run(sc);
    const year = Number(sc.year);
    let checked = 0;
    for (const old of LEGACY[sc.name]) {
      if (EXCLUDED.test(old.id)) continue;
      assert.ok(MAP[old.id], `riga di prima senza corrispondenza: ${old.id}`);
      const slot = `${MAP[old.id]}/${year}`;
      const now = tax.f24All.find(f => f.slot === slot);
      assert.ok(now, `${sc.name}: manca ${slot} (era ${old.id})`);
      assert.equal(now.date, old.date, `${sc.name} ${slot} data`);
      near(now.amount, old.amount);
      checked++;
    }
    assert.ok(checked >= 3, `${sc.name}: confrontate solo ${checked} righe`);
  });
}

describe('correzione 3: IRAP e INPS eccedente della ditta sull\'anno prima', () => {
  const sc = SCENARIOS.find(s => s.name === 'ditta');
  const tax = run(sc);
  const fyPrev = r.computeFiscalYear({
    year: 2025, invoices: sc.invoices, activities: [], expenses: [], clients: [], fiscal: sc.fiscal,
    computeInvoiceAmounts: r.computeInvoiceAmounts,
  });
  const prev = r.taxLiability(fyPrev, sc.fiscal, 'ditta_individuale', 0);
  const row = slot => tax.f24All.find(f => f.slot === slot);

  test('acconti IRAP 40/60 dell\'IRAP 2025, saldo 3800 l\'anno dopo', () => {
    assert.ok(prev.irap > 0, 'lo scenario deve avere IRAP nel 2025');
    near(row('irap/acc1/2026').amount, Math.round(prev.irap * 0.4 * 100) / 100);
    assert.equal(row('irap/acc1/2026').code, '3812');
    near(row('irap/acc2/2026').amount, Math.round(prev.irap * 0.6 * 100) / 100);
    assert.equal(row('irap/acc2/2026').code, '3813');
    // Il 2026 vale meno del 2025: gli acconti superano l'imposta, il saldo è un credito.
    assert.equal(row('irap/saldo/2026'), undefined);
    assert.ok(tax.crediti.irap > 0);
  });

  test('INPS eccedente: metà del variabile 2025 al 30/06 e al 30/11, causale AP', () => {
    assert.ok(prev.contribVar > 0, 'lo scenario deve avere contributi eccedenti nel 2025');
    const half = Math.round(prev.contribVar * 0.5 * 100) / 100;
    assert.equal(row('inpsEccedente/acc1/2026').date, '2026-06-30');
    near(row('inpsEccedente/acc1/2026').amount, half);
    assert.equal(row('inpsEccedente/acc2/2026').date, '2026-11-30');
    near(row('inpsEccedente/acc2/2026').amount, half);
    assert.equal(row('inpsEccedente/acc1/2026').code, 'AP');
  });
});
