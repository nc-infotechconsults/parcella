// tests/helpers/capture-legacy-f24.js
//
// Fotografa il calendario F24 del generatore cablato in computeTaxes, PRIMA che
// lo scadenzario lo sostituisca. Si lancia una volta sola, a mano:
//   node tests/helpers/capture-legacy-f24.js
// e la fixture che scrive diventa il riferimento del test di equivalenza.
// Rilanciarlo dopo il Task 7 fotograferebbe il generatore nuovo: non farlo.
const fs = require('fs');
const path = require('path');
const { loadRenderer } = require('./load-renderer');
const { SCENARIOS } = require('./f24-scenarios');

const r = loadRenderer();
const out = {};
for (const s of SCENARIOS) {
  const tax = r.computeTaxes([], [], s.fiscal, s.year, [], s.studio, s.invoices);
  out[s.name] = tax.f24All
    .filter(f => f._generated)
    .map(f => ({ id: String(f.id), date: String(f.date), code: String(f.code), amount: Number(f.amount) }));
}
const dest = path.join(__dirname, '..', 'fixtures', 'f24-legacy.json');
fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
console.log('scritta', dest);
