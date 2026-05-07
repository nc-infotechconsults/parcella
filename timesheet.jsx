// Timesheet view - monthly grid with clients × commesse as rows, days as columns
// Generate and download a CSV of monthly activities
function downloadTimesheetCSV(acts, clients, year, month) {
  const rows = [
    ["Data", "Cliente", "P.IVA", "Commessa", "Descrizione", "Ore", "Tariffa (€/h)", "Importo (€)"],
    ...acts.sort((a, b) => a.day - b.day).map(a => {
      const c = clients.find(x => x.id === a.clientId);
      return [
        `${String(a.day).padStart(2,"0")}/${String(month+1).padStart(2,"0")}/${year}`,
        c ? c.name : a.clientId,
        c ? c.piva : "",
        a.commessa,
        a.desc,
        a.hours,
        c ? c.hourlyRate : "",
        c ? (a.hours * c.hourlyRate).toFixed(2) : "",
      ];
    }),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `timesheet_${year}_${String(month+1).padStart(2,"0")}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

const Timesheet = ({ clients, activities, currentYear, currentMonth, onNavMonth, onAddActivity, onEditActivity, onDeleteActivities }) => {
  const [filterClient, setFilterClient] = useState("all");
  const [drag, setDrag] = useState(null); // { clientId, commessa, startDay, currentDay }
  const [selected, setSelected] = useState(new Set());
  const todayDate = new Date();
  const today = (currentYear === todayDate.getFullYear() && currentMonth === todayDate.getMonth())
    ? todayDate.getDate() : -1;

  useEffect(() => {
    const commitDrag = () => {
      if (drag) {
        const day = Math.min(drag.startDay, drag.currentDay);
        const dayEnd = Math.max(drag.startDay, drag.currentDay);
        onAddActivity({ clientId: drag.clientId, commessa: drag.commessa, day, dayEnd });
        setDrag(null);
      }
    };
    window.addEventListener('mouseup', commitDrag);
    return () => window.removeEventListener('mouseup', commitDrag);
  }, [drag]);

  const mKey = monthKey(currentYear, currentMonth);
  useEffect(() => { setSelected(new Set()); }, [mKey]);

  const monthActivities = activities.filter(a => a.monthKey === mKey);
  const dim = daysInMonth(currentYear, currentMonth);

  // Build rows: one per (client, commessa)
  const rows = [];
  clients.forEach(c => {
    if (filterClient !== "all" && c.id !== filterClient) return;
    c.commesse.forEach(co => {
      rows.push({ client: c, commessa: co, key: c.id + "-" + co.code });
    });
  });

  // Compute matrix: rows × days
  const cellHours = {};
  monthActivities.forEach(a => {
    const k = a.clientId + "-" + a.commessa + "-" + a.day;
    cellHours[k] = (cellHours[k] || 0) + a.hours;
  });

  // Per-row totals + per-day totals
  const rowTotals = {};
  rows.forEach(r => {
    let sum = 0;
    for (let d = 1; d <= dim; d++) {
      const k = r.client.id + "-" + r.commessa.code + "-" + d;
      sum += cellHours[k] || 0;
    }
    rowTotals[r.key] = sum;
  });

  const dayTotals = Array.from({ length: dim + 1 }, () => 0);
  monthActivities.forEach(a => {
    if (filterClient !== "all" && a.clientId !== filterClient) return;
    dayTotals[a.day] += a.hours;
  });

  const grandTotal = Object.values(rowTotals).reduce((s, v) => s + v, 0);
  const grandAmount = rows.reduce((s, r) => s + rowTotals[r.key] * r.client.hourlyRate, 0);

  // Grid template: row header (240px) + N day cells (38px each) + total (60px)
  const dayColW = 38;
  const totalColW = 64;
  const rowHeaderW = 260;
  const gridTemplate = `${rowHeaderW}px repeat(${dim}, ${dayColW}px) ${totalColW}px ${totalColW + 24}px`;

  const monthLabel = `${MONTHS_IT[currentMonth]} ${currentYear}`;

  return (
    <div className="content">
      <div className="timesheet-toolbar">
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div className="month-nav">
            <button onClick={() => onNavMonth(-1)} aria-label="Mese precedente"><Icon name="chevronLeft" size={14} /></button>
            <div className="month-label">{monthLabel}</div>
            <button onClick={() => onNavMonth(1)} aria-label="Mese successivo"><Icon name="chevronRight" size={14} /></button>
          </div>

          <div className="filter-row">
            <button className={"chip " + (filterClient === "all" ? "active" : "")} onClick={() => setFilterClient("all")}>
              {t('ts.allClients')}
            </button>
            {clients.filter(c => c.status === "active").map(c => (
              <button
                key={c.id}
                className={"chip " + (filterClient === c.id ? "active" : "")}
                onClick={() => setFilterClient(c.id)}
              >
                <span className="chip-dot" style={{ background: c.commesse[0]?.color || "var(--accent)" }} />
                {c.shortName}
              </button>
            ))}
          </div>
        </div>

        <button className="btn btn-primary" onClick={() => onAddActivity()}>
          <Icon name="plus" size={14} /> {t('ts.registerActivity')}
        </button>
      </div>

      <div className="timesheet">
        <div className="table-wrap">
          <div className="ts-grid" style={{ gridTemplateColumns: gridTemplate, minWidth: rowHeaderW + dim * dayColW + 2 * totalColW + 24 }}>
            {/* Header row */}
            <div className="ts-cell ts-row-header" style={{ background: "var(--bg-sunken)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 500 }}>
              Cliente · Commessa
            </div>
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1;
              const dow = dowOfDay(currentYear, currentMonth, d);
              const isWE = dow === 0 || dow === 6;
              const isToday = d === today;
              return (
                <div key={d} className={"ts-cell ts-day-header " + (isWE ? "is-weekend " : "") + (isToday ? "is-today" : "")}>
                  <div className="dow">{DOW_IT_1[dow]}</div>
                  <div className="dnum">{d}</div>
                </div>
              );
            })}
            <div className="ts-cell ts-day-header">{t('ts.totalH')}</div>
            <div className="ts-cell ts-day-header">{t('ts.amount')}</div>

            {/* Data rows */}
            {rows.map(r => (
              <React.Fragment key={r.key}>
                <div className="ts-cell ts-row-header">
                  <div className="client" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: r.commessa.color }} />
                    {r.client.shortName} · {r.commessa.name}
                  </div>
                  <div className="commessa">{r.commessa.code} · {fmtEUR(r.client.hourlyRate)}/h</div>
                </div>
                {Array.from({ length: dim }, (_, i) => {
                  const d = i + 1;
                  const dow = dowOfDay(currentYear, currentMonth, d);
                  const isWE = dow === 0 || dow === 6;
                  const isToday = d === today;
                  const k = r.client.id + "-" + r.commessa.code + "-" + d;
                  const h = cellHours[k] || 0;
                  const sameRow = drag && drag.clientId === r.client.id && drag.commessa === r.commessa.code;
                  const inDrag = sameRow && d >= Math.min(drag.startDay, drag.currentDay) && d <= Math.max(drag.startDay, drag.currentDay);
                  return (
                    <div
                      key={d}
                      className={"ts-cell ts-data " + (h > 0 ? "has-value " : "") + (isWE ? "is-weekend " : "") + (isToday ? "is-today " : "") + (inDrag ? "is-drag-select" : "")}
                      onMouseDown={e => { e.preventDefault(); setDrag({ clientId: r.client.id, commessa: r.commessa.code, startDay: d, currentDay: d }); }}
                      onMouseEnter={() => { if (sameRow) setDrag(prev => ({ ...prev, currentDay: d })); }}
                    >
                      {h > 0 ? fmtNum(h, h % 1 === 0 ? 0 : 1) : ""}
                    </div>
                  );
                })}
                <div className="ts-cell" style={{ justifyContent: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 13 }}>
                  {fmtNum(rowTotals[r.key], rowTotals[r.key] % 1 === 0 ? 0 : 1)}
                </div>
                <div className="ts-cell" style={{ justifyContent: "flex-end", paddingRight: 14, fontFamily: "var(--font-mono)", fontWeight: 500, fontSize: 12.5 }}>
                  {fmtEUR(rowTotals[r.key] * r.client.hourlyRate)}
                </div>
              </React.Fragment>
            ))}

            {/* Totals row */}
            <div className="ts-cell ts-row-header" style={{ fontWeight: 600 }}>{t('ts.dailyTotals')}</div>
            {Array.from({ length: dim }, (_, i) => {
              const d = i + 1;
              const dow = dowOfDay(currentYear, currentMonth, d);
              const isWE = dow === 0 || dow === 6;
              return (
                <div key={d} className={"ts-cell ts-totals-row " + (isWE ? "is-weekend" : "")} style={{ background: "var(--bg-sunken)", justifyContent: "center", fontFamily: "var(--font-mono)", fontWeight: 600, fontSize: 12, color: dayTotals[d] > 0 ? "var(--text)" : "var(--text-muted)" }}>
                  {dayTotals[d] > 0 ? fmtNum(dayTotals[d], dayTotals[d] % 1 === 0 ? 0 : 1) : ""}
                </div>
              );
            })}
            <div className="ts-cell" style={{ background: "var(--bg-sunken)", justifyContent: "center", fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 14 }}>
              {fmtNum(grandTotal, grandTotal % 1 === 0 ? 0 : 1)}
            </div>
            <div className="ts-cell" style={{ background: "var(--bg-sunken)", justifyContent: "flex-end", paddingRight: 14, fontFamily: "var(--font-mono)", fontWeight: 700, fontSize: 13 }}>
              {fmtEUR(grandAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* Recent activities list */}
      <div style={{ marginTop: 24 }}>
        <div className="card">
          <div className="card-header">
            <div>
              <h3>{t('ts.registeredActivities')}</h3>
              <div className="subtitle">{t('ts.activitiesCount', { count: monthActivities.length, hours: fmtH(grandTotal) })}</div>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              {selected.size > 0 && (
                <>
                  <span style={{ fontSize: 12.5, color: "var(--text-secondary)" }}>{selected.size} selezionate</span>
                  <button className="btn btn-danger btn-sm" onClick={() => {
                    onDeleteActivities([...selected]);
                    setSelected(new Set());
                  }}>
                    <Icon name="trash" size={12} /> Elimina
                  </button>
                  <button className="btn btn-sm" onClick={() => setSelected(new Set())}>
                    {t('action.cancel')}
                  </button>
                </>
              )}
              <button className="btn btn-sm" onClick={() => downloadTimesheetCSV(monthActivities, clients, currentYear, currentMonth)}>
                <Icon name="download" size={12} /> CSV
              </button>
            </div>
          </div>
          {(() => {
            const visibleActs = [...monthActivities]
              .filter(a => filterClient === "all" || a.clientId === filterClient)
              .sort((a, b) => b.day - a.day);
            const allChecked = visibleActs.length > 0 && visibleActs.every(a => selected.has(a.id));
            const toggleAll = () => {
              if (allChecked) {
                setSelected(s => { const n = new Set(s); visibleActs.forEach(a => n.delete(a.id)); return n; });
              } else {
                setSelected(s => new Set([...s, ...visibleActs.map(a => a.id)]));
              }
            };
            const toggleOne = (id) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
            return (
              <table className="data">
                <thead>
                  <tr>
                    <th style={{ width: 36 }}>
                      <input type="checkbox" checked={allChecked} onChange={toggleAll} style={{ cursor: "pointer" }} />
                    </th>
                    <th style={{ width: 80 }}>{t('ts.date')}</th>
                    <th>{t('ts.client')}</th>
                    <th>{t('ts.commessa')}</th>
                    <th>{t('ts.description')}</th>
                    <th className="num">{t('ts.hours')}</th>
                    <th className="num">{t('ts.amount')}</th>
                    <th style={{ width: 50 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleActs.map(a => {
                    const c = clients.find(x => x.id === a.clientId);
                    if (!c) return null;
                    const co = c.commesse.find(x => x.code === a.commessa);
                    const mShort = MONTHS_IT[currentMonth].slice(0,3).toLowerCase();
                    const isSelected = selected.has(a.id);
                    return (
                      <tr key={a.id} onClick={() => onEditActivity(a)} style={{ cursor: "pointer", background: isSelected ? "var(--accent-soft)" : "" }}>
                        <td onClick={e => { e.stopPropagation(); toggleOne(a.id); }} style={{ textAlign: "center" }}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleOne(a.id)} style={{ cursor: "pointer" }} />
                        </td>
                        <td className="mono">
                          <div style={{ fontWeight: 600 }}>{String(a.day).padStart(2, "0")} {mShort}</div>
                          <div style={{ fontSize: 10.5, color: "var(--text-muted)", textTransform: "uppercase" }}>
                            {DOW_IT_SHORT[dowOfDay(currentYear, currentMonth, a.day)]}
                          </div>
                        </td>
                        <td><strong>{c.shortName}</strong></td>
                        <td>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span style={{ width: 6, height: 6, borderRadius: 2, background: co.color }} />
                            <span className="mono" style={{ fontSize: 11.5 }}>{a.commessa}</span>
                          </span>
                        </td>
                        <td style={{ color: "var(--text-secondary)" }}>{a.desc}</td>
                        <td className="num"><strong>{fmtH(a.hours)}</strong></td>
                        <td className="num">{fmtEUR(a.hours * c.hourlyRate)}</td>
                        <td>
                          <button className="btn btn-ghost btn-sm btn-icon" onClick={e => { e.stopPropagation(); onEditActivity(a); }}>
                            <Icon name="edit" size={12} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

window.Timesheet = Timesheet;
