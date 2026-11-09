# Design: Scadenzario F24 dichiarato

**Data:** 2026-11-08
**Stato:** Approvato il 2026-11-09

---

## Perché

Oggi il calendario F24 è codice. Le scadenze nascono da circa 55 righe di
`generatedF24.push(...)` dentro `computeTaxes` (`src/renderer/components/taxes.jsx`,
blocco "Scadenze F24 dinamiche"). Date, codici tributo, percentuali e ripartizioni
sono scritti lì a mano e ramificati su `studio.tipoSoggetto`. Chi paga in modo
diverso da quello previsto non ha nessun modo di dirlo all'app.

Il caso concreto da cui nasce il progetto è l'utente stesso: ordinario,
professionista, Gestione Separata INPS. **Non versa acconti IRPEF** e paga tutta
l'imposta il 30 giugno dell'anno dopo. I contributi li versa a rate con importi che
conosce. L'app gli genera comunque due acconti IRPEF (40/60 di `irpefPrevYear`) e
due rate contributive calcolate, poi sottrae al saldo gli acconti che non ha mai
versato. Il risultato è un saldo IRPEF negativo di decine di migliaia di euro, cioè
un credito che non esiste.

Il secondo problema è più profondo. Oggi **tre canali** affermano che un versamento
è avvenuto, e la deduzione per cassa li somma:

1. le spunte "Versato" (`fiscal.cassaAcconto1Paid/2Paid`, `irpefAcconto1Paid/2Paid`,
   `ivaQ1..4Paid`), che iniettano l'importo **calcolato** come se fosse pagato
   (array `flagged` in `computeTaxes`);
2. le righe dello storico (`fiscal.f24History`), scritte a mano con importi veri;
3. il generatore, le cui righe diventano "paid" quando una spunta è attiva
   (`statusOf`).

Sui dati reali del 2026 risultano 23.600 € di contributi versati (2 × 6.800 €
calcolati dalle spunte, più una riga manuale da 10.000 €). L'utente dice di averne
versati circa 6.500 + 6.500.

L'utente ha scelto di rendere le scadenze **dati dichiarati e modificabili**,
abbastanza generici da descrivere anche gli altri casi noti, invece di aggiungere
interruttori al generatore attuale.

## Obiettivi

1. Le scadenze F24 di un anno si ricavano da uno **schema** salvato nei dati
   fiscali: per ogni tributo la base, il metodo degli acconti, le rate con data,
   codice ed etichetta, e il saldo.
2. Preset pronti per i casi che l'app già calcola: professionista in Gestione
   Separata, professionista con cassa privata, ditta individuale (artigiani o
   commercianti), società (solo IVA).
3. Lo schema dell'utente si esprime senza codice: "IRPEF: nessun acconto, saldo al
   30/06 dell'anno dopo".
4. **Le righe registrate sono l'unica verità sui versamenti.** Lo schema propone e
   non afferma niente. La deduzione dei contributi si legge solo dalle righe
   registrate; i saldi usano l'importo registrato di un acconto quando c'è, e la
   proposta solo dove non c'è ancora niente.
5. Editor dello schema in Impostazioni → Fiscale.
6. Tre correzioni fiscali che cambiano gli importi, descritte in "Correzioni
   fiscali": addizionali separate dall'IRPEF, acconto IVA di dicembre, IRAP e INPS
   eccedente della ditta a metodo storico con le date giuste.

## Non obiettivi

- Nuovi calcolatori d'imposta: forfettario, minimi, società. Il campo
  `studio.regime` resta non letto, come oggi. Il forfettario arriverà dopo come
  calcolatore nuovo più un preset, **senza cambiare la forma dello schema**: è il
  vincolo che questo design deve rispettare.
- Compensazione dei crediti fra tributi o fra anni.
- Schemi diversi per anni diversi. Lo schema è uno solo e si applica all'anno che
  si sta guardando; il passato è protetto dalle righe registrate (vedi Limiti).
- Altre regole fiscali oltre alle tre correzioni: soglie minime degli acconti
  IRPEF (51,65 € e unica soluzione sotto 257,52 €), ripartizione 50/50 degli
  acconti per i soggetti ISA, slittamento delle scadenze nel fine settimana. Lo
  schema le può esprimere (`share`, `acconti.soglia`) o le esprimerà; i preset non
  le applicano.

## Anti-obiettivi (cose che lo renderebbero un fallimento anche se funziona)

- Uno schema rotto che produce in silenzio zero scadenze. Uno schema non valido non
  si salva, e uno schema salvato che risulta invalido al caricamento ricade sul
  preset con un avviso visibile.
- Una modifica dello schema che riscrive o cancella righe registrate. Lo schema non
  scrive mai in `f24History`.
- Numeri che cambiano senza un motivo scritto. Senza schema salvato, calendario,
  deduzioni e saldi restano **identici a oggi**, salvo due eccezioni dichiarate: gli
  effetti dell'obiettivo 4 (elencati in "Migrazione") e le tre correzioni
  dell'obiettivo 6, ciascuna con il suo test.
- Un credito o un versamento che compare senza che l'utente l'abbia registrato.

## Vincoli

- Renderer senza build: `fiscal.js` è UMD (Node nei test, `window.*` nell'app), i
  `.jsx` sono trasformati da Babel nel browser. La logica nuova va in `fiscal.js`
  come funzioni pure; `computeTaxes` le chiama.
- I test girano con `node --test`. `tests/helpers/load-renderer.js` carica
  `fiscal.js` e `taxes.jsx` in una VM, quindi gli oggetti arrivano da un altro realm
  e vanno confrontati per campi primitivi, non con `deepStrictEqual`.
- I dati fiscali si salvano in `kv` alla chiave `fiscal` (JSON), quelli dello studio
  alla chiave `studio`. Lo schema va dentro `fiscal`.
- Questo lavoro poggia su modifiche **non ancora committate** del branch
  `feat/invoice-import`: `upsertF24Entry`/`removeF24Entry` in `fiscal.js` e il form
  delle voci F24 in `TaxF24`. Prima di implementare quelle modifiche vanno
  committate; il branch di lavoro si decide nel piano.
- Il database di produzione `~/Library/Application Support/parcella/timesheet.db`
  non va mai aperto in scrittura. La conversione dei dati dell'utente si fa solo su
  `timesheet-dev.db`.

## Approcci considerati

- **A. Schema dichiarato (scelto dall'utente).** Le scadenze diventano dati e il
  generatore diventa un interprete. È la via più generica. Il costo è disegnare
  adesso un piccolo linguaggio, contenuto limitandolo alle *scadenze* e lasciando le
  *formule d'imposta* nel codice.
- **B. Interruttori sul generatore attuale.** Bastava mezza giornata, ma lasciava i
  tre canali e trasformava ogni caso nuovo in un flag in più.
- **C. Storico come unica verità, generatore come proposta.** Risolve la
  contraddizione dei tre canali senza schema. L'utente ha preferito A; **il
  principio di C è incorporato in A** (obiettivo 4), perché senza di esso lo schema
  diventerebbe il quarto canale che afferma versamenti.

Sul perimetro, l'utente ha scelto "solo lo scadenzario": niente calcolo del
forfettario in questo giro.

## Il modello

### Due strati

- **Quanto si deve**: resta codice. `taxLiability(fy, fiscal, tipo, contributiVersati)`
  produce le **basi** dell'anno. Per l'anno precedente le basi si derivano dai
  documenti quando ce ne sono (regola `hasPrevData` attuale) e altrimenti dal valore
  di ripiego salvato nel tributo.
- **Quando e come si paga**: è lo schema, cioè dati.

### Basi disponibili

Nomi chiusi, che lo schema può citare:

| base | da | note |
|---|---|---|
| `irpef` | `taxLiability` | IRPEF netta **senza** addizionali: lorda − ritenute subite |
| `contribCassa` | `taxLiability` | professionista |
| `contribFisso` | `taxLiability` | ditta: minimale INPS |
| `contribVar` | `taxLiability` | ditta: variabile sull'eccedente |
| `irap` | `taxLiability` | ditta |
| `addReg` | `taxLiability` | addizionale regionale dell'anno |
| `addCom` | `taxLiability` | addizionale comunale dell'anno |
| `ivaPeriodo` | `trimestri` / `fy.periods` | solo per tributi di tipo `iva`, per periodo |

Per l'anno precedente ogni base si legge da `taxLiability` dell'anno prima, o dal
`fallbackPrevYear` del tributo. Per l'IVA la base dell'acconto è il versamento
dell'ultimo periodo dell'anno prima (vedi Correzioni fiscali).

Una base sconosciuta rende lo schema invalido.

### Forma dello schema

`fiscal.scadenzario` (assente = si usa il preset derivato da `studio`):

```js
{
  version: 1,
  preset: 'professionista-gs',   // solo provenienza, non condiziona il calcolo
  tributi: [
    {
      id: 'irpef',                 // unico nello schema, stabile
      label: 'IRPEF',
      kind: 'imposta',             // 'imposta' | 'contributo' | 'iva'
      base: 'irpef',
      acconti: {
        metodo: 'storico',         // 'nessuno' | 'storico'
        pct: 100,                  // % della base dell'anno precedente
        fallbackPrevYear: 28400,   // base dell'anno prima se non ci sono documenti
        soglia: 0,                 // acconti non dovuti se baseAcconti < soglia
      },
      righe: [
        { id: 'acc1', quota: 'acconto', share: 40, date: '06-30', yearOffset: 0, code: '4033', label: '1° acconto IRPEF {anno}' },
        { id: 'acc2', quota: 'acconto', share: 60, date: '11-30', yearOffset: 0, code: '4034', label: '2° acconto IRPEF {anno}' },
        { id: 'saldo', quota: 'saldo', date: '06-30', yearOffset: 1, code: '4001', label: 'Saldo IRPEF {anno}' },
      ],
    },
    {
      id: 'iva', label: 'IVA', kind: 'iva', base: 'ivaPeriodo',
      maggiorazionePct: 1,
      acconto: { metodo: 'storico', pct: 88, soglia: 103.29, fallbackPrevYear: 0,
                 date: '12-27', yearOffset: 0, code: '6035', label: 'Acconto IVA {anno}',
                 periodo: 'q4' },  // da scalare dal periodo indicato
      periodi: [
        { id: 'q1', months: ['01','02','03'], date: '05-16', yearOffset: 0, code: '6031', label: 'IVA 1° trim {anno}' },
        { id: 'q2', months: ['04','05','06'], date: '08-20', yearOffset: 0, code: '6032', label: 'IVA 2° trim {anno}' },
        { id: 'q3', months: ['07','08','09'], date: '11-16', yearOffset: 0, code: '6033', label: 'IVA 3° trim {anno}' },
        { id: 'q4', months: ['10','11','12'], date: '03-16', yearOffset: 1, code: '6099', label: 'IVA saldo annuale {anno}' },
      ],
    },
  ],
}
```

Regole delle righe (tributi `imposta` e `contributo`):

- `quota: 'acconto'`: importo = `share`% di `baseAcconti`, dove
  `baseAcconti = basePrev × acconti.pct / 100`. Ammessa solo se
  `acconti.metodo === 'storico'`.
- `quota: 'corrente'`: importo = `share`% della base **dell'anno stesso**. Serve per
  le rate fisse INPS della ditta e per l'IRAP così com'è oggi.
- `quota: 'saldo'`: al massimo una per tributo. Vedi "Saldo".
- `date` è `MM-GG`; `yearOffset` è 0 (anno fiscale) o 1 (anno dopo). La data
  completa è `${anno + yearOffset}-${date}`. Il 29 febbraio non è ammesso.
- `label` può contenere `{anno}`, sostituito con l'anno fiscale.
- `sezione` (facoltativo, a livello di tributo): la sezione del modello F24
  (`erario`, `inps`, `regioni`, `locali`, `altri-enti`). È solo informativa, serve
  a mostrare dove va compilata la riga; per INPS il "codice" è la causale
  contributo (PXX, AF, ...), non un codice tributo.
- Gli importi si arrotondano al centesimo **per riga**, come oggi (`round2`).
- Una riga con importo ≤ 0 non è una scadenza e non si elenca, come oggi.

Tributi `iva`: una riga per periodo. Importo = saldo di liquidazione del periodo ×
(1 + `maggiorazionePct`/100), solo se positivo, come oggi. Un periodo prende le voci
di `fy.periods` i cui mesi sono tutti contenuti nei suoi `months`. È la stessa
regola di `trimestri`, quindi una liquidazione mensile si somma correttamente nei
trimestri; uno schema mensile ha semplicemente dodici periodi.

### Validazione

`validateScheme(scheme) → { ok, errors: [{ path, message }] }`, funzione pura. È
invalido uno schema con:

- id di tributo duplicati, o id di riga/periodo duplicati dentro un tributo;
- `kind` o `base` sconosciuti, oppure base `ivaPeriodo` con un kind diverso da `iva`
  (e viceversa);
- date non `MM-GG` valide, `yearOffset` diverso da 0/1, `code` vuoto;
- `share` fuori da 0–100, o una riga `acconto` con `metodo: 'nessuno'`;
  (il `code` vuoto è ammesso solo nei tributi `contributo` con sezione
  `altri-enti`, vedi Preset);
- più di un `saldo` nello stesso tributo;
- mesi di periodo IVA non validi, oppure lo stesso mese in due periodi.
- un `acconto` IVA con `periodo` che non esiste fra i `periodi`, o con `pct` fuori
  da 0–100;
- una `soglia` o un `fallbackPrevYear` negativi.

Righe `acconto` la cui somma di `share` è diversa da 100 producono un
**avvertimento**, non un errore: è un caso legittimo (acconto ridotto) ma va
segnalato nell'editor.

### Collegare righe registrate e proposte: lo slot

Ogni proposta ha uno **slot** stabile: `"{tributo}/{riga}/{anno}"`, per esempio
`irpef/saldo/2026` o `iva/q4/2026`. L'anno è sempre l'**anno fiscale** di
competenza, non l'anno della data (il saldo 2026 scade nel 2027).

Le righe di `f24History` acquistano due campi facoltativi:

- `tributo`: id del tributo a cui appartiene la riga. Decide il `kind`, cioè cosa
  la riga alimenta.
- `slot`: la proposta che la riga soddisfa.
- `anno`: l'anno fiscale di competenza. Per una riga con slot coincide con l'anno
  dello slot; per una riga senza slot lo indica l'utente nel form (preimpostato
  all'anno della data). Senza `anno`, una riga di un saldo pagato a giugno
  verrebbe letta come un acconto dell'anno della data.

Il merge diventa:

- una proposta sparisce se esiste una riga registrata con lo stesso `slot` e stato
  `paid` o `scheduled` (oggi si confronta `date|code`);
- una riga registrata `estimated` non è un fatto: si mostra, non sopprime la
  proposta (regola attuale) e non entra in nessun calcolo;
- una riga registrata senza `slot` si mostra sempre, così com'è.

Spostare di data una riga registrata non la scollega dal suo slot. Oggi sì: è
quello che è successo nei dati dell'utente con la riga da 10.000 € spostata a
dicembre.

`markPaid` su una proposta crea la riga registrata copiando `tributo` e `slot`.
Il form manuale in `TaxF24` acquista due selettori: **Tributo** (preimpostato
dedotto dal codice) e **Scadenza**, che elenca gli slot dello schema per quel
tributo e quell'anno più la voce "fuori programma" (nessuno slot, con anno di
competenza da indicare). Così ogni riga nuova dice esplicitamente se è un saldo, un
acconto o un versamento extra, e non serve indovinarlo dalla data.

### Cosa conta nei calcoli

- **Contributi versati nell'anno Y** (deduzione IRPEF per cassa): somma delle righe
  registrate con stato `paid`, data nell'anno Y e tributo di kind `contributo`.
  Sostituisce `CONTRIB_CODES` e `flagged`, ed entrambi spariscono.
- Una riga registrata senza `tributo` (dato vecchio non migrato o non riconosciuto)
  non entra nella deduzione. Nell'editor delle voci viene segnalata come "tributo da
  indicare".

### Saldo

Per il tributo T e l'anno Y:

```
saldo = base(Y) − Σ acconti di T per Y
```

dove ogni riga `acconto` dello schema vale:

- l'importo della riga registrata con quello slot, se esiste con stato `paid` o
  `scheduled`;
- altrimenti l'importo proposto.

Contano anche le righe registrate `paid` o `scheduled` del tributo T **senza
slot** e con `anno` = Y: un acconto versato fuori programma riduce il saldo. Una
riga senza slot e senza `anno` non entra nel saldo. Questo copre la
"3ª rata" registrata a mano dall'utente.

Con `metodo: 'nessuno'` e nessun acconto registrato, il saldo è la base intera.
Un saldo negativo è un credito: non genera una riga e si espone come oggi, nel
campo `saldoX` restituito da `computeTaxes`.

Le righe `corrente` non sono acconti e non entrano nel saldo: un tributo con sole
righe `corrente` non ha saldo.

### Righe registrate che non corrispondono a nessuna proposta

Si elencano nel calendario come oggi, con il loro stato. Esempio nei dati
dell'utente: la riga `f6`, "2° acconto IRPEF 2026", 17.040 €, `estimated`, quando lo
schema IRPEF non ha più acconti. Non entra in nessun calcolo perché è `estimated`;
la si cancella con la ✕ esistente.

## Preset

`presetScheme(id) → scheme` e `presetIdFor(studio) → id`. La scelta automatica è
quella di oggi:

| `studio` | preset |
|---|---|
| professionista + `cassaName === 'Gestione Separata INPS'` | `professionista-gs` |
| professionista + altra cassa | `professionista-cassa` |
| `ditta_individuale` | `ditta` |
| `societa` | `solo-iva` |

Date, quote e importi riproducono il generatore attuale riga per riga, salvo le
righe delle Correzioni fiscali. I **codici sono quelli corretti** dell'Appendice A,
non quelli di oggi:

- **IVA** in tutti i preset: quattro trimestri con le date di oggi e maggiorazione
  1%; codici 6031, 6032, 6033 e, per il quarto, 6099 (saldo annuale al 16/03).
  Acconto di dicembre all'88% storico, 6035, soglia 103,29 €. Sezione Erario.
- **IRPEF** (professionista e ditta): base `irpef`, acconti `storico` al 100%, 40%
  al 30/06 (4033) e 60% al 30/11 (4034), saldo al 30/06 dell'anno dopo (4001).
  Sezione Erario.
- **Addizionale regionale** e **comunale** (professionista e ditta): come in
  Correzioni fiscali, 1.
- **Contributi Gestione Separata** (`professionista-gs`): acconti `storico`, `pct`
  80 oppure `fiscal.cassaAccontoPct` se presente; due righe al 50% il 30/06 e il
  30/11; saldo al 30/06 dell'anno dopo. Causale **PXX** per tutte e tre le righe
  (iscritto solo alla GS; chi ha un'altra copertura obbligatoria la cambia in
  **P10**). Sezione INPS.
- **Contributi cassa privata** (`professionista-cassa`): come sopra con `pct` 100.
  **Codice vuoto**: ogni cassa ha i suoi codici (sezione Altri enti previdenziali, o
  avviso pagoPA). L'editor lo segnala come da compilare, ma lo schema resta valido
  se l'utente lo lascia vuoto; in quel caso la riga mostra "codice da indicare".
  È l'unica eccezione alla regola "code vuoto = invalido".
- **INPS fisso** (ditta): tributo `contributo`, base `contribFisso`, quattro righe
  `corrente` al 25% (16/05, 20/08, 16/11, 16/02 dell'anno dopo), causale **AF**
  (artigiani) o **CF** (commercianti). Sezione INPS.
- **INPS eccedente** (ditta): tributo `contributo` separato, base `contribVar`,
  acconti storici 50/50 al 30/06 e 30/11 e saldo al 30/06 dell'anno dopo, causale
  **AP** o **CP** (Correzioni fiscali, 3). Sezione INPS.
- **IRAP** (ditta): tributo `imposta`, base `irap`, acconti storici 40% al 30/06
  (**3812**) e 60% al 30/11 (**3813**), saldo al 30/06 dell'anno dopo (**3800**).
  Sezione Regioni.

Artigiano o commerciante: oggi `studio` non lo distingue. Il preset `ditta` usa AF/AP
e l'editor permette di cambiarle; aggiungere il campo in Impostazioni è lasciato al
builder.

Le etichette dei preset riprendono i testi attuali. Il dettaglio "(40% su 2025
effettivo)" si genera aggiungendo il suffisso `basedOn` alle righe `acconto`, che
quindi non sta nello schema.

### Fedeltà dei preset

Preset e generatore attuale devono produrre le stesse scadenze (stessa **data e
importo**) per gli stessi dati, **tranne** le righe toccate dalle Correzioni
fiscali: IRPEF e addizionali, IVA del quarto trimestre e acconto di dicembre, IRAP,
INPS eccedente. Il test di equivalenza copre tutte le altre righe ed è il criterio
di accettazione; le righe corrette hanno test propri con importi calcolati a mano. I
codici cambiano di proposito (Appendice A), e il test li controlla contro la tabella
dell'appendice, non contro il generatore di oggi.

Il conflitto fra INPS fisso ed eccedente della ditta (una riga registrata li
sopprimeva entrambi) è risolto dagli slot, e ora hanno anche causali diverse.

## Correzioni fiscali

### 1. Addizionali separate dall'IRPEF

Oggi `irpefNetta = max(0, irpefLorda + addReg + addCom − ritenute)` e si paga tutta
col 4001; gli acconti IRPEF ne prendono il 100%.

Diventa:

- `irpef = max(0, irpefLorda − ritenute)`. Le ritenute subite si scomputano solo
  dall'IRPEF; l'eccedenza resta `ritenutaCredito`, come oggi, e non riduce le
  addizionali (compensarla in F24 è un non obiettivo).
- `irpefNetta = irpef + addReg + addCom`, per i totali e i pannelli. Differisce dal
  valore di oggi solo quando le ritenute superano l'IRPEF lorda.
- Tre tributi nei preset ordinari:
  - **IRPEF**, base `irpef`: acconti storici 40/60 (4033/4034) **sulla sola IRPEF
    dell'anno prima**, saldo 4001;
  - **Addizionale regionale**, base `addReg`: nessun acconto, saldo 3801 al 30/06
    dell'anno dopo, sezione Regioni;
  - **Addizionale comunale**, base `addCom`: acconto storico al **30%** in una riga
    al 30/06 (3843), saldo 3844 al 30/06 dell'anno dopo, sezione Locali.
- `fallbackPrevYear`: per l'IRPEF la migrazione copia `irpefPrevYear` come oggi,
  perché il campo non ha mai distinto le addizionali. L'editor avverte che va
  inteso **senza** addizionali. Per le addizionali il ripiego è 0.

### 2. Acconto IVA di dicembre

Nuovo campo `acconto` del tributo `iva`:

- importo = `pct`% (88, metodo storico) della base dell'anno prima, cioè il saldo
  di liquidazione del periodo `periodo` (`q4`, o `m12` per uno schema mensile)
  dell'anno prima, **prima** della maggiorazione e **al lordo** dell'acconto versato
  quell'anno (la regola dell'88% guarda a quanto era dovuto per il periodo, non a
  quanto è rimasto da versare). È proprio il saldo di `fy.periods`, che degli acconti
  non sa niente. Senza documenti dell'anno prima vale `fallbackPrevYear`;
- non dovuto se l'importo è sotto `soglia` (103,29 €);
- scade il 27/12; codice 6035 per i trimestrali, 6013 per i mensili;
- slot `iva/acconto/{anno}`, con le stesse regole delle altre righe: se ce n'è una
  registrata `paid` o `scheduled`, vale il suo importo;
- il periodo indicato si riduce dell'acconto: importo = max(0, liquidazione −
  acconto) × (1 + maggiorazione). Se l'acconto supera la liquidazione, la
  differenza è un credito e non genera righe.

Da verificare sul testo ufficiale prima di chiudere il punto: se la maggiorazione
dell'1% dei trimestrali si applica al netto o al lordo dell'acconto. Il design
assume al netto.

### 3. IRAP e INPS eccedente della ditta

- **IRAP**: acconti storici al 100% della base `irap` dell'anno prima, 40% al 30/06
  (3812) e 60% al 30/11 (3813), saldo 3800 al 30/06 dell'anno dopo. Oggi le due
  rate erano il 40/60 dell'IRAP **di quest'anno** e il saldo mancava.
- **INPS eccedente**: acconti storici al 100% della base `contribVar` dell'anno
  prima, due rate al 50% il 30/06 e il 30/11, saldo al 30/06 dell'anno dopo, causale
  AP (o CP). Oggi erano due metà del variabile di quest'anno, al 16/11 e al 16/02.
- Il ripiego per entrambi è 0 e si imposta nell'editor: il primo anno senza
  documenti dell'anno prima non genera acconti, e il saldo li comprende tutti.
- L'**INPS fisso** non cambia: quattro rate del minimale dell'anno, AF/CF.

## Migrazione

`migrateFiscal({ fiscal, studio, invoices, activities, expenses, clients, now }) → { fiscal, log }`,
pura e idempotente. Gli importi delle spunte dipendono dai documenti, quindi la
migrazione gira **nel renderer**, una volta caricati tutti i dati e prima del primo
calcolo. Salva solo se è cambiato qualcosa. Gli importi li calcola
`scheduleFromScheme` con il preset in uso. Le spunte esistono solo per acconti
cassa, acconti IRPEF e trimestri IVA. Per cassa e trimestri 1–3 il test di
equivalenza garantisce che l'importo coincida con quello di oggi. Per gli acconti
IRPEF e il quarto trimestre l'importo è già quello corretto; la differenza
rispetto a oggi va nel `log`.

1. **Nessuno schema salvato.** Non se ne crea uno: si continua a usare il preset
   derivato da `studio` al momento del calcolo, così cambiare cassa in Impostazioni
   continua a cambiare le scadenze come oggi. Lo schema si salva solo quando
   l'utente lo modifica dall'editor o sceglie un preset.
2. **Valori di ripiego.** `irpefPrevYear` e `cassaPrevYear` restano dove sono e il
   preset li legge come `fallbackPrevYear`. Quando lo schema viene salvato, i valori
   si copiano nel tributo. Da quel momento vale il tributo e i campi vecchi non si
   leggono più.
3. **Righe storiche senza `tributo`.** Si deduce dal codice. I codici errati di
   oggi si interpretano come li usava l'app: 3801 o 0601 →
   contributo (il tributo contributivo del preset; per la ditta, quello fisso),
   4001/4033/4034 → IRPEF, 6031–6035, 6099 e 6001–6013 → IVA,
   3800/3812/3813 → IRAP, PXX/P10/AF/AP/CF/CP (e varianti R) → contributo; il codice
   della riga non viene riscritto. Un codice che non
   si riconosce lascia la riga senza tributo.
4. **Righe storiche senza `slot`.** Si cercano le proposte del preset corrente,
   per l'anno fiscale della data e per quello precedente, con stessa data e stesso
   codice. Con una sola corrispondenza si assegnano slot e `anno`. Quando ce n'è
   più d'una (il 30/06 con 3801 è sia il saldo dell'anno prima sia il 1° acconto, il
   16/11 con 0601 è sia fisso sia variabile per la ditta), decide la descrizione:
   se contiene "saldo" è il saldo dell'anno precedente, altrimenti la prima riga
   non-saldo dell'anno della data. Nessuna corrispondenza: niente slot, e `anno` =
   anno della data. Ogni assegnazione per descrizione finisce nel `log`.
5. **Spunte "Versato".** Ogni spunta attiva diventa una riga registrata `paid` con
   l'importo che il generatore le attribuisce oggi, il suo slot e il suo tributo,
   **solo se** lo schema in uso ha la riga corrispondente e non esiste già una riga
   registrata per quello slot. Poi le spunte si rimuovono da `fiscal`. Così una
   spunta non perde mai il suo effetto e non lo raddoppia. L'importo di
   `ivaQ1Amount`, se presente, sostituisce quello calcolato. Le spunte IVA
   (`ivaQnPaid`) seguono la stessa regola. Le spunte non hanno anno: oggi valgono
   per qualunque anno si guardi. Si attribuiscono a `fiscal.year` se presente,
   altrimenti all'anno di `now`. È un'approssimazione voluta: le spunte servono
   per l'anno in corso, e replicarle su ogni anno creerebbe versamenti mai
   avvenuti.

**Effetti visibili per chi non tocca niente.** Per l'anno a cui vengono attribuite
le spunte, deduzione e saldi non cambiano, perché le spunte diventano righe con lo
stesso importo. Cambiano tre cose, tutte nella direzione dei fatti:

- negli altri anni le spunte smettono di valere (oggi valevano ovunque);
- un trimestre IVA spuntato ma mai registrato passa da "stimato" a "versato" in
  calendario (oggi lo diceva solo il badge del pannello IVA);
- le righe senza tributo riconosciuto smettono di dedurre. Con i codici attuali
  (3801/0601) non succede a nessuno.

## Interfaccia

### Impostazioni → Fiscale → "Scadenzario F24"

Una card nuova sotto quelle esistenti.

```
Scadenzario F24                          Preset: [Professionista · Gestione Separata ▾]  [Ripristina]
───────────────────────────────────────────────────────────────────────────────────────────────
▸ IRPEF            imposta     base IRPEF (no addiz.) acconti: nessuno          saldo 30/06 anno+1
▸ Addiz. regionale imposta     base add. regionale    acconti: nessuno          saldo 30/06 anno+1
▸ Addiz. comunale  imposta     base add. comunale     acconti: storico 30%      saldo 30/06 anno+1
▾ Contributi INPS  contributo  base contributo cassa  acconti: storico 80%      ripiego 17.000 €
     data    anno      codice  etichetta                    quota
     30/06   stesso    PXX     1° acconto INPS {anno}       acconto 50%      ✕
     30/11   stesso    PXX     2° acconto INPS {anno}       acconto 50%      ✕
     30/06   dopo      PXX     Saldo INPS {anno}            saldo            ✕
     [+ riga]
▸ IVA              iva         trimestrale +1%        4 periodi
[+ tributo]
                                                           ⚠ gli acconti IRPEF sommano 0%   [Salva]
```

- Il preset in alto mostra il preset in uso. Sceglierne un altro chiede conferma e
  sostituisce lo schema; **Ripristina** torna a quello derivato da `studio` e
  cancella `fiscal.scadenzario`.
- Ogni tributo si apre e mostra le sue righe; i campi sono quelli del modello.
  Kind e base sono menu a tendina con le voci chiuse della tabella delle basi.
- Errori di validazione accanto al campo; il pulsante Salva resta disabilitato
  finché ce n'è uno. Gli avvertimenti non bloccano.
- Cambiare l'id di un tributo o di una riga non è permesso dall'interfaccia (lo slot
  delle righe registrate ne dipende). Si cancella e si ricrea.
- Cancellare un tributo che ha righe registrate collegate chiede conferma e avvisa
  che quelle righe resteranno come voci senza tributo e smetteranno di dedurre.

### Tasse

- I pannelli **IRPEF** e **Cassa** non hanno più due righe fisse 40/60 o due metà:
  mostrano le righe dello schema dei tributi con base `irpef`, `addReg`, `addCom`
  (IRPEF) e `contribCassa` (Cassa); il pannello IRAP quelle con base `irap`, quante sono e con le loro etichette. Con `metodo: 'nessuno'`
  mostrano solo il saldo e una riga "nessun acconto previsto". Se più tributi
  hanno la stessa base, li mostrano tutti, uno sotto l'altro; se nessuno ce l'ha,
  il riquadro acconti non compare.
- Lo stato di ogni riga (versato, da pagare) si legge dalla riga corrispondente di
  `f24All`, per slot; il badge IVA lo stesso. Non si scrivono più flag in `fiscal`.
- Il pulsante "Versato" chiama lo stesso `markPaid` del calendario. Un secondo clic
  chiede conferma e cancella la riga registrata con quello slot, come la ✕ del
  calendario: è la stessa operazione, con lo stesso effetto. Una riga con importo
  ≤ 0 non è una scadenza, e quindi non ha pulsante.
- `accontiIrpef`/`saldoIrpef` e `accontiCassa`/`saldoCassa` restituiti da
  `computeTaxes` sono la somma sui tributi con quella base; senza tributi valgono
  0. Per la ditta quindi `saldoCassa` vale 0: oggi era calcolato ma non mostrato.
- Il form delle voci in `TaxF24` acquista i selettori Tributo e Scadenza.

### Impostazioni: i campi vecchi

`irpefPrevYear`, `cassaPrevYear` e `cassaAccontoPct` restano modificabili finché
non c'è uno schema salvato, perché è il preset a leggerli. Con uno schema salvato
quei campi si nascondono e al loro posto compare una riga "Si impostano nello
Scadenzario F24", con il collegamento alla card. Un campo che non fa niente non
deve restare visibile.
- Una riga di `f24All` espone `tributo`, `slot` e `kind`, oltre ai campi attuali.

## Funzioni da scrivere (in `fiscal.js`, esportate come le altre)

- `presetIdFor(studio)`, `presetScheme(id, fiscal)`
- `schemeSlots(scheme, tributoId, year)`: per il selettore Scadenza
- `validateScheme(scheme)`
- `activeScheme(fiscal, studio)`: schema salvato se valido, altrimenti preset
  (più l'avviso se quello salvato era invalido)
- `scheduleFromScheme({ scheme, year, bases, prevBases, ivaPeriods, recorded, basedOn })`
  → proposte con `id` (`_` + slot), `slot`, `tributo`, `kind`, `date`, `code`,
  `desc`, `amount`, `_generated: true`, più i saldi per tributo
- `inferTributo(code, scheme)`, `migrateFiscal(fiscal, studio)`

`computeTaxes` sostituisce il blocco "Scadenze F24 dinamiche", `CONTRIB_CODES`,
`flagged`, `statusOf` e il calcolo `saldoCassa`/`saldoIrpef` con queste chiamate.
I campi restituiti oggi restano tutti, con lo stesso significato
(`accontiCassa`, `accontiIrpef`, `saldoCassa`, `saldoIrpef` letti dai tributi del
preset con base `contribCassa`/`irpef`), così i pannelli non cambiano. `irpefNetta`
resta il totale IRPEF + addizionali al netto delle ritenute (vedi Correzioni
fiscali); si aggiungono `irpefSola`, `addRegDovuta`, `addComDovuta`.

## Test

Nuovo `tests/test-f24-scheme.js`, più l'adeguamento degli esistenti.

- **Equivalenza:** per ogni preset, con i dati dei test attuali, le proposte
  non toccate dalle Correzioni fiscali coincidono con l'output del generatore
  attuale (data, importo). Il generatore attuale si fotografa **prima** di
  rimuoverlo, come fixture.
- **Codici:** ogni riga di ogni preset ha il codice dell'Appendice A.
- **Correzioni**, con importi calcolati a mano:
  - le ritenute riducono solo l'IRPEF; addizionali separate; acconti IRPEF senza
    addizionali; acconto comunale al 30%; nessun acconto regionale;
  - acconto IVA all'88% dell'ultimo periodo dell'anno prima, sotto 103,29 € non
    dovuto, scalato dal quarto trimestre, acconto registrato a importo diverso;
  - IRAP e INPS eccedente: acconti sull'anno prima, saldo, primo anno senza base.
- Schema dell'utente: IRPEF `nessuno` → nessuna riga acconto IRPEF, saldo = base
  intera, nessun credito.
- Saldo con un acconto registrato a un importo diverso dal proposto: usa quello
  registrato.
- Una riga spostata di data resta collegata al suo slot e sopprime la proposta.
- Acconto registrato fuori schema riduce il saldo.
- Una riga `estimated` non deduce, non sopprime, non riduce il saldo.
- Una riga senza tributo non deduce.
- Validazione: un test per ogni regola.
- Migrazione: idempotente; spunta → riga con lo stesso importo; spunta senza riga di
  schema corrispondente scartata; nessun doppio conteggio quando la riga esiste già.
- I test che oggi esercitano le spunte (`test-acconti.js`: "an instalment the user
  marked versato…", "senza ricavi l'anno prima, spuntare Versato…";
  `test-irpef-base.js`: "il flag Versato conta la rata…") si riscrivono passando per
  la migrazione o per una riga registrata con slot. Il comportamento atteso resta
  lo stesso.

## Conversione dei dati dell'utente

È un passo separato dall'implementazione, solo su `timesheet-dev.db`, con un backup
prima e gli importi confermati dall'utente:

- schema salvato `professionista-gs` con IRPEF `acconti.metodo: 'nessuno'`; per
  l'addizionale comunale e per l'acconto IVA di dicembre si applica quello che
  l'utente fa davvero, da chiedergli. Il 2025 non ha fatture attive, quindi la base
  dell'acconto IVA 2026 viene dal ripiego: va impostato con il versamento reale del
  quarto trimestre 2025 (registrato: 3.120 €), altrimenti l'acconto non compare;
- le due spunte contributive diventano righe con gli **importi veri** al posto dei
  6.800 € calcolati;
- `irpefAcconto1Paid: true` è un residuo dei dati di esempio: si scarta, e lo
  schema senza acconti IRPEF lo scarterebbe comunque;
- `f6` (17.040 €, `estimated`) si cancella;
- la riga "3 Acconto INPS" da 10.000 € al 30/12/2026 `paid` si verifica con
  l'utente, perché è datata nel futuro;
- le righe contributive registrate con 3801 si ricodificano in PXX, e quelle IVA
  registrate con 6031 per il 2° e il 4° trimestre in 6032 e 6099.

## Limiti accettati

- Uno schema solo per tutti gli anni: cambiarlo cambia le proposte anche degli anni
  passati. Le righe registrate non cambiano.
- Le scadenze non slittano al primo giorno lavorativo quando cadono nel fine
  settimana. Lo schema non lo esprime; si può aggiungere come regola globale in un
  giro successivo.
- Le basi sono un elenco chiuso: un tributo nuovo con una base che il codice non
  calcola richiede codice. È il punto in cui entrerà il forfettario.

## Punti aperti

- **Maggiorazione 1% e acconto IVA**: al netto o al lordo (Correzioni fiscali, 2).
  Si verifica sulle istruzioni ufficiali; il design assume al netto.

## Appendice A: codici di riferimento

Ricerca del 2026-11-08 su fonti secondarie concordi, da confermare sui testi
ufficiali (risoluzioni dell'Agenzia delle Entrate, circolari INPS) prima di
considerarli definitivi. Le date sono quelle ordinarie: quando cadono di sabato o
domenica slittano al primo giorno lavorativo, cosa che oggi l'app non fa (vedi
Limiti).

| Tributo | Codice / causale | Sezione F24 | Scadenza | Regime |
|---|---|---|---|---|
| IRPEF saldo | 4001 | Erario | 30/06 anno dopo | ordinario |
| IRPEF 1° acconto | 4033 | Erario | 30/06 | ordinario |
| IRPEF 2° acconto o unica soluzione | 4034 | Erario | 30/11 | ordinario |
| Addizionale regionale IRPEF, saldo | 3801 | Regioni | 30/06 anno dopo | ordinario (non ha acconto) |
| Addizionale comunale IRPEF, acconto | 3843 | IMU e altri tributi locali | 30/06 | ordinario |
| Addizionale comunale IRPEF, saldo | 3844 | IMU e altri tributi locali | 30/06 anno dopo | ordinario |
| Imposta sostitutiva 1° acconto | 1790 | Erario | 30/06 | forfettario |
| Imposta sostitutiva 2° acconto o unica soluzione | 1791 | Erario | 30/11 | forfettario |
| Imposta sostitutiva saldo | 1792 | Erario | 30/06 anno dopo | forfettario |
| IVA 1°, 2°, 3° trimestre (+1%) | 6031, 6032, 6033 | Erario | 16/05, 20/08, 16/11 | ordinario, trimestrale |
| IVA saldo annuale (comprende il 4° trim.) | 6099 | Erario | 16/03 anno dopo | ordinario |
| IVA 4° trimestre, trimestrali speciali | 6034 | Erario | 16/02 anno dopo | solo categorie speciali |
| IVA mensile gennaio … dicembre | 6001 … 6012 | Erario | 16 del mese dopo | ordinario, mensile |
| Acconto IVA | 6035 (trimestrali), 6013 (mensili) | Erario | 27/12 | ordinario |
| IRAP saldo | 3800 | Regioni | 30/06 anno dopo | ordinario, se soggetto |
| IRAP 1° acconto | 3812 | Regioni | 30/06 | ordinario, se soggetto |
| IRAP 2° acconto o unica soluzione | 3813 | Regioni | 30/11 | ordinario, se soggetto |
| Gestione Separata, solo GS | PXX (rateizzato: PXXR) | INPS | 30/06 saldo e 1° acc., 30/11 2° acc. | ordinario e forfettario |
| Gestione Separata, con altra copertura | P10 | INPS | come sopra | ordinario e forfettario |
| INPS artigiani, minimale | AF | INPS | 16/05, 20/08, 16/11, 16/02 | ditta |
| INPS artigiani, eccedente | AP (rateizzato: APR) | INPS | con saldo e acconti IRPEF | ditta |
| INPS commercianti, minimale | CF | INPS | come AF | ditta |
| INPS commercianti, eccedente | CP (rateizzato: CPR) | INPS | come AP | ditta |
| Casse private (Inarcassa, Forense, …) | propri della cassa | Altri enti previdenziali, o pagoPA | proprie della cassa | professionista |

Note:

- Il codice **0601** usato oggi dall'app per l'INPS della ditta non compare in
  nessuna fonte: va sostituito da AF/CF e AP/CP.
- Il **3801** usato oggi per i contributi del professionista è l'addizionale
  regionale. Le righe registrate dall'utente con 3801 come contributi vanno
  ricodificate in PXX (Conversione dei dati dell'utente).
- L'**INPS eccedente** della ditta segue le scadenze di saldo e acconti IRPEF
  (30/06, 30/11), non quelle del minimale: corretto nel preset (Correzioni
  fiscali, 3).
- Sulla data dell'acconto IVA le fonti oscillano fra 27, 28 e 29 dicembre per via
  dei fine settimana. Il termine ordinario è il 27/12.

## Lasciato al builder

- Il punto preciso del renderer da cui chiamare `migrateFiscal`, purché giri una
  volta con tutti i dati caricati, prima del primo calcolo, e salvi solo se cambia
  qualcosa.
- Stile e componenti dell'editor, nel linguaggio visivo di `settings.jsx`.
- Testi e traduzioni (`i18n.js`).
