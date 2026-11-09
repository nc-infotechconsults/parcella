# Scadenzario F24 dichiarato — Piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Obiettivo:** le scadenze F24 smettono di essere codice in `computeTaxes` e diventano uno schema dichiarato e modificabile, con preset dai codici corretti. Le righe registrate diventano l'unica verità sui versamenti, e si applicano tre correzioni fiscali.

**Architettura:** un nuovo modulo UMD `src/renderer/f24-scheme.js`, fatto di funzioni pure (validazione, preset, generazione delle proposte, migrazione), caricato come `fiscal.js` sia nel browser sia nei test. `computeTaxes` in `taxes.jsx` continua a calcolare *quanto* si deve; delega a `scheduleFromScheme` il *quando e come*. Pannelli ed editor leggono e scrivono soltanto attraverso queste funzioni.

**Stack:** Electron 35, React 18 con Babel nel browser (nessuna build), `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-08-f24-scadenzario-design.md` (approvata il 2026-11-09). Chi esegue legge entrambi i documenti. La spec decide il *cosa*; questo piano decide file, nomi, firme e test.

**Scostamento dalla spec, voluto:** la spec dice "in `fiscal.js`". Qui la logica va in un file a parte, `f24-scheme.js`, con lo stesso schema UMD. `fiscal.js` ha già 412 righe di calcolo dell'anno fiscale, e lo scadenzario è una responsabilità diversa che cambia per motivi diversi.

## Vincoli globali

- **`~/Library/Application Support/parcella/timesheet.db` non si apre mai in scrittura.** Ogni prova manuale gira con `npm run start:dev` (`PARCELLA_DB=timesheet-dev.db`). Prima e dopo ogni prova sull'app vera: `md5 timesheet.db` deve restare `3f4acbca542e6c990e42055d56fea187`, senza file `-wal`/`-shm`.
- Si usa `npm test` (`node --test "tests/test-*.js"`). Baseline: **182 test, 167 pass, 15 fail**. I 15 sono i test SQLite che falliscono con `ERR_DLOPEN_FAILED`: `better-sqlite3` è compilato per l'ABI di Electron (133), mentre Node è 127. Il problema c'era già prima. Un task è verde quando i fallimenti sono **ancora esattamente quei 15** e i pass sono aumentati dei test nuovi.
- I valori che escono da `loadRenderer()` vengono da un altro realm: si confrontano campi primitivi, mai `deepStrictEqual` su oggetti o array.
- Niente bundler. Ogni file nuovo del renderer va aggiunto in `src/renderer/index.html` in ordine di dipendenza e in `tests/helpers/load-renderer.js`.
- I testi dell'interfaccia sono in italiano, scritti nel JSX come fanno oggi `taxes.jsx` e `settings.jsx` (nessuna chiave `i18n`).
- Arrotondamento: `round2 = n => Math.round((Number(n) || 0) * 100) / 100`, **per riga**.
- I codici e le causali sono **esattamente** quelli dell'Appendice A della spec.
- Formato slot: `"{tributo}/{riga}/{anno}"`, dove l'anno è quello fiscale di competenza.
- Ogni commit termina con la riga `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

Questi sono i casi che la spec implica e che è più facile rompere senza accorgersene. Ognuno ha un test nel task indicato.

1. **Uno schema salvato che al caricamento risulta invalido** (per esempio una base rinominata dopo un aggiornamento) → si usa il preset e compare un avviso visibile, invece di zero scadenze. *Task 3.*
2. **Uno schema salvato non segue `studio`:** se l'utente cambia cassa in Impostazioni, lo schema salvato resta quello. Solo "Ripristina" lo ricollega al preset. *Task 3.*
3. **Importi registrati come stringa** nei dati vecchi (`"6800"`, `"6800,5"`) → nel saldo e nella deduzione valgono come numeri, non come 0 o NaN. *Task 4.*
4. **Una riga registrata con uno slot che lo schema non ha più** (un acconto IRPEF pagato prima di passare a `metodo: 'nessuno'`) → riduce comunque il saldo del suo anno, come un acconto fuori programma. *Task 4.*
5. **Una riga registrata il cui tributo è stato cancellato dallo schema** → non entra nella deduzione e viene segnalata come "tributo da indicare". *Task 7.*

---

## Struttura dei file

**Creati**
- `src/renderer/f24-scheme.js`: UMD. `SCHEME_BASES`, `validateScheme`, `presetIdFor`, `presetScheme`, `activeScheme`, `schemeSlots`, `inferTributo`, `kindOf`, `scheduleFromScheme`, `migrateFiscal`.
- `tests/helpers/f24-scenarios.js`: gli scenari condivisi fra fixture ed equivalenza.
- `tests/helpers/capture-legacy-f24.js`: script che fotografa il generatore attuale.
- `tests/fixtures/f24-legacy.json`: la fotografia.
- `tests/test-f24-scheme-validate.js`, `tests/test-f24-scheme-presets.js`, `tests/test-f24-scheme-schedule.js`, `tests/test-f24-scheme-iva.js`, `tests/test-f24-scheme-equivalence.js`, `tests/test-f24-scheme-migrate.js`, `tests/test-addizionali.js`.

**Modificati**
- `src/renderer/components/taxes.jsx`: `taxLiability` (addizionali), `computeTaxes` (blocco scadenze, `CONTRIB_CODES`, `flagged`, `statusOf`, saldi), `TaxIRPEF`, `TaxCassa`, `TaxIRAP`, `TaxIVA`, `TaxF24`.
- `src/renderer/fiscal.js`: `upsertF24Entry` conserva `tributo`, `slot`, `anno`.
- `src/renderer/components/settings.jsx`: nuova `ScadenzarioCard`; `FiscalRatesCard` nasconde i campi superati.
- `src/renderer/app.jsx`: chiama `migrateFiscal` al caricamento.
- `src/renderer/index.html`, `tests/helpers/load-renderer.js`: caricano `f24-scheme.js`.
- `tests/test-acconti.js`, `tests/test-irpef-base.js`, `tests/test-f24-schedule.js`, `tests/test-f24-entries.js`: adeguati.

---

### Task 0: Branch e punto di partenza

Questo lavoro poggia su modifiche **non committate** di `feat/invoice-import`: `upsertF24Entry`/`removeF24Entry`, il form delle voci F24, la correzione di `hasPrevData` e altro (vedi `git status`). Per le regole Git dell'utente ogni feature ha il suo branch. Lo scadenzario va quindi su `feat/f24-scadenzario`, aperto **da** `feat/invoice-import` una volta committato. Le due feature arriveranno su `main` in ordine.

- [ ] **Step 1:** con l'OK esplicito dell'utente, committare su `feat/invoice-import` il lavoro in sospeso, diviso in commit tematici (archivio dei contenitori, `hasPrevData`, voci F24, percorso del db). Escludere `.claude/launch.json`.
- [ ] **Step 2:** `git switch -c feat/f24-scadenzario`
- [ ] **Step 3:** `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`. Atteso: `tests 182`, `pass 167`, `fail 15`.
- [ ] **Step 4:** committare la spec e questo piano: `git add docs/superpowers/specs/2026-11-08-f24-scadenzario-design.md docs/superpowers/plans/2026-11-09-f24-scadenzario.md && git commit -m "docs: spec e piano dello scadenzario F24 dichiarato"`

### Task 1: Fotografia del generatore attuale

Va fatta **prima** di toccare `computeTaxes`: il test di equivalenza (Task 7) confronta il nuovo generatore con questa fotografia.

**Files:**
- Create: `tests/helpers/f24-scenarios.js`, `tests/helpers/capture-legacy-f24.js`, `tests/fixtures/f24-legacy.json`

**Interfacce:**
- Produce: `module.exports = { SCENARIOS }`, dove `SCENARIOS` è un array di `{ name, year: '2026', fiscal, studio, invoices }`.

- [ ] **Step 1: scrivere `f24-scenarios.js`** con cinque scenari. Le fatture si costruiscono con gli helper `active`/`prevYear` copiati da `tests/test-acconti.js`, con un 2025 di 40.000 € imponibili e un 2026 di 10.000 €. Fatture IVA in tutti e quattro i trimestri, così ogni periodo ha un saldo positivo. In ogni scenario tutte le spunte `*Paid` sono false e `f24History: []`.
  - `gs-con-anno-prima`: `{ tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' }`, con le fatture 2025.
  - `gs-ripiego`: come sopra ma senza fatture 2025, con `irpefPrevYear: 28400` e `cassaPrevYear: 6800`.
  - `cassa-privata`: `cassaName: 'Inarcassa'`, con le fatture 2025.
  - `ditta`: `{ tipoSoggetto: 'ditta_individuale' }`, con `inpsMinimale: 4427` e `inpsPctVariabile: 24`, e le fatture 2025.
  - `societa`: `{ tipoSoggetto: 'societa' }`.
- [ ] **Step 2: scrivere `capture-legacy-f24.js`.** Per ogni scenario chiama `loadRenderer().computeTaxes([], [], fiscal, year, [], studio, invoices)` e scrive in `tests/fixtures/f24-legacy.json` un oggetto `{ [name]: [{ id, date, code, amount }] }` con le sole righe `_generated`.
- [ ] **Step 3:** `node tests/helpers/capture-legacy-f24.js && node -e "const f=require('./tests/fixtures/f24-legacy.json');for(const k in f)console.log(k,f[k].length)"`. Atteso: cinque righe, ognuna con almeno 3 scadenze. `ditta` ne ha almeno 10, `societa` solo righe con id `_q*`.
- [ ] **Step 4:** commit: `test: fotografia del calendario F24 prima dello scadenzario`

### Task 2: Modulo `f24-scheme.js` e `validateScheme`

**Files:**
- Create: `src/renderer/f24-scheme.js`, `tests/test-f24-scheme-validate.js`
- Modify: `src/renderer/index.html` (dopo `fiscal.js`), `tests/helpers/load-renderer.js` (dopo `fiscal.js`)

**Interfacce:**
- Produce:
  - `SCHEME_BASES = ['irpef','addReg','addCom','contribCassa','contribFisso','contribVar','irap','ivaPeriodo']`
  - `SCHEME_KINDS = ['imposta','contributo','iva']`
  - `SCHEME_SEZIONI = ['erario','inps','regioni','locali','altri-enti']`
  - `validateScheme(scheme) → { ok: boolean, errors: Array<{path: string, message: string}>, warnings: Array<{path, message}> }`. `path` è in notazione `tributi[1].righe[0].date`.

- [ ] **Step 1: scrivere i test**, uno per regola della spec (sezione "Validazione"). Ogni test parte da uno schema valido minimo (`validScheme()`: IRPEF con una riga `acconto` e un `saldo`, più IVA con `q1`) e lo rompe in un punto solo. Il primo verifica `ok === true` sullo schema intatto. Asserzioni: `ok === false` e un errore con quel `path`:
  - `tributo duplicato` → `tributi[1].id`
  - `riga duplicata` → `tributi[0].righe[1].id`
  - `kind sconosciuto`, `base sconosciuta`, `ivaPeriodo con kind imposta`, `kind iva con base irpef`
  - `data non MM-GG`: per `'6-30'`, `'13-01'`, `'02-30'` e `'02-29'`
  - `yearOffset 2`, `code vuoto`, `share 101`, `share -1`
  - `acconto con metodo nessuno`, `due saldi`
  - `mese IVA non valido` (`'13'`), `mese in due periodi`
  - `acconto IVA su periodo inesistente`, `acconto IVA pct 120`
  - `soglia negativa`, `fallbackPrevYear negativo`
  - `code vuoto ammesso`: tributo `contributo` con `sezione: 'altri-enti'` e `code: ''` → `ok === true`
  - `avvertimento quote acconti`: acconti IRPEF 40 + 50 → `ok === true` e `warnings[0].path === 'tributi[0].acconti'`
- [ ] **Step 2:** `node --test tests/test-f24-scheme-validate.js`. Atteso: FAIL, `validateScheme is not a function` (o modulo mancante).
- [ ] **Step 3:** creare `f24-scheme.js` con lo stesso involucro UMD di `fiscal.js`, senza dipendenze, e implementare `validateScheme`. Lo stesso test deve passare anche con `require('../src/renderer/f24-scheme')`, oltre che via `loadRenderer()`: il file di test usa `require`.
- [ ] **Step 4:** `node --test tests/test-f24-scheme-validate.js` → PASS. Poi `npm test`: 15 fallimenti, quelli della baseline.
- [ ] **Step 5:** commit: `feat: forma e validazione dello schema F24`

### Task 3: Preset, schema attivo, slot e inferenza del tributo

**Files:**
- Modify: `src/renderer/f24-scheme.js`
- Test: `tests/test-f24-scheme-presets.js`

**Interfacce:**
- Consuma: `validateScheme` (Task 2).
- Produce:
  - `presetIdFor(studio) → 'professionista-gs' | 'professionista-cassa' | 'ditta' | 'solo-iva'`
  - `presetScheme(id, fiscal) → scheme` con `version: 1, preset: id`
  - `activeScheme(fiscal, studio) → { scheme, source: 'saved' | 'preset', warning: string | null }`
  - `schemeSlots(scheme, tributoId, year) → Array<{ slot, label, date }>`, con le righe e i periodi del tributo, più l'acconto IVA se presente. `date` è completa (`YYYY-MM-DD`).
  - `inferTributo(code, scheme) → string | null`
  - `kindOf(row, scheme) → 'imposta' | 'contributo' | 'iva' | null`: dal `row.tributo` presente nello schema, altrimenti `null`.

Id dei tributi nei preset (fissi, i task successivi li usano): `irpef`, `addReg`, `addCom`, `contributi`, `inpsFisso`, `inpsEccedente`, `irap`, `iva`. Id delle righe: `acc1`, `acc2`, `saldo`, `r1`…`r4` (INPS fisso), `q1`…`q4`, `acconto` (IVA). Per `addCom` l'acconto unico è `acc1`.

- [ ] **Step 1: scrivere i test.**
  - `presetIdFor`: i quattro casi della tabella della spec; `{}` → `'professionista-gs'` se `cassaName` è GS, altrimenti `'professionista-cassa'` (oggi il default di `tipoSoggetto` è professionista).
  - `ogni preset è valido`: per i quattro id, `validateScheme(presetScheme(id, {})).ok === true`.
  - `codici dell'Appendice A`: una tabella attesa `{ [presetId]: { [tributo/riga]: code } }` scritta a mano dall'appendice, e confronto riga per riga. Per esempio: `professionista-gs`: `irpef/acc1 4033`, `irpef/acc2 4034`, `irpef/saldo 4001`, `addReg/saldo 3801`, `addCom/acc1 3843`, `addCom/saldo 3844`, `contributi/* PXX`, `iva/q1 6031`, `iva/q2 6032`, `iva/q3 6033`, `iva/q4 6099`, `iva/acconto 6035`. `ditta`: `inpsFisso/r1..r4 AF`, `inpsEccedente/* AP`, `irap/acc1 3812`, `irap/acc2 3813`, `irap/saldo 3800`, e nessun tributo `contributi`. `professionista-cassa`: `contributi/*` con `code === ''` e `sezione === 'altri-enti'`. `solo-iva`: solo il tributo `iva`.
  - `date e quote dei preset`: `irpef` 40/60 al `06-30`/`11-30`, saldo `06-30` con `yearOffset 1`. `contributi` `pct` 80 (GS) o 100 (cassa), rate 50/50. `addCom` `pct` 30 con un'unica riga `acc1` al 100%. `addReg` `metodo: 'nessuno'`. `inpsFisso` quattro righe `corrente` al 25% (`05-16`, `08-20`, `11-16`, `02-16`+1). `inpsEccedente` storico 100%, 50/50. IVA `acconto` con `pct 88`, `soglia 103.29`, data `12-27`, `periodo 'q4'`.
  - `ripieghi dai campi vecchi`: `presetScheme('professionista-gs', { irpefPrevYear: 700, cassaPrevYear: 17000, cassaAccontoPct: 75 })` → `irpef.acconti.fallbackPrevYear === 700`, `contributi.acconti.fallbackPrevYear === 17000`, `contributi.acconti.pct === 75`.
  - `activeScheme`: senza `fiscal.scadenzario` → `source 'preset'`; con uno schema valido → `source 'saved'`, anche se `studio` indica un altro preset (**Review Focus 2**); con uno schema salvato invalido (base `'irpefNetta'`) → `source 'preset'` e `warning` che contiene `"non valido"` (**Review Focus 1**).
  - `schemeSlots(preset gs, 'irpef', 2026)` → slot `irpef/acc1/2026`, `irpef/acc2/2026`, `irpef/saldo/2026`, con date `2026-06-30`, `2026-11-30`, `2027-06-30`.
  - `inferTributo`: `3801` e `0601` → `'contributi'` (o `'inpsFisso'` nel preset ditta); `4001`, `4033`, `4034` → `'irpef'`; `6031`, `6099`, `6035`, `6007` → `'iva'`; `3812` → `'irap'`; `PXX`, `PXXR`, `AF`, `CPR` → il tributo contributivo; `'9999'` → `null`.
- [ ] **Step 2:** `node --test tests/test-f24-scheme-presets.js` → FAIL.
- [ ] **Step 3:** implementare. Le etichette dei preset si scrivono come nell'esempio della spec (`'1° acconto IRPEF {anno}'`, `'Saldo {cassaLabel} {anno}'` risolto in `INPS` o `cassa`, `'IVA 1° trim {anno}'`, …).
- [ ] **Step 4:** test → PASS; `npm test` → solo i 15 di sempre.
- [ ] **Step 5:** commit: `feat: preset dello scadenzario con i codici tributo corretti`

### Task 4: `scheduleFromScheme` per imposte e contributi

**Files:**
- Modify: `src/renderer/f24-scheme.js`
- Test: `tests/test-f24-scheme-schedule.js`

**Interfacce:**
- Consuma: `presetScheme`, `kindOf` (Task 3).
- Produce: `scheduleFromScheme({ scheme, year, bases, prevBases, ivaPeriods, prevIvaPeriods, recorded, basedOn }) → { proposals, saldi, acconti, crediti }`
  - `year`: numero. `bases` e `prevBases`: `{ irpef, addReg, addCom, contribCassa, contribFisso, contribVar, irap }`. Con `prevBases === null` si usa `acconti.fallbackPrevYear` di ogni tributo.
  - `ivaPeriods` e `prevIvaPeriods`: `Array<{ months: string[], saldo: number }>` oppure `null`. In questo task si ignorano (Task 5).
  - `recorded`: `fiscal.f24History`. `basedOn`: stringa come oggi (`"su 2025 effettivo"`).
  - `proposals`: `Array<{ id: '_' + slot, slot, tributo, kind, sezione, date, code, desc, amount, _generated: true }>`, già filtrate (importo > 0, slot non coperto da una riga registrata `paid` o `scheduled`) e ordinate per data.
  - `saldi`: `{ [tributoId]: number }`, anche negativo. `acconti`: `{ [tributoId]: number }`, cioè la somma degli acconti che il saldo sottrae. `crediti`: `{ [tributoId]: number }`, il valore assoluto dei saldi negativi.

- [ ] **Step 1: scrivere i test** sul preset `professionista-gs`, con `bases = { irpef: 8000, addReg: 1700, addCom: 800, contribCassa: 13000 }` e `prevBases = { irpef: 5000, addReg: 1500, addCom: 700, contribCassa: 17000 }`, anno 2026:
  - `acconti IRPEF storici 40/60`: `irpef/acc1/2026` = 2000, `irpef/acc2/2026` = 3000; saldo `irpef/saldo/2026` = 3000, datato `2027-06-30`.
  - `acconti contributi 80% in due metà`: 6800 e 6800; saldo `13000 − 13600` → nessuna proposta, `crediti.contributi === 600`.
  - `addizionale regionale senza acconti`: nessuna riga `addReg/acc*`; `addReg/saldo/2026` = 1700.
  - `addizionale comunale acconto 30%`: `addCom/acc1/2026` = 210, saldo = 590.
  - `metodo nessuno`: schema con `irpef.acconti.metodo = 'nessuno'` e senza righe acconto → `saldi.irpef === 8000`, nessuna proposta `irpef/acc*`.
  - `ripiego senza anno prima`: `prevBases: null` e `fallbackPrevYear` IRPEF 700 → acconti 280 e 420.
  - `soglia`: `acconti.soglia = 51.65` e base acconti 50 → nessun acconto e saldo uguale alla base intera.
  - `etichette`: `{anno}` sostituito; una riga acconto ha `desc` che termina con `(su 2025 effettivo)`.
  - `una riga registrata paid sopprime la proposta e ne fissa l'importo`: `recorded = [{ slot: 'irpef/acc1/2026', tributo: 'irpef', status: 'paid', amount: 1500, date: '2026-07-10' }]` → nessuna proposta con quello slot, e `saldi.irpef === 8000 − 1500 − 3000`.
  - `una riga spostata di data resta collegata al suo slot`: come sopra, ma con `date: '2026-12-30'`.
  - `una riga estimated non conta`: lo stesso slot con `status: 'estimated'` → la proposta resta e il saldo usa l'importo proposto.
  - `acconto fuori programma riduce il saldo`: riga senza slot, `tributo: 'contributi'`, `anno: 2026`, `status: 'paid'`, `amount: 1000` → `saldi.contributi` diminuisce di 1000. La stessa riga senza `anno` non lo cambia.
  - `slot orfano riduce il saldo` (**Review Focus 4**): schema IRPEF `nessuno` e riga registrata `paid` con `slot: 'irpef/acc1/2026'`, `amount: 1000` → `saldi.irpef === 7000`. Lo slot ha la precedenza su `anno`.
  - `importi registrati come stringa` (**Review Focus 3**): `amount: '1500'` e `amount: '1500,5'` danno saldi calcolati con 1500 e 1500,5.
  - `righe corrente`: preset `ditta` con `contribFisso: 4427` → quattro righe `inpsFisso/r1..r4` da 1106,75, nessun saldo per `inpsFisso`.
- [ ] **Step 2:** test → FAIL.
- [ ] **Step 3:** implementare `scheduleFromScheme` per i tributi `imposta`/`contributo`. Come si valuta ogni acconto per il saldo:

```
per ogni riga r con quota 'acconto' del tributo T, anno Y:
  reg = recorded con slot === `${T}/${r.id}/${Y}` e status paid|scheduled
  valore = reg ? num(reg.amount) : proposto(r)
extra = recorded di T con status paid|scheduled, che:
  - hanno uno slot `${T}/X/${Y}` dove X non è una riga acconto né il saldo dello schema, OPPURE
  - non hanno slot e hanno anno === Y
saldo(T) = base(T) − Σ valore − Σ num(extra.amount)
```

  dove `num` accetta anche la virgola decimale.
- [ ] **Step 4:** test → PASS; `npm test` → solo i 15 di sempre.
- [ ] **Step 5:** commit: `feat: proposte F24 dallo schema, con saldi sugli acconti reali`

### Task 5: IVA per periodo e acconto di dicembre

**Files:**
- Modify: `src/renderer/f24-scheme.js`
- Test: `tests/test-f24-scheme-iva.js`

**Interfacce:**
- Consuma: `scheduleFromScheme` (Task 4), di cui estende il ramo `kind === 'iva'`. Il valore restituito non cambia.

- [ ] **Step 1: scrivere i test.** Preset `professionista-gs`, anno 2026, `ivaPeriods` trimestrali con saldi `[4000, 6000, 2000, 3000]`, `prevIvaPeriods` con q4 = 3120:
  - `trimestri con maggiorazione`: `iva/q1/2026` = 4040 (`2026-05-16`, 6031), `iva/q2` = 6060 (`2026-08-20`, 6032), `iva/q3` = 2020 (`2026-11-16`, 6033).
  - `acconto 88% al lordo`: `iva/acconto/2026` = 2745,60, datato `2026-12-27`, 6035.
  - `quarto trimestre al netto dell'acconto`: `iva/q4/2026` = `round2((3000 − 2745.60) × 1.01)` = 256,94, datato `2027-03-16`, 6099.
  - `acconto registrato a importo diverso`: riga `paid` con slot `iva/acconto/2026` e importo 2000 → q4 = `round2(1000 × 1.01)` = 1010.
  - `sotto soglia non dovuto`: q4 dell'anno prima = 100 → acconto 88 < 103,29 → nessuna proposta e q4 = 3030.
  - `acconto maggiore della liquidazione`: q4 = 1000 → nessuna proposta q4 e `crediti.iva > 0`.
  - `senza anno prima si usa il ripiego`: `prevIvaPeriods: null` e `acconto.fallbackPrevYear: 3120` → 2745,60; con ripiego 0 → nessun acconto.
  - `saldo di periodo negativo`: q2 = −500 → nessuna riga q2.
  - `periodi mensili`: schema con dodici periodi `m01..m12` (6001…6012, il 16 del mese dopo, `m12` al `01-16` con `yearOffset 1`) e `acconto.periodo: 'm12'`, `code: '6013'` → `iva/m12/2026` ridotto dell'acconto; `ivaPeriods` mensili sommati per mesi contenuti.
- [ ] **Step 2:** test → FAIL.
- [ ] **Step 3:** implementare. Un periodo dello schema somma gli `ivaPeriods` i cui `months` sono tutti contenuti nei suoi, con la stessa regola di `trimestri` in `computeTaxes`. La maggiorazione si applica dopo aver tolto l'acconto: è l'ipotesi della spec, segnata come punto aperto.
- [ ] **Step 4:** test → PASS; `npm test` → solo i 15 di sempre.
- [ ] **Step 5:** commit: `feat: IVA per periodo e acconto di dicembre nello scadenzario`

### Task 6: Addizionali separate in `taxLiability`

**Files:**
- Modify: `src/renderer/components/taxes.jsx` (`taxLiability`, righe 11-91)
- Test: `tests/test-addizionali.js`

**Interfacce:**
- Produce: `taxLiability(...)` restituisce in più `irpefSola` (= `max(0, irpefLorda − ritenuta)`), `addRegDovuta`, `addComDovuta`. `irpefNetta` diventa `irpefSola + addReg + addCom`, arrotondato. `ritenutaCredito` diventa `max(0, ritenuta − irpefLorda)`.

- [ ] **Step 1: scrivere i test**, con `window.taxLiability` da `loadRenderer()` e un `fy` costruito a mano (`consuntivo` con `ricaviIncassati`, `costiDeducibili`, `costiEsercizio: 0`, `quoteAmmortamento: 0`, `ritenutaIncassata`), `fiscal = { addRegPct: 1.73, addComPct: 0.8, cassaContribPct: 26.07 }`:
  - `le ritenute riducono solo l'IRPEF`: ritenuta inferiore all'IRPEF lorda → `irpefSola === round2(irpefLorda − ritenuta)` e `irpefNetta === round2(irpefSola + addReg + addCom)`.
  - `ritenute oltre l'IRPEF lorda`: ritenuta = IRPEF lorda + 500 → `irpefSola === 0`, `ritenutaCredito === 500`, e `irpefNetta === round2(addReg + addCom)`. Oggi varrebbe `max(0, addReg + addCom − 500)`.
  - `stesso totale quando l'IRPEF copre le ritenute`: con ritenuta bassa, `irpefNetta` è uguale a quello calcolato con la formula vecchia (scritta nel test).
- [ ] **Step 2:** test → FAIL.
- [ ] **Step 3:** modificare `taxLiability`.
- [ ] **Step 4:** test → PASS. `npm test`: alcuni test esistenti su `irpefNetta` o sui saldi possono cambiare solo nel caso "ritenute oltre l'IRPEF". Se ne fallisce uno, va controllato e, se rientra in quel caso, il valore atteso si corregge con un commento che rimanda alla correzione 1 della spec. Nessun altro test deve cambiare.
- [ ] **Step 5:** commit: `fix: le ritenute si scomputano solo dall'IRPEF, le addizionali restano dovute`

### Task 7: `computeTaxes` usa lo schema

**Files:**
- Modify: `src/renderer/components/taxes.jsx` (`computeTaxes`, righe 150-334 circa)
- Test: `tests/test-f24-scheme-equivalence.js`. Si adeguano `tests/test-acconti.js`, `tests/test-irpef-base.js` e `tests/test-f24-schedule.js`.

**Interfacce:**
- Consuma: `activeScheme`, `scheduleFromScheme`, `kindOf` (Task 3-5), `taxLiability` (Task 6).
- Produce: `computeTaxes(...)` restituisce gli stessi campi di oggi, più `scheme`, `schemeSource`, `schemeWarning`, `saldi`, `acconti`, `crediti` (da `scheduleFromScheme`) e `irpefSola`, `addRegDovuta`, `addComDovuta`. Le righe di `f24All` hanno anche `slot`, `tributo`, `kind`, `sezione`. `accontiIrpef`/`saldoIrpef` = `acconti.irpef`/`saldi.irpef`. `accontiCassa`/`saldoCassa` = somma sui tributi con base `contribCassa`, 0 se non ce ne sono.

- [ ] **Step 1: scrivere `test-f24-scheme-equivalence.js`.** Per ogni scenario di `f24-scenarios.js`, le proposte nuove coincidono in **data e importo** con la fixture per le righe in mappa: `_q1→iva/q1`, `_q2→iva/q2`, `_q3→iva/q3`, `_cassa_acc1→contributi/acc1`, `_cassa_acc2→contributi/acc2`, `_cassa_saldo→contributi/saldo`, `_inps_f1..f4→inpsFisso/r1..r4`. Le righe legacy `_q4`, `_irpef_*`, `_inps_v*` e `_irap_*` sono escluse per nome, con un commento che rimanda a "Correzioni fiscali".
- [ ] **Step 2: scrivere i test delle correzioni 3**, in `test-f24-scheme-equivalence.js` sotto un `describe` dedicato, sullo scenario `ditta`:
  - `IRAP sull'anno prima`: `irap/acc1/2026` = `round2(irapPrev × 0.4)`, dove `irapPrev` è l'IRAP del 2025 ricalcolata nel test con `taxLiability`, con `acc2` al 60% e il saldo al `2027-06-30` con 3800.
  - `INPS eccedente sull'anno prima`: `inpsEccedente/acc1` e `acc2` = metà di `contribVar` 2025, al 30/06 e al 30/11, con AP.
- [ ] **Step 3: scrivere i test della deduzione**, in `test-irpef-base.js`:
  - `solo le righe di tributo contributivo deducono`: una riga `paid` con `tributo: 'contributi'` deduce, mentre una con `tributo: 'irpef'` e codice `3801` non deduce. Oggi dedurrebbe per codice.
  - `una riga con tributo cancellato dallo schema non deduce` (**Review Focus 5**): schema salvato senza `contributi` e riga `tributo: 'contributi'` → `contributiVersati === 0`, e la riga in `f24All` ha `kind === null`.
- [ ] **Step 4:** `node --test tests/test-f24-scheme-equivalence.js tests/test-irpef-base.js` → FAIL.
- [ ] **Step 5:** in `computeTaxes`:
  - sostituire `CONTRIB_CODES`/`contributiPagatiIn` con la somma delle righe `paid` dell'anno con `kindOf(row, scheme) === 'contributo'`;
  - togliere `flagged`, `statusOf` e il blocco "Scadenze F24 dinamiche";
  - costruire `bases` da `cur` e `prevBases` da `taxLiability(fyPrev)` (con `null` se `!hasPrevData`);
  - `ivaPeriods` da `fy.periods`, `prevIvaPeriods` da `fyPrev.periods`;
  - chiamare `scheduleFromScheme`;
  - nel merge, tenere le righe registrate senza slot con la regola `date|code` di oggi solo per sopprimere una proposta che abbia stessa data e stesso codice, per i dati non migrati;
  - esporre `kind` di ogni riga registrata tramite `kindOf`.
- [ ] **Step 6: adeguare i test che usano le spunte.** "an instalment the user marked versato…" e "senza ricavi l'anno prima, spuntare Versato…" in `test-acconti.js`, "il flag Versato conta la rata…" in `test-irpef-base.js`: la spunta diventa una riga registrata `paid` con lo slot corrispondente. L'asserzione sul comportamento resta quella. Nei test sui codici (`test-f24-schedule.js`) `6031` diventa il codice dell'Appendice per quel periodo. "a recorded F24 payment replaces the generated estimate…" passa allo slot.
- [ ] **Step 7:** `npm test` → solo i 15 di sempre, e i test nuovi sono verdi.
- [ ] **Step 8:** commit: `feat: il calendario F24 nasce dallo schema; le righe registrate sono l'unica fonte dei versamenti`

### Task 8: Righe registrate con tributo, slot e anno

**Files:**
- Modify: `src/renderer/fiscal.js` (`upsertF24Entry`), `src/renderer/components/taxes.jsx` (`TaxF24`: `markPaid`, form)
- Test: `tests/test-f24-entries.js`

**Interfacce:**
- Consuma: `schemeSlots`, `inferTributo` (Task 3); `tax.scheme` (Task 7).
- Produce: `upsertF24Entry(history, entry)` conserva `entry.tributo`, `entry.slot` ed `entry.anno` (intero) quando ci sono. `anno` si valida come intero di 4 cifre, altrimenti `throw new Error('f24: anno di competenza non valido')`.

- [ ] **Step 1: scrivere i test:**
  - `tributo, slot e anno sopravvivono`: le proprietà restano dopo un inserimento e dopo una modifica per id.
  - `un anno non valido viene rifiutato`: `anno: '26'` lancia `/anno/`.
  - `due righe con lo stesso slot non coesistono`: un secondo upsert senza id ma con lo stesso slot aggiorna la prima riga. Lo slot si cerca prima di `date|code`.
- [ ] **Step 2:** test → FAIL. **Step 3:** implementare. **Step 4:** test → PASS.
- [ ] **Step 5: UI di `TaxF24`.**
  - `markPaid(id)` copia `slot`, `tributo` e `anno` (l'anno dello slot) dalla proposta.
  - Il form ha due `<select>` nuovi. **Tributo** elenca i tributi di `tax.scheme`, preimpostato con `inferTributo(draft.code)`. **Scadenza** elenca `schemeSlots(tax.scheme, draft.tributo, fiscalYear)` più `"Fuori programma"`; con "Fuori programma" compare un campo **Anno di competenza**, preimpostato all'anno della data.
  - Una riga registrata con `kind === null` mostra il badge `tributo da indicare`.
  - `editEntry` ricarica anche questi tre campi.
- [ ] **Step 6: verifica manuale.** `npm run start:dev`, poi Tasse → F24. Aggiungere una voce "Fuori programma" da 100 € con tributo Contributi e anno 2026: il saldo contributi 2026 cala di 100. Spuntare "Versato" su una proposta: la riga registrata ha lo slot, e spostandone la data la proposta non ricompare. Alla fine controllare l'md5 di `timesheet.db`.
- [ ] **Step 7:** commit: `feat: le voci F24 dichiarano tributo e scadenza`

### Task 9: Migrazione

**Files:**
- Modify: `src/renderer/f24-scheme.js`, `src/renderer/app.jsx` (funzione `init`, dove si chiama `setFiscal(data.fiscal || …)`)
- Test: `tests/test-f24-scheme-migrate.js`

**Interfacce:**
- Consuma: `presetScheme`, `activeScheme`, `inferTributo` (Task 3).
- Produce: `migrateFiscal({ fiscal, studio, proposalsFor, now }) → { fiscal, log: string[], changed: boolean }`, dove `proposalsFor(year: number) → proposals` (le proposte di `computeTaxes` per quell'anno, con `recorded: []`). Le chiavi delle spunte tolte sono `irpefAcconto1Paid`, `irpefAcconto2Paid`, `cassaAcconto1Paid`, `cassaAcconto2Paid`, `ivaQ1Paid`…`ivaQ4Paid`, `ivaQ1Amount`.

Mappa delle spunte verso gli slot: `irpefAcconto1Paid→irpef/acc1`, `irpefAcconto2Paid→irpef/acc2`, `cassaAcconto1Paid→contributi/acc1`, `cassaAcconto2Paid→contributi/acc2`, `ivaQnPaid→iva/qn`.

- [ ] **Step 1: scrivere i test**, con un `proposalsFor` finto che restituisce proposte fisse:
  - `idempotente`: `migrateFiscal(migrateFiscal(x).fiscal)` ha `changed === false`.
  - `una spunta diventa una riga con lo stesso importo`: `cassaAcconto1Paid: true` e `year: 2026` → una riga `paid` con `slot 'contributi/acc1/2026'`, `tributo 'contributi'`, `anno 2026` e l'importo della proposta; la chiave della spunta sparisce.
  - `ivaQ1Amount vince sull'importo calcolato`.
  - `spunta senza riga di schema`: schema salvato con IRPEF `nessuno` e `irpefAcconto1Paid: true` → nessuna riga, la spunta tolta, una voce nel `log`.
  - `nessun doppio conteggio`: esiste già una riga con lo slot → nessuna riga nuova.
  - `senza fiscal.year si usa l'anno di now`.
  - `inferenza del tributo sulle righe vecchie`: `{ code: '3801', … }` → `tributo 'contributi'`; `'9999'` → nessun tributo. Il `code` non viene riscritto.
  - `slot per data e codice`: riga `2026-05-16 6031` → `slot 'iva/q1/2026'`, `anno 2026`.
  - `30/06 ambiguo deciso dalla descrizione`: riga `2026-06-30`, `'3801'`, `desc: 'Saldo INPS 2025'` → `slot 'contributi/saldo/2025'`, `anno 2025`; con `desc: '1° acconto INPS'` → `contributi/acc1/2026`. Entrambe le scelte compaiono nel `log`.
  - `nessuna corrispondenza`: niente slot e `anno` = anno della data.
  - `nessuno schema viene salvato`: dopo la migrazione `fiscal.scadenzario` è ancora assente.
- [ ] **Step 2:** test → FAIL. **Step 3:** implementare. Le proposte si confrontano con il codice **della fixture legacy**, cioè quello che l'app usava quando la riga è stata scritta: costruire la tabella `legacyCodes = { 'iva/q1': '6031', 'iva/q2': '6031', 'iva/q3': '6031', 'iva/q4': '6031', 'contributi/*': '3801', 'inpsFisso/*': '0601', 'inpsEccedente/*': '0601', 'irap/acc*': '3800', 'irpef/acc1': '4033', 'irpef/acc2': '4034', 'irpef/saldo': '4001' }` e confrontare sia con quello sia con il codice nuovo.
- [ ] **Step 4:** test → PASS.
- [ ] **Step 5: collegare in `app.jsx`.** Dopo aver caricato `data`, prima di `setFiscal`:

```js
const loadedFiscal = data.fiscal || window.APP_DATA.fiscal;
const loadedStudio = data.studio || window.APP_DATA.user;
const { fiscal: migrated, log } = window.migrateFiscal({
  fiscal: loadedFiscal, studio: loadedStudio, now: new Date(),
  proposalsFor: y => window.computeTaxes(data.activities || [], data.expenses || [],
    { ...loadedFiscal, f24History: [] }, String(y), data.clients || [], loadedStudio, data.invoices || []).f24All
    .filter(f => f._generated),
});
if (log.length) console.info('[migrazione F24]', log.join('\n'));
setFiscal(migrated);
```

  `computeTaxes` sta in `taxes.jsx`, caricato prima di `app.jsx`, quindi è già disponibile.
- [ ] **Step 6: verifica manuale** su una **copia** di `timesheet-dev.db`: `cp timesheet-dev.db timesheet-dev.PRIMA-scadenzario.db`, poi `npm run start:dev`. Nella console del renderer compare il log. In Tasse, la deduzione dei contributi 2026 è uguale a prima dell'avvio, e le spunte non ci sono più nel JSON `fiscal` (`sqlite3 timesheet-dev.db "select value from kv where key='fiscal'"`). Controllare l'md5 di `timesheet.db`.
- [ ] **Step 7:** commit: `feat: migrazione delle spunte Versato e delle voci F24 allo schema`

### Task 10: Pannelli IRPEF, Cassa, IRAP e IVA guidati dallo schema

**Files:**
- Modify: `src/renderer/components/taxes.jsx` (`TaxIRPEF` ~783, `TaxCassa` ~912, `TaxIRAP` ~1025, `TaxIVA` ~653; `Taxes` ~387 per passare `markPaid`/`unmarkPaid`)

**Interfacce:**
- Consuma: `tax.f24All` con `slot`/`tributo`, `tax.scheme`, `tax.saldi`, `tax.crediti` (Task 7); `upsertF24Entry`/`removeF24Entry`.
- Produce: `markPaid(row)` e `unmarkPaid(slot)` spostati da `TaxF24` a `Taxes` e passati come prop ai pannelli e a `TaxF24`. `unmarkPaid` rimuove la riga registrata con quello slot.

- [ ] **Step 1:** spostare `markPaid` in `Taxes` e aggiungere `unmarkPaid(slot)`, che chiede `window.confirm("Togliere il versamento registrato per questa scadenza?")` e poi chiama `removeF24Entry` sull'id della riga con quello slot. `TaxF24` usa le stesse funzioni.
- [ ] **Step 2: componente `SchemeRows`** (nello stesso file). Props: `tax`, `bases` (array di nomi), `onMark`, `onUnmark`. Per ogni tributo di `tax.scheme` con base in `bases`: titolo, righe di `tax.f24All` con quel `tributo` e uno slot dell'anno fiscale (proposte e registrate), ognuna con data, codice, importo e un pulsante `✓ Versato` / `Da versare` che chiama `onUnmark(slot)` o `onMark(row)`. Con `acconti.metodo === 'nessuno'` mostra "Nessun acconto previsto"; un saldo negativo appare come "Credito …". Le righe con importo ≤ 0 non hanno pulsante, perché non sono in `f24All`.
- [ ] **Step 3:** `TaxIRPEF` sostituisce le righe fisse 40/60 (~857-862) con `<SchemeRows bases={['irpef','addReg','addCom']} …/>`. `TaxCassa` sostituisce le due rate e i pulsanti (~972-982) con `bases={['contribCassa','contribFisso','contribVar']}`. `TaxIRAP` usa `bases={['irap']}`. `TaxIVA` legge il badge versato dalla riga con slot `iva/{id}/{anno}` invece di `q.paid`/`q.paidAmount`, e mostra la riga dell'acconto di dicembre.
- [ ] **Step 4:** cercare le spunte rimaste: `grep -n "Acconto[12]Paid\|ivaQ[1-4]Paid\|ivaQ1Amount" src/renderer/components/taxes.jsx` → nessun risultato.
- [ ] **Step 5:** `npm test` → solo i 15 di sempre.
- [ ] **Step 6: verifica manuale** con `npm run start:dev`:
  - con il preset GS, il pannello IRPEF mostra due acconti e il saldo, più le addizionali;
  - impostando lo schema IRPEF a "nessuno" (dal Task 11, oppure scrivendo `fiscal.scadenzario` a mano su una copia), compare "Nessun acconto previsto" e il saldo è intero;
  - "Versato" su un acconto contributi crea la riga registrata, e un secondo clic, dopo la conferma, la toglie;
  - controllare l'md5 di `timesheet.db`.
- [ ] **Step 7:** commit: `feat: i pannelli delle imposte mostrano le scadenze dello schema`

### Task 11: Editor dello scadenzario in Impostazioni

**Files:**
- Modify: `src/renderer/components/settings.jsx` (nuova `ScadenzarioCard`, montata nella scheda `fiscal` dopo le card esistenti; `FiscalRatesCard` ~418-575)

**Interfacce:**
- Consuma: `activeScheme`, `presetScheme`, `presetIdFor`, `validateScheme`, `SCHEME_BASES`, `SCHEME_KINDS`, `SCHEME_SEZIONI` (Task 2-3).
- Produce: `fiscal.scadenzario` salvato tramite `onSaveFiscal`. Con **Ripristina** si salva `fiscal` senza la chiave `scadenzario`.

- [ ] **Step 1: `ScadenzarioCard({ fisc, studio, onChange })`**, con la struttura dello schizzo nella spec (sezione Interfaccia):
  - stato locale `draft`, inizializzato da `activeScheme(fisc, studio).scheme`;
  - menu preset: alla scelta chiede conferma, poi `setDraft(presetScheme(id, fisc))`;
  - **Ripristina**: `onChange({ scadenzario: undefined })` e rilettura;
  - una riga per tributo, apribile, con i campi di tributo, acconti, righe e periodi;
  - errori di `validateScheme(draft)` accanto al campo (per `path`), **Salva** disabilitato se `!ok`, avvisi in giallo;
  - gli id non si modificano; "+ riga" e "+ tributo" generano id liberi (`r5`, `t2`, …);
  - cancellare un tributo con righe registrate collegate (`fisc.f24History.some(f => f.tributo === id)`) chiede conferma con il testo della spec;
  - con `activeScheme(...).warning` presente, l'avviso compare in testa alla card.
- [ ] **Step 2: campi superati.** In `FiscalRatesCard`, con `fisc.scadenzario` presente, nascondere il campo `cassaAccontoPct` (~465-472) e il blocco "Base per gli acconti" (~560-572), e al loro posto mostrare "Si impostano nello Scadenzario F24" con un link che fa scorrere la pagina alla card. Quando lo schema viene salvato per la prima volta, `presetScheme` ha già copiato i ripieghi (Task 3).
- [ ] **Step 3:** `npm test` → solo i 15 di sempre.
- [ ] **Step 4: verifica manuale** con `npm run start:dev`:
  - impostare IRPEF a "nessuno", salvare: gli acconti IRPEF spariscono da Tasse e il saldo è intero;
  - inserire una data `02-30`: Salva si disabilita con l'errore;
  - Ripristina: il preset torna e i campi vecchi ricompaiono;
  - controllare l'md5 di `timesheet.db`.
- [ ] **Step 5:** commit: `feat: editor dello scadenzario F24 in Impostazioni`

### Task 12: Verifica d'insieme

- [ ] **Step 1:** `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`. Atteso: `fail 15` (gli stessi della baseline: `grep "^not ok"` dà gli stessi 15 nomi) e i pass aumentati del numero di test aggiunti.
- [ ] **Step 2:** `grep -rn "CONTRIB_CODES\|flagged\|statusOf\|cassaAcconto[12]Paid" src/` → nessun risultato.
- [ ] **Step 3:** confronto con la spec, sezione per sezione: Obiettivi 1-6, Validazione, slot, Saldo, Preset, Correzioni 1-3, Migrazione 1-5, Interfaccia. Annotare le eventuali lacune come task aggiuntivi prima di dichiarare chiuso il lavoro.
- [ ] **Step 4:** md5 di `timesheet.db` invariato e nessun `-wal`/`-shm`.

### Task 13: Conversione dei dati dell'utente (solo `timesheet-dev.db`, con le sue cifre)

Questo task **non parte** senza le risposte dell'utente. Le domande da fare prima:
1. Importo reale del 1° acconto INPS di giugno 2026 e stato del 2° (30/11).
2. Cos'è la riga "3 Acconto INPS" da 10.000 € al 30/12/2026.
3. Versa l'acconto dell'addizionale comunale a giugno?
4. Verserà l'acconto IVA del 27/12? Se sì, la base di ripiego è 3.120 €.

- [ ] **Step 1:** `cp timesheet-dev.db timesheet-dev.PRIMA-conversione.db`.
- [ ] **Step 2:** con l'app chiusa, scrivere `fiscal.scadenzario` partendo da `presetScheme('professionista-gs', fiscal)`, con IRPEF `metodo: 'nessuno'` e senza righe acconto, e il resto secondo le risposte 3 e 4. Sostituire gli importi delle righe `contributi/acc1/2026` e `acc2` con quelli reali (risposta 1). Ricodificare: righe contributive `3801` → `PXX`; IVA 2° trimestre 2026 `6031` → `6032`; IVA 4° trimestre 2025 `6031` → `6099` (datata 16/02: chiedere se la data è quella reale). Cancellare `f6`. Sistemare la riga da 10.000 € secondo la risposta 2. Togliere `irpefAcconto1Paid`.
- [ ] **Step 3:** `sqlite3 timesheet-dev.db "pragma integrity_check"` → `ok`. Avviare `npm run start:dev` e rileggere Tasse con l'utente: deduzione contributi uguale alla somma dei versamenti reali, saldo IRPEF 2026 intero, nessun credito fantasma.
- [ ] **Step 4:** md5 di `timesheet.db` invariato.
