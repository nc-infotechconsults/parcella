// Download helpers
function downloadBlob(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function buildSummaryRows(client, acts) {
  const map = {};
  acts.forEach(a => {
    if (!map[a.commessa]) {
      const co = client.commesse.find(c => c.code === a.commessa);
      map[a.commessa] = { code: a.commessa, name: co?.name || a.commessa, hours: 0 };
    }
    map[a.commessa].hours += a.hours;
  });
  return Object.values(map);
}

function buildCSV(client, acts, exps, amounts, studio, monthLabel, mode, summaryRows) {
  const totalsBlock = [
    [],
    ["", "", "Totale ore", acts.reduce((s, a) => s + a.hours, 0).toFixed(2)],
    ["", "", "Imponibile", amounts.imponibile.toFixed(2)],
    ...(client.cassaIncluded ? [] : [["", "", `Cassa ${client.cassaPct}%`, amounts.cassa.toFixed(2)]]),
    ["", "", `IVA ${client.vatPct}%`, amounts.iva.toFixed(2)],
    ...(client.withholding ? [["", "", "Ritenuta 20%", "-" + amounts.withholding.toFixed(2)]] : []),
    ...(exps.length > 0 ? [["", "", "Rimborso spese", exps.reduce((s, e) => s + e.amount, 0).toFixed(2)]] : []),
    ["", "", "TOTALE DOVUTO", (amounts.totalWithExpenses || amounts.total).toFixed(2)],
  ];

  let rows;
  if (mode === "summary") {
    rows = [
      ["RIEPILOGO ATTIVITÀ — " + client.name.toUpperCase()],
      ["Periodo: " + monthLabel + " · " + studio.firm],
      [],
      ["Commessa", "Descrizione", "Ore totali", "Tariffa (€/h)", "Importo (€)"],
      ...summaryRows.map(r => [
        r.code,
        r.name,
        r.hours,
        client.hourlyRate,
        (r.hours * client.hourlyRate).toFixed(2),
      ]),
      ...totalsBlock,
    ];
  } else {
    rows = [
      ["TIMESHEET — " + client.name.toUpperCase()],
      ["Periodo: " + monthLabel + " · " + studio.firm],
      [],
      ["Data", "Commessa", "Descrizione", "Ore", "Tariffa (€/h)", "Importo (€)"],
      ...acts.map(a => {
        const co = client.commesse.find(c => c.code === a.commessa);
        const [y, m] = a.monthKey.split("-");
        return [
          `${String(a.day).padStart(2,"0")}/${m}/${y}`,
          a.commessa + (co ? " — " + co.name : ""),
          a.desc,
          a.hours,
          client.hourlyRate,
          (a.hours * client.hourlyRate).toFixed(2),
        ];
      }),
      ...totalsBlock,
    ];
  }
  return "﻿" + rows.map(r => r.map(v => `"${String(v ?? "").replace(/"/g,'""')}"`).join(",")).join("\r\n");
}

function buildWordHTML(client, acts, exps, amounts, docNum, docDate, studio, mode, summaryRows) {
  const totalHours = acts.reduce((s, a) => s + a.hours, 0);
  const tableRows = mode === "summary"
    ? summaryRows.map(r => `<tr><td style="font-family:monospace;font-size:10px">${r.code}</td><td>${r.name}</td><td align="right">${fmtNum(r.hours, r.hours%1===0?0:1)}</td><td align="right">${fmtEUR(r.hours*client.hourlyRate)}</td></tr>`).join("")
    : acts.map(a => {
        const co = client.commesse.find(c => c.code === a.commessa);
        const [y, m] = a.monthKey.split("-");
        return `<tr><td>${String(a.day).padStart(2,"0")}/${m}/${y}</td><td style="font-family:monospace;font-size:10px">${a.commessa}</td><td>${a.desc}${co ? '<br><small style="color:#78716c">'+co.name+'</small>' : ''}</td><td align="right">${fmtNum(a.hours, a.hours%1===0?0:1)}</td><td align="right">${fmtEUR(a.hours*client.hourlyRate)}</td></tr>`;
      }).join("");
  const tableHead = mode === "summary"
    ? `<tr><th>Commessa</th><th>Descrizione</th><th>Ore totali</th><th>Importo</th></tr>`
    : `<tr><th>Data</th><th>Commessa</th><th>Descrizione</th><th>Ore</th><th>Importo</th></tr>`;
  const totalCols = mode === "summary" ? 2 : 3;
  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head><meta charset='utf-8'><title>Rapporto attività — ${client.name}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:11pt;margin:2cm}table{width:100%;border-collapse:collapse;margin:12pt 0}th{background:#1c1917;color:white;padding:6pt 8pt;text-align:left;font-size:10pt}td{padding:5pt 8pt;border-bottom:1px solid #e7e5e4;font-size:10pt}h1{font-size:16pt;font-weight:bold;margin-bottom:4pt}h2{font-size:13pt;border-bottom:1px solid #d6d3d1;padding-bottom:4pt;margin-top:20pt}</style>
</head><body>
<div style="border-bottom:2pt solid #1c1917;padding-bottom:12pt;margin-bottom:16pt">
${studio.logoDataUrl ? `<img src="${studio.logoDataUrl}" style="height:48pt;max-width:180pt;object-fit:contain;display:block;margin-bottom:8pt" alt="Logo" />` : ""}
<h1 style="margin:0">${studio.firm}</h1>
<p style="margin:4pt 0;color:#57534e;font-size:10pt">${studio.address}<br>P.IVA ${studio.piva} · C.F. ${studio.cf}<br>${studio.email}</p>
</div>
<h1>Rapporto attività professionali</h1>
<p style="color:#57534e">Documento n. <b>${docNum}</b> · emesso il ${docDate}</p>
<p>Spett.le<br><b>${client.name}</b><br>${client.address}<br>P.IVA ${client.piva}</p>
<p>Con la presente, lo scrivente <b>${studio.firm}</b> (P.IVA ${studio.piva}), trasmette il riepilogo delle attività svolte nel periodo <b>${docDate.replace("31/", "01/")} — ${docDate}</b> per un totale di <b>${fmtH(totalHours)}</b>.</p>
<h2>${mode === "summary" ? "Riepilogo per commessa" : "Dettaglio prestazioni"}</h2>
<table><thead>${tableHead}</thead>
<tbody>${tableRows}
<tr style="border-top:2pt solid #1c1917;font-weight:bold"><td colspan="${totalCols}">Totale</td><td align="right">${fmtNum(totalHours, totalHours%1===0?0:1)} h</td><td align="right">${fmtEUR(amounts.imponibile)}</td></tr>
</tbody></table>
<h2>Riepilogo economico</h2>
<table style="width:320pt;margin-left:auto"><tbody>
<tr><td>Imponibile</td><td align="right">${fmtEUR(amounts.imponibile)}</td></tr>
${!client.cassaIncluded ? `<tr><td>Cassa previdenza ${client.cassaPct}%</td><td align="right">${fmtEUR(amounts.cassa)}</td></tr>` : ""}
<tr><td>IVA ${client.vatPct}%</td><td align="right">${fmtEUR(amounts.iva)}</td></tr>
${client.withholding ? `<tr><td>Ritenuta d'acconto 20%</td><td align="right">−${fmtEUR(amounts.withholding)}</td></tr>` : ""}
${exps.length > 0 ? `<tr><td>Rimborso spese</td><td align="right">+${fmtEUR(exps.reduce((s,e)=>s+e.amount,0))}</td></tr>` : ""}
<tr style="border-top:2pt solid #1c1917;font-weight:bold;font-size:12pt"><td>Totale dovuto</td><td align="right">${fmtEUR(amounts.totalWithExpenses || amounts.total)}</td></tr>
</tbody></table>
<p style="font-size:10pt;color:#57534e;margin-top:28pt">Pagamento: bonifico bancario a ${client.bankOverride || studio.firm}, IBAN ${client.ibanOverride || studio.iban}.${client.paymentRef ? `<br>Riferimento: ${client.paymentRef}.` : ''}<br>Termini: ${client.paymentDays} giorni d.f. f.m.</p>
<p style="margin-top:28pt">Distinti saluti,<br><br>${studio.firm}<br><i>${studio.name}</i></p>
</body></html>`;
}

// Export / Document preview
const Export = ({ clients, activities, expenses, currentMonthKey, studio, currentYear, currentMonth, onNavMonth }) => {
  const monthClients = clients.filter(c =>
    activities.some(a => a.clientId === c.id && a.monthKey === currentMonthKey) ||
    expenses.some(e => e.clientId === c.id && e.monthKey === currentMonthKey && e.billable)
  );
  const [selectedId, setSelectedId] = useState(monthClients[0]?.id || clients[0]?.id || "");
  const [format, setFormat] = useState("pdf");
  const [mode, setMode] = useState("detail"); // "detail" | "summary"
  const u = studio || window.APP_DATA.user;

  const client = clients.find(c => c.id === selectedId);
  const acts = activities
    .filter(a => a.clientId === selectedId && a.monthKey === currentMonthKey)
    .sort((a, b) => a.day - b.day);
  const exps = expenses
    .filter(e => e.clientId === selectedId && e.monthKey === currentMonthKey && e.billable)
    .sort((a, b) => a.day - b.day);
  const totalHours = acts.reduce((s, a) => s + a.hours, 0);
  const totalExpenses = exps.reduce((s, e) => s + e.amount, 0);
  const amounts = computeInvoiceAmounts(client, totalHours);
  amounts.expenses = totalExpenses;
  amounts.totalWithExpenses = amounts.total + totalExpenses;
  const summaryRows = client ? buildSummaryRows(client, acts) : [];
  const cYear = currentYear || new Date().getFullYear();
  const cMonth = currentMonth !== undefined ? currentMonth : new Date().getMonth();
  const monthLabel = MONTHS_IT[cMonth] + " " + cYear;
  const lastDay = daysInMonth(cYear, cMonth);
  const mm = String(cMonth + 1).padStart(2, "0");
  const docNum = `${cYear}-${String(monthClients.findIndex(c => c.id === selectedId) + 1).padStart(3, "0")}`;
  const docDate = `${String(lastDay).padStart(2,"0")}/${mm}/${cYear}`;

  const handleSendEmail = () => {
    const ct = getClientInvoiceContact(client);
    if (!ct?.email) return;
    if (format === "excel") handleDownloadCSV();
    else if (format === "word") handleDownloadWord();
    const subject = encodeURIComponent(`Rapporto attività ${monthLabel}`);
    const body = encodeURIComponent("In allegato il rapporto attività.");
    window.open(`mailto:${ct.email}?subject=${subject}&body=${body}`);
    if (format !== "pdf") {
      window.showToast("Documento scaricato — allegalo all'email", "info");
    }
  };

  const handlePrint = () => {
    document.body.classList.add("printing-export");
    window.print();
    setTimeout(() => document.body.classList.remove("printing-export"), 1000);
  };

  const handleDownloadCSV = () => {
    if (!client) return;
    const csv = buildCSV(client, acts, exps, amounts, u, monthLabel, mode, summaryRows);
    const prefix = mode === "summary" ? "riepilogo" : "timesheet";
    downloadBlob(csv, `${prefix}_${client.shortName}_${cYear}_${mm}.csv`, "text/csv;charset=utf-8;");
  };

  const handleDownloadWord = () => {
    if (!client) return;
    const html = buildWordHTML(client, acts, exps, amounts, docNum, docDate, u, mode, summaryRows);
    const prefix = mode === "summary" ? "riepilogo" : "rapporto";
    downloadBlob(html, `${prefix}_${client.shortName}_${cYear}_${mm}.doc`, "application/msword");
  };

  return (
    <div className="content">
      <div className="export-shell">
        {/* Sidebar - clients to export */}
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header" style={{ padding: "12px 16px" }}>
              <h3 style={{ fontSize: 12.5 }}>Periodo</h3>
            </div>
            <div className="card-body" style={{ padding: 14 }}>
              <div className="month-nav" style={{ width: "100%" }}>
                <button onClick={() => onNavMonth && onNavMonth(-1)}><Icon name="chevronLeft" size={14} /></button>
                <div className="month-label" style={{ flex: 1 }}>{monthLabel}</div>
                <button onClick={() => onNavMonth && onNavMonth(1)}><Icon name="chevronRight" size={14} /></button>
              </div>
            </div>
          </div>

          <h3 className="section-title">Cliente</h3>
          <div className="card">
            {monthClients.map(c => {
              const cActs = activities.filter(a => a.clientId === c.id && a.monthKey === currentMonthKey);
              const cHours = cActs.reduce((s, a) => s + a.hours, 0);
              const cAmounts = computeInvoiceAmounts(c, cHours);
              return (
                <div
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    padding: "12px 14px",
                    borderBottom: "1px solid var(--border)",
                    cursor: "pointer",
                    background: selectedId === c.id ? "var(--accent-soft)" : "transparent",
                    borderLeft: selectedId === c.id ? "3px solid var(--accent)" : "3px solid transparent",
                  }}
                >
                  <div style={{ fontSize: 13.5, fontWeight: 500, marginBottom: 2 }}>
                    {c.shortName}
                  </div>
                  <div style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", justifyContent: "space-between" }}>
                    <span>{fmtH(cHours)}</span>
                    <span className="mono">{fmtEUR(cAmounts.total)}</span>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 16 }}>
            <h3 className="section-title">Tipo documento</h3>
            <div style={{ display: "flex", background: "var(--bg-sunken)", borderRadius: "var(--radius-sm)", padding: 3, gap: 3 }}>
              {[["detail", "Dettagliato"], ["summary", "Riepilogo"]].map(([v, label]) => (
                <button
                  key={v}
                  className={"btn btn-sm" + (mode === v ? " btn-primary" : "")}
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => setMode(v)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
            {format === "pdf" && (
              <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={handlePrint}>
                <Icon name="download" size={14} /> Stampa / Salva PDF
              </button>
            )}
            {format === "excel" && (
              <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={handleDownloadCSV}>
                <Icon name="download" size={14} /> Scarica CSV (Excel)
              </button>
            )}
            {format === "word" && (
              <button className="btn btn-primary" style={{ justifyContent: "center" }} onClick={handleDownloadWord}>
                <Icon name="download" size={14} /> Scarica DOC (Word)
              </button>
            )}
            {getClientInvoiceContact(client)?.email && (
              <button className="btn" style={{ justifyContent: "center" }} onClick={handleSendEmail}>
                <Icon name="mail" size={14} /> Invia per email
              </button>
            )}
          </div>
        </div>

        {/* Preview area */}
        <div>
          <div className="export-tabs">
            <button className={"export-tab " + (format === "pdf" ? "active" : "")} onClick={() => setFormat("pdf")}>
              <Icon name="file" size={13} /> PDF
            </button>
            <button className={"export-tab " + (format === "excel" ? "active" : "")} onClick={() => setFormat("excel")}>
              <Icon name="grid" size={13} /> Excel
            </button>
            <button className={"export-tab " + (format === "word" ? "active" : "")} onClick={() => setFormat("word")}>
              <Icon name="file" size={13} /> Word
            </button>
          </div>

          {format === "pdf" && client && <PdfPreview client={client} acts={acts} exps={exps} totalHours={totalHours} amounts={amounts} docNum={docNum} docDate={docDate} user={u} monthLabel={monthLabel} periodStart={`01/${mm}/${cYear}`} periodEnd={docDate} cYear={cYear} mm={mm} mode={mode} summaryRows={summaryRows} />}
          {format === "excel" && client && <ExcelPreview client={client} acts={acts} totalHours={totalHours} amounts={amounts} user={u} monthLabel={monthLabel} periodStart={`01/${mm}/${cYear}`} periodEnd={docDate} cYear={cYear} mm={mm} mode={mode} summaryRows={summaryRows} />}
          {format === "word" && client && <WordPreview client={client} acts={acts} totalHours={totalHours} amounts={amounts} docNum={docNum} docDate={docDate} user={u} monthLabel={monthLabel} periodStart={`01/${mm}/${cYear}`} periodEnd={docDate} cYear={cYear} mm={mm} mode={mode} summaryRows={summaryRows} />}
        </div>
      </div>
    </div>
  );
};

const PdfPreview = ({ client, acts, exps = [], totalHours, amounts, docNum, docDate, user, monthLabel, periodStart, periodEnd, cYear, mm, mode = "detail", summaryRows = [] }) => (
  <div className="preview-paper">
    <div className="invoice-header">
      <div className="from">
        {user.logoDataUrl && (
          <img src={user.logoDataUrl} alt="Logo" style={{ height: 48, maxWidth: 180, objectFit: "contain", marginBottom: 10, display: "block" }} />
        )}
        <div className="firm">{user.firm}</div>
        <div>{user.address}</div>
        <div>{fmtPIVA(user.piva)}</div>
        <div>C.F. {user.cf}</div>
        <div>{user.email}</div>
      </div>
      <div className="doc">
        <div className="label">Rapporto attività</div>
        <div className="num">N. {docNum}</div>
        <div style={{ fontSize: 11, color: "#57534e", marginTop: 6 }}>Data emissione<br /><strong style={{ color: "#1c1917" }}>{docDate}</strong></div>
      </div>
    </div>

    <div className="invoice-meta">
      <div className="block">
        <div className="label">Spettabile</div>
        <div className="value big">{client.name}</div>
        <div className="value" style={{ color: "#57534e" }}>
          {client.address}<br />
          {fmtPIVA(client.piva)}
        </div>
      </div>
      <div className="block" style={{ textAlign: "right" }}>
        <div className="label">Periodo</div>
        <div className="value big">{monthLabel}</div>
        <div className="value" style={{ color: "#57534e" }}>
          dal {periodStart} al {periodEnd}
        </div>
      </div>
    </div>

    {mode === "summary" ? (
      <table className="invoice">
        <thead>
          <tr>
            <th style={{ width: 100 }}>Commessa</th>
            <th>Descrizione</th>
            <th className="num" style={{ width: 60 }}>Ore totali</th>
            <th className="num" style={{ width: 60 }}>Tariffa</th>
            <th className="num" style={{ width: 70 }}>Importo</th>
          </tr>
        </thead>
        <tbody>
          {summaryRows.map(r => (
            <tr key={r.code}>
              <td className="mono" style={{ fontSize: 10 }}>{r.code}</td>
              <td>{r.name}</td>
              <td className="num">{fmtNum(r.hours, r.hours % 1 === 0 ? 0 : 1)}</td>
              <td className="num">{fmtEUR(client.hourlyRate)}</td>
              <td className="num">{fmtEUR(r.hours * client.hourlyRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ) : (
      <table className="invoice">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Data</th>
            <th style={{ width: 100 }}>Commessa</th>
            <th>Descrizione attività</th>
            <th className="num" style={{ width: 50 }}>Ore</th>
            <th className="num" style={{ width: 60 }}>Tariffa</th>
            <th className="num" style={{ width: 70 }}>Importo</th>
          </tr>
        </thead>
        <tbody>
          {acts.map(a => {
            const co = client.commesse.find(c => c.code === a.commessa);
            return (
              <tr key={a.id}>
                <td className="mono">{String(a.day).padStart(2, "0")}/{mm}/{cYear}</td>
                <td className="mono" style={{ fontSize: 10 }}>{a.commessa}</td>
                <td>{a.desc}<div style={{ fontSize: 9.5, color: "#78716c" }}>{co.name}</div></td>
                <td className="num">{fmtNum(a.hours, a.hours % 1 === 0 ? 0 : 1)}</td>
                <td className="num">{fmtEUR(client.hourlyRate)}</td>
                <td className="num">{fmtEUR(a.hours * client.hourlyRate)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    )}

    {exps.length > 0 && (
      <>
        <h3 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#44403c", margin: "8px 0 6px" }}>Spese sostenute per conto del cliente</h3>
        <table className="invoice">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Data</th>
              <th style={{ width: 100 }}>Categoria</th>
              <th>Descrizione</th>
              <th className="num" style={{ width: 70 }}>Importo</th>
            </tr>
          </thead>
          <tbody>
            {exps.map(e => (
              <tr key={e.id}>
                <td className="mono">{String(e.day).padStart(2, "0")}/{mm}/{cYear}</td>
                <td>{e.category}</td>
                <td>{e.desc}{!e.hasReceipt && <span style={{ color: "#b45309", fontSize: 9, marginLeft: 6 }}>(senza ricevuta)</span>}</td>
                <td className="num">{fmtEUR(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    )}

    <div style={{ display: "flex" }}>
      <div style={{ flex: 1, fontSize: 10.5, color: "#57534e", lineHeight: 1.5, paddingTop: 8 }}>
        <strong style={{ color: "#1c1917" }}>Modalità di pagamento:</strong><br />
        Bonifico bancario a {client.bankOverride || user.firm}<br />
        IBAN {client.ibanOverride || user.iban}<br />
        {client.paymentRef && <><strong>Rif.</strong> {client.paymentRef}<br /></>}
        Termini: {client.paymentDays} giorni d.f. f.m.
      </div>
      <div className="invoice-totals">
        <div className="row"><span className="label">Totale ore</span><span>{fmtNum(totalHours, totalHours % 1 === 0 ? 0 : 1)} h</span></div>
        <div className="row subtotal"><span className="label">Imponibile prestazioni</span><span>{fmtEUR(amounts.imponibile)}</span></div>
        {!client.cassaIncluded && (
          <div className="row"><span className="label">Cassa {client.cassaPct}%</span><span>{fmtEUR(amounts.cassa)}</span></div>
        )}
        <div className="row"><span className="label">{client.vatPct === 0 ? "IVA esente" : `IVA ${client.vatPct}%`}</span><span>{fmtEUR(amounts.iva)}</span></div>
        {client.withholding && (
          <div className="row"><span className="label">Ritenuta acconto 20%</span><span>−{fmtEUR(amounts.withholding)}</span></div>
        )}
        {exps.length > 0 && (
          <div className="row"><span className="label">Rimborso spese</span><span>+{fmtEUR(amounts.expenses)}</span></div>
        )}
        <div className="row total"><span className="label">Totale dovuto</span><span>{fmtEUR(amounts.totalWithExpenses || amounts.total)}</span></div>
      </div>
    </div>

    <div className="invoice-footer">
      <span>{user.firm} — {fmtPIVA(user.piva)}</span>
      <span>Pag. 1 di 1</span>
    </div>
  </div>
);

const ExcelPreview = ({ client, acts, totalHours, amounts, user, monthLabel, periodStart, periodEnd, cYear, mm, mode = "detail", summaryRows = [] }) => {
  const cols = ["A", "B", "C", "D", "E", "F", "G"];
  const colHeaders = mode === "summary"
    ? ["Commessa", "Descrizione", "Ore totali", "Tariffa", "Importo", "", ""]
    : ["Data", "Commessa", "Descrizione", "Ore", "Tariffa", "Importo", "Note"];

  const dataRows = mode === "summary"
    ? summaryRows.map((r, i) => ({
        type: "data",
        row: i + 5,
        values: [
          r.code,
          r.name,
          r.hours.toFixed(2).replace(".", ","),
          client.hourlyRate.toFixed(2).replace(".", ","),
          (r.hours * client.hourlyRate).toFixed(2).replace(".", ","),
          "", "",
        ],
      }))
    : acts.map((a, i) => ({
        type: "data",
        row: i + 5,
        values: [
          `${String(a.day).padStart(2, "0")}/${mm}/${cYear}`,
          a.commessa,
          a.desc,
          a.hours.toFixed(2).replace(".", ","),
          client.hourlyRate.toFixed(2).replace(".", ","),
          (a.hours * client.hourlyRate).toFixed(2).replace(".", ","),
          "",
        ],
      }));

  return (
    <div className="preview-paper excel" style={{ minHeight: 600, padding: 0 }}>
      <div className="xl-toolbar">{client.shortName}_Parcella_{monthLabel.replace(" ","")}.xlsx — Microsoft Excel</div>
      <div className="xl-tabs">
        <div className="xl-tab active">Timesheet</div>
        <div className="xl-tab">Riepilogo</div>
        <div className="xl-tab">Commesse</div>
        <div style={{ flex: 1 }} />
      </div>
      <div style={{ padding: 16, background: "white" }}>
        <div className="xl-grid">
          {/* Column headers A-G */}
          <div className="xl-rh"></div>
          {cols.map(c => <div key={c} className="xl-ch">{c}</div>)}

          {/* Row 1: title */}
          <div className="xl-rh">1</div>
          <div style={{ gridColumn: "span 7", fontWeight: 700, fontSize: 14, padding: "8px 6px", background: "white" }}>
            TIMESHEET — {client.name.toUpperCase()}
          </div>

          {/* Row 2: period */}
          <div className="xl-rh">2</div>
          <div style={{ gridColumn: "span 7", fontSize: 11, color: "#44403c", padding: "4px 6px", background: "white" }}>
            Periodo: {periodStart} — {periodEnd} · {user.firm}
          </div>

          {/* Row 3: blank */}
          <div className="xl-rh">3</div>
          {cols.map(c => <div key={c}></div>)}

          {/* Row 4: column headers */}
          <div className="xl-rh">4</div>
          {colHeaders.map((h, i) => (
            <div key={i} className="xl-header-cell">{h}</div>
          ))}

          {/* Data rows */}
          {dataRows.map((r) => (
            <React.Fragment key={r.row}>
              <div className="xl-rh">{r.row}</div>
              {r.values.map((v, i) => (
                <div key={i} className={i >= 3 && i <= 5 ? "xl-num" : ""}>{v}</div>
              ))}
            </React.Fragment>
          ))}

          {/* Blank */}
          <div className="xl-rh">{5 + dataRows.length}</div>
          {cols.map(c => <div key={c}></div>)}

          {/* Totals */}
          <div className="xl-rh">{6 + dataRows.length}</div>
          <div style={{ gridColumn: "span 3", fontWeight: 600 }}>Totale ore</div>
          <div className="xl-num xl-bold">{totalHours.toFixed(2).replace(".", ",")}</div>
          <div></div>
          <div className="xl-num xl-bold">{amounts.imponibile.toFixed(2).replace(".", ",")}</div>
          <div style={{ fontSize: 10, color: "#78716c" }}>=SOMMA(F5:F{4 + dataRows.length})</div>

          {!client.cassaIncluded && (
            <>
              <div className="xl-rh">{7 + dataRows.length}</div>
              <div style={{ gridColumn: "span 4", color: "#44403c" }}>Cassa {client.cassaPct}%</div>
              <div></div>
              <div className="xl-num">{amounts.cassa.toFixed(2).replace(".", ",")}</div>
              <div></div>
            </>
          )}

          <div className="xl-rh">{(client.cassaIncluded ? 7 : 8) + dataRows.length}</div>
          <div style={{ gridColumn: "span 4", color: "#44403c" }}>IVA {client.vatPct}%</div>
          <div></div>
          <div className="xl-num">{amounts.iva.toFixed(2).replace(".", ",")}</div>
          <div></div>

          <div className="xl-rh">{(client.cassaIncluded ? 8 : 9) + dataRows.length}</div>
          <div style={{ gridColumn: "span 4", fontWeight: 700 }}>TOTALE FATTURA</div>
          <div></div>
          <div className="xl-num xl-bold" style={{ background: "#86efac" }}>{amounts.total.toFixed(2).replace(".", ",")}</div>
          <div></div>
        </div>
      </div>
    </div>
  );
};

const WordPreview = ({ client, acts, totalHours, amounts, docNum, docDate, user, monthLabel, periodStart, periodEnd, cYear, mm, mode = "detail", summaryRows = [] }) => (
  <div className="word-shell">
    <div className="preview-paper">
      <h1 className="doc-title">Rapporto attività professionali</h1>
      <p style={{ fontSize: 12, color: "#57534e", margin: "0 0 28px" }}>
        Documento n. <strong>{docNum}</strong> · emesso il {docDate}
      </p>

      <p style={{ fontSize: 11.5, lineHeight: 1.7 }}>
        Spett.le<br />
        <strong>{client.name}</strong><br />
        {client.address}<br />
        {fmtPIVA(client.piva)}
      </p>

      <p style={{ fontSize: 12, lineHeight: 1.7, marginTop: 24 }}>
        Con la presente, lo scrivente <strong>{user.firm}</strong> ({fmtPIVA(user.piva)}),
        in riferimento al contratto di prestazione professionale stipulato in data {client.contractStart},
        trasmette il riepilogo delle attività svolte nel periodo
        <strong> {periodStart} — {periodEnd}</strong> per un totale di <strong>{fmtH(totalHours)}</strong>.
      </p>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 28, marginBottom: 12, borderBottom: "1px solid #d6d3d1", paddingBottom: 4 }}>
        {mode === "summary" ? "Riepilogo per commessa" : "Dettaglio prestazioni"}
      </h2>

      <table className="invoice" style={{ fontFamily: "Cambria, Georgia, serif" }}>
        <thead>
          {mode === "summary" ? (
            <tr>
              <th style={{ background: "#1c1917", color: "white" }}>Commessa</th>
              <th style={{ background: "#1c1917", color: "white" }}>Descrizione</th>
              <th className="num" style={{ background: "#1c1917", color: "white" }}>Ore totali</th>
              <th className="num" style={{ background: "#1c1917", color: "white" }}>Importo</th>
            </tr>
          ) : (
            <tr>
              <th style={{ background: "#1c1917", color: "white" }}>Data</th>
              <th style={{ background: "#1c1917", color: "white" }}>Commessa</th>
              <th style={{ background: "#1c1917", color: "white" }}>Descrizione</th>
              <th className="num" style={{ background: "#1c1917", color: "white" }}>Ore</th>
              <th className="num" style={{ background: "#1c1917", color: "white" }}>Importo</th>
            </tr>
          )}
        </thead>
        <tbody>
          {mode === "summary" ? summaryRows.map(r => (
            <tr key={r.code}>
              <td style={{ fontFamily: "monospace", fontSize: 10 }}>{r.code}</td>
              <td>{r.name}</td>
              <td className="num">{fmtNum(r.hours, r.hours % 1 === 0 ? 0 : 1)}</td>
              <td className="num">{fmtEUR(r.hours * client.hourlyRate)}</td>
            </tr>
          )) : acts.map(a => (
            <tr key={a.id}>
              <td>{String(a.day).padStart(2, "0")}/{mm}/{cYear}</td>
              <td style={{ fontFamily: "monospace", fontSize: 10 }}>{a.commessa}</td>
              <td>{a.desc}</td>
              <td className="num">{fmtNum(a.hours, a.hours % 1 === 0 ? 0 : 1)}</td>
              <td className="num">{fmtEUR(a.hours * client.hourlyRate)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid #1c1917", fontWeight: 700 }}>
            <td colSpan={mode === "summary" ? 2 : 3}>Totale</td>
            <td className="num">{fmtNum(totalHours, totalHours % 1 === 0 ? 0 : 1)} h</td>
            <td className="num">{fmtEUR(amounts.imponibile)}</td>
          </tr>
        </tbody>
      </table>

      <h2 style={{ fontSize: 14, fontWeight: 700, marginTop: 28, marginBottom: 12, borderBottom: "1px solid #d6d3d1", paddingBottom: 4 }}>
        Riepilogo economico
      </h2>

      <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
        <tbody>
          <tr><td style={{ padding: "5px 0" }}>Imponibile</td><td className="num" style={{ padding: "5px 0", textAlign: "right" }}>{fmtEUR(amounts.imponibile)}</td></tr>
          {!client.cassaIncluded && <tr><td style={{ padding: "5px 0" }}>Cassa previdenza {client.cassaPct}%</td><td className="num" style={{ padding: "5px 0", textAlign: "right" }}>{fmtEUR(amounts.cassa)}</td></tr>}
          <tr><td style={{ padding: "5px 0" }}>IVA {client.vatPct}%</td><td className="num" style={{ padding: "5px 0", textAlign: "right" }}>{fmtEUR(amounts.iva)}</td></tr>
          {client.withholding && <tr><td style={{ padding: "5px 0" }}>Ritenuta d'acconto 20%</td><td className="num" style={{ padding: "5px 0", textAlign: "right" }}>−{fmtEUR(amounts.withholding)}</td></tr>}
          <tr style={{ borderTop: "2px solid #1c1917", fontWeight: 700, fontSize: 13 }}>
            <td style={{ padding: "8px 0" }}>Totale dovuto</td>
            <td className="num" style={{ padding: "8px 0", textAlign: "right" }}>{fmtEUR(amounts.total)}</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: 11, lineHeight: 1.6, marginTop: 36, color: "#57534e" }}>
        <strong>Pagamento:</strong> bonifico bancario a {client.bankOverride || user.firm}, IBAN {client.ibanOverride || user.iban}.<br />
        {client.paymentRef && <><strong>Riferimento:</strong> {client.paymentRef}.<br /></>}
        <strong>Termini:</strong> {client.paymentDays} giorni d.f. f.m.
      </p>

      <p style={{ fontSize: 11, lineHeight: 1.7, marginTop: 32 }}>
        Restando a disposizione per qualsiasi chiarimento, si porgono cordiali saluti.<br /><br />
        {user.firm}<br />
        <em>{user.name}</em>
      </p>
    </div>
  </div>
);

window.Export = Export;
