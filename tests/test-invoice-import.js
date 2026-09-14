// tests/test-invoice-import.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildManifest, finalizeRecords } = require('../src/main/invoice-import');
const fixtures = require('./fixtures');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const STUDIO = [fixtures.STUDIO.piva, fixtures.STUDIO.cf];

const file = name => ({ sourcePath: `/tmp/${name}`, name, buffer: Buffer.from(fixtures.read(name), 'utf-8') });

const CLIENTS = [
  { id: 'c1', name: 'Cliente Alfa', piva: 'IT09876543210' },
  { id: 'c2', name: 'Altro Cliente', piva: 'IT11111111111' },
];

const base = (over = {}) => ({
  files: [], existing: { dedupKeys: [], hashes: [] }, clients: CLIENTS,
  supplierRules: {}, studioIds: STUDIO, ...over,
});

test('an active invoice proposes the matching client and its month', () => {
  const m = buildManifest(base({ files: [file('attiva-td01-ritenuta-cassa.xml')] }));
  assert.equal(m.items.length, 1);
  const it = m.items[0];
  assert.equal(it.direction, 'active');
  assert.equal(it.status, 'new');
  assert.equal(it.proposal.clientId, 'c1');
  assert.equal(it.proposal.linkedMonthKey, '2026-07');
  near(it.proposal.settlement.amount, 7612.80);
});

test('a passive invoice proposes a category from its lines', () => {
  const m = buildManifest(base({ files: [file('passiva-td01-multirate.xml')] }));
  const it = m.items[0];
  assert.equal(it.direction, 'passive');
  assert.equal(it.proposal.clientId, null);
  assert.equal(it.proposal.fiscal.category, 'Auto');       // "Totale soste"
  assert.equal(it.proposal.fiscal.deductPct, 20);
});

test('a remembered supplier rule wins over the keyword guess', () => {
  const m = buildManifest(base({
    files: [file('passiva-td01-multirate.xml')],
    supplierRules: { '05550001112': { category: 'Trasferta', deductPct: 100, vatDetractPct: 100, amortize: false } },
  }));
  assert.equal(m.items[0].proposal.fiscal.category, 'Trasferta');
  assert.equal(m.items[0].proposal.fiscal.deductPct, 100);
});

test('the same self-invoice in both exports collapses to one item', () => {
  const m = buildManifest(base({
    files: [file('autofattura-td18-signed.xml'), file('COPIA_autofattura-td18-signed.xml')],
  }));
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].direction, 'passive');
  assert.equal(m.items[0].reverseCharge, true);
  assert.equal(m.counts.duplicati, 1);
});

test('an already-imported document is marked, not re-proposed', () => {
  const m = buildManifest(base({
    files: [file('autofattura-td18-signed.xml')],
    existing: { dedupKeys: ['IE1111111AA|TD18|28/AU|2026-08-24'], hashes: [] },
  }));
  assert.equal(m.items[0].status, 'imported');
  assert.equal(m.counts.giaImportate, 1);
});

test('a cespite above the threshold is proposed with amortization', () => {
  const m = buildManifest(base({ files: [file('attiva-td01-ritenuta-cassa.xml')] }));
  // active invoices carry no fiscal proposal
  assert.equal(m.items[0].proposal.fiscal, null);

  const hw = buildManifest(base({
    files: [{
      sourcePath: '/tmp/hw.xml', name: 'hw.xml',
      buffer: Buffer.from(fixtures.read('passiva-td01-multirate.xml')
        .replace('Totale soste (IVA 22.00)', 'MacBook Pro 14 notebook')
        .replace('Canone abbonamento (IVA 22.00)', 'Alimentatore notebook')
        .replace('<ImponibileImporto>5.50</ImponibileImporto>', '<ImponibileImporto>2499.00</ImponibileImporto>'), 'utf-8'),
    }],
  }));
  assert.equal(hw.items[0].proposal.fiscal.category, 'Hardware');
  assert.equal(hw.items[0].proposal.fiscal.amortize, true);
  assert.equal(hw.items[0].proposal.fiscal.amortYears, 4);
  assert.equal(hw.items[0].proposal.fiscal.firstYearHalf, true);
});

test('unreadable files are skipped with a reason, not fatal', () => {
  const m = buildManifest(base({
    files: [
      { sourcePath: '/tmp/bad.xml', name: 'bad.xml', buffer: Buffer.from('<?xml version="1.0"?><nope/>', 'utf-8') },
      file('passiva-td04-nota-credito.xml'),
    ],
  }));
  assert.equal(m.skipped.length, 1);
  assert.equal(m.skipped[0].file, 'bad.xml');
  assert.match(m.skipped[0].reason, /FatturaElettronica/);
  assert.equal(m.items.length, 1);
});

test('finalizeRecords builds records only for accepted items and remembers suppliers', () => {
  const m = buildManifest(base({ files: [file('passiva-td01-multirate.xml'), file('passiva-td04-nota-credito.xml')] }));
  const [a, b] = m.items;
  const { records, supplierRules } = finalizeRecords({
    items: m.items,
    decisions: {
      [a.id]: { accept: true, fiscal: { category: 'Utenze', deductPct: 100, vatDetractPct: 100, amortize: false }, rememberSupplier: true },
      [b.id]: { accept: false },
    },
    supplierRules: {},
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].fiscal.category, 'Utenze');
  assert.equal(records[0].direction, 'passive');
  assert.equal(records[0].reviewedAt > 0, true);
  assert.equal(records[0].settlement.status, 'open');
  assert.equal(supplierRules['05550001112'].category, 'Utenze');
});

test('a TD04 record keeps sign -1 so it subtracts downstream', () => {
  const m = buildManifest(base({ files: [file('passiva-td04-nota-credito.xml')] }));
  const { records } = finalizeRecords({
    items: m.items,
    decisions: { [m.items[0].id]: { accept: true } },
    supplierRules: {},
  });
  assert.equal(records[0].sign, -1);
  assert.equal(records[0].tipoDoc, 'TD04');
});

test('category inference handles Italian inflections without over-matching', () => {
  const { guessCategory } = require('../src/shared/categories');
  const expected = [
    ['Canone abbonamento mensile', 'Software'], ['Licenza software annuale', 'Software'],
    ['Servizio di telefonia mobile', 'Telefonia'], ['Fornitura energia elettrica', 'Utenze'],
    ['Utenze idriche', 'Utenze'], ['Commissioni bancarie trimestrali', 'Commissioni bancarie'],
    ['Consulenza fiscale', 'Consulenze'], ['Carburante per autovettura', 'Auto'],
    ['Pedaggio autostradale', 'Auto'], ['Parcheggio aeroporto', 'Auto'],
    ['Sostituzione pneumatici', 'Auto'], ['Totale soste (IVA 22.00)', 'Auto'],
    ['Pernottamento hotel Roma', 'Pernottamento'], ['Cena di lavoro ristorante', 'Pasti'],
    ['Trasferta Milano', 'Trasferta'], ['Cancelleria varia', 'Cancelleria'],
    ['Assicurazione RC professionale', 'Assicurazioni'], ['MacBook Pro 14 notebook', 'Hardware'],
    ['Corso di formazione cloud', 'Formazione'], ['Marca da bollo', 'Bolli/Tasse'],
  ];
  for (const [desc, want] of expected) assert.equal(guessCategory(desc), want, desc);

  // Near-misses: these must NOT be captured by the stem they resemble, because
  // each would propose a wrong deducibilita on a real document.
  const forbidden = [
    ["Ritenuta sostituto d'imposta", 'Auto'], ['Servizio di monitoraggio infrastruttura', 'Hardware'],
    ['Simulazione finanziaria', 'Telefonia'], ['Attivita di volontariato aziendale', 'Trasferta'],
    ['Prodotti gastronomici', 'Utenze'], ['Mastercard commissioni', 'Formazione'],
  ];
  for (const [desc, wrong] of forbidden) assert.notEqual(guessCategory(desc), wrong, desc);
});

test('proposals match how the user\'s real invoices actually read', () => {
  const { guessCategory } = require('../src/shared/categories');
  // Line text taken verbatim from real Agenzia delle Entrate exports.
  assert.equal(guessCategory('MENU A PREZZO FISSO Tavolo: 93'), 'Pasti');          // 75%, not 100%
  assert.equal(guessCategory('acqua santo stefano 1\\2 lt x 24 bt pet'), 'Altro'); // a drink, not a water bill
  assert.equal(guessCategory('Virtual Machines Bsv2 Series'), 'Altro');            // no signal in the line...
  assert.equal(guessCategory('Microsoft Srl'), 'Software');                        // ...but the supplier has one
  assert.equal(guessCategory('INTEGRAZIONE FATTURA N. 9BF DEL 21/08/2026'), 'Altro');
  assert.equal(guessCategory('GITHUB INC'), 'Software');
});

test('safeArchiveName contains every path-traversal attempt', () => {
  const path = require('path');
  const { safeArchiveName } = require('../src/main/invoice-import');
  const dir = path.join('/archive', '2026');
  const attacks = [
    '../../../../../../Users/x/.zshrc',
    '..\\..\\..\\Windows\\System32\\evil.xml',
    'sub/dir/fattura.xml',
    '....//....//etc/passwd',
    '',
    null,
  ];
  for (const a of attacks) {
    const dest = path.join(dir, 'deadbeef_' + safeArchiveName(a));
    assert.ok(dest.startsWith(dir + path.sep), `escaped the archive dir: ${a}`);
  }
  // Containment alone cannot police the backslash normalization: on POSIX a
  // backslash payload never traverses anyway, so the assertion above passes
  // with or without the guard. Assert the OUTPUT, which differs — without the
  // normalization basename returns the whole string, since it splits only on
  // '/'. This is what fails if a future edit drops the .replace().
  assert.equal(safeArchiveName('..\\..\\..\\Windows\\System32\\evil.xml'), 'evil.xml');

  // Real Agenzia delle Entrate filenames must survive untouched.
  assert.equal(safeArchiveName('IT04204200135_0JILg.xml'), 'IT04204200135_0JILg.xml');
  assert.equal(safeArchiveName('COPIA_IT04204200135_0KDbm.xml'), 'COPIA_IT04204200135_0KDbm.xml');
});

test('archiveYear falls back rather than naming a folder from undefined', () => {
  const { archiveYear } = require('../src/main/invoice-import');
  assert.equal(archiveYear('2026-08-31'), '2026');
  assert.equal(archiveYear(undefined), 'senza-data');
  assert.equal(archiveYear(''), 'senza-data');
  assert.equal(archiveYear('not-a-date'), 'senza-data');
});

test('buildManifest refuses to run without the studio identity', () => {
  assert.throws(() => buildManifest(base({ files: [file('passiva-td04-nota-credito.xml')], studioIds: [] })), /studioIds/);
});
