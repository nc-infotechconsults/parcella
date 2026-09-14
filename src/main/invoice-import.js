// Import orchestration. buildManifest/finalizeRecords are pure so the whole
// proposal logic is testable without touching the filesystem; only
// collectFiles reads from disk.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { parseFattura } = require('./fattura-parse');
const { classify, dedupKey, normalizeId } = require('./fattura-classify');
const { unwrap } = require('./fattura-unwrap');
const { CATEGORY_RULES, AMORTIZE_THRESHOLD, guessCategory } = require('../shared/categories');

const ACCEPTED = /\.(xml|p7m|zip)$/i;
const DEFAULT_AMORT_YEARS = 4;

function collectFiles(paths) {
  const out = [];
  const visit = p => {
    const stat = fs.statSync(p);
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
    } else if (ACCEPTED.test(p)) {
      out.push({ sourcePath: p, name: path.basename(p), buffer: fs.readFileSync(p) });
    }
  };
  for (const p of paths || []) visit(p);
  return out;
}

const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

function proposeClient(counterparty, clients) {
  const ids = [normalizeId(counterparty.vat), normalizeId(counterparty.cf)].filter(Boolean);
  const match = (clients || []).find(c => {
    const cid = [normalizeId(c.piva), normalizeId(c.cf)].filter(Boolean);
    return cid.some(x => ids.includes(x));
  });
  return match || null;
}

function proposeFiscal(doc, counterparty, supplierRules) {
  const supplierKey = normalizeId(counterparty.vat) || normalizeId(counterparty.cf);
  const remembered = (supplierRules || {})[supplierKey];
  if (remembered) {
    return {
      category: remembered.category,
      deductPct: remembered.deductPct,
      vatDetractPct: remembered.vatDetractPct != null ? remembered.vatDetractPct : 100,
      amortize: !!remembered.amortize,
      amortYears: remembered.amortYears || DEFAULT_AMORT_YEARS,
      firstYearHalf: remembered.firstYearHalf !== false,
    };
  }
  // Lines first: a description is direct evidence of what was bought, and it
  // keeps the guess independent of a supplier's trade name. The name is a
  // fallback only, for documents whose lines carry no signal by construction —
  // a reverse-charge integration reads "INTEGRAZIONE FATTURA N. x DEL y", where
  // the supplier is the only evidence there is.
  const text = [doc.causale, ...doc.lines.map(l => l.desc)].join(' ');
  const fromLines = guessCategory(text);
  const category = fromLines !== 'Altro' ? fromLines : guessCategory(counterparty.name || '');
  const rule = CATEGORY_RULES[category] || CATEGORY_RULES.Altro;
  // A credit note is never a cespite, so never propose one: otherwise the review
  // panel renders "Ammortizza" pre-checked on a return and invites the user to
  // confirm a treatment every consumer then has to neutralise.
  const amortize = (doc.sign || 1) > 0
    && doc.totals.imponibile >= AMORTIZE_THRESHOLD && category === 'Hardware';
  return {
    category,
    deductPct: rule.deductPct,
    vatDetractPct: 100,
    amortize,
    amortYears: amortize ? DEFAULT_AMORT_YEARS : null,
    firstYearHalf: amortize ? true : false,
  };
}

function buildManifest({ files, existing, clients, supplierRules, studioIds }) {
  const seenKeys = new Set();
  const importedKeys = new Set((existing && existing.dedupKeys) || []);
  const importedHashes = new Set((existing && existing.hashes) || []);
  const items = [];
  const skipped = [];
  let duplicati = 0;

  for (const f of files || []) {
    let unwrapped;
    try {
      unwrapped = unwrap(f.name, f.buffer);
    } catch (err) {
      skipped.push({ file: f.name, reason: err.message });
      continue;
    }

    for (const part of unwrapped) {
      let docs;
      try {
        docs = parseFattura(part.xml);
      } catch (err) {
        skipped.push({ file: part.name || f.name, reason: err.message });
        continue;
      }

      const hash = sha256(Buffer.from(part.xml, 'utf-8'));

      for (const doc of docs) {
        let cls;
        try {
          cls = classify(doc, studioIds);
        } catch (err) {
          if (/studioIds/.test(err.message)) throw err;   // configuration error: abort the batch
          skipped.push({ file: part.name || f.name, reason: err.message });
          continue;
        }

        const key = dedupKey(doc);
        if (seenKeys.has(key)) { duplicati++; continue; }
        seenKeys.add(key);

        const alreadyImported = importedKeys.has(key) || importedHashes.has(hash);
        const client = cls.direction === 'active' ? proposeClient(cls.counterparty, clients) : null;

        items.push({
          id: `inv_${hash.slice(0, 12)}_${doc.bodyIndex}`,
          dedupKey: key,
          status: alreadyImported ? 'imported' : 'new',
          file: { name: part.name || f.name, sourcePath: f.sourcePath, sha256: hash },
          doc,
          direction: cls.direction,
          reverseCharge: cls.reverseCharge,
          counterparty: cls.counterparty,
          tipoDocLabel: cls.tipoDocLabel,
          needsReview: cls.needsReview,
          reviewReason: cls.reviewReason,
          proposal: {
            clientId: client ? client.id : null,
            clientName: client ? client.name : null,
            linkedMonthKey: cls.direction === 'active' ? doc.monthKey : null,
            fiscal: cls.direction === 'passive' ? proposeFiscal(doc, cls.counterparty, supplierRules) : null,
            settlement: {
              status: 'open',
              date: null,
              amount: doc.totals.documento,
              dueDate: doc.payment ? doc.payment.dueDate : null,
            },
          },
        });
      }
    }
  }

  return {
    items,
    skipped,
    counts: {
      nuove: items.filter(i => i.status === 'new').length,
      duplicati,
      giaImportate: items.filter(i => i.status === 'imported').length,
      daRivedere: items.filter(i => i.needsReview).length,
    },
  };
}

function finalizeRecords({ items, decisions, supplierRules }) {
  const rules = { ...(supplierRules || {}) };
  const records = [];
  const now = Math.floor(Date.now() / 1000);

  for (const item of items || []) {
    const d = (decisions || {})[item.id];
    if (!d || !d.accept) continue;

    const doc = item.doc;
    const fiscal = d.fiscal !== undefined && d.fiscal !== null ? d.fiscal : item.proposal.fiscal;

    records.push({
      id: item.id,
      dedupKey: item.dedupKey,
      src: {
        fileName: item.file.name,
        sha256: item.file.sha256,
        archivePath: null,            // filled in by the archiver in main.js
        importedAt: now,
        format: doc.format,
      },
      // immutable (P1)
      direction: item.direction,
      reverseCharge: item.reverseCharge,
      tipoDoc: doc.tipoDoc,
      number: doc.number,
      date: doc.date,
      monthKey: doc.monthKey,
      sign: doc.sign,
      currency: doc.currency,
      causale: doc.causale,
      counterparty: item.counterparty,
      lines: doc.lines,
      vatSummary: doc.vatSummary,
      totals: doc.totals,
      withholding: doc.withholding,
      cassa: doc.cassa,
      payment: doc.payment,
      // editable (P2)
      clientId: d.clientId !== undefined ? d.clientId : item.proposal.clientId,
      linkedMonthKey: d.linkedMonthKey !== undefined ? d.linkedMonthKey : item.proposal.linkedMonthKey,
      fiscal,
      settlement: d.settlement || item.proposal.settlement,
      notes: d.notes || '',
      reviewedAt: now,
    });

    if (d.rememberSupplier && fiscal) {
      const supplierKey = normalizeId(item.counterparty.vat) || normalizeId(item.counterparty.cf);
      if (supplierKey) rules[supplierKey] = { ...fiscal };
    }
  }

  return { records, supplierRules: rules };
}

// Archiving guards live here, exported and pure, so they carry regression tests.
// They are the only thing standing between a crafted .zip entry name and a
// write outside the archive directory, and an untested guard is one edit from
// being dropped by accident.
function safeArchiveName(fileName) {
  // Normalize backslashes FIRST: POSIX basename does not treat \ as a
  // separator, and this app ships Windows builds.
  return path.basename(String(fileName || '').replace(/[\\]+/g, '/')) || 'fattura.xml';
}

function archiveYear(date) {
  return /^\d{4}/.test(String(date)) ? String(date).slice(0, 4) : 'senza-data';
}

module.exports = {
  collectFiles, buildManifest, finalizeRecords, proposeFiscal, proposeClient,
  safeArchiveName, archiveYear,
};
