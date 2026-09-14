# FatturaPA Invoice Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import active and passive FatturaPA e-invoices into Parcella and make them the accounting source of truth for ricavi, costi, IVA, ritenuta and ammortamenti.

**Architecture:** Parsing, unwrapping and classification live in the Electron **main process** as dependency-free-as-possible Node modules (only `fast-xml-parser` is added), each unit-testable with `node:test`. Invoices are stored as a new first-class `invoices` collection following the app's existing JSON-blob-per-row SQLite pattern. The fiscal math is **extracted out of `taxes.jsx`** into a UMD-style `src/renderer/fiscal.js` that both the browser and Node tests can load. The renderer gains a Fatture screen and an import wizard; import is a dry run until the user confirms.

**Tech Stack:** Electron 35 (Node 20), better-sqlite3, React 18 via in-browser Babel (no build step), `node:test`, `fast-xml-parser`.

**Spec:** `docs/superpowers/specs/2026-09-14-invoice-import-design.md`

## Global Constraints

- **P1 — Imported data is immutable.** Every XML-derived field is read-only forever. Re-importing the same document never rewrites it. Only `clientId`, `linkedMonthKey`, `fiscal`, `settlement`, `notes`, `reviewedAt` are editable.
- **P2 — Nothing is applied without confirmation.** Scan is a dry run; no DB write, no file copy, until the user confirms the manifest.
- **P3 — Reverse charge is one document.** TD16–TD19 are always `direction: "passive"`, `reverseCharge: true`; imponibile is a cost and never revenue; imposta counts as debito *and* credito in the same period.
- **P4 — Two dates.** IVA is placed by `date` (document date). Ricavi/costi for IRPEF are placed by `settlement.date` (cassa).
- **No double counting.** A timesheet (client, month) pair contributes to the forecast only when no active invoice is linked to it.
- Money helper everywhere: `Math.round(n * 100) / 100`. Never compare floats for equality in tests without a tolerance.
- Renderer files are loaded as `<script>` tags in `src/renderer/index.html` — there is no bundler. New renderer files must be added to that list, in dependency order.
- New UI strings go in `src/renderer/i18n.js` under **both** `it` and `en`.
- Fixtures committed to the repo must be anonymized: synthetic denominations and VAT numbers, XML structure untouched.
- The only new npm dependency permitted is `fast-xml-parser` (pure JS — must not introduce a native build step).

---

## File Structure

**Created — main process**
- `src/main/fattura-parse.js` — XML → normalized document objects. No fs, no classification.
- `src/main/fattura-classify.js` — direction, reverse charge, sign, dedup key. Pure functions.
- `src/main/fattura-unwrap.js` — `.zip` and `.p7m` → XML buffers. Pure (takes buffers).
- `src/main/invoice-import.js` — orchestration: collect files, build manifest, finalize records.

**Created — renderer**
- `src/renderer/fiscal.js` — UMD module: `computeExpenseFiscals`, `invoiceCostFiscals`, `computeFiscalYear`, `buildAmortSchedule`, `CATEGORY_RULES`, `AMORTIZE_THRESHOLD`.
- `src/renderer/components/invoices.jsx` — Fatture screen (list, filters, detail drawer).
- `src/renderer/components/invoice-import-wizard.jsx` — three-step import modal.

**Modified**
- `src/main/db.js` — `invoices` table, `supplierRules` kv, loadAll/stats/export/import.
- `src/main/main.js` — four `invoices:*` IPC handlers.
- `src/main/preload.js` — `window.api.invoices`.
- `src/renderer/index.html` — script tags for the new renderer files.
- `src/renderer/app.jsx` — `invoices` state, load, persist, nav route, wizard mounting.
- `src/renderer/components/shared.jsx` — Sidebar entry for Fatture.
- `src/renderer/components/expenses.jsx` — delegate to `fiscal.js`, keep `window.*` exports.
- `src/renderer/components/taxes.jsx` — consume `computeFiscalYear`; Cespiti tab.
- `src/renderer/components/dashboard.jsx` — invoice KPIs and scadenze.
- `src/renderer/i18n.js` — it/en strings.
- `package.json` — `test` script, `fast-xml-parser` dependency.

**Tests**
- `tests/fixtures/*.xml` — anonymized fixtures.
- `tests/test-fattura-parse.js`, `tests/test-fattura-classify.js`, `tests/test-fattura-unwrap.js`, `tests/test-invoices-db.js`, `tests/test-invoice-import.js`, `tests/test-fiscal-year.js`.

---

## Task 1: Test runner and anonymized fixtures

**Files:**
- Modify: `package.json` (scripts)
- Create: `tests/fixtures/attiva-td01-ritenuta-cassa.xml`
- Create: `tests/fixtures/passiva-td01-multirate.xml`
- Create: `tests/fixtures/autofattura-td18-signed.xml`
- Create: `tests/fixtures/COPIA_autofattura-td18-signed.xml`
- Create: `tests/fixtures/passiva-td04-nota-credito.xml`
- Create: `tests/fixtures/index.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `require('./fixtures')` → `{ dir, read(name) }` where `read(name: string) => string` (UTF-8 XML). Fixture constants used by later tasks: studio P.IVA is `01234567890`, studio CF `RSSMRA80A01H501U`.

- [ ] **Step 1: Add the test script**

In `package.json`, inside `"scripts"`, add as the first entry:

```json
"test": "node --test tests/",
```

- [ ] **Step 2: Verify the existing tests run**

Run: `npm test`
Expected: PASS — the two existing suites (`test-compute-amounts.js`, `test-doc-counter.js`) report all tests passing.

- [ ] **Step 3: Create the active invoice fixture (ritenuta + cassa)**

Create `tests/fixtures/attiva-td01-ritenuta-cassa.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12">
  <FatturaElettronicaHeader>
    <DatiTrasmissione>
      <IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente>
      <ProgressivoInvio>999999</ProgressivoInvio>
      <FormatoTrasmissione>FPR12</FormatoTrasmissione>
      <CodiceDestinatario>ABCDEFG</CodiceDestinatario>
    </DatiTrasmissione>
    <CedentePrestatore>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA>
        <CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale>
        <Anagrafica><Denominazione>STUDIO DI PROVA DI MARIO ROSSI</Denominazione></Anagrafica>
        <RegimeFiscale>RF01</RegimeFiscale>
      </DatiAnagrafici>
      <Sede><Indirizzo>VIA DELLE PROVE</Indirizzo><NumeroCivico>1</NumeroCivico><CAP>00100</CAP><Comune>ROMA</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede>
    </CedentePrestatore>
    <CessionarioCommittente>
      <DatiAnagrafici>
        <IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>09876543210</IdCodice></IdFiscaleIVA>
        <CodiceFiscale>09876543210</CodiceFiscale>
        <Anagrafica><Denominazione>CLIENTE ALFA S.R.L.</Denominazione></Anagrafica>
      </DatiAnagrafici>
      <Sede><Indirizzo>VIA CLIENTE</Indirizzo><NumeroCivico>7</NumeroCivico><CAP>20100</CAP><Comune>MILANO</Comune><Provincia>MI</Provincia><Nazione>IT</Nazione></Sede>
    </CessionarioCommittente>
  </FatturaElettronicaHeader>
  <FatturaElettronicaBody>
    <DatiGenerali>
      <DatiGeneraliDocumento>
        <TipoDocumento>TD01</TipoDocumento>
        <Divisa>EUR</Divisa>
        <Data>2026-07-31</Data>
        <Numero>16/PRV/26</Numero>
        <DatiRitenuta><TipoRitenuta>RT01</TipoRitenuta><ImportoRitenuta>1248.00</ImportoRitenuta><AliquotaRitenuta>20.00</AliquotaRitenuta><CausalePagamento>A</CausalePagamento></DatiRitenuta>
        <DatiCassaPrevidenziale><TipoCassa>TC22</TipoCassa><AlCassa>4.00</AlCassa><ImportoContributoCassa>240.00</ImportoContributoCassa><ImponibileCassa>6000.00</ImponibileCassa><AliquotaIVA>22.00</AliquotaIVA></DatiCassaPrevidenziale>
        <ImportoTotaleDocumento>7612.80</ImportoTotaleDocumento>
        <Causale>Servizio di consulenza</Causale>
      </DatiGeneraliDocumento>
    </DatiGenerali>
    <DatiBeniServizi>
      <DettaglioLinee>
        <NumeroLinea>1</NumeroLinea>
        <Descrizione>Servizio di consulenza</Descrizione>
        <Quantita>1.00000000</Quantita>
        <PrezzoUnitario>6000.00000000</PrezzoUnitario>
        <PrezzoTotale>6000.00000000</PrezzoTotale>
        <AliquotaIVA>22.00</AliquotaIVA>
        <Ritenuta>SI</Ritenuta>
      </DettaglioLinee>
      <DatiRiepilogo>
        <AliquotaIVA>22.00</AliquotaIVA>
        <ImponibileImporto>6240.00</ImponibileImporto>
        <Imposta>1372.80</Imposta>
        <EsigibilitaIVA>I</EsigibilitaIVA>
      </DatiRiepilogo>
    </DatiBeniServizi>
    <DatiPagamento>
      <CondizioniPagamento>TP02</CondizioniPagamento>
      <DettaglioPagamento>
        <ModalitaPagamento>MP05</ModalitaPagamento>
        <DataScadenzaPagamento>2026-08-30</DataScadenzaPagamento>
        <ImportoPagamento>7612.80</ImportoPagamento>
      </DettaglioPagamento>
    </DatiPagamento>
  </FatturaElettronicaBody>
</p:FatturaElettronica>
```

- [ ] **Step 4: Create the multi-rate passive fixture**

Create `tests/fixtures/passiva-td01-multirate.xml` — note the two `DatiRiepilogo` blocks (one N2.2 fuori campo, one at 22%), which is the case that must not be collapsed:

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?><ns3:FatturaElettronica xmlns:ns3="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12"><FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>05550001112</IdCodice></IdTrasmittente><ProgressivoInvio>111111</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>05550001112</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>PARCHEGGI DI PROVA SRL</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>VIA ESEMPIO 10</Indirizzo><CAP>00100</CAP><Comune>ROMA</Comune><Provincia>RM</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore><CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>STUDIO DI PROVA DI MARIO ROSSI</Denominazione></Anagrafica></DatiAnagrafici><Sede><Indirizzo>VIA DELLE PROVE 1</Indirizzo><CAP>00100</CAP><Comune>ROMA</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD01</TipoDocumento><Divisa>EUR</Divisa><Data>2026-08-31</Data><Numero>B_000000001 / 2026</Numero><ImportoTotaleDocumento>8.62</ImportoTotaleDocumento><Arrotondamento>0.00</Arrotondamento></DatiGeneraliDocumento></DatiGenerali><DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Totale soste (IVA 22.00)</Descrizione><Quantita>1.00</Quantita><DataInizioPeriodo>2026-08-12</DataInizioPeriodo><DataFinePeriodo>2026-08-12</DataFinePeriodo><PrezzoUnitario>1.91</PrezzoUnitario><PrezzoTotale>1.91</PrezzoTotale><AliquotaIVA>0.00</AliquotaIVA><Natura>N2.2</Natura></DettaglioLinee><DettaglioLinee><NumeroLinea>2</NumeroLinea><Descrizione>Canone abbonamento (IVA 22.00)</Descrizione><Quantita>1.00</Quantita><DataInizioPeriodo>2026-08-01</DataInizioPeriodo><DataFinePeriodo>2026-08-31</DataFinePeriodo><PrezzoUnitario>5.50</PrezzoUnitario><PrezzoTotale>5.50</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee><DatiRiepilogo><AliquotaIVA>0.00</AliquotaIVA><Natura>N2.2</Natura><ImponibileImporto>1.91</ImponibileImporto><Imposta>0.00</Imposta><EsigibilitaIVA>I</EsigibilitaIVA><RiferimentoNormativo>Art 74 c.1 e 2 Operazioni fuori campo IVA</RiferimentoNormativo></DatiRiepilogo><DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>5.50</ImponibileImporto><Imposta>1.21</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi></FatturaElettronicaBody></ns3:FatturaElettronica>
```

- [ ] **Step 5: Create the signed TD18 self-invoice fixture**

Create `tests/fixtures/autofattura-td18-signed.xml`. The `ds:Signature` block at the end is the point of this fixture — the parser must ignore it:

```xml
<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" versione="FPR12"><FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdTrasmittente><ProgressivoInvio>999999</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IE</IdPaese><IdCodice>IE1111111AA</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>FORNITORE ESTERO LIMITED</Denominazione></Anagrafica><RegimeFiscale>RF18</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>1 Foreign Street</Indirizzo><CAP>00000</CAP><Comune>Dublin</Comune><Nazione>IE</Nazione></Sede></CedentePrestatore><CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><CodiceFiscale>RSSMRA80A01H501U</CodiceFiscale><Anagrafica><Denominazione>STUDIO DI PROVA DI MARIO ROSSI</Denominazione></Anagrafica></DatiAnagrafici><Sede><Indirizzo>VIA DELLE PROVE 1</Indirizzo><CAP>00100</CAP><Comune>ROMA</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente><SoggettoEmittente>TZ</SoggettoEmittente></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD18</TipoDocumento><Divisa>EUR</Divisa><Data>2026-08-24</Data><Numero>28/AU</Numero><ImportoTotaleDocumento>219.60</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali><DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>INTEGRAZIONE FATTURA N. XYZ DEL 21/08/2026</Descrizione><PrezzoUnitario>180.00000000</PrezzoUnitario><PrezzoTotale>180.00000000</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee><DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>180.00</ImponibileImporto><Imposta>39.60</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi><DatiPagamento><CondizioniPagamento>TP02</CondizioniPagamento><DettaglioPagamento><ModalitaPagamento>MP01</ModalitaPagamento><ImportoPagamento>219.60</ImportoPagamento></DettaglioPagamento></DatiPagamento></FatturaElettronicaBody><ds:Signature Id="AUT_1" xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><ds:SignedInfo><ds:CanonicalizationMethod Algorithm="http://www.w3.org/TR/2001/REC-xml-c14n-20010315"/><ds:SignatureMethod Algorithm="http://www.w3.org/2001/04/xmldsig-more#rsa-sha256"/><ds:Reference URI=""><ds:DigestMethod Algorithm="http://www.w3.org/2001/04/xmlenc#sha256"/><ds:DigestValue>ZmFrZWRpZ2VzdA==</ds:DigestValue></ds:Reference></ds:SignedInfo><ds:SignatureValue>ZmFrZXNpZ25hdHVyZQ==</ds:SignatureValue><ds:KeyInfo><ds:X509Data><ds:X509Certificate>ZmFrZWNlcnQ=</ds:X509Certificate></ds:X509Data></ds:KeyInfo></ds:Signature></p:FatturaElettronica>
```

- [ ] **Step 6: Create the duplicate copy of the TD18**

Create `tests/fixtures/COPIA_autofattura-td18-signed.xml` with byte-identical content to Step 5. This mirrors reality: the same self-invoice is present in both the active and passive AdE exports under different filenames, and the dedup logic must collapse them into one record.

```bash
cp tests/fixtures/autofattura-td18-signed.xml tests/fixtures/COPIA_autofattura-td18-signed.xml
```

- [ ] **Step 7: Create the credit-note fixture**

Create `tests/fixtures/passiva-td04-nota-credito.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?><p:FatturaElettronica xmlns:p="http://ivaservizi.agenziaentrate.gov.it/docs/xsd/fatture/v1.2" versione="FPR12"><FatturaElettronicaHeader><DatiTrasmissione><IdTrasmittente><IdPaese>IT</IdPaese><IdCodice>06660002223</IdCodice></IdTrasmittente><ProgressivoInvio>1300</ProgressivoInvio><FormatoTrasmissione>FPR12</FormatoTrasmissione><CodiceDestinatario>0000000</CodiceDestinatario></DatiTrasmissione><CedentePrestatore><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>06660002223</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>Ufficio Beta Srls</Denominazione></Anagrafica><RegimeFiscale>RF01</RegimeFiscale></DatiAnagrafici><Sede><Indirizzo>Via Beta 3</Indirizzo><CAP>70100</CAP><Comune>BARI</Comune><Provincia>BA</Provincia><Nazione>IT</Nazione></Sede></CedentePrestatore><CessionarioCommittente><DatiAnagrafici><IdFiscaleIVA><IdPaese>IT</IdPaese><IdCodice>01234567890</IdCodice></IdFiscaleIVA><Anagrafica><Denominazione>STUDIO DI PROVA DI MARIO ROSSI</Denominazione></Anagrafica></DatiAnagrafici><Sede><Indirizzo>VIA DELLE PROVE 1</Indirizzo><CAP>00100</CAP><Comune>ROMA</Comune><Nazione>IT</Nazione></Sede></CessionarioCommittente></FatturaElettronicaHeader><FatturaElettronicaBody><DatiGenerali><DatiGeneraliDocumento><TipoDocumento>TD04</TipoDocumento><Divisa>EUR</Divisa><Data>2026-09-10</Data><Numero>1300</Numero><ImportoTotaleDocumento>80.01</ImportoTotaleDocumento></DatiGeneraliDocumento></DatiGenerali><DatiBeniServizi><DettaglioLinee><NumeroLinea>1</NumeroLinea><Descrizione>Storno canone noleggio</Descrizione><Quantita>1.00</Quantita><PrezzoUnitario>65.58</PrezzoUnitario><PrezzoTotale>65.58</PrezzoTotale><AliquotaIVA>22.00</AliquotaIVA></DettaglioLinee><DatiRiepilogo><AliquotaIVA>22.00</AliquotaIVA><ImponibileImporto>65.58</ImponibileImporto><Imposta>14.43</Imposta><EsigibilitaIVA>I</EsigibilitaIVA></DatiRiepilogo></DatiBeniServizi></FatturaElettronicaBody></p:FatturaElettronica>
```

- [ ] **Step 8: Create the fixture loader**

Create `tests/fixtures/index.js`:

```js
// tests/fixtures/index.js — anonymized FatturaPA fixtures
const fs = require('fs');
const path = require('path');

const dir = __dirname;

// The synthetic studio identity used across all fixtures.
const STUDIO = { piva: '01234567890', cf: 'RSSMRA80A01H501U' };

function read(name) {
  return fs.readFileSync(path.join(dir, name), 'utf-8');
}

module.exports = { dir, read, STUDIO };
```

- [ ] **Step 9: Verify the fixtures load**

Run:

```bash
node -e "const f=require('./tests/fixtures'); console.log(f.read('attiva-td01-ritenuta-cassa.xml').length, f.read('COPIA_autofattura-td18-signed.xml').length)"
```

Expected: two positive numbers printed, no exception.

- [ ] **Step 10: Commit**

```bash
git add package.json tests/fixtures
git commit -m "test: add npm test script and anonymized FatturaPA fixtures"
```

---

## Task 2: XML parser

**Files:**
- Create: `src/main/fattura-parse.js`
- Create: `tests/test-fattura-parse.js`
- Modify: `package.json` (dependencies)

**Interfaces:**
- Consumes: `tests/fixtures` from Task 1.
- Produces:
  - `parseFattura(xml: string) => ParsedDoc[]` — one entry per `FatturaElettronicaBody`.
  - `ParsedDoc = { format, bodyIndex, cedente, cessionario, tipoDoc, number, date, monthKey, sign, currency, causale, lines, vatSummary, totals, withholding, cassa, payment }`
  - `Party = { name, vat, vatCountry, cf, country, address, regimeFiscale }`
  - `money(v) => number` — rounds to 2 decimals, returns 0 for non-numeric.
  - Throws `Error('Non è una FatturaElettronica')` when the root element is missing.

- [ ] **Step 1: Install the parser dependency**

```bash
npm install fast-xml-parser@^5
```

Expected: `package.json` gains `"fast-xml-parser"` under `dependencies`. It is pure JS, so `npm run rebuild` is not needed.

- [ ] **Step 2: Write the failing test**

Create `tests/test-fattura-parse.js`:

```js
// tests/test-fattura-parse.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseFattura } = require('../src/main/fattura-parse');
const fixtures = require('./fixtures');

// Money comparisons go through a tolerance: every amount here is the result of
// a round-to-2dp, and bare float equality on those is a latent flake.
const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('parses a TD01 with ritenuta and cassa', () => {
  const [doc] = parseFattura(fixtures.read('attiva-td01-ritenuta-cassa.xml'));
  assert.equal(doc.tipoDoc, 'TD01');
  assert.equal(doc.number, '16/PRV/26');      // stays a string, never a number
  assert.equal(doc.date, '2026-07-31');
  assert.equal(doc.monthKey, '2026-07');
  assert.equal(doc.sign, 1);
  assert.equal(doc.cedente.vat, '01234567890');
  assert.equal(doc.cessionario.name, 'CLIENTE ALFA S.R.L.');
  near(doc.totals.imponibile, 6240);
  near(doc.totals.imposta, 1372.80);
  near(doc.totals.documento, 7612.80);
  near(doc.withholding.importo, 1248);
  near(doc.withholding.aliquota, 20);
  near(doc.cassa.importo, 240);
  near(doc.cassa.imponibile, 6000);
  assert.equal(doc.payment.dueDate, '2026-08-30');
  assert.equal(doc.lines.length, 1);
  near(doc.lines[0].total, 6000);
});

test('keeps one vatSummary entry per rate', () => {
  const [doc] = parseFattura(fixtures.read('passiva-td01-multirate.xml'));
  assert.equal(doc.vatSummary.length, 2);
  const fuoriCampo = doc.vatSummary.find(v => v.natura === 'N2.2');
  const ordinaria = doc.vatSummary.find(v => v.vatPct === 22);
  near(fuoriCampo.imponibile, 1.91);
  near(fuoriCampo.imposta, 0);
  near(ordinaria.imposta, 1.21);
  near(doc.totals.imponibile, 7.41);
  near(doc.totals.imposta, 1.21);
});

test('ignores the ds:Signature subtree of a signed document', () => {
  const [doc] = parseFattura(fixtures.read('autofattura-td18-signed.xml'));
  assert.equal(doc.tipoDoc, 'TD18');
  assert.equal(doc.cedente.name, 'FORNITORE ESTERO LIMITED');
  near(doc.totals.imposta, 39.60);
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/test-fattura-parse.js`
Expected: FAIL — `Cannot find module '../src/main/fattura-parse'`.

- [ ] **Step 4: Write the implementation**

Create `src/main/fattura-parse.js`:

```js
// Parses FatturaPA XML (FPR12/FPA12) into normalized document objects.
// Pure: no filesystem, no classification, no fiscal interpretation.
const { XMLParser } = require('fast-xml-parser');

// parseTagValue:false is deliberate — "16/PRV/26" and "1300" are document
// numbers, not numbers, and "1.00000000" must not become a float by accident.
// removeNSPrefix:true normalizes the p:/ns3: prefixes real exports differ on.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = v => (v === undefined || v === null ? '' : String(v).trim());
const money = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const numOrNull = v => {
  if (v === undefined || v === null || str(v) === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// TD04 (nota di credito) reverses every amount it carries.
const NEGATIVE_DOCS = new Set(['TD04', 'TD08']);

function party(node) {
  const da = (node && node.DatiAnagrafici) || {};
  const an = da.Anagrafica || {};
  const iva = da.IdFiscaleIVA || {};
  const sede = (node && node.Sede) || {};
  const name = str(an.Denominazione) || [str(an.Nome), str(an.Cognome)].filter(Boolean).join(' ');
  const street = [str(sede.Indirizzo), str(sede.NumeroCivico)].filter(Boolean).join(' ');
  return {
    name,
    vat: str(iva.IdCodice),
    vatCountry: str(iva.IdPaese),
    cf: str(da.CodiceFiscale),
    country: str(sede.Nazione) || str(iva.IdPaese),
    address: [street, str(sede.CAP), str(sede.Comune), str(sede.Provincia)].filter(Boolean).join(', '),
    regimeFiscale: str(da.RegimeFiscale),
  };
}

function parseFattura(xml) {
  const root = parser.parse(xml);
  const doc = root.FatturaElettronica;
  if (!doc) throw new Error('Non è una FatturaElettronica');

  const header = doc.FatturaElettronicaHeader || {};
  const format = str(doc['@_versione']) || str((header.DatiTrasmissione || {}).FormatoTrasmissione);
  const cedente = party(header.CedentePrestatore);
  const cessionario = party(header.CessionarioCommittente);

  return asArray(doc.FatturaElettronicaBody).map((body, bodyIndex) => {
    const dg = ((body.DatiGenerali || {}).DatiGeneraliDocumento) || {};
    const bs = body.DatiBeniServizi || {};
    const tipoDoc = str(dg.TipoDocumento);
    const date = str(dg.Data);

    const lines = asArray(bs.DettaglioLinee).map(l => ({
      n: numOrNull(l.NumeroLinea),
      desc: str(l.Descrizione),
      qty: numOrNull(l.Quantita),
      unitPrice: numOrNull(l.PrezzoUnitario),
      total: money(l.PrezzoTotale),
      vatPct: numOrNull(l.AliquotaIVA),
      natura: str(l.Natura) || null,
      periodStart: str(l.DataInizioPeriodo) || null,
      periodEnd: str(l.DataFinePeriodo) || null,
      ritenuta: str(l.Ritenuta) === 'SI',
    }));

    const vatSummary = asArray(bs.DatiRiepilogo).map(r => ({
      vatPct: numOrNull(r.AliquotaIVA),
      natura: str(r.Natura) || null,
      imponibile: money(r.ImponibileImporto),
      imposta: money(r.Imposta),
      esigibilita: str(r.EsigibilitaIVA) || null,
      riferimentoNormativo: str(r.RiferimentoNormativo) || null,
    }));

    const rit = dg.DatiRitenuta ? asArray(dg.DatiRitenuta)[0] : null;
    const cassaNode = dg.DatiCassaPrevidenziale ? asArray(dg.DatiCassaPrevidenziale)[0] : null;
    const bollo = dg.DatiBollo ? asArray(dg.DatiBollo)[0] : null;
    const payNode = body.DatiPagamento ? asArray(body.DatiPagamento)[0] : null;
    const payDet = payNode ? asArray(payNode.DettaglioPagamento)[0] : null;

    const imponibile = money(vatSummary.reduce((s, v) => s + v.imponibile, 0));
    const imposta = money(vatSummary.reduce((s, v) => s + v.imposta, 0));

    return {
      format,
      bodyIndex,
      cedente,
      cessionario,
      tipoDoc,
      number: str(dg.Numero),
      date,
      monthKey: date.slice(0, 7),
      sign: NEGATIVE_DOCS.has(tipoDoc) ? -1 : 1,
      currency: str(dg.Divisa) || 'EUR',
      causale: asArray(dg.Causale).map(str).filter(Boolean).join(' — '),
      lines,
      vatSummary,
      totals: {
        imponibile,
        imposta,
        documento: money(dg.ImportoTotaleDocumento) || money(imponibile + imposta),
        arrotondamento: money(dg.Arrotondamento),
        bollo: bollo ? money(bollo.ImportoBollo) : 0,
      },
      withholding: rit ? {
        tipo: str(rit.TipoRitenuta),
        aliquota: numOrNull(rit.AliquotaRitenuta),
        importo: money(rit.ImportoRitenuta),
        causale: str(rit.CausalePagamento) || null,
      } : null,
      cassa: cassaNode ? {
        tipo: str(cassaNode.TipoCassa),
        aliquota: numOrNull(cassaNode.AlCassa),
        importo: money(cassaNode.ImportoContributoCassa),
        imponibile: money(cassaNode.ImponibileCassa),
        vatPct: numOrNull(cassaNode.AliquotaIVA),
      } : null,
      payment: payDet ? {
        conditions: str(payNode.CondizioniPagamento) || null,
        method: str(payDet.ModalitaPagamento) || null,
        dueDate: str(payDet.DataScadenzaPagamento) || null,
        amount: money(payDet.ImportoPagamento),
      } : null,
    };
  });
}

module.exports = { parseFattura, money, asArray, str, numOrNull };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/test-fattura-parse.js`
Expected: PASS — 5 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main/fattura-parse.js tests/test-fattura-parse.js
git commit -m "feat: parse FatturaPA XML into normalized documents"
```

---

## Task 3: Classification, dedup key and reverse charge

**Files:**
- Create: `src/main/fattura-classify.js`
- Create: `tests/test-fattura-classify.js`

**Interfaces:**
- Consumes: `ParsedDoc` from Task 2.
- Produces:
  - `normalizeId(value: string) => string` — uppercase, non-alphanumerics stripped, leading `IT` dropped when the remainder is 11 digits.
  - `classify(doc: ParsedDoc, studioIds: string[]) => { direction, reverseCharge, counterparty, needsReview, reviewReason }`
  - `dedupKey(doc: ParsedDoc) => string` — `"<cedenteId>|<tipoDoc>|<number>|<date>"`.
  - `TIPO_DOC` — map of code → `{ label, forcePassive?: true, reverseCharge?: true }`.
  - Throws `Error('studioIds mancante')` when `studioIds` is empty.

- [ ] **Step 1: Write the failing test**

Create `tests/test-fattura-classify.js`:

```js
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/test-fattura-classify.js`
Expected: FAIL — `Cannot find module '../src/main/fattura-classify'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/fattura-classify.js`:

```js
// Decides whether a parsed document is active or passive, whether it is a
// reverse-charge self-invoice, and what identity it dedups on. Pure functions.

// forcePassive: the studio issues these, but they record a *purchase*.
// Counting them as revenue would inflate income by every foreign supplier bill.
const TIPO_DOC = {
  TD01: { label: 'Fattura' },
  TD02: { label: 'Acconto/anticipo su fattura' },
  TD03: { label: 'Acconto/anticipo su parcella' },
  TD04: { label: 'Nota di credito' },
  TD05: { label: 'Nota di debito' },
  TD06: { label: 'Parcella' },
  TD16: { label: 'Integrazione reverse charge interno', forcePassive: true, reverseCharge: true },
  TD17: { label: 'Integrazione/autofattura acquisto servizi estero', forcePassive: true, reverseCharge: true },
  TD18: { label: 'Integrazione acquisto beni intracomunitari', forcePassive: true, reverseCharge: true },
  TD19: { label: 'Integrazione/autofattura art. 17 c.2', forcePassive: true, reverseCharge: true },
  TD20: { label: 'Autofattura per regolarizzazione', forcePassive: true },
  TD21: { label: 'Autofattura per splafonamento', forcePassive: true },
  TD24: { label: 'Fattura differita' },
  TD25: { label: 'Fattura differita art. 21 c.4' },
  TD26: { label: 'Cessione di beni ammortizzabili' },
  TD27: { label: 'Fattura per autoconsumo' },
};

function normalizeId(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^IT\d{11}$/.test(raw) ? raw.slice(2) : raw;
}

function idsOf(party) {
  return [normalizeId(party.vat), normalizeId(party.cf)].filter(Boolean);
}

function classify(doc, studioIds) {
  const studio = (studioIds || []).map(normalizeId).filter(Boolean);
  if (!studio.length) throw new Error('studioIds mancante: configura P.IVA/CF in Impostazioni');

  const rule = TIPO_DOC[doc.tipoDoc];
  const isStudio = ids => ids.some(id => studio.includes(id));
  const studioIsCedente = isStudio(idsOf(doc.cedente));
  const studioIsCessionario = isStudio(idsOf(doc.cessionario));

  let direction;
  let needsReview = false;
  let reviewReason = null;

  if (rule && rule.forcePassive) {
    // Self-invoices record a purchase even though the studio issues them, so
    // TipoDocumento wins over party matching. The studio must still appear
    // SOMEWHERE on the document: if it appears nowhere, the file belongs to
    // someone else and is not ours to book. "Both parties" is deliberately not
    // flagged here — TD21 (splafonamento) legitimately has exactly that shape.
    direction = 'passive';
    if (!studioIsCedente && !studioIsCessionario) {
      needsReview = true;
      reviewReason = 'Lo studio non è nessuna delle parti del documento';
    }
  } else if (studioIsCedente && !studioIsCessionario) {
    direction = 'active';
  } else if (studioIsCessionario && !studioIsCedente) {
    direction = 'passive';
  } else {
    // Both or neither: cannot be decided safely, so ask instead of guessing.
    direction = studioIsCedente ? 'active' : 'passive';
    needsReview = true;
    reviewReason = studioIsCedente
      ? 'Lo studio risulta sia cedente sia cessionario'
      : 'Lo studio non è nessuna delle parti del documento';
  }

  if (!rule) {
    needsReview = true;
    // Append rather than overwrite: a document can be both unrecognised AND
    // unrelated to the studio, and the reviewer needs to see both reasons.
    reviewReason = [reviewReason, `TipoDocumento ${doc.tipoDoc || '(assente)'} non riconosciuto`]
      .filter(Boolean).join('; ');
  }

  return {
    direction,
    reverseCharge: !!(rule && rule.reverseCharge),
    counterparty: direction === 'active' ? doc.cessionario : doc.cedente,
    tipoDocLabel: rule ? rule.label : null,
    needsReview,
    reviewReason,
  };
}

// The cedente is stable across both copies of a reverse-charge self-invoice,
// which is what makes COPIA_x.xml and x.xml collapse to one record.
function dedupKey(doc) {
  const cedenteId = normalizeId(doc.cedente.vat) || normalizeId(doc.cedente.cf);
  return [cedenteId, doc.tipoDoc, String(doc.number).trim(), doc.date].join('|');
}

module.exports = { TIPO_DOC, normalizeId, classify, dedupKey };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/test-fattura-classify.js`
Expected: PASS — 14 tests.

Note: `normalizeId('IE1111111AA')` returns `IE1111111AA` unchanged (the `IT` rule only applies to Italian 11-digit VAT numbers), which is why the expected dedup key starts with `IE`.

- [ ] **Step 5: Commit**

```bash
git add src/main/fattura-classify.js tests/test-fattura-classify.js
git commit -m "feat: classify invoice direction, reverse charge and dedup key"
```

---

## Task 4: Unwrapping .p7m and .zip containers

**Files:**
- Create: `src/main/fattura-unwrap.js`
- Create: `tests/test-fattura-unwrap.js`

**Interfaces:**
- Consumes: nothing from earlier tasks (operates on buffers).
- Produces:
  - `unwrap(fileName: string, buffer: Buffer) => Array<{ name: string, xml: string }>` — dispatches on extension; a plain `.xml` yields a single entry.
  - `extractP7M(buffer: Buffer) => string` — XML payload of a CAdES-BES signed file.
  - `readZip(buffer: Buffer) => Array<{ name: string, data: Buffer }>` — stored and deflated entries.
  - Throws `Error('Contenuto XML non trovato nel file .p7m')` / `Error('Archivio ZIP non valido')`.

- [ ] **Step 1: Write the failing test**

Create `tests/test-fattura-unwrap.js`:

```js
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
  const xml = '\uFEFF' + fixtures.read('passiva-td04-nota-credito.xml');
  const plain = unwrap('a.xml', Buffer.from(xml, 'utf-8'))[0].xml;
  const signed = unwrap('a.xml.p7m', buildP7M(xml))[0].xml;
  assert.equal(plain.charCodeAt(0), 0x3c);   // '<', not U+FEFF
  assert.equal(plain, signed);               // identical bytes => identical dedup hash
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/test-fattura-unwrap.js`
Expected: FAIL — `Cannot find module '../src/main/fattura-unwrap'`.

- [ ] **Step 3: Write the implementation**

Create `src/main/fattura-unwrap.js`:

```js
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/test-fattura-unwrap.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/main/fattura-unwrap.js tests/test-fattura-unwrap.js
git commit -m "feat: unwrap .p7m and .zip invoice containers"
```

---

## Task 5: Database — invoices collection and supplier rules

**Files:**
- Modify: `src/main/db.js` (`_migrate`, `loadAll`, `saveCollection`, `importJSON`, `stats`; add `getKV`)
- Create: `tests/test-invoices-db.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `db.saveCollection('invoices', records)` — accepts records shaped as in the spec §2.1; persists `direction`, `monthKey`, `dedupKey` into their columns.
  - `db.loadAll()` → now also `{ invoices: Invoice[], supplierRules: object }`.
  - `db.getKV(key: string) => any` — public read for `studio`, `supplierRules`.
  - `db.stats()` → now also `{ invoices: number }`.
  - `db.exportJSON()` / `importJSON(json)` round-trip invoices and supplierRules.

- [ ] **Step 1: Write the failing test**

Create `tests/test-invoices-db.js`:

```js
// tests/test-invoices-db.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AppDB = require('../src/main/db');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

let seq = 0;
function makeTempDB() {
  const p = path.join(os.tmpdir(), `parcella-inv-${Date.now()}-${seq++}.db`);
  const db = new AppDB(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(p); } catch {} } };
}

const invoice = (over = {}) => ({
  id: 'inv_1',
  dedupKey: 'IE1111111AA|TD18|28/AU|2026-08-24',
  direction: 'passive',
  reverseCharge: true,
  tipoDoc: 'TD18',
  number: '28/AU',
  date: '2026-08-24',
  monthKey: '2026-08',
  sign: 1,
  counterparty: { name: 'FORNITORE ESTERO LIMITED', vat: 'IE1111111AA' },
  totals: { imponibile: 180, imposta: 39.6, documento: 219.6 },
  fiscal: { category: 'Software', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'open', date: null, amount: 219.6 },
  ...over,
});

test('saveCollection persists invoices and loadAll returns them', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    const { invoices } = db.loadAll();
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].dedupKey, 'IE1111111AA|TD18|28/AU|2026-08-24');
    near(invoices[0].totals.imposta, 39.6);
  } finally { cleanup(); }
});

test('invoices removed from the array are deleted', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice(), invoice({ id: 'inv_2', dedupKey: 'X|TD01|1|2026-01-01' })]);
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.loadAll().invoices.length, 1);
  } finally { cleanup(); }
});

test('stats counts invoices', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.stats().invoices, 1);
  } finally { cleanup(); }
});

test('supplierRules round-trip through kv', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveKV('supplierRules', { IE1111111AA: { category: 'Software', deductPct: 100 } });
    assert.equal(db.getKV('supplierRules').IE1111111AA.category, 'Software');
    assert.equal(db.loadAll().supplierRules.IE1111111AA.deductPct, 100);
  } finally { cleanup(); }
});

test('getKV returns null for a missing key', () => {
  const { db, cleanup } = makeTempDB();
  try { assert.equal(db.getKV('studio'), null); } finally { cleanup(); }
});

test('exportJSON/importJSON carry invoices and supplierRules', () => {
  const a = makeTempDB();
  const b = makeTempDB();
  try {
    a.db.saveCollection('invoices', [invoice()]);
    a.db.saveKV('supplierRules', { IE1111111AA: { category: 'Software', deductPct: 100 } });
    b.db.importJSON(a.db.exportJSON());
    const loaded = b.db.loadAll();
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].tipoDoc, 'TD18');
    assert.equal(loaded.supplierRules.IE1111111AA.category, 'Software');
  } finally { a.cleanup(); b.cleanup(); }
});

test('loadAll reports empty:false when only invoices exist', () => {
  const { db, cleanup } = makeTempDB();
  try {
    db.saveCollection('invoices', [invoice()]);
    assert.equal(db.loadAll().empty, false);
  } finally { cleanup(); }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/test-invoices-db.js`
Expected: FAIL — `Unknown collection: invoices`.

- [ ] **Step 3: Add the table to `_migrate`**

In `src/main/db.js`, inside the `this.db.exec(...)` template in `_migrate()`, after the `expenses` table definition and before the `CREATE INDEX` lines, add:

```sql
      CREATE TABLE IF NOT EXISTS invoices (
        id        TEXT PRIMARY KEY,
        direction TEXT,
        month_key TEXT,
        dedup_key TEXT UNIQUE,
        data      TEXT NOT NULL,
        ts        INTEGER DEFAULT (strftime('%s','now'))
      );
```

and after the existing indexes add:

```sql
      CREATE INDEX IF NOT EXISTS idx_inv_month ON invoices(month_key);
      CREATE INDEX IF NOT EXISTS idx_inv_dir   ON invoices(direction);
```

`CREATE TABLE IF NOT EXISTS` runs on every construction, so existing databases pick the table up on next launch with no migration step.

- [ ] **Step 4: Extend `loadAll` and add `getKV`**

In `loadAll()`, after the `expenses` line add:

```js
    // Single quotes around the JSON path are required: SQLite 3.53 treats a
    // double-quoted token as an identifier, so "$.date" raises "no such column".
    const invoices   = this.db.prepare("SELECT data FROM invoices ORDER BY date(json_extract(data,'$.date')), rowid").all().map(r => JSON.parse(r.data));
```

and add `supplierRules` next to the other kv reads:

```js
    const supplierRules = this._getKV('supplierRules') || {};
```

Change the returned object to include them, and widen the `empty` check so a database holding only invoices is not treated as a first launch:

```js
    return {
      clients, activities, expenses, invoices, studio, fiscal, docCounters, supplierRules,
      empty: clients.length === 0 && invoices.length === 0 && !studio,
    };
```

Add a public reader below `_setKV`:

```js
  getKV(key) {
    return this._getKV(key);
  }
```

- [ ] **Step 5: Teach `saveCollection` about invoices**

Replace the body of `saveCollection(key, data)` down to (and including) the `upsert` assignment with:

```js
    const allowed = ['clients', 'activities', 'expenses', 'invoices'];
    if (!allowed.includes(key)) throw new Error('Unknown collection: ' + key);

    const isClients = key === 'clients';
    const isInvoices = key === 'invoices';
    const upsert = isClients
      ? this.db.prepare(`INSERT OR REPLACE INTO clients (id, data, ts) VALUES (?, ?, strftime('%s','now'))`)
      : isInvoices
        ? this.db.prepare(`INSERT OR REPLACE INTO invoices (id, direction, month_key, dedup_key, data, ts) VALUES (?, ?, ?, ?, ?, strftime('%s','now'))`)
        : this.db.prepare(`INSERT OR REPLACE INTO ${key} (id, client_id, month_key, data, ts) VALUES (?, ?, ?, ?, strftime('%s','now'))`);
```

and inside the transaction loop, replace the `if (isClients) ... else ...` branch with:

```js
        if (isClients) {
          upsert.run(item.id, JSON.stringify(item));
        } else if (isInvoices) {
          upsert.run(item.id, item.direction || null, item.monthKey || null, item.dedupKey || null, JSON.stringify(item));
        } else {
          upsert.run(item.id, item.clientId || null, item.monthKey || null, JSON.stringify(item));
        }
```

- [ ] **Step 6: Extend `importJSON` and `stats`**

In `importJSON`, after the `expenses` line add:

```js
      if (data.invoices)      this.saveCollection('invoices', data.invoices);
      if (data.supplierRules) this._setKV('supplierRules', data.supplierRules);
```

In `stats()`, add to the returned object:

```js
      invoices:   this.db.prepare('SELECT COUNT(*) as n FROM invoices').get().n,
```

`exportJSON()` delegates to `loadAll()`, so it now carries both automatically.

- [ ] **Step 7: Run the test to verify it passes**

Run: `node --test tests/test-invoices-db.js`
Expected: PASS — 7 tests.

- [ ] **Step 8: Run the full suite for regressions**

Run: `npm test`
Expected: PASS — all suites, including the pre-existing `test-doc-counter.js`.

- [ ] **Step 9: Commit**

```bash
git add src/main/db.js tests/test-invoices-db.js
git commit -m "feat: store invoices and supplier rules in the database"
```

---

## Task 6: Import pipeline — manifest and finalize

**Files:**
- Create: `src/shared/categories.js`
- Create: `src/main/invoice-import.js`
- Create: `tests/test-invoice-import.js`

**Interfaces:**
- Consumes: `parseFattura` (Task 2), `classify`/`dedupKey`/`normalizeId` (Task 3), `unwrap` (Task 4).
- Produces:
  - `src/shared/categories.js` (UMD — `require`-able in main, `window.*` in the renderer): `CATEGORY_RULES`, `AMORTIZE_THRESHOLD` (516.46), `guessCategory(text: string) => string`.
  - `collectFiles(paths: string[]) => Array<{ sourcePath, name, buffer }>` — recursive, filters to `.xml`/`.p7m`/`.zip`.
  - `buildManifest({ files, existing, clients, supplierRules, studioIds }) => Manifest`
  - `Manifest = { items: ManifestItem[], skipped: Array<{ file, reason }>, counts: { nuove, duplicati, giaImportate, daRivedere } }`
  - `ManifestItem = { id, dedupKey, status: 'new'|'duplicate'|'imported', file, doc, direction, reverseCharge, counterparty, needsReview, reviewReason, proposal }`
  - `proposal = { clientId, clientName, linkedMonthKey, fiscal: { category, deductPct, vatDetractPct, amortize, amortYears, firstYearHalf }, settlement: { status, date, amount } }`
  - `finalizeRecords({ items, decisions, supplierRules }) => { records: Invoice[], supplierRules: object }` where `decisions` is `{ [itemId]: { accept: boolean, clientId, linkedMonthKey, fiscal, rememberSupplier } }`.
  - Throws `Error('studioIds mancante: ...')` (propagated from `classify`) when the studio identity is missing.

- [ ] **Step 1: Create the shared category table**

Create `src/shared/categories.js`:

```js
// Expense/cost categories and their default fiscal treatment.
// UMD: require()-able from the Electron main process, window.* in the renderer
// (there is no bundler — the renderer loads this via a <script> tag).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const CATEGORY_RULES = {
    "Trasferta": { deductPct: 100, vatPct: 10, vatExempt: false },
    "Pasti": { deductPct: 75, vatPct: 10, vatExempt: false, hint: "Pasti deducibili 75% (art. 109 TUIR)" },
    "Pernottamento": { deductPct: 75, vatPct: 10, vatExempt: false },
    "Software": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Stock photo": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Cancelleria": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Formazione": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Telefonia": { deductPct: 80, vatPct: 22, vatExempt: false, hint: "Telefonia deducibile 80% (art. 102 TUIR)" },
    "Utenze": { deductPct: 100, vatPct: 22, vatExempt: false, hint: "Energia, gas, internet dello studio" },
    "Commissioni bancarie": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Esenti IVA art. 10 DPR 633/72" },
    "Consulenze": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Auto": { deductPct: 20, vatPct: 22, vatExempt: false, hint: "Auto non strumentale: deducibilità 20%" },
    "Rimborso km": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Rimborso chilometrico al tasso ACI (fuori campo IVA). Importo = km × tariffa ACI vigente." },
    "Hardware": { deductPct: 100, vatPct: 22, vatExempt: false, hint: "Cespite > 516,46€ → ammortamento pluriennale" },
    "Assicurazioni": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Assicurazioni esenti IVA art. 10 DPR 633/72" },
    "Bolli/Tasse": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Operazioni fuori campo IVA" },
    "Altro": { deductPct: 100, vatPct: 22, vatExempt: false },
  };

  const AMORTIZE_THRESHOLD = 516.46;

  // ORDER IS THE POLICY: first match wins, so concrete categories precede
  // generic ones. A parking invoice reading "Totale soste" and "Canone
  // abbonamento" must land on Auto, not Software; a line reading "corso" is
  // training whatever its subject, so Formazione precedes Software.
  //
  // Each entry has two halves: STEMS take \w* so Italian inflections match
  // ("carburant" -> carburante, "pedagg" -> pedaggio/pedaggi), while genuinely
  // ambiguous short tokens stay whole words so they cannot swallow longer ones
  // ("monitor" must not match "monitoraggio", "sim" must not match
  // "simulazione", "volo" must not match "volontariato"). A trailing \b after a
  // stem is the bug this shape exists to prevent: it silently blocks every
  // inflected form, dropping real invoices into Altro at 100% deducibilita.
  const KEYWORDS = [
    [/\b(?:carburant|benzina|gasolio|pedagg|autostrad|sost[ae]|parchegg|pneumatic|revision)\w*|\b(?:noleggio auto|gasolio)\b/i, "Auto"],
    [/\b(?:notebook|laptop|macbook|stampant|hardware|computer|iphone|ipad|alimentator)\w*|\b(?:monitor|server|pc)\b/i, "Hardware"],
    [/\b(?:corso|corsi|formazion|training|webinar|certificazion)\w*/i, "Formazione"],
    [/\b(?:abbonament|licen[zc]|subscription|software|hosting|dominio|github|microsoft|adobe|figma)\w*|\b(?:saas|cloud)\b/i, "Software"],
    [/\b(?:telefon|fibra|connettivit)\w*|\b(?:mobile|sim|adsl)\b/i, "Telefonia"],
    // 'acqua' alone is not a utility signal — bottled water is a beverage
  // purchase, so utility matching keys on idric/acquedott instead.
  [/\b(?:energia|elettric|utenz|bolletta|bollette|idric|acquedott)\w*|\b(?:gas|enel|luce)\b/i, "Utenze"],
    [/\b(?:commission)\w*|\b(?:spese bancarie|bollo c\/c|canone conto)\b/i, "Commissioni bancarie"],
    [/\b(?:consulen|notai|commercialist|avvocat|perizi)\w*/i, "Consulenze"],
    [/\b(?:albergh|pernottament)\w*|\b(?:hotel|albergo|b&b)\b/i, "Pernottamento"],
    [/\b(?:ristorant|catering)\w*|\b(?:pranzo|pranzi|cena|cene|bar|menu|menù|coperto)\b/i, "Pasti"],
    [/\b(?:trasfert|bigliett|trenitalia)\w*|\b(?:treno|treni|italo|volo|voli|aereo|taxi)\b/i, "Trasferta"],
    [/\b(?:cancelleri|toner)\w*|\b(?:carta|ufficio)\b/i, "Cancelleria"],
    [/\b(?:polizz|assicurazion)\w*|\brc professionale\b/i, "Assicurazioni"],
    [/\b(?:imposta di bollo|marca da bollo|diritti camerali)\b/i, "Bolli/Tasse"],
  ];

  function guessCategory(text) {
    const s = String(text || '');
    for (const [re, category] of KEYWORDS) if (re.test(s)) return category;
    return "Altro";
  }

  return { CATEGORY_RULES, AMORTIZE_THRESHOLD, guessCategory };
});
```

- [ ] **Step 2: Write the failing test**

Create `tests/test-invoice-import.js`:

```js
// tests/test-invoice-import.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildManifest, finalizeRecords } = require('../src/main/invoice-import');
const fixtures = require('./fixtures');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

const STUDIO = [fixtures.STUDIO.piva, fixtures.STUDIO.cf];

const file = name => ({ sourcePath: `/tmp/${name}`, name, buffer: Buffer.from(fixtures.read(name), 'utf-8') });

const CLIENTS = [
  { id: 'c1', name: 'Cliente Alfa', piva: 'IT09876543210' },
  { id: 'c2', name: 'Altro Cliente', piva: 'IT11111111111' },
];

const base = (over = {}) => ({
  files: [], existing: { dedupKeys: [], hashes: [] }, clients: CLIENTS,
  supplierRules: {}, studioIds: STUDIO, ...over,
});

test('an active invoice proposes the matching client and its month', () => {
  const m = buildManifest(base({ files: [file('attiva-td01-ritenuta-cassa.xml')] }));
  assert.equal(m.items.length, 1);
  const it = m.items[0];
  assert.equal(it.direction, 'active');
  assert.equal(it.status, 'new');
  assert.equal(it.proposal.clientId, 'c1');
  assert.equal(it.proposal.linkedMonthKey, '2026-07');
  near(it.proposal.settlement.amount, 7612.80);
});

test('a passive invoice proposes a category from its lines', () => {
  const m = buildManifest(base({ files: [file('passiva-td01-multirate.xml')] }));
  const it = m.items[0];
  assert.equal(it.direction, 'passive');
  assert.equal(it.proposal.clientId, null);
  assert.equal(it.proposal.fiscal.category, 'Auto');       // "Totale soste"
  assert.equal(it.proposal.fiscal.deductPct, 20);
});

test('a remembered supplier rule wins over the keyword guess', () => {
  const m = buildManifest(base({
    files: [file('passiva-td01-multirate.xml')],
    supplierRules: { '05550001112': { category: 'Trasferta', deductPct: 100, vatDetractPct: 100, amortize: false } },
  }));
  assert.equal(m.items[0].proposal.fiscal.category, 'Trasferta');
  assert.equal(m.items[0].proposal.fiscal.deductPct, 100);
});

test('the same self-invoice in both exports collapses to one item', () => {
  const m = buildManifest(base({
    files: [file('autofattura-td18-signed.xml'), file('COPIA_autofattura-td18-signed.xml')],
  }));
  assert.equal(m.items.length, 1);
  assert.equal(m.items[0].direction, 'passive');
  assert.equal(m.items[0].reverseCharge, true);
  assert.equal(m.counts.duplicati, 1);
});

test('an already-imported document is marked, not re-proposed', () => {
  const m = buildManifest(base({
    files: [file('autofattura-td18-signed.xml')],
    existing: { dedupKeys: ['IE1111111AA|TD18|28/AU|2026-08-24'], hashes: [] },
  }));
  assert.equal(m.items[0].status, 'imported');
  assert.equal(m.counts.giaImportate, 1);
});

test('a cespite above the threshold is proposed with amortization', () => {
  const m = buildManifest(base({ files: [file('attiva-td01-ritenuta-cassa.xml')] }));
  // active invoices carry no fiscal proposal
  assert.equal(m.items[0].proposal.fiscal, null);

  const hw = buildManifest(base({
    files: [{
      sourcePath: '/tmp/hw.xml', name: 'hw.xml',
      buffer: Buffer.from(fixtures.read('passiva-td01-multirate.xml')
        .replace('Totale soste (IVA 22.00)', 'MacBook Pro 14 notebook')
        .replace('Canone abbonamento (IVA 22.00)', 'Alimentatore notebook')
        .replace('<ImponibileImporto>5.50</ImponibileImporto>', '<ImponibileImporto>2499.00</ImponibileImporto>'), 'utf-8'),
    }],
  }));
  assert.equal(hw.items[0].proposal.fiscal.category, 'Hardware');
  assert.equal(hw.items[0].proposal.fiscal.amortize, true);
  assert.equal(hw.items[0].proposal.fiscal.amortYears, 4);
  assert.equal(hw.items[0].proposal.fiscal.firstYearHalf, true);
});

test('unreadable files are skipped with a reason, not fatal', () => {
  const m = buildManifest(base({
    files: [
      { sourcePath: '/tmp/bad.xml', name: 'bad.xml', buffer: Buffer.from('<?xml version="1.0"?><nope/>', 'utf-8') },
      file('passiva-td04-nota-credito.xml'),
    ],
  }));
  assert.equal(m.skipped.length, 1);
  assert.equal(m.skipped[0].file, 'bad.xml');
  assert.match(m.skipped[0].reason, /FatturaElettronica/);
  assert.equal(m.items.length, 1);
});

test('finalizeRecords builds records only for accepted items and remembers suppliers', () => {
  const m = buildManifest(base({ files: [file('passiva-td01-multirate.xml'), file('passiva-td04-nota-credito.xml')] }));
  const [a, b] = m.items;
  const { records, supplierRules } = finalizeRecords({
    items: m.items,
    decisions: {
      [a.id]: { accept: true, fiscal: { category: 'Utenze', deductPct: 100, vatDetractPct: 100, amortize: false }, rememberSupplier: true },
      [b.id]: { accept: false },
    },
    supplierRules: {},
  });
  assert.equal(records.length, 1);
  assert.equal(records[0].fiscal.category, 'Utenze');
  assert.equal(records[0].direction, 'passive');
  assert.equal(records[0].reviewedAt > 0, true);
  assert.equal(records[0].settlement.status, 'open');
  assert.equal(supplierRules['05550001112'].category, 'Utenze');
});

test('a TD04 record keeps sign -1 so it subtracts downstream', () => {
  const m = buildManifest(base({ files: [file('passiva-td04-nota-credito.xml')] }));
  const { records } = finalizeRecords({
    items: m.items,
    decisions: { [m.items[0].id]: { accept: true } },
    supplierRules: {},
  });
  assert.equal(records[0].sign, -1);
  assert.equal(records[0].tipoDoc, 'TD04');
});

test('category inference handles Italian inflections without over-matching', () => {
  const { guessCategory } = require('../src/shared/categories');
  const expected = [
    ['Canone abbonamento mensile', 'Software'], ['Licenza software annuale', 'Software'],
    ['Servizio di telefonia mobile', 'Telefonia'], ['Fornitura energia elettrica', 'Utenze'],
    ['Utenze idriche', 'Utenze'], ['Commissioni bancarie trimestrali', 'Commissioni bancarie'],
    ['Consulenza fiscale', 'Consulenze'], ['Carburante per autovettura', 'Auto'],
    ['Pedaggio autostradale', 'Auto'], ['Parcheggio aeroporto', 'Auto'],
    ['Sostituzione pneumatici', 'Auto'], ['Totale soste (IVA 22.00)', 'Auto'],
    ['Pernottamento hotel Roma', 'Pernottamento'], ['Cena di lavoro ristorante', 'Pasti'],
    ['Trasferta Milano', 'Trasferta'], ['Cancelleria varia', 'Cancelleria'],
    ['Assicurazione RC professionale', 'Assicurazioni'], ['MacBook Pro 14 notebook', 'Hardware'],
    ['Corso di formazione cloud', 'Formazione'], ['Marca da bollo', 'Bolli/Tasse'],
  ];
  for (const [desc, want] of expected) assert.equal(guessCategory(desc), want, desc);

  // Near-misses: these must NOT be captured by the stem they resemble, because
  // each would propose a wrong deducibilita on a real document.
  const forbidden = [
    ["Ritenuta sostituto d'imposta", 'Auto'], ['Servizio di monitoraggio infrastruttura', 'Hardware'],
    ['Simulazione finanziaria', 'Telefonia'], ['Attivita di volontariato aziendale', 'Trasferta'],
    ['Prodotti gastronomici', 'Utenze'], ['Mastercard commissioni', 'Formazione'],
  ];
  for (const [desc, wrong] of forbidden) assert.notEqual(guessCategory(desc), wrong, desc);
});

test('proposals match how the user\'s real invoices actually read', () => {
  const { guessCategory } = require('../src/shared/categories');
  // Line text taken verbatim from real Agenzia delle Entrate exports.
  assert.equal(guessCategory('MENU A PREZZO FISSO Tavolo: 93'), 'Pasti');          // 75%, not 100%
  assert.equal(guessCategory('acqua santo stefano 1\\2 lt x 24 bt pet'), 'Altro'); // a drink, not a water bill
  assert.equal(guessCategory('Virtual Machines Bsv2 Series'), 'Altro');            // no signal in the line...
  assert.equal(guessCategory('Microsoft Srl'), 'Software');                        // ...but the supplier has one
  assert.equal(guessCategory('INTEGRAZIONE FATTURA N. 9BF DEL 21/08/2026'), 'Altro');
  assert.equal(guessCategory('GITHUB INC'), 'Software');
});

test('safeArchiveName contains every path-traversal attempt', () => {
  const path = require('path');
  const { safeArchiveName } = require('../src/main/invoice-import');
  const dir = path.join('/archive', '2026');
  const attacks = [
    '../../../../../../Users/x/.zshrc',
    '..\\..\\..\\Windows\\System32\\evil.xml',
    'sub/dir/fattura.xml',
    '....//....//etc/passwd',
    '',
    null,
  ];
  for (const a of attacks) {
    const dest = path.join(dir, 'deadbeef_' + safeArchiveName(a));
    assert.ok(dest.startsWith(dir + path.sep), `escaped the archive dir: ${a}`);
  }
  // Containment alone cannot police the backslash normalization: on POSIX a
  // backslash payload never traverses anyway, so the assertion above passes
  // with or without the guard. Assert the OUTPUT, which differs — without the
  // normalization basename returns the whole string, since it splits only on
  // '/'. This is what fails if a future edit drops the .replace().
  assert.equal(safeArchiveName('..\\..\\..\\Windows\\System32\\evil.xml'), 'evil.xml');

  // Real Agenzia delle Entrate filenames must survive untouched.
  assert.equal(safeArchiveName('IT04204200135_0JILg.xml'), 'IT04204200135_0JILg.xml');
  assert.equal(safeArchiveName('COPIA_IT04204200135_0KDbm.xml'), 'COPIA_IT04204200135_0KDbm.xml');
});

test('archiveYear falls back rather than naming a folder from undefined', () => {
  const { archiveYear } = require('../src/main/invoice-import');
  assert.equal(archiveYear('2026-08-31'), '2026');
  assert.equal(archiveYear(undefined), 'senza-data');
  assert.equal(archiveYear(''), 'senza-data');
  assert.equal(archiveYear('not-a-date'), 'senza-data');
});

test('buildManifest refuses to run without the studio identity', () => {
  assert.throws(() => buildManifest(base({ files: [file('passiva-td04-nota-credito.xml')], studioIds: [] })), /studioIds/);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --test tests/test-invoice-import.js`
Expected: FAIL — `Cannot find module '../src/main/invoice-import'`.

- [ ] **Step 4: Write the implementation**

Create `src/main/invoice-import.js`:

```js
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
  const amortize = doc.totals.imponibile >= AMORTIZE_THRESHOLD && category === 'Hardware';
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --test tests/test-invoice-import.js`
Expected: PASS — 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/shared/categories.js src/main/invoice-import.js tests/test-invoice-import.js
git commit -m "feat: build import manifest with dedup, client and category proposals"
```

---

## Task 7: IPC wiring and archiving

**Files:**
- Modify: `src/main/main.js` (add handlers after the `db:*` block)
- Modify: `src/main/preload.js` (expose `window.api.invoices`)

**Interfaces:**
- Consumes: `collectFiles`, `buildManifest`, `finalizeRecords` (Task 6); `db.getKV`, `db.loadAll` (Task 5).
- Produces (renderer-visible):
  - `window.api.invoices.chooseSource()` → `string[] | null` (cancelled)
  - `window.api.invoices.scan(paths)` → `Manifest` (throws with a readable message when the studio P.IVA is unset)
  - `window.api.invoices.commit({ items, decisions })` → `{ records, supplierRules }` — archives accepted files and stamps `src.archivePath`; **does not write to the DB** (the renderer owns persistence, as it does for every other collection)
  - `window.api.invoices.openOriginal(archivePath)` → `boolean`

- [ ] **Step 1: Add the requires in `main.js`**

At the top of `src/main/main.js`, next to the existing `AppDB` require:

```js
const { collectFiles, buildManifest, finalizeRecords, safeArchiveName, archiveYear } = require('./invoice-import');
```

- [ ] **Step 2: Add the handlers**

In `createWindow()`, immediately after the `db:resetDocCounter` handler, insert:

```js
  // ── Fatture elettroniche ─────────────────────────────────────────
  const invoiceArchiveDir = path.join(userData, 'invoices');

  function studioIdentity() {
    const studio = db.getKV('studio') || {};
    return [studio.piva, studio.cf].filter(Boolean);
  }

  ipcMain.handle('invoices:chooseSource', async () => {
    const result = await dialog.showOpenDialog(win, {
      title: 'Seleziona le fatture da importare',
      filters: [{ name: 'Fatture elettroniche', extensions: ['xml', 'p7m', 'zip'] }],
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    return result.canceled ? null : result.filePaths;
  });

  ipcMain.handle('invoices:scan', (_, { paths }) => {
    const { invoices, clients, supplierRules } = db.loadAll();
    const files = collectFiles(paths);
    return buildManifest({
      files,
      existing: {
        dedupKeys: invoices.map(i => i.dedupKey),
        hashes: invoices.map(i => i.src && i.src.sha256).filter(Boolean),
      },
      clients,
      supplierRules,
      studioIds: studioIdentity(),
    });
  });

  ipcMain.handle('invoices:commit', (_, { items, decisions }) => {
    const { supplierRules } = db.loadAll();
    const result = finalizeRecords({ items, decisions, supplierRules });

    // Archive the originals so the ledger survives the Downloads folder
    // being emptied, and so the detail view can always show the document.
    for (const rec of result.records) {
      const item = items.find(i => i.id === rec.id);
      if (!item || !item.file.sourcePath) continue;
      try {
        // Everything filesystem-related is inside the try, mkdirSync included:
        // a directory that cannot be created must cost this record its archive
        // copy, never the whole batch's invoice data.
        const yearDir = path.join(invoiceArchiveDir, archiveYear(rec.date));
        fs.mkdirSync(yearDir, { recursive: true });
        // safeArchiveName keeps a crafted zip-entry name from steering the
        // write path; it is tested in tests/test-invoice-import.js.
        const dest = path.join(yearDir, `${rec.src.sha256.slice(0, 8)}_${safeArchiveName(rec.src.fileName)}`);
        if (!fs.existsSync(dest)) fs.copyFileSync(item.file.sourcePath, dest);
        rec.src.archivePath = dest;
      } catch (err) {
        rec.src.archivePath = null;
        rec.notes = [rec.notes, `Archiviazione non riuscita: ${err.message}`].filter(Boolean).join(' — ');
      }
    }
    return result;
  });

  ipcMain.handle('invoices:openOriginal', (_, archivePath) => {
    if (!archivePath || !fs.existsSync(archivePath)) return false;
    shell.showItemInFolder(archivePath);
    return true;
  });
```

`userData`, `fs`, `path`, `dialog` and `shell` are already in scope in `main.js`.

- [ ] **Step 3: Expose the API in `preload.js`**

In `src/main/preload.js`, inside the `contextBridge.exposeInMainWorld('api', { ... })` object, after the `db` block, add:

```js
  invoices: {
    chooseSource: ()       => ipcRenderer.invoke('invoices:chooseSource'),
    scan:         (paths)  => ipcRenderer.invoke('invoices:scan', { paths }),
    commit:       (payload)=> ipcRenderer.invoke('invoices:commit', payload),
    openOriginal: (p)      => ipcRenderer.invoke('invoices:openOriginal', p),
  },
```

- [ ] **Step 3b: Bring the JSON fallback to parity**

`main.js` falls back to `src/main/db-json.js` whenever `better-sqlite3` fails to
load (a native ABI mismatch after an Electron upgrade is the usual cause). That
fallback predates this feature and knows nothing about invoices — and critically
it has **no `getKV` method**, so `studioIdentity()` would throw
`db.getKV is not a function` and the import wizard would fail outright on any
machine using it. Four small changes give it parity:

```js
// 1. default shape — so loadAll() returns [] / {} rather than undefined
    this._data = { clients: [], activities: [], expenses: [], invoices: [], studio: null, fiscal: null, supplierRules: {} };

// 2. the missing reader used by the invoice IPC handlers
  getKV(key) {
    return this._data[key] !== undefined ? this._data[key] : null;
  }

// 3. a database holding only invoices is not a fresh install
        this._empty = this._data.clients.length === 0
          && (this._data.invoices || []).length === 0
          && !this._data.studio;

// 4. stats() reports invoices alongside the other collections
      invoices:   (this._data.invoices || []).length,
```

`saveCollection` and `saveKV` are already generic, so invoices and
`supplierRules` persist through them unchanged; `exportJSON`/`importJSON`
serialize `_data` wholesale and inherit both automatically.

- [ ] **Step 4: Verify the app still boots**

Run: `npm start`
Expected: the app window opens as before with no console errors. In DevTools, `window.api.invoices` lists the four functions. Close the app.

- [ ] **Step 5: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "feat: wire invoice import IPC and original-file archiving"
```

---

## Task 8: Extract the fiscal engine

**Files:**
- Create: `src/renderer/fiscal.js`
- Create: `tests/test-fiscal-expense.js`
- Modify: `src/renderer/components/expenses.jsx:1-51` (delegate to `fiscal.js`, keep the `window.*` exports)
- Modify: `src/renderer/index.html` (script tags)

**Interfaces:**
- Consumes: `CATEGORY_RULES`, `AMORTIZE_THRESHOLD` from `src/shared/categories.js` (Task 6).
- Produces (UMD — `require`-able in Node, `window.*` in the renderer):
  - `computeExpenseFiscals(e) => { gross, net, vat, vatDetracted, yearlyDeducted, inAmortization, nonDeductible }` — behaviour identical to today's function.
  - `invoiceCostFiscals(inv) => { imponibile, imposta, vatDetracted, deductible, inAmortization }` — signed (TD04 flows through with `sign: -1`). It does NOT branch on `reverseCharge`: a reverse-charge document's COST treatment is identical to any other purchase. The reverse-charge asymmetry is purely a VAT-period concern and lives in `computeFiscalYear`, which routes the same `imposta` to both debito and credito.
  - `buildAmortSchedule(inv) => { id, desc, date, startYear, cost, years, firstYearHalf, quotas: Array<{ year, amount }> }`
  - `amortQuotaFor(schedule, year) => number`, `amortResidualAt(schedule, year) => number`

- [ ] **Step 1: Write the failing test**

Create `tests/test-fiscal-expense.js`:

```js
// tests/test-fiscal-expense.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeExpenseFiscals, invoiceCostFiscals,
  buildAmortSchedule, amortQuotaFor, amortResidualAt,
} = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

test('computeExpenseFiscals keeps the existing behaviour for a studio expense', () => {
  const f = computeExpenseFiscals({ amount: 122, vatPct: 22, vatExempt: false, deductPct: 80, billable: false, amortize: false });
  near(f.net, 100);
  near(f.vat, 22);
  near(f.vatDetracted, 17.6);
  near(f.yearlyDeducted, 80);
  near(f.nonDeductible, 20);
});

test('computeExpenseFiscals recovers full VAT on billable expenses', () => {
  const f = computeExpenseFiscals({ amount: 122, vatPct: 22, vatExempt: false, deductPct: 20, billable: true, amortize: false });
  near(f.vatDetracted, 22);
});

test('invoiceCostFiscals applies deductPct and vatDetractPct', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: 1,
    totals: { imponibile: 100, imposta: 22 },
    fiscal: { category: 'Telefonia', deductPct: 80, vatDetractPct: 100, amortize: false },
  });
  near(f.imponibile, 100);
  near(f.vatDetracted, 22);
  near(f.deductible, 80);
});

test('invoiceCostFiscals signs a credit note negatively', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: -1,
    totals: { imponibile: 65.58, imposta: 14.43 },
    fiscal: { category: 'Altro', deductPct: 100, vatDetractPct: 100, amortize: false },
  });
  near(f.imponibile, -65.58);
  near(f.deductible, -65.58);
  near(f.vatDetracted, -14.43);
});

test('an amortized invoice deducts nothing in the current-cost sense', () => {
  const f = invoiceCostFiscals({
    direction: 'passive', reverseCharge: false, sign: 1,
    totals: { imponibile: 2400, imposta: 528 },
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  assert.equal(f.inAmortization, true);
  near(f.deductible, 0);          // the deduction comes from the schedule instead
  near(f.vatDetracted, 528);      // but VAT is detracted in full, immediately
});

test('buildAmortSchedule halves the first and final year', () => {
  const s = buildAmortSchedule({
    id: 'inv_x', date: '2026-05-15', causale: 'MacBook', lines: [{ desc: 'MacBook Pro' }],
    totals: { imponibile: 2400 },
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  assert.equal(s.startYear, 2026);
  assert.deepEqual(s.quotas.map(q => q.year), [2026, 2027, 2028, 2029, 2030]);
  near(s.quotas[0].amount, 300);
  near(s.quotas[1].amount, 600);
  near(s.quotas[4].amount, 300);
  near(s.quotas.reduce((t, q) => t + q.amount, 0), 2400);
});

test('buildAmortSchedule without the half rule spreads evenly', () => {
  const s = buildAmortSchedule({
    id: 'inv_y', date: '2026-05-15', totals: { imponibile: 2400 }, lines: [],
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: false },
  });
  assert.equal(s.quotas.length, 4);
  near(s.quotas[0].amount, 600);
});

test('amortQuotaFor and amortResidualAt read the schedule', () => {
  const s = buildAmortSchedule({
    id: 'inv_z', date: '2026-05-15', totals: { imponibile: 2400 }, lines: [],
    fiscal: { deductPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
  });
  near(amortQuotaFor(s, 2026), 300);
  near(amortQuotaFor(s, 2031), 0);
  near(amortResidualAt(s, 2026), 2100);
  near(amortResidualAt(s, 2030), 0);
});

test('deductPct reduces the amortizable base', () => {
  const s = buildAmortSchedule({
    id: 'inv_w', date: '2026-01-01', totals: { imponibile: 1000 }, lines: [],
    fiscal: { deductPct: 20, amortize: true, amortYears: 4, firstYearHalf: false },
  });
  near(s.quotas.reduce((t, q) => t + q.amount, 0), 200);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/test-fiscal-expense.js`
Expected: FAIL — `Cannot find module '../src/renderer/fiscal'`.

- [ ] **Step 3: Write the implementation**

Create `src/renderer/fiscal.js`:

```js
// Fiscal engine. Deliberately free of React so that Node tests can assert the
// rules directly — reverse-charge neutrality and the no-double-count rule are
// not things you can verify by eyeballing a KPI.
//
// UMD: require()-able in tests/main, window.* in the renderer (no bundler).
(function (root, factory) {
  const categories = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/categories')
    : { CATEGORY_RULES: root.CATEGORY_RULES, AMORTIZE_THRESHOLD: root.AMORTIZE_THRESHOLD };
  const api = factory(categories);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (categories) {

  const { CATEGORY_RULES, AMORTIZE_THRESHOLD } = categories;
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const pct = v => (v == null ? 100 : Number(v));

  // ── Manual expenses: behaviour preserved exactly as it was in expenses.jsx ──
  function computeExpenseFiscals(e) {
    const gross = e.amount;
    const net = e.vatExempt ? gross : gross / (1 + (e.vatPct || 0) / 100);
    const vat = gross - net;
    const vatDetracted = e.billable
      ? vat
      : (e.vatExempt ? 0 : vat * Math.min(e.deductPct, 100) / 100);
    const yearlyDeducted = e.amortize
      ? (net * e.deductPct / 100) / (e.amortYears || 4)
      : net * e.deductPct / 100;
    const inAmortization = e.amortize === true
      || (!e.billable && net > AMORTIZE_THRESHOLD && (e.category === "Hardware" || e.category === "Auto"));
    return {
      gross, net, vat, vatDetracted, yearlyDeducted, inAmortization,
      nonDeductible: net - (net * e.deductPct / 100),
    };
  }

  // ── Invoice-backed costs ───────────────────────────────────────────────────
  function invoiceCostFiscals(inv) {
    const f = inv.fiscal || {};
    const sign = inv.sign || 1;
    const imponibile = round2(sign * (inv.totals.imponibile || 0));
    const imposta = round2(sign * (inv.totals.imposta || 0));
    const inAmortization = !!f.amortize;
    return {
      imponibile,
      imposta,
      // VAT is detracted at once even for a cespite; only the cost is spread.
      vatDetracted: round2(imposta * pct(f.vatDetractPct) / 100),
      deductible: inAmortization ? 0 : round2(imponibile * pct(f.deductPct) / 100),
      inAmortization,
    };
  }

  // ── Ammortamenti ───────────────────────────────────────────────────────────
  // art. 102 TUIR: the first year's quota is halved, which pushes a final
  // half-quota into year start+years.
  function buildAmortSchedule(inv) {
    const f = inv.fiscal || {};
    const years = Math.max(1, Number(f.amortYears) || 4);
    const base = round2(Math.abs(inv.totals.imponibile || 0) * pct(f.deductPct) / 100);
    const full = base / years;
    const startYear = Number(String(inv.date || '').slice(0, 4));
    const half = f.firstYearHalf !== false;

    const quotas = [];
    if (half) {
      quotas.push({ year: startYear, amount: round2(full / 2) });
      for (let i = 1; i < years; i++) quotas.push({ year: startYear + i, amount: round2(full) });
      quotas.push({ year: startYear + years, amount: round2(full / 2) });
    } else {
      for (let i = 0; i < years; i++) quotas.push({ year: startYear + i, amount: round2(full) });
    }

    // Push any rounding drift onto the last quota so the schedule totals the base.
    const drift = round2(base - quotas.reduce((s, q) => s + q.amount, 0));
    if (drift !== 0) quotas[quotas.length - 1].amount = round2(quotas[quotas.length - 1].amount + drift);

    return {
      id: inv.id,
      desc: inv.causale || (inv.lines && inv.lines[0] && inv.lines[0].desc) || '',
      date: inv.date,
      startYear,
      cost: base,
      years,
      firstYearHalf: half,
      quotas,
    };
  }

  function amortQuotaFor(schedule, year) {
    const q = schedule.quotas.find(x => x.year === Number(year));
    return q ? q.amount : 0;
  }

  function amortResidualAt(schedule, year) {
    const spent = schedule.quotas.filter(q => q.year <= Number(year)).reduce((s, q) => s + q.amount, 0);
    return round2(schedule.cost - spent);
  }

  return {
    round2, CATEGORY_RULES, AMORTIZE_THRESHOLD,
    computeExpenseFiscals, invoiceCostFiscals,
    buildAmortSchedule, amortQuotaFor, amortResidualAt,
  };
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/test-fiscal-expense.js`
Expected: PASS — 9 tests.

- [ ] **Step 5: Load the new files in the renderer**

In `src/renderer/index.html`, replace the line `<script src="i18n.js"></script>` block start so the shared and fiscal modules load before any component (order matters — there is no bundler):

```html
  <script src="i18n.js"></script>
  <script src="../shared/categories.js"></script>
  <script src="fiscal.js"></script>
  <script src="data.js"></script>
  <script src="storage.js"></script>
```

- [ ] **Step 6: Make `expenses.jsx` delegate instead of duplicating**

In `src/renderer/components/expenses.jsx`, delete the local `CATEGORY_RULES` object, `AMORTIZE_THRESHOLD` constant and the whole `function computeExpenseFiscals(e) { ... }` body (lines 9–48), and replace them with:

```js
// Fiscal rules live in src/renderer/fiscal.js and src/shared/categories.js so
// that Node tests can assert them. These aliases keep existing call sites working.
const CATEGORY_RULES = window.CATEGORY_RULES;
const AMORTIZE_THRESHOLD = window.AMORTIZE_THRESHOLD;
const computeExpenseFiscals = window.computeExpenseFiscals;
```

Leave the three `window.*` assignment lines that follow (`window.computeExpenseFiscals = ...` etc.) in place — they are now harmless self-assignments and keep the file's public surface explicit.

- [ ] **Step 7: Verify the app still works**

Run: `npm start`
Expected: the Spese screen renders with identical totals to before; no console errors. Close the app.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/fiscal.js src/renderer/index.html src/renderer/components/expenses.jsx tests/test-fiscal-expense.js
git commit -m "refactor: extract fiscal rules into a testable fiscal.js module"
```

---

## Task 9: `computeFiscalYear` — the merge

**Files:**
- Modify: `src/renderer/fiscal.js` (add `computeFiscalYear`)
- Create: `tests/test-fiscal-year.js`

**Interfaces:**
- Consumes: `invoiceCostFiscals`, `buildAmortSchedule`, `amortQuotaFor` (Task 8).
- Produces:

```js
computeFiscalYear({ year, invoices, activities, expenses, clients, fiscal, computeInvoiceAmounts })
=> {
  year,
  consuntivo: { ricavi, ricaviIncassati, ritenutaSubita, ritenutaIncassata,
                cassaRivalsa, costiCompetenza, costiDeducibili,
                ivaDebito, ivaCredito, ivaReverse, ivaSaldo },
  previsionale: { ricavi, months: Array<{ clientId, monthKey, imponibile }> },
  coveredMonths: { [`${clientId}|${monthKey}`]: invoiceId },
  periods: Array<{ id, label, months, ivaDebito, ivaCredito, ivaReverse, saldo }>,
  cespiti: Array<Schedule & { quotaYear, residual }>,
  costiPerCategoria: { [category]: number },
  scadenze: Array<{ id, date, direction, counterparty, amount }>,
}
```

`computeInvoiceAmounts` is injected (it lives in `shared.jsx:348`); it defaults to `globalThis.computeInvoiceAmounts` in the browser.

- [ ] **Step 1: Write the failing test**

Create `tests/test-fiscal-year.js`:

```js
// tests/test-fiscal-year.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFiscalYear } = require('../src/renderer/fiscal');

const near = (a, b, tol = 0.011) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);

// Stand-in for shared.jsx:computeInvoiceAmounts — hourly clients only.
const computeInvoiceAmounts = (client, hours) => {
  const imponibile = hours * (client.hourlyRate || 0);
  const cassa = imponibile * (client.cassaPct || 0) / 100;
  const iva = (imponibile + cassa) * (client.vatPct || 0) / 100;
  return { imponibile, cassa, iva, withholding: 0, total: imponibile + cassa + iva };
};

const CLIENTS = [{ id: 'c1', name: 'Alfa', hourlyRate: 100, cassaPct: 4, vatPct: 22, billingType: 'hourly' }];

const activeInvoice = (over = {}) => ({
  id: 'inv_a', direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-07-31', monthKey: '2026-07', clientId: 'c1', linkedMonthKey: '2026-07',
  totals: { imponibile: 6240, imposta: 1372.80, documento: 7612.80 },
  vatSummary: [{ vatPct: 22, imponibile: 6240, imposta: 1372.80 }],
  withholding: { importo: 1248, aliquota: 20 },
  cassa: { importo: 240, imponibile: 6000 },
  payment: { dueDate: '2026-08-30' },
  counterparty: { name: 'Alfa' },
  fiscal: null, settlement: { status: 'open', date: null, amount: 7612.80 },
  ...over,
});

const passiveInvoice = (over = {}) => ({
  id: 'inv_p', direction: 'passive', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
  date: '2026-08-31', monthKey: '2026-08',
  totals: { imponibile: 100, imposta: 22, documento: 122 },
  vatSummary: [{ vatPct: 22, imponibile: 100, imposta: 22 }],
  withholding: null, cassa: null, payment: { dueDate: '2026-09-30' },
  counterparty: { name: 'Fornitore', vat: '05550001112' },
  fiscal: { category: 'Utenze', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'settled', date: '2026-09-05', amount: 122 },
  ...over,
});

const reverseCharge = (over = {}) => ({
  id: 'inv_rc', direction: 'passive', reverseCharge: true, sign: 1, tipoDoc: 'TD18',
  date: '2026-08-24', monthKey: '2026-08',
  totals: { imponibile: 180, imposta: 39.60, documento: 219.60 },
  vatSummary: [{ vatPct: 22, imponibile: 180, imposta: 39.60 }],
  withholding: null, cassa: null, payment: null,
  counterparty: { name: 'Fornitore Estero', vat: 'IE1111111AA' },
  fiscal: { category: 'Software', deductPct: 100, vatDetractPct: 100, amortize: false },
  settlement: { status: 'settled', date: '2026-08-24', amount: 219.60 },
  ...over,
});

const run = over => computeFiscalYear({
  year: 2026, invoices: [], activities: [], expenses: [], clients: CLIENTS,
  fiscal: { ivaLiquidazione: 'trimestrale' }, computeInvoiceAmounts, ...over,
});

test('active invoices make the consuntivo revenue, cassa rivalsa included', () => {
  const r = run({ invoices: [activeInvoice()] });
  near(r.consuntivo.ricavi, 6240);
  near(r.consuntivo.cassaRivalsa, 240);
  near(r.consuntivo.ivaDebito, 1372.80);
  near(r.consuntivo.ritenutaSubita, 1248);
});

test('reverse charge is neutral on IVA and is never revenue', () => {
  const r = run({ invoices: [reverseCharge()] });
  near(r.consuntivo.ricavi, 0);                 // P3
  near(r.consuntivo.ivaDebito, 39.60);
  near(r.consuntivo.ivaCredito, 39.60);
  near(r.consuntivo.ivaSaldo, 0);
  near(r.consuntivo.ivaReverse, 39.60);
  near(r.consuntivo.costiDeducibili, 180);      // the imponibile is a cost
});

test('an invoiced month suppresses its timesheet forecast', () => {
  const activities = [
    { id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 60, day: 3 },
    { id: 'a2', clientId: 'c1', monthKey: '2026-09', hours: 10, day: 4 },
  ];
  const r = run({ invoices: [activeInvoice()], activities });
  near(r.consuntivo.ricavi, 6240);
  near(r.previsionale.ricavi, 1000);            // only September survives
  assert.equal(r.coveredMonths['c1|2026-07'], 'inv_a');
  assert.equal(r.previsionale.months.length, 1);
  assert.equal(r.previsionale.months[0].monthKey, '2026-09');
});

test('without any invoice every worked month is forecast', () => {
  const activities = [{ id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 60, day: 3 }];
  const r = run({ activities });
  near(r.consuntivo.ricavi, 0);
  near(r.previsionale.ricavi, 6000);
});

test('a credit note subtracts from revenue and from IVA a debito', () => {
  const nc = activeInvoice({
    id: 'inv_nc', tipoDoc: 'TD04', sign: -1, linkedMonthKey: null,
    totals: { imponibile: 1000, imposta: 220, documento: 1220 },
    vatSummary: [{ vatPct: 22, imponibile: 1000, imposta: 220 }],
    withholding: null, cassa: null,
  });
  const r = run({ invoices: [activeInvoice(), nc] });
  near(r.consuntivo.ricavi, 5240);
  near(r.consuntivo.ivaDebito, 1152.80);
});

test('costs follow settlement date, IVA follows document date', () => {
  const unpaid = passiveInvoice({ id: 'inv_u', settlement: { status: 'open', date: null, amount: 122 } });
  const r = run({ invoices: [unpaid] });
  near(r.consuntivo.ivaCredito, 22);        // detracted on the document date
  near(r.consuntivo.costiDeducibili, 0);    // not yet paid, so not yet deducted
  near(r.consuntivo.costiCompetenza, 100);
});

test('partial VAT detraction reduces the credit', () => {
  const r = run({ invoices: [passiveInvoice({ fiscal: { category: 'Auto', deductPct: 20, vatDetractPct: 40, amortize: false } })] });
  near(r.consuntivo.ivaCredito, 8.80);
  near(r.consuntivo.costiDeducibili, 20);
});

test('quarterly periods split IVA by document date', () => {
  const r = run({ invoices: [activeInvoice(), passiveInvoice()] });
  const q3 = r.periods.find(p => p.id === 'Q3');
  near(q3.ivaDebito, 1372.80);
  near(q3.ivaCredito, 22);
  near(q3.saldo, 1350.80);
  const q1 = r.periods.find(p => p.id === 'Q1');
  near(q1.saldo, 0);
});

test('monthly liquidation produces twelve periods', () => {
  const r = run({ invoices: [activeInvoice()], fiscal: { ivaLiquidazione: 'mensile' } });
  assert.equal(r.periods.length, 12);
  near(r.periods[6].ivaDebito, 1372.80);   // July
});

test('a cespite contributes its yearly quota, not its full cost', () => {
  const cespite = passiveInvoice({
    id: 'inv_c', date: '2026-05-15',
    totals: { imponibile: 2400, imposta: 528, documento: 2928 },
    vatSummary: [{ vatPct: 22, imponibile: 2400, imposta: 528 }],
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
    settlement: { status: 'settled', date: '2026-05-15', amount: 2928 },
  });
  const r = run({ invoices: [cespite] });
  near(r.consuntivo.costiDeducibili, 300);
  near(r.consuntivo.ivaCredito, 528);
  assert.equal(r.cespiti.length, 1);
  near(r.cespiti[0].quotaYear, 300);
  near(r.cespiti[0].residual, 2100);
});

test('an earlier cespite still contributes in later years', () => {
  const cespite = passiveInvoice({
    id: 'inv_c', date: '2025-05-15', monthKey: '2025-05',
    totals: { imponibile: 2400, imposta: 528, documento: 2928 },
    vatSummary: [{ vatPct: 22, imponibile: 2400, imposta: 528 }],
    fiscal: { category: 'Hardware', deductPct: 100, vatDetractPct: 100, amortize: true, amortYears: 4, firstYearHalf: true },
    settlement: { status: 'settled', date: '2025-05-15', amount: 2928 },
  });
  const r = run({ invoices: [cespite] });
  near(r.consuntivo.costiDeducibili, 600);   // 2026 is a full-quota year
  near(r.consuntivo.ivaCredito, 0);          // the 2025 document is not in this year's IVA
});

test('manual expenses still count and are grouped by category', () => {
  const expenses = [
    { id: 'e1', monthKey: '2026-03', amount: 122, vatPct: 22, vatExempt: false, deductPct: 100, billable: false, amortize: false, category: 'Cancelleria' },
    { id: 'e2', monthKey: '2026-03', amount: 100, vatPct: 22, vatExempt: false, deductPct: 100, billable: true, amortize: false, category: 'Trasferta' },
  ];
  const r = run({ invoices: [passiveInvoice()], expenses });
  near(r.consuntivo.costiDeducibili, 200);          // 100 invoice + 100 expense; billable excluded
  near(r.costiPerCategoria['Utenze'], 100);
  near(r.costiPerCategoria['Cancelleria'], 100);
  assert.equal(r.costiPerCategoria['Trasferta'], undefined);
});

test('open invoices with a due date become scadenze, newest last', () => {
  const r = run({ invoices: [activeInvoice(), passiveInvoice({ settlement: { status: 'open', date: null, amount: 122 } })] });
  assert.deepEqual(r.scadenze.map(s => s.date), ['2026-08-30', '2026-09-30']);
  assert.equal(r.scadenze[0].direction, 'active');
});

test('cash-basis revenue counts only settled invoices', () => {
  const settled = activeInvoice({ id: 'inv_s', settlement: { status: 'settled', date: '2026-09-15', amount: 7612.80 } });
  const r = run({ invoices: [activeInvoice(), settled] });
  near(r.consuntivo.ricavi, 12480);
  near(r.consuntivo.ricaviIncassati, 6240);
  near(r.consuntivo.ritenutaIncassata, 1248);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/test-fiscal-year.js`
Expected: FAIL — `computeFiscalYear is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/renderer/fiscal.js`, add before the final `return { ... }`:

```js
  // ── Period helpers ─────────────────────────────────────────────────────────
  const QUARTERS = [
    { id: 'Q1', label: '1° trim (gen-mar)', months: ['01', '02', '03'] },
    { id: 'Q2', label: '2° trim (apr-giu)', months: ['04', '05', '06'] },
    { id: 'Q3', label: '3° trim (lug-set)', months: ['07', '08', '09'] },
    { id: 'Q4', label: '4° trim (ott-dic)', months: ['10', '11', '12'] },
  ];
  const MONTHLY = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { id: mm, label: mm, months: [mm] };
  });

  // ── The merge (spec §4.2) ──────────────────────────────────────────────────
  function computeFiscalYear(opts) {
    const year = Number(opts.year);
    const yr = String(year);
    const invoices = opts.invoices || [];
    const activities = opts.activities || [];
    const expenses = opts.expenses || [];
    const clients = opts.clients || [];
    const fiscal = opts.fiscal || {};
    const amounts = opts.computeInvoiceAmounts
      || (typeof globalThis !== 'undefined' && globalThis.computeInvoiceAmounts);

    const inYear = d => typeof d === 'string' && d.slice(0, 4) === yr;
    const settledInYear = inv => inv.settlement && inv.settlement.status === 'settled' && inYear(inv.settlement.date);

    const byDocDate = invoices.filter(i => inYear(i.date));
    const active = byDocDate.filter(i => i.direction === 'active' && !i.reverseCharge);
    const passive = byDocDate.filter(i => i.direction === 'passive' && !i.reverseCharge);
    const reverse = byDocDate.filter(i => i.reverseCharge);

    // Revenue — competenza and cassa (P4)
    const ricavi = round2(active.reduce((s, i) => s + (i.sign || 1) * i.totals.imponibile, 0));
    const settledActive = invoices.filter(i => i.direction === 'active' && !i.reverseCharge && settledInYear(i));
    const ricaviIncassati = round2(settledActive.reduce((s, i) => s + (i.sign || 1) * i.totals.imponibile, 0));
    const cassaRivalsa = round2(active.reduce((s, i) => s + (i.sign || 1) * ((i.cassa && i.cassa.importo) || 0), 0));
    const ritenutaSubita = round2(active.reduce((s, i) => s + (i.sign || 1) * ((i.withholding && i.withholding.importo) || 0), 0));
    const ritenutaIncassata = round2(settledActive.reduce((s, i) => s + (i.sign || 1) * ((i.withholding && i.withholding.importo) || 0), 0));

    // IVA — always by document date (P4); reverse charge lands on both sides (P3)
    const ivaOn = inv => (inv.sign || 1) * (inv.totals.imposta || 0);
    const detractedOn = inv => ivaOn(inv) * pct(inv.fiscal && inv.fiscal.vatDetractPct) / 100;
    const ivaReverse = round2(reverse.reduce((s, i) => s + ivaOn(i), 0));
    const ivaDebito = round2(active.reduce((s, i) => s + ivaOn(i), 0) + ivaReverse);
    const ivaCredito = round2(passive.reduce((s, i) => s + detractedOn(i), 0)
      + reverse.reduce((s, i) => s + detractedOn(i), 0));

    // Costs — competenza vs cassa, with cespiti spread over their schedule
    const costInvoices = invoices.filter(i => i.direction === 'passive');
    const cespiti = costInvoices
      .filter(i => i.fiscal && i.fiscal.amortize)
      .map(i => {
        const s = buildAmortSchedule(i);
        return { ...s, quotaYear: amortQuotaFor(s, year), residual: amortResidualAt(s, year) };
      });

    const costiCompetenza = round2(
      byDocDate.filter(i => i.direction === 'passive')
        .reduce((s, i) => s + invoiceCostFiscals(i).imponibile * pct(i.fiscal && i.fiscal.deductPct) / 100, 0)
    );

    const paidThisYear = costInvoices.filter(i => settledInYear(i) && !(i.fiscal && i.fiscal.amortize));
    const manual = expenses.filter(e => !e.billable && String(e.monthKey || '').startsWith(yr + '-'));
    const costiDeducibili = round2(
      paidThisYear.reduce((s, i) => s + invoiceCostFiscals(i).deductible, 0)
      + cespiti.reduce((s, c) => s + c.quotaYear, 0)
      + manual.reduce((s, e) => s + computeExpenseFiscals(e).yearlyDeducted, 0)
    );

    // Costs by category — invoices and manual expenses share the same buckets
    const costiPerCategoria = {};
    const addCat = (cat, amount) => {
      const key = cat || 'Altro';
      costiPerCategoria[key] = round2((costiPerCategoria[key] || 0) + amount);
    };
    byDocDate.filter(i => i.direction === 'passive')
      .forEach(i => addCat(i.fiscal && i.fiscal.category, invoiceCostFiscals(i).imponibile));
    manual.forEach(e => addCat(e.category, computeExpenseFiscals(e).net));

    // Forecast — only months no active invoice covers (no double counting)
    const coveredMonths = {};
    invoices.filter(i => i.direction === 'active' && i.clientId && i.linkedMonthKey)
      .forEach(i => { coveredMonths[`${i.clientId}|${i.linkedMonthKey}`] = i.id; });

    const monthTotals = new Map();
    activities.filter(a => String(a.monthKey || '').startsWith(yr + '-')).forEach(a => {
      const key = `${a.clientId}|${a.monthKey}`;
      monthTotals.set(key, (monthTotals.get(key) || 0) + (a.hours || 0));
    });

    const previsionaleMonths = [];
    for (const [key, hours] of monthTotals) {
      if (coveredMonths[key]) continue;
      const [clientId, monthKey] = key.split('|');
      const client = clients.find(c => c.id === clientId);
      if (!client || !amounts) continue;
      previsionaleMonths.push({ clientId, monthKey, imponibile: round2(amounts(client, hours).imponibile) });
    }
    previsionaleMonths.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));

    // Liquidation periods
    const periodDefs = fiscal.ivaLiquidazione === 'mensile' ? MONTHLY : QUARTERS;
    const periods = periodDefs.map(p => {
      const inPeriod = list => list.filter(i => p.months.includes(i.date.slice(5, 7)));
      const rc = inPeriod(reverse);
      const dbt = round2(inPeriod(active).reduce((s, i) => s + ivaOn(i), 0) + rc.reduce((s, i) => s + ivaOn(i), 0));
      const crd = round2(inPeriod(passive).reduce((s, i) => s + detractedOn(i), 0) + rc.reduce((s, i) => s + detractedOn(i), 0));
      return {
        id: p.id, label: p.label, months: p.months,
        ivaDebito: dbt, ivaCredito: crd,
        ivaReverse: round2(rc.reduce((s, i) => s + ivaOn(i), 0)),
        saldo: round2(dbt - crd),
      };
    });

    const scadenze = invoices
      .filter(i => i.settlement && i.settlement.status === 'open' && i.payment && i.payment.dueDate)
      .map(i => ({
        id: i.id, date: i.payment.dueDate, direction: i.direction,
        counterparty: i.counterparty ? i.counterparty.name : '',
        amount: round2((i.sign || 1) * i.totals.documento),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      year,
      consuntivo: {
        ricavi, ricaviIncassati, ritenutaSubita, ritenutaIncassata, cassaRivalsa,
        costiCompetenza, costiDeducibili,
        ivaDebito, ivaCredito, ivaReverse, ivaSaldo: round2(ivaDebito - ivaCredito),
      },
      previsionale: {
        ricavi: round2(previsionaleMonths.reduce((s, m) => s + m.imponibile, 0)),
        months: previsionaleMonths,
      },
      coveredMonths, periods, cespiti, costiPerCategoria, scadenze,
    };
  }
```

and add `computeFiscalYear` to the returned object.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test tests/test-fiscal-year.js`
Expected: PASS — 14 tests.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — every suite.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/fiscal.js tests/test-fiscal-year.js
git commit -m "feat: merge invoices, timesheet and expenses into one fiscal year view"
```

---

## Task 10: Fatture screen and app wiring

**Files:**
- Create: `src/renderer/components/invoices.jsx`
- Modify: `src/renderer/app.jsx` (state, load, persist, route)
- Modify: `src/renderer/components/shared.jsx` (Sidebar entry, after the `expenses` nav button)
- Modify: `src/renderer/index.html` (script tag)
- Modify: `src/renderer/i18n.js` (it + en strings)

**Interfaces:**
- Consumes: `computeFiscalYear`, `invoiceCostFiscals` (Tasks 8–9); `window.api.invoices` (Task 7).
- Produces:
  - `<Invoices invoices clients currentYear onEdit onDelete onImport />` — list screen.
  - `<InvoiceDrawer invoice clients onSave onClose />` — detail with the immutable block read-only.
  - App-level: `invoices` state array, persisted with `dbSave('invoices', invoices)`.

- [ ] **Step 1: Add the i18n strings**

In `src/renderer/i18n.js`, add to the `it` block (next to the other `nav.*` keys) and mirror in `en`:

```js
      // Navigation
      'nav.invoices': 'Fatture',

      // Fatture
      'inv.active': 'Attive',
      'inv.passive': 'Passive',
      'inv.registers': 'Registri IVA',
      'inv.import': 'Importa fatture',
      'inv.number': 'Numero',
      'inv.date': 'Data',
      'inv.counterparty': 'Controparte',
      'inv.taxable': 'Imponibile',
      'inv.vat': 'IVA',
      'inv.total': 'Totale',
      'inv.status': 'Stato',
      'inv.open': 'Da incassare',
      'inv.openPassive': 'Da pagare',
      'inv.settled': 'Incassata',
      'inv.settledPassive': 'Pagata',
      'inv.markSettled': 'Segna come saldata',
      'inv.reverseCharge': 'Reverse charge',
      'inv.creditNote': 'Nota di credito',
      'inv.asset': 'Cespite',
      'inv.review': 'Da rivedere',
      'inv.fromXml': 'Dati dalla fattura (non modificabili)',
      'inv.classification': 'Classificazione',
      'inv.category': 'Categoria',
      'inv.deductPct': 'Deducibilità %',
      'inv.vatDetractPct': 'IVA detraibile %',
      'inv.amortYears': 'Anni ammortamento',
      'inv.linkedClient': 'Cliente',
      'inv.linkedMonth': 'Mese timesheet',
      'inv.openOriginal': 'Apri XML originale',
      'inv.empty': 'Nessuna fattura importata',
      'inv.emptyHint': 'Importa le fatture elettroniche per avere ricavi, costi e IVA reali.',
```

English values: `Invoices`, `Active`, `Passive`, `VAT registers`, `Import invoices`, `Number`, `Date`, `Counterparty`, `Taxable`, `VAT`, `Total`, `Status`, `To collect`, `To pay`, `Collected`, `Paid`, `Mark as settled`, `Reverse charge`, `Credit note`, `Asset`, `To review`, `Invoice data (read-only)`, `Classification`, `Category`, `Deductible %`, `Deductible VAT %`, `Amortization years`, `Client`, `Timesheet month`, `Open original XML`, `No invoices imported`, `Import your e-invoices to work from real revenue, costs and VAT.`

- [ ] **Step 2: Add the Sidebar entry**

In `src/renderer/components/shared.jsx`, after the `expenses` nav button (around line 49), add:

```jsx
      <button className={"nav-item " + (active === "invoices" ? "active" : "")} onClick={() => onNav("invoices")}>
        <Icon name="file" /> {t('nav.invoices')}
        {invoiceCount > 0 && <span className="badge">{invoiceCount}</span>}
      </button>
```

and add `invoiceCount` to the `Sidebar` destructured props on line 27. If `Icon name="file"` does not exist in `icons.jsx`, use `name="download"` (already present) rather than inventing an icon.

- [ ] **Step 3: Wire state in `app.jsx`**

Add the state next to the other collections (after `const [expenses, setExpenses] = useState([]);`):

```jsx
  const [invoices, setInvoices] = useState([]);
  const [supplierRules, setSupplierRules] = useState({});
  const [importOpen, setImportOpen] = useState(false);
  const [editingInvoice, setEditingInvoice] = useState(null);
```

In `dbLoadAll()`'s localStorage fallback object add `invoices: AppStorage.load('ts_invoices', null),` and in `AppStorage.KEYS` (`src/renderer/storage.js`) add `invoices: 'ts_invoices',`.

In the `init()` effect, after `setExpenses(...)`:

```jsx
      setInvoices(data.invoices || []);
      setSupplierRules(data.supplierRules || {});
```

In `seedDemo` and `startEmpty`, set `setInvoices([])` and save `await window.api.db.saveCollection('invoices', [])`.

Add the persistence effect next to the others:

```jsx
  useEffect(() => { if (loaded && !showWelcome) dbSave('invoices', invoices); }, [invoices, loaded, showWelcome]);
  useEffect(() => { if (loaded && !showWelcome) dbSave('supplierRules', supplierRules); }, [supplierRules, loaded, showWelcome]);
```

and extend `dbSave`'s KV branch so `supplierRules` is stored as a kv value, not a collection:

```js
    const isKV = key === 'studio' || key === 'fiscal' || key === 'supplierRules';
```

Add the handlers used by the screen:

```jsx
  const handleSaveInvoice = (updated) => {
    setInvoices(list => list.map(i => (i.id === updated.id ? updated : i)));
    setEditingInvoice(null);
    window.showToast('Fattura aggiornata', 'success');
  };

  const handleDeleteInvoice = (id) => {
    setInvoices(list => list.filter(i => i.id !== id));
    window.showToast('Fattura rimossa', 'info');
  };
```

Render the route in the view switch, alongside the other views:

```jsx
        {view === "invoices" && <Invoices
          invoices={invoices} clients={clients} currentYear={year}
          onImport={() => setImportOpen(true)}
          onEdit={setEditingInvoice} onDelete={handleDeleteInvoice} />}
```

and pass `invoiceCount={invoices.length}` to `<Sidebar>`.

Mount the drawer near the other modals:

```jsx
      {editingInvoice && <InvoiceDrawer
        invoice={editingInvoice} clients={clients}
        onSave={handleSaveInvoice} onClose={() => setEditingInvoice(null)} />}
```

- [ ] **Step 4: Add the script tag**

In `src/renderer/index.html`, after the `expenses.jsx` line:

```html
  <script type="text/babel" src="components/invoices.jsx"></script>
```

- [ ] **Step 5: Write the screen**

Create `src/renderer/components/invoices.jsx`:

```jsx
// ============ Fatture elettroniche ============
// Imported invoices are accounting truth: everything that came from the XML is
// rendered read-only (P1). Only the classification block is editable.
const InvoiceBadges = ({ inv }) => (
  <>
    {inv.reverseCharge && <span className="badge badge-warning badge-dot" title="Reverse charge">{t('inv.reverseCharge')}</span>}
    {inv.sign === -1 && <span className="badge badge-warning badge-dot">{t('inv.creditNote')}</span>}
    {inv.fiscal && inv.fiscal.amortize && <span className="badge badge-dot">{t('inv.asset')}</span>}
    {!inv.reviewedAt && <span className="badge badge-warning badge-dot">{t('inv.review')}</span>}
  </>
);

const Invoices = ({ invoices, clients, currentYear, onImport, onEdit, onDelete }) => {
  const [tab, setTab] = useState("active");
  const [yearFilter, setYearFilter] = useState(String(currentYear));
  const [periodFilter, setPeriodFilter] = useState("all");

  const years = Array.from(new Set(invoices.map(i => i.date.slice(0, 4)))).sort().reverse();
  const inYear = invoices.filter(i => i.date.startsWith(yearFilter));
  const quarterOf = d => "Q" + (Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1);
  const scoped = periodFilter === "all" ? inYear : inYear.filter(i => quarterOf(i.date) === periodFilter);

  const active = scoped.filter(i => i.direction === "active");
  const passive = scoped.filter(i => i.direction === "passive");
  const list = tab === "active" ? active : passive;

  const sum = (rows, pick) => rows.reduce((s, i) => s + (i.sign || 1) * pick(i), 0);
  const fy = window.computeFiscalYear({
    year: Number(yearFilter), invoices, clients,
    fiscal: { ivaLiquidazione: "trimestrale" },
  });

  return (
    <div className="content">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label">Ricavi fatturati {yearFilter}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ricavi)}</div>
          <div className="kpi-meta"><span>{active.length} fatture attive</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Costi da fatture</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.costiCompetenza)}</div>
          <div className="kpi-meta"><span>{passive.length} fatture passive</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">IVA a debito</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ivaDebito)}</div>
          <div className="kpi-meta"><span>di cui reverse {fmtEUR(fy.consuntivo.ivaReverse)}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">IVA a credito</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ivaCredito)}</div>
          <div className="kpi-meta"><span>saldo {fmtEUR(fy.consuntivo.ivaSaldo)}</span></div>
        </div>
      </div>

      <div className="tab-nav">
        <button className={"tab " + (tab === "active" ? "active" : "")} onClick={() => setTab("active")}>
          {t('inv.active')} <span className="badge" style={{ marginLeft: 8 }}>{active.length}</span>
        </button>
        <button className={"tab " + (tab === "passive" ? "active" : "")} onClick={() => setTab("passive")}>
          {t('inv.passive')} <span className="badge" style={{ marginLeft: 8 }}>{passive.length}</span>
        </button>
        <button className={"tab " + (tab === "registers" ? "active" : "")} onClick={() => setTab("registers")}>
          {t('inv.registers')}
        </button>
      </div>

      <div className="filter-row">
        <select className="select" value={yearFilter} onChange={e => setYearFilter(e.target.value)}>
          {(years.length ? years : [String(currentYear)]).map(y => <option key={y} value={y}>{y}</option>)}
        </select>
        <select className="select" value={periodFilter} onChange={e => setPeriodFilter(e.target.value)}>
          <option value="all">Tutti i trimestri</option>
          {["Q1", "Q2", "Q3", "Q4"].map(q => <option key={q} value={q}>{q}</option>)}
        </select>
        <button className="btn btn-primary" onClick={onImport}>{t('inv.import')}</button>
      </div>

      {tab === "registers" ? (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>Periodo</th>
                <th className="num">IVA a debito</th>
                <th className="num">IVA a credito</th>
                <th className="num">di cui reverse</th>
                <th className="num">Saldo</th>
              </tr>
            </thead>
            <tbody>
              {fy.periods.map(p => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td className="num mono">{fmtEUR(p.ivaDebito)}</td>
                  <td className="num mono">{fmtEUR(p.ivaCredito)}</td>
                  <td className="num mono" style={{ color: "var(--text-muted)" }}>{fmtEUR(p.ivaReverse)}</td>
                  <td className="num mono"><strong>{fmtEUR(p.saldo)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 92 }}>{t('inv.date')}</th>
                <th style={{ width: 120 }}>{t('inv.number')}</th>
                <th>{t('inv.counterparty')}</th>
                <th className="num" style={{ width: 100 }}>{t('inv.taxable')}</th>
                <th className="num" style={{ width: 90 }}>{t('inv.vat')}</th>
                <th className="num" style={{ width: 100 }}>{t('inv.total')}</th>
                <th style={{ width: 120 }}>{t('inv.status')}</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && (
                <tr><td colSpan={8}>
                  <div className="empty-state">
                    <div className="title">{t('inv.empty')}</div>
                    <div>{t('inv.emptyHint')}</div>
                  </div>
                </td></tr>
              )}
              {list.map(inv => (
                <tr key={inv.id} onClick={() => onEdit(inv)} style={{ cursor: "pointer" }}>
                  <td className="mono">{inv.date}</td>
                  <td className="mono">{inv.number}</td>
                  <td>
                    {inv.counterparty.name} <InvoiceBadges inv={inv} />
                  </td>
                  <td className="num mono">{fmtEUR((inv.sign || 1) * inv.totals.imponibile)}</td>
                  <td className="num mono">{fmtEUR((inv.sign || 1) * inv.totals.imposta)}</td>
                  <td className="num"><strong>{fmtEUR((inv.sign || 1) * inv.totals.documento)}</strong></td>
                  <td>
                    {inv.settlement.status === "settled"
                      ? <span className="badge badge-success badge-dot">{inv.direction === "active" ? t('inv.settled') : t('inv.settledPassive')}</span>
                      : <span className="badge badge-dot">{inv.direction === "active" ? t('inv.open') : t('inv.openPassive')}</span>}
                  </td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-icon"
                      onClick={ev => { ev.stopPropagation(); onDelete(inv.id); }}>×</button>
                  </td>
                </tr>
              ))}
            </tbody>
            {list.length > 0 && (
              <tfoot>
                <tr>
                  <td colSpan={3}>Totale</td>
                  <td className="num mono">{fmtEUR(sum(list, i => i.totals.imponibile))}</td>
                  <td className="num mono">{fmtEUR(sum(list, i => i.totals.imposta))}</td>
                  <td className="num"><strong>{fmtEUR(sum(list, i => i.totals.documento))}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
};

// Detail: the XML block is presentation-only; only `edit` is written back.
const InvoiceDrawer = ({ invoice, clients, onSave, onClose }) => {
  const [edit, setEdit] = useState({
    clientId: invoice.clientId || "",
    linkedMonthKey: invoice.linkedMonthKey || "",
    fiscal: invoice.fiscal ? { ...invoice.fiscal } : null,
    settlement: { ...invoice.settlement },
    notes: invoice.notes || "",
  });
  const setFiscal = patch => setEdit(e => ({ ...e, fiscal: { ...e.fiscal, ...patch } }));
  const rule = edit.fiscal ? window.CATEGORY_RULES[edit.fiscal.category] : null;

  const save = () => onSave({
    ...invoice,
    clientId: edit.clientId || null,
    linkedMonthKey: edit.linkedMonthKey || null,
    fiscal: edit.fiscal,
    settlement: edit.settlement,
    notes: edit.notes,
    reviewedAt: invoice.reviewedAt || Math.floor(Date.now() / 1000),
  });

  return (
    <Modal open={true} onClose={onClose} size="lg"
      title={`${invoice.number} — ${invoice.counterparty.name}`}
      footer={<>
        <button className="btn" onClick={onClose}>{t('action.cancel')}</button>
        <button className="btn btn-primary" onClick={save}>{t('action.save')}</button>
      </>}>

      <h3 className="section-title">{t('inv.fromXml')}</h3>
      <table className="data">
        <tbody>
          <tr><td>{t('inv.date')}</td><td className="mono">{invoice.date}</td>
              <td>TipoDocumento</td><td className="mono">{invoice.tipoDoc}</td></tr>
          <tr><td>{t('inv.taxable')}</td><td className="num mono">{fmtEUR(invoice.totals.imponibile)}</td>
              <td>{t('inv.vat')}</td><td className="num mono">{fmtEUR(invoice.totals.imposta)}</td></tr>
          {invoice.withholding && (
            <tr><td>Ritenuta {invoice.withholding.aliquota}%</td><td className="num mono">{fmtEUR(invoice.withholding.importo)}</td>
                <td>Cassa</td><td className="num mono">{invoice.cassa ? fmtEUR(invoice.cassa.importo) : "—"}</td></tr>
          )}
        </tbody>
      </table>

      <table className="data" style={{ marginTop: 12 }}>
        <thead><tr><th>Riga</th><th className="num">IVA</th><th className="num">Imponibile</th><th className="num">Imposta</th></tr></thead>
        <tbody>
          {invoice.lines.map(l => (
            <tr key={l.n}><td>{l.desc}</td><td className="num mono">{l.vatPct != null ? l.vatPct + "%" : l.natura}</td>
              <td className="num mono">{fmtEUR(l.total)}</td><td /></tr>
          ))}
          {invoice.vatSummary.map((v, i) => (
            <tr key={"r" + i} style={{ color: "var(--text-muted)" }}>
              <td>Riepilogo {v.natura || ""}</td><td className="num mono">{v.vatPct}%</td>
              <td className="num mono">{fmtEUR(v.imponibile)}</td><td className="num mono">{fmtEUR(v.imposta)}</td></tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-title" style={{ marginTop: 20 }}>{t('inv.classification')}</h3>
      <div className="form-grid">
        {invoice.direction === "active" && (
          <>
            <div className="field">
              <label>{t('inv.linkedClient')}</label>
              <select className="select" value={edit.clientId} onChange={e => setEdit(x => ({ ...x, clientId: e.target.value }))}>
                <option value="">—</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>{t('inv.linkedMonth')}</label>
              <input className="input mono" placeholder="2026-07" value={edit.linkedMonthKey}
                onChange={e => setEdit(x => ({ ...x, linkedMonthKey: e.target.value }))} />
            </div>
          </>
        )}

        {edit.fiscal && (
          <>
            <div className="field">
              <label>{t('inv.category')}</label>
              <select className="select" value={edit.fiscal.category}
                onChange={e => {
                  const cat = e.target.value;
                  const r = window.CATEGORY_RULES[cat];
                  setFiscal({ category: cat, deductPct: r ? r.deductPct : 100 });
                }}>
                {Object.keys(window.CATEGORY_RULES).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              {rule && rule.hint && <div className="hint" style={{ color: "var(--accent)" }}>ⓘ {rule.hint}</div>}
            </div>
            <div className="field">
              <label>{t('inv.deductPct')}</label>
              <input type="number" className="input mono" min="0" max="100" value={edit.fiscal.deductPct}
                onChange={e => setFiscal({ deductPct: Math.min(100, Math.max(0, +e.target.value)) })} />
            </div>
            <div className="field">
              <label>{t('inv.vatDetractPct')}</label>
              <input type="number" className="input mono" min="0" max="100" value={edit.fiscal.vatDetractPct}
                onChange={e => setFiscal({ vatDetractPct: Math.min(100, Math.max(0, +e.target.value)) })} />
            </div>
            <div className="field">
              <label>{t('inv.asset')}</label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input type="checkbox" checked={!!edit.fiscal.amortize}
                  onChange={e => setFiscal({ amortize: e.target.checked, amortYears: e.target.checked ? (edit.fiscal.amortYears || 4) : null, firstYearHalf: true })} />
                <span>{t('inv.amortYears')}</span>
                <input type="number" className="input mono" style={{ width: 70 }} min="1" max="20"
                  disabled={!edit.fiscal.amortize} value={edit.fiscal.amortYears || 4}
                  onChange={e => setFiscal({ amortYears: Math.max(1, +e.target.value) })} />
              </label>
            </div>
          </>
        )}

        <div className="field">
          <label>{t('inv.status')}</label>
          <select className="select" value={edit.settlement.status}
            onChange={e => setEdit(x => ({ ...x, settlement: { ...x.settlement, status: e.target.value } }))}>
            <option value="open">{invoice.direction === "active" ? t('inv.open') : t('inv.openPassive')}</option>
            <option value="settled">{invoice.direction === "active" ? t('inv.settled') : t('inv.settledPassive')}</option>
          </select>
        </div>
        <div className="field">
          <label>Data saldo</label>
          <input type="date" className="input mono" value={edit.settlement.date || ""}
            onChange={e => setEdit(x => ({ ...x, settlement: { ...x.settlement, date: e.target.value || null } }))} />
        </div>

        <div className="field full">
          <label>Note</label>
          <input className="input" value={edit.notes} onChange={e => setEdit(x => ({ ...x, notes: e.target.value }))} />
        </div>
      </div>

      {invoice.src.archivePath && (
        <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}
          onClick={() => window.api.invoices.openOriginal(invoice.src.archivePath)}>
          {t('inv.openOriginal')}
        </button>
      )}
    </Modal>
  );
};
```

- [ ] **Step 6: Verify in the app**

Run: `npm start`

Expected: a **Fatture** entry appears in the sidebar; opening it shows the empty state and the Registri IVA tab renders four quarters at zero. Seed one invoice from DevTools to check the table and drawer render:

```js
// DevTools console
const inv = { id:'t1', dedupKey:'k', direction:'passive', reverseCharge:false, tipoDoc:'TD01',
  number:'1/2026', date:'2026-08-31', monthKey:'2026-08', sign:1, currency:'EUR',
  counterparty:{name:'Fornitore Test', vat:'05550001112'}, lines:[{n:1,desc:'Canone',total:100,vatPct:22}],
  vatSummary:[{vatPct:22,imponibile:100,imposta:22}], totals:{imponibile:100,imposta:22,documento:122},
  withholding:null, cassa:null, payment:{dueDate:'2026-09-30'},
  clientId:null, linkedMonthKey:null,
  fiscal:{category:'Utenze',deductPct:100,vatDetractPct:100,amortize:false,amortYears:null,firstYearHalf:false},
  settlement:{status:'open',date:null,amount:122}, notes:'', reviewedAt:1, src:{archivePath:null} };
await window.api.db.saveCollection('invoices', [inv]); location.reload();
```

Then clear it again with `await window.api.db.saveCollection('invoices', []); location.reload();`. Close the app.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/invoices.jsx src/renderer/components/shared.jsx src/renderer/app.jsx src/renderer/storage.js src/renderer/index.html src/renderer/i18n.js
git commit -m "feat: add Fatture screen with invoice list, VAT registers and detail drawer"
```

---

## Task 11: Import wizard

**Files:**
- Create: `src/renderer/components/invoice-import-wizard.jsx`
- Modify: `src/renderer/app.jsx` (mount the wizard, commit handler)
- Modify: `src/renderer/index.html` (script tag)
- Modify: `src/renderer/i18n.js` (wizard strings)

**Interfaces:**
- Consumes: `window.api.invoices.{chooseSource,scan,commit}` (Task 7).
- Produces: `<InvoiceImportWizard open onClose onImported />` where `onImported({ records, supplierRules })` is called once, after a successful commit.

- [ ] **Step 1: Add the wizard strings**

In `src/renderer/i18n.js` (`it`, mirrored in `en`):

```js
      'imp.title': 'Importa fatture elettroniche',
      'imp.pick': 'Scegli cartella o file…',
      'imp.hint': 'Supporta .xml, .xml.p7m e .zip. Nulla viene salvato finché non confermi.',
      'imp.scanning': 'Lettura file in corso…',
      'imp.new': 'Nuove',
      'imp.duplicates': 'Duplicati nel batch',
      'imp.already': 'Già importate',
      'imp.toReview': 'Da rivedere',
      'imp.discarded': 'Scartate',
      'imp.selectAll': 'Seleziona tutte',
      'imp.remember': 'Ricorda per questo fornitore',
      'imp.confirm': 'Conferma e importa',
      'imp.done': 'Importate {n} fatture',
      'imp.noStudio': 'Imposta P.IVA e Codice Fiscale in Impostazioni prima di importare.',
```

English: `Import e-invoices`, `Choose folder or files…`, `Supports .xml, .xml.p7m and .zip. Nothing is saved until you confirm.`, `Reading files…`, `New`, `Duplicates in batch`, `Already imported`, `To review`, `Skipped`, `Select all`, `Remember for this supplier`, `Confirm and import`, `Imported {n} invoices`, `Set your VAT number and tax code in Settings before importing.`

- [ ] **Step 2: Write the wizard**

Create `src/renderer/components/invoice-import-wizard.jsx`:

```jsx
// ============ Import wizard ============
// Three steps: pick source → review the manifest → commit.
// Steps 1–2 never write: the scan is a dry run (P2).
const InvoiceImportWizard = ({ open, onClose, onImported }) => {
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [decisions, setDecisions] = useState({});
  const [result, setResult] = useState(null);

  const pick = async () => {
    setError(null);
    const paths = await window.api.invoices.chooseSource();
    if (!paths || !paths.length) return;
    setBusy(true);
    try {
      const m = await window.api.invoices.scan(paths);
      setManifest(m);
      // Pre-select the new documents; duplicates and already-imported stay off.
      const initial = {};
      m.items.forEach(it => {
        initial[it.id] = {
          accept: it.status === 'new',
          clientId: it.proposal.clientId,
          linkedMonthKey: it.proposal.linkedMonthKey,
          fiscal: it.proposal.fiscal,
          rememberSupplier: it.direction === 'passive',
        };
      });
      setDecisions(initial);
      setStep(2);
    } catch (err) {
      setError(/studioIds/.test(err.message) ? t('imp.noStudio') : err.message);
    } finally {
      setBusy(false);
    }
  };

  const setDecision = (id, patch) => setDecisions(d => ({ ...d, [id]: { ...d[id], ...patch } }));

  const commit = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.api.invoices.commit({ items: manifest.items, decisions });
      setResult(res);
      onImported(res);
      setStep(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setStep(1); setManifest(null); setDecisions({}); setResult(null); setError(null);
    onClose();
  };

  const groups = manifest ? [
    { key: 'new', label: t('imp.new'), rows: manifest.items.filter(i => i.status === 'new' && !i.needsReview) },
    { key: 'review', label: t('imp.toReview'), rows: manifest.items.filter(i => i.status === 'new' && i.needsReview) },
    { key: 'already', label: t('imp.already'), rows: manifest.items.filter(i => i.status === 'imported') },
  ].filter(g => g.rows.length) : [];

  const acceptedCount = Object.values(decisions).filter(d => d.accept).length;

  return (
    <Modal open={open} onClose={close} size="lg" title={t('imp.title')}
      footer={step === 2
        ? <>
            <button className="btn" onClick={close}>{t('action.cancel')}</button>
            <button className="btn btn-primary" disabled={busy || !acceptedCount} onClick={commit}>
              {t('imp.confirm')} ({acceptedCount})
            </button>
          </>
        : <button className="btn" onClick={close}>{t('action.close')}</button>}>

      {error && <div className="badge badge-warning" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}

      {step === 1 && (
        <div style={{ textAlign: 'center', padding: 24 }}>
          <button className="btn btn-primary" disabled={busy} onClick={pick}>{t('imp.pick')}</button>
          <div className="hint" style={{ marginTop: 12 }}>{t('imp.hint')}</div>
          {busy && <div className="hint" style={{ marginTop: 8 }}>{t('imp.scanning')}</div>}
        </div>
      )}

      {step === 2 && manifest && (
        <>
          <div className="filter-row" style={{ gap: 16 }}>
            <span className="badge">{t('imp.new')}: {manifest.counts.nuove}</span>
            <span className="badge">{t('imp.duplicates')}: {manifest.counts.duplicati}</span>
            <span className="badge">{t('imp.already')}: {manifest.counts.giaImportate}</span>
            <span className="badge badge-warning">{t('imp.toReview')}: {manifest.counts.daRivedere}</span>
            <span className="badge">{t('imp.discarded')}: {manifest.skipped.length}</span>
          </div>

          {groups.map(g => (
            <div className="card" key={g.key} style={{ marginTop: 16 }}>
              <div className="card-header">
                <strong>{g.label}</strong>
                <button className="btn btn-ghost btn-sm" onClick={() =>
                  g.rows.forEach(r => setDecision(r.id, { accept: true }))}>{t('imp.selectAll')}</button>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} />
                    <th style={{ width: 90 }}>{t('inv.date')}</th>
                    <th>{t('inv.counterparty')}</th>
                    <th className="num" style={{ width: 100 }}>{t('inv.total')}</th>
                    <th style={{ width: 190 }}>{t('inv.classification')}</th>
                    <th style={{ width: 150 }} />
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map(it => {
                    const d = decisions[it.id] || {};
                    return (
                      <tr key={it.id}>
                        <td><input type="checkbox" checked={!!d.accept}
                          onChange={e => setDecision(it.id, { accept: e.target.checked })} /></td>
                        <td className="mono">{it.doc.date}</td>
                        <td>
                          {it.counterparty.name}
                          <span className="badge" style={{ marginLeft: 6 }}>{it.doc.tipoDoc}</span>
                          {it.reverseCharge && <span className="badge badge-warning badge-dot">{t('inv.reverseCharge')}</span>}
                          {it.reviewReason && <div className="hint">{it.reviewReason}</div>}
                        </td>
                        <td className="num mono">{fmtEUR(it.doc.totals.documento)}</td>
                        <td>
                          {it.direction === 'passive' && d.fiscal ? (
                            <select className="select" value={d.fiscal.category}
                              onChange={e => {
                                const cat = e.target.value;
                                const r = window.CATEGORY_RULES[cat];
                                setDecision(it.id, { fiscal: { ...d.fiscal, category: cat, deductPct: r ? r.deductPct : 100 } });
                              }}>
                              {Object.keys(window.CATEGORY_RULES).map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                          ) : (
                            <select className="select" value={d.clientId || ''}
                              onChange={e => setDecision(it.id, { clientId: e.target.value || null })}>
                              <option value="">— cliente —</option>
                              {(window.__clients || []).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          )}
                        </td>
                        <td>
                          {it.direction === 'passive' && (
                            <label className="hint" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                              <input type="checkbox" checked={!!d.rememberSupplier}
                                onChange={e => setDecision(it.id, { rememberSupplier: e.target.checked })} />
                              {t('imp.remember')}
                            </label>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {manifest.skipped.length > 0 && (
            <div className="card" style={{ marginTop: 16 }}>
              <div className="card-header"><strong>{t('imp.discarded')}</strong></div>
              <table className="data">
                <tbody>
                  {manifest.skipped.map((s, i) => (
                    <tr key={i}><td className="mono">{s.file}</td><td>{s.reason}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {step === 3 && result && (
        <div className="empty-state">
          <div className="title">{t('imp.done').replace('{n}', result.records.length)}</div>
        </div>
      )}
    </Modal>
  );
};
```

- [ ] **Step 3: Mount it in `app.jsx`**

Expose the client list for the wizard's client picker next to the other state effects:

```jsx
  useEffect(() => { window.__clients = clients; }, [clients]);
```

Add the commit handler and mount the wizard next to the other modals:

```jsx
  const handleImported = ({ records, supplierRules: rules }) => {
    setInvoices(list => {
      const byId = new Map(list.map(i => [i.id, i]));
      records.forEach(r => byId.set(r.id, r));
      return Array.from(byId.values());
    });
    if (rules) setSupplierRules(rules);
    window.showToast(`Importate ${records.length} fatture`, 'success');
  };
```

```jsx
      {importOpen && <InvoiceImportWizard
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={handleImported} />}
```

- [ ] **Step 4: Add the script tag**

In `src/renderer/index.html`, after `components/invoices.jsx`:

```html
  <script type="text/babel" src="components/invoice-import-wizard.jsx"></script>
```

- [ ] **Step 5: Import the real exports end to end**

Run: `npm start`

1. In Impostazioni, confirm P.IVA and Codice Fiscale are set (the scan refuses to guess without them).
2. Fatture → Importa fatture → pick `~/Downloads/Fatture_Passive_20260914_081406`.
3. Expected manifest: **8 nuove**, **3 duplicati** (the `COPIA_` self-invoices), 0 già importate.
4. Confirm, then import `~/Downloads/Fatture_Attive_20260914_081633`.
5. Expected: 4 nuove (the TD01 sales) and the 7 TD18/TD19 reported as **già importate** — they were already captured from the passive folder. This is the P3 check: verify the reverse-charge invoices appear **once**, under Passive, not as revenue.
6. Verify the Registri IVA tab shows the reverse-charge column and that `IVA a debito − IVA a credito` for those documents nets to zero.

Close the app.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/invoice-import-wizard.jsx src/renderer/app.jsx src/renderer/index.html src/renderer/i18n.js
git commit -m "feat: add invoice import wizard with dry-run manifest and confirmation"
```

---

## Task 12: Tasse — consuntivo vs previsionale, and the cespiti register

**Files:**
- Modify: `src/renderer/components/taxes.jsx` (`computeTaxes` signature and revenue/IVA/cost sources; new Cespiti tab)
- Modify: `src/renderer/app.jsx` (pass `invoices` to `<Taxes>`)
- Modify: `src/renderer/i18n.js`

**Interfaces:**
- Consumes: `computeFiscalYear` (Task 9).
- Produces: `computeTaxes(activities, expenses, fiscal, year, clients, studio, invoices)` — same return shape as today plus `fy` (the `computeFiscalYear` result), `ricaviFatturati`, `ricaviPrevisionali`.

- [ ] **Step 1: Add the strings**

In `src/renderer/i18n.js` (`it`, mirrored in `en`):

```js
      'tax.invoiced': 'Fatturato',
      'tax.forecast': 'Da fatturare',
      'tax.assets': 'Cespiti & ammortamenti',
      'tax.assetCost': 'Costo',
      'tax.assetQuota': 'Quota anno',
      'tax.assetResidual': 'Residuo',
      'tax.assetYears': 'Anni',
      'tax.reverseNeutral': 'Reverse charge (neutro)',
```

English: `Invoiced`, `To invoice`, `Assets & depreciation`, `Cost`, `Year quota`, `Residual`, `Years`, `Reverse charge (neutral)`.

- [ ] **Step 2: Source revenue and costs from the invoices**

In `src/renderer/components/taxes.jsx`, change the signature on line 6 to:

```js
function computeTaxes(activities, expenses, fiscal, year, clients, studio, invoices) {
```

and immediately after the `const yearExp = ...` line insert:

```js
  // Invoices are accounting truth; the timesheet only covers what is not yet
  // invoiced (spec §4.2). The previsionale block below reuses the existing
  // per-month billing logic through computeFiscalYear.
  const fy = window.computeFiscalYear({
    year, invoices: invoices || [], activities, expenses, clients: _clients, fiscal,
    computeInvoiceAmounts: window.computeInvoiceAmounts,
  });
```

Replace the `compensi`, `ritenutaTrattenuta`, `compensiConRit`, `ivaDebito`, `ivaCredito` and `costiDeducibili` definitions with:

```js
  const ricaviFatturati = fy.consuntivo.ricavi;
  const ricaviPrevisionali = fy.previsionale.ricavi;
  const compensi = ricaviFatturati + ricaviPrevisionali;

  const ritenutaTrattenuta = fy.consuntivo.ritenutaSubita;
  const compensiConRit = ricaviFatturati;      // withholding only ever applies to issued invoices
  const compensiSenzaRit = compensi - compensiConRit;

  const ivaDebito = fy.consuntivo.ivaDebito;
  const ivaCredito = fy.consuntivo.ivaCredito;
  const costiDeducibili = fy.consuntivo.costiDeducibili;
```

Leave the contributi, IRPEF and F24 blocks untouched — they consume `compensi`, `costiDeducibili` and `ritenutaTrattenuta`, which now carry invoice-backed values.

Replace the body of the `trimestri` computation so periods come from `fy` rather than from activities:

```js
  const trimestri = ivaDeadlines.map(qt => {
    const period = fy.periods.find(p => p.id === qt.id) || { ivaDebito: 0, ivaCredito: 0, ivaReverse: 0, saldo: 0 };
    return {
      ...qt,
      debit: period.ivaDebito,
      credit: period.ivaCredito,
      reverse: period.ivaReverse,
      saldo: period.saldo,
    };
  });
```

Add `fy`, `ricaviFatturati` and `ricaviPrevisionali` to the object `computeTaxes` returns.

- [ ] **Step 3: Show the split and the reverse-charge row**

In the revenue KPI of the Taxes component, render both figures:

```jsx
          <div className="kpi-meta">
            <span>{t('tax.invoiced')} {fmtEUR(res.ricaviFatturati)}</span>
            <span> · {t('tax.forecast')} {fmtEUR(res.ricaviPrevisionali)}</span>
          </div>
```

In the IVA quarter table, add a column after IVA a credito:

```jsx
              <td className="num mono" style={{ color: "var(--text-muted)" }} title={t('tax.reverseNeutral')}>
                {fmtEUR(q.reverse)}
              </td>
```

with a matching `<th className="num">{t('tax.reverseNeutral')}</th>` in the header row.

- [ ] **Step 4: Add the Cespiti tab**

Add `"assets"` to the taxes tab list and render:

```jsx
      {tab === "assets" && (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>{t('inv.asset')}</th>
                <th style={{ width: 100 }}>{t('inv.date')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetCost')}</th>
                <th className="num" style={{ width: 70 }}>{t('tax.assetYears')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetQuota')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetResidual')}</th>
              </tr>
            </thead>
            <tbody>
              {res.fy.cespiti.length === 0 && (
                <tr><td colSpan={6}><div className="empty-state"><div className="title">Nessun cespite</div></div></td></tr>
              )}
              {res.fy.cespiti.map(c => (
                <tr key={c.id}>
                  <td>{c.desc}</td>
                  <td className="mono">{c.date}</td>
                  <td className="num mono">{fmtEUR(c.cost)}</td>
                  <td className="num mono">{c.years}{c.firstYearHalf ? "½" : ""}</td>
                  <td className="num mono"><strong>{fmtEUR(c.quotaYear)}</strong></td>
                  <td className="num mono">{fmtEUR(c.residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
```

- [ ] **Step 5: Pass invoices from `app.jsx`**

Find the `<Taxes ... />` render and add `invoices={invoices}`; inside `taxes.jsx`, thread the prop into the `computeTaxes(...)` call as the seventh argument.

- [ ] **Step 6: Verify against the imported data**

Run: `npm start` → Tasse.

Expected with the two exports imported:
- Ricavi show a *Fatturato* figure matching the sum of the four TD01 sales imponibili and a separate *Da fatturare* figure for any timesheet month with no linked invoice.
- Costi deducibili include the passive invoices marked settled, and exclude reverse-charge IVA.
- The Q3 row's reverse column is non-zero while its contribution to `saldo` is zero.
- Cespiti lists any invoice flagged as a cespite, with a halved first-year quota.

Close the app.

- [ ] **Step 7: Run the suite and commit**

```bash
npm test
git add src/renderer/components/taxes.jsx src/renderer/app.jsx src/renderer/i18n.js
git commit -m "feat: drive taxes from invoices with consuntivo/previsionale split and cespiti"
```

---

## Task 13: Dashboard and cross-screen pointers

**Files:**
- Modify: `src/renderer/components/dashboard.jsx`
- Modify: `src/renderer/components/expenses.jsx` (pointer note)
- Modify: `src/renderer/components/export.jsx:816` (`ReconciliationPanel` wording)
- Modify: `src/renderer/app.jsx` (pass `invoices` to Dashboard)
- Modify: `src/renderer/i18n.js`

**Interfaces:**
- Consumes: `computeFiscalYear` (Task 9).
- Produces: `<Dashboard ... invoices={invoices} />` with four invoice KPIs and a scadenze list.

- [ ] **Step 1: Add the strings**

In `src/renderer/i18n.js` (`it`, mirrored in `en`):

```js
      'dash.invoicedYTD': 'Ricavi fatturati YTD',
      'dash.toCollect': 'Da incassare',
      'dash.costsByCategory': 'Costi per categoria',
      'dash.upcoming': 'Prossime scadenze',
      'exp.invoiceHint': 'I costi documentati da fattura elettronica si gestiscono in Fatture.',
```

English: `Invoiced revenue YTD`, `To collect`, `Costs by category`, `Upcoming due dates`, `Costs backed by an e-invoice are managed in Invoices.`

- [ ] **Step 2: Add the KPIs and the scadenze list**

In `src/renderer/components/dashboard.jsx`, accept `invoices` in the props and compute once:

```jsx
  const fy = window.computeFiscalYear({
    year: currentYear, invoices: invoices || [], activities, expenses, clients,
    fiscal: fiscal || {}, computeInvoiceAmounts: window.computeInvoiceAmounts,
  });
  const daIncassare = (invoices || [])
    .filter(i => i.direction === 'active' && i.settlement.status === 'open')
    .reduce((s, i) => s + (i.sign || 1) * i.totals.documento, 0);
```

Add two KPIs to the existing grid:

```jsx
        <div className="kpi">
          <div className="kpi-label">{t('dash.invoicedYTD')}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ricavi)}</div>
          <div className="kpi-meta"><span>{t('tax.forecast')} {fmtEUR(fy.previsionale.ricavi)}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('dash.toCollect')}</div>
          <div className="kpi-value tabular">{fmtEUR(daIncassare)}</div>
          <div className="kpi-meta"><span>IVA periodo {fmtEUR(fy.consuntivo.ivaSaldo)}</span></div>
        </div>
```

and, below the existing cards, the two new blocks:

```jsx
      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><strong>{t('dash.costsByCategory')}</strong></div>
        <table className="data">
          <tbody>
            {Object.entries(fy.costiPerCategoria)
              .sort((a, b) => b[1] - a[1])
              .map(([cat, amount]) => (
                <tr key={cat}><td>{cat}</td><td className="num mono">{fmtEUR(amount)}</td></tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div className="card-header"><strong>{t('dash.upcoming')}</strong></div>
        <table className="data">
          <tbody>
            {fy.scadenze.slice(0, 8).map(s => (
              <tr key={s.id}>
                <td className="mono">{s.date}</td>
                <td>{s.counterparty}</td>
                <td>
                  <span className={"badge badge-dot " + (s.direction === 'active' ? 'badge-success' : '')}>
                    {s.direction === 'active' ? t('inv.open') : t('inv.openPassive')}
                  </span>
                </td>
                <td className="num mono">{fmtEUR(s.amount)}</td>
              </tr>
            ))}
            {fy.scadenze.length === 0 && (
              <tr><td colSpan={4}><div className="empty-state"><div className="title">—</div></div></td></tr>
            )}
          </tbody>
        </table>
      </div>
```

In `app.jsx`, pass `invoices={invoices}` (and `fiscal={fiscal}` if not already passed) to `<Dashboard>`.

- [ ] **Step 3: Add the Spese pointer**

In `src/renderer/components/expenses.jsx`, under the "Per conto proprio" tab header, add one line so invoice-backed costs are not entered twice:

```jsx
        {tab === "own" && <div className="hint" style={{ marginBottom: 8 }}>ⓘ {t('exp.invoiceHint')}</div>}
```

- [ ] **Step 4: Show what was actually invoiced next to the work report**

`ReconciliationPanel` (`export.jsx:816`) compares hours against the *contract* and never mentions invoices, so nothing there needs neutralizing. What is missing is the invoiced figure itself. Add a small sibling component above it in `src/renderer/components/export.jsx`:

```jsx
// The work report states the work; the invoice states what was agreed. A gap
// between them is information about an off-book agreement, never an error to
// fix — hence muted styling and no warning glyph (P1).
const InvoicedForMonth = ({ client, monthKey, invoices, acts }) => {
  const linked = (invoices || []).filter(i =>
    i.direction === 'active' && i.clientId === client.id && i.linkedMonthKey === monthKey);
  if (!linked.length) return null;

  const invoiced = linked.reduce((s, i) => s + (i.sign || 1) * i.totals.imponibile, 0);
  const hours = acts.reduce((s, a) => s + a.hours, 0);

  return (
    <div style={{
      marginTop: 16, padding: 16, background: "var(--bg-sunken)",
      borderRadius: "var(--radius)", border: "1px solid var(--border)",
    }}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
        Fatturato per questo mese
      </div>
      {linked.map(i => (
        <div key={i.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" }}>
          <span style={{ color: "var(--text-muted)" }}>{i.number} — {i.date}</span>
          <span className="mono">{fmtEUR((i.sign || 1) * i.totals.imponibile)}</span>
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "6px 0 0", marginTop: 6, borderTop: "1px solid var(--border)" }}>
        <span style={{ color: "var(--text-muted)" }}>Lavoro registrato</span>
        <span className="mono">{fmtH(hours)}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>
        Importo imponibile come da fattura emessa. Eventuali differenze rispetto al lavoro
        registrato dipendono da accordi non rappresentati nelle regole dell'app.
      </div>
    </div>
  );
};
```

Render it at `export.jsx:360`, immediately before the existing `<ReconciliationPanel ... />`:

```jsx
          <InvoicedForMonth client={client} monthKey={currentMonthKey} invoices={invoices} acts={acts} />
```

Add `invoices` to the `Export` component's props (line 172) and pass `invoices={invoices}` from `app.jsx` where `<Export ... />` is rendered. Unlike `ReconciliationPanel`, this block has no `billingType` guard — an hourly client's invoice is just as worth showing.

- [ ] **Step 5: Verify**

Run: `npm start` → Dashboard.

Expected: Ricavi fatturati YTD matches the Fatture screen; Da incassare equals the sum of open active invoices; Costi per categoria shows *Utenze* and the other categories assigned during import; Prossime scadenze lists due dates from `DatiPagamento`, earliest first.

Close the app.

- [ ] **Step 6: Run the suite and commit**

```bash
npm test
git add src/renderer/components/dashboard.jsx src/renderer/components/expenses.jsx src/renderer/components/export.jsx src/renderer/app.jsx src/renderer/i18n.js
git commit -m "feat: surface invoice KPIs, costs by category and due dates on the dashboard"
```

---

## Task 14: Backup round-trip and final verification

**Files:**
- Modify: `src/renderer/components/settings.jsx` (DB info panel — show the invoice count)
- Create: `tests/test-backup-roundtrip.js`

**Interfaces:**
- Consumes: `db.exportJSON` / `db.importJSON` / `db.stats` (Task 5).
- Produces: a regression test proving invoices and supplierRules survive a backup cycle.

- [ ] **Step 1: Write the failing test**

Create `tests/test-backup-roundtrip.js`:

```js
// tests/test-backup-roundtrip.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const os = require('os');
const path = require('path');
const fs = require('fs');
const AppDB = require('../src/main/db');

let seq = 0;
function makeTempDB() {
  const p = path.join(os.tmpdir(), `parcella-backup-${Date.now()}-${seq++}.db`);
  const db = new AppDB(p);
  return { db, cleanup: () => { db.close(); try { fs.unlinkSync(p); } catch {} } };
}

test('a full backup carries every collection, counters and supplier rules', () => {
  const a = makeTempDB();
  const b = makeTempDB();
  try {
    a.db.saveCollection('clients', [{ id: 'c1', name: 'Alfa', piva: 'IT09876543210' }]);
    a.db.saveCollection('activities', [{ id: 'a1', clientId: 'c1', monthKey: '2026-07', hours: 8, day: 3 }]);
    a.db.saveCollection('expenses', [{ id: 'e1', monthKey: '2026-07', amount: 10, billable: false, deductPct: 100, vatPct: 22 }]);
    a.db.saveCollection('invoices', [{
      id: 'inv_1', dedupKey: 'K|TD01|1|2026-07-31', direction: 'active', monthKey: '2026-07',
      date: '2026-07-31', tipoDoc: 'TD01', sign: 1, totals: { imponibile: 100, imposta: 22, documento: 122 },
      counterparty: { name: 'Alfa' }, settlement: { status: 'open', date: null, amount: 122 },
    }]);
    a.db.saveKV('studio', { piva: '01234567890', cf: 'RSSMRA80A01H501U' });
    a.db.saveKV('supplierRules', { '05550001112': { category: 'Utenze', deductPct: 100 } });
    a.db.nextDocNumber(2026);

    b.db.importJSON(a.db.exportJSON());
    const loaded = b.db.loadAll();

    assert.equal(loaded.clients.length, 1);
    assert.equal(loaded.activities.length, 1);
    assert.equal(loaded.expenses.length, 1);
    assert.equal(loaded.invoices.length, 1);
    assert.equal(loaded.invoices[0].dedupKey, 'K|TD01|1|2026-07-31');
    assert.equal(loaded.supplierRules['05550001112'].category, 'Utenze');
    assert.equal(loaded.studio.piva, '01234567890');
    assert.equal(b.db.getDocCounter(2026), 1);
    assert.equal(b.db.stats().invoices, 1);
  } finally { a.cleanup(); b.cleanup(); }
});
```

- [ ] **Step 2: Run the test**

Run: `node --test tests/test-backup-roundtrip.js`
Expected: PASS if Task 5 was implemented correctly. If it fails, the defect is in `db.js` — fix it there, not in the test.

- [ ] **Step 3: Show invoices in the Settings DB panel**

In `src/renderer/components/settings.jsx`, wherever `stats.clients` / `stats.activities` / `stats.expenses` are rendered, add the same treatment for `stats.invoices` with the label `Fatture`.

- [ ] **Step 4: Full verification**

Run: `npm test`
Expected: PASS — all suites.

Run: `npm start` and walk the acceptance path once more:
1. Import both AdE folders. The reverse-charge documents appear once, under Passive.
2. Fatture → Registri IVA: reverse charge contributes to both columns and nets to zero in `saldo`.
3. Tasse: Fatturato and Da fatturare are shown separately; no month is counted twice.
4. Impostazioni → backup to JSON, then import that JSON into a clean profile and confirm the invoice count survives.

Close the app.

- [ ] **Step 5: Commit**

```bash
git add tests/test-backup-roundtrip.js src/renderer/components/settings.jsx
git commit -m "test: prove invoices and supplier rules survive a backup round-trip"
```
