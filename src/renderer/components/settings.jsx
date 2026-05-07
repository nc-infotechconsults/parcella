// ── Dati & Backup tab ────────────────────────────────────────────────────────
const DataBackupTab = ({ onResetData }) => {
  const [info, setInfo] = useState(null);
  const [cloud, setCloud] = useState(null);
  const [hasPassphrase, setHasPassphrase] = useState(false);
  const [newPw, setNewPw] = useState("");
  const [showPwForm, setShowPwForm] = useState(false);
  const hasAPI = !!window.api?.db;

  useEffect(() => {
    if (!hasAPI) return;
    window.api.db.getInfo().then(setInfo);
    window.api.backup.checkCloud().then(setCloud);
    window.api.crypto?.getPassphrase().then(setHasPassphrase);
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
            <div className="info-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginBottom: 16 }}>
              <div className="info-cell"><div className="label">Tipo storage</div><div className="value mono">{info.dbType?.toUpperCase()}</div></div>
              <div className="info-cell"><div className="label">Dimensione</div><div className="value mono">{fmt(info.stats.sizeBytes)}</div></div>
              <div className="info-cell"><div className="label">Clienti</div><div className="value">{info.stats.clients}</div></div>
              <div className="info-cell"><div className="label">Attività</div><div className="value">{info.stats.activities}</div></div>
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
              <button className="btn" onClick={doImport}><Icon name="download" size={14} /> Importa da file JSON…</button>
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
    </div>
  );
};

// ── Profilo & impostazioni ────────────────────────────────────────────────────
const Settings = ({ user, onSave, onResetData }) => {
  const [data, setData] = useState(user);
  const [tab, setTab] = useState("profile");
  const update = (patch) => setData(d => ({ ...d, ...patch }));

  const handleSave = () => {
    onSave(data);
    window.showToast && window.showToast(t('set.saved'), 'success');
  };

  return (
    <div className="content" style={{ maxWidth: 1000 }}>
      <div className="tab-nav">
        <button className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}>{t('set.profile')}</button>
        <button className={tab === "fiscal" ? "active" : ""} onClick={() => setTab("fiscal")}>{t('set.fiscal')}</button>
        <button className={tab === "branding" ? "active" : ""} onClick={() => setTab("branding")}>{t('set.branding')}</button>
        <button className={tab === "preferences" ? "active" : ""} onClick={() => setTab("preferences")}>{t('set.preferences')}</button>
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

      {tab === "data" && <DataBackupTab onResetData={onResetData} />}

      {tab !== "data" && (
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, alignItems: "center", marginTop: 20 }}>
          <button className="btn" onClick={() => setData(user)}>{t('action.cancel')}</button>
          <button className="btn btn-primary" onClick={handleSave}>
            <Icon name="check" size={14} /> {t('set.save')}
          </button>
        </div>
      )}
    </div>
  );
};

window.Settings = Settings;
