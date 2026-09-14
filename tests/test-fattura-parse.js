// tests/test-fattura-parse.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFattura } = require('../src/main/fattura-parse');
const fixtures = require('./fixtures');

test('parses a TD01 with ritenuta and cassa', () => {
  const [doc] = parseFattura(fixtures.read('attiva-td01-ritenuta-cassa.xml'));
  assert.equal(doc.tipoDoc, 'TD01');
  assert.equal(doc.number, '16/PRV/26');      // stays a string, never a number
  assert.equal(doc.date, '2026-07-31');
  assert.equal(doc.monthKey, '2026-07');
  assert.equal(doc.sign, 1);
  assert.equal(doc.cedente.vat, '01234567890');
  assert.equal(doc.cessionario.name, 'CLIENTE ALFA S.R.L.');
  assert.equal(doc.totals.imponibile, 6240);
  assert.equal(doc.totals.imposta, 1372.80);
  assert.equal(doc.totals.documento, 7612.80);
  assert.equal(doc.withholding.importo, 1248);
  assert.equal(doc.withholding.aliquota, 20);
  assert.equal(doc.cassa.importo, 240);
  assert.equal(doc.cassa.imponibile, 6000);
  assert.equal(doc.payment.dueDate, '2026-08-30');
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].total, 6000);
});

test('keeps one vatSummary entry per rate', () => {
  const [doc] = parseFattura(fixtures.read('passiva-td01-multirate.xml'));
  assert.equal(doc.vatSummary.length, 2);
  const fuoriCampo = doc.vatSummary.find(v => v.natura === 'N2.2');
  const ordinaria = doc.vatSummary.find(v => v.vatPct === 22);
  assert.equal(fuoriCampo.imponibile, 1.91);
  assert.equal(fuoriCampo.imposta, 0);
  assert.equal(ordinaria.imposta, 1.21);
  assert.equal(doc.totals.imponibile, 7.41);
  assert.equal(doc.totals.imposta, 1.21);
});

test('ignores the ds:Signature subtree of a signed document', () => {
  const [doc] = parseFattura(fixtures.read('autofattura-td18-signed.xml'));
  assert.equal(doc.tipoDoc, 'TD18');
  assert.equal(doc.cedente.name, 'FORNITORE ESTERO LIMITED');
  assert.equal(doc.totals.imposta, 39.60);
  assert.equal(doc.lines.length, 1);
  assert.equal(doc.lines[0].qty, null);   // no Quantita in the XML
});

test('TD04 credit note gets sign -1', () => {
  const [doc] = parseFattura(fixtures.read('passiva-td04-nota-credito.xml'));
  assert.equal(doc.tipoDoc, 'TD04');
  assert.equal(doc.sign, -1);
});

test('rejects non-FatturaElettronica XML', () => {
  assert.throws(() => parseFattura('<?xml version="1.0"?><root/>'), /FatturaElettronica/);
});
