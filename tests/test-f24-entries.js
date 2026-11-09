// tests/test-f24-entries.js
//
// Le voci F24 registrate a mano sono l'unico canale con cui un versamento vero
// entra nei calcoli: contributiPagatiIn() somma le righe con codice 3801/0601
// marcate "paid", e il merge del calendario lascia cadere la stima per quella
// scadenza. Finché non c'è un'interfaccia che le scrive, quel canale è chiuso —
// e una riga scritta male (data storta, importo testuale, id che imita quelli
// generati) sarebbe peggio di nessuna riga, perché sparirebbe dai calcoli senza
// dirlo. Queste funzioni sono il punto in cui quella correttezza si difende.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { upsertF24Entry, removeF24Entry } = require('../src/renderer/fiscal');

const entry = (over = {}) => ({
  date: '2026-06-30', code: '3801', desc: '1° acconto INPS 2026', amount: 6500, status: 'paid', ...over,
});

test('una voce nuova entra nello storico con un id proprio', () => {
  const out = upsertF24Entry([], entry());
  assert.equal(out.length, 1);
  assert.equal(out[0].amount, 6500);
  assert.equal(out[0].status, 'paid');
  assert.ok(out[0].id, 'senza id la voce non è più modificabile né cancellabile');
});

test("l'id di una voce manuale non imita quelli generati", () => {
  // Il merge distingue stima e fatto per data+codice, ma markPaid e il filtro
  // di cancellazione lavorano per id: un id che comincia con "_" verrebbe
  // trattato come voce calcolata e riscritto al prossimo ricalcolo.
  const out = upsertF24Entry([], entry({ id: '_cassa_acc1' }));
  assert.ok(!String(out[0].id).startsWith('_'), `id generato: ${out[0].id}`);
  assert.notEqual(out[0]._generated, true);
});

test('la stessa scadenza non si duplica: una data e un codice, una riga', () => {
  // Due righe sullo stesso 2026-06-30|3801 verrebbero sommate due volte nella
  // deduzione per cassa.
  let h = upsertF24Entry([], entry());
  h = upsertF24Entry(h, entry({ amount: 6800 }));
  assert.equal(h.length, 1);
  assert.equal(h[0].amount, 6800);
});

test('modificare una voce per id ne conserva l\'identità', () => {
  const h = upsertF24Entry([{ id: 'f1', date: '2026-02-16', code: '6031', desc: 'IVA', amount: 3120, status: 'paid' }],
    { id: 'f1', date: '2026-02-16', code: '6031', desc: 'IVA 4° trim 2025', amount: 3200, status: 'paid' });
  assert.equal(h.length, 1);
  assert.equal(h[0].id, 'f1');
  assert.equal(h[0].amount, 3200);
});

test('le voci restano in ordine di data', () => {
  let h = upsertF24Entry([], entry({ date: '2026-11-30', desc: '2° acconto' }));
  h = upsertF24Entry(h, entry({ date: '2026-06-30', desc: '1° acconto' }));
  assert.deepEqual(h.map(f => f.date), ['2026-06-30', '2026-11-30']);
});

test('una voce che i calcoli non saprebbero leggere viene rifiutata', () => {
  // contributiPagatiIn fa date.startsWith(anno + '-') e somma Number(amount):
  // una data in formato italiano o un importo testuale non sommano e non
  // filtrano, spariscono in silenzio.
  assert.throws(() => upsertF24Entry([], entry({ date: '30/06/2026' })), /data/i);
  assert.throws(() => upsertF24Entry([], entry({ date: '' })), /data/i);
  assert.throws(() => upsertF24Entry([], entry({ amount: 'seimilacinquecento' })), /importo/i);
  assert.throws(() => upsertF24Entry([], entry({ amount: -10 })), /importo/i);
  assert.throws(() => upsertF24Entry([], entry({ code: '' })), /codice/i);
});

test('uno stato sconosciuto diventa "programmato", non un versamento', () => {
  // Dedurre per cassa qualcosa che non risulta pagato è l'errore che costa.
  const out = upsertF24Entry([], entry({ status: 'boh' }));
  assert.equal(out[0].status, 'scheduled');
});

test('una voce si cancella senza toccare le altre', () => {
  let h = upsertF24Entry([], entry());
  h = upsertF24Entry(h, entry({ date: '2026-11-30' }));
  const after = removeF24Entry(h, h[0].id);
  assert.equal(after.length, 1);
  assert.equal(after[0].date, '2026-11-30');
  // Un id inesistente non deve svuotare né alterare lo storico.
  assert.equal(removeF24Entry(after, 'inesistente').length, 1);
});

test('lo storico di partenza non viene modificato', () => {
  const h = [];
  upsertF24Entry(h, entry());
  assert.equal(h.length, 0, 'React confronta per riferimento: mutare in place non ridisegna');
});

test('spostare una voce di data non le fa condividere l\'id con una nuova', () => {
  // L'id si conia da data e codice, ma la data è modificabile: la voce se ne
  // porta dietro l'id vecchio, e una voce nuova su quella data e quel codice
  // ne conierebbe uno identico. Da lì cancellarne una le toglie entrambe, e
  // il pulsante Modifica aprirebbe la riga sbagliata.
  let h = upsertF24Entry([], entry({ date: '2026-06-30', code: '3801', amount: 6800 }));
  const primo = h[0].id;
  h = upsertF24Entry(h, { ...h[0], date: '2026-12-30' });      // spostata a dicembre
  h = upsertF24Entry(h, entry({ date: '2026-06-30', code: '3801', amount: 6500 }));
  assert.equal(h.length, 2);
  assert.notEqual(h[0].id, h[1].id);
  assert.equal(removeF24Entry(h, primo).length, 1, 'la cancellazione ne ha tolte due');
});

// ── Scadenzario: tributo, slot, anno di competenza ──────────────────────────
// Lo slot collega la riga alla scadenza dello schema anche se la data cambia;
// il tributo decide cosa la riga alimenta (la deduzione dei contributi); l'anno
// dice di quale anno fiscale è un versamento fuori programma.
test('tributo, slot e anno sopravvivono a inserimento e modifica', () => {
  let h = upsertF24Entry([], entry({ tributo: 'contributi', slot: 'contributi/acc1/2026', anno: 2026 }));
  assert.equal(h[0].tributo, 'contributi');
  assert.equal(h[0].slot, 'contributi/acc1/2026');
  assert.equal(h[0].anno, 2026);
  h = upsertF24Entry(h, { ...h[0], amount: 6500 });
  assert.equal(h.length, 1);
  assert.equal(h[0].slot, 'contributi/acc1/2026');
  assert.equal(h[0].amount, 6500);
});

test('un anno di competenza non valido viene rifiutato', () => {
  assert.throws(() => upsertF24Entry([], entry({ anno: '26' })), /anno/);
  assert.equal(upsertF24Entry([], entry({ anno: '2025' }))[0].anno, 2025);
});

test('due righe con lo stesso slot non coesistono', () => {
  let h = upsertF24Entry([], entry({ slot: 'irpef/acc1/2026', tributo: 'irpef', date: '2026-06-30', code: '4033' }));
  // Stesso slot, data diversa e senza id: è la stessa scadenza, non una nuova.
  h = upsertF24Entry(h, entry({ slot: 'irpef/acc1/2026', tributo: 'irpef', date: '2026-07-15', code: '4033', amount: 900 }));
  assert.equal(h.length, 1);
  assert.equal(h[0].date, '2026-07-15');
  assert.equal(h[0].amount, 900);
});
