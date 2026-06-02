# Design: Billing Models, Reconciliation & Document Numbering

**Date:** 2026-06-02  
**Status:** Approved  

---

## Overview

Three related features for Parcella:

1. **Multi billing model support** — clients can be billed hourly, monthly canone, or per project
2. **Document numbering fix** — replace the broken client-index counter with a global sequential counter per year
3. **In-app effort reconciliation** — internal panel showing real hours vs. contracted hours and effective hourly rate

---

## 1. Data Model — Client Billing Type

Add `billingType: "hourly" | "monthly" | "project"` to the client object. Existing clients default to `"hourly"` (backward compatible — no migration needed).

### Type-specific fields

**`hourly`** (existing, no change)
- `hourlyRate`: €/h

**`monthly`**
- `monthlyRate`: number — fixed net fee before cassa/VAT (e.g., 6000)
- `monthlyHours`: number — contracted hours bucket per month (e.g., 160)
- `hourlyRate`: kept as computed display value (`monthlyRate / monthlyHours`), not user-editable when type is monthly
- Existing `hoursPlafond` is superseded by `monthlyHours` for this type

**`project`**
- `projectFee`: number — total project fee (e.g., 5000)
- `projectEstimatedHours`: number — total estimated effort (e.g., 240)
- `projectMonthlyAmount`: number — installment invoiced per month (user-defined)
- `projectStart` / `projectEnd`: reuse existing `contractStart` / `contractEnd`

All existing fiscal fields (cassaPct, cassaIncluded, vatPct, withholding, paymentDays) apply to all billing types unchanged.

### `computeInvoiceAmounts` change

Currently: `imponibile = hours * client.hourlyRate`

New logic:
```
if billingType === "monthly"  → imponibile = client.monthlyRate
if billingType === "project"  → imponibile = client.projectMonthlyAmount
if billingType === "hourly"   → imponibile = hours * client.hourlyRate  (unchanged)
```

The rest of the cassa/IVA/withholding chain is unchanged.

---

## 2. Export Document — Per Billing Type

The client-facing document (PDF/Word/CSV) always reflects the contract, never the reconciliation.

### `hourly`
No change. Activity rows with hours × rate, totals as now.

### `monthly`
- **Imponibile**: always `monthlyRate` (fixed)
- **Document line**: *"Canone professionale mensile — {period}"* = monthlyRate
- **Activity breakdown table**: shown below the main line, lists real activities per commessa with hours only — no per-row amounts (transparency for client, no financial impact)
- **Totals block**: uses `monthlyRate` as imponibile → cassa → IVA → total

### `project`
- **Imponibile**: `projectMonthlyAmount` for the period
- **Document line**: *"Acconto progetto — {period}"* = projectMonthlyAmount
- **Activity breakdown**: same as monthly — hours only, no per-row amounts
- **Totals block**: uses `projectMonthlyAmount` as imponibile

### Document header note
For monthly/project, add a small contract reference line in the document header:
> *"Contratto: canone mensile {monthlyRate}€ · {monthlyHours}h/mese"*  
> or  
> *"Progetto: compenso totale {projectFee}€ · {projectEstimatedHours}h previste"*

---

## 3. In-App Reconciliation Panel

Visible only in the Export screen, below the document preview, when `billingType === "monthly"` or `"project"`. Never printed or exported.

### Monthly reconciliation

Two blocks side by side:

**Lavoro reale**
| Commessa | Ore reali | % sul totale |
|----------|-----------|--------------|
| ABC-001  | 40h       | 50%          |
| ABC-002  | 30h       | 37.5%        |
| ABC-003  | 10h       | 12.5%        |
| **Totale** | **80h** |              |

**Adeguamento contratto**
- Ore contratto: 160h
- Ore lavorate: 80h
- Delta: −80h (50% utilizzo)
- Indicatore visivo: verde (<90%), giallo (90–110%), rosso (>110%)

**Summary strip**
- Tariffa contrattuale: 6000€ / 160h = **37.50 €/h**
- Tariffa effettiva: 6000€ / 80h = **75.00 €/h**

### Project reconciliation

**Avanzamento progetto**
- Ore reali questo mese: Xh
- Ore cumulative (da inizio progetto): Yh
- Ore stimate totali: projectEstimatedHours
- Avanzamento: Y / projectEstimatedHours %
- Tariffa effettiva cumulativa: projectFee / Y €/h
- Tariffa stimata: projectFee / projectEstimatedHours €/h

---

## 4. Document Numbering Fix

### Bug
`docNum = {year}-{monthClients.findIndex(c => c.id === selectedId) + 1}` — always `001` when one client is active in a month.

### Fix
Store `docCounters: { "2026": 3, "2025": 7 }` in the existing KV store under the `studio` or a new `docCounters` key.

**New IPC method:** `window.api.db.nextDocNumber(year)` — atomically increments counter for the year and returns the new number.

**Behavior:**
- Preview displays `{year}-???` (pending) on load
- On first export action (Stampa PDF / Scarica DOC / Scarica CSV), `nextDocNumber` is called once per session per client; the number is stored in component state and reused for subsequent downloads of the same document
- Counter never decrements — used numbers are permanent
- Settings screen gains a *"Reset contatore documenti {year}"* action for corrections

**Format:** `{year}-{number.toString().padStart(3, "0")}` → `2026-004`

---

## 5. Client Form Changes

The "Condizioni economiche" section in `client-form.jsx` gains a billing type selector at the top. The visible fields change based on selection:

- **Oraria**: shows existing `hourlyRate` + `hoursPlafond`
- **Canone mensile**: shows `monthlyRate` (€/mese) + `monthlyHours` (h/mese) + computed `hourlyRate` (read-only)
- **A progetto**: shows `projectFee` + `projectEstimatedHours` + `projectMonthlyAmount` + date range (reuses contractStart/contractEnd)

The live calculation preview on the right updates accordingly:
- Monthly: shows `monthlyRate` as imponibile, with cassa/IVA computed on it
- Project: shows `projectMonthlyAmount` as imponibile

---

## Affected Files

| File | Change |
|------|--------|
| `src/renderer/components/client-form.jsx` | Add billing type selector + conditional fields |
| `src/renderer/components/shared.jsx` | Update `computeInvoiceAmounts` for monthly/project |
| `src/renderer/components/export.jsx` | Adapt document rendering per billing type; add reconciliation panel; add doc number pending/lock logic |
| `src/renderer/components/timesheet.jsx` | Show effective hourly rate for non-hourly clients in row header |
| `src/main/db.js` | Add `nextDocNumber(year)` method + docCounters KV support |
| `src/main/main.js` | Expose `nextDocNumber` IPC handler |
| `src/main/preload.js` | Expose `nextDocNumber` via contextBridge |
| `src/renderer/components/settings.jsx` | Add counter reset action |
