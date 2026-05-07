// Dashboard view
const Dashboard = ({ clients, activities, currentMonthKey, onNav }) => {
  const monthActivities = activities.filter(a => a.monthKey === currentMonthKey);
  const totalHours = monthActivities.reduce((s, a) => s + a.hours, 0);

  // Compute revenue per client this month
  const clientStats = clients.map(c => {
    const acts = monthActivities.filter(a => a.clientId === c.id);
    const hours = acts.reduce((s, a) => s + a.hours, 0);
    const amounts = computeInvoiceAmounts(c, hours);
    return { client: c, hours, amounts, activitiesCount: acts.length };
  }).filter(s => s.hours > 0);

  const totalRevenue = clientStats.reduce((s, x) => s + x.amounts.imponibile + x.amounts.cassa, 0);
  const totalToInvoice = clientStats.reduce((s, x) => s + x.amounts.total, 0);
  const activeClients = clients.filter(c => c.status === "active").length;

  // Last 7 days of activity for sparkline
  const today = 6; // pretend today is May 6
  const last7 = Array.from({ length: 14 }, (_, i) => {
    const day = today - 13 + i;
    const dayHours = monthActivities.filter(a => a.day === day).reduce((s, a) => s + a.hours, 0);
    return { day, hours: dayHours };
  });
  const maxH = Math.max(...last7.map(d => d.hours), 8);

  return (
    <div className="content">
      <div className="kpi-grid">
        <div className="kpi">
          <div className="kpi-label">Ore questo mese</div>
          <div className="kpi-value tabular">{fmtNum(totalHours, 1)}</div>
          <div className="kpi-meta">
            <span className="kpi-trend up">↑ 12%</span>
            <span>vs aprile</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Imponibile maturato</div>
          <div className="kpi-value tabular">{fmtEUR(totalRevenue)}</div>
          <div className="kpi-meta">
            <span>compresa cassa 4%</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Da fatturare</div>
          <div className="kpi-value tabular">{fmtEUR(totalToInvoice)}</div>
          <div className="kpi-meta">
            <span>{clientStats.length} clienti attivi nel mese</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Clienti attivi</div>
          <div className="kpi-value tabular">{activeClients}</div>
          <div className="kpi-meta">
            <span>su {clients.length} totali</span>
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 24 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Ripartizione mensile per cliente</h3>
              <div className="subtitle">Maggio 2026 · ore e importo da fatturare</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => onNav("export")}>
              Genera fatture <Icon name="chevronRight" size={12} />
            </button>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Tariffa</th>
                <th className="num">Ore</th>
                <th className="num">Imponibile</th>
                <th className="num">Totale fattura</th>
              </tr>
            </thead>
            <tbody>
              {clientStats.map(s => (
                <tr key={s.client.id}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{s.client.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{s.activitiesCount} attività</div>
                  </td>
                  <td className="mono">{fmtEUR(s.client.hourlyRate)}/h</td>
                  <td className="num">{fmtNum(s.hours, 1)}</td>
                  <td className="num">{fmtEUR(s.amounts.imponibile + s.amounts.cassa)}</td>
                  <td className="num"><strong>{fmtEUR(s.amounts.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <div>
              <h3>Andamento ore</h3>
              <div className="subtitle">Ultime 2 settimane</div>
            </div>
          </div>
          <div className="card-body">
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 120, marginBottom: 12 }}>
              {last7.map((d, i) => (
                <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
                  <div style={{
                    width: "100%",
                    height: `${(d.hours / maxH) * 90}px`,
                    background: d.day === today ? "var(--accent)" : (d.hours > 0 ? "var(--accent-soft)" : "var(--bg-sunken)"),
                    borderRadius: "3px 3px 0 0",
                    minHeight: 2,
                  }} />
                  <div style={{ fontSize: 10, color: "var(--text-muted)" }}>{d.day > 0 ? d.day : ""}</div>
                </div>
              ))}
            </div>
            <div className="divider" style={{ margin: "12px 0" }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>Media giornaliera</span>
                <span className="mono" style={{ fontWeight: 500 }}>{fmtH(totalHours / 12)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>Picco</span>
                <span className="mono" style={{ fontWeight: 500 }}>{fmtH(Math.max(...last7.map(d => d.hours)))}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
                <span style={{ color: "var(--text-muted)" }}>Tariffa media</span>
                <span className="mono" style={{ fontWeight: 500 }}>
                  {fmtEUR(totalRevenue / (totalHours || 1))}/h
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 24 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <h3>Plafond contrattuali</h3>
              <div className="subtitle">Ore consumate vs ore previste da contratto</div>
            </div>
          </div>
          <div className="card-body" style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 24 }}>
            {clientStats.map(s => {
              const pct = s.client.hoursPlafond ? (s.hours / s.client.hoursPlafond) * 100 : 0;
              const fillClass = pct > 90 ? "danger" : pct > 70 ? "warn" : "";
              return (
                <div key={s.client.id} className="plafond">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 13.5, fontWeight: 500 }}>{s.client.name}</span>
                    <span className="badge">{s.client.commesse.length} commesse</span>
                  </div>
                  <div className="plafond-track">
                    <div className={"plafond-fill " + fillClass} style={{ width: Math.min(100, pct) + "%" }} />
                  </div>
                  <div className="plafond-meta">
                    <span>{fmtH(s.hours)} di {fmtH(s.client.hoursPlafond)} previste</span>
                    <span>{fmtNum(pct, 0)}%</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

window.Dashboard = Dashboard;
