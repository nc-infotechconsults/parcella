// tests/test-fattura-classify.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFattura } = require('../src/main/fattura-parse');
const { classify, dedupKey, normalizeId } = require('../src/main/fattura-classify');
const fixtures = require('./fixtures');

const STUDIO = [fixtures.STUDIO.piva, fixtures.STUDIO.cf];
const load = name => parseFattura(fixtures.read(name))[0];

test('normalizeId strips punctuation, case and the IT prefix', () => {
  assert.equal(normalizeId('it 0123-4567890'), '01234567890');
  assert.equal(normalizeId('IT01234567890'), '01234567890');
  assert.equal(normalizeId('rssmra80a01h501u'), 'RSSMRA80A01H501U');
  assert.equal(normalizeId(null), '');
});

test('invoice issued by the studio is active', () => {
  const c = classify(load('attiva-td01-ritenuta-cassa.xml'), STUDIO);
  assert.equal(c.direction, 'active');
  assert.equal(c.reverseCharge, false);
  assert.equal(c.counterparty.name, 'CLIENTE ALFA S.R.L.');
});

test('invoice received by the studio is passive', () => {
  const c = classify(load('passiva-td01-multirate.xml'), STUDIO);
  assert.equal(c.direction, 'passive');
  assert.equal(c.counterparty.name, 'PARCHEGGI DI PROVA SRL');
});

test('TD18 is passive with reverseCharge even though the studio transmitted it', () => {
  const c = classify(load('autofattura-td18-signed.xml'), STUDIO);
  assert.equal(c.direction, 'passive');
  assert.equal(c.reverseCharge, true);
  assert.equal(c.counterparty.name, 'FORNITORE ESTERO LIMITED');
});

test('unknown TipoDocumento is routed to review instead of being guessed', () => {
  const doc = { ...load('passiva-td01-multirate.xml'), tipoDoc: 'TD99' };
  const c = classify(doc, STUDIO);
  assert.equal(c.needsReview, true);
  assert.match(c.reviewReason, /TD99/);
});

test('a document involving neither party is flagged for review', () => {
  const doc = load('passiva-td01-multirate.xml');
  const c = classify(doc, ['99999999999']);
  assert.equal(c.needsReview, true);
  assert.match(c.reviewReason, /nessuna delle parti/i);
});

test('a reverse-charge document belonging to nobody we know is still flagged', () => {
  const c = classify(load('autofattura-td18-signed.xml'), ['99999999999']);
  assert.equal(c.direction, 'passive');
  assert.equal(c.reverseCharge, true);
  assert.equal(c.needsReview, true);
  assert.match(c.reviewReason, /nessuna delle parti/i);
});

test('a document with the studio on both sides is flagged', () => {
  const doc = load('attiva-td01-ritenuta-cassa.xml');
  doc.cessionario = { ...doc.cessionario, vat: fixtures.STUDIO.piva, cf: fixtures.STUDIO.cf };
  const c = classify(doc, STUDIO);
  assert.equal(c.needsReview, true);
  assert.match(c.reviewReason, /sia cedente sia cessionario/i);
});

test('classify requires the studio identity', () => {
  assert.throws(() => classify(load('passiva-td01-multirate.xml'), []), /studioIds/);
});

test('the COPIA duplicate produces the same dedup key', () => {
  const a = dedupKey(load('autofattura-td18-signed.xml'));
  const b = dedupKey(load('COPIA_autofattura-td18-signed.xml'));
  assert.equal(a, b);
  assert.equal(a, 'IE1111111AA|TD18|28/AU|2026-08-24');
});
