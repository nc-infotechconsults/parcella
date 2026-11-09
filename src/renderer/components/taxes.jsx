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

  return {
    aliquote, brackets,
    compensi, costiDeducibili, costiEsercizio, quoteAmmortamento, ritenuta,
    contributiVersati: contribDedotti,
    reddNettoLordoCassa,
    contribCassa: r2(contribCassa), contribFisso, contribVar, irapBase, irap,
    redditoImpIrpef, irpefLorda, addReg, addCom, irpefLordaTot,
    irpefNetta: r2(Math.max(0, irpefLordaTot - ritenuta)),
    ritenutaCredito: Math.max(0, ritenuta - irpefLordaTot),
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

  // ── Contributi versati (deduzione per cassa) ──────────────────────────────
  // Il contributo previdenziale si deduce nell'anno in cui lo VERSI, quindi la
  // deduzione si legge dai versamenti, non da un'aliquota: è la somma dei
  // tributi contributivi pagati con data in quell'anno.
  const CONTRIB_CODES = new Set(["3801", "0601"]);
  const recorded = fiscal.f24History || [];
  const key = f => f.date + "|" + f.code;
  const contributiPagatiIn = (anno) => round2(recorded
    .filter(f => f.status === "paid"
      && CONTRIB_CODES.has(String(f.code))
      && String(f.date || "").startsWith(anno + "-"))
    .reduce((s, f) => s + (Number(f.amount) || 0), 0));

  // ── Acconti: metodo storico ───────────────────────────────────────────────
  // In June you pay an instalment sized on LAST year's liability, and the
  // difference against how this year really went is settled the June after.
  // Where last year's documents are in the archive the base is computed from
  // them; the stored figure is only the fallback for a first year of use.
  const prevYr = Number(yr) - 1;
  // Un anno di soli costi non è un anno di cui si conoscano i compensi. La
  // condizione guardava qualunque documento: ventidue fatture passive del 2025
  // bastavano a far derivare la base da un anno senza ricavi, che dava zero e
  // scavalcava in silenzio il valore scritto in Impostazioni. Da lì acconti e
  // rate a zero, e la casella "Versato" che non deduceva nulla perché la rata
  // da dedurre valeva zero. La prova che serve è un ricavo, non un documento.
  const hasPrevData = (invoices || []).some(i =>
    i.direction === "active" && !i.reverseCharge && String(i.date || "").startsWith(prevYr + "-"));
  const fyPrev = hasPrevData ? window.computeFiscalYear({
    year: prevYr, invoices: invoices || [], activities, expenses, clients: _clients, fiscal,
    computeInvoiceAmounts: window.computeInvoiceAmounts,
  }) : null;
  const prev = fyPrev
    ? { ...taxLiability(fyPrev, fiscal, tipo, contributiPagatiIn(prevYr)), derived: true }
    : {
      contribCassa: Number(fiscal.cassaPrevYear) || 0,
      irpefNetta: Number(fiscal.irpefPrevYear) || 0,
      derived: false,
    };

  // La Gestione Separata INPS chiede l'80% del contributo dell'anno prima, in
  // due rate uguali; le casse private in genere il 100% in due metà. L'IRPEF
  // segue sempre il 100% ripartito 40/60.
  const cassaLabel = (studio && studio.cassaName) === "Gestione Separata INPS" ? "INPS" : "cassa";
  const cassaAccontoPct = fiscal.cassaAccontoPct != null
    ? Number(fiscal.cassaAccontoPct)
    : ((studio && studio.cassaName) === "Gestione Separata INPS" ? 80 : 100);
  const accontiCassa = round2(prev.contribCassa * cassaAccontoPct / 100);
  const accontiIrpef = round2(prev.irpefNetta);

  // Una rata spuntata "Versato" su questa schermata è un versamento anche se
  // l'utente non ha registrato la riga F24 a mano: senza questo, spuntarla non
  // cambiava nulla nella deduzione.
  const rataCassa = round2(accontiCassa / 2);
  const flagged = [
    { date: `${Number(yr)}-06-30`, paid: fiscal.cassaAcconto1Paid },
    { date: `${Number(yr)}-11-30`, paid: fiscal.cassaAcconto2Paid },
  ].filter(d => d.paid && !recorded.some(f => key(f) === d.date + "|3801"));
  const contributiVersati = round2(contributiPagatiIn(yr) + flagged.length * rataCassa);

  // ── Contributi e IRPEF ────────────────────────────────────────────────────
  // taxLiability() vale per qualunque anno, perché gli acconti si misurano su
  // quello precedente e va quindi calcolato anche per quello.
  const cur = taxLiability(fy, fiscal, tipo, contributiVersati);
  const {
    reddNettoLordoCassa, contribCassa, contribFisso, contribVar, irapBase, irap,
    redditoImpIrpef, irpefLorda, addReg, addCom, irpefLordaTot, irpefNetta,
    ritenutaCredito, costiEsercizio, quoteAmmortamento,
  } = cur;

  // Il delta: quanto l'andamento reale di quest'anno si discosta dagli acconti
  // già impostati sull'anno scorso. Negativo = credito, non una scadenza.
  const saldoCassa = round2(contribCassa - accontiCassa);
  const saldoIrpef = round2(irpefNetta - accontiIrpef);

  // ── IVA trimestrale ───────────────────────────────────────────────────────
  // Scadenze: professionista trimestrale con +1%; ditta può essere mensile
  const ivaDeadlines = [
    { id: "Q1", label: "1° trim (gen-mar)", deadline: "16 maggio (+1%)", months: ["01","02","03"], paid: fiscal.ivaQ1Paid, paidAmount: fiscal.ivaQ1Amount },
    { id: "Q2", label: "2° trim (apr-giu)", deadline: "20 agosto (+1%)", months: ["04","05","06"], paid: fiscal.ivaQ2Paid },
    { id: "Q3", label: "3° trim (lug-set)", deadline: "16 novembre (+1%)", months: ["07","08","09"], paid: fiscal.ivaQ3Paid },
    { id: "Q4", label: "4° trim (ott-dic)", deadline: "16 marzo anno succ.", months: ["10","11","12"], paid: fiscal.ivaQ4Paid },
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

  // A flag the user ticked on this screen is a fact about a deadline, so it has
  // to reach the row; otherwise an instalment already paid kept being listed as
  // still due. A recorded F24 entry still overrides both (merge below).
  const statusOf = flag => (flag ? "paid" : undefined);
  const basedOn = prev.derived ? `su ${prevYr} effettivo` : `su ${prevYr}`;

  // Acconti e saldo IRPEF — identici per professionista e ditta individuale.
  // Gli acconti si misurano sull'anno scorso (metodo storico): usare l'imposta
  // di quest'anno dava una rata di giugno che nessuno deve e che contraddiceva
  // il riquadro accanto, che l'anno scorso lo leggeva già.
  if (tipo === "professionista" || tipo === "ditta_individuale") {
    generatedF24.push({ id: "_irpef_acc1", date: `${y}-06-30`, code: "4033", desc: `1° acconto IRPEF ${yr} (40% ${basedOn})`, amount: round2(accontiIrpef * 0.4), status: statusOf(fiscal.irpefAcconto1Paid), _generated: true });
    generatedF24.push({ id: "_irpef_acc2", date: `${y}-11-30`, code: "4034", desc: `2° acconto IRPEF ${yr} (60% ${basedOn})`, amount: round2(accontiIrpef * 0.6), status: statusOf(fiscal.irpefAcconto2Paid), _generated: true });
    // Il saldo chiude il delta fra gli acconti versati e l'imposta vera
    // dell'anno, che le fatture importate rendono calcolabile.
    if (saldoIrpef > 0) {
      generatedF24.push({ id: "_irpef_saldo", date: `${y + 1}-06-30`, code: "4001", desc: `Saldo IRPEF ${yr}`, amount: saldoIrpef, _generated: true });
    }
  }

  if (tipo === "professionista") {
    generatedF24.push({ id: "_cassa_acc1", date: `${y}-06-30`, code: "3801", desc: `1° acconto ${cassaLabel} ${yr} (${cassaAccontoPct}% ${basedOn}, 1ª rata)`, amount: rataCassa, status: statusOf(fiscal.cassaAcconto1Paid), _generated: true });
    generatedF24.push({ id: "_cassa_acc2", date: `${y}-11-30`, code: "3801", desc: `2° acconto ${cassaLabel} ${yr} (${cassaAccontoPct}% ${basedOn}, 2ª rata)`, amount: rataCassa, status: statusOf(fiscal.cassaAcconto2Paid), _generated: true });
    if (saldoCassa > 0) {
      generatedF24.push({ id: "_cassa_saldo", date: `${y + 1}-06-30`, code: "3801", desc: `Saldo ${cassaLabel} ${yr}`, amount: saldoCassa, _generated: true });
    }
  } else if (tipo === "ditta_individuale") {
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

  // A deadline is identified by WHEN it falls and WHICH tributo it pays, not by
  // an internal id: generated ids are "_q1", recorded ones are "f1", so keying
  // the merge on id could never match and every deadline was listed twice —
  // once as an estimate and once as the real entry, with the totals adding both.
  // What the user recorded wins; the estimate only fills a gap.
  // A FACT beats a computation: an entry the user marked paid or scheduled is
  // what happened, and the estimate for that deadline is dropped. A recorded
  // row still marked "estimated" is not a fact, so the computed figure — which
  // now comes from the real invoices — supersedes it. Otherwise a stale saved
  // estimate of 0,00 would hide a liability the invoices clearly show.
  const settledKeys = new Set(recorded.filter(f => f.status === 'paid' || f.status === 'scheduled').map(key));
  const generated = generatedF24.filter(g => g.amount > 0 && !settledKeys.has(key(g)));
  const generatedKeys = new Set(generated.map(key));
  const f24All = [
    // An instalment of nothing is not a deadline. The IVA rows were already
    // guarded this way; the IRPEF and cassa rows were not.
    ...generated,
    ...recorded.filter(f => !generatedKeys.has(key(f))),
  ].map(f => ({ ...f, status: f.status || "estimated" }))
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
          <td className="num mono" style={{ color: "var(--text-muted)" }}>{fmtEUR(tax.fy.consuntivo.ivaReverse)}</td>
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

const TaxIRPEF = ({ tax, fiscal }) => (
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
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5, marginBottom: 6 }}>
              <span>1° acconto (40%) · entro 30 giu · {fmtEUR(tax.accontiIrpef * 0.4)}</span>
              <span>{fiscal.irpefAcconto1Paid ? <span className="badge badge-success badge-dot">versato</span> : <span className="badge badge-warning">da pagare</span>}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12.5 }}>
              <span>2° acconto (60%) · entro 30 nov · {fmtEUR(tax.accontiIrpef * 0.6)}</span>
              <span>{fiscal.irpefAcconto2Paid ? <span className="badge badge-success badge-dot">versato</span> : <span className="badge badge-warning">da pagare</span>}</span>
            </div>
            <AccontoDelta dovuto={tax.irpefNetta} acconti={tax.accontiIrpef} delta={tax.saldoIrpef} />
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
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, marginBottom: 6 }}>
              <span>1ª rata · 30 giu · {fmtEUR(tax.accontiCassa / 2)}</span>
              <button className={"btn btn-sm " + (fiscal.cassaAcconto1Paid ? "btn-primary" : "")}
                onClick={() => updateFiscal({ cassaAcconto1Paid: !fiscal.cassaAcconto1Paid })}>
                {fiscal.cassaAcconto1Paid ? "✓ Versato" : "Da versare"}
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5 }}>
              <span>2ª rata · 30 nov · {fmtEUR(tax.accontiCassa / 2)}</span>
              <button className={"btn btn-sm " + (fiscal.cassaAcconto2Paid ? "btn-primary" : "")}
                onClick={() => updateFiscal({ cassaAcconto2Paid: !fiscal.cassaAcconto2Paid })}>
                {fiscal.cassaAcconto2Paid ? "✓ Versato" : "Da versare"}
              </button>
            </div>
            <AccontoDelta dovuto={tax.contribCassa} acconti={tax.accontiCassa} delta={tax.saldoCassa} />
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
    // Passa da upsertF24Entry come ogni altra scrittura: normalizza l'id (una
    // voce calcolata ne porta uno che comincia con "_") e toglie _generated.
    onUpdateFiscal({
      ...fiscal,
      f24History: window.upsertF24Entry(fiscal.f24History || [], { ...existing, status: "paid", paidDate: now }),
    });
  };

  // ── Voci registrate a mano ───────────────────────────────────────────────
  // Senza questo l'unico gesto possibile era spuntare "Versato" su una riga
  // già presente, con l'importo che aveva: un versamento vero che il calcolo
  // non prevede — una rata INPS quando la base dell'anno prima è vuota — non
  // aveva modo di entrare, e restava fuori dalla deduzione per cassa.
  const emptyDraft = { id: null, date: `${fiscalYear}-06-30`, code: "3801", desc: "", amount: "", status: "paid" };
  const [draft, setDraft] = useState(emptyDraft);
  const [draftError, setDraftError] = useState("");
  const isManual = f => !f._generated && (fiscal.f24History || []).some(h => h.id === f.id);

  const saveDraft = () => {
    if (!onUpdateFiscal) return;
    try {
      const next = window.upsertF24Entry(fiscal.f24History || [], draft);
      onUpdateFiscal({ ...fiscal, f24History: next });
      setDraft(emptyDraft);
      setDraftError("");
    } catch (e) {
      setDraftError(e.message.replace(/^f24: /, ""));
    }
  };

  const editEntry = (f) => {
    setDraftError("");
    setDraft({ id: f.id, date: f.date, code: f.code, desc: f.desc || "", amount: f.amount, status: f.status });
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
              Solo le voci marcate <strong>Versato</strong> con codice 3801 o 0601 si deducono dal
              reddito, e nell'anno della data che indichi qui.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Data
                <input className="input mono" type="date" style={{ width: 150 }}
                  value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <label style={{ display: "grid", gap: 4, fontSize: 12 }}>Codice tributo
                <input className="input mono" list="f24-codici" style={{ width: 110 }} placeholder="3801"
                  value={draft.code} onChange={e => setDraft({ ...draft, code: e.target.value })} />
              </label>
              <datalist id="f24-codici">
                <option value="3801">Contributi cassa / Gestione Separata</option>
                <option value="0601">Contributi INPS artigiani e commercianti</option>
                <option value="4001">Saldo IRPEF</option>
                <option value="4033">1° acconto IRPEF</option>
                <option value="4034">2° acconto IRPEF</option>
                <option value="6031">IVA trimestrale</option>
                <option value="3800">IRAP</option>
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
