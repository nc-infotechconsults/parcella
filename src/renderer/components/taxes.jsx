// ============ Tasse & contributi ============
// Supporta: libero professionista, ditta individuale.
// studio.tipoSoggetto: "professionista" | "ditta_individuale" | "societa"

// Contributi + IRPEF for one fiscal year, from that year's merged figures.
// Pure: no reference to the year on screen, so the same code sizes this year's
// liability and last year's, which is what the acconti are based on.
// `contributiVersati` è il contributo previdenziale EFFETTIVAMENTE pagato
// nell'anno: si deduce per cassa (art. 10 TUIR), non per competenza. Il
// chiamante lo ricava dai versamenti, non da un'aliquota.
function taxLiability(fy, fiscal, tipo, contributiVersati) {
  const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
  // Un campo svuotato in Impostazioni torna al default; uno messo a zero resta
  // zero, perché "nessuna addizionale comunale" è una risposta legittima.
  const num = (v, def) => (v == null || v === "" || isNaN(Number(v)) ? def : Number(v));
  const compensi = fy.consuntivo.ricaviIncassati;
  const costiDeducibili = fy.consuntivo.costiDeducibili;
  const costiEsercizio = fy.consuntivo.costiEsercizio;
  const quoteAmmortamento = fy.consuntivo.quoteAmmortamento;
  const ritenuta = fy.consuntivo.ritenutaIncassata;
  const contribDedotti = Math.max(0, num(contributiVersati, 0));

  // Le aliquote effettive si risolvono UNA volta qui e vengono restituite: la
  // schermata le mostra da qui invece di rileggere fiscal.* e riapplicare un
  // default proprio, che è come un'aliquota svuotata in Impostazioni poteva
  // comparire a video diversa da quella usata nel conto.
  const aliquote = {
    cassaContribPct: num(fiscal.cassaContribPct, 14.5),
    addRegPct: num(fiscal.addRegPct, 0),
    addComPct: num(fiscal.addComPct, 0),
    irapPct: num(fiscal.irapPct, 3.9),
    inpsMinimale: num(fiscal.inpsMinimale, 4427),
    inpsPctVariabile: num(fiscal.inpsPctVariabile, 24.0),
  };

  const reddNettoLordoCassa = Math.max(0, compensi - costiDeducibili);
  let contribCassa = 0;
  let contribFisso = 0;    // minimale INPS ditta
  let contribVar = 0;      // variabile su eccedente (ditta)
  let irapBase = 0;
  let irap = 0;

  if (tipo === "professionista") {
    contribCassa = Math.max(0, reddNettoLordoCassa * aliquote.cassaContribPct / 100);
  } else if (tipo === "ditta_individuale") {
    // INPS artigiani/commercianti: fisso (minimale) + variabile su eccedente
    const reddBase = 18415; // reddito minimale INPS 2025 (fissato INPS)
    contribFisso = aliquote.inpsMinimale;
    contribVar = Math.max(0, (reddNettoLordoCassa - reddBase) * aliquote.inpsPctVariabile / 100);
    contribCassa = contribFisso + contribVar;
    // IRAP solo se autonoma organizzazione (lasciamo all'utente configurare)
    irapBase = Math.max(0, reddNettoLordoCassa - 8000); // deduzione base €8k
    irap = irapBase * aliquote.irapPct / 100;
  }

  // Compensi incassati − costi di esercizio dell'anno − quote di ammortamento
  // (anche di acquisti di anni precedenti) − contributi versati nell'anno.
  // Prima si sottraeva il contributo MATURATO su quest'anno, che non è ancora
  // stato versato e quindi non è ancora deducibile.
  const redditoImpIrpef = Math.max(0, reddNettoLordoCassa - contribDedotti);
  // L'ultimo scaglione non ha tetto, e il profilo lo registra come upTo: null.
  // Math.min(reddito, null) vale 0, quindi l'aliquota massima si applicava a
  // niente e tutto il reddito oltre il penultimo scaglione era tassato a zero.
  const brackets = (fiscal.irpefBrackets && fiscal.irpefBrackets.length)
    ? fiscal.irpefBrackets
    : [{ upTo: 28000, rate: 23 }, { upTo: 50000, rate: 35 }, { upTo: null, rate: 43 }];
  let irpefLorda = 0, prevBracket = 0;
  for (const b of brackets) {
    const cap = num(b.upTo, Infinity);
    const inBracket = Math.max(0, Math.min(redditoImpIrpef, cap) - prevBracket);
    irpefLorda += inBracket * num(b.rate, 0) / 100;
    prevBracket = cap;
    if (redditoImpIrpef <= cap) break;
  }
  const addReg = redditoImpIrpef * aliquote.addRegPct / 100;
  const addCom = redditoImpIrpef * aliquote.addComPct / 100;
  const irpefLordaTot = irpefLorda + addReg + addCom;

  // Le ritenute d'acconto subite si scomputano dall'IRPEF e da nient'altro: le
  // addizionali restano dovute per intero e si pagano con codici propri. Prima
  // le ritenute si toglievano dal totale IRPEF + addizionali, e un'eccedenza di
  // ritenute sull'IRPEF faceva sparire anche le addizionali.
  const irpefSola = r2(Math.max(0, irpefLorda - ritenuta));
  return {
    aliquote, brackets,
    compensi, costiDeducibili, costiEsercizio, quoteAmmortamento, ritenuta,
    contributiVersati: contribDedotti,
    reddNettoLordoCassa,
    contribCassa: r2(contribCassa), contribFisso, contribVar, irapBase, irap,
    redditoImpIrpef, irpefLorda, addReg, addCom, irpefLordaTot,
    irpefSola, addRegDovuta: r2(addReg), addComDovuta: r2(addCom),
    irpefNetta: r2(irpefSola + addReg + addCom),
    ritenutaCredito: Math.max(0, ritenuta - irpefLorda),
  };
}
window.taxLiability = taxLiability;

function computeTaxes(activities, expenses, fiscal, year, clients, studio, invoices) {
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const _clients = clients || window.APP_DATA.clients;
  const tipo = (studio && studio.tipoSoggetto) || "professionista";
  const yr = String(year);

  const yearAct = activities.filter(a => a.monthKey.startsWith(yr + "-"));
  const yearExp = expenses.filter(e => e.monthKey.startsWith(yr + "-"));

  // Invoices are accounting truth; the timesheet only covers what is not yet
  // invoiced (spec §4.2). The previsionale block below reuses the existing
  // per-month billing logic through computeFiscalYear.
  const fy = window.computeFiscalYear({
    year, invoices: invoices || [], activities, expenses, clients: _clients, fiscal,
    computeInvoiceAmounts: window.computeInvoiceAmounts,
  });

  // For non-hourly clients, pre-compute one billing entry per (clientId, monthKey).
  // This prevents monthly/project rates from being summed per-activity instead of per-month.
  const nonHourlyMonthBillings = (() => {
    const seen = new Set();
    const result = [];
    for (const a of yearAct) {
      const c = _clients.find(x => x.id === a.clientId);
      if (!c || !c.billingType || c.billingType === 'hourly') continue;
      const key = `${a.clientId}::${a.monthKey}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const totalHours = yearAct
        .filter(x => x.clientId === a.clientId && x.monthKey === a.monthKey)
        .reduce((s, x) => s + x.hours, 0);
      result.push({ c, monthKey: a.monthKey, ...computeInvoiceAmounts(c, totalHours) });
    }
    return result;
  })();

  // ── Ricavi ────────────────────────────────────────────────────────────────
  // Base CASSA (art. 54 TUIR), chosen by the user: for a professionista the
  // taxable base is what was actually INCASSATO and actually PAGATO. Fatturato,
  // da incassare and previsionale stay visible as information, outside the
  // base — pairing accrual revenue with cash costs inflated the income.
  const ricaviFatturati = fy.consuntivo.ricavi;
  const ricaviPrevisionali = fy.previsionale.ricavi;
  const ricaviIncassati = fy.consuntivo.ricaviIncassati;
  const daIncassare = Math.round((ricaviFatturati - ricaviIncassati) * 100) / 100;
  const compensi = ricaviIncassati;

  // La ritenuta d'acconto è operata al pagamento, non all'emissione.
  const ritenutaTrattenuta = fy.consuntivo.ritenutaIncassata;
  const compensiConRit = ricaviIncassati;
  const compensiSenzaRit = compensi - compensiConRit;

  // ── IVA ───────────────────────────────────────────────────────────────────
  const ivaDebito = fy.consuntivo.ivaDebito;
  const ivaCredito = fy.consuntivo.ivaCredito;

  // ── Costi deducibili ──────────────────────────────────────────────────────
  const costiDeducibili = fy.consuntivo.costiDeducibili;

  // ── Scadenzario ───────────────────────────────────────────────────────────
  // Le scadenze vengono dallo schema (f24-scheme.js): qui si calcola soltanto
  // QUANTO si deve. Le righe registrate sono l'unica fonte dei versamenti.
  const { scheme, source: schemeSource, warning: schemeWarning } = window.activeScheme(fiscal, studio);
  const amountOf = window.amountOf;
  const isFact = f => f.status === "paid" || f.status === "scheduled";
  // Una riga scritta prima dello scadenzario non dice a quale tributo
  // appartiene. La migrazione glielo assegna al caricamento; finché non l'ha
  // fatto, il tributo si deduce dal codice come lo usava l'app di prima, così i
  // numeri di chi non ha ancora migrato restano quelli di oggi. Una riga a cui
  // la migrazione non ha saputo dare un tributo porta tributo: null, e non deduce.
  const recorded = (fiscal.f24History || []).map(f => (f.tributo === undefined
    ? { ...f, tributo: window.inferTributo(f.code, scheme, { legacy: true }) }
    : f));

  // ── Contributi versati (deduzione per cassa) ──────────────────────────────
  // Il contributo previdenziale si deduce nell'anno in cui lo VERSI: è la somma
  // delle righe versate quell'anno il cui tributo, nello schema, è un
  // contributo. Decide il tributo, non il codice: il 3801 che l'app usava per i
  // contributi è in realtà l'addizionale regionale.
  const contributiPagatiIn = (anno) => round2(recorded
    .filter(f => f.status === "paid"
      && window.kindOf(f, scheme) === "contributo"
      && String(f.date || "").startsWith(anno + "-"))
    .reduce((s, f) => s + amountOf(f.amount), 0));

  // ── Anno precedente (metodo storico) ──────────────────────────────────────
  // Gli acconti si misurano sull'anno scorso. Dove l'archivio ne contiene i
  // documenti la base si calcola da quelli; altrimenti vale il ripiego scritto
  // nel tributo dello schema.
  const prevYr = Number(yr) - 1;
  // Un anno di soli costi non è un anno di cui si conoscano i compensi: la prova
  // che serve è un ricavo, non un documento qualunque.
  const hasPrevData = (invoices || []).some(i =>
    i.direction === "active" && !i.reverseCharge && String(i.date || "").startsWith(prevYr + "-"));
  const fyPrev = hasPrevData ? window.computeFiscalYear({
    year: prevYr, invoices: invoices || [], activities, expenses, clients: _clients, fiscal,
    computeInvoiceAmounts: window.computeInvoiceAmounts,
  }) : null;
  const prevLiab = fyPrev ? taxLiability(fyPrev, fiscal, tipo, contributiPagatiIn(prevYr)) : null;
  const tributiByBase = base => (scheme.tributi || []).filter(t => t.base === base);
  const fallbackOf = base => round2(tributiByBase(base)
    .reduce((s, t) => s + amountOf(t.acconti ? t.acconti.fallbackPrevYear : 0), 0));
  const prev = prevLiab
    ? { ...prevLiab, derived: true }
    : { contribCassa: fallbackOf("contribCassa"), irpefNetta: fallbackOf("irpef"), derived: false };

  const cassaLabel = (studio && studio.cassaName) === "Gestione Separata INPS" ? "INPS" : "cassa";
  const cassaTributo = tributiByBase("contribCassa")[0];
  const cassaAccontoPct = cassaTributo && cassaTributo.acconti && cassaTributo.acconti.metodo === "storico"
    ? amountOf(cassaTributo.acconti.pct) : 0;

  const contributiVersati = contributiPagatiIn(yr);

  // ── Contributi e IRPEF ────────────────────────────────────────────────────
  // taxLiability() vale per qualunque anno, perché gli acconti si misurano su
  // quello precedente e va quindi calcolato anche per quello.
  const cur = taxLiability(fy, fiscal, tipo, contributiVersati);
  const {
    reddNettoLordoCassa, contribCassa, contribFisso, contribVar, irapBase, irap,
    redditoImpIrpef, irpefLorda, addReg, addCom, irpefLordaTot, irpefNetta,
    ritenutaCredito, costiEsercizio, quoteAmmortamento,
  } = cur;

  // ── IVA trimestrale ───────────────────────────────────────────────────────
  // Scadenze: professionista trimestrale con +1%; ditta può essere mensile
  const ivaDeadlines = [
    { id: "Q1", label: "1° trim (gen-mar)", deadline: "16 maggio (+1%)", months: ["01","02","03"] },
    { id: "Q2", label: "2° trim (apr-giu)", deadline: "20 agosto (+1%)", months: ["04","05","06"] },
    { id: "Q3", label: "3° trim (lug-set)", deadline: "16 novembre (+1%)", months: ["07","08","09"] },
    { id: "Q4", label: "4° trim (ott-dic)", deadline: "16 marzo anno succ.", months: ["10","11","12"] },
  ];
  const trimestri = ivaDeadlines.map(qt => {
    // computeFiscalYear returns four quarters under quarterly liquidation and
    // twelve months under monthly. Match on the months each period covers
    // rather than on its id, and fold whatever we got into this table's four
    // rows: matching by id would silently render every quarter as zero for a
    // profile set to 'mensile'.
    const parts = fy.periods.filter(p => p.months.every(m => qt.months.includes(m)));
    const sum = pick => Math.round(parts.reduce((s, p) => s + (p[pick] || 0), 0) * 100) / 100;
    return {
      ...qt,
      debit: sum('ivaDebito'),
      credit: sum('ivaCredito'),
      reverse: sum('ivaReverse'),
      saldo: sum('saldo'),
      // The F24 generator below reads `balance`; the liquidation saldo is what
      // actually gets paid, so it keeps that name too.
      balance: sum('saldo'),
    };
  });

  // ── Scadenze F24 dallo schema ─────────────────────────────────────────────
  const basesOf = l => ({
    irpef: l.irpefSola, addReg: l.addRegDovuta, addCom: l.addComDovuta,
    contribCassa: l.contribCassa, contribFisso: l.contribFisso, contribVar: l.contribVar, irap: l.irap,
  });
  const periodsOf = f => (f ? f.periods.map(p => ({ months: p.months, saldo: p.saldo })) : null);
  const basedOn = prev.derived ? `su ${prevYr} effettivo` : `su ${prevYr}`;
  const schedule = rows => window.scheduleFromScheme({
    scheme, year: parseInt(yr), bases: basesOf(cur), prevBases: prevLiab ? basesOf(prevLiab) : null,
    ivaPeriods: periodsOf(fy), prevIvaPeriods: periodsOf(fyPrev), recorded: rows, basedOn,
  });

  // Una riga registrata prima dello scadenzario non ha slot. Se cade nella
  // stessa data di una proposta, con il codice nuovo o con quello che il
  // generatore di prima le dava, è quella scadenza: prende lo slot, così ne
  // sopprime la stima e il saldo usa il suo importo. La migrazione fa lo stesso
  // in modo permanente; questo vale per i dati non ancora migrati.
  const legacyCodeOf = p => window.LEGACY_CODES[p.slot.split("/").slice(0, 2).join("/")];
  const sameDeadline = (f, p) => p.date === f.date
    && (String(f.code) === p.code || String(f.code) === legacyCodeOf(p));
  const firstPass = schedule(recorded);
  const claimed = new Set(recorded.filter(f => f.slot).map(f => f.slot));
  const slotted = recorded.map(f => {
    if (f.slot || !isFact(f)) return f;
    const match = firstPass.proposals.find(p => !claimed.has(p.slot) && sameDeadline(f, p));
    if (!match) return f;
    claimed.add(match.slot);
    return { ...f, slot: match.slot, tributo: f.tributo || match.tributo };
  });
  const sched = schedule(slotted);

  // Una riga registrata "stimata" non è un fatto: la stima calcolata dalle
  // fatture, che è più fresca, prende il suo posto per la stessa scadenza.
  const propSlots = new Set(sched.proposals.map(p => p.slot));
  const shadowed = f => !isFact(f)
    && ((f.slot && propSlots.has(f.slot)) || sched.proposals.some(p => sameDeadline(f, p)));
  const f24All = [
    ...sched.proposals,
    ...slotted.filter(f => !shadowed(f)).map(f => ({ ...f, kind: window.kindOf(f, scheme) })),
  ].map(f => ({ ...f, status: f.status || "estimated" }))
   .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  // Acconti e saldi per i pannelli, sommati sui tributi con quella base: con
  // uno schema senza tributi su quella base valgono zero.
  const sumOver = (map, base) => round2(tributiByBase(base).reduce((s, t) => s + (map[t.id] || 0), 0));
  const accontiCassa = sumOver(sched.acconti, "contribCassa");
  const saldoCassa = sumOver(sched.saldi, "contribCassa");
  const accontiIrpef = sumOver(sched.acconti, "irpef");
  const saldoIrpef = sumOver(sched.saldi, "irpef");

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
    costiEsercizio,
    quoteAmmortamento,
    contributiVersati,
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
    fy,
    ricaviFatturati,
    ricaviPrevisionali,
    ricaviIncassati,
    daIncassare,
    f24All,        // scadenze generate + manuali
    totaleAnno,
    // Acconti e delta (metodo storico)
    aliquote: cur.aliquote,
    brackets: cur.brackets,
    prevYear: prev,
    prevYr,
    cassaAccontoPct,
    cassaLabel,
    accontiCassa,
    accontiIrpef,
    saldoCassa,
    saldoIrpef,
    // Scadenzario
    scheme, schemeSource, schemeWarning,
    saldi: sched.saldi, acconti: sched.acconti, crediti: sched.crediti,
    irpefSola: cur.irpefSola, addRegDovuta: cur.addRegDovuta, addComDovuta: cur.addComDovuta,
  };
}
window.computeTaxes = computeTaxes;

const Taxes = ({ activities, expenses, fiscal, clients, studio, invoices, year: taxYear, onUpdateFiscal }) => {
  const [tab, setTab] = useState("overview");
  const fiscalYear = String(taxYear || new Date().getFullYear());
  const tax = computeTaxes(activities, expenses, fiscal, fiscalYear, clients, studio, invoices);
  const today = new Date();

  // F24 paid/scheduled
  const f24All = tax.f24All || [];
  const f24Paid = f24All.filter(f => f.status === "paid");
  const f24Upcoming = f24All.filter(f => f.status !== "paid").sort((a, b) => a.date.localeCompare(b.date));
  const totalPaid = f24Paid.reduce((s, f) => s + f.amount, 0);
  const totalUpcoming = f24Upcoming.reduce((s, f) => s + f.amount, 0);
  const nextDeadline = f24Upcoming[0];
  const daysToNext = nextDeadline ? Math.ceil((new Date(nextDeadline.date) - today) / 86400000) : null;

  // Segnare versata una scadenza è registrare la riga, con il suo slot: la riga
  // è l'unica fonte dei versamenti. Toglierla è cancellare quella riga, come la
  // ✕ del calendario. Una sola funzione per tutti i pannelli.
  const markPaid = onUpdateFiscal ? (row) => {
    if (!row) return;
    const anno = row.slot ? Number(String(row.slot).split("/")[2]) : row.anno;
    onUpdateFiscal({
      ...fiscal,
      f24History: window.upsertF24Entry(fiscal.f24History || [], {
        ...row, anno, status: "paid", paidDate: new Date().toISOString().slice(0, 10),
      }),
    });
  } : null;
  const unmarkPaid = onUpdateFiscal ? (row) => {
    if (!row || row._generated) return;
    if (!window.confirm("Togliere il versamento registrato per questa scadenza?")) return;
    onUpdateFiscal({ ...fiscal, f24History: window.removeF24Entry(fiscal.f24History || [], row.id) });
  } : null;

  return (
    <div className="content">
      {/* Hero KPIs */}
      <div className="kpi-grid" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        <div className="kpi" style={{ borderLeft: "3px solid var(--accent)" }}>
          <div className="kpi-label">Stima carico fiscale {fiscalYear}</div>
          <div className="kpi-value tabular">{fmtEUR(tax.totaleAnno)}</div>
          <div className="kpi-meta">
            <span>{tax.compensi > 0 ? ((tax.totaleAnno / tax.compensi) * 100).toFixed(1) : 0}% sui compensi</span>
          </div>
        </div>
        <div className="kpi">
          <div className="kpi-label">{t('dash.revenue')} {fiscalYear} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>· {t('tax.basisCash')}</span></div>
          <div className="kpi-value tabular">{fmtEUR(tax.compensi)}</div>
          <div className="kpi-meta">
            <span>{t('tax.invoiced')} {fmtEUR(tax.ricaviFatturati)}</span>
            <span> · {t('dash.toCollect')} {fmtEUR(tax.daIncassare)}</span>
            <span> · {t('tax.forecast')} {fmtEUR(tax.ricaviPrevisionali)}</span>
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
        <button className={tab === "assets" ? "active" : ""} onClick={() => setTab("assets")}>{t('tax.assets')}</button>
      </div>

      {tab === "overview" && (
        <TaxOverview tax={tax} fiscal={fiscal} f24Upcoming={f24Upcoming} fiscalYear={fiscalYear} studio={studio} />
      )}
      {tab === "iva" && (
        <TaxIVA tax={tax} fiscal={fiscal} fiscalYear={fiscalYear} onMark={markPaid} onUnmark={unmarkPaid} />
      )}
      {tab === "irpef" && (
        <TaxIRPEF tax={tax} fiscal={fiscal} fiscalYear={fiscalYear} onMark={markPaid} onUnmark={unmarkPaid} />
      )}
      {tab === "cassa" && (
        <TaxCassa tax={tax} fiscal={fiscal} studio={studio} fiscalYear={fiscalYear} onMark={markPaid} onUnmark={unmarkPaid} />
      )}
      {tab === "irap" && tax.tipo === "ditta_individuale" && (
        <TaxIRAP tax={tax} fiscal={fiscal} fiscalYear={fiscalYear} onMark={markPaid} onUnmark={unmarkPaid} />
      )}
      {tab === "f24" && (
        <TaxF24 fiscal={fiscal} tax={tax} fiscalYear={fiscalYear} onUpdateFiscal={onUpdateFiscal} onMark={markPaid} onUnmark={unmarkPaid} />
      )}
      {tab === "assets" && (
        <div className="card">
          <table className="data">
            <thead>
              <tr>
                <th>{t('inv.asset')}</th>
                <th style={{ width: 100 }}>{t('inv.date')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetCost')}</th>
                <th className="num" style={{ width: 70 }}>{t('tax.assetYears')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetQuota')}</th>
                <th className="num" style={{ width: 110 }}>{t('tax.assetResidual')}</th>
              </tr>
            </thead>
            <tbody>
              {tax.fy.cespiti.length === 0 && (
                <tr><td colSpan={6}><div className="empty-state"><div className="title">{t('tax.noAssets')}</div></div></td></tr>
              )}
              {/* Oldest first: the list spans every year still deducting, not
                  just this year's purchases. An exhausted schedule is dimmed
                  rather than hidden — the asset is still on the books. */}
              {tax.fy.cespiti.slice()
                .sort((a, b) => String(a.date).localeCompare(String(b.date)))
                .map(c => (
                <tr key={c.source + ":" + c.id} style={c.quotaYear === 0 ? { color: "var(--text-muted)" } : null}>
                  <td>
                    {c.desc}
                    {c.startYear < parseInt(fiscalYear) && (
                      <span className="badge" style={{ marginLeft: 6 }}>{c.startYear}</span>
                    )}
                  </td>
                  <td className="mono">{c.date}</td>
                  <td className="num mono">{fmtEUR(c.cost)}</td>
                  <td className="num mono">{c.years}{c.firstYearHalf ? "½" : ""}</td>
                  <td className="num mono"><strong>{fmtEUR(c.quotaYear)}</strong></td>
                  <td className="num mono">{fmtEUR(c.residual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
    { label: "Compensi incassati", value: tax.compensi, type: "in" },
    { label: "− Costi di esercizio dell'anno", value: -tax.costiEsercizio, type: "neg" },
    { label: "− Quote di ammortamento", value: -tax.quoteAmmortamento, type: "neg" },
    // Si deduce quanto VERSATO nell'anno, non quanto maturato: il contributo
    // dovuto su quest'anno si dedurrà nell'anno in cui lo paghi.
    { label: `− Contributi ${cassaLabel} versati nell'anno`, value: -tax.contributiVersati, type: "neg" },
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
const TaxIVA = ({ tax, fiscal, fiscalYear, onMark, onUnmark }) => (
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
          <th className="num">{t('tax.reverseNeutral')}</th>
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
            <td className="num mono" style={{ color: "var(--text-muted)" }} title={t('tax.reverseNeutral')}>
              {fmtEUR(q.reverse)}
            </td>
            <td className="num mono"><strong>{fmtEUR(Math.max(0, q.balance))}</strong></td>
            <td>
              {(() => {
                const r = (tax.f24All || []).find(f => f.slot === `iva/${q.id.toLowerCase()}/${fiscalYear}`);
                return r && r.status === "paid";
              })()
                ? <span className="badge badge-success badge-dot">Versato {fmtEUR((tax.f24All || []).find(f => f.slot === `iva/${q.id.toLowerCase()}/${fiscalYear}`).amount)}</span>
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
          <td className="num mono" style={{ color: "var(--text-muted)" }}>{fmtEUR(tax.fy.consuntivo.ivaReverse)}</td>
          <td className="num mono">{fmtEUR(tax.ivaSaldo)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
      <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
        <strong style={{ color: "var(--text)" }}>Codici tributo F24:</strong> 6031, 6032, 6033 per i primi tre trimestri, 6099 per il
        saldo annuale di marzo (che comprende il quarto), 6035 per l'acconto del 27 dicembre — maggiorazione 1% per i
        trimestrali (già inclusa). Il quarto trimestre si paga al netto dell'acconto.
      </div>
    </div>
    <div className="card-body" style={{ borderTop: "1px solid var(--border)" }}>
      <SchemeRows tax={tax} bases={["ivaPeriodo"]} fiscalYear={fiscalYear} onMark={onMark} onUnmark={onUnmark} />
    </div>
  </div>
);

// ===== IRPEF =====
// Gli acconti sono tarati sull'anno scorso; questa riga dice di quanto
// l'andamento reale di quest'anno se ne discosta — cioè cosa resterà da
// versare a saldo, o quanto è stato versato in più.
// Questa schermata legge le aliquote, non le decide: si modificano in
// Impostazioni → Fiscalità, dove le si cambia deliberatamente e non per
// sbaglio mentre si sta leggendo un consuntivo.
const RateFromSettings = ({ label, value }) => (
  <div style={{ display: "flex", alignItems: "baseline", gap: 10, fontSize: 12.5 }}>
    <span style={{ color: "var(--text-secondary)", flex: 1 }}>{label}</span>
    <span className="mono" style={{ fontWeight: 600 }}>{value}</span>
    <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Impostazioni → Fiscalità</span>
  </div>
);

// Le scadenze dello schema per i tributi con una certa base, con lo stato preso
// dalla riga registrata (per slot). Sostituisce le righe fisse 40/60 e le due
// metà dei contributi: con lo schema le rate sono quante e come le dichiari.
const SchemeRows = ({ tax, bases, fiscalYear, onMark, onUnmark }) => {
  const tributi = ((tax.scheme && tax.scheme.tributi) || []).filter(t => bases.includes(t.base));
  if (!tributi.length) return null;
  const year = String(fiscalYear);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {tributi.map(t => {
        const rows = (tax.f24All || [])
          .filter(f => f.tributo === t.id && f.slot && String(f.slot).endsWith("/" + year))
          .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        const nessunAcconto = t.kind !== "iva" && (!t.acconti || t.acconti.metodo !== "storico");
        const credito = tax.crediti && tax.crediti[t.id];
        return (
          <div key={t.id}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t.label}</div>
            {nessunAcconto && !(t.righe || []).some(r => r.quota === "corrente") && (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 6 }}>
                Nessun acconto previsto: l'imposta dell'anno si versa tutta a saldo.
              </div>
            )}
            {rows.map(f => (
              <div key={f.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, marginBottom: 6, gap: 8 }}>
                <span>
                  {f.desc} · entro {new Date(f.date).toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" })}
                  {" · "}<span className="mono">{f.code || "codice da indicare"}</span>
                  {" · "}<span className="mono">{fmtEUR(f.amount)}</span>
                </span>
                {onMark && (f.status === "paid"
                  ? <button className="btn btn-sm btn-primary" onClick={() => onUnmark(f)}>✓ Versato</button>
                  : <button className="btn btn-sm" onClick={() => onMark(f)}>Da versare</button>)}
              </div>
            ))}
            {credito > 0 && (
              <div style={{ fontSize: 12.5, color: "var(--success)" }}>Credito {fmtEUR(credito)}: gli acconti superano il dovuto.</div>
            )}
          </div>
        );
      })}
    </div>
  );
};

const AccontoDelta = ({ dovuto, acconti, delta }) => (
  <div style={{ marginTop: 10, paddingTop: 8, borderTop: "1px dashed var(--border)", fontSize: 12 }}>
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
      <span>Dovuto sull'andamento reale di quest'anno</span>
      <span className="mono">{fmtEUR(dovuto)}</span>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)" }}>
      <span>− acconti impostati sull'anno scorso</span>
      <span className="mono">{fmtEUR(acconti)}</span>
    </div>
    <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, marginTop: 4 }}>
      <span>{delta >= 0 ? "= saldo a giugno prossimo" : "= credito da compensare"}</span>
      <span className="mono" style={{ color: delta >= 0 ? "var(--warning)" : "var(--success)" }}>
        {fmtEUR(Math.abs(delta))}
      </span>
    </div>
  </div>
);

// La derivazione dell'imponibile, riga per riga: ogni voce è calcolata dai
// documenti e dai versamenti, nessuna è un valore impostato a mano.
const IrpefBase = ({ tax }) => {
  const righe = [
    ["Compensi incassati", tax.compensi, null],
    ["− Costi di esercizio dell'anno", -tax.costiEsercizio, null],
    ["− Quote di ammortamento", -tax.quoteAmmortamento,
      tax.fy.cespiti.length ? `${tax.fy.cespiti.filter(c => c.quotaYear > 0).length} cespiti in ammortamento` : null],
    ["− Contributi versati nell'anno", -tax.contributiVersati,
      tax.contributiVersati > 0 ? "dedotti per cassa (art. 10 TUIR)" : "nessun versamento registrato: nulla da dedurre"],
  ];
  return (
    <div className="card-body" style={{ borderBottom: "1px solid var(--border)" }}>
      {righe.map(([label, value, hint], i) => (
        <div key={i} style={{ marginBottom: 6 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
            <span style={{ color: "var(--text-secondary)" }}>{label}</span>
            <span className="mono">{fmtEUR(value)}</span>
          </div>
          {hint && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{hint}</div>}
        </div>
      ))}
      <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, marginTop: 4, borderTop: "1px solid var(--border)", fontWeight: 700, fontSize: 14 }}>
        <span>= Reddito imponibile IRPEF</span>
        <span className="mono">{fmtEUR(tax.redditoImpIrpef)}</span>
      </div>
      {tax.contribCassa > tax.contributiVersati && (
        <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
          Il contributo maturato su quest'anno è {fmtEUR(tax.contribCassa)}: si dedurrà
          nell'anno in cui lo verserai, non in questo.
        </div>
      )}
    </div>
  );
};

const TaxIRPEF = ({ tax, fiscal, fiscalYear, onMark, onUnmark }) => (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header"><h3>Calcolo IRPEF a scaglioni</h3></div>
      <IrpefBase tax={tax} />
      <table className="data">
        <thead>
          <tr>
            <th>Scaglione</th><th className="num">Aliquota</th>
            <th className="num">Imponibile</th><th className="num">Imposta</th>
          </tr>
        </thead>
        <tbody>
          {(() => {
            // Stessa risoluzione del motore (tetto aperto = Infinity), sulla
            // stessa tabella che il motore ha usato: due letture diverse di
            // fiscal.irpefBrackets è come la riga dell'aliquota massima
            // mostrava zero imponibile mentre l'imposta era già sbagliata.
            let prev = 0;
            return tax.brackets.map((b, i) => {
              const cap = (b.upTo == null || b.upTo === "" || isNaN(Number(b.upTo)))
                ? Infinity : Number(b.upTo);
              const rate = Number(b.rate) || 0;
              const inB = Math.max(0, Math.min(tax.redditoImpIrpef, cap) - prev);
              const upToLabel = cap === Infinity ? "oltre" : fmtEUR(cap);
              const lo = prev === 0 ? "0" : fmtEUR(prev);
              prev = cap;
              return (
                <tr key={i}>
                  <td className="mono">{lo} — {upToLabel}</td>
                  <td className="num"><strong>{rate}%</strong></td>
                  <td className="num mono">{fmtEUR(inB)}</td>
                  <td className="num mono">{fmtEUR(inB * rate / 100)}</td>
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
              <span>Addizionale regionale ({tax.aliquote.addRegPct}%)</span>
              <span className="mono">{fmtEUR(tax.addReg)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span>Addizionale comunale ({tax.aliquote.addComPct}%)</span>
              <span className="mono">{fmtEUR(tax.addCom)}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 8, borderTop: "1px solid var(--border)", fontWeight: 700 }}>
              <span>Totale addizionali</span>
              <span className="mono">{fmtEUR(tax.addReg + tax.addCom)}</span>
            </div>
          </div>

          <div style={{ padding: 14, border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              Acconti IRPEF — metodo storico su {tax.prevYr}
              {tax.prevYear.derived
                ? <span className="badge badge-success" style={{ marginLeft: 6 }}>da fatture {tax.prevYr}</span>
                : <span className="badge" style={{ marginLeft: 6 }}>stima inserita a mano</span>}
            </div>
            <SchemeRows tax={tax} bases={["irpef", "addReg", "addCom"]} fiscalYear={fiscalYear} onMark={onMark} onUnmark={onUnmark} />
            {/* Il saldo IRPEF chiude la sola IRPEF: le addizionali hanno saldi e codici propri. */}
            <AccontoDelta dovuto={tax.irpefSola} acconti={tax.accontiIrpef} delta={tax.saldoIrpef} />
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
const TaxCassa = ({ tax, fiscal, studio, fiscalYear, onMark, onUnmark }) => {
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


  return (
  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
    <div className="card">
      <div className="card-header">
        <div>
          <h3>{cassaName}</h3>
          <div className="subtitle">Contributo soggettivo {tax.aliquote.cassaContribPct}% su reddito netto</div>
        </div>
      </div>
      <div className="card-body">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <RateFromSettings label="Aliquota soggettiva" value={tax.aliquote.cassaContribPct + "%"} />
          {def.note && <div style={{ fontSize: 11.5, color: "var(--text-muted)", fontStyle: "italic" }}>{def.note}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>Reddito netto al lordo cassa</span>
            <span className="mono">{fmtEUR(tax.reddNettoLordoCassa)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>× aliquota soggettiva</span>
            <span className="mono">{tax.aliquote.cassaContribPct}%</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", padding: "12px 0", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 15 }}>
            <span>Contributo soggettivo annuo</span>
            <span className="mono">{fmtEUR(tax.contribCassa)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
            <span style={{ color: "var(--text-secondary)" }}>di cui versato nell'anno</span>
            <span className="mono" style={{ color: "var(--success)" }}>{fmtEUR(tax.contributiVersati)}</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.6 }}>
            Il contributo è <strong>integralmente deducibile</strong> dal reddito imponibile
            IRPEF <strong>dell'anno di versamento</strong>: la deduzione in questa schermata è
            quindi {fmtEUR(tax.contributiVersati)}, non il maturato. Spunta le rate versate
            qui sotto, o registra l'F24, perché entri nella deduzione.
          </div>
          {/* Acconti — toggleable */}
          <div style={{ padding: 12, border: "1px solid var(--border)", borderRadius: 4 }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
              Acconti {tax.cassaLabel} — {tax.cassaAccontoPct}% del {tax.prevYr} ({fmtEUR(tax.prevYear.contribCassa)})
              {tax.prevYear.derived
                ? <span className="badge badge-success" style={{ marginLeft: 6 }}>da fatture {tax.prevYr}</span>
                : <span className="badge" style={{ marginLeft: 6 }}>stima inserita a mano</span>}
            </div>
            <SchemeRows tax={tax} bases={["contribCassa", "contribFisso", "contribVar"]} fiscalYear={fiscalYear} onMark={onMark} onUnmark={onUnmark} />
            {tax.tipo === "professionista" && (
              <AccontoDelta dovuto={tax.contribCassa} acconti={tax.accontiCassa} delta={tax.saldoCassa} />
            )}
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
            La Gestione Separata INPS prevede un'aliquota unica ({tax.aliquote.cassaContribPct}%) senza contributo integrativo separato. L'intero contributo è a carico del professionista.
          </div>
        </div>
      </div>
    )}
  </div>
  );
};

// ===== IRAP (solo ditta individuale) =====
const TaxIRAP = ({ tax, fiscal, fiscalYear, onMark, onUnmark }) => (
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
          <div style={{ paddingTop: 8, borderTop: "1px solid var(--border)" }}>
            <RateFromSettings label="Aliquota IRAP" value={tax.aliquote.irapPct + "%"} />
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
          <SchemeRows tax={tax} bases={["irap"]} fiscalYear={fiscalYear} onMark={onMark} onUnmark={onUnmark} />
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Codice regione: dipende dalla regione di domicilio fiscale.</div>
        </div>
      </div>
    </div>
  </div>
);

// ===== F24 calendar =====
const TaxF24 = ({ fiscal, tax, fiscalYear, onUpdateFiscal, onMark }) => {
  const months = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
  const currentRealMonth = new Date().getMonth();
  const allF24 = tax.f24All || [];
  const byMonth = {};
  allF24.forEach(f => {
    const m = +f.date.split("-")[1];
    if (!byMonth[m]) byMonth[m] = [];
    byMonth[m].push(f);
  });

  const markPaid = (id) => onMark && onMark(allF24.find(f => f.id === id));

  // ── Voci registrate a mano ───────────────────────────────────────────────
  // Senza questo l'unico gesto possibile era spuntare "Versato" su una riga
  // già presente, con l'importo che aveva: un versamento vero che il calcolo
  // non prevede — una rata INPS quando la base dell'anno prima è vuota — non
  // aveva modo di entrare, e restava fuori dalla deduzione per cassa.
  const scheme = tax.scheme || { tributi: [] };
  const defaultTributo = (scheme.tributi.find(t => t.kind === "contributo") || scheme.tributi[0] || {}).id || null;
  const emptyDraft = {
    id: null, date: `${fiscalYear}-06-30`, code: "", desc: "", amount: "", status: "paid",
    tributo: defaultTributo, slot: "", anno: Number(fiscalYear),
  };
  const [draft, setDraft] = useState(emptyDraft);
  // Le scadenze del tributo scelto, di quest'anno e dell'anno prima: un saldo si
  // versa l'anno dopo, e "Saldo IRPEF 2025" pagato a giugno è dell'anno prima.
  const slotOptions = draft.tributo
    ? [...window.schemeSlots(scheme, draft.tributo, Number(fiscalYear) - 1),
       ...window.schemeSlots(scheme, draft.tributo, Number(fiscalYear))]
    : [];
  const pickSlot = (value) => {
    const opt = slotOptions.find(o => o.slot === value);
    if (!opt) { setDraft({ ...draft, slot: "", anno: Number(String(draft.date).slice(0, 4)) || Number(fiscalYear) }); return; }
    const t = scheme.tributi.find(x => x.id === draft.tributo) || {};
    const rid = opt.slot.split("/")[1];
    const r = (t.righe || t.periodi || []).find(x => x.id === rid) || (rid === "acconto" ? t.acconto : null) || {};
    setDraft({
      ...draft, slot: opt.slot, anno: Number(opt.slot.split("/")[2]), date: opt.date,
      code: draft.code || String(r.code || ""), desc: draft.desc || opt.label,
    });
  };
  const [draftError, setDraftError] = useState("");
  const isManual = f => !f._generated && (fiscal.f24History || []).some(h => h.id === f.id);

  const saveDraft = () => {
    if (!onUpdateFiscal) return;
    try {
      const next = window.upsertF24Entry(fiscal.f24History || [], {
        ...draft, slot: draft.slot || null, tributo: draft.tributo || null,
      });
      onUpdateFiscal({ ...fiscal, f24History: next });
      setDraft(emptyDraft);
      setDraftError("");
    } catch (e) {
      setDraftError(e.message.replace(/^f24: /, ""));
    }
  };

  const editEntry = (f) => {
    setDraftError("");
    setDraft({
      id: f.id, date: f.date, code: f.code, desc: f.desc || "", amount: f.amount, status: f.status,
      tributo: f.tributo || null, slot: f.slot || "",
      anno: f.anno != null ? f.anno : Number(String(f.date).slice(0, 4)),
    });
  };

  const deleteEntry = (id) => {
    if (!onUpdateFiscal) return;
    onUpdateFiscal({ ...fiscal, f24History: window.removeF24Entry(fiscal.f24History || [], id) });
    if (draft.id === id) setDraft(emptyDraft);
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

        {onUpdateFiscal && (
          <div style={{ padding: "12px 14px", background: "var(--bg-sunken)", borderRadius: 6, marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
              {draft.id ? "Modifica la voce" : "Registra un versamento o una scadenza"}
            </div>
            <div className="hint" style={{ marginBottom: 10 }}>
              Solo le voci <strong>Versato</strong> di un tributo contributivo si deducono dal
              reddito, nell'anno della data che indichi qui. La scadenza collega la voce allo
              scadenzario: un acconto registrato sostituisce la stima e conta nel saldo.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Data
                <input className="input mono" type="date" style={{ width: 150 }}
                  value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Tributo
                <select className="select" style={{ width: 190 }}
                  value={draft.tributo || ""}
                  onChange={e => setDraft({ ...draft, tributo: e.target.value || null, slot: "" })}>
                  {scheme.tributi.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                  <option value="">— da indicare —</option>
                </select>
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Scadenza
                <select className="select" style={{ width: 240 }}
                  value={draft.slot || ""} onChange={e => pickSlot(e.target.value)}>
                  <option value="">Fuori programma</option>
                  {slotOptions.map(o => (
                    <option key={o.slot} value={o.slot}>{o.label} · {new Date(o.date).toLocaleDateString("it-IT")}</option>
                  ))}
                </select>
              </label>
              {!draft.slot && (
                <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Anno di competenza
                  <input className="input mono" style={{ width: 90 }} inputMode="numeric"
                    value={draft.anno == null ? "" : draft.anno}
                    onChange={e => setDraft({ ...draft, anno: e.target.value })} />
                </label>
              )}
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Codice tributo
                <input className="input mono" list="f24-codici" style={{ width: 110 }} placeholder="PXX"
                  value={draft.code}
                  onChange={e => {
                    const code = e.target.value;
                    setDraft({ ...draft, code, tributo: window.inferTributo(code, scheme) || draft.tributo });
                  }} />
              </label>
              {/* Codici dell'Appendice A della spec dello scadenzario. */}
              <datalist id="f24-codici">
                <option value="4001">Saldo IRPEF</option>
                <option value="4033">1° acconto IRPEF</option>
                <option value="4034">2° acconto IRPEF</option>
                <option value="3801">Saldo addizionale regionale</option>
                <option value="3843">Acconto addizionale comunale</option>
                <option value="3844">Saldo addizionale comunale</option>
                <option value="PXX">Gestione Separata INPS (solo GS)</option>
                <option value="P10">Gestione Separata INPS (con altra copertura)</option>
                <option value="AF">INPS artigiani, minimale</option>
                <option value="AP">INPS artigiani, eccedente</option>
                <option value="CF">INPS commercianti, minimale</option>
                <option value="CP">INPS commercianti, eccedente</option>
                <option value="6031">IVA 1° trimestre</option>
                <option value="6032">IVA 2° trimestre</option>
                <option value="6033">IVA 3° trimestre</option>
                <option value="6099">IVA saldo annuale</option>
                <option value="6035">Acconto IVA (trimestrali)</option>
                <option value="3812">1° acconto IRAP</option>
                <option value="3813">2° acconto IRAP</option>
                <option value="3800">Saldo IRAP</option>
              </datalist>
              <label style={{ display: "grid", gap: 4, fontSize: 12, flex: "1 1 220px" }}>Descrizione
                <input className="input" placeholder="1° acconto contributi 2026"
                  value={draft.desc} onChange={e => setDraft({ ...draft, desc: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Importo €
                <input className="input mono num" style={{ width: 120 }} inputMode="decimal" placeholder="0,00"
                  value={draft.amount} onChange={e => setDraft({ ...draft, amount: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Stato
                <select className="select" style={{ width: 150 }}
                  value={draft.status} onChange={e => setDraft({ ...draft, status: e.target.value })}>
                  <option value="paid">Versato</option>
                  <option value="scheduled">Programmato</option>
                  <option value="estimated">Da quantificare</option>
                </select>
              </label>
              <button className="btn btn-primary btn-sm" onClick={saveDraft}>
                {draft.id ? "Salva" : "Aggiungi"}
              </button>
              {draft.id && (
                <button className="btn btn-sm" onClick={() => { setDraft(emptyDraft); setDraftError(""); }}>
                  Annulla
                </button>
              )}
            </div>
            {draftError && (
              <div style={{ marginTop: 8, color: "var(--danger)", fontSize: 12 }}>{draftError}</div>
            )}
          </div>
        )}

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
                <td>
                  {f.desc}
                  {!f._generated && f.kind === null && (
                    <span className="badge badge-warning" style={{ marginLeft: 6 }}
                      title="Senza tributo la voce non entra nei calcoli: modificala e scegli il tributo">tributo da indicare</span>
                  )}
                </td>
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
                  {/* Solo le voci registrate si modificano: una stima la
                      riscrive il calcolo al prossimo ricalcolo. */}
                  {isManual(f) && onUpdateFiscal && (
                    <React.Fragment>
                      <button className="btn btn-sm" title="Modifica" onClick={() => editEntry(f)}>✎</button>
                      <button className="btn btn-sm btn-danger" title="Elimina" onClick={() => deleteEntry(f.id)}>✕</button>
                    </React.Fragment>
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
