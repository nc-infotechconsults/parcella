// tests/test-fattura-unwrap.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('zlib');
const { unwrap, extractP7M, readZip } = require('../src/main/fattura-unwrap');
const fixtures = require('./fixtures');

// ── Minimal DER/ZIP builders: keep binary blobs out of the repository ──

function derLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  let v = n;
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8; }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

function der(tag, payload) {
  return Buffer.concat([Buffer.from([tag]), derLen(payload.length), payload]);
}

// ContentInfo { OID signedData, [0] { SignedData { ..., encapContentInfo {
//   OID data, [0] { OCTET STRING xml } } } } } — only the parts we walk.
function buildP7M(xml) {
  const oidData = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
  const content = der(0x04, Buffer.from(xml, 'utf-8'));
  const encap = der(0x30, Buffer.concat([oidData, der(0xa0, content)]));
  const oidSigned = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  const signedData = der(0x30, Buffer.concat([der(0x02, Buffer.from([0x01])), der(0x31, Buffer.alloc(0)), encap]));
  return der(0x30, Buffer.concat([oidSigned, der(0xa0, signedData)]));
}

function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf-8');
    const deflated = zlib.deflateRawSync(data);
    const crc = zlib.crc32 ? zlib.crc32(data) : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);              // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, deflated);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(deflated.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([Buffer.concat(locals), centralBuf, eocd]);
}

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

// A real Agenzia delle Entrate .p7m opens `30 80` — BER indefinite length — and
// carries its eContent as a CONSTRUCTED OCTET STRING split into 1000-byte
// chunks. Definite-length DER with one primitive OCTET STRING, which the other
// builder emits, never exercises either path.
function buildBerP7M(xml, chunkSize) {
  const eoc = Buffer.from([0x00, 0x00]);
  const indef = (tag, payload) => Buffer.concat([Buffer.from([tag, 0x80]), payload, eoc]);
  const body = Buffer.from(xml, 'utf-8');
  const chunks = [];
  for (let i = 0; i < body.length; i += chunkSize) {
    chunks.push(der(0x04, body.subarray(i, i + chunkSize)));
  }
  const content = indef(0x24, Buffer.concat(chunks));          // constructed OCTET STRING
  const oidData = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x01]);
  const encap = indef(0x30, Buffer.concat([oidData, indef(0xa0, content)]));
  const oidSigned = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x07, 0x02]);
  const signedData = indef(0x30, Buffer.concat([der(0x02, Buffer.from([0x01])), der(0x31, Buffer.alloc(13)), encap]));
  return indef(0x30, Buffer.concat([oidSigned, indef(0xa0, signedData)]));
}

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
