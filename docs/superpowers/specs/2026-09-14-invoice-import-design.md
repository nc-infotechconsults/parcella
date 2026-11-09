# Design: Import Fatture Elettroniche (Attive & Passive)

**Date:** 2026-09-14
**Status:** Draft — awaiting review

---

## Overview

Parcella today derives revenue from the timesheet and costs from hand-entered
expenses. Both are *estimates*: the client-facing PDF/Word/CSV is a statement of
work done, and it legitimately diverges from what was actually invoiced when
agreements exist outside the app's business rules.

This design adds a fourth data source that is **accounting truth**: FatturaPA
XML files exported from the Agenzia delle Entrate (active and passive). Once
imported, invoices are the source of truth for ricavi, costi, IVA, ritenuta and
ammortamenti. Nothing derived from the timesheet may override, correct or
recompute them.

Goals:

1. Import active and passive e-invoices from the AdE export folders.
2. Give a correct, period-accurate picture of IVA a debito/credito.
3. Track costi deducibili, cespiti and ammortamenti from real supplier invoices.
4. Show revenue actually invoiced vs. still to invoice, without double counting.

Non-goals: generating FatturaPA XML, sending to SDI, bank reconciliation,
multi-company support.

---

## 1. Principles

These four rules govern every decision below.

**P1 — Imported data is immutable.** Every field that comes from the XML is
read-only forever. A re-import of the same document never rewrites it. Only
user classification metadata is editable.

**P2 — Nothing is applied without confirmation.** The importer *proposes*
direction, client link, category, deducibilità and cespite status. The user
confirms in a wizard. Confirmed choices remain editable afterwards, because the
correct treatment can change.

**P3 — Reverse charge is one document, not two.** A TD16–TD19 self-invoice
appears in *both* the active and the passive export. It is a single passive
record whose IVA is simultaneously a debito and a credito. Its imponibile is a
cost and never revenue. The two sides cancel when the purchase is fully
detraibile; where `vatDetractPct < 100` the non-detraibile share correctly
remains as a real liability rather than vanishing.

**P4 — Two dates, two jobs.** IVA is placed by document date. Ricavi and costi
for IRPEF are placed by settlement (cassa) date.

---

## 2. Data Model

### 2.1 Invoice record

One record per `FatturaElettronicaBody` — a single file may carry several.

```js
{
  id,                                   // "inv_" + sha256 prefix + body index
  dedupKey: "05165640755|TD18|28/AU|2026-08-24",
  src: { fileName, sha256, archivePath, importedAt, format: "FPR12" },

  // ── immutable: parsed from XML (P1) ────────────────────────────────
  direction: "active" | "passive",
  reverseCharge: false,
  tipoDoc: "TD01",
  number: "17/PRV/26",
  date: "2026-08-31",
  monthKey: "2026-08",
  sign: 1,                              // -1 for TD04 (nota di credito)
  currency: "EUR",
  counterparty: { name, vat, cf, country, address, regimeFiscale },
  lines: [
    { n, desc, qty, unitPrice, total, vatPct, natura,
      periodStart, periodEnd, ritenuta }
  ],
  vatSummary: [
    { vatPct, natura, imponibile, imposta, esigibilita, riferimentoNormativo }
  ],
  totals: { imponibile, imposta, documento, arrotondamento, bollo },
  withholding: { tipo: "RT01", aliquota: 20, importo, causale } | null,
  cassa:       { tipo: "TC22", aliquota: 4, importo, imponibile, vatPct } | null,
  payment:     { conditions: "TP02", method: "MP01", dueDate, amount } | null,

  // ── editable: user classification (P2) ─────────────────────────────
  clientId: null,                       // confirmed link, active invoices
  linkedMonthKey: null,                 // timesheet month this invoice covers
  fiscal: { category, deductPct, vatDetractPct,
            amortize, amortYears, firstYearHalf },
  settlement: { status: "open" | "settled", date, amount },
  notes: "",
  reviewedAt                            // null until confirmed in the wizard
}
```

**Why `vatSummary` is an array.** Real documents mix rates: the EasyPark
invoice carries an N2.2 fuori-campo line *and* a 22% line. Collapsing to a
single total would invent detraibile IVA that does not exist.

**Why `sign` instead of a type branch.** TD04 credit notes flow through exactly
the same aggregation path with `sign: -1`, so no aggregate needs a special case.

### 2.2 Storage

New SQLite table, following the existing JSON-blob pattern:

```sql
CREATE TABLE IF NOT EXISTS invoices (
  id        TEXT PRIMARY KEY,
  direction TEXT,
  month_key TEXT,
  dedup_key TEXT UNIQUE,
  data      TEXT NOT NULL,
  ts        INTEGER DEFAULT (strftime('%s','now'))
);
CREATE INDEX IF NOT EXISTS idx_inv_month ON invoices(month_key);
CREATE INDEX IF NOT EXISTS idx_inv_dir   ON invoices(direction);
```

`invoices` is added to: the `saveCollection` allowlist, `loadAll()`, `stats()`,
and — following the omission fixed in `fb636d8` — `exportJSON()` /
`importJSON()`, so backups are not silently incomplete.

**New kv entry** `supplierRules`: remembered per-supplier treatment, keyed by
supplier VAT, e.g. `{ "IT08106710158": { category: "Software", deductPct: 100,
vatDetractPct: 100, amortize: false } }`. Written on every confirm, read as the
proposal source on the next import.

### 2.3 Archived originals

Each committed file is copied to `userData/invoices/<year>/<fileName>` and its
SHA-256 stored. The ledger is then self-contained (the Downloads folder can be
cleared), the hash is a second dedup guard, and the detail view can show the
original document.

---

## 3. Import Pipeline

`src/main/invoice-import.js`, main process. Stages 1–5 are a **dry run**:
nothing is written to the DB or archived until the user confirms (P2).

**1. Collect** — folder or file selection; recursive scan for `.xml`,
`.xml.p7m`, `.zip`.

**2. Unwrap** — zip entries read via Node's `zlib` (minimal central-directory
reader, no new dependency); `.p7m` payload extracted with a small DER walk to
the CMS eContent, handling both raw DER and base64-wrapped input; plain `.xml`
passes through.

**3. Parse** — `fast-xml-parser` (pure JS, no native build, does not disturb the
electron-builder signing pipeline) over `FatturaElettronicaHeader` and
`FatturaElettronicaBody` only. The `ds:Signature` subtree present in signed
documents is ignored.

**4. Classify** — direction by comparing cedente/cessionario P.IVA + CF against
the `studio` identity, then TipoDocumento overrides:

| TipoDocumento | Treatment |
|---|---|
| TD01, TD06 | sale / purchase by party match |
| TD04 | credit note, `sign: -1` |
| TD05 | debit note |
| TD16, TD17, TD18, TD19 | **always passive**, `reverseCharge: true` (P3) |
| TD20, TD21 | autofattura, passive |
| TD24, TD25 | deferred invoice, by party match |
| anything else | no guess — routed to *da rivedere* |

If the studio P.IVA is missing from Settings the import stops with a clear
message rather than guessing, because a wrong guess here mislabels revenue.

**5. Propose** — per document: dedup verdict (*nuova* / *duplicato nel batch* /
*già importata*), client link by counterparty VAT/CF match against `clients`,
fiscal defaults from `supplierRules` falling back to `CATEGORY_RULES`, cespite
flag when imponibile ≥ `AMORTIZE_THRESHOLD` (516,46 €).

**6. Confirm & commit** — the user accepts the manifest; records are inserted,
files archived, `supplierRules` updated. Unparseable files are reported as
skipped with a reason and never abort the batch.

### 3.1 Deduplication

Dedup key: `cedente P.IVA | TipoDocumento | Numero | Data`, with the `COPIA_`
filename prefix stripped and the file SHA-256 as a secondary guard. This is what
collapses `IT04204200135_0KDbm.xml` and `COPIA_IT04204200135_0KDbm.xml` into a
single record (P3).

### 3.2 IPC surface

```
invoices:chooseSource()      → { paths }            dialog, folder or files
invoices:scan(paths)         → manifest             dry run, no writes
invoices:commit(decisions)   → { imported, skipped }
invoices:openOriginal(id)    → opens archived file
```

---

## 4. Fiscal Engine

### 4.1 Extraction

The merge logic is where correctness bugs would hide, and `taxes.jsx` is already
895 lines with `computeTaxes` embedded in the view. The computation moves to a
new plain-JS `src/renderer/fiscal.js` (loaded like `data.js`/`storage.js`,
`window`-exported), holding:

- `computeExpenseFiscals(e)` — moved from `expenses.jsx`, generalized to accept
  either an expense or an invoice cost view
- `invoiceCostFiscals(inv)` — net / IVA detraibile / quota deducibile
- `computeFiscalYear({ year, invoices, activities, expenses, clients, studio, fiscal })`

`expenses.jsx` and `taxes.jsx` keep their existing `window.*` exports so nothing
else has to change. The extraction exists so Node tests can assert the rules
directly — reverse-charge neutrality and the no-double-count rule cannot be
verified by eyeballing a KPI.

### 4.2 Merge rules

| Quantity | Consuntivo (invoices) | Previsionale (timesheet / manual) |
|---|---|---|
| Ricavi | Σ active `imponibile × sign`, cassa rivalsa included, reverse-charge excluded | only (client, month) pairs with **no** linked active invoice |
| IVA a debito | Σ active `vatSummary.imposta`, by **document date** | — |
| IVA a credito | Σ passive `imposta × vatDetractPct`, by **document date** | — |
| Reverse charge | `imposta` added to debito **and** credito → cancels at full detraction; the non-detraibile share stays a liability. Both rows displayed so figures match the registri | — |
| Costi | passive `imponibile × deductPct` by **settlement date**, or the year's quota if cespite | manual non-billable expenses, invoice-backed ones excluded |
| Ritenuta | Σ `withholding.importo` on **settled** active invoices | — |

**No double counting.** A timesheet month contributes to the forecast only when
no active invoice is linked to that (client, month). When an invoice exists the
invoice figures are used *as they are* — never averaged with, corrected by, or
reconciled into the timesheet figures (P1).

Billable (client-rebilled) expenses stay out of costs, unchanged from today.

### 4.3 Cespiti & ammortamenti

An invoice flagged as cespite generates a schedule:

```
quota(year) = imponibile × deductPct / 100 / amortYears
```

starting in the document's year. Per art. 102 TUIR the first year's quota is
halved (`firstYearHalf: true`, default for invoice-backed cespiti) and the
schedule extends one year further.

**Deliberate inconsistency**: manual expenses keep their current even division
with no halving, so previously computed historical figures do not silently
shift. This is recorded here as a known divergence, not an oversight.

### 4.4 Categories

`CATEGORY_RULES` gains three categories that passive invoices need and it does
not currently have:

| Category | deductPct | IVA |
|---|---|---|
| Utenze | 100 | 22 |
| Commissioni bancarie | 100 | esente art. 10 |
| Consulenze | 100 | 22 |

---

## 5. Screens

**Fatture** (new nav entry) — tabs *Attive* / *Passive* / *Registri IVA*.
Filters by year, quarter, client, state. Columns: date, number, counterparty,
imponibile, IVA, totale, stato; badges for reverse charge, nota di credito,
cespite, da rivedere. Row opens a detail drawer where the immutable XML block is
visually distinct and read-only, the editable block sits below it, and the
archived original is one click away.

**Import wizard** — three steps: pick source → review the manifest grouped as
*nuove / duplicati / da rivedere / scartate*, proposed client and category
editable inline, select-all per group → commit summary.

**Tasse** — each KPI splits into *fatturato* and *da fatturare*. The IVA period
table is driven by invoice periods, with an explicit neutral reverse-charge row.
Gains a *Cespiti & ammortamenti* tab: asset, purchase date, cost, years, quota
for the year, residual.

**Dashboard** — ricavi fatturati YTD, incassato vs. da incassare, costi per
categoria (this is where *Utenze* becomes visible as its own line), IVA del
periodo, prossime scadenze from `payment.dueDate`.

**Spese** — unchanged for manual entries, with a pointer that invoice-backed
costs live in Fatture, removing the double-entry temptation.

**Reconciliation** — the per-client month view shows invoiced amount alongside
hours registered, presented as information about off-book agreements, not as a
warning to fix (P1).

All new UI strings go through `i18n.js` in both `it` and `en`.

---

## 6. Testing

Node scripts under `tests/`, matching the existing plain-script style.

`test-invoice-parse.js` — fixtures covering the cases the real data contains:

- signed TD18 with embedded `ds:Signature`
- multi-rate `DatiRiepilogo` (N2.2 fuori campo + 22%)
- TD04 nota di credito
- TD01 with `DatiRitenuta` + `DatiCassaPrevidenziale`
- the active/passive duplicate pair (dedup)
- `.p7m` and `.zip` unwrapping

`test-fiscal-year.js` — the merge rules:

- reverse-charge IVA nets to zero and contributes zero revenue
- an invoiced month suppresses its timesheet forecast contribution
- TD04 subtracts
- cassa-basis costs move with settlement date, IVA with document date
- cespite quota halved in the first year

**Fixtures are anonymized**: synthetic denominations and VAT numbers, XML
structure untouched, so no real client identities or P.IVA enter the repository.

---

## 7. Migration & Compatibility

- New table only; no change to `clients`, `activities`, `expenses` rows.
- Existing installs load with zero invoices and behave exactly as today: the
  consuntivo is empty, so every figure comes from the previsionale path.
- Adding `fast-xml-parser` is the only new dependency; it is pure JS and does
  not affect `electron-rebuild` or platform packaging.
