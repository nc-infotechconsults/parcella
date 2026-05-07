// ============ Tasse & contributi ============
// Supporta: libero professionista, ditta individuale.
// studio.tipoSoggetto: "professionista" | "ditta_individuale" | "societa"

function computeTaxes(activities, expenses, fiscal, year, clients, studio) {
  const _clients = clients || window.APP_DATA.clients;
  const tipo = (studio && studio.tipoSoggetto) || "professionista";
  const yr = String(year);

  const yearAct = activities.filter(a => a.monthKey.startsWith(yr + "-"));
  const yearExp = expenses.filter(e => e.monthKey.startsWith(yr + "-"));

  // ── Ricavi ────────────────────────────────────────────────────────────────
  const compensi = yearAct.reduce((s, a) => {
    const c = _clients.find(x => x.id === a.clientId);
    return s + (c ? a.hours * c.hourlyRate : 0);
  }, 0);

  const ritenutaTrattenuta = yearAct.reduce((s, a) => {
    const c = _clients.find(x => x.id === a.clientId);
    if (!c || !c.withholding) return s;
    return s + a.hours * c.hourlyRate * 0.20;
  }, 0);
  const compensiConRit = yearAct.reduce((s, a) => {
    const c = _clients.find(x => x.id === a.clientId);
    if (!c || !c.withholding) return s;
    return s + a.hours * c.hourlyRate;
  }, 0);
  const compensiSenzaRit = compensi - compensiConRit;

  // ── IVA ───────────────────────────────────────────────────────────────────
  const ivaDebito = yearAct.reduce((s, a) => {
    const c = _clients.find(x => x.id === a.clientId);
    if (!c) return s;
    return s + a.hours * c.hourlyRate * (c.vatPct || 0) / 100;
  }, 0);
  const ivaCredito = yearExp.filter(e => !e.billable).reduce((s, e) => s + computeExpenseFiscals(e).vatDetracted, 0);

  // ── Costi deducibili ──────────────────────────────────────────────────────
  const costiDeducibili = yearExp.filter(e => !e.billable).reduce((s, e) => s + computeExpenseFiscals(e).yearlyDeducted, 0);

  // ── Contributi previdenziali ──────────────────────────────────────────────
  const reddNettoLordoCassa = Math.max(0, compensi - costiDeducibili);
  let contribCassa = 0;
  let contribFisso = 0;    // minimale INPS ditta
  let contribVar = 0;      // variabile su eccedente (ditta)
  let irapBase = 0;
  let irap = 0;

  if (tipo === "professionista") {
    contribCassa = Math.max(0, reddNettoLordoCassa * (fiscal.cassaContribPct || 14.5) / 100);
  } else if (tipo === "ditta_individuale") {
    // INPS artigiani/commercianti: fisso (minimale) + variabile su eccedente
    const minimale = fiscal.inpsMinimale || 4427;
    const pctVar = fiscal.inpsPctVariabile || 24.0;
    const reddBase = 18415; // reddito minimale INPS 2025 (fissato INPS)
    contribFisso = minimale;
    contribVar = Math.max(0, (reddNettoLordoCassa - reddBase) * pctVar / 100);
    contribCassa = contribFisso + contribVar;
    // IRAP solo se autonoma organizzazione (lasciamo all'utente configurare)
    irapBase = Math.max(0, reddNettoLordoCassa - 8000); // deduzione base €8k
    irap = irapBase * (fiscal.irapPct || 3.9) / 100;
  }

  // ── IRPEF ─────────────────────────────────────────────────────────────────
  const redditoImpIrpef = Math.max(0, reddNettoLordoCassa - contribCassa);
  let irpefLorda = 0, prevBracket = 0;
  for (const b of (fiscal.irpefBrackets || [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: Infinity, rate: 43 }])) {
    const inBracket = Math.max(0, Math.min(redditoImpIrpef, b.upTo) - prevBracket);
    irpefLorda += inBracket * b.rate / 100;
    prevBracket = b.upTo;
    if (redditoImpIrpef <= b.upTo) break;
  }
  const addReg = redditoImpIrpef * (fiscal.addRegPct || 0) / 100;
  const addCom = redditoImpIrpef * (fiscal.addComPct || 0) / 100;
  const irpefLordaTot = irpefLorda + addReg + addCom;
  const irpefNetta = Math.max(0, irpefLordaTot - ritenutaTrattenuta);
  const ritenutaCredito = Math.max(0, ritenutaTrattenuta - irpefLordaTot);

  // ── IVA trimestrale ───────────────────────────────────────────────────────
  // Scadenze: professionista trimestrale con +1%; ditta può essere mensile
  const ivaDeadlines = [
    { id: "Q1", label: "1° trim (gen-mar)", deadline: "16 maggio (+1%)", months: ["01","02","03"], paid: fiscal.ivaQ1Paid, paidAmount: fiscal.ivaQ1Amount },
    { id: "Q2", label: "2° trim (apr-giu)", deadline: "20 agosto (+1%)", months: ["04","05","06"], paid: fiscal.ivaQ2Paid },
    { id: "Q3", label: "3° trim (lug-set)", deadline: "16 novembre (+1%)", months: ["07","08","09"], paid: fiscal.ivaQ3Paid },
    { id: "Q4", label: "4° trim (ott-dic)", deadline: "16 marzo anno succ.", months: ["10","11","12"], paid: fiscal.ivaQ4Paid },
  ];
  const trimestri = ivaDeadlines.map(qt => {
    const debit = yearAct.filter(a => qt.months.includes(a.monthKey.split("-")[1])).reduce((s, a) => {
      const c = _clients.find(x => x.id === a.clientId);
      if (!c) return s;
      return s + a.hours * c.hourlyRate * (c.vatPct || 0) / 100;
    }, 0);
    const credit = yearExp.filter(e => !e.billable && qt.months.includes(e.monthKey.split("-")[1]))
      .reduce((s, e) => s + computeExpenseFiscals(e).vatDetracted, 0);
    const wh = yearAct.filter(a => qt.months.includes(a.monthKey.split("-")[1])).reduce((s, a) => {
      const c = _clients.find(x => x.id === a.clientId);
      if (!c || !c.withholding) return s;
      return s + a.hours * c.hourlyRate * 0.20;
    }, 0);
    return { ...qt, debit, credit, balance: debit - credit, withholding: wh };
  });

  // ── Scadenze F24 dinamiche ────────────────────────────────────────────────
  // Generiamo le scadenze standard per l'anno fiscale e le mergiamo con lo storico utente.
  const y = parseInt(yr);
  const generatedF24 = [];
  const ivaQ1 = trimestri[0].balance;
  const ivaQ2 = trimestri[1].balance;
  const ivaQ3 = trimestri[2].balance;
  const ivaQ4 = trimestri[3].balance;

  // IVA trimestrale (valida per tutti i tipi con IVA)
  if (ivaQ1 > 0) generatedF24.push({ id: "_q1", date: `${y}-05-16`, code: "6031", desc: `IVA 1° trim ${yr}`, amount: Math.round((ivaQ1 * 1.01) * 100) / 100, _generated: true });
  if (ivaQ2 > 0) generatedF24.push({ id: "_q2", date: `${y}-08-20`, code: "6031", desc: `IVA 2° trim ${yr}`, amount: Math.round((ivaQ2 * 1.01) * 100) / 100, _generated: true });
  if (ivaQ3 > 0) generatedF24.push({ id: "_q3", date: `${y}-11-16`, code: "6031", desc: `IVA 3° trim ${yr}`, amount: Math.round((ivaQ3 * 1.01) * 100) / 100, _generated: true });
  if (ivaQ4 > 0) generatedF24.push({ id: "_q4", date: `${y+1}-03-16`, code: "6031", desc: `IVA 4° trim ${yr}`, amount: Math.round((ivaQ4 * 1.01) * 100) / 100, _generated: true });

  if (tipo === "professionista") {
    // Saldo IRPEF anno precedente + 1° acconto corrente: 30 giugno
    const saldoIrpef = Math.max(0, (fiscal.irpefPrevYear || 0) - (fiscal.irpefPrevYear || 0) * 0.4 - (fiscal.irpefPrevYear || 0) * 0.6);
    generatedF24.push({ id: "_irpef_saldo", date: `${y}-06-30`, code: "4001", desc: `Saldo IRPEF ${y-1}`, amount: saldoIrpef, _generated: true });
    generatedF24.push({ id: "_irpef_acc1", date: `${y}-06-30`, code: "4033", desc: `1° acconto IRPEF ${yr} (40%)`, amount: Math.round(irpefNetta * 0.4 * 100) / 100, _generated: true });
    generatedF24.push({ id: "_irpef_acc2", date: `${y}-11-30`, code: "4034", desc: `2° acconto IRPEF ${yr} (60%)`, amount: Math.round(irpefNetta * 0.6 * 100) / 100, _generated: true });
    // Cassa professionale acconti (stesso calendario IRPEF per Inarcassa)
    generatedF24.push({ id: "_cassa_acc1", date: `${y}-06-30`, code: "3801", desc: `1° acconto cassa ${yr} (50%)`, amount: Math.round(contribCassa * 0.5 * 100) / 100, _generated: true });
    generatedF24.push({ id: "_cassa_acc2", date: `${y}-11-30`, code: "3801", desc: `2° acconto cassa ${yr} (50%)`, amount: Math.round(contribCassa * 0.5 * 100) / 100, _generated: true });
  } else if (tipo === "ditta_individuale") {
    // IRPEF: saldo giugno, acconti giugno+novembre
    generatedF24.push({ id: "_irpef_acc1", date: `${y}-06-30`, code: "4033", desc: `1° acconto IRPEF ${yr} (40%)`, amount: Math.round(irpefNetta * 0.4 * 100) / 100, _generated: true });
    generatedF24.push({ id: "_irpef_acc2", date: `${y}-11-30`, code: "4034", desc: `2° acconto IRPEF ${yr} (60%)`, amount: Math.round(irpefNetta * 0.6 * 100) / 100, _generated: true });
    // INPS artigiani/commercianti: 4 rate fisse (min.) + 2 saldi variabili
    const rataFissa = Math.round(contribFisso / 4 * 100) / 100;
    generatedF24.push({ id: "_inps_f1", date: `${y}-05-16`, code: "0601", desc: `INPS 1ª rata fissa ${yr}`, amount: rataFissa, _generated: true });
    generatedF24.push({ id: "_inps_f2", date: `${y}-08-20`, code: "0601", desc: `INPS 2ª rata fissa ${yr}`, amount: rataFissa, _generated: true });
    generatedF24.push({ id: "_inps_f3", date: `${y}-11-16`, code: "0601", desc: `INPS 3ª rata fissa ${yr}`, amount: rataFissa, _generated: true });
    generatedF24.push({ id: `_inps_f4`, date: `${y+1}-02-16`, code: "0601", desc: `INPS 4ª rata fissa ${yr}`, amount: rataFissa, _generated: true });
    if (contribVar > 0) {
      generatedF24.push({ id: "_inps_v1", date: `${y}-11-16`, code: "0601", desc: `INPS saldo variabile ${yr} (1ª)`, amount: Math.round(contribVar * 0.5 * 100) / 100, _generated: true });
      generatedF24.push({ id: "_inps_v2", date: `${y+1}-02-16`, code: "0601", desc: `INPS saldo variabile ${yr} (2ª)`, amount: Math.round(contribVar * 0.5 * 100) / 100, _generated: true });
    }
    // IRAP: 30 giugno (saldo anno prec.) + acconti (giugno+novembre)
    if (irap > 0) {
      generatedF24.push({ id: "_irap_acc1", date: `${y}-06-30`, code: "3800", desc: `1° acconto IRAP ${yr} (40%)`, amount: Math.round(irap * 0.4 * 100) / 100, _generated: true });
      generatedF24.push({ id: "_irap_acc2", date: `${y}-11-30`, code: "3800", desc: `2° acconto IRAP ${yr} (60%)`, amount: Math.round(irap * 0.6 * 100) / 100, _generated: true });
    }
  }

  // Merge: voci manuali utente sovrascrivono quelle generate con stesso id
  const manualIds = new Set((fiscal.f24History || []).map(f => f.id));
  const f24All = [
    ...generatedF24.filter(g => !manualIds.has(g.id)),
    ...(fiscal.f24History || []),
  ].map(f => ({ ...f, status: f.status || (f._generated ? "estimated" : "estimated") }))
   .sort((a, b) => a.date.localeCompare(b.date));

  const totaleAnnoBase = (ivaDebito - ivaCredito) + irpefNetta + contribCassa;
  const totaleAnno = totaleAnnoBase + irap;

  return {
    tipo,
    compensi,
    ricaviImp: compensi,
    compensiConRit,
    compensiSenzaRit,
    ritenutaTrattenuta,
    ritenutaCredito,
    ivaDebito,
    ivaCredito,
    ivaSaldo: ivaDebito - ivaCredito,
    costiDeducibili,
    reddNettoLordoCassa,
    contribCassa,
    contribFisso,
    contribVar,
    irap,
    irapBase,
    redditoImpIrpef,
    irpef: irpefLorda,
    addReg,
    addCom,
    irpefLordaTot,
    irpefNetta,
    irpefTot: irpefNetta,
    trimestri,
    f24All,        // scadenze generate + manuali
    totaleAnno,
  };
}
window.computeTaxes = computeTaxes;

const Taxes = ({ activities, expenses, fiscal, clients, studio, year: taxYear, onUpdateFiscal }) => {
  const [tab, setTab] = useState("overview");
  const fiscalYear = String(taxYear || new Date().getFullYear());
  const tax = computeTaxes(activities, expenses, fiscal, fiscalYear, clients, studio);
  const today = new Date();

  // F24 paid/scheduled
  const f24All = tax.f24All || [];
  const f24Paid = f24All.filter(f => f.status === "paid");
  const f24Upcoming = f24All.filter(f => f.status !== "paid").sort((a, b) => a.date.localeCompare(b.date));
  const totalPaid = f24Paid.reduce((s, f) => s + f.amount, 0);
  const totalUpcoming = f24Upcoming.reduce((s, f) => s + f.amount, 0);
  const nextDeadline = f24Upcoming[0];
  const daysToNext = nextDeadline ? Math.ceil((new Date(nextDeadline.date) - today) / 86400000) : null;

  return (
    <div className="content">
      {/* Hero KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
        <div className="kpi" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="kpi-label">Stima carico fiscale {fiscalYear}</div>
          <div className="kpi-value tabular">{fmtEUR(tax.totaleAnno)}</div>
          <div className="kpi-meta">
            <span>{tax.compensi > 0 ? ((tax.totaleAnno / tax.compensi) * 100).toFixed(1) : 0}% sui compensi</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Ritenute già subite</div>
          <div className="kpi-value tabular" style={{ color: "var(--success)" }}>{fmtEUR(tax.ritenutaTrattenuta)}</div>
          <div className="kpi-meta"><span>credito IRPEF da scomputo</span></div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Da versare</div>
          <div className="kpi-value tabular" style={{ color: "var(--warning)" }}>{fmtEUR(totalUpcoming)}</div>
          <div className="kpi-meta"><span>{f24Upcoming.length} scadenze in calendario</span></div>
        </div>
        <div className="kpi" style={{ background: daysToNext != null && daysToNext <= 30 ? "oklch(0.97 0.04 80)" : "" }}>
          <div className="kpi-label">Prossima scadenza</div>
          <div className="kpi-value tabular" style={{ fontSize: 22 }}>
            {nextDeadline ? new Date(nextDeadline.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short" }) : "—"}
          </div>
          <div className="kpi-meta">
            {daysToNext != null && (
              <span className={daysToNext <= 30 ? "kpi-trend warn" : ""}>
                tra {daysToNext} giorni · {nextDeadline?.desc}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="tab-nav">
        <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Panoramica</button>
        <button className={tab === "iva" ? "active" : ""} onClick={() => setTab("iva")}>IVA trimestrale</button>
        <button className={tab === "irpef" ? "active" : ""} onClick={() => setTab("irpef")}>IRPEF & addizionali</button>
        <button className={tab === "cassa" ? "active" : ""} onClick={() => setTab("cassa")}>Contributi previdenziali</button>
        {tax.tipo === "ditta_individuale" && (
          <button className={tab === "irap" ? "active" : ""} onClick={() => setTab("irap")}>IRAP</button>
        )}
        <button className={tab === "f24" ? "active" : ""} onClick={() => setTab("f24")}>Calendario F24</button>
      </div>

      {tab === "overview" && (
        <TaxOverview tax={tax} fiscal={fiscal} f24Upcoming={f24Upcoming} fiscalYear={fiscalYear} studio={studio} />
      )}
      {tab === "iva" && (
        <TaxIVA tax={tax} fiscal={fiscal} fiscalYear={fiscalYear} />
      )}
      {tab === "irpef" && (
        <TaxIRPEF tax={tax} fiscal={fiscal} />
      )}
      {tab === "cassa" && (
        <TaxCassa tax={tax} fiscal={fiscal} studio={studio} onUpdateFiscal={onUpdateFiscal} />
      )}
      {tab === "irap" && tax.tipo === "ditta_individuale" && (
        <TaxIRAP tax={tax} fiscal={fiscal} fiscalYear={fiscalYear} onUpdateFiscal={onUpdateFiscal} />
      )}
      {tab === "f24" && (
        <TaxF24 fiscal={fiscal} tax={tax} fiscalYear={fiscalYear} onUpdateFiscal={onUpdateFiscal} />
      )}
    </div>
  );
};

// ===== Overview =====
const TaxOverview = ({ tax, fiscal, f24Upcoming, fiscalYear, studio }) => {
  const now = new Date();
  return (
  <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Composizione carico fiscale {fiscalYear}</h3>
          <div className="subtitle">Da compensi a netto disponibile — stima a partire da dati attuali</div>
        </div>
      </div>
      <div className="card-body">
        <TaxWaterfall tax={tax} studio={studio} />
      </div>
    </div>

    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="card">
        <div className="card-header"><h3>Prossime scadenze</h3></div>
        <div className="card-body" style={{ padding: 0 }}>
          <table className="data">
            <tbody>
              {f24Upcoming.slice(0, 5).map(f => {
                const d = new Date(f.date);
                const days = Math.ceil((d - now) / 86400000);
                return (
                  <tr key={f.id}>
                    <td style={{ width: 56 }}>
                      <div style={{ textAlign: "center", padding: 4, background: days <= 30 ? "oklch(0.95 0.06 30)" : "var(--bg-sunken)", borderRadius: 4 }}>
                        <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-muted)" }}>{d.toLocaleDateString("it-IT", { month: "short" })}</div>
                        <div style={{ fontSize: 16, fontWeight: 700 }}>{d.getDate()}</div>
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 500 }}>{f.desc}</div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Cod. {f.code} · {days > 0 ? `tra ${days} gg` : days === 0 ? "oggi" : `scaduto ${Math.abs(days)} gg fa`}</div>
                    </td>
                    <td className="num mono"><strong>{f.amount > 0 ? fmtEUR(f.amount) : <span style={{ color: "var(--text-muted)" }}>stimato</span>}</strong></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><h3>Suggerimenti fiscali</h3></div>
        <div className="card-body" style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
          <div style={{ display: "flex", gap: 10, padding: 10, background: "oklch(0.96 0.04 145)", borderRadius: 4 }}>
            <span style={{ color: "var(--success)", fontSize: 16 }}>✓</span>
            <div>
              <strong>Hai accantonato {fmtEUR(tax.totaleAnno * 0.4)}?</strong>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Regola del 40%: tieni da parte 40% dei compensi su conto separato per evitare sorprese a giugno.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, padding: 10, background: "oklch(0.97 0.04 80)", borderRadius: 4 }}>
            <span style={{ color: "var(--warning)", fontSize: 16 }}>⚠</span>
            <div>
              <strong>Acconto IRPEF 2° rata novembre</strong>
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Verifica se conviene il metodo "previsionale" se il reddito sarà inferiore all'anno precedente.</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, padding: 10, background: "var(--bg-sunken)", borderRadius: 4 }}>
            <span style={{ color: "var(--accent)", fontSize: 16 }}>ℹ</span>
            <div>
              <strong>IVA a credito</strong> {fmtEUR(tax.ivaCredito)}
              <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>Le tue spese di studio compensano parte dell'IVA a debito sui compensi.</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
  );
};

// Visual breakdown bar
const TaxWaterfall = ({ tax, studio }) => {
  const cassaLabel = studio?.cassaName || "Cassa prev.";
  const max = tax.compensi || 1;
  const items = [
    { label: "Compensi imponibili", value: tax.compensi, type: "in" },
    { label: "− Costi deducibili (esercizio)", value: -tax.costiDeducibili, type: "neg" },
    { label: `− Contributi ${cassaLabel}`, value: -tax.contribCassa, type: "neg" },
    { label: "= Reddito imponibile IRPEF", value: tax.redditoImpIrpef, type: "sub" },
    { label: "− IRPEF lorda + addizionali", value: -tax.irpefLordaTot, type: "neg" },
    { label: "+ Ritenute già trattenute (credito)", value: tax.ritenutaTrattenuta, type: "in" },
    { label: "= IRPEF netta da versare", value: -tax.irpefNetta, type: "neg" },
    { label: "= Netto disponibile (stima)", value: tax.compensi - tax.totaleAnno, type: "out" },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {items.map((it, i) => {
        const w = (Math.abs(it.value) / max) * 100;
        return (
          <div key={i}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 4 }}>
              <span style={{ fontWeight: it.type === "sub" || it.type === "out" ? 600 : 400, color: it.type === "neg" ? "var(--text-secondary)" : "var(--text)" }}>{it.label}</span>
              <span className="mono" style={{
                fontWeight: 600,
                color: it.type === "out" ? "var(--success)" : it.type === "neg" ? "var(--danger)" : it.type === "sub" ? "var(--accent)" : "var(--text)"
              }}>{it.value < 0 ? "−" : ""}{fmtEUR(Math.abs(it.value))}</span>
            </div>
            <div style={{ height: 8, background: "var(--bg-sunken)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{
                height: "100%",
                width: w + "%",
                background:
                  it.type === "in" ? "var(--accent)" :
                  it.type === "neg" ? "var(--danger)" :
                  it.type === "sub" ? "oklch(0.6 0.15 250)" :
                  "var(--success)",
                opacity: it.type === "neg" ? 0.5 : 0.9,
              }} />
            </div>
          </div>
        );
      })}
      <div style={{ marginTop: 12, padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: 4, fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text)" }}>Carico fiscale effettivo:</strong> {fmtEUR(tax.totaleAnno)} su {fmtEUR(tax.compensi)} ricavi → <strong style={{ fontFamily: "var(--font-mono)" }}>{tax.compensi > 0 ? ((tax.totaleAnno / tax.compensi) * 100).toFixed(1) : 0}%</strong>
      </div>
    </div>
  );
};

// ===== IVA =====
const TaxIVA = ({ tax, fiscal, fiscalYear }) => (
  <div className="card">
    <div className="card-header">
      <div>
        <h3>Liquidazione IVA trimestrale {fiscalYear}</h3>
        <div className="subtitle">IVA a debito sui compensi − IVA a credito sulle spese</div>
      </div>
    </div>
    <table className="data">
      <thead>
        <tr>
          <th>Trimestre</th>
          <th>Scadenza</th>
          <th className="num">IVA a debito</th>
          <th className="num">IVA a credito</th>
          <th className="num">Saldo da versare</th>
          <th>Stato</th>
        </tr>
      </thead>
      <tbody>
        {tax.trimestri.map(q => (
          <tr key={q.id}>
            <td><strong>{q.label}</strong></td>
            <td className="mono">{q.deadline}</td>
            <td className="num mono">{fmtEUR(q.debit)}</td>
            <td className="num mono" style={{ color: "var(--success)" }}>−{fmtEUR(q.credit)}</td>
            <td className="num mono"><strong>{fmtEUR(Math.max(0, q.balance))}</strong></td>
            <td>
              {q.paid
                ? <span className="badge badge-success badge-dot">Versato {q.paidAmount ? fmtEUR(q.paidAmount) : ""}</span>
                : q.balance > 0
                  ? <span className="badge badge-warning badge-dot">Da liquidare</span>
                  : <span className="badge">A credito (compensa)</span>}
            </td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr style={{ background: "var(--bg-sunken)", fontWeight: 700 }}>
          <td colSpan={2}>Totale anno</td>
          <td className="num mono">{fmtEUR(tax.ivaDebito)}</td>
          <td className="num mono">−{fmtEUR(tax.ivaCredito)}</td>
          <td className="num mono">{fmtEUR(tax.ivaSaldo)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text)" }}>Codice tributo F24:</strong> 6031 (IVA trimestrale) — maggiorazione 1% per i contribuenti trimestrali (già inclusa nel saldo).
      </div>
    </div>
  </div>
);

// ===== IRPEF =====
const TaxIRPEF = ({ tax, fiscal }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header"><h3>Calcolo IRPEF a scaglioni</h3></div>
      <table className="data">
        <thead>
          <tr>
            <th>Scaglione</th><th className="num">Aliquota</th>
            <th className="num">Imponibile</th><th className="num">Imposta</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            let prev = 0;
            return fiscal.irpefBrackets.map((b, i) => {
              const inB = Math.max(0, Math.min(tax.redditoImpIrpef, b.upTo) - prev);
              const taxAmt = inB * b.rate / 100;
              const upToLabel = b.upTo === Infinity ? "oltre" : fmtEUR(b.upTo);
              const lo = prev === 0 ? "0" : fmtEUR(prev);
              prev = b.upTo;
              return (
                <tr key={i}>
                  <td className="mono">{lo} — {upToLabel}</td>
                  <td className="num"><strong>{b.rate}%</strong></td>
                  <td className="num mono">{fmtEUR(inB)}</td>
                  <td className="num mono">{fmtEUR(taxAmt)}</td>
                </tr>
              );
            });
          })()}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}><strong>IRPEF lorda</strong></td>
            <td className="num mono"><strong>{fmtEUR(tax.irpef)}</strong></td>
          </tr>
        </tfoot>
      </table>
    </div>

    <div className="card">
      <div className="card-header"><h3>Addizionali e acconti</h3></div>
      <div className="card-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: "var(--bg-sunken)", padding: 14, borderRadius: 4 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Addizionale regionale ({fiscal.addRegPct}%)</span>
              <span className="mono">{fmtEUR(tax.addReg)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Addizionale comunale ({fiscal.addComPct}%)</span>
              <span className="mono">{fmtEUR(tax.addCom)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
              <span>Totale addizionali</span>
              <span className="mono">{fmtEUR(tax.addReg + tax.addCom)}</span>
            </div>
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Acconti IRPEF (su anno precedente)</div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
              <span>1° acconto (40%) · entro 30 giu · {fmtEUR(fiscal.irpefPrevYear * 0.4)}</span>
              <span>{fiscal.irpefAcconto1Paid ? <span className="badge badge-success badge-dot">versato</span> : <span className="badge badge-warning">da pagare</span>}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span>2° acconto (60%) · entro 30 nov · {fmtEUR(fiscal.irpefPrevYear * 0.6)}</span>
              <span>{fiscal.irpefAcconto2Paid ? <span className="badge badge-success badge-dot">versato</span> : <span className="badge badge-warning">da pagare</span>}</span>
            </div>
          </div>

          <div style={{ padding: 14, background: "oklch(0.97 0.04 145)", border: "1px solid oklch(0.85 0.10 145)", borderRadius: 4, fontSize: 12.5 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "oklch(0.4 0.15 145)", marginBottom: 8 }}>
              Ritenute d'acconto subite (credito IRPEF)
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span>Compensi soggetti a ritenuta 20%</span>
              <span className="mono">{fmtEUR(tax.compensiConRit)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ color: "var(--text-muted)" }}>Compensi senza ritenuta</span>
              <span className="mono" style={{ color: "var(--text-muted)" }}>{fmtEUR(tax.compensiSenzaRit)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid oklch(0.85 0.10 145)", fontWeight: 700 }}>
              <span>Ritenute già trattenute</span>
              <span className="mono" style={{ color: "oklch(0.4 0.15 145)" }}>−{fmtEUR(tax.ritenutaTrattenuta)}</span>
            </div>
          </div>

          <div style={{ padding: 14, background: "oklch(0.97 0.03 250)", borderRadius: 4, fontSize: 12.5 }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span>IRPEF lorda + addizionali</span>
              <span className="mono">{fmtEUR(tax.irpefLordaTot)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
              <span>− Ritenute scomputate</span>
              <span className="mono" style={{ color: "var(--success)" }}>−{fmtEUR(Math.min(tax.ritenutaTrattenuta, tax.irpefLordaTot))}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 6, borderTop: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
              <span>IRPEF netta da versare</span>
              <span className="mono">{fmtEUR(tax.irpefNetta)}</span>
            </div>
            {tax.ritenutaCredito > 0 && (
              <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--success)", fontWeight: 600 }}>
                ✓ Credito IRPEF riportabile: {fmtEUR(tax.ritenutaCredito)}
              </div>
            )}
            <div style={{ color: "var(--text-secondary)", marginTop: 6, fontSize: 11.5 }}>Cod. F24: 4001 (saldo), 4033/4034 (acconti), 3801/3844 (addizionali)</div>
          </div>
        </div>
      </div>
    </div>
  </div>
);

// ===== Cassa =====
const TaxCassa = ({ tax, fiscal, studio, onUpdateFiscal }) => {
  const cassaName = studio?.cassaName || "Cassa previdenziale";
  // Default aliquote per cassa
  const cassaDefaults = {
    "Inarcassa": { sogg: 14.5, integ: 4, note: "Soggettivo 14,5% + integrativo 4% in fattura" },
    "Cassa Forense": { sogg: 14.5, integ: 4, note: "Soggettivo min. 14,5% + integrativo 4% in fattura" },
    "Cassa Geometri": { sogg: 12, integ: 4, note: "Soggettivo 12% + integrativo 4% in fattura" },
    "ENPAP": { sogg: 10, integ: 2, note: "Soggettivo 10% + integrativo 2% in fattura" },
    "ENPACL": { sogg: 12, integ: 4, note: "Soggettivo 12% + integrativo 4% in fattura" },
    "Gestione Separata INPS": { sogg: 26.07, integ: 0, note: "Aliquota unica 26,07% (no integrativo)" },
  };
  const def = cassaDefaults[cassaName] || { sogg: 14.5, integ: 4, note: "" };
  const integPct = def.integ;

  const updateFiscal = (patch) => onUpdateFiscal && onUpdateFiscal({ ...fiscal, ...patch });

  return (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header">
        <div>
          <h3>{cassaName}</h3>
          <div className="subtitle">Contributo soggettivo {fiscal.cassaContribPct}% su reddito netto</div>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Editable rate */}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <label style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>Aliquota soggettiva</label>
            <div className="input-group" style={{ width: 120 }}>
              <input
                type="number" step="0.5" min="0" max="50"
                className="input mono"
                value={fiscal.cassaContribPct}
                onChange={e => updateFiscal({ cassaContribPct: +e.target.value })}
              />
              <div className="addon">%</div>
            </div>
          </div>
          {def.note && <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" }}>{def.note}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>Reddito netto al lordo cassa</span>
            <span className="mono">{fmtEUR(tax.reddNettoLordoCassa)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>× aliquota soggettiva</span>
            <span className="mono">{fiscal.cassaContribPct}%</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 15 }}>
            <span>Contributo soggettivo annuo</span>
            <span className="mono">{fmtEUR(tax.contribCassa)}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Il contributo è <strong>integralmente deducibile</strong> dal reddito imponibile IRPEF dell'anno di versamento.
          </div>
          {/* Acconti — toggleable */}
          <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Acconti cassa (su anno precedente)</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, marginBottom: 6 }}>
              <span>1° acconto (50%) · 30 giu · {fmtEUR(fiscal.cassaPrevYear * 0.5)}</span>
              <button className={"btn btn-sm " + (fiscal.cassaAcconto1Paid ? "btn-primary" : "")}
                onClick={() => updateFiscal({ cassaAcconto1Paid: !fiscal.cassaAcconto1Paid })}>
                {fiscal.cassaAcconto1Paid ? "✓ Versato" : "Da versare"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
              <span>2° acconto (50%) · 30 nov · {fmtEUR(fiscal.cassaPrevYear * 0.5)}</span>
              <button className={"btn btn-sm " + (fiscal.cassaAcconto2Paid ? "btn-primary" : "")}
                onClick={() => updateFiscal({ cassaAcconto2Paid: !fiscal.cassaAcconto2Paid })}>
                {fiscal.cassaAcconto2Paid ? "✓ Versato" : "Da versare"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    {integPct > 0 ? (
      <div className="card">
        <div className="card-header"><h3>Contributo integrativo ({integPct}%)</h3></div>
        <div className="card-body">
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 12 }}>
            Il <strong>{integPct}% di cassa</strong> applicato in fattura ai clienti è dovuto interamente alla cassa previdenziale (giro di partita).
          </div>
          <div style={{ background: "var(--bg-sunken)", padding: 14, borderRadius: 4, fontSize: 13 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span>Volume compensi</span>
              <span className="mono">{fmtEUR(tax.compensi)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
              <span>Contributo integrativo ({integPct}%)</span>
              <span className="mono">{fmtEUR(tax.compensi * integPct / 100)}</span>
            </div>
          </div>
        </div>
      </div>
    ) : (
      <div className="card">
        <div className="card-header"><h3>Aliquota unica</h3></div>
        <div className="card-body">
          <div style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            La Gestione Separata INPS prevede un'aliquota unica ({fiscal.cassaContribPct}%) senza contributo integrativo separato. L'intero contributo è a carico del professionista.
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

// ===== IRAP (solo ditta individuale) =====
const TaxIRAP = ({ tax, fiscal, fiscalYear, onUpdateFiscal }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header">
        <div>
          <h3>IRAP — Imposta Regionale Attività Produttive</h3>
          <div className="subtitle">Dovuta solo in presenza di autonoma organizzazione</div>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>Reddito netto</span>
            <span className="mono">{fmtEUR(tax.reddNettoLordoCassa)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>− Deduzione forfettaria</span>
            <span className="mono">− {fmtEUR(8000)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>= Base imponibile IRAP</span>
            <span className="mono">{fmtEUR(tax.irapBase)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <label style={{ fontSize: 12.5, color: "var(--text-secondary)", flex: 1 }}>Aliquota IRAP</label>
            <div className="input-group" style={{ width: 120 }}>
              <input type="number" step="0.1" min="0" max="10" className="input mono"
                value={fiscal.irapPct || 3.9}
                onChange={e => onUpdateFiscal && onUpdateFiscal({ ...fiscal, irapPct: +e.target.value })}
              />
              <div className="addon">%</div>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 15 }}>
            <span>IRAP stimata</span>
            <span className="mono">{fmtEUR(tax.irap)}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            La base imponibile include anche compensi di eventuali collaboratori. Se non hai autonoma organizzazione (lavori da solo senza dipendenti o beni strumentali rilevanti), potresti essere esente — verifica con il tuo commercialista.
          </div>
        </div>
      </div>
    </div>
    <div className="card">
      <div className="card-header"><h3>Scadenze IRAP {fiscalYear}</h3></div>
      <div className="card-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12.5 }}>
          <div style={{ padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: 4 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Saldo {parseInt(fiscalYear)-1} + 1° acconto {fiscalYear}</div>
            <div style={{ color: "var(--text-secondary)" }}>Entro il 30 giugno · cod. tributo 3800</div>
            <div className="mono" style={{ marginTop: 4, fontWeight: 600 }}>{fmtEUR(tax.irap * 0.4)}</div>
          </div>
          <div style={{ padding: "10px 12px", background: "var(--bg-sunken)", borderRadius: 4 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>2° acconto {fiscalYear}</div>
            <div style={{ color: "var(--text-secondary)" }}>Entro il 30 novembre · cod. tributo 3800</div>
            <div className="mono" style={{ marginTop: 4, fontWeight: 600 }}>{fmtEUR(tax.irap * 0.6)}</div>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Codice regione: dipende dalla regione di domicilio fiscale.</div>
        </div>
      </div>
    </div>
  </div>
);

// ===== F24 calendar =====
const TaxF24 = ({ fiscal, tax, fiscalYear, onUpdateFiscal }) => {
  const months = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const currentRealMonth = new Date().getMonth();
  const allF24 = tax.f24All || [];
  const byMonth = {};
  allF24.forEach(f => {
    const m = +f.date.split("-")[1];
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(f);
  });

  const markPaid = (id) => {
    if (!onUpdateFiscal) return;
    const now = new Date().toISOString().slice(0, 10);
    // If it's a generated entry (_generated), move it into fiscal.f24History as confirmed paid
    const existing = allF24.find(f => f.id === id);
    if (!existing) return;
    const confirmedEntry = { ...existing, status: "paid", paidDate: now, _generated: false };
    const manualHistory = (fiscal.f24History || []).filter(f => f.id !== id);
    onUpdateFiscal({ ...fiscal, f24History: [...manualHistory, confirmedEntry] });
  };

  return (
    <div className="card">
      <div className="card-header">
        <div>
          <h3>Calendario F24 — anno {fiscalYear}</h3>
          <div className="subtitle">Tutte le scadenze fiscali in un unico calendario</div>
        </div>
        <button className="btn btn-sm">
          <Icon name="download" size={12} /> Esporta calendario .ics
        </button>
      </div>
      <div className="card-body">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 8, marginBottom: 24 }}>
          {months.map((m, i) => {
            const evts = byMonth[i + 1] || [];
            const isPast = i < currentRealMonth;
            const isCurrent = i === currentRealMonth;
            return (
              <div key={m} style={{
                border: "1px solid " + (isCurrent ? "var(--accent)" : "var(--border)"),
                borderRadius: 4,
                padding: 8,
                background: isCurrent ? "oklch(0.97 0.03 250)" : isPast ? "var(--bg-sunken)" : "var(--bg-elevated)",
                minHeight: 100,
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 6, color: isCurrent ? "var(--accent)" : "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{m}</div>
                {evts.map(f => (
                  <div key={f.id} style={{
                    fontSize: 10,
                    padding: "3px 5px",
                    background: f.status === "paid" ? "oklch(0.95 0.06 145)" : f.status === "scheduled" ? "oklch(0.96 0.08 80)" : "var(--bg-hover)",
                    color: f.status === "paid" ? "oklch(0.4 0.15 145)" : f.status === "scheduled" ? "#92400e" : "var(--text-secondary)",
                    borderRadius: 3,
                    marginBottom: 3,
                    lineHeight: 1.3,
                  }}>
                    <div style={{ fontWeight: 600 }}>{f.code}</div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 9.5 }}>{f.amount > 0 ? fmtEUR(f.amount) : "stim."}</div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>

        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 100 }}>Data</th>
              <th style={{ width: 70 }}>Codice</th>
              <th>Descrizione</th>
              <th className="num">Importo</th>
              <th>Stato</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {allF24.map(f => (
              <tr key={f.id}>
                <td className="mono">{new Date(f.date).toLocaleDateString("it-IT")}</td>
                <td className="mono"><strong>{f.code}</strong></td>
                <td>{f.desc}</td>
                <td className="num mono"><strong>{f.amount > 0 ? fmtEUR(f.amount) : <span style={{ color: "var(--text-muted)" }}>stimato</span>}</strong></td>
                <td>
                  {f.status === "paid" && <span className="badge badge-success badge-dot">Versato</span>}
                  {f.status === "scheduled" && <span className="badge badge-warning badge-dot">Programmato</span>}
                  {f.status === "estimated" && <span className="badge">Da quantificare</span>}
                </td>
                <td style={{ display: "flex", gap: 4 }}>
                  {f.status !== "paid" && onUpdateFiscal && (
                    <button className="btn btn-sm" onClick={() => markPaid(f.id)}>
                      ✓ Versato
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

window.Taxes = Taxes;
