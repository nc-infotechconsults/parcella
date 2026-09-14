// ============ Fatture elettroniche ============
// Imported invoices are accounting truth: everything that came from the XML is
// rendered read-only (P1). Only the classification block is editable.
const InvoiceBadges = ({ inv }) => (
  <>
    {inv.reverseCharge && <span className="badge badge-warning badge-dot" title={t('inv.reverseCharge')}>{t('inv.reverseCharge')}</span>}
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
          <div className="kpi-label">{t('inv.kpiInvoiced')} {yearFilter}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ricavi)}</div>
          <div className="kpi-meta"><span>{active.length} {t('inv.activeInvoices')}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('inv.kpiCosts')}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.costiCompetenza)}</div>
          <div className="kpi-meta"><span>{passive.length} {t('inv.passiveInvoices')}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('inv.vatDebit')}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ivaDebito)}</div>
          <div className="kpi-meta"><span>{t('inv.ofWhichReverse')} {fmtEUR(fy.consuntivo.ivaReverse)}</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('inv.vatCredit')}</div>
          <div className="kpi-value tabular">{fmtEUR(fy.consuntivo.ivaCredito)}</div>
          <div className="kpi-meta"><span>{t('inv.balanceShort')} {fmtEUR(fy.consuntivo.ivaSaldo)}</span></div>
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
          <option value="all">{t('inv.allQuarters')}</option>
          {["Q1", "Q2", "Q3", "Q4"].map(q => <option key={q} value={q}>{q}</option>)}
        </select>
        <button className="btn btn-primary" onClick={onImport}>{t('inv.import')}</button>
      </div>

      {tab === "registers" ? (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>{t('inv.period')}</th>
                <th className="num">{t('inv.vatDebit')}</th>
                <th className="num">{t('inv.vatCredit')}</th>
                <th className="num">{t('inv.ofWhichReverse')}</th>
                <th className="num">{t('inv.balance')}</th>
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
                  <td colSpan={3}>{t('inv.total')}</td>
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

      {/* P1 is a visual promise, not only a code one: the immutable block gets a
          sunken background so it reads as a record, not a form. */}
      <div style={{ background: "var(--bg-sunken)", border: "1px solid var(--border)",
                    borderRadius: "var(--radius)", padding: 12 }}>
      <h3 className="section-title" style={{ marginTop: 0 }}>{t('inv.fromXml')}</h3>
      <table className="data">
        <tbody>
          <tr><td>{t('inv.date')}</td><td className="mono">{invoice.date}</td>
              <td>{t('inv.docType')}</td><td className="mono">{invoice.tipoDoc}</td></tr>
          <tr><td>{t('inv.taxable')}</td><td className="num mono">{fmtEUR(invoice.totals.imponibile)}</td>
              <td>{t('inv.vat')}</td><td className="num mono">{fmtEUR(invoice.totals.imposta)}</td></tr>
          {invoice.withholding && (
            <tr><td>{t('inv.withholdingRow')} {invoice.withholding.aliquota}%</td><td className="num mono">{fmtEUR(invoice.withholding.importo)}</td>
                <td>{t('inv.cassaRow')}</td><td className="num mono">{invoice.cassa ? fmtEUR(invoice.cassa.importo) : "—"}</td></tr>
          )}
        </tbody>
      </table>

      <table className="data" style={{ marginTop: 12 }}>
        <thead><tr><th>{t('inv.line')}</th><th className="num">{t('inv.vat')}</th><th className="num">{t('inv.taxable')}</th><th className="num">{t('inv.vat')}</th></tr></thead>
        <tbody>
          {invoice.lines.map(l => (
            <tr key={l.n}><td>{l.desc}</td><td className="num mono">{l.vatPct != null ? l.vatPct + "%" : l.natura}</td>
              <td className="num mono">{fmtEUR(l.total)}</td><td /></tr>
          ))}
          {invoice.vatSummary.map((v, i) => (
            <tr key={"r" + i} style={{ color: "var(--text-muted)" }}>
              <td>{t('inv.summaryRow')} {v.natura || ""}</td><td className="num mono">{v.vatPct}%</td>
              <td className="num mono">{fmtEUR(v.imponibile)}</td><td className="num mono">{fmtEUR(v.imposta)}</td></tr>
          ))}
        </tbody>
      </table>
      </div>

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
          <label>{t('inv.settlementDate')}</label>
          <input type="date" className="input mono" value={edit.settlement.date || ""}
            onChange={e => setEdit(x => ({ ...x, settlement: { ...x.settlement, date: e.target.value || null } }))} />
        </div>

        <div className="field full">
          <label>{t('inv.notes')}</label>
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
