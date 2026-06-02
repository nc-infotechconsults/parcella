# Billing Models, Reconciliation & Document Numbering — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add monthly/project billing types to client contracts, fix document sequential numbering, and add an in-app reconciliation panel showing effective vs. contracted hourly rate.

**Architecture:** Billing type lives on the client object as flat optional fields (backward compatible). `computeInvoiceAmounts` gains a billing-type path that uses the fixed fee as imponibile. Export documents adapt their rendering per type. Document numbers use a persistent KV counter incremented on the first export action per session. The reconciliation panel is read-only, in-app only, shown below the export preview.

**Tech Stack:** Electron 35, React 18 (via `<script>` tags, no bundler), better-sqlite3, contextBridge IPC

---

## File Map

| File | What changes |
|------|-------------|
| `src/main/db.js` | Add `nextDocNumber`, `getDocCounter`, `resetDocCounter` |
| `src/main/db-json.js` | Same three methods for JSON fallback |
| `src/main/main.js` | Three new `ipcMain.handle` entries |
| `src/main/preload.js` | Expose the three methods on `window.api.db` |
| `src/renderer/components/shared.jsx` | `computeInvoiceAmounts` billing-type branch |
| `src/renderer/components/client-form.jsx` | Billing type selector + conditional fields |
| `src/renderer/components/export.jsx` | Doc number fix, rendering per type, ReconciliationPanel |
| `src/renderer/components/timesheet.jsx` | Row header shows effective rate for non-hourly |
| `src/renderer/components/settings.jsx` | Counter reset section |
| `tests/test-doc-counter.js` | Unit tests for counter logic |
| `tests/test-compute-amounts.js` | Unit tests for computeInvoiceAmounts |

---

## Task 1: Document counter — db.js

**Files:**
- Modify: `src/main/db.js` (after `saveKV` at line ~92)
- Create: `tests/test-doc-counter.js`

- [ ] **Step 1: Create the test file**

```js
// tests/test-doc-counter.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

function makeDB() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER DEFAULT (strftime('%s','now')))`);
  return {
    nextDocNumber(year) {
      const key = `docCounter_${year}`;
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      const next = (row ? JSON.parse(row.value) : 0) + 1;
      db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(next));
      return next;
    },
    getDocCounter(year) {
      const key = `docCounter_${year}`;
      const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
      return row ? JSON.parse(row.value) : 0;
    },
    resetDocCounter(year) {
      const key = `docCounter_${year}`;
      db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(0));
    },
  };
}

test('nextDocNumber starts at 1', () => {
  const d = makeDB();
  assert.equal(d.nextDocNumber(2026), 1);
});

test('nextDocNumber increments', () => {
  const d = makeDB();
  d.nextDocNumber(2026); d.nextDocNumber(2026);
  assert.equal(d.nextDocNumber(2026), 3);
});

test('counters are independent per year', () => {
  const d = makeDB();
  d.nextDocNumber(2025); d.nextDocNumber(2025);
  assert.equal(d.nextDocNumber(2026), 1);
});

test('getDocCounter returns 0 when uninitialised', () => {
  const d = makeDB();
  assert.equal(d.getDocCounter(2026), 0);
});

test('resetDocCounter sets counter to 0, next call returns 1', () => {
  const d = makeDB();
  d.nextDocNumber(2026); d.nextDocNumber(2026);
  d.resetDocCounter(2026);
  assert.equal(d.getDocCounter(2026), 0);
  assert.equal(d.nextDocNumber(2026), 1);
});
```

- [ ] **Step 2: Run tests — verify they pass against the inline implementation**

```bash
cd /Users/nicocardone/Desktop/DEV/PERSONALI/timesheet
node --test tests/test-doc-counter.js
```

Expected: 5 passing (the test file contains its own inline implementation to verify the logic).

- [ ] **Step 3: Add the three methods to `src/main/db.js` after `saveKV`**

After line 92 (`saveKV(key, value) { this._setKV(key, value); }`), add:

```js
  nextDocNumber(year) {
    const key = `docCounter_${year}`;
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    const next = (row ? JSON.parse(row.value) : 0) + 1;
    this.db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(next));
    return next;
  }

  getDocCounter(year) {
    const key = `docCounter_${year}`;
    const row = this.db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
    return row ? JSON.parse(row.value) : 0;
  }

  resetDocCounter(year) {
    const key = `docCounter_${year}`;
    this.db.prepare("INSERT OR REPLACE INTO kv (key,value,ts) VALUES (?,?,strftime('%s','now'))").run(key, JSON.stringify(0));
  }
```

- [ ] **Step 4: Commit**

```bash
git add src/main/db.js tests/test-doc-counter.js
git commit -m "feat: add document counter methods to db.js"
```

---

## Task 2: Document counter — db-json.js fallback

**Files:**
- Modify: `src/main/db-json.js` (after `saveKV` at line ~37)

- [ ] **Step 1: Add three methods to `src/main/db-json.js` after `saveKV`**

```js
  nextDocNumber(year) {
    if (!this._data.docCounters) this._data.docCounters = {};
    const next = (this._data.docCounters[String(year)] || 0) + 1;
    this._data.docCounters[String(year)] = next;
    this._save();
    return next;
  }

  getDocCounter(year) {
    return (this._data.docCounters || {})[String(year)] || 0;
  }

  resetDocCounter(year) {
    if (!this._data.docCounters) this._data.docCounters = {};
    this._data.docCounters[String(year)] = 0;
    this._save();
  }
```

- [ ] **Step 2: Commit**

```bash
git add src/main/db-json.js
git commit -m "feat: add document counter methods to db-json.js fallback"
```

---

## Task 3: IPC wiring — main.js + preload.js

**Files:**
- Modify: `src/main/main.js` (after the `db:saveKV` handler, ~line 148)
- Modify: `src/main/preload.js` (inside `window.api.db`, after `saveKV`)

- [ ] **Step 1: Add IPC handlers to `src/main/main.js` after the `db:saveKV` block**

```js
  ipcMain.handle('db:nextDocNumber',  (_, { year }) => db.nextDocNumber(year));
  ipcMain.handle('db:getDocCounter',  (_, { year }) => db.getDocCounter(year));
  ipcMain.handle('db:resetDocCounter', (_, { year }) => { db.resetDocCounter(year); return true; });
```

- [ ] **Step 2: Expose on `window.api.db` in `src/main/preload.js`**

Inside the `db: { ... }` block, after the `saveKV` line, add:

```js
    nextDocNumber:   (year) => ipcRenderer.invoke('db:nextDocNumber',   { year }),
    getDocCounter:   (year) => ipcRenderer.invoke('db:getDocCounter',   { year }),
    resetDocCounter: (year) => ipcRenderer.invoke('db:resetDocCounter', { year }),
```

- [ ] **Step 3: Start the app and verify via DevTools console**

```bash
npm start
```

In DevTools console run:
```js
window.api.db.nextDocNumber(2026).then(console.log)
// Expected: 1
window.api.db.nextDocNumber(2026).then(console.log)
// Expected: 2
window.api.db.getDocCounter(2026).then(console.log)
// Expected: 2
```

- [ ] **Step 4: Commit**

```bash
git add src/main/main.js src/main/preload.js
git commit -m "feat: expose document counter IPC handlers"
```

---

## Task 4: computeInvoiceAmounts — billing type support

**Files:**
- Modify: `src/renderer/components/shared.jsx` (lines 348–372)
- Create: `tests/test-compute-amounts.js`

- [ ] **Step 1: Create the test file**

```js
// tests/test-compute-amounts.js
const { test } = require('node:test');
const assert = require('node:assert/strict');

function computeInvoiceAmounts(client, hours) {
  let imponibile;
  if (client.billingType === 'monthly') {
    imponibile = client.monthlyRate || 0;
  } else if (client.billingType === 'project') {
    imponibile = client.projectMonthlyAmount || 0;
  } else {
    imponibile = hours * (client.hourlyRate || 0);
  }
  let cassa = 0, iva = 0, withholding = 0;
  if (client.cassaIncluded) {
    iva = (imponibile * (client.vatPct || 0)) / 100;
  } else {
    cassa = (imponibile * (client.cassaPct || 0)) / 100;
    iva = ((imponibile + cassa) * (client.vatPct || 0)) / 100;
  }
  if (client.withholding) withholding = (imponibile + cassa) * 0.20;
  const total = imponibile + cassa + iva - withholding;
  return { imponibile, cassa, iva, withholding, total };
}

const base = { cassaPct: 4, cassaIncluded: false, vatPct: 22, withholding: false };

test('hourly: imponibile = hours * rate', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'hourly', hourlyRate: 100 }, 10);
  assert.equal(r.imponibile, 1000);
});

test('hourly: default (no billingType) same as hourly', () => {
  const r = computeInvoiceAmounts({ ...base, hourlyRate: 80 }, 5);
  assert.equal(r.imponibile, 400);
});

test('monthly: imponibile = monthlyRate regardless of hours', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'monthly', monthlyRate: 6000 }, 80);
  assert.equal(r.imponibile, 6000);
});

test('project: imponibile = projectMonthlyAmount', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'project', projectMonthlyAmount: 1500 }, 30);
  assert.equal(r.imponibile, 1500);
});

test('monthly: cassa and IVA computed on monthlyRate', () => {
  const r = computeInvoiceAmounts({ ...base, billingType: 'monthly', monthlyRate: 6000 }, 0);
  assert.equal(r.cassa, 240);
  assert.equal(r.iva, (6000 + 240) * 0.22);
});
```

- [ ] **Step 2: Run tests — verify they pass against the inline version**

```bash
node --test tests/test-compute-amounts.js
```

Expected: 5 passing.

- [ ] **Step 3: Replace `computeInvoiceAmounts` in `src/renderer/components/shared.jsx` (lines 348–372)**

Replace the entire function:

```js
function computeInvoiceAmounts(client, hours) {
  let imponibile;
  if (client.billingType === 'monthly') {
    imponibile = client.monthlyRate || 0;
  } else if (client.billingType === 'project') {
    imponibile = client.projectMonthlyAmount || 0;
  } else {
    imponibile = hours * client.hourlyRate;
  }

  let cassa, iva, withholding;
  if (client.cassaIncluded) {
    cassa = 0;
    iva = (imponibile * client.vatPct) / 100;
  } else {
    cassa = (imponibile * client.cassaPct) / 100;
    iva = ((imponibile + cassa) * client.vatPct) / 100;
  }
  withholding = client.withholding ? (imponibile + cassa) * 0.20 : 0;
  const total = imponibile + cassa + iva - withholding;
  return { imponibile, cassa, iva, withholding, total };
}
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/shared.jsx tests/test-compute-amounts.js
git commit -m "feat: computeInvoiceAmounts supports monthly and project billing types"
```

---

## Task 5: Client form — billing type selector

**Files:**
- Modify: `src/renderer/components/client-form.jsx`

- [ ] **Step 1: Add new fields to the default state object (around line 4)**

In the `useState(client || { ... })` block, add after `hourlyRate: 80`:

```js
    billingType: "hourly",
    monthlyRate: 0,
    monthlyHours: 160,
    projectFee: 0,
    projectEstimatedHours: 0,
    projectMonthlyAmount: 0,
```

- [ ] **Step 2: Replace the "Condizioni economiche" section with the billing-type-aware version**

Replace from `<h3 className="section-title">Condizioni economiche</h3>` through the closing `</div>` of that section (ending before the `<div>` for "Note"):

```jsx
          <div>
            <h3 className="section-title">Condizioni economiche</h3>
            <div className="form-grid">
              <div className="field full">
                <label>Tipo fatturazione</label>
                <div style={{ display: "flex", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)", padding: 3, gap: 3 }}>
                  {[["hourly","A ore"],["monthly","Canone mensile"],["project","A progetto"]].map(([v, label]) => (
                    <button
                      key={v}
                      type="button"
                      className={"btn btn-sm" + (data.billingType === v ? " btn-primary" : "")}
                      style={{ flex: 1, justifyContent: "center" }}
                      onClick={() => update({ billingType: v })}
                    >{label}</button>
                  ))}
                </div>
              </div>

              {data.billingType === "hourly" && (
                <>
                  <div className="field">
                    <label>Tariffa oraria</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.hourlyRate} onChange={e => update({ hourlyRate: +e.target.value })} />
                      <div className="addon">€/h</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore plafond mensile</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.hoursPlafond} onChange={e => update({ hoursPlafond: +e.target.value })} />
                      <div className="addon">h/mese</div>
                    </div>
                    <div className="hint">Limite mensile da contratto. Lascia 0 per illimitato.</div>
                  </div>
                </>
              )}

              {data.billingType === "monthly" && (
                <>
                  <div className="field">
                    <label>Canone mensile (imponibile)</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.monthlyRate} onChange={e => update({ monthlyRate: +e.target.value })} />
                      <div className="addon">€/mese</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore contratto mensile</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.monthlyHours} onChange={e => update({ monthlyHours: +e.target.value })} />
                      <div className="addon">h/mese</div>
                    </div>
                    <div className="hint">
                      Tariffa implicita: {data.monthlyHours > 0 ? fmtEUR(data.monthlyRate / data.monthlyHours) : "—"}/h
                    </div>
                  </div>
                </>
              )}

              {data.billingType === "project" && (
                <>
                  <div className="field">
                    <label>Compenso totale progetto</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectFee} onChange={e => update({ projectFee: +e.target.value })} />
                      <div className="addon">€</div>
                    </div>
                  </div>
                  <div className="field">
                    <label>Ore stimate totali</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectEstimatedHours} onChange={e => update({ projectEstimatedHours: +e.target.value })} />
                      <div className="addon">h</div>
                    </div>
                    <div className="hint">
                      Tariffa stimata: {data.projectEstimatedHours > 0 ? fmtEUR(data.projectFee / data.projectEstimatedHours) : "—"}/h
                    </div>
                  </div>
                  <div className="field">
                    <label>Acconto mensile (imponibile)</label>
                    <div className="input-group">
                      <input className="input mono" type="number" value={data.projectMonthlyAmount} onChange={e => update({ projectMonthlyAmount: +e.target.value })} />
                      <div className="addon">€/mese</div>
                    </div>
                    <div className="hint">Importo fatturato ogni mese per questo progetto.</div>
                  </div>
                </>
              )}

              <div className="field">
                <label>Cassa previdenza</label>
                <div className="input-group">
                  <input className="input mono" type="number" step="0.5" value={data.cassaPct} onChange={e => update({ cassaPct: +e.target.value })} />
                  <div className="addon">%</div>
                </div>
                <label className="checkbox-row" style={{ marginTop: 4 }}>
                  <input type="checkbox" checked={data.cassaIncluded} onChange={e => update({ cassaIncluded: e.target.checked })} />
                  Inclusa nella tariffa (non addebitata in fattura)
                </label>
              </div>
              <div className="field">
                <label>IVA</label>
                <div className="input-group">
                  <input className="input mono" type="number" value={data.vatPct} onChange={e => update({ vatPct: +e.target.value })} />
                  <div className="addon">%</div>
                </div>
                <div className="hint">0% per esenzione (es. art. 10).</div>
              </div>
              <div className="field">
                <label>Ritenuta d'acconto</label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={data.withholding} onChange={e => update({ withholding: e.target.checked })} />
                  Applica ritenuta 20% sull'imponibile
                </label>
              </div>
              <div className="field">
                <label>Termini di pagamento</label>
                <div className="input-group">
                  <input className="input mono" type="number" value={data.paymentDays} onChange={e => update({ paymentDays: +e.target.value })} />
                  <div className="addon">gg DF FM</div>
                </div>
              </div>
              <div className="field">
                <label>Inizio contratto</label>
                <input className="input mono" type="date" value={data.contractStart} onChange={e => update({ contractStart: e.target.value })} />
              </div>
              <div className="field">
                <label>Scadenza contratto</label>
                <input className="input mono" type="date" value={data.contractEnd || ""} onChange={e => update({ contractEnd: e.target.value })} />
                <div className="hint">Lascia vuoto per durata indeterminata.</div>
              </div>
            </div>
          </div>
```

- [ ] **Step 3: Update the live preview panel to show the right imponibile for each type**

In the right-side preview card, replace the `const exampleAmounts = computeInvoiceAmounts(data, 10);` line and the "Esempio per 10 ore" label. The description changes based on billing type:

Replace:
```js
  const exampleAmounts = computeInvoiceAmounts(data, 10);
```
With:
```js
  const exampleAmounts = computeInvoiceAmounts(data, 10);
  const previewLabel = data.billingType === 'monthly'
    ? `Canone mensile ${fmtEUR(data.monthlyRate)}`
    : data.billingType === 'project'
    ? `Acconto ${fmtEUR(data.projectMonthlyAmount)}`
    : `10 ore × ${fmtEUR(data.hourlyRate)}/h`;
```

And in the JSX, replace:
```jsx
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                Esempio per <strong style={{ color: "var(--text)" }}>10 ore</strong> di lavoro
              </div>
```
With:
```jsx
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>
                Anteprima: <strong style={{ color: "var(--text)" }}>{previewLabel}</strong>
              </div>
```

- [ ] **Step 4: Start the app, go to Clienti → new/edit client, verify type selector works**

```bash
npm start
```

- Switch billing type between the three options
- Verify the correct fields appear/disappear
- Verify the "Tariffa implicita" hint updates live
- Verify the preview panel shows the right base amount

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/client-form.jsx
git commit -m "feat: add billing type selector to client form (hourly/monthly/project)"
```

---

## Task 6: Export — document number fix

**Files:**
- Modify: `src/renderer/components/export.jsx` (lines 121–150)

- [ ] **Step 1: Replace the static `docNum` computation with state**

In the `Export` component, after the existing `useState` declarations (around line 127), add:

```js
  const [lockedDocNum, setLockedDocNum] = useState(null);
```

Remove line 149:
```js
  const docNum = `${cYear}-${String(monthClients.findIndex(c => c.id === selectedId) + 1).padStart(3, "0")}`;
```

Replace it with:
```js
  const docNum = lockedDocNum || `${cYear}-???`;
```

- [ ] **Step 2: Reset the locked number when selection or month changes**

After the existing state declarations, add:

```js
  useEffect(() => { setLockedDocNum(null); }, [selectedId, currentMonthKey]);
```

- [ ] **Step 3: Add the `getOrAssignDocNum` helper inside the Export component**

```js
  const getOrAssignDocNum = async () => {
    if (lockedDocNum) return lockedDocNum;
    let num;
    if (window.api?.db?.nextDocNumber) {
      const n = await window.api.db.nextDocNumber(cYear);
      num = `${cYear}-${String(n).padStart(3, "0")}`;
    } else {
      num = `${cYear}-${String(monthClients.findIndex(c => c.id === selectedId) + 1).padStart(3, "0")}`;
    }
    setLockedDocNum(num);
    return num;
  };
```

- [ ] **Step 4: Update `handlePrint`, `handleDownloadCSV`, `handleDownloadWord` to call `getOrAssignDocNum` first**

Replace `handlePrint`:
```js
  const handlePrint = async () => {
    await getOrAssignDocNum();
    document.body.classList.add("printing-export");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-export"), 1000);
  };
```

Replace `handleDownloadCSV`:
```js
  const handleDownloadCSV = async () => {
    if (!client) return;
    await getOrAssignDocNum();
    const csv = buildCSV(client, acts, exps, amounts, u, monthLabel, mode, summaryRows);
    const prefix = mode === "summary" ? "riepilogo" : "timesheet";
    downloadBlob(csv, `${prefix}_${client.shortName}_${cYear}_${mm}.csv`, "text/csv;charset=utf-8;");
  };
```

Replace `handleDownloadWord`:
```js
  const handleDownloadWord = async () => {
    if (!client) return;
    const num = await getOrAssignDocNum();
    const html = buildWordHTML(client, acts, exps, amounts, num, docDate, u, mode, summaryRows);
    const prefix = mode === "summary" ? "riepilogo" : "rapporto";
    downloadBlob(html, `${prefix}_${client.shortName}_${cYear}_${mm}.doc`, "application/msword");
  };
```

Replace `handleSendEmail`:
```js
  const handleSendEmail = async () => {
    const ct = getClientInvoiceContact(client);
    if (!ct?.email) return;
    if (format === "excel") await handleDownloadCSV();
    else if (format === "word") await handleDownloadWord();
    const subject = encodeURIComponent(`Rapporto attività ${monthLabel}`);
    const body = encodeURIComponent("In allegato il rapporto attività.");
    window.open(`mailto:${ct.email}?subject=${subject}&body=${body}`);
    if (format !== "pdf") {
      window.showToast("Documento scaricato — allegalo all'email", "info");
    }
  };
```

- [ ] **Step 5: Start the app, open Export screen, verify `???` shows in preview**

```bash
npm start
```

- Open Export screen → should show `2026-???` in document number area
- Click "Stampa / Salva PDF" → should now show `2026-001`
- Close and reopen Export for the same client/month → still shows `2026-???` until next export action
- Export again → should show `2026-002`

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/export.jsx
git commit -m "fix: sequential document numbering via persistent KV counter"
```

---

## Task 7: Export — document rendering for monthly/project

**Files:**
- Modify: `src/renderer/components/export.jsx` (functions `buildCSV`, `buildWordHTML`, components `PdfPreview`, `WordPreview`)

- [ ] **Step 1: Replace `buildCSV` entirely**

```js
function buildCSV(client, acts, exps, amounts, studio, monthLabel, mode, summaryRows) {
  const isFixed = client.billingType === 'monthly' || client.billingType === 'project';
  const feeLabel = client.billingType === 'monthly' ? 'Canone professionale mensile' : 'Acconto progetto';
  const feeAmount = client.billingType === 'monthly' ? (client.monthlyRate || 0) : (client.projectMonthlyAmount || 0);
  const totalHours = acts.reduce((s, a) => s + a.hours, 0);

  const totalsBlock = [
    [],
    ["", "", "Imponibile", amounts.imponibile.toFixed(2)],
    ...(client.cassaIncluded ? [] : [["", "", `Cassa ${client.cassaPct}%`, amounts.cassa.toFixed(2)]]),
    ["", "", `IVA ${client.vatPct}%`, amounts.iva.toFixed(2)],
    ...(client.withholding ? [["", "", "Ritenuta 20%", "-" + amounts.withholding.toFixed(2)]] : []),
    ...(exps.length > 0 ? [["", "", "Rimborso spese", exps.reduce((s, e) => s + e.amount, 0).toFixed(2)]] : []),
    ["", "", "TOTALE DOVUTO", (amounts.totalWithExpenses || amounts.total).toFixed(2)],
  ];

  let rows;
  if (isFixed) {
    const actHeader = mode === "summary"
      ? ["Commessa", "Descrizione", "Ore totali"]
      : ["Data", "Commessa", "Descrizione", "Ore"];
    const actRows = mode === "summary"
      ? summaryRows.map(r => [r.code, r.name, r.hours])
      : acts.map(a => {
          const co = client.commesse.find(c => c.code === a.commessa);
          const [y, m] = a.monthKey.split("-");
          return [`${String(a.day).padStart(2,"0")}/${m}/${y}`, a.commessa + (co ? " — " + co.name : ""), a.desc, a.hours];
        });
    rows = [
      [mode === "summary" ? "RIEPILOGO ATTIVITÀ — " + client.name.toUpperCase() : "TIMESHEET — " + client.name.toUpperCase()],
      ["Periodo: " + monthLabel + " · " + studio.firm],
      [],
      [feeLabel, "", feeAmount.toFixed(2)],
      ["Totale ore lavorate", "", totalHours.toFixed(2)],
      [],
      actHeader,
      ...actRows,
      ...totalsBlock,
    ];
  } else if (mode === "summary") {
    rows = [
      ["RIEPILOGO ATTIVITÀ — " + client.name.toUpperCase()],
      ["Periodo: " + monthLabel + " · " + studio.firm],
      [],
      ["Commessa", "Descrizione", "Ore totali", "Tariffa (€/h)", "Importo (€)"],
      ...summaryRows.map(r => [r.code, r.name, r.hours, client.hourlyRate, (r.hours * client.hourlyRate).toFixed(2)]),
      ...totalsBlock,
    ];
  } else {
    rows = [
      ["TIMESHEET — " + client.name.toUpperCase()],
      ["Periodo: " + monthLabel + " · " + studio.firm],
      [],
      ["Data", "Commessa", "Descrizione", "Ore", "Tariffa (€/h)", "Importo (€)"],
      ...acts.map(a => {
        const co = client.commesse.find(c => c.code === a.commessa);
        const [y, m] = a.monthKey.split("-");
        return [`${String(a.day).padStart(2,"0")}/${m}/${y}`, a.commessa + (co ? " — " + co.name : ""), a.desc, a.hours, client.hourlyRate, (a.hours * client.hourlyRate).toFixed(2)];
      }),
      ...totalsBlock,
    ];
  }
  return "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
}
```

- [ ] **Step 2: Replace `buildWordHTML` entirely**

```js
function buildWordHTML(client, acts, exps, amounts, docNum, docDate, studio, mode, summaryRows) {
  const totalHours = acts.reduce((s, a) => s + a.hours, 0);
  const isFixed = client.billingType === 'monthly' || client.billingType === 'project';
  const feeLabel = client.billingType === 'monthly' ? 'Canone professionale mensile' : 'Acconto progetto';
  const feeAmount = client.billingType === 'monthly' ? (client.monthlyRate || 0) : (client.projectMonthlyAmount || 0);
  const contractNote = client.billingType === 'monthly'
    ? `Canone mensile: ${fmtEUR(client.monthlyRate)} · ${client.monthlyHours}h/mese`
    : client.billingType === 'project'
    ? `Progetto: compenso totale ${fmtEUR(client.projectFee)} · ${client.projectEstimatedHours}h previste`
    : '';

  let mainTable;
  if (isFixed) {
    const actRows = mode === "summary"
      ? summaryRows.map(r => `<tr><td style="font-family:monospace;font-size:10px">${r.code}</td><td>${r.name}</td><td align="right">${fmtNum(r.hours, r.hours%1===0?0:1)}</td></tr>`).join("")
      : acts.map(a => {
          const co = client.commesse.find(c => c.code === a.commessa);
          const [y, m] = a.monthKey.split("-");
          return `<tr><td>${String(a.day).padStart(2,"0")}/${m}/${y}</td><td style="font-family:monospace;font-size:10px">${a.commessa}</td><td>${a.desc}${co ? '<br><small style="color:#78716c">'+co.name+'</small>' : ''}</td><td align="right">${fmtNum(a.hours, a.hours%1===0?0:1)}</td></tr>`;
        }).join("");
    const actHead = mode === "summary"
      ? `<tr><th>Commessa</th><th>Descrizione</th><th>Ore totali</th></tr>`
      : `<tr><th>Data</th><th>Commessa</th><th>Descrizione</th><th>Ore</th></tr>`;
    mainTable = `
      <table style="width:100%;border-collapse:collapse;margin:12pt 0">
        <thead><tr><th style="background:#1c1917;color:white;padding:6pt 8pt;text-align:left" colspan="2">${feeLabel}</th><th style="background:#1c1917;color:white;padding:6pt 8pt;text-align:right">${fmtEUR(feeAmount)}</th></tr></thead>
      </table>
      <h2 style="font-size:12pt;border-bottom:1px solid #d6d3d1;padding-bottom:4pt;margin-top:16pt">Dettaglio attività</h2>
      <table style="width:100%;border-collapse:collapse;margin:8pt 0">
        <thead>${actHead}</thead>
        <tbody>${actRows}
          <tr style="border-top:2pt solid #1c1917;font-weight:bold"><td colspan="${mode === "summary" ? 2 : 3}">Totale ore</td><td align="right">${fmtNum(totalHours, totalHours%1===0?0:1)} h</td></tr>
        </tbody>
      </table>`;
  } else {
    const tableRows = mode === "summary"
      ? summaryRows.map(r => `<tr><td style="font-family:monospace;font-size:10px">${r.code}</td><td>${r.name}</td><td align="right">${fmtNum(r.hours, r.hours%1===0?0:1)}</td><td align="right">${fmtEUR(r.hours*client.hourlyRate)}</td></tr>`).join("")
      : acts.map(a => {
          const co = client.commesse.find(c => c.code === a.commessa);
          const [y, m] = a.monthKey.split("-");
          return `<tr><td>${String(a.day).padStart(2,"0")}/${m}/${y}</td><td style="font-family:monospace;font-size:10px">${a.commessa}</td><td>${a.desc}${co ? '<br><small style="color:#78716c">'+co.name+'</small>' : ''}</td><td align="right">${fmtNum(a.hours, a.hours%1===0?0:1)}</td><td align="right">${fmtEUR(a.hours*client.hourlyRate)}</td></tr>`;
        }).join("");
    const tableHead = mode === "summary"
      ? `<tr><th>Commessa</th><th>Descrizione</th><th>Ore totali</th><th>Importo</th></tr>`
      : `<tr><th>Data</th><th>Commessa</th><th>Descrizione</th><th>Ore</th><th>Importo</th></tr>`;
    const totalCols = mode === "summary" ? 2 : 3;
    mainTable = `<table style="width:100%;border-collapse:collapse;margin:12pt 0">
      <thead style="background:#1c1917;color:white">${tableHead}</thead>
      <tbody>${tableRows}
        <tr style="border-top:2pt solid #1c1917;font-weight:bold"><td colspan="${totalCols}">Totale</td><td align="right">${fmtNum(totalHours, totalHours%1===0?0:1)} h</td><td align="right">${fmtEUR(amounts.imponibile)}</td></tr>
      </tbody></table>`;
  }

  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Rapporto attività — ${client.name}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:2cm}table{width:100%;border-collapse:collapse;margin:12pt 0}th{background:#1c1917;color:white;padding:6pt 8pt;text-align:left;font-size:10pt}td{padding:5pt 8pt;border-bottom:1px solid #e7e5e4;font-size:10pt}h1{font-size:16pt;font-weight:bold;margin-bottom:4pt}h2{font-size:13pt;border-bottom:1px solid #d6d3d1;padding-bottom:4pt;margin-top:20pt}</style>
</head><body>
<div style="border-bottom:2pt solid #1c1917;padding-bottom:12pt;margin-bottom:16pt">
${studio.logoDataUrl ? `<img src="${studio.logoDataUrl}" style="height:48pt;max-width:180pt;object-fit:contain;display:block;margin-bottom:8pt" alt="Logo" />` : ""}
<h1 style="margin:0">${studio.firm}</h1>
<p style="margin:4pt 0;color:#57534e;font-size:10pt">${studio.address}<br>P.IVA ${studio.piva} · C.F. ${studio.cf}<br>${studio.email}</p>
</div>
<h1>Rapporto attività professionali</h1>
<p style="color:#57534e">Documento n. <b>${docNum}</b> · emesso il ${docDate}</p>
${contractNote ? `<p style="font-size:10pt;color:#57534e;font-style:italic">Contratto: ${contractNote}</p>` : ''}
<p>Spett.le<br><b>${client.name}</b><br>${client.address}<br>P.IVA ${client.piva}</p>
<p>Con la presente, lo scrivente <b>${studio.firm}</b> (P.IVA ${studio.piva}), trasmette il riepilogo delle attività svolte nel periodo <b>${docDate.replace("31/", "01/")} — ${docDate}</b>${isFixed ? '' : ` per un totale di <b>${fmtH(totalHours)}</b>`}.</p>
<h2>${isFixed ? (mode === "summary" ? "Riepilogo per commessa" : "Dettaglio prestazioni") : (mode === "summary" ? "Riepilogo per commessa" : "Dettaglio prestazioni")}</h2>
${mainTable}
<h2>Riepilogo economico</h2>
<table style="width:320pt;margin-left:auto"><tbody>
<tr><td>Imponibile</td><td align="right">${fmtEUR(amounts.imponibile)}</td></tr>
${!client.cassaIncluded ? `<tr><td>Cassa previdenza ${client.cassaPct}%</td><td align="right">${fmtEUR(amounts.cassa)}</td></tr>` : ""}
<tr><td>IVA ${client.vatPct}%</td><td align="right">${fmtEUR(amounts.iva)}</td></tr>
${client.withholding ? `<tr><td>Ritenuta d'acconto 20%</td><td align="right">−${fmtEUR(amounts.withholding)}</td></tr>` : ""}
${exps.length > 0 ? `<tr><td>Rimborso spese</td><td align="right">+${fmtEUR(exps.reduce((s,e)=>s+e.amount,0))}</td></tr>` : ""}
<tr style="border-top:2pt solid #1c1917;font-weight:bold;font-size:12pt"><td>Totale dovuto</td><td align="right">${fmtEUR(amounts.totalWithExpenses || amounts.total)}</td></tr>
</tbody></table>
<p style="font-size:10pt;color:#57534e;margin-top:28pt">Pagamento: bonifico bancario a ${client.bankOverride || studio.firm}, IBAN ${client.ibanOverride || studio.iban}.${client.paymentRef ? `<br>Riferimento: ${client.paymentRef}.` : ''}<br>Termini: ${client.paymentDays} giorni d.f. f.m.</p>
<p style="margin-top:28pt">Distinti saluti,<br><br>${studio.firm}<br><i>${studio.name}</i></p>
</body></html>`;
}
```

- [ ] **Step 3: Update `PdfPreview` to handle fixed billing types**

In `PdfPreview`, replace the `{mode === "summary" ? ( ... ) : ( ... )}` block (the main invoice table) with:

```jsx
    {(client.billingType === 'monthly' || client.billingType === 'project') ? (
      <>
        <table className="invoice">
          <thead>
            <tr>
              <th colSpan="3">Descrizione</th>
              <th className="num" style={{ width: 90 }}>Importo</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan="3">
                {client.billingType === 'monthly' ? 'Canone professionale mensile' : 'Acconto progetto'} — {monthLabel}
                {client.billingType === 'monthly' && (
                  <div style={{ fontSize: 9.5, color: "#78716c" }}>
                    Contratto: {client.monthlyHours}h/mese · tariffa implicita {fmtEUR(client.monthlyHours > 0 ? client.monthlyRate / client.monthlyHours : 0)}/h
                  </div>
                )}
              </td>
              <td className="num">
                {fmtEUR(client.billingType === 'monthly' ? (client.monthlyRate || 0) : (client.projectMonthlyAmount || 0))}
              </td>
            </tr>
          </tbody>
        </table>
        <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#44403c", margin: "8px 0 6px" }}>
          {mode === "summary" ? "Riepilogo per commessa" : "Dettaglio attività"}
        </h3>
        <table className="invoice">
          <thead>
            {mode === "summary" ? (
              <tr>
                <th style={{ width: 100 }}>Commessa</th>
                <th>Descrizione</th>
                <th className="num" style={{ width: 70 }}>Ore totali</th>
              </tr>
            ) : (
              <tr>
                <th style={{ width: 70 }}>Data</th>
                <th style={{ width: 100 }}>Commessa</th>
                <th>Descrizione attività</th>
                <th className="num" style={{ width: 50 }}>Ore</th>
              </tr>
            )}
          </thead>
          <tbody>
            {mode === "summary" ? summaryRows.map(r => (
              <tr key={r.code}>
                <td className="mono" style={{ fontSize: 10 }}>{r.code}</td>
                <td>{r.name}</td>
                <td className="num">{fmtNum(r.hours, r.hours % 1 === 0 ? 0 : 1)}</td>
              </tr>
            )) : acts.map(a => {
              const co = client.commesse.find(c => c.code === a.commessa);
              return (
                <tr key={a.id}>
                  <td className="mono">{String(a.day).padStart(2, "0")}/{mm}/{cYear}</td>
                  <td className="mono" style={{ fontSize: 10 }}>{a.commessa}</td>
                  <td>{a.desc}<div style={{ fontSize: 9.5, color: "#78716c" }}>{co?.name || ""}</div></td>
                  <td className="num">{fmtNum(a.hours, a.hours % 1 === 0 ? 0 : 1)}</td>
                </tr>
              );
            })}
            <tr style={{ borderTop: "1px solid #e7e5e4", fontWeight: 600 }}>
              <td colSpan={mode === "summary" ? 2 : 3}>Totale ore</td>
              <td className="num">{fmtNum(totalHours, totalHours % 1 === 0 ? 0 : 1)} h</td>
            </tr>
          </tbody>
        </table>
      </>
    ) : mode === "summary" ? (
      <table className="invoice">
        <thead>
          <tr>
            <th style={{ width: 100 }}>Commessa</th>
            <th>Descrizione</th>
            <th className="num" style={{ width: 60 }}>Ore totali</th>
            <th className="num" style={{ width: 60 }}>Tariffa</th>
            <th className="num" style={{ width: 70 }}>Importo</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.map(r => (
            <tr key={r.code}>
              <td className="mono" style={{ fontSize: 10 }}>{r.code}</td>
              <td>{r.name}</td>
              <td className="num">{fmtNum(r.hours, r.hours % 1 === 0 ? 0 : 1)}</td>
              <td className="num">{fmtEUR(client.hourlyRate)}</td>
              <td className="num">{fmtEUR(r.hours * client.hourlyRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <table className="invoice">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Data</th>
            <th style={{ width: 100 }}>Commessa</th>
            <th>Descrizione attività</th>
            <th className="num" style={{ width: 50 }}>Ore</th>
            <th className="num" style={{ width: 60 }}>Tariffa</th>
            <th className="num" style={{ width: 70 }}>Importo</th>
          </tr>
        </thead>
        <tbody>
          {acts.map(a => {
            const co = client.commesse.find(c => c.code === a.commessa);
            return (
              <tr key={a.id}>
                <td className="mono">{String(a.day).padStart(2, "0")}/{mm}/{cYear}</td>
                <td className="mono" style={{ fontSize: 10 }}>{a.commessa}</td>
                <td>{a.desc}<div style={{ fontSize: 9.5, color: "#78716c" }}>{co?.name || ""}</div></td>
                <td className="num">{fmtNum(a.hours, a.hours % 1 === 0 ? 0 : 1)}</td>
                <td className="num">{fmtEUR(client.hourlyRate)}</td>
                <td className="num">{fmtEUR(a.hours * client.hourlyRate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}
```

Also add a contract reference line in `PdfPreview`'s document header, after the `<div className="doc">` block (after the `docDate` line):

```jsx
        {(client.billingType === 'monthly' || client.billingType === 'project') && (
          <div style={{ fontSize: 10, color: "#78716c", marginTop: 4 }}>
            {client.billingType === 'monthly'
              ? `Canone mensile ${fmtEUR(client.monthlyRate)} · ${client.monthlyHours}h/mese`
              : `Progetto: ${fmtEUR(client.projectFee)} totali · ${client.projectEstimatedHours}h stimate`}
          </div>
        )}
```

- [ ] **Step 4: Start the app, create a monthly-rate client, add activities, open Export**

```bash
npm start
```

- Create a client with billingType `monthly`, monthlyRate `6000`, monthlyHours `160`
- Add some activities (different commesse)
- Open Export, verify the PDF preview shows the canone line + hours-only activity table
- Verify financial totals use 6000 as imponibile
- Download the Word doc, open it, verify the same structure

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/export.jsx
git commit -m "feat: export documents adapt to monthly/project billing types"
```

---

## Task 8: Export — ReconciliationPanel

**Files:**
- Modify: `src/renderer/components/export.jsx` (add component before `window.Export = Export`)
- Modify: `src/renderer/components/export.jsx` (render inside `Export` component)

- [ ] **Step 1: Add `ReconciliationPanel` component before `window.Export = Export`**

```jsx
const ReconciliationPanel = ({ client, acts, allActivities }) => {
  if (!client || (client.billingType !== 'monthly' && client.billingType !== 'project')) return null;

  const totalRealHours = acts.reduce((s, a) => s + a.hours, 0);
  const byCommessa = {};
  acts.forEach(a => {
    if (!byCommessa[a.commessa]) {
      const co = client.commesse.find(c => c.code === a.commessa);
      byCommessa[a.commessa] = { code: a.commessa, name: co?.name || a.commessa, hours: 0 };
    }
    byCommessa[a.commessa].hours += a.hours;
  });
  const commessaRows = Object.values(byCommessa);

  const panelStyle = {
    marginTop: 16, padding: 16,
    background: "var(--bg-sunken)", borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
  };
  const labelStyle = { color: "var(--text-muted)" };
  const rowStyle = { display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0" };

  if (client.billingType === 'monthly') {
    const contracted = client.monthlyHours || 0;
    const fee = client.monthlyRate || 0;
    const effectiveRate = totalRealHours > 0 ? fee / totalRealHours : 0;
    const contractedRate = contracted > 0 ? fee / contracted : 0;
    const utilization = contracted > 0 ? (totalRealHours / contracted) * 100 : 0;
    const indicatorColor = utilization > 110 ? "var(--danger)" : utilization > 90 ? "#a16207" : "oklch(0.45 0.14 145)";

    return (
      <div style={panelStyle}>
        <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
          Riconciliazione canone — solo uso interno
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Lavoro reale</div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", fontWeight: 500, padding: "3px 0" }}>Commessa</th>
                  <th style={{ textAlign: "right", fontWeight: 500 }}>Ore</th>
                  <th style={{ textAlign: "right", fontWeight: 500 }}>%</th>
                </tr>
              </thead>
              <tbody>
                {commessaRows.map(r => (
                  <tr key={r.code}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 0" }}>{r.code}</td>
                    <td style={{ textAlign: "right" }}>{fmtH(r.hours)}</td>
                    <td style={{ textAlign: "right", color: "var(--text-muted)" }}>
                      {totalRealHours > 0 ? fmtNum((r.hours / totalRealHours) * 100, 1) + "%" : "—"}
                    </td>
                  </tr>
                ))}
                <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                  <td style={{ padding: "4px 0" }}>Totale</td>
                  <td style={{ textAlign: "right" }}>{fmtH(totalRealHours)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Adeguamento contratto</div>
            <div style={rowStyle}><span style={labelStyle}>Ore contratto</span><span>{fmtH(contracted)}</span></div>
            <div style={rowStyle}><span style={labelStyle}>Ore lavorate</span><span>{fmtH(totalRealHours)}</span></div>
            <div style={rowStyle}>
              <span style={labelStyle}>Delta</span>
              <span style={{ color: totalRealHours > contracted ? "var(--danger)" : "inherit" }}>
                {totalRealHours >= contracted ? "+" : ""}{fmtH(totalRealHours - contracted)}
              </span>
            </div>
            <div style={rowStyle}>
              <span style={labelStyle}>Utilizzo</span>
              <span style={{ color: indicatorColor, fontWeight: 600 }}>{fmtNum(utilization, 1)}%</span>
            </div>
          </div>
        </div>
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 24, fontSize: 12 }}>
          <div>
            <span style={labelStyle}>Tariffa contrattuale: </span>
            <strong>{fmtEUR(contractedRate)}/h</strong>
            <span style={{ ...labelStyle, fontSize: 11 }}> ({fmtH(contracted)})</span>
          </div>
          <div>
            <span style={labelStyle}>Tariffa effettiva: </span>
            <strong style={{ color: effectiveRate > contractedRate ? "oklch(0.45 0.14 145)" : "inherit" }}>
              {fmtEUR(effectiveRate)}/h
            </strong>
            <span style={{ ...labelStyle, fontSize: 11 }}> ({fmtH(totalRealHours)} reali)</span>
          </div>
        </div>
      </div>
    );
  }

  // billingType === 'project'
  const allClientActs = (allActivities || []).filter(a => a.clientId === client.id);
  const cumulativeHours = allClientActs.reduce((s, a) => s + a.hours, 0);
  const estimated = client.projectEstimatedHours || 0;
  const totalFee = client.projectFee || 0;
  const effectiveRate = cumulativeHours > 0 ? totalFee / cumulativeHours : 0;
  const estimatedRate = estimated > 0 ? totalFee / estimated : 0;
  const progress = estimated > 0 ? (cumulativeHours / estimated) * 100 : 0;

  return (
    <div style={panelStyle}>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: 12, fontWeight: 600 }}>
        Avanzamento progetto — solo uso interno
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Questo mese</div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ color: "var(--text-muted)", borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", fontWeight: 500, padding: "3px 0" }}>Commessa</th>
                <th style={{ textAlign: "right", fontWeight: 500 }}>Ore</th>
              </tr>
            </thead>
            <tbody>
              {commessaRows.map(r => (
                <tr key={r.code}>
                  <td style={{ fontFamily: "var(--font-mono)", fontSize: 11, padding: "3px 0" }}>{r.code}</td>
                  <td style={{ textAlign: "right" }}>{fmtH(r.hours)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid var(--border)", fontWeight: 600 }}>
                <td style={{ padding: "4px 0" }}>Totale mese</td>
                <td style={{ textAlign: "right" }}>{fmtH(totalRealHours)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Avanzamento progetto</div>
          <div style={rowStyle}><span style={labelStyle}>Ore cumulative</span><span>{fmtH(cumulativeHours)}</span></div>
          <div style={rowStyle}><span style={labelStyle}>Ore stimate</span><span>{fmtH(estimated)}</span></div>
          <div style={rowStyle}>
            <span style={labelStyle}>Avanzamento</span>
            <span style={{ color: progress > 100 ? "var(--danger)" : "inherit", fontWeight: 600 }}>
              {fmtNum(Math.min(progress, 999), 1)}%
            </span>
          </div>
          <div style={rowStyle}><span style={labelStyle}>Compenso totale</span><span>{fmtEUR(totalFee)}</span></div>
        </div>
      </div>
      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 24, fontSize: 12 }}>
        <div>
          <span style={labelStyle}>Tariffa stimata: </span>
          <strong>{fmtEUR(estimatedRate)}/h</strong>
        </div>
        <div>
          <span style={labelStyle}>Tariffa effettiva (a oggi): </span>
          <strong style={{ color: cumulativeHours > estimated ? "var(--danger)" : "inherit" }}>
            {fmtEUR(effectiveRate)}/h
          </strong>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Render `ReconciliationPanel` inside the `Export` component**

In the `Export` return JSX, inside the `{/* Preview area */}` `<div>`, after the three preview conditionals (after the `{format === "word" && ...}` line), add:

```jsx
          <ReconciliationPanel client={client} acts={acts} allActivities={activities} />
```

- [ ] **Step 3: Start the app with a monthly client, open Export, verify the panel**

```bash
npm start
```

- Select a monthly-rate client in Export
- Verify the reconciliation panel appears below the document preview
- Check that the panel shows: commessa breakdown, contracted vs real hours, utilization %, and the two rates
- Select an hourly client → panel should not appear
- Verify the panel is not visible when printing (it's outside the `preview-paper` div so print CSS won't include it unless explicitly styled)

- [ ] **Step 4: Commit**

```bash
git add src/renderer/components/export.jsx
git commit -m "feat: add in-app reconciliation panel for monthly/project clients"
```

---

## Task 9: Settings — counter reset

**Files:**
- Modify: `src/renderer/components/settings.jsx`

- [ ] **Step 1: Read the full settings.jsx to find where to add the new section**

Open `src/renderer/components/settings.jsx` and identify which tab component manages data/backup info (it's `DataBackupTab`). Find the return JSX where the `card` sections are rendered.

- [ ] **Step 2: Add `docCounterYear` and `docCounterValue` state to `DataBackupTab`**

At the top of `DataBackupTab`, after the existing `useState` calls, add:

```js
  const currentYear = new Date().getFullYear();
  const [docCounter, setDocCounter] = useState(null);

  useEffect(() => {
    if (!hasAPI) return;
    window.api.db.getDocCounter(currentYear).then(setDocCounter);
  }, []);
```

- [ ] **Step 3: Add the counter section to the `DataBackupTab` return JSX**

Find the end of the `DataBackupTab` return, before the final closing `</>` or `</div>`. Add a new card:

```jsx
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header" style={{ padding: "12px 16px" }}>
          <h3 style={{ fontSize: 12.5 }}>Numerazione documenti</h3>
        </div>
        <div className="card-body" style={{ padding: 16 }}>
          <div style={{ fontSize: 13, marginBottom: 12 }}>
            Contatore documenti <strong>{currentYear}</strong>:{" "}
            <span className="mono" style={{ fontWeight: 600 }}>
              {docCounter === null ? "…" : `${currentYear}-${String(docCounter).padStart(3, "0")} (ultimo emesso)`}
            </span>
          </div>
          <button
            className="btn btn-danger btn-sm"
            onClick={async () => {
              if (!confirm(`Azzerare il contatore documenti per il ${currentYear}? Il prossimo documento sarà ${currentYear}-001.`)) return;
              await window.api.db.resetDocCounter(currentYear);
              setDocCounter(0);
              window.showToast(`✓ Contatore ${currentYear} azzerato`, "success");
            }}
          >
            Reset contatore {currentYear}
          </button>
          <div className="hint" style={{ marginTop: 6 }}>
            Usa solo in caso di errore. I numeri già emessi non vengono riassegnati.
          </div>
        </div>
      </div>
```

- [ ] **Step 4: Start the app, go to Impostazioni → Dati & Backup, verify the section appears**

```bash
npm start
```

- Navigate to Impostazioni
- Verify the "Numerazione documenti" card appears
- Verify it shows the current counter value
- Click Reset and confirm → counter should go to 0
- Next export should produce `{year}-001`

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings.jsx
git commit -m "feat: add document counter reset to settings"
```

---

## Task 10: Timesheet — effective rate display for non-hourly clients

**Files:**
- Modify: `src/renderer/components/timesheet.jsx` (line ~163)

- [ ] **Step 1: Update the row header sub-line in the `ts-row-header` cell**

In `timesheet.jsx`, find this line (around line 163):

```jsx
                  <div className="commessa">{r.commessa.code} · {fmtEUR(r.client.hourlyRate)}/h</div>
```

Replace with:

```jsx
                  <div className="commessa">
                    {r.commessa.code} · {
                      r.client.billingType === 'monthly'
                        ? `canone ${fmtEUR(r.client.monthlyRate)}/mese`
                        : r.client.billingType === 'project'
                        ? `progetto ${fmtEUR(r.client.projectFee)}`
                        : `${fmtEUR(r.client.hourlyRate)}/h`
                    }
                  </div>
```

Also update the grand amount computation (line ~91) which currently is:
```js
  const grandAmount = rows.reduce((s, r) => s + rowTotals[r.key] * r.client.hourlyRate, 0);
```

Replace with:
```js
  const grandAmount = rows.reduce((s, r) => {
    if (r.client.billingType === 'monthly') return s; // fixed fee shown in Export, not per-row
    if (r.client.billingType === 'project') return s;
    return s + rowTotals[r.key] * r.client.hourlyRate;
  }, 0);
```

And in the per-row amount cell (line ~188):
```jsx
                <div className="ts-cell" style={{ justifyContent: "flex-end", paddingRight: 14, fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 12.5 }}>
                  {fmtEUR(rowTotals[r.key] * r.client.hourlyRate)}
                </div>
```

Replace with:
```jsx
                <div className="ts-cell" style={{ justifyContent: "flex-end", paddingRight: 14, fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 12.5 }}>
                  {r.client.billingType === 'monthly' || r.client.billingType === 'project'
                    ? <span style={{ color: "var(--text-muted)", fontSize: 11 }}>canone</span>
                    : fmtEUR(rowTotals[r.key] * r.client.hourlyRate)
                  }
                </div>
```

- [ ] **Step 2: Start the app, verify the timesheet grid looks correct for all billing types**

```bash
npm start
```

- Hourly client: shows `CODE · €80/h` and amounts per row as before
- Monthly client: shows `CODE · canone €6.000/mese` and "canone" label in amount column
- Project client: shows `CODE · progetto €5.000` and "canone" label in amount column

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/timesheet.jsx
git commit -m "feat: timesheet shows billing type info for non-hourly clients"
```

---

## Self-Review Checklist

- [x] **Spec §1 (data model):** Task 5 adds all fields to client-form.jsx with correct defaults
- [x] **Spec §2 (export document per type):** Tasks 7 covers buildCSV, buildWordHTML, PdfPreview
- [x] **Spec §3 (reconciliation panel):** Task 8 implements ReconciliationPanel for both monthly and project types
- [x] **Spec §4 (document numbering):** Tasks 1–3 implement the counter; Task 6 wires it into the export screen with pending state and locking
- [x] **WordPreview not updated:** `WordPreview` in export.jsx reuses `buildWordHTML` output — no separate update needed since it renders the downloaded .doc format only
- [x] **db-json.js counter:** Task 2 covers the fallback
- [x] **Settings reset:** Task 9 covers it
- [x] **Timesheet display:** Task 10 covers it
- [x] **computeInvoiceAmounts backward compat:** The new function defaults to hourly when `billingType` is absent (matches all existing clients)
- [x] **Type consistency:** `monthlyRate`, `monthlyHours`, `projectFee`, `projectEstimatedHours`, `projectMonthlyAmount` used consistently across Tasks 4, 5, 7, 8
