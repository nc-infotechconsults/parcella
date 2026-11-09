// tests/test-fattura-unwrap.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildP7M, buildBerP7M, buildZip } = require('./helpers/containers');
const { unwrap, extractP7M, readZip } = require('../src/main/fattura-unwrap');
const fixtures = require('./fixtures');

// ── Tests ──────────────────────────────────────────────────────────────

test('plain .xml passes through unchanged', () => {
  const xml = fixtures.read('passiva-td01-multirate.xml');
  const out = unwrap('fattura.xml', Buffer.from(xml, 'utf-8'));
  assert.equal(out.length, 1);
  assert.equal(out[0].xml, xml);
  assert.equal(out[0].name, 'fattura.xml');
});

test('extracts the XML payload from a DER .p7m', () => {
  const xml = fixtures.read('autofattura-td18-signed.xml');
  assert.equal(extractP7M(buildP7M(xml)), xml);
});

test('extracts the XML payload from a base64-wrapped .p7m', () => {
  const xml = fixtures.read('passiva-td04-nota-credito.xml');
  const b64 = Buffer.from(buildP7M(xml).toString('base64'), 'utf-8');
  assert.equal(extractP7M(b64), xml);
});

test('unwrap dispatches on the .xml.p7m extension', () => {
  const xml = fixtures.read('passiva-td04-nota-credito.xml');
  const out = unwrap('IT01234567890_ABCDE.xml.p7m', buildP7M(xml));
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'IT01234567890_ABCDE.xml');
  assert.match(out[0].xml, /TD04/);
});

test('reads every XML entry out of a zip, ignoring other files', () => {
  const a = fixtures.read('attiva-td01-ritenuta-cassa.xml');
  const b = fixtures.read('passiva-td04-nota-credito.xml');
  const zip = buildZip([
    { name: 'a.xml', data: Buffer.from(a, 'utf-8') },
    { name: 'note.txt', data: Buffer.from('non una fattura', 'utf-8') },
    { name: 'sub/b.xml', data: Buffer.from(b, 'utf-8') },
  ]);
  assert.equal(readZip(zip).length, 3);
  const out = unwrap('export.zip', zip);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(o => o.name).sort(), ['a.xml', 'sub/b.xml']);
});

test('extracts the payload from a BER indefinite-length p7m', () => {
  const xml = fixtures.read('autofattura-td18-signed.xml');
  assert.equal(extractP7M(buildBerP7M(xml, 1000)), xml);
});

test('reassembles an eContent split across OCTET STRING chunks', () => {
  const xml = fixtures.read('passiva-td01-multirate.xml');
  // small chunks so the payload is split many times over
  assert.equal(extractP7M(buildBerP7M(xml, 64)), xml);
  assert.equal(extractP7M(buildBerP7M(xml, 7)), xml);
});

test('rejects a p7m with no XML content', () => {
  assert.throws(() => extractP7M(Buffer.from([0x30, 0x03, 0x02, 0x01, 0x01])), /XML non trovato/);
});

test('rejects a malformed zip', () => {
  assert.throws(() => readZip(Buffer.from('not a zip at all', 'utf-8')), /ZIP non valido/);
});

test('a structurally valid zip with a corrupt local-header offset is rejected', () => {
  // The dangerous case: EOCD and central directory both look right, so the
  // reader gets far enough to dereference an offset that points nowhere.
  const zip = buildZip([{ name: 'a.xml', data: Buffer.from('<?xml version="1.0"?><x/>', 'utf-8') }]);
  const eocd = zip.length - 22;
  const cdStart = zip.readUInt32LE(eocd + 16);
  zip.writeUInt32LE(0xfffffff0, cdStart + 42);
  assert.throws(() => readZip(zip), /ZIP non valido/);
});

test('a leading BOM is normalized away whatever the container', () => {
  const xml = '﻿' + fixtures.read('passiva-td04-nota-credito.xml');
  const plain = unwrap('a.xml', Buffer.from(xml, 'utf-8'))[0].xml;
  const signed = unwrap('a.xml.p7m', buildP7M(xml))[0].xml;
  assert.equal(plain.charCodeAt(0), 0x3c);   // '<', not U+FEFF
  assert.equal(plain, signed);               // identical bytes => identical dedup hash
});
