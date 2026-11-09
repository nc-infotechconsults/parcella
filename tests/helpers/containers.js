// Minimal DER/BER/ZIP builders, shared by the unwrap and import tests: they
// keep binary blobs out of the repository while still exercising the real
// containers the Agenzia delle Entrate hands out.
const zlib = require('zlib');

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

// A real Agenzia delle Entrate .p7m opens `30 80` — BER indefinite length — and
// carries its eContent as a CONSTRUCTED OCTET STRING split into 1000-byte
// chunks. Definite-length DER with one primitive OCTET STRING, which buildP7M
// emits, never exercises either path.
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

module.exports = { der, derLen, buildP7M, buildBerP7M, buildZip };
