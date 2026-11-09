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

test('an already-imported document is never materialized again, whatever the decision says', () => {
  // P1: the AdE export folder accumulates, so the normal monthly rescan
  // re-presents every past document. Re-committing one would reset settlement,
  // clientId, linkedMonthKey, notes and fiscal back to fresh proposals, which
  // drops settled revenue from the cash figures and re-opens the timesheet
  // forecast for that month. accept:true must not be enough.
  const m = buildManifest(base({
    files: [file('autofattura-td18-signed.xml')],
    existing: { dedupKeys: ['IE1111111AA|TD18|28/AU|2026-08-24'], hashes: [] },
  }));
  assert.equal(m.items[0].status, 'imported');

  const { records } = finalizeRecords({
    items: m.items,
    decisions: { [m.items[0].id]: { accept: true, settlement: { status: 'open', date: null } } },
    supplierRules: {},
  });
  assert.equal(records.length, 0);
});

test('an active invoice with no matching client is routed to review, not pre-accepted', () => {
  // coveredMonths in fiscal.js is keyed clientId|linkedMonthKey and skips a null
  // clientId, so an unlinked active invoice leaves the timesheet forecast for its
  // month standing next to it: the same work is counted twice. The client form
  // makes P.IVA optional, so proposeClient returning null is the normal case.
  const m = buildManifest(base({
    files: [file('attiva-td01-ritenuta-cassa.xml')],
    clients: [],
  }));
  const it = m.items[0];
  assert.equal(it.direction, 'active');
  assert.equal(it.proposal.clientId, null);
  assert.equal(it.needsReview, true);
  assert.match(it.reviewReason, /due volte i ricavi/);
  assert.equal(m.counts.daRivedere, 1);

  // With the client on file it stays a plain "nuova".
  const ok = buildManifest(base({ files: [file('attiva-td01-ritenuta-cassa.xml')] }));
  assert.equal(ok.items[0].needsReview, false);
  assert.equal(ok.items[0].reviewReason, null);
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

test('a credit note is never proposed as a cespite', () => {
  const xml = fixtures.read('passiva-td04-nota-credito.xml')
    .replace('Storno canone noleggio', 'Storno MacBook Pro notebook')
    .replace('<ImponibileImporto>65.58</ImponibileImporto>', '<ImponibileImporto>2400.00</ImponibileImporto>');
  const m = buildManifest(base({
    files: [{ sourcePath: '/tmp/nc.xml', name: 'nc.xml', buffer: Buffer.from(xml, 'utf-8') }],
  }));
  assert.equal(m.items[0].proposal.fiscal.category, 'Hardware');
  assert.equal(m.items[0].proposal.fiscal.amortize, false);   // a return is not an acquisition
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

// The whole-batch guard: an identity that matches nothing used to let every
// document fall through classify's "neither party" branch, which defaults to
// passive. A folder of issued invoices was then booked as costs, silently.
test('a batch that never involves the studio aborts instead of booking it all as passive', () => {
  assert.throws(() => buildManifest(base({
    files: [file('attiva-td01-ritenuta-cassa.xml'), file('passiva-td01-multirate.xml')],
    studioIds: ['P.IVA 09876543210', 'RNLMRC85A01F205X'],
  })), /studioMismatch/);
});

test('a batch with nothing readable in it reports skipped files, not an identity mismatch', () => {
  const m = buildManifest(base({
    files: [{ sourcePath: '/tmp/vuoto.xml', name: 'vuoto.xml', buffer: Buffer.from('non xml', 'utf-8') }],
  }));
  assert.equal(m.items.length, 0);
  assert.equal(m.skipped.length, 1);
});

// The archive round trip. The archiver copies the ORIGINAL container's bytes,
// but it used to name the copy after the UNWRAPPED document — src.fileName is
// the inner name, '.p7m' and the zip's own name stripped off. unwrap dispatches
// on the extension, so a CAdES container saved as '.xml' went straight to the
// XML parser: 22 of 81 archived documents could not be read back.
test('an archived container keeps the extension that makes it readable again', () => {
  const { unwrap } = require('../src/main/fattura-unwrap');
  const { archiveFileName } = require('../src/main/invoice-import');
  const { buildP7M, buildZip } = require('./helpers/containers');
  const xml = fixtures.read('attiva-td01-ritenuta-cassa.xml');

  const containers = [
    ['IT05165640755_0JILg.xml.p7m', buildP7M(xml)],
    ['fatture-ottobre.zip', buildZip([{ name: 'IT05165640755_0JILg.xml', data: Buffer.from(xml, 'utf-8') }])],
    ['IT05165640755_0JILg.xml', Buffer.from(xml, 'utf-8')],
  ];

  for (const [sourceName, bytes] of containers) {
    const [part] = unwrap(sourceName, bytes);
    const archived = archiveFileName(part.name, `/Users/x/Downloads/${sourceName}`);
    // What the archiver writes is the container's bytes under `archived`.
    const [again] = unwrap(archived, bytes);
    assert.equal(again.xml, part.xml, `${sourceName} archiviato come ${archived}`);
  }
});

test('archiveFileName names the copy after what is inside it, and still contains traversal', () => {
  const path = require('path');
  const { archiveFileName } = require('../src/main/invoice-import');
  // The inner document name identifies which invoice the copy was archived for;
  // the container extension says how to open it.
  assert.equal(archiveFileName('IT05165640755_0JILg.xml', '/d/IT05165640755_0JILg.xml.p7m'), 'IT05165640755_0JILg.xml.p7m');
  assert.equal(archiveFileName('IT05165640755_0JILg.xml', '/d/export-ottobre.zip'), 'IT05165640755_0JILg.xml.zip');
  assert.equal(archiveFileName('IT05165640755_0JILg.xml', '/d/IT05165640755_0JILg.xml'), 'IT05165640755_0JILg.xml');
  // A zip entry can carry a path of its own, and its name reaches this function.
  assert.equal(archiveFileName('sub/dir/fattura.xml', '/d/export.zip'), 'fattura.xml.zip');
  assert.equal(archiveFileName('../../../../etc/passwd', '/d/export.zip'), 'passwd.zip');
  for (const inner of ['../../../x.xml', '..\\..\\evil.xml', '', null]) {
    const dest = path.join('/archive', '2026', 'deadbeef_' + archiveFileName(inner, '/d/export.zip'));
    assert.ok(dest.startsWith(path.join('/archive', '2026') + path.sep), `uscita dall'archivio: ${inner}`);
  }
  // No source path to go by: the name must still be safe and unchanged.
  assert.equal(archiveFileName('IT05165640755_0JILg.xml', null), 'IT05165640755_0JILg.xml');
});
