// Unwraps the containers the Agenzia delle Entrate hands out: plain .xml,
// CAdES-signed .xml.p7m, and .zip bundles. Implemented on Node built-ins so
// no native or third-party archive dependency enters the packaging pipeline.
const zlib = require('zlib');

// ── .p7m ────────────────────────────────────────────────────────────────
// A FatturaPA p7m is a CMS SignedData whose eContent is the XML. We walk the
// DER looking for the payload rather than verifying the signature: validity
// is the SDI's job, ours is only to read what was filed.

function readTLV(buf, pos) {
  if (pos + 2 > buf.length) return null;
  const tag = buf[pos];
  let lenByte = buf[pos + 1];
  let headerLen = 2;
  let len;
  if (lenByte & 0x80) {
    const count = lenByte & 0x7f;
    if (count === 0 || pos + 2 + count > buf.length) return null;  // indefinite/invalid
    len = 0;
    for (let i = 0; i < count; i++) len = (len << 8) | buf[pos + 2 + i];
    headerLen = 2 + count;
  } else {
    len = lenByte;
  }
  const start = pos + headerLen;
  if (start + len > buf.length) return null;
  return { tag, start, len, end: start + len };
}

const XML_HEAD = Buffer.from('<?xml', 'utf-8');

function findXmlInDER(buf, depth = 0) {
  if (depth > 12) return null;
  let pos = 0;
  while (pos < buf.length) {
    const tlv = readTLV(buf, pos);
    if (!tlv) return null;
    const body = buf.subarray(tlv.start, tlv.end);
    const constructed = (tlv.tag & 0x20) !== 0;
    if (tlv.tag === 0x04 && body.indexOf(XML_HEAD) !== -1) {
      return body.subarray(body.indexOf(XML_HEAD)).toString('utf-8');
    }
    if (constructed) {
      const found = findXmlInDER(body, depth + 1);
      if (found) return found;
    }
    pos = tlv.end;
  }
  return null;
}

function extractP7M(buffer) {
  let buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  // Some exports ship the CMS base64-encoded (optionally PEM-armoured).
  if (buf[0] !== 0x30) {
    const text = buf.toString('utf-8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
    if (/^[A-Za-z0-9+/=]+$/.test(text) && text.length > 32) {
      buf = Buffer.from(text, 'base64');
    }
  }
  const xml = findXmlInDER(buf);
  // findXmlInDER already returns exactly the DER-delimited OCTET STRING payload
  // starting at '<?xml' — no further trimming. Cutting at the last '>' would
  // drop a trailing newline that is genuine file content, and Task 6 hashes
  // this string as a dedup guard: the same document arriving once as .xml and
  // once as .xml.p7m must hash identically.
  if (xml) return xml;
  throw new Error('Contenuto XML non trovato nel file .p7m');
}

// ── .zip ────────────────────────────────────────────────────────────────

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;

function readZip(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Archivio ZIP non valido');

  const count = buf.readUInt16LE(eocd + 10);
  let pos = buf.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < count; i++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== CEN_SIG) throw new Error('Archivio ZIP non valido');
    const method = buf.readUInt16LE(pos + 10);
    const compSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString('utf-8');

    // localOffset and compSize come from the archive itself: untrusted. Without
    // these guards a corrupt offset reaches readUInt16LE as a raw RangeError and
    // a corrupt size reaches zlib, so the caller sees a Node internal message
    // instead of the archive error this module promises.
    if (localOffset + 30 > buf.length) throw new Error('Archivio ZIP non valido');
    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    if (dataStart + compSize > buf.length) throw new Error('Archivio ZIP non valido');
    const raw = buf.subarray(dataStart, dataStart + compSize);

    if (!name.endsWith('/')) {
      entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : raw });
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

// ── Dispatch ────────────────────────────────────────────────────────────

const isXmlName = n => /\.xml$/i.test(n);

// Normalize here, at the one place every container converges: a BOM breaks the
// XML parser, and leaving it on only the plain-.xml path would make the same
// document hash two different ways depending on how it arrived.
const stripBOM = s => (s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);

function unwrap(fileName, buffer) {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith('.p7m')) {
    return [{ name: fileName.replace(/\.p7m$/i, ''), xml: stripBOM(extractP7M(buffer)) }];
  }
  if (lower.endsWith('.zip')) {
    return readZip(buffer)
      .filter(e => isXmlName(e.name) || /\.xml\.p7m$/i.test(e.name))
      .map(e => (/\.p7m$/i.test(e.name)
        ? { name: e.name.replace(/\.p7m$/i, ''), xml: stripBOM(extractP7M(e.data)) }
        : { name: e.name, xml: stripBOM(e.data.toString('utf-8')) }));
  }
  return [{ name: fileName, xml: stripBOM(Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer)) }];
}

module.exports = { unwrap, extractP7M, readZip };
