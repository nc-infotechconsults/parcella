// ============ Spese — fiscally complete ============
// Each expense has:
//   billable: true → for client (recovered)
//   billable: false → studio cost
//     vatExempt: true → no IVA detracted
//     deductPct: 0-100 → IRPEF deductible portion (es. 80% telefono, 20% auto, 75% pasti)
//     amortize: true + amortYears → cespite (>= 516.46€ rule)

const CATEGORY_RULES = {
  "Trasferta": { deductPct: 100, vatPct: 10, vatExempt: false },
  "Pasti": { deductPct: 75, vatPct: 10, vatExempt: false, hint: "Pasti deducibili 75% (art. 109 TUIR)" },
  "Pernottamento": { deductPct: 75, vatPct: 10, vatExempt: false },
  "Software": { deductPct: 100, vatPct: 22, vatExempt: false },
  "Stock photo": { deductPct: 100, vatPct: 22, vatExempt: false },
  "Cancelleria": { deductPct: 100, vatPct: 22, vatExempt: false },
  "Formazione": { deductPct: 100, vatPct: 22, vatExempt: false },
  "Telefonia": { deductPct: 80, vatPct: 22, vatExempt: false, hint: "Telefonia deducibile 80% (art. 102 TUIR)" },
  "Auto": { deductPct: 20, vatPct: 22, vatExempt: false, hint: "Auto non strumentale: deducibilità 20%" },
  "Rimborso km": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Rimborso chilometrico al tasso ACI (fuori campo IVA). Importo = km × tariffa ACI vigente." },
  "Hardware": { deductPct: 100, vatPct: 22, vatExempt: false, hint: "Cespite > 516,46€ → ammortamento pluriennale" },
  "Assicurazioni": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Assicurazioni esenti IVA art. 10 DPR 633/72" },
  "Bolli/Tasse": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Operazioni fuori campo IVA" },
  "Altro": { deductPct: 100, vatPct: 22, vatExempt: false },
};
const AMORTIZE_THRESHOLD = 516.46;

// Computes fiscal breakdown for a single expense
function computeExpenseFiscals(e) {
  const gross = e.amount;
  const net = e.vatExempt ? gross : gross / (1 + (e.vatPct || 0) / 100);
  const vat = gross - net;
  const vatDetracted = e.billable
    ? vat   // billable: full VAT recovered via fattura cliente
    : (e.vatExempt ? 0 : vat * Math.min(e.deductPct, 100) / 100);
  const yearlyDeducted = e.amortize
    ? (net * e.deductPct / 100) / (e.amortYears || 4)
    : net * e.deductPct / 100;
  const inAmortization = e.amortize === true || (!e.billable && net > AMORTIZE_THRESHOLD && (e.category === "Hardware" || e.category === "Auto"));
  return {
    gross,
    net,
    vat,
    vatDetracted,
    yearlyDeducted,
    inAmortization,
    nonDeductible: net - (net * e.deductPct / 100),
  };
}
window.computeExpenseFiscals = computeExpenseFiscals;
window.CATEGORY_RULES = CATEGORY_RULES;
window.AMORTIZE_THRESHOLD = AMORTIZE_THRESHOLD;

const Expenses = ({ clients, expenses, currentMonthKey, onAdd, onEdit, onDelete }) => {
  const [tab, setTab] = useState("billable");
  const [filterClient, setFilterClient] = useState("all");

  const monthExp = expenses.filter(e => e.monthKey === currentMonthKey);
  const billable = monthExp.filter(e => e.billable);
  const own = monthExp.filter(e => !e.billable);
  const list = tab === "billable" ? billable : own;
  const filtered = tab === "billable" && filterClient !== "all"
    ? list.filter(e => e.clientId === filterClient)
    : list;

  const totalBillable = billable.reduce((s, e) => s + e.amount, 0);
  const totalOwn = own.reduce((s, e) => s + e.amount, 0);

  // Deductible / IVA totals for studio expenses
  const ownFiscals = own.map(e => ({ e, f: computeExpenseFiscals(e) }));
  const totalIvaDetracted = ownFiscals.reduce((s, x) => s + x.f.vatDetracted, 0);
  const totalDeducted = ownFiscals.reduce((s, x) => s + x.f.yearlyDeducted, 0);
  const totalAmortized = ownFiscals.filter(x => x.f.inAmortization).reduce((s, x) => s + x.e.amount, 0);

  // Group billable by client for summary
  const byClient = {};
  billable.forEach(e => {
    if (!byClient[e.clientId]) byClient[e.clientId] = { count: 0, amount: 0 };
    byClient[e.clientId].count++;
    byClient[e.clientId].amount += e.amount;
  });

  return (
    <div className="content">
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi">
          <div className="kpi-label">Spese rimborsabili</div>
          <div className="kpi-value tabular">{fmtEUR(totalBillable)}</div>
          <div className="kpi-meta"><span>{billable.length} voci · {Object.keys(byClient).length} clienti</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Spese di studio</div>
          <div className="kpi-value tabular">{fmtEUR(totalOwn)}</div>
          <div className="kpi-meta"><span>{own.length} voci registrate</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">IVA detraibile</div>
          <div className="kpi-value tabular">{fmtEUR(totalIvaDetracted)}</div>
          <div className="kpi-meta"><span className="kpi-trend up">su acquisti studio</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Costi deducibili (anno)</div>
          <div className="kpi-value tabular">{fmtEUR(totalDeducted)}</div>
          <div className="kpi-meta">
            {totalAmortized > 0
              ? <span>di cui {fmtEUR(totalAmortized)} in ammortamento</span>
              : <span>tutto deducibile esercizio</span>}
          </div>
        </div>
      </div>

      <div className="tab-nav">
        <button className={tab === "billable" ? "active" : ""} onClick={() => setTab("billable")}>
          Per conto del cliente <span className="badge" style={{ marginLeft: 8 }}>{billable.length}</span>
        </button>
        <button className={tab === "own" ? "active" : ""} onClick={() => setTab("own")}>
          Per conto proprio <span className="badge" style={{ marginLeft: 8 }}>{own.length}</span>
        </button>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <div className="filter-row">
          {tab === "billable" && (
            <>
              <button className={"chip " + (filterClient === "all" ? "active" : "")} onClick={() => setFilterClient("all")}>
                Tutti i clienti
              </button>
              {clients.filter(c => byClient[c.id]).map(c => (
                <button key={c.id} className={"chip " + (filterClient === c.id ? "active" : "")} onClick={() => setFilterClient(c.id)}>
                  {c.shortName} <span style={{ opacity: 0.6 }}>{fmtEUR(byClient[c.id].amount)}</span>
                </button>
              ))}
            </>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => onAdd(tab === "billable")}>
          <Icon name="plus" size={14} /> Nuova spesa
        </button>
      </div>

      <div className="card">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Data</th>
              <th style={{ width: 110 }}>Categoria</th>
              {tab === "billable" && <th>Cliente</th>}
              <th>Descrizione</th>
              <th className="num" style={{ width: 60 }}>IVA</th>
              <th className="num" style={{ width: 90 }}>Imponibile</th>
              {tab === "own" && <th className="num" style={{ width: 70 }}>Ded. %</th>}
              {tab === "own" && <th style={{ width: 90 }}>Trattamento</th>}
              <th className="num" style={{ width: 90 }}>Lordo</th>
              <th style={{ width: 40 }}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={tab === "billable" ? 8 : 9}>
                <div className="empty-state">
                  <Icon name="euro" size={28} />
                  <div className="title">Nessuna spesa registrata</div>
                  <div>Clicca "Nuova spesa" per iniziare.</div>
                </div>
              </td></tr>
            ) : [...filtered].sort((a, b) => b.day - a.day).map(e => {
              const c = e.clientId ? clients.find(x => x.id === e.clientId) : null;
              const f = computeExpenseFiscals(e);
              return (
                <tr key={e.id} onClick={() => onEdit(e)} style={{ cursor: "pointer" }}>
                  <td className="mono">
                    <div style={{ fontWeight: 600 }}>{String(e.day).padStart(2, "0")} mag</div>
                    <div style={{ fontSize: 10.5, color: "var(--text-muted)" }}>{e.paymentMethod || "—"}</div>
                  </td>
                  <td>
                    <span className="badge">{e.category}</span>
                    {!e.hasReceipt && <div style={{ fontSize: 10, color: "var(--warning)", marginTop: 2 }}>⚠ ricevuta</div>}
                  </td>
                  {tab === "billable" && (
                    <td><strong>{c?.shortName || "—"}</strong></td>
                  )}
                  <td style={{ color: "var(--text-secondary)" }}>{e.desc}</td>
                  <td className="num mono">
                    {e.vatExempt
                      ? <span className="badge badge-warning" style={{ fontSize: 9 }}>esente</span>
                      : <span>{e.vatPct}%</span>}
                  </td>
                  <td className="num mono">{fmtEUR(f.net)}</td>
                  {tab === "own" && (
                    <td className="num mono">
                      {e.deductPct === 100
                        ? <span style={{ color: "var(--success)" }}>100%</span>
                        : e.deductPct === 0
                          ? <span style={{ color: "var(--text-muted)" }}>0%</span>
                          : <span style={{ color: "var(--warning)" }}>{e.deductPct}%</span>}
                    </td>
                  )}
                  {tab === "own" && (
                    <td>
                      {f.inAmortization
                        ? <span className="badge badge-warning badge-dot" title={`Ammortamento ${e.amortYears || 4} anni`}>cespite {e.amortYears || 4}y</span>
                        : <span className="badge badge-success badge-dot">esercizio</span>}
                    </td>
                  )}
                  <td className="num"><strong>{fmtEUR(e.amount)}</strong></td>
                  <td>
                    <button className="btn btn-ghost btn-sm btn-icon" onClick={ev => { ev.stopPropagation(); onDelete(e.id); }}>
                      <Icon name="trash" size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ background: "var(--bg-sunken)", fontWeight: 700 }}>
                <td colSpan={tab === "billable" ? 6 : 7}>Totale</td>
                {tab === "own" && <td></td>}
                <td className="num">{fmtEUR(filtered.reduce((s, e) => s + e.amount, 0))}</td>
                <td></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {tab === "billable" ? (
        <div style={{ marginTop: 20, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          <strong style={{ color: "var(--text)" }}>Nota:</strong> le spese rimborsabili vengono incluse automaticamente nel rapporto del cliente come voce separata dopo le ore di prestazione. L'IVA viene scaricata in fattura.
        </div>
      ) : (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card-header">
            <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Riepilogo fiscale del mese</h4>
          </div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 24, fontSize: 12.5 }}>
            <div>
              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Totale lordo uscite</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtEUR(totalOwn)}</div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>IVA detraibile (a credito)</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--success)" }}>{fmtEUR(totalIvaDetracted)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>scarica IVA a debito del trimestre</div>
            </div>
            <div>
              <div style={{ color: "var(--text-muted)", marginBottom: 4 }}>Costo deducibile IRPEF (anno)</div>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--success)" }}>{fmtEUR(totalDeducted)}</div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>cespiti rateizzati su più esercizi</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ExpenseForm = ({ expense, defaultBillable, clients, onSave, onCancel, onDelete, currentYear, currentMonth }) => {
  const isNew = !expense;
  const cYear = currentYear || new Date().getFullYear();
  const cMonth = currentMonth !== undefined ? currentMonth : new Date().getMonth();
  const mKey = monthKey(cYear, cMonth);
  const today = new Date();
  const defaultDay = (cYear === today.getFullYear() && cMonth === today.getMonth()) ? today.getDate() : 1;
  const monthShort = MONTHS_IT[cMonth].slice(0, 3).toLowerCase();
  const yearShort = String(cYear).slice(2);
  const dim = daysInMonth(cYear, cMonth);

  const [data, setData] = useState(expense || {
    id: "exp" + Date.now(),
    clientId: defaultBillable ? clients[0].id : null,
    day: defaultDay,
    monthKey: mKey,
    category: "Trasferta",
    desc: "",
    amount: 0,
    billable: defaultBillable,
    vatExempt: false,
    vatPct: 22,
    deductPct: 100,
    amortize: false,
    amortYears: 4,
    paymentMethod: "Carta",
    hasReceipt: true,
  });
  const update = (patch) => setData(d => ({ ...d, ...patch }));

  // Apply category rules when category changes
  const applyCategory = (cat) => {
    const rule = CATEGORY_RULES[cat] || {};
    const shouldAmortize = !data.billable && (cat === "Hardware" || cat === "Auto") && data.amount > AMORTIZE_THRESHOLD * (1 + (rule.vatPct || 0) / 100);
    update({
      category: cat,
      vatPct: rule.vatPct ?? data.vatPct,
      vatExempt: rule.vatExempt ?? false,
      deductPct: data.billable ? 100 : (rule.deductPct ?? 100),
      amortize: data.billable ? false : (data.amortize || shouldAmortize),
    });
  };

  const f = computeExpenseFiscals(data);
  const exceedsThreshold = !data.billable && f.net > AMORTIZE_THRESHOLD;
  const rule = CATEGORY_RULES[data.category];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 4, padding: 3, background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)" }}>
        <button
          className={"export-tab " + (data.billable ? "active" : "")}
          style={{ flex: 1 }}
          onClick={() => update({ billable: true, clientId: data.clientId || clients[0].id, deductPct: 100, amortize: false })}
        >
          Per conto del cliente
        </button>
        <button
          className={"export-tab " + (!data.billable ? "active" : "")}
          style={{ flex: 1 }}
          onClick={() => update({ billable: false, clientId: null })}
        >
          Per conto proprio (studio)
        </button>
      </div>

      <div className="form-grid">
        {data.billable && (
          <div className="field full">
            <label>Cliente</label>
            <select className="select" value={data.clientId || ""} onChange={e => update({ clientId: e.target.value })}>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="field">
          <label>Categoria</label>
          <select className="select" value={data.category} onChange={e => applyCategory(e.target.value)}>
            {Object.keys(CATEGORY_RULES).map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {rule?.hint && (
            <div className="hint" style={{ color: "var(--accent)" }}>ⓘ {rule.hint}</div>
          )}
        </div>
        <div className="field">
          <label>Giorno</label>
          <div className="input-group">
            <div className="addon left">{monthShort} '{yearShort}</div>
            <input type="number" className="input mono" min="1" max={dim} value={data.day} onChange={e => update({ day: Math.min(dim, Math.max(1, +e.target.value)) })} />
          </div>
        </div>
        <div className="field full">
          <label>Descrizione</label>
          <input className="input" value={data.desc} onChange={e => update({ desc: e.target.value })} placeholder="Es. Treno A/R Milano-Bologna" />
        </div>
        <div className="field">
          <label>Importo (lordo)</label>
          <div className="input-group">
            <input type="number" step="0.01" className="input mono" value={data.amount} onChange={e => update({ amount: +e.target.value })} />
            <div className="addon">€</div>
          </div>
        </div>
        <div className="field">
          <label>Metodo pagamento</label>
          <select className="select" value={data.paymentMethod} onChange={e => update({ paymentMethod: e.target.value })}>
            <option>Carta</option>
            <option>Bonifico</option>
            <option>Contanti</option>
            <option>Assegno</option>
            <option>Bancomat</option>
          </select>
        </div>

        {/* IVA section */}
        <div className="field full" style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
          <label className="checkbox-row" style={{ marginBottom: 8 }}>
            <input type="checkbox" checked={data.vatExempt} onChange={e => update({ vatExempt: e.target.checked, vatPct: e.target.checked ? 0 : 22 })} />
            <span><strong>IVA esente</strong> <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>— operazione fuori campo / esente (es. art. 10 DPR 633/72, marche da bollo, assicurazioni)</span></span>
          </label>
        </div>
        {!data.vatExempt && (
          <div className="field">
            <label>Aliquota IVA</label>
            <select className="select" value={data.vatPct} onChange={e => update({ vatPct: +e.target.value })}>
              <option value={22}>22% — ordinaria</option>
              <option value={10}>10% — ridotta</option>
              <option value={5}>5% — super ridotta</option>
              <option value={4}>4% — minima</option>
              <option value={0}>0% — non imponibile</option>
            </select>
          </div>
        )}

        {/* Studio-only fields: deductibility + amortization */}
        {!data.billable && (
          <>
            <div className="field full" style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
              <label>Percentuale di deducibilità IRPEF</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {[100, 80, 75, 50, 20, 0].map(p => (
                  <button
                    key={p}
                    type="button"
                    className={"chip " + (data.deductPct === p ? "active" : "")}
                    onClick={() => update({ deductPct: p })}
                  >{p}%</button>
                ))}
                <div className="input-group" style={{ width: 100 }}>
                  <input type="number" className="input mono" min="0" max="100" value={data.deductPct} onChange={e => update({ deductPct: Math.min(100, Math.max(0, +e.target.value)) })} />
                  <div className="addon">%</div>
                </div>
              </div>
              <div className="hint">Quanto puoi dedurre dal reddito imponibile (es. 80% telefonia, 75% pasti, 20% auto privata)</div>
            </div>

            {exceedsThreshold && (
              <div className="field full">
                <div style={{
                  background: "oklch(0.96 0.04 80)",
                  border: "1px solid oklch(0.85 0.10 80)",
                  borderRadius: "var(--radius-sm)",
                  padding: "12px 14px",
                  fontSize: 12.5,
                  color: "#78350f",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>⚠ Importo superiore a {fmtEUR(AMORTIZE_THRESHOLD)} netto</div>
                  <label className="checkbox-row" style={{ color: "#78350f", marginBottom: 8 }}>
                    <input type="checkbox" checked={data.amortize} onChange={e => update({ amortize: e.target.checked })} />
                    Trattare come <strong>cespite ammortizzabile</strong> (deducibilità ripartita su più esercizi)
                  </label>
                  {data.amortize && (
                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8 }}>
                      <span>Anni di ammortamento:</span>
                      <select className="select" style={{ width: 100 }} value={data.amortYears} onChange={e => update({ amortYears: +e.target.value })}>
                        <option value={3}>3 anni</option>
                        <option value={4}>4 anni</option>
                        <option value={5}>5 anni</option>
                        <option value={7}>7 anni</option>
                        <option value={10}>10 anni</option>
                      </select>
                      <span style={{ color: "#92400e", fontFamily: "var(--font-mono)" }}>
                        → quota annua {fmtEUR(f.yearlyDeducted)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        <div className="field full">
          <label className="checkbox-row">
            <input type="checkbox" checked={data.hasReceipt} onChange={e => update({ hasReceipt: e.target.checked })} />
            Ho conservato la ricevuta / fattura
          </label>
        </div>
      </div>

      {/* Live fiscal breakdown */}
      <div style={{ background: "var(--bg-sunken)", padding: "12px 14px", borderRadius: "var(--radius-sm)", fontSize: 12 }}>
        <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)" }}>Calcolo fiscale</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-muted)" }}>Imponibile</span><span>{fmtEUR(f.net)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-muted)" }}>IVA {data.vatExempt ? "esente" : `${data.vatPct}%`}</span><span>{fmtEUR(f.vat)}</span></div>
          {!data.billable && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "var(--text-muted)" }}>IVA detraibile</span><span style={{ color: "var(--success)" }}>{fmtEUR(f.vatDetracted)}</span></div>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ color: "var(--text-muted)" }}>{data.amortize ? "Quota deducibile annua" : "Costo deducibile"}</span>
                <span style={{ color: "var(--success)" }}>{fmtEUR(f.yearlyDeducted)}</span>
              </div>
              {f.nonDeductible > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gridColumn: "span 2" }}>
                  <span style={{ color: "var(--text-muted)" }}>Quota non deducibile</span>
                  <span style={{ color: "var(--text-secondary)" }}>{fmtEUR(f.nonDeductible)}</span>
                </div>
              )}
            </>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", gridColumn: "span 2", paddingTop: 6, borderTop: "1px solid var(--border)", fontWeight: 600 }}>
            <span>Totale lordo</span><span>{fmtEUR(f.gross)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
        {!isNew ? (
          <button className="btn btn-danger btn-sm" onClick={() => onDelete(data.id)}>
            <Icon name="trash" size={12} /> Elimina
          </button>
        ) : <span />}
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={onCancel}>Annulla</button>
          <button className="btn btn-primary" onClick={() => onSave(data)}>
            <Icon name="check" size={14} /> {isNew ? "Registra spesa" : "Salva"}
          </button>
        </div>
      </div>
    </div>
  );
};

window.Expenses = Expenses;
window.ExpenseForm = ExpenseForm;
