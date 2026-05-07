<h1 align="center">
  <br>
  <img src="build/icon.png" alt="Parcella" width="100">
  <br>
  Parcella
  <br>
</h1>

<p align="center">
  <strong>Timesheet, fatturazione e gestione fiscale per professionisti italiani</strong><br>
  Offline-first · Nessun abbonamento · Tutti i dati restano sul tuo computer
</p>

<p align="center">
  <img alt="Piattaforma" src="https://img.shields.io/badge/piattaforma-macOS%20%7C%20Windows%20%7C%20Linux-blue">
  <img alt="Versione" src="https://img.shields.io/badge/versione-1.1.0-informational">
  <img alt="Electron" src="https://img.shields.io/badge/electron-35-47848F?logo=electron&logoColor=white">
  <img alt="Licenza" src="https://img.shields.io/badge/licenza-MIT-green">
  <img alt="SQLite" src="https://img.shields.io/badge/storage-SQLite-blue?logo=sqlite&logoColor=white">
</p>

<p align="center">
  <a href="README.md">🇬🇧 English</a>
</p>

---

Parcella è un'app desktop nativa costruita con Electron che mantiene **tutti i tuoi dati in locale**. Registra le ore lavorate, gestisci i clienti, monitora le spese, stima le tasse e genera rapporti di attività — senza affidare i tuoi dati finanziari a nessun servizio cloud.

> Pensata per il regime fiscale italiano: supporta *libero professionista*, *ditta individuale*, IVA, *cassa previdenziale*, *ritenuta d'acconto* e *regime forfettario*.

---

## Screenshot

### Dashboard
![Dashboard](docs/screenshots/dashboard.png)

KPI mensili in un colpo d'occhio: ore registrate, imponibile maturato, da fatturare e clienti attivi. Tabella ripartizione per cliente con sparkline delle ore giornaliere e monitoraggio del plafond contrattuale.

---

### Timesheet
![Timesheet](docs/screenshots/timesheet.png)

Griglia mensile con una riga per ogni cliente × commessa. Registra le ore cliccando sulle celle dei singoli giorni. Filtra per cliente ed esporta il registro completo in CSV.

---

### Clienti
![Clienti](docs/screenshots/clients.png)

Anagrafica clienti con tariffa oraria, commesse attive, gestione contatti, plafond ore contrattuale e riepilogo del mese corrente — tutto in un'unica lista.

---

### Spese
![Spese](docs/screenshots/expenses.png)

Registra spese rimborsabili e di studio. La detrazione IVA e la deducibilità vengono calcolate automaticamente per categoria. Filtra per cliente o per tipo di spesa.

---

### Tasse & contributi
![Tasse](docs/screenshots/taxes.png)

Cascata fiscale annuale: IRPEF, saldo IVA trimestrale, *cassa previdenziale* o INPS (fisso + variabile), prossime scadenze F24 e stima del netto disponibile.

---

### Documenti
![Documenti](docs/screenshots/export.png)

Genera rapporti di attività formattati per cliente con anteprima in tempo reale. Esporta in PDF, Excel o Word. Invia via email direttamente dall'app.

---

### Impostazioni
![Impostazioni](docs/screenshots/settings.png)

Profilo studio, dati fiscali, logo, template documenti, preferenze e backup cifrato — tutto in un unico pannello.

---

## Funzionalità

| Area | Dettagli |
|---|---|
| **Timesheet** | Griglia mensile, righe per cliente / commessa, esportazione CSV |
| **Clienti** | Tariffa oraria, commesse, contatti, monitoraggio plafond |
| **Spese** | Rimborsabili vs. deducibili, detrazione IVA, deducibilità per categoria |
| **Tasse** | IRPEF, IVA, cassa 4%, INPS, IRAP — aggiornato ogni anno |
| **Documenti** | PDF, Excel, Word con anteprima live, invio email |
| **Backup** | Export cifrato AES-256-GCM; sync cloud: iCloud, Dropbox, Google Drive, OneDrive |
| **Offline** | Tutti i dati in SQLite locale — nessun account, nessuna connessione internet |
| **i18n** | Interfaccia in italiano e inglese |

---

## Stack tecnologico

| Livello | Tecnologia |
|---|---|
| Shell | [Electron](https://electronjs.org) v35 |
| UI | [React](https://react.dev) via Babel (senza bundler) |
| Database | [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite sincrono |
| Portachiavi | [keytar](https://github.com/atom/node-keytar) — portachiavi di sistema per la passphrase di backup |

---

## Per iniziare

### Prerequisiti

- Node.js ≥ 18
- macOS, Windows o Linux

### Avvio in sviluppo

```bash
npm install
npm start
```

### Build del distributabile

```bash
# macOS (DMG + ZIP, x64 e arm64)
npm run dist:mac

# Windows (installer NSIS + portable)
npm run dist:win

# Linux (AppImage + .deb)
npm run dist:linux

# Tutte le piattaforme
npm run dist:all
```

I file vengono generati nella cartella `dist/`.

---

## Struttura del progetto

```
src/
  main/
    main.js        # Processo principale Electron (IPC, DB, backup, crypto)
    preload.js     # contextBridge — espone window.api e window.APP_VERSION
    db.js          # SQLite via better-sqlite3
    db-json.js     # Fallback JSON quando SQLite non è disponibile
  renderer/
    index.html     # Shell HTML, carica vendor + componenti
    app.jsx        # Componente React root, stato, routing
    i18n.js        # Traduzioni (it/en)
    storage.js     # Helper di persistenza su LocalStorage
    data.js        # Strutture dati predefinite
    styles.css     # Stili globali
    components/
      shared.jsx        # Layout (Sidebar, Topbar, Modal, Toast) + utilità condivise
      dashboard.jsx     # Vista Dashboard
      timesheet.jsx     # Griglia mensile timesheet
      clients.jsx       # Lista e dettaglio clienti
      expenses.jsx      # Gestione spese
      taxes.jsx         # Stimatore tasse e contributi
      export.jsx        # Generazione documenti
      settings.jsx      # Impostazioni e backup
      icons.jsx         # Set di icone SVG
vendor/             # React e Babel in locale (nessuna dipendenza da CDN)
```

---

## Dati e privacy

Tutti i dati sono salvati in un database SQLite nella cartella dati utente del sistema operativo. Nessuna telemetria. Nessuna chiamata di rete. Nessun account richiesto.

| Piattaforma | Percorso |
|---|---|
| macOS | `~/Library/Application Support/Parcella/timesheet.db` |
| Windows | `%APPDATA%\Parcella\timesheet.db` |
| Linux | `~/.config/Parcella/timesheet.db` |

### Backup

Vai su **Impostazioni → Dati & Backup** per:

- Esportare un backup cifrato `.parcella` (AES-256-GCM, passphrase salvata nel portachiavi di sistema)
- Sincronizzare direttamente su iCloud Drive, Dropbox, Google Drive o OneDrive (se la cartella del client è presente sul disco)
- Importare e ripristinare da qualsiasi backup precedente

---

## Licenza

[MIT](LICENSE)
