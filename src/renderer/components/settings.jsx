// ── Dati & Backup tab ────────────────────────────────────────────────────────
const DataBackupTab = ({ onResetData }) => {
  const [info, setInfo] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [showPwForm, setShowPwForm] = useState(false);
  const hasAPI = !!window.api?.db;

  const currentYear = new Date().getFullYear();
  const [docCounter, setDocCounter] = useState(null);

  useEffect(() => {
    if (!hasAPI) return;
    window.api.db.getInfo().then(setInfo);
    window.api.backup.checkCloud().then(setCloud);
    window.api.crypto?.getPassphrase().then(setHasPassphrase);
  }, []);

  useEffect(() => {
    if (!hasAPI) return;
    window.api.db.getDocCounter(currentYear).then(setDocCounter);
  }, []);

  const fmt = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + " MB" : (b / 1024).toFixed(0) + " KB";
  const showStatus = (msg, isError) => window.showToast && window.showToast(msg, isError ? 'error' : msg.startsWith('✓') ? 'success' : 'info');

  const doExport = async () => {
    const ts = new Date().toISOString().slice(0,10);
    const p = await window.api.backup.chooseExportPath(`timesheet-backup-${ts}.json`);
    if (!p) return;
    await window.api.backup.exportTo(p);
    showStatus("✓ Backup esportato in " + p);
  };

  const doImport = async () => {
    if (!confirm("Importare? Tutti i dati attuali saranno sovrascritti.")) return;
    const p = await window.api.backup.chooseImportPath();
    if (!p) return;
    try {
      if (p.endsWith('.tsenc')) {
        await window.api.backup.importEncrypted(p);
      } else {
        await window.api.backup.importFrom(p);
      }
      showStatus("✓ Dati importati — riavvia l'app per applicare.");
    } catch (e) { showStatus("✗ " + e.message); }
  };

  const doCloudBackup = async (type) => {
    try {
      const r = await window.api.backup.backupToCloud({ type, encrypt: hasPassphrase });
      showStatus(`✓ Backup ${hasPassphrase ? "cifrato" : "JSON"} salvato in ${r.dest}`);
    } catch (e) { showStatus("✗ " + e.message); }
  };

  const savePassphrase = async () => {
    if (!newPw.trim()) return;
    await window.api.crypto.setPassphrase(newPw);
    setHasPassphrase(true);
    setNewPw(""); setShowPwForm(false);
    showStatus("✓ Passphrase salvata nel portachiavi di sistema.");
  };

  const cloudServices = [
    { type: "icloud",      label: "iCloud Drive",   icon: "☁️",  desc: "Installa iCloud Drive per macOS." },
    { type: "dropbox",     label: "Dropbox",         icon: "📦",  desc: "Installa Dropbox Desktop." },
    { type: "googledrive", label: "Google Drive",    icon: "🔵",  desc: "Installa Google Drive per Desktop." },
    { type: "onedrive",    label: "OneDrive",        icon: "🟦",  desc: "Installa OneDrive per Desktop." },
  ];

  const CloudCard = ({ type, label, iconChar, desc }) => {
    const avail = cloud?.[type]?.available;
    return (
      <div className="card" style={{ padding: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 26 }}>{iconChar}</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
            <div style={{ fontSize: 12, color: avail ? "var(--success)" : "var(--text-muted)" }}>
              {avail ? "● Disponibile" : "● Non rilevato"}
            </div>
          </div>
        </div>
        {avail ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="btn btn-sm" onClick={() => doCloudBackup(type)}>
              <Icon name="download" size={12} /> {hasPassphrase ? "Backup cifrato (.tsenc)" : "Backup JSON"}
            </button>
            <button className="btn btn-sm btn-ghost" onClick={() => window.api.backup.openFolder(cloud[type].path)}>
              <Icon name="folder" size={12} /> Apri cartella
            </button>
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>{desc}</div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>

      {hasAPI && info && (
        <div className="card">
          <div className="card-header"><h3>Database SQLite</h3></div>
          <div className="card-body">
            <div className="info-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)", marginBottom: 16 }}>
              <div className="info-cell"><div className="label">Tipo storage</div><div className="value mono">{info.dbType?.toUpperCase()}</div></div>
              <div className="info-cell"><div className="label">Dimensione</div><div className="value mono">{fmt(info.stats.sizeBytes)}</div></div>
              <div className="info-cell"><div className="label">Clienti</div><div className="value">{info.stats.clients}</div></div>
              <div className="info-cell"><div className="label">Attività</div><div className="value">{info.stats.activities}</div></div>
              <div className="info-cell"><div className="label">Fatture</div><div className="value">{info.stats.invoices}</div></div>
            </div>
            <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>
              {info.dbPath}
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-header"><h3>Backup & ripristino manuale</h3><div className="subtitle">Esporta/importa tutti i dati come file JSON</div></div>
        <div className="card-body" style={{ display: "flex", gap: 12 }}>
          {hasAPI ? (
            <>
              <button className="btn" onClick={doExport}><Icon name="download" size={14} /> Esporta backup JSON…</button>
              <button className="btn" onClick={doImport}><Icon name="download" size={14} /> Importa da file (JSON / .tsenc)…</button>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Funzione disponibile solo nella versione desktop (Electron).</div>
          )}
        </div>
      </div>

      {/* Passphrase management */}
      {hasAPI && (
        <div className="card">
          <div className="card-header">
            <h3>🔐 Cifratura backup</h3>
            <div className="subtitle">AES-256-GCM · passphrase salvata nel portachiavi di sistema</div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 500, fontSize: 13 }}>
                  {hasPassphrase
                    ? "✓ Passphrase configurata — i backup cloud saranno cifrati"
                    : "⚠ Nessuna passphrase — i backup cloud saranno in chiaro"}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                  {hasPassphrase
                    ? "I file .tsenc possono essere letti solo con questa passphrase."
                    : "Configura una passphrase per abilitare la cifratura dei backup cloud."}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn btn-sm" onClick={() => setShowPwForm(!showPwForm)}>
                  {hasPassphrase ? "Cambia passphrase" : "Imposta passphrase"}
                </button>
                {hasPassphrase && (
                  <button className="btn btn-sm btn-danger" onClick={async () => {
                    await window.api.crypto.removePassphrase();
                    setHasPassphrase(false);
                    showStatus("✓ Passphrase rimossa.");
                  }}>Rimuovi</button>
                )}
              </div>
            </div>
            {showPwForm && (
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  type="password"
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Nuova passphrase (min. 8 caratteri)"
                  value={newPw}
                  onChange={e => setNewPw(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && savePassphrase()}
                />
                <button className="btn btn-primary btn-sm" onClick={savePassphrase} disabled={newPw.length < 8}>
                  Salva
                </button>
                <button className="btn btn-sm" onClick={() => { setShowPwForm(false); setNewPw(""); }}>Annulla</button>
              </div>
            )}
          </div>
        </div>
      )}

      {hasAPI && (
        <div>
          <h3 className="section-title">Sincronizzazione cloud</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {cloudServices.map(s => (
              <CloudCard key={s.type} type={s.type} label={s.label} iconChar={s.icon} desc={s.desc} />
            ))}
          </div>
          <div style={{ marginTop: 12, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Il backup viene esportato nella cartella <strong>Timesheet/</strong> del servizio. Se la passphrase è configurata, il file viene cifrato (.tsenc). Un backup automatico locale viene salvato ad ogni chiusura (ultimi 10).
          </div>
        </div>
      )}

      {onResetData && (
        <div className="card" style={{ borderColor: "var(--danger-soft)" }}>
          <div className="card-header"><h3 style={{ color: "var(--danger)" }}>Zona pericolosa</h3></div>
          <div className="card-body" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontWeight: 500, marginBottom: 4 }}>Ripristina dati di esempio</div>
              <div style={{ fontSize: 12.5, color: "var(--text-muted)" }}>Cancella tutti i dati e reimporta il dataset demo. Non recuperabile.</div>
            </div>
            <button className="btn btn-danger" onClick={onResetData}>Ripristina demo</button>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-header">
          <h3>Numerazione documenti</h3>
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
              try {
                await window.api.db.resetDocCounter(currentYear);
                setDocCounter(0);
                showStatus(`✓ Contatore ${currentYear} azzerato.`);
              } catch (e) {
                showStatus(`✗ ${e.message}`);
              }
            }}
          >
            Reset contatore {currentYear}
          </button>
          <div className="hint" style={{ marginTop: 6 }}>
            Usa solo in caso di errore. I numeri già emessi non vengono riassegnati.
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Profilo & impostazioni ────────────────────────────────────────────────────
// Purchase treatment belongs to the KIND OF GOOD, so it is edited once here
// rather than on every document. Saved edits are stored as overrides and merged
// over the built-in defaults; existing invoices keep the values they were
// classified with, and only change if you explicitly re-apply.
const CategoryRulesTab = ({ categories, invoices, expenses, onSaveCategories }) => {
  const effective = window.effectiveCategories(categories);
  const asRows = () => Object.keys(effective).sort().map((name, i) => ({
    key: 'r' + i, original: name, name, rule: { ...effective[name] }, removed: false, moveTo: '',
  }));
  const [rows, setRows] = useState(asRows);
  const [error, setError] = useState('');

  const patch = (key, p) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...p } : r));
  const setRule = (key, p) => setRows(rs => rs.map(r => r.key === key ? { ...r, rule: { ...r.rule, ...p } } : r));
  const num = v => Math.min(100, Math.max(0, Number(v) || 0));

  // How many documents would a rename or a deletion move.
  const usage = name => (invoices || []).filter(i => i.fiscal && i.fiscal.category === name).length
    + (expenses || []).filter(e => e.category === name).length;

  const addRow = () => setRows(rs => [...rs, {
    key: 'n' + Date.now(), original: null, name: '',
    rule: { deductPct: 100, vatDetractPct: 100, vatPct: 22, vatExempt: false },
    removed: false, moveTo: '',
  }]);

  const live = rows.filter(r => !r.removed);
  const names = live.map(r => r.name.trim());

  const save = () => {
    if (names.some(n => !n)) return setError(t('cat.errEmpty'));
    if (new Set(names).size !== names.length) return setError(t('cat.errDup'));
    // Altro is the fallback every unknown category resolves to; without it a
    // deleted category would have nowhere to land.
    if (!names.includes('Altro')) return setError(t('cat.errAltro'));
    for (const r of rows) {
      if (r.removed && r.original && usage(r.original) > 0 && !r.moveTo) return setError(t('cat.errMove'));
    }
    const table = {};
    live.forEach(r => { table[r.name.trim()] = r.rule; });
    const moves = {};
    rows.forEach(r => {
      if (r.removed && r.original && usage(r.original) > 0) moves[r.original] = r.moveTo;
      else if (!r.removed && r.original && r.name.trim() !== r.original) moves[r.original] = r.name.trim();
    });
    setError('');
    onSaveCategories(table, moves);
  };

  return (
    <div className="card">
      <div className="card-header">
        <strong>{t('cat.title')}</strong>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={addRow}>{t('cat.add')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRows(asRows()); setError(''); }}>{t('action.cancel')}</button>
          <button className="btn btn-primary btn-sm" onClick={save}>{t('action.save')}</button>
        </div>
      </div>
      <div className="hint" style={{ padding: '0 16px 8px' }}>{t('cat.hint')}</div>
      {error && <div className="hint" style={{ padding: '0 16px 8px', color: 'var(--danger)' }}>{error}</div>}
      <div style={{ overflowX: 'auto' }}>
        <table className="data">
          <thead>
            <tr>
              <th>{t('inv.category')}</th>
              <th className="num" style={{ width: 110 }}>{t('cat.deduct')}</th>
              <th className="num" style={{ width: 120 }}>{t('cat.vatDetract')}</th>
              <th style={{ width: 160 }}>{t('cat.amort')}</th>
              <th className="num" style={{ width: 80 }}>{t('cat.usage')}</th>
              <th style={{ width: 200 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const used = r.original ? usage(r.original) : 0;
              const protectedRow = r.original === 'Altro';
              return (
                <tr key={r.key} style={r.removed ? { opacity: 0.45 } : null}>
                  <td>
                    <input className="input" value={r.name} disabled={r.removed || protectedRow}
                      onChange={e => patch(r.key, { name: e.target.value })} />
                  </td>
                  <td className="num">
                    <input type="number" className="input mono" min="0" max="100" style={{ width: 75 }}
                      disabled={r.removed} value={r.rule.deductPct == null ? 100 : r.rule.deductPct}
                      onChange={e => setRule(r.key, { deductPct: num(e.target.value) })} />
                  </td>
                  <td className="num">
                    <input type="number" className="input mono" min="0" max="100" style={{ width: 75 }}
                      disabled={r.removed} value={r.rule.vatDetractPct == null ? 100 : r.rule.vatDetractPct}
                      onChange={e => setRule(r.key, { vatDetractPct: num(e.target.value) })} />
                  </td>
                  <td>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input type="checkbox" disabled={r.removed} checked={!!r.rule.amortize}
                        onChange={e => setRule(r.key, { amortize: e.target.checked, amortYears: e.target.checked ? (r.rule.amortYears || 4) : null })} />
                      <input type="number" className="input mono" style={{ width: 55 }} min="1" max="20"
                        disabled={r.removed || !r.rule.amortize} value={r.rule.amortYears || 4}
                        onChange={e => setRule(r.key, { amortYears: Math.max(1, Number(e.target.value) || 4) })} />
                      <span className="hint">{t('cat.years')}</span>
                    </label>
                  </td>
                  <td className="num mono">{used || ''}</td>
                  <td>
                    {r.removed ? (
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        {used > 0 && (
                          <select className="select" value={r.moveTo}
                            onChange={e => patch(r.key, { moveTo: e.target.value })}>
                            <option value="">{t('cat.moveTo')}</option>
                            {live.filter(x => x.name.trim() && x.key !== r.key)
                              .map(x => <option key={x.key} value={x.name.trim()}>{x.name}</option>)}
                          </select>
                        )}
                        <button className="btn btn-ghost btn-sm" onClick={() => patch(r.key, { removed: false, moveTo: '' })}>
                          {t('cat.undo')}
                        </button>
                      </div>
                    ) : !protectedRow && (
                      <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }}
                        onClick={() => patch(r.key, { removed: true })}>{t('cat.remove')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ===== Aliquote e contributi =====
// Le aliquote sono configurazione, non un dato della schermata che le usa:
// prima vivevano dentro Tasse & contributi, dove si modificavano per sbaglio
// mentre si leggeva un consuntivo, e le addizionali non si potevano cambiare
// affatto — restavano ferme sui valori con cui il profilo era nato.
const PctField = ({ label, hint, value, fallback, step, max, unit, onChange }) => (
  <div className="field">
    <label>{label}</label>
    <div className="input-group" style={{ width: 160 }}>
      <input
        className="input mono" type="number"
        step={step || "0.01"} min="0" max={max == null ? 100 : max}
        value={value == null ? "" : value}
        placeholder={fallback == null ? "" : String(fallback)}
        onChange={e => onChange(e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0))} />
      <div className="addon">{unit || "%"}</div>
    </div>
    {hint && <div className="hint">{hint}</div>}
  </div>
);

const CASSA_SOGGETTIVA = {
  "Inarcassa": 14.5,
  "Cassa Forense": 14.5,
  "Cassa Geometri": 12,
  "ENPAP": 10,
  "ENPACL": 12,
  "Gestione Separata INPS": 26.07,
};

const FiscalRatesCard = ({ fisc, studio, onChange }) => {
  const tipo = studio.tipoSoggetto || "professionista";
  const cassaName = studio.cassaName || "Inarcassa";
  const isGS = cassaName === "Gestione Separata INPS";
  const suggerita = CASSA_SOGGETTIVA[cassaName];
  const brackets = fisc.irpefBrackets && fisc.irpefBrackets.length
    ? fisc.irpefBrackets
    : [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: null, rate: 43 }];

  const setBracket = (i, patch) => onChange({
    irpefBrackets: brackets.map((b, j) => (j === i ? { ...b, ...patch } : b)),
  });
  const addBracket = () => {
    const next = brackets.slice();
    const last = next[next.length - 1];
    // Lo scaglione finale non ha tetto: il nuovo si inserisce prima di quello.
    next.splice(next.length - 1, 0, { upTo: (last.upTo || next[next.length - 2]?.upTo || 50000) + 10000, rate: last.rate });
    onChange({ irpefBrackets: next });
  };
  const removeBracket = (i) => onChange({ irpefBrackets: brackets.filter((_, j) => j !== i) });

  // Un tetto deve stare sopra quello che lo precede, altrimenti lo scaglione è
  // vuoto e l'imposta viene calcolata su una fascia che non esiste.
  const bracketErrors = brackets.map((b, i) => {
    if (i === brackets.length - 1) return b.upTo != null ? "L'ultimo scaglione non ha tetto" : null;
    if (b.upTo == null) return "Indica il tetto dello scaglione";
    const prev = i > 0 ? brackets[i - 1].upTo : 0;
    return prev != null && b.upTo <= prev ? "Il tetto deve superare lo scaglione precedente" : null;
  });

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Aliquote e contributi</h3>
          <div className="subtitle">Alimentano Tasse &amp; contributi, F24 e previsioni</div>
        </div>
      </div>
      <div className="card-body">
        <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
          {(tipo === "professionista" || tipo === "societa") && (
            <PctField
              label={`Aliquota contributiva soggettiva — ${cassaName}`}
              hint={suggerita ? `Aliquota ordinaria ${String(suggerita).replace(".", ",")}%` : null}
              value={fisc.cassaContribPct} fallback={suggerita || 14.5} step="0.01" max={50}
              onChange={v => onChange({ cassaContribPct: v })} />
          )}
          {tipo === "professionista" && !fisc.scadenzario && (
            <PctField
              label="Acconto contributi, % dell'anno precedente"
              hint={isGS
                ? "Gestione Separata: 80% in due rate uguali. Vuoto = 80%."
                : "Casse private: in genere 100% in due rate. Vuoto = 100%."}
              value={fisc.cassaAccontoPct} fallback={isGS ? 80 : 100} step="1" max={100}
              onChange={v => onChange({ cassaAccontoPct: v })} />
          )}
          {tipo === "ditta_individuale" && (
            <>
              <PctField
                label="INPS — minimale annuo" unit="€" step="0.01" max={100000}
                value={fisc.inpsMinimale} fallback={4427}
                onChange={v => onChange({ inpsMinimale: v })} />
              <PctField
                label="INPS — aliquota sul reddito eccedente" step="0.01" max={50}
                value={fisc.inpsPctVariabile} fallback={24}
                onChange={v => onChange({ inpsPctVariabile: v })} />
              <PctField
                label="Aliquota IRAP"
                hint="Solo con autonoma organizzazione" step="0.1" max={10}
                value={fisc.irapPct} fallback={3.9}
                onChange={v => onChange({ irapPct: v })} />
            </>
          )}
          <PctField
            label="Addizionale regionale IRPEF"
            hint="Dipende dalla tua regione di residenza" step="0.01" max={5}
            value={fisc.addRegPct} fallback={0}
            onChange={v => onChange({ addRegPct: v })} />
          <PctField
            label="Addizionale comunale IRPEF"
            hint="Dipende dal tuo comune di residenza" step="0.01" max={5}
            value={fisc.addComPct} fallback={0}
            onChange={v => onChange({ addComPct: v })} />
        </div>

        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Scaglioni IRPEF</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Cambiano per legge: aggiornali quando cambiano, senza aspettare un rilascio dell'app.
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Fino a</th>
                <th style={{ width: 120 }}>Aliquota</th>
                <th style={{ width: 44 }}></th>
              </tr>
            </thead>
            <tbody>
              {brackets.map((b, i) => (
                <tr key={i}>
                  <td>
                    {i === brackets.length - 1 ? (
                      <span style={{ color: "var(--text-secondary)" }}>oltre lo scaglione precedente</span>
                    ) : (
                      <div className="input-group" style={{ width: 160 }}>
                        <div className="addon">€</div>
                        <input className="input mono" type="number" step="500" min="0"
                          value={b.upTo == null ? "" : b.upTo}
                          onChange={e => setBracket(i, { upTo: e.target.value === "" ? null : Math.max(0, Number(e.target.value) || 0) })} />
                      </div>
                    )}
                    {bracketErrors[i] && (
                      <div style={{ color: "var(--danger)", fontSize: 11.5, marginTop: 4 }}>{bracketErrors[i]}</div>
                    )}
                  </td>
                  <td>
                    <div className="input-group" style={{ width: 100 }}>
                      <input className="input mono" type="number" step="0.1" min="0" max="100"
                        value={b.rate == null ? "" : b.rate}
                        onChange={e => setBracket(i, { rate: Math.max(0, Number(e.target.value) || 0) })} />
                      <div className="addon">%</div>
                    </div>
                  </td>
                  <td>
                    {brackets.length > 1 && (
                      <button className="btn btn-sm btn-ghost" title="Rimuovi scaglione"
                        onClick={() => removeBracket(i)}>
                        <Icon name="trash" size={13} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn btn-sm" style={{ marginTop: 10 }} onClick={addBracket}>
            <Icon name="plus" size={13} /> Aggiungi scaglione
          </button>
        </div>

        {fisc.scadenzario ? (
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)", fontSize: 12.5, color: "var(--text-secondary)" }}>
            Percentuale e base degli acconti si impostano nello{" "}
            <a href="#scadenzario-f24" onClick={e => { e.preventDefault(); const el = document.getElementById("scadenzario-f24"); if (el) el.scrollIntoView({ behavior: "smooth" }); }}>Scadenzario F24</a>.
          </div>
        ) : (
        <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--border)" }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Base per gli acconti</div>
          <div className="hint" style={{ marginBottom: 10 }}>
            Serve solo finché l'archivio non contiene le fatture dell'anno precedente: da quel
            momento la base viene calcolata da quelle e questi valori restano inutilizzati.
          </div>
          <div className="form-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
            <PctField label="IRPEF netta dell'anno precedente" unit="€" step="0.01" max={10000000}
              value={fisc.irpefPrevYear} fallback={0}
              onChange={v => onChange({ irpefPrevYear: v })} />
            <PctField label="Contributi dell'anno precedente" unit="€" step="0.01" max={10000000}
              value={fisc.cassaPrevYear} fallback={0}
              onChange={v => onChange({ cassaPrevYear: v })} />
          </div>
        </div>
        )}
      </div>
    </div>
  );
};

// ── Scadenzario F24 ─────────────────────────────────────────────────────────
// Le scadenze di ogni tributo come dati: base, acconti, rate, saldo. Parte dal
// preset che corrisponde allo studio; salvato, non lo segue più. Uno schema con
// errori non si salva. Spec: docs/superpowers/specs/2026-11-08-f24-scadenzario-design.md
const PRESET_LABELS = {
  "professionista-gs": "Professionista · Gestione Separata INPS",
  "professionista-cassa": "Professionista · cassa privata",
  "ditta": "Ditta individuale",
  "solo-iva": "Solo IVA (società)",
};
const BASE_LABELS = {
  irpef: "IRPEF netta (senza addizionali)", addReg: "Addizionale regionale", addCom: "Addizionale comunale",
  contribCassa: "Contributo cassa / GS", contribFisso: "INPS minimale", contribVar: "INPS eccedente",
  irap: "IRAP", ivaPeriodo: "IVA per periodo",
};
const SEZIONE_LABELS = { erario: "Erario", inps: "INPS", regioni: "Regioni", locali: "Tributi locali", "altri-enti": "Altri enti previdenziali" };

const ScadenzarioCard = ({ fisc, studio, onSaveScheme }) => {
  const active = window.activeScheme(fisc, studio);
  const clone = x => JSON.parse(JSON.stringify(x));
  const [draft, setDraft] = useState(() => clone(active.scheme));
  const [open, setOpen] = useState({});
  const res = window.validateScheme(draft);
  const errorAt = path => (res.errors.find(e => e.path === path) || {}).message;
  const linked = id => (fisc.f24History || []).some(f => f.tributo === id);
  const dirty = JSON.stringify(draft) !== JSON.stringify(active.scheme);

  const setT = (ti, patch) => setDraft(d => ({ ...d, tributi: d.tributi.map((t, i) => (i === ti ? { ...t, ...patch } : t)) }));
  const setSub = (ti, key, patch) => setDraft(d => ({
    ...d, tributi: d.tributi.map((t, i) => (i === ti ? { ...t, [key]: { ...(t[key] || {}), ...patch } } : t)),
  }));
  const setRow = (ti, list, ri, patch) => setDraft(d => ({
    ...d, tributi: d.tributi.map((t, i) => (i !== ti ? t
      : { ...t, [list]: t[list].map((r, j) => (j === ri ? { ...r, ...patch } : r)) })),
  }));
  const freeId = (taken, prefix) => { let n = 1; while (taken.includes(prefix + n)) n++; return prefix + n; };
  const addRow = ti => setDraft(d => ({
    ...d, tributi: d.tributi.map((t, i) => {
      if (i !== ti) return t;
      if (t.kind === "iva") {
        const id = freeId((t.periodi || []).map(p => p.id), "p");
        return { ...t, periodi: [...(t.periodi || []), { id, months: [], date: "01-16", yearOffset: 0, code: "", label: "" }] };
      }
      const id = freeId((t.righe || []).map(r => r.id), "r");
      return { ...t, righe: [...(t.righe || []), { id, quota: "corrente", share: 100, date: "06-30", yearOffset: 0, code: "", label: "" }] };
    }),
  }));
  const removeRow = (ti, list, ri) => setDraft(d => ({
    ...d, tributi: d.tributi.map((t, i) => (i !== ti ? t : { ...t, [list]: t[list].filter((_, j) => j !== ri) })),
  }));
  const addTributo = () => setDraft(d => {
    const id = freeId(d.tributi.map(t => t.id), "t");
    return {
      ...d, tributi: [...d.tributi, {
        id, label: "Nuovo tributo", kind: "imposta", base: "irpef", sezione: "erario",
        acconti: { metodo: "nessuno", fallbackPrevYear: 0, soglia: 0 },
        righe: [{ id: "saldo", quota: "saldo", date: "06-30", yearOffset: 1, code: "", label: "Saldo {anno}" }],
      }],
    };
  });
  const removeTributo = ti => {
    const t = draft.tributi[ti];
    if (linked(t.id) && !window.confirm(`Ci sono voci F24 registrate per "${t.label}". Resteranno come voci senza tributo e smetteranno di contare nei calcoli. Toglierlo comunque?`)) return;
    setDraft(d => ({ ...d, tributi: d.tributi.filter((_, i) => i !== ti) }));
  };
  const pickPreset = id => {
    if (!window.confirm("Sostituire lo scadenzario con il preset scelto? Le modifiche non salvate si perdono.")) return;
    setDraft(window.presetScheme(id, fisc, studio));
  };
  const restore = () => {
    if (!window.confirm("Tornare al preset dello studio? Lo scadenzario salvato verrà tolto.")) return;
    onSaveScheme(undefined);
    setDraft(clone(window.presetScheme(window.presetIdFor(studio), { ...fisc, scadenzario: undefined }, studio)));
  };

  const Err = ({ path }) => (errorAt(path)
    ? <div style={{ color: "var(--danger)", fontSize: 11, marginTop: 2 }}>{errorAt(path)}</div> : null);
  const num = v => (v === "" ? "" : Number(v));
  const cell = { padding: "4px 6px", verticalAlign: "top" };

  return (
    <div className="card" id="scadenzario-f24" style={{ gridColumn: "1 / -1" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h3>Scadenzario F24</h3>
          <div className="subtitle">
            {active.source === "saved" ? "Schema salvato" : "Preset dello studio"} · le scadenze di ogni tributo, i codici e come si calcolano
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select className="select" value={draft.preset || ""} onChange={e => pickPreset(e.target.value)}>
            {Object.entries(PRESET_LABELS).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
          {active.source === "saved" && <button className="btn btn-sm" onClick={restore}>Ripristina</button>}
          <button className="btn btn-primary btn-sm" disabled={!res.ok || !dirty}
            title={res.ok ? "" : "Correggi gli errori indicati prima di salvare"}
            onClick={() => onSaveScheme(clone(draft))}>Salva scadenzario</button>
        </div>
      </div>
      <div className="card-body">
        {active.warning && (
          <div style={{ padding: "8px 10px", background: "oklch(0.97 0.05 80)", borderRadius: 4, fontSize: 12.5, marginBottom: 12 }}>{active.warning}</div>
        )}
        {draft.tributi.map((t, ti) => {
          const isOpen = !!open[t.id];
          const isIva = t.kind === "iva";
          const p = `tributi[${ti}]`;
          const hasErr = res.errors.some(e => e.path === p || e.path.startsWith(p + "."));
          return (
            <div key={t.id} style={{ border: "1px solid " + (hasErr ? "var(--danger)" : "var(--border)"), borderRadius: 4, marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", cursor: "pointer" }}
                onClick={() => setOpen(o => ({ ...o, [t.id]: !isOpen }))}>
                <span style={{ width: 12 }}>{isOpen ? "▾" : "▸"}</span>
                <strong style={{ flex: "0 0 200px" }}>{t.label}</strong>
                <span style={{ fontSize: 12, color: "var(--text-secondary)", flex: 1 }}>
                  {BASE_LABELS[t.base] || t.base}
                  {" · "}
                  {isIva
                    ? `${(t.periodi || []).length} periodi${t.acconto && t.acconto.metodo === "storico" ? ", acconto " + t.acconto.pct + "%" : ""}`
                    : (t.acconti && t.acconti.metodo === "storico" ? `acconti storici ${t.acconti.pct}%` : "nessun acconto")}
                </span>
                <button className="btn btn-sm btn-danger" title="Togli il tributo"
                  onClick={e => { e.stopPropagation(); removeTributo(ti); }}>✕</button>
              </div>
              {isOpen && (
                <div style={{ padding: "4px 12px 12px", borderTop: "1px solid var(--border)" }}>
                  <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 8 }}>
                    <div className="field"><label>Nome</label>
                      <input className="input" value={t.label} onChange={e => setT(ti, { label: e.target.value })} /></div>
                    <div className="field"><label>Tipo</label>
                      <select className="select" value={t.kind} onChange={e => setT(ti, { kind: e.target.value })}>
                        <option value="imposta">Imposta</option><option value="contributo">Contributo (deducibile)</option><option value="iva">IVA</option>
                      </select><Err path={`${p}.kind`} /></div>
                    <div className="field"><label>Base</label>
                      <select className="select" value={t.base} onChange={e => setT(ti, { base: e.target.value })}>
                        {window.SCHEME_BASES.map(b => <option key={b} value={b}>{BASE_LABELS[b] || b}</option>)}
                      </select><Err path={`${p}.base`} /></div>
                    <div className="field"><label>Sezione F24</label>
                      <select className="select" value={t.sezione || ""} onChange={e => setT(ti, { sezione: e.target.value || undefined })}>
                        {window.SCHEME_SEZIONI.map(z => <option key={z} value={z}>{SEZIONE_LABELS[z]}</option>)}
                      </select></div>
                  </div>

                  {!isIva && (
                    <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                      <div className="field"><label>Acconti</label>
                        <select className="select" value={(t.acconti || {}).metodo || "nessuno"}
                          onChange={e => {
                            const metodo = e.target.value;
                            // Senza acconti le rate di acconto non hanno senso: si tolgono
                            // con la scelta, invece di lasciare uno schema in errore.
                            setDraft(d => ({ ...d, tributi: d.tributi.map((x, i) => (i !== ti ? x : {
                              ...x,
                              acconti: { ...(x.acconti || {}), metodo, pct: (x.acconti || {}).pct == null ? 100 : x.acconti.pct },
                              righe: metodo === "nessuno" ? (x.righe || []).filter(r => r.quota !== "acconto") : x.righe,
                            })) }));
                          }}>
                          <option value="nessuno">Nessuno: tutto a saldo</option><option value="storico">Storico, sull'anno prima</option>
                        </select><Err path={`${p}.acconti.metodo`} /></div>
                      {(t.acconti || {}).metodo === "storico" && (
                        <React.Fragment>
                          <div className="field"><label>% della base dell'anno prima</label>
                            <input className="input mono" type="number" value={t.acconti.pct == null ? "" : t.acconti.pct}
                              onChange={e => setSub(ti, "acconti", { pct: num(e.target.value) })} /><Err path={`${p}.acconti.pct`} /></div>
                          <div className="field"><label>Base anno prima se mancano le fatture (€)</label>
                            <input className="input mono" type="number" value={t.acconti.fallbackPrevYear == null ? "" : t.acconti.fallbackPrevYear}
                              onChange={e => setSub(ti, "acconti", { fallbackPrevYear: num(e.target.value) })} /><Err path={`${p}.acconti.fallbackPrevYear`} />
                            {t.base === "irpef" && <div className="hint">IRPEF senza addizionali.</div>}</div>
                          <div className="field"><label>Soglia minima (€)</label>
                            <input className="input mono" type="number" value={t.acconti.soglia == null ? "" : t.acconti.soglia}
                              onChange={e => setSub(ti, "acconti", { soglia: num(e.target.value) })} /><Err path={`${p}.acconti.soglia`} /></div>
                        </React.Fragment>
                      )}
                    </div>
                  )}

                  {isIva && (
                    <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
                      <div className="field"><label>Maggiorazione %</label>
                        <input className="input mono" type="number" value={t.maggiorazionePct == null ? "" : t.maggiorazionePct}
                          onChange={e => setT(ti, { maggiorazionePct: num(e.target.value) })} /><Err path={`${p}.maggiorazionePct`} /></div>
                      <div className="field"><label>Acconto di dicembre</label>
                        <select className="select" value={(t.acconto || {}).metodo || "nessuno"}
                          onChange={e => setSub(ti, "acconto", { metodo: e.target.value })}>
                          <option value="nessuno">Nessuno</option><option value="storico">Storico (88%)</option>
                        </select></div>
                      {t.acconto && t.acconto.metodo === "storico" && (
                        <React.Fragment>
                          <div className="field"><label>Base anno prima se mancano le fatture (€)</label>
                            <input className="input mono" type="number" value={t.acconto.fallbackPrevYear == null ? "" : t.acconto.fallbackPrevYear}
                              onChange={e => setSub(ti, "acconto", { fallbackPrevYear: num(e.target.value) })} />
                            <div className="hint">Il versamento dell'ultimo periodo dell'anno prima.</div><Err path={`${p}.acconto.fallbackPrevYear`} /></div>
                          <div className="field"><label>Scala dal periodo</label>
                            <select className="select" value={t.acconto.periodo || ""} onChange={e => setSub(ti, "acconto", { periodo: e.target.value })}>
                              {(t.periodi || []).map(per => <option key={per.id} value={per.id}>{per.label.replace("{anno}", "") || per.id}</option>)}
                            </select><Err path={`${p}.acconto.periodo`} /></div>
                        </React.Fragment>
                      )}
                    </div>
                  )}

                  <table className="data" style={{ marginTop: 6 }}>
                    <thead><tr>
                      {isIva && <th>Mesi</th>}
                      <th>Data (gg/mm)</th><th>Anno</th><th>Codice</th><th>Descrizione</th>
                      {!isIva && <th>Quota</th>}{!isIva && <th>%</th>}<th></th>
                    </tr></thead>
                    <tbody>
                      {(isIva ? (t.periodi || []) : (t.righe || [])).map((r, ri) => {
                        const list = isIva ? "periodi" : "righe";
                        const q = `${p}.${list}[${ri}]`;
                        const [mm, dd] = String(r.date || "").split("-");
                        return (
                          <tr key={r.id}>
                            {isIva && <td style={cell}>
                              <input className="input mono" style={{ width: 110 }} value={(r.months || []).join(",")}
                                onChange={e => setRow(ti, list, ri, { months: e.target.value.split(",").map(x => x.trim()).filter(Boolean).map(x => x.padStart(2, "0")) })} />
                              <Err path={`${q}.months`} /></td>}
                            <td style={cell}>
                              <input className="input mono" style={{ width: 80 }} placeholder="30/06" value={dd != null ? `${dd}/${mm}` : ""}
                                onChange={e => {
                                  const [g, m] = e.target.value.split("/");
                                  setRow(ti, list, ri, { date: `${String(m || "").padStart(2, "0")}-${String(g || "").padStart(2, "0")}` });
                                }} />
                              <Err path={`${q}.date`} /></td>
                            <td style={cell}>
                              <select className="select" value={r.yearOffset || 0} onChange={e => setRow(ti, list, ri, { yearOffset: Number(e.target.value) })}>
                                <option value={0}>stesso</option><option value={1}>dopo</option>
                              </select></td>
                            <td style={cell}>
                              <input className="input mono" style={{ width: 80 }} value={r.code || ""} placeholder={t.sezione === "altri-enti" ? "da indicare" : ""}
                                onChange={e => setRow(ti, list, ri, { code: e.target.value.trim().toUpperCase() })} />
                              <Err path={`${q}.code`} /></td>
                            <td style={cell}>
                              <input className="input" value={r.label || ""} onChange={e => setRow(ti, list, ri, { label: e.target.value })} />
                              <div className="hint">{"{anno}"} diventa l'anno fiscale</div></td>
                            {!isIva && <td style={cell}>
                              <select className="select" value={r.quota} onChange={e => setRow(ti, list, ri, { quota: e.target.value })}>
                                <option value="acconto">Acconto</option><option value="corrente">Rata dell'anno</option><option value="saldo">Saldo</option>
                              </select><Err path={`${q}.quota`} /></td>}
                            {!isIva && <td style={cell}>
                              {r.quota !== "saldo" && <input className="input mono" type="number" style={{ width: 70 }} value={r.share == null ? "" : r.share}
                                onChange={e => setRow(ti, list, ri, { share: num(e.target.value) })} />}
                              <Err path={`${q}.share`} /></td>}
                            <td style={cell}><button className="btn btn-sm btn-danger" onClick={() => removeRow(ti, list, ri)}>✕</button></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => addRow(ti)}>+ {isIva ? "periodo" : "riga"}</button>
                </div>
              )}
            </div>
          );
        })}
        <button className="btn btn-sm" onClick={addTributo}>+ tributo</button>
        {res.warnings.map(w => (
          <div key={w.path} style={{ marginTop: 8, fontSize: 12, color: "#92400e" }}>⚠ {w.message}</div>
        ))}
        {!res.ok && (
          <div style={{ marginTop: 8, fontSize: 12, color: "var(--danger)" }}>
            {res.errors.length} {res.errors.length === 1 ? "errore" : "errori"} da correggere prima di salvare.
          </div>
        )}
      </div>
    </div>
  );
};

const Settings = ({ user, onSave, onResetData, categories, invoices, expenses, onSaveCategories, fiscal, onSaveFiscal }) => {
  const [data, setData] = useState(user);
  const [tab, setTab] = useState("profile");
  const update = (patch) => setData(d => ({ ...d, ...patch }));

  // Only the CHANGED fiscal keys are held, never a copy of the whole object:
  // the Tasse screen writes to the same record (F24 history, acconti versati),
  // and saving a snapshot taken when this screen opened would roll those back.
  const [fiscPatch, setFiscPatch] = useState({});
  const fisc = { ...(fiscal || {}), ...fiscPatch };
  const updateFisc = (patch) => setFiscPatch(p => ({ ...p, ...patch }));

  // Lo scadenzario si salva da solo, col suo pulsante: si scrive subito e si
  // tiene anche nella patch, così il Salva della pagina non lo riporta indietro.
  const saveScheme = (scheme) => {
    updateFisc({ scadenzario: scheme });
    if (onSaveFiscal) onSaveFiscal({ ...(fiscal || {}), ...fiscPatch, scadenzario: scheme });
    window.showToast && window.showToast(scheme ? "Scadenzario salvato" : "Scadenzario riportato al preset", "success");
  };

  const handleSave = () => {
    onSave(data);
    if (onSaveFiscal && Object.keys(fiscPatch).length) onSaveFiscal({ ...(fiscal || {}), ...fiscPatch });
    window.showToast && window.showToast(t('set.saved'), 'success');
  };

  return (
    <div className="content" style={{ maxWidth: 1000 }}>
      <div className="tab-nav">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>{t('set.profile')}</button>
        <button className={tab === "fiscal" ? "active" : ""} onClick={() => setTab("fiscal")}>{t('set.fiscal')}</button>
        <button className={tab === "branding" ? "active" : ""} onClick={() => setTab("branding")}>{t('set.branding')}</button>
        <button className={tab === "preferences" ? "active" : ""} onClick={() => setTab("preferences")}>{t('set.preferences')}</button>
        <button className={tab === "categories" ? "active" : ""} onClick={() => setTab("categories")}>{t('set.categories')}</button>
        <button className={tab === "data" ? "active" : ""} onClick={() => setTab("data")}>{t('set.data')}</button>
      </div>

      {tab === "profile" && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Dati anagrafici dello studio</h3>
              <div className="subtitle">Compaiono in testata su tutti i documenti emessi</div>
            </div>
          </div>
          <div className="card-body">
            <div className="form-grid">
              <div className="field">
                <label>Ragione sociale / Nome studio</label>
                <input className="input" value={data.firm} onChange={e => update({ firm: e.target.value })} />
              </div>
              <div className="field">
                <label>Titolare</label>
                <input className="input" value={data.name} onChange={e => update({ name: e.target.value })} />
              </div>
              <div className="field">
                <label>Qualifica professionale</label>
                <input className="input" value={data.role} onChange={e => update({ role: e.target.value })} />
              </div>
              <div className="field">
                <label>Iniziali (avatar)</label>
                <input className="input mono" value={data.initials} onChange={e => update({ initials: e.target.value.slice(0, 2).toUpperCase() })} maxLength={2} />
              </div>
              <div className="field full">
                <label>Indirizzo sede</label>
                <input className="input" value={data.address} onChange={e => update({ address: e.target.value })} />
              </div>
              <div className="field">
                <label>Email professionale</label>
                <input className="input" type="email" value={data.email} onChange={e => update({ email: e.target.value })} />
              </div>
              <div className="field">
                <label>Telefono</label>
                <input className="input mono" value={data.phone || ""} onChange={e => update({ phone: e.target.value })} placeholder="+39 02 1234567" />
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "fiscal" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div className="card">
            <div className="card-header"><h3>Identificativi fiscali</h3></div>
            <div className="card-body">
              <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <div className="field">
                  <label>Partita IVA</label>
                  <input className="input mono" value={data.piva} onChange={e => update({ piva: normalizePIVA(e.target.value) })} />
                </div>
                <div className="field">
                  <label>Codice Fiscale</label>
                  <input className="input mono" value={data.cf} onChange={e => update({ cf: e.target.value })} />
                </div>
                <div className="field">
                  <label>Regime fiscale</label>
                  <select className="select" value={data.regime || "ordinario"} onChange={e => update({ regime: e.target.value })}>
                    <option value="ordinario">Ordinario con IVA</option>
                    <option value="forfettario">Forfettario</option>
                    <option value="minimi">Regime dei minimi</option>
                  </select>
                </div>
                <div className="field">
                  <label>Tipo soggetto fiscale</label>
                  <select className="select" value={data.tipoSoggetto || "professionista"} onChange={e => update({ tipoSoggetto: e.target.value })}>
                    <option value="professionista">Libero professionista</option>
                    <option value="ditta_individuale">Ditta individuale</option>
                    <option value="societa">Società (SRL/SNC/…)</option>
                  </select>
                  <div className="hint">Determina scadenze, aliquote contributive e imposte applicabili.</div>
                </div>
                {(data.tipoSoggetto === "professionista" || !data.tipoSoggetto) && (
                  <div className="field">
                    <label>Cassa previdenziale</label>
                    <select className="select" value={data.cassaName || "Inarcassa"} onChange={e => update({ cassaName: e.target.value })}>
                      <option>Inarcassa</option>
                      <option>Cassa Forense</option>
                      <option>Cassa Geometri</option>
                      <option>ENPAP</option>
                      <option>ENPACL</option>
                      <option>Gestione Separata INPS</option>
                    </select>
                  </div>
                )}
                {data.tipoSoggetto === "ditta_individuale" && (
                  <div className="field">
                    <label>Tipo INPS</label>
                    <select className="select" value={data.tipoInps || "artigiano"} onChange={e => update({ tipoInps: e.target.value })}>
                      <option value="artigiano">Artigiano</option>
                      <option value="commerciante">Commerciante</option>
                    </select>
                  </div>
                )}
              </div>
            </div>
          </div>

          <FiscalRatesCard fisc={fisc} studio={data} onChange={updateFisc} />

          <ScadenzarioCard key={(fisc.scadenzario ? "saved" : "preset") + ":" + (window.presetIdFor(data))}
            fisc={fisc} studio={data} onSaveScheme={saveScheme} />

          <div className="card">
            <div className="card-header"><h3>Coordinate bancarie</h3></div>
            <div className="card-body">
              <div className="form-grid" style={{ gridTemplateColumns: "1fr" }}>
                <div className="field">
                  <label>Banca</label>
                  <input className="input" value={data.bank || ""} onChange={e => update({ bank: e.target.value })} placeholder="Intesa Sanpaolo" />
                </div>
                <div className="field">
                  <label>Intestatario</label>
                  <input className="input" value={data.ibanHolder || data.firm} onChange={e => update({ ibanHolder: e.target.value })} />
                </div>
                <div className="field">
                  <label>IBAN</label>
                  <input className="input mono" value={data.iban} onChange={e => update({ iban: e.target.value })} />
                </div>
                <div className="field">
                  <label>BIC / SWIFT</label>
                  <input className="input mono" value={data.bic || ""} onChange={e => update({ bic: e.target.value })} />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "branding" && (
        <div className="card">
          <div className="card-header"><h3>Logo & intestazione documenti</h3></div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 32 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" }}>Logo</label>
              <input
                type="file"
                accept="image/png,image/jpeg,image/svg+xml,image/webp"
                style={{ display: "none" }}
                id="logo-file-input"
                onChange={e => {
                  const file = e.target.files[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = ev => update({ logoDataUrl: ev.target.result });
                  reader.readAsDataURL(file);
                }}
              />
              <div
                onClick={() => document.getElementById("logo-file-input").click()}
                style={{
                  marginTop: 8,
                  width: 280, height: 180,
                  border: "2px dashed var(--border-strong)",
                  borderRadius: "var(--radius)",
                  display: "grid", placeItems: "center",
                  background: data.logoDataUrl
                    ? `url(${data.logoDataUrl}) center/contain no-repeat var(--bg-sunken)`
                    : "repeating-linear-gradient(45deg, var(--bg-sunken), var(--bg-sunken) 8px, transparent 8px, transparent 16px)",
                  cursor: "pointer",
                  overflow: "hidden",
                }}>
                {!data.logoDataUrl && (
                  <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: 11, textAlign: "center", lineHeight: 1.5, pointerEvents: "none" }}>
                    clicca per caricare<br />PNG / SVG / JPG
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <button className="btn btn-sm" style={{ flex: 1 }} onClick={() => document.getElementById("logo-file-input").click()}>
                  Carica file
                </button>
                <button className="btn btn-sm" onClick={() => update({ logoDataUrl: null })} disabled={!data.logoDataUrl}>
                  Rimuovi
                </button>
              </div>
            </div>
            <div>
              <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Anteprima testata documento</h4>
              <div style={{ background: "white", border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: 24, color: "#1c1917" }}>
                <div style={{ borderBottom: "2px solid #1c1917", paddingBottom: 14, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{data.firm}</div>
                    <div style={{ fontSize: 11, color: "#57534e", marginTop: 4 }}>{data.address}</div>
                    <div style={{ fontSize: 11, color: "#57534e" }}>{fmtPIVA(data.piva)} · C.F. {data.cf}</div>
                    <div style={{ fontSize: 11, color: "#57534e" }}>{data.email}</div>
                  </div>
                  {data.logoDataUrl
                    ? <img src={data.logoDataUrl} style={{ height: 50, maxWidth: 120, objectFit: "contain" }} alt="Logo" />
                    : <div style={{ width: 80, height: 50, background: "#f5f5f4", display: "grid", placeItems: "center", fontSize: 9, color: "#a8a29e", fontFamily: "monospace" }}>LOGO</div>
                  }
                </div>
              </div>
              <div className="divider" />
              <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Personalizzazione documento</h4>
              <div className="form-grid">
                <div className="field full">
                  <label>Testo introduttivo (Word)</label>
                  <textarea className="textarea" rows={3} defaultValue="Con la presente, lo scrivente {firm} ({piva}), in riferimento al contratto di prestazione professionale, trasmette il riepilogo delle attività svolte nel periodo {period}." />
                  <div className="hint">Variabili disponibili: {"{firm}"}, {"{piva}"}, {"{period}"}, {"{client}"}, {"{hours}"}, {"{total}"}</div>
                </div>
                <div className="field">
                  <label>Numerazione documenti</label>
                  <input className="input mono" defaultValue="2026-{seq:3}" />
                </div>
                <div className="field">
                  <label>Lingua predefinita</label>
                  <select className="select"><option>Italiano</option><option>Inglese</option></select>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "preferences" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div className="card">
          <div className="card-header"><h3>{t('set.language')}</h3></div>
          <div className="card-body">
            <div style={{ display: "flex", gap: 10 }}>
              {(window.SUPPORTED_LANGS || []).map(l => (
                <button key={l.code}
                  className={"btn " + (window._lang === l.code ? "btn-primary" : "")}
                  onClick={() => { window.setLang(l.code); window.location.reload(); }}>
                  {l.flag} {l.name}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
              {window._lang === 'it' ? 'La lingua cambia al riavvio della pagina.' : 'Language change takes effect on reload.'}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-header"><h3>{t('set.preferences')}</h3></div>
          <div className="card-body">
            <div className="form-grid">
              <div className="field">
                <label>Valuta</label>
                <select className="select"><option>EUR (€)</option><option>USD ($)</option><option>GBP (£)</option><option>CHF (Fr.)</option></select>
              </div>
              <div className="field">
                <label>Locale</label>
                <select className="select"><option>Italiano (it-IT)</option><option>English (en-US)</option></select>
              </div>
              <div className="field">
                <label>Primo giorno settimana</label>
                <select className="select"><option>Lunedì</option><option>Domenica</option></select>
              </div>
              <div className="field">
                <label>Ore lavorative giornaliere</label>
                <div className="input-group">
                  <input className="input mono" type="number" defaultValue={8} />
                  <div className="addon">h</div>
                </div>
              </div>
              <div className="field full">
                <label className="checkbox-row">
                  <input type="checkbox" defaultChecked /> Avvia all'accensione del computer
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" defaultChecked /> Notifiche desktop al raggiungimento del plafond cliente
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" /> Backup automatico settimanale (iCloud / OneDrive)
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" defaultChecked /> Conferma prima di eliminare attività o spese
                </label>
              </div>
            </div>
          </div>
        </div>
        </div>
      )}

      {tab === "categories" && <CategoryRulesTab categories={categories} invoices={invoices} expenses={expenses} onSaveCategories={onSaveCategories} />}
      {tab === "data" && <DataBackupTab onResetData={onResetData} />}

      {tab !== "data" && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 20 }}>
          <button className="btn" onClick={() => { setData(user); setFiscPatch({}); }}>{t('action.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave}>
            <Icon name="check" size={14} /> {t('set.save')}
          </button>
        </div>
      )}
    </div>
  );
};

window.Settings = Settings;
