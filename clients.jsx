// Clients list + detail + edit form
const ClientsList = ({ clients, activities, currentMonthKey, onSelect, onAddNew }) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");

  const filtered = clients
    .filter(c => filter === "all" || c.status === filter)
    .filter(c => !search || c.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="content">
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div className="filter-row">
          <div className="search-input">
            <Icon name="search" size={14} />
            <input
              className="input"
              placeholder={t('client.search')}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <button className={"chip " + (filter === "all" ? "active" : "")} onClick={() => setFilter("all")}>
            {t('client.all')} <span style={{ opacity: 0.6 }}>{clients.length}</span>
          </button>
          <button className={"chip " + (filter === "active" ? "active" : "")} onClick={() => setFilter("active")}>
            {t('client.active')} <span style={{ opacity: 0.6 }}>{clients.filter(c => c.status === "active").length}</span>
          </button>
          <button className={"chip " + (filter === "paused" ? "active" : "")} onClick={() => setFilter("paused")}>
            {t('status.paused')} <span style={{ opacity: 0.6 }}>{clients.filter(c => c.status === "paused").length}</span>
          </button>
        </div>
        <button className="btn btn-primary" onClick={onAddNew}>
          <Icon name="plus" size={14} /> {t('client.new')}
        </button>
      </div>

      <div className="card">
        {filtered.length === 0 ? (
          <div className="empty-state">
            <Icon name="users" size={32} />
            <div className="title">{t('client.noClients')}</div>
            <div>{t('client.noClientsHint')}</div>
          </div>
        ) : filtered.map(c => {
          const acts = activities.filter(a => a.clientId === c.id && a.monthKey === currentMonthKey);
          const hours = acts.reduce((s, a) => s + a.hours, 0);
          const amounts = computeInvoiceAmounts(c, hours);
          return (
            <div key={c.id} className="client-list-row" onClick={() => onSelect(c.id)}>
              <div className="client-name">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="name">{c.name}</span>
                  {c.status === "paused" && <span className="badge badge-warning badge-dot">{t('status.paused')}</span>}
                  {c.status === "active" && <span className="badge badge-success badge-dot">{t('status.active')}</span>}
                </div>
                <div className="meta">{c.piva} · {c.commesse.length} commesse · {c.contact}</div>
              </div>
              <div className="col">
                <div className="label">{t('client.rate')}</div>
                <div className="value">{fmtEUR(c.hourlyRate)}/h</div>
              </div>
              <div className="col">
                <div className="label">{t('client.plafond')}</div>
                <div className="value">{fmtH(c.hoursPlafond)}/mese</div>
              </div>
              <div className="col">
                <div className="label">{t('client.hoursMonth')}</div>
                <div className="value">{fmtH(hours)}</div>
              </div>
              <div className="col" style={{ minWidth: 130, textAlign: "right" }}>
                <div className="label">{t('client.toBill')}</div>
                <div className="value">{fmtEUR(amounts.total)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ── CommessaModal ─────────────────────────────────────────────────────────────
const COMMESSA_COLORS_CD = [
  "oklch(0.6 0.13 250)", "oklch(0.65 0.12 180)", "oklch(0.65 0.13 50)",
  "oklch(0.6 0.13 320)", "oklch(0.7 0.13 100)", "oklch(0.65 0.13 30)",
  "oklch(0.6 0.12 280)", "oklch(0.7 0.10 220)", "oklch(0.55 0.14 15)",
];

const CommessaModal = ({ open, client, onClose, onSave }) => {
  const [items, setItems] = useState([]);

  // Sync when client changes or modal opens
  useEffect(() => {
    if (open && client) setItems((client.commesse || []).map(c => ({ ...c })));
  }, [open, client]);

  if (!open || !client) return null;

  const addItem = () => {
    const color = COMMESSA_COLORS_CD[items.length % COMMESSA_COLORS_CD.length];
    setItems(prev => [...prev, { code: "", name: "", color, status: "active", startDate: "", notes: "" }]);
  };

  const updItem = (i, patch) => setItems(prev => prev.map((c, j) => j === i ? { ...c, ...patch } : c));

  const rmItem = (i) => setItems(prev => prev.filter((_, j) => j !== i));

  const cycleColor = (i) => {
    const idx = COMMESSA_COLORS_CD.indexOf(items[i].color);
    updItem(i, { color: COMMESSA_COLORS_CD[(idx + 1) % COMMESSA_COLORS_CD.length] });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-lg" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h2>Commesse — {client.name}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><Icon name="close" size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {items.length} commesse · le commesse "chiuse" non appaiono nei nuovi inserimenti
            </div>
            <button className="btn btn-sm btn-primary" onClick={addItem}>
              <Icon name="plus" size={12} /> Nuova commessa
            </button>
          </div>

          {items.length === 0 ? (
            <div className="empty-state">
              <Icon name="grid" size={28} />
              <div className="title">Nessuna commessa</div>
              <div>Aggiungine una per poter registrare attività su questo cliente.</div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {items.map((co, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "22px 1fr 1.4fr 110px 1fr auto",
                  gap: 8, alignItems: "center",
                  padding: "10px 12px",
                  background: co.status === "closed" ? "var(--bg-sunken)" : "var(--bg-elevated)",
                  borderRadius: "var(--radius-sm)",
                  border: "1px solid var(--border)",
                  opacity: co.status === "closed" ? 0.7 : 1,
                }}>
                  <div
                    title="Clicca per cambiare colore"
                    style={{ width: 22, height: 22, borderRadius: 5, background: co.color, cursor: "pointer", border: "1.5px solid rgba(0,0,0,0.12)" }}
                    onClick={() => cycleColor(i)}
                  />
                  <input
                    className="input mono" style={{ fontSize: 12 }}
                    placeholder="Codice (es. ACM-01)"
                    value={co.code}
                    onChange={e => updItem(i, { code: e.target.value })}
                  />
                  <input
                    className="input"
                    placeholder="Descrizione"
                    value={co.name}
                    onChange={e => updItem(i, { name: e.target.value })}
                  />
                  <select
                    className="select"
                    value={co.status || "active"}
                    onChange={e => updItem(i, { status: e.target.value })}
                  >
                    <option value="active">Attiva</option>
                    <option value="closed">Chiusa</option>
                  </select>
                  <input
                    className="input"
                    placeholder="Note (opzionale)"
                    value={co.notes || ""}
                    onChange={e => updItem(i, { notes: e.target.value })}
                  />
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => rmItem(i)}>
                    <Icon name="trash" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Annulla</button>
          <button className="btn btn-primary" onClick={() => { onSave(items); onClose(); }}>
            <Icon name="check" size={14} /> Salva commesse
          </button>
        </div>
      </div>
    </div>
  );
};

window.CommessaModal = CommessaModal;

// ── ClientDetail ───────────────────────────────────────────────────────────────
const ClientDetail = ({ client, activities, currentMonthKey, onEdit, onBack, onDelete, onSaveCommesse }) => {
  const [tab, setTab] = useState("overview");
  const [commessaModalOpen, setCommessaModalOpen] = useState(false);
  const acts = activities.filter(a => a.clientId === client.id && a.monthKey === currentMonthKey);
  const allActs = [...activities.filter(a => a.clientId === client.id)]
    .sort((a, b) => b.monthKey.localeCompare(a.monthKey) || b.day - a.day);
  const hours = acts.reduce((s, a) => s + a.hours, 0);
  const amounts = computeInvoiceAmounts(client, hours);

  return (
    <div className="content">
      <button className="btn btn-ghost btn-sm" onClick={onBack} style={{ marginBottom: 16 }}>
        <Icon name="chevronLeft" size={12} /> Tutti i clienti
      </button>

      <div className="detail-header">
        <div className="info">
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <h2>{client.name}</h2>
            {client.status === "active" && <span className="badge badge-success badge-dot">Attivo</span>}
            {client.status === "paused" && <span className="badge badge-warning badge-dot">In pausa</span>}
          </div>
          <div className="id">{client.piva} · {client.address}</div>
          <div className="text-sm text-muted" style={{ marginTop: 4 }}>
            Referente: <strong style={{ color: "var(--text)" }}>{client.contact}</strong> · {client.email}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {client.email && (
            <a className="btn btn-ghost btn-sm" href={"mailto:" + client.email}>
              <Icon name="mail" size={14} /> Contatta
            </a>
          )}
          <button className="btn btn-primary btn-sm" onClick={onEdit}>
            <Icon name="edit" size={14} /> {t('action.edit')}
          </button>
          <button className="btn btn-danger btn-sm" onClick={() => {
            if (confirm(t('client.deleteConfirm', { name: client.name }))) {
              onDelete(client.id);
            }
          }}>
            <Icon name="trash" size={14} /> {t('action.delete')}
          </button>
        </div>
      </div>

      <div className="tab-nav">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>{t('cd.overview')}</button>
        <button className={tab === "contract" ? "active" : ""} onClick={() => setTab("contract")}>{t('cd.contract')}</button>
        <button className={tab === "commesse" ? "active" : ""} onClick={() => setTab("commesse")}>{t('cd.commesse')}</button>
        <button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}>{t('cd.history')}</button>
      </div>

      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div className="card">
            <div className="card-header"><h3>Mese in corso · maggio 2026</h3></div>
            <div className="card-body">
              <div className="info-grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
                <div className="info-cell">
                  <div className="label">Ore registrate</div>
                  <div className="value">{fmtH(hours)}</div>
                </div>
                <div className="info-cell">
                  <div className="label">Ore residue</div>
                  <div className="value">{fmtH(Math.max(0, client.hoursPlafond - hours))}</div>
                </div>
                <div className="info-cell">
                  <div className="label">Imponibile</div>
                  <div className="value">{fmtEUR(amounts.imponibile)}</div>
                </div>
                <div className="info-cell">
                  <div className="label">Totale fattura</div>
                  <div className="value">{fmtEUR(amounts.total)}</div>
                </div>
              </div>
              <div className="divider" />
              <div className="plafond">
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 4 }}>Utilizzo plafond mensile</div>
                <div className="plafond-track">
                  <div className="plafond-fill" style={{ width: Math.min(100, (hours / client.hoursPlafond) * 100) + "%" }} />
                </div>
                <div className="plafond-meta">
                  <span>{fmtH(hours)} consumate</span>
                  <span>{fmtH(client.hoursPlafond)} previste</span>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><h3>Note operative</h3></div>
            <div className="card-body" style={{ fontSize: 13.5, lineHeight: 1.6 }}>
              {client.notes ? <p style={{ margin: 0 }}>{client.notes}</p> : <p className="text-muted" style={{ margin: 0 }}>Nessuna nota.</p>}
            </div>
          </div>
        </div>
      )}

      {tab === "contract" && (
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Condizioni economiche</h3>
              <div className="subtitle">Valori applicati al calcolo automatico delle fatture</div>
            </div>
          </div>
          <div className="card-body">
            <div className="info-grid">
              <div className="info-cell">
                <div className="label">Tariffa oraria</div>
                <div className="value mono">{fmtEUR(client.hourlyRate)} /h</div>
              </div>
              <div className="info-cell">
                <div className="label">Ore plafond mensile</div>
                <div className="value mono">{fmtH(client.hoursPlafond)}</div>
              </div>
              <div className="info-cell">
                <div className="label">Cassa previdenza</div>
                <div className="value mono">{client.cassaPct}% {client.cassaIncluded ? "(inclusa)" : "(in fattura)"}</div>
              </div>
              <div className="info-cell">
                <div className="label">IVA</div>
                <div className="value mono">{client.vatPct === 0 ? "Esente" : `${client.vatPct}%`}</div>
              </div>
              <div className="info-cell">
                <div className="label">Ritenuta acconto</div>
                <div className="value mono">{client.withholding ? "20%" : "Non applicata"}</div>
              </div>
              <div className="info-cell">
                <div className="label">Termini pagamento</div>
                <div className="value mono">{client.paymentDays} gg DF FM</div>
              </div>
              <div className="info-cell">
                <div className="label">Inizio contratto</div>
                <div className="value mono">{client.contractStart}</div>
              </div>
              <div className="info-cell">
                <div className="label">Scadenza contratto</div>
                <div className="value mono">{client.contractEnd || "—"}</div>
              </div>
            </div>

            <div className="divider" />

            <h4 style={{ margin: "0 0 12px", fontSize: 13, fontWeight: 600 }}>Esempio di calcolo · 10 ore</h4>
            <div className="calc-summary" style={{ maxWidth: 380 }}>
              {(() => {
                const ex = computeInvoiceAmounts(client, 10);
                return (<>
                  <div className="calc-row"><span className="label">Imponibile (10h × {fmtEUR(client.hourlyRate)})</span><span>{fmtEUR(ex.imponibile)}</span></div>
                  {!client.cassaIncluded && (
                    <div className="calc-row"><span className="label">Cassa {client.cassaPct}%</span><span>{fmtEUR(ex.cassa)}</span></div>
                  )}
                  <div className="calc-row"><span className="label">IVA {client.vatPct}%</span><span>{fmtEUR(ex.iva)}</span></div>
                  {client.withholding && (
                    <div className="calc-row"><span className="label">Ritenuta acconto 20%</span><span>−{fmtEUR(ex.withholding)}</span></div>
                  )}
                  <div className="calc-row total"><span className="label">Totale fattura</span><span>{fmtEUR(ex.total)}</span></div>
                </>);
              })()}
            </div>
          </div>
        </div>
      )}

      {tab === "commesse" && (
        <>
          <div className="card">
            <div className="card-header">
              <div>
                <h3>Commesse</h3>
                <div className="subtitle">{client.commesse.filter(c => c.status !== "closed").length} attive · {client.commesse.filter(c => c.status === "closed").length} chiuse</div>
              </div>
              <button className="btn btn-sm btn-primary" onClick={() => setCommessaModalOpen(true)}>
                <Icon name="edit" size={12} /> Gestisci commesse
              </button>
            </div>
            <table className="data">
              <thead>
                <tr>
                  <th>Codice</th>
                  <th>Descrizione</th>
                  <th>Stato</th>
                  <th className="num">Ore mese</th>
                  <th className="num">Ore totali</th>
                  <th className="num">Importo mese</th>
                </tr>
              </thead>
              <tbody>
                {client.commesse.length === 0 ? (
                  <tr><td colSpan={6}>
                    <div className="empty-state">
                      <div className="title">Nessuna commessa</div>
                      <div>Clicca "Gestisci commesse" per aggiungerne.</div>
                    </div>
                  </td></tr>
                ) : client.commesse.map(co => {
                  const cActs = acts.filter(a => a.commessa === co.code);
                  const cHours = cActs.reduce((s, a) => s + a.hours, 0);
                  const allCoActs = activities.filter(a => a.clientId === client.id && a.commessa === co.code);
                  const allCoHours = allCoActs.reduce((s, a) => s + a.hours, 0);
                  return (
                    <tr key={co.code} style={{ opacity: co.status === "closed" ? 0.55 : 1 }}>
                      <td>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ width: 8, height: 8, borderRadius: 2, background: co.color }} />
                          <span className="mono" style={{ fontSize: 12 }}>{co.code}</span>
                        </div>
                      </td>
                      <td>{co.name}</td>
                      <td>
                        <span className={"badge " + (co.status === "closed" ? "" : "badge-success badge-dot")}>
                          {co.status === "closed" ? "Chiusa" : "Attiva"}
                        </span>
                      </td>
                      <td className="num">{fmtH(cHours)}</td>
                      <td className="num" style={{ color: "var(--text-muted)" }}>{fmtH(allCoHours)}</td>
                      <td className="num">{fmtEUR(cHours * client.hourlyRate)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <CommessaModal
            open={commessaModalOpen}
            client={client}
            onClose={() => setCommessaModalOpen(false)}
            onSave={(updatedCommesse) => {
              onSaveCommesse && onSaveCommesse(client.id, updatedCommesse);
            }}
          />
        </>
      )}

      {tab === "history" && (
        <div className="card">
          <div className="card-header">
            <h3>Storico attività</h3>
            <div className="subtitle">{allActs.length} voci totali · {fmtH(allActs.reduce((s, a) => s + a.hours, 0))} ore</div>
          </div>
          <div style={{ padding: "0 20px" }}>
            {allActs.length === 0 ? (
              <div className="empty-state">Nessuna attività registrata per questo cliente.</div>
            ) : (
              <div className="activity-list">
                {allActs.map(a => {
                  const co = client.commesse.find(c => c.code === a.commessa);
                  const [y, m] = a.monthKey.split("-");
                  const mIdx = +m - 1;
                  return (
                    <div key={a.id} className="activity-row">
                      <div className="time">{String(a.day).padStart(2, "0")} {MONTHS_IT[mIdx].slice(0, 3).toLowerCase()} {y}</div>
                      <div className="desc">
                        <div>{a.desc}</div>
                        <div className="commessa">
                          <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 1, background: co?.color, marginRight: 6, verticalAlign: "middle" }} />
                          {a.commessa}{co?.name ? " · " + co.name : ""}
                        </div>
                      </div>
                      <div className="hours">{fmtH(a.hours)}</div>
                      <div className="amount">{fmtEUR(a.hours * client.hourlyRate)}</div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

window.ClientsList = ClientsList;
window.ClientDetail = ClientDetail;
