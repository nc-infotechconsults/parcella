// Fiscal engine. Deliberately free of React so that Node tests can assert the
// rules directly — reverse-charge neutrality and the no-double-count rule are
// not things you can verify by eyeballing a KPI.
//
// UMD: require()-able in tests/main, window.* in the renderer (no bundler).
(function (root, factory) {
  const categories = (typeof module !== 'undefined' && module.exports)
    ? require('../shared/categories')
    : { CATEGORY_RULES: root.CATEGORY_RULES, AMORTIZE_THRESHOLD: root.AMORTIZE_THRESHOLD };
  const api = factory(categories);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (categories) {

  const { CATEGORY_RULES, AMORTIZE_THRESHOLD } = categories;
  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
  const pct = v => (v == null ? 100 : Number(v));

  // ── Manual expenses: behaviour preserved exactly as it was in expenses.jsx ──
  function computeExpenseFiscals(e) {
    const gross = e.amount;
    const net = e.vatExempt ? gross : gross / (1 + (e.vatPct || 0) / 100);
    const vat = gross - net;
    const vatDetracted = e.billable
      ? vat
      : (e.vatExempt ? 0 : vat * Math.min(e.deductPct, 100) / 100);
    const yearlyDeducted = e.amortize
      ? (net * e.deductPct / 100) / (e.amortYears || 4)
      : net * e.deductPct / 100;
    const inAmortization = e.amortize === true
      || (!e.billable && net > AMORTIZE_THRESHOLD && (e.category === "Hardware" || e.category === "Auto"));
    return {
      gross, net, vat, vatDetracted, yearlyDeducted, inAmortization,
      nonDeductible: net - (net * e.deductPct / 100),
    };
  }

  // ── Invoice-backed costs ───────────────────────────────────────────────────
  function invoiceCostFiscals(inv) {
    const f = inv.fiscal || {};
    const sign = inv.sign || 1;
    const imponibile = round2(sign * (inv.totals.imponibile || 0));
    const imposta = round2(sign * (inv.totals.imposta || 0));
    // A credit note is a return, not an acquisition: it must remove cost now,
    // never open (or top up) an amortization schedule.
    const inAmortization = !!f.amortize && sign > 0;
    return {
      imponibile,
      imposta,
      // VAT is detracted at once even for a cespite; only the cost is spread.
      vatDetracted: round2(imposta * pct(f.vatDetractPct) / 100),
      deductible: inAmortization ? 0 : round2(imponibile * pct(f.deductPct) / 100),
      inAmortization,
    };
  }

  // ── Ammortamenti ───────────────────────────────────────────────────────────
  // art. 102 TUIR: the first year's quota is halved, which pushes a final
  // half-quota into year start+years.
  // One schedule builder for both sources of a bene strumentale. An invoice and
  // a hand-entered expense describe the same asset in different shapes, and
  // when each grew its own quota arithmetic the manual one silently lost every
  // year after the purchase.
  function amortSchedule(o) {
    const years = Math.max(1, Number(o.years) || 4);
    const base = round2(o.base || 0);
    const full = base / years;
    const startYear = Number(String(o.date || '').slice(0, 4));
    const half = o.firstYearHalf !== false;

    const quotas = [];
    if (half) {
      quotas.push({ year: startYear, amount: round2(full / 2) });
      for (let i = 1; i < years; i++) quotas.push({ year: startYear + i, amount: round2(full) });
      quotas.push({ year: startYear + years, amount: round2(full / 2) });
    } else {
      for (let i = 0; i < years; i++) quotas.push({ year: startYear + i, amount: round2(full) });
    }

    // Push any rounding drift onto the last quota so the schedule totals the base.
    const drift = round2(base - quotas.reduce((s, q) => s + q.amount, 0));
    if (drift !== 0) quotas[quotas.length - 1].amount = round2(quotas[quotas.length - 1].amount + drift);

    return {
      id: o.id,
      source: o.source || 'invoice',
      desc: o.desc || '',
      date: o.date,
      startYear,
      cost: base,
      years,
      firstYearHalf: half,
      quotas,
    };
  }

  function buildAmortSchedule(inv) {
    const f = inv.fiscal || {};
    return amortSchedule({
      id: inv.id,
      source: 'invoice',
      desc: inv.causale || (inv.lines && inv.lines[0] && inv.lines[0].desc) || '',
      date: inv.date,
      years: Number(f.amortYears) || 4,
      firstYearHalf: f.firstYearHalf !== false,
      // Structural guard, not merely a caller convention: a credit note can
      // never open a schedule. Both callers already filter on sign, but a
      // future one might not, and the failure mode is a silently inflated
      // deduction.
      base: (inv.sign || 1) < 0 ? 0
        : Math.abs(inv.totals.imponibile || 0) * pct(f.deductPct) / 100,
    });
  }

  // A manual expense dates from a month, not a day, and carries its amount
  // gross; everything else is the same asset as an invoiced one.
  function buildExpenseAmortSchedule(e) {
    return amortSchedule({
      id: e.id,
      source: 'expense',
      desc: e.desc || e.category || '',
      date: String(e.monthKey || '') + '-01',
      years: Number(e.amortYears) || 4,
      firstYearHalf: e.firstYearHalf !== false,
      base: computeExpenseFiscals(e).net * pct(e.deductPct) / 100,
    });
  }

  function amortQuotaFor(schedule, year) {
    const q = schedule.quotas.find(x => x.year === Number(year));
    return q ? q.amount : 0;
  }

  function amortResidualAt(schedule, year) {
    const spent = schedule.quotas.filter(q => q.year <= Number(year)).reduce((s, q) => s + q.amount, 0);
    return round2(schedule.cost - spent);
  }

  // ── Period helpers ─────────────────────────────────────────────────────────
  const QUARTERS = [
    { id: 'Q1', label: '1° trim (gen-mar)', months: ['01', '02', '03'] },
    { id: 'Q2', label: '2° trim (apr-giu)', months: ['04', '05', '06'] },
    { id: 'Q3', label: '3° trim (lug-set)', months: ['07', '08', '09'] },
    { id: 'Q4', label: '4° trim (ott-dic)', months: ['10', '11', '12'] },
  ];
  const MONTHLY = Array.from({ length: 12 }, (_, i) => {
    const mm = String(i + 1).padStart(2, '0');
    return { id: mm, label: mm, months: [mm] };
  });

  // ── The merge (spec §4.2) ──────────────────────────────────────────────────
  function computeFiscalYear(opts) {
    const year = Number(opts.year);
    const yr = String(year);
    const invoices = opts.invoices || [];
    const activities = opts.activities || [];
    const expenses = opts.expenses || [];
    const clients = opts.clients || [];
    const fiscal = opts.fiscal || {};
    const amounts = opts.computeInvoiceAmounts
      || (typeof globalThis !== 'undefined' && globalThis.computeInvoiceAmounts);

    const inYear = d => typeof d === 'string' && d.slice(0, 4) === yr;
    const settledInYear = inv => inv.settlement && inv.settlement.status === 'settled' && inYear(inv.settlement.date);

    const byDocDate = invoices.filter(i => inYear(i.date));
    const manual = expenses.filter(e => !e.billable && String(e.monthKey || '').startsWith(yr + '-'));
    const active = byDocDate.filter(i => i.direction === 'active' && !i.reverseCharge);
    const passive = byDocDate.filter(i => i.direction === 'passive' && !i.reverseCharge);
    const reverse = byDocDate.filter(i => i.reverseCharge);

    // Revenue — competenza and cassa (P4)
    const ricavi = round2(active.reduce((s, i) => s + (i.sign || 1) * i.totals.imponibile, 0));
    const settledActive = invoices.filter(i => i.direction === 'active' && !i.reverseCharge && settledInYear(i));
    const ricaviIncassati = round2(settledActive.reduce((s, i) => s + (i.sign || 1) * i.totals.imponibile, 0));
    const cassaRivalsa = round2(active.reduce((s, i) => s + (i.sign || 1) * ((i.cassa && i.cassa.importo) || 0), 0));
    const ritenutaSubita = round2(active.reduce((s, i) => s + (i.sign || 1) * ((i.withholding && i.withholding.importo) || 0), 0));
    const ritenutaIncassata = round2(settledActive.reduce((s, i) => s + (i.sign || 1) * ((i.withholding && i.withholding.importo) || 0), 0));

    // IVA — always by document date (P4); reverse charge lands on both sides (P3)
    const ivaOn = inv => (inv.sign || 1) * (inv.totals.imposta || 0);
    const detractedOn = inv => ivaOn(inv) * pct(inv.fiscal && inv.fiscal.vatDetractPct) / 100;
    const ivaReverse = round2(reverse.reduce((s, i) => s + ivaOn(i), 0));
    const ivaDebito = round2(active.reduce((s, i) => s + ivaOn(i), 0) + ivaReverse);
    // Manual expenses carry detractable VAT too — taxes.jsx has always counted
    // it, and dropping it here would silently raise what the user pays.
    const ivaCreditoSpese = round2(manual.reduce((s, e) => s + computeExpenseFiscals(e).vatDetracted, 0));
    const ivaCredito = round2(passive.reduce((s, i) => s + detractedOn(i), 0)
      + reverse.reduce((s, i) => s + detractedOn(i), 0) + ivaCreditoSpese);

    // Costs — competenza vs cassa, with cespiti spread over their schedule.
    // Both lists are deliberately unfiltered by year: a bene strumentale bought
    // in 2023 is still deducting its quota today, and reading only this year's
    // documents is what made every quota after the purchase disappear.
    const costInvoices = invoices.filter(i => i.direction === 'passive');
    const amortizedExpenses = expenses.filter(e => !e.billable && e.amortize === true);
    const withYear = s => ({
      ...s, quotaYear: amortQuotaFor(s, year), residual: amortResidualAt(s, year),
    });
    const cespiti = [
      ...costInvoices
        .filter(i => i.fiscal && i.fiscal.amortize && (i.sign || 1) > 0)
        .map(i => withYear(buildAmortSchedule(i))),
      ...amortizedExpenses.map(e => withYear(buildExpenseAmortSchedule(e))),
    ];

    const costiCompetenza = round2(
      byDocDate.filter(i => i.direction === 'passive')
        .reduce((s, i) => s + invoiceCostFiscals(i).imponibile * pct(i.fiscal && i.fiscal.deductPct) / 100, 0)
    );

    // A cespite deducts by competenza through its schedule, so it is the one
    // cost that escapes the cash basis; everything else waits to be paid.
    const paidThisYear = costInvoices.filter(i =>
      settledInYear(i) && !(i.fiscal && i.fiscal.amortize && (i.sign || 1) > 0));
    // An amortized expense deducts through its schedule above, so it must not
    // also contribute its flat yearly quota here — that would count the year of
    // purchase twice.
    // The two halves are published separately because they answer different
    // questions: what this year's activity cost, and what earlier purchases
    // still deduct. Their sum is the deduction.
    const quoteAmmortamento = round2(cespiti.reduce((s, c) => s + c.quotaYear, 0));
    const costiEsercizio = round2(
      paidThisYear.reduce((s, i) => s + invoiceCostFiscals(i).deductible, 0)
      + manual.filter(e => e.amortize !== true)
        .reduce((s, e) => s + computeExpenseFiscals(e).yearlyDeducted, 0)
    );
    const costiDeducibili = round2(costiEsercizio + quoteAmmortamento);

    // Costs by category — invoices and manual expenses share the same buckets
    const costiPerCategoria = {};
    const addCat = (cat, amount) => {
      const key = cat || 'Altro';
      costiPerCategoria[key] = round2((costiPerCategoria[key] || 0) + amount);
    };
    byDocDate.filter(i => i.direction === 'passive')
      .forEach(i => addCat(i.fiscal && i.fiscal.category, invoiceCostFiscals(i).imponibile));
    manual.forEach(e => addCat(e.category, computeExpenseFiscals(e).net));

    // Forecast — only months no active invoice covers (no double counting)
    const coveredMonths = {};
    invoices.filter(i => i.direction === 'active' && (i.sign || 1) > 0 && i.clientId && i.linkedMonthKey)
      .forEach(i => { coveredMonths[`${i.clientId}|${i.linkedMonthKey}`] = i.id; });

    const monthTotals = new Map();
    activities.filter(a => String(a.monthKey || '').startsWith(yr + '-')).forEach(a => {
      const key = `${a.clientId}|${a.monthKey}`;
      monthTotals.set(key, (monthTotals.get(key) || 0) + (a.hours || 0));
    });

    const previsionaleMonths = [];
    for (const [key, hours] of monthTotals) {
      if (coveredMonths[key]) continue;
      const [clientId, monthKey] = key.split('|');
      const client = clients.find(c => c.id === clientId);
      if (!client || !amounts) continue;
      previsionaleMonths.push({ clientId, monthKey, imponibile: round2(amounts(client, hours).imponibile) });
    }
    previsionaleMonths.sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));

    // Liquidation periods
    const periodDefs = fiscal.ivaLiquidazione === 'mensile' ? MONTHLY : QUARTERS;
    let creditoRiportato = 0;
    const periods = periodDefs.map(p => {
      const inPeriod = list => list.filter(i => p.months.includes(i.date.slice(5, 7)));
      const rc = inPeriod(reverse);
      const dbt = round2(inPeriod(active).reduce((s, i) => s + ivaOn(i), 0) + rc.reduce((s, i) => s + ivaOn(i), 0));
      const speseVat = round2(manual
        .filter(e => p.months.includes(String(e.monthKey).slice(5, 7)))
        .reduce((s, e) => s + computeExpenseFiscals(e).vatDetracted, 0));
      const crd = round2(inPeriod(passive).reduce((s, i) => s + detractedOn(i), 0) + rc.reduce((s, i) => s + detractedOn(i), 0) + speseVat);
      // Real liquidation carries a period's credit forward: a quarter ending in
      // credit reduces what the next quarter pays. Netting each period in
      // isolation overstates the F24 the user actually files.
      const lordo = round2(dbt - crd);
      const creditoPrecedente = creditoRiportato;
      const netto = round2(lordo - creditoPrecedente);
      creditoRiportato = netto < 0 ? round2(-netto) : 0;
      return {
        id: p.id, label: p.label, months: p.months,
        ivaDebito: dbt, ivaCredito: crd,
        ivaReverse: round2(rc.reduce((s, i) => s + ivaOn(i), 0)),
        creditoPrecedente,
        saldo: netto > 0 ? netto : 0,
        saldoLordo: lordo,
      };
    });

    const scadenze = invoices
      .filter(i => i.settlement && i.settlement.status === 'open' && i.payment && i.payment.dueDate)
      .map(i => ({
        id: i.id, date: i.payment.dueDate, direction: i.direction,
        counterparty: i.counterparty ? i.counterparty.name : '',
        amount: round2((i.sign || 1) * i.totals.documento),
      }))
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    return {
      year,
      consuntivo: {
        ricavi, ricaviIncassati, ritenutaSubita, ritenutaIncassata, cassaRivalsa,
        costiCompetenza, costiDeducibili, costiEsercizio, quoteAmmortamento,
        ivaDebito, ivaCredito, ivaReverse, ivaSaldo: round2(ivaDebito - ivaCredito),
      },
      previsionale: {
        ricavi: round2(previsionaleMonths.reduce((s, m) => s + m.imponibile, 0)),
        months: previsionaleMonths,
      },
      coveredMonths, periods, cespiti, costiPerCategoria, scadenze,
    };
  }

  return {
    round2, CATEGORY_RULES, AMORTIZE_THRESHOLD,
    computeExpenseFiscals, invoiceCostFiscals,
    amortSchedule, buildAmortSchedule, buildExpenseAmortSchedule,
    amortQuotaFor, amortResidualAt,
    computeFiscalYear,
  };
});
