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
    const inAmortization = !!f.amortize;
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
  function buildAmortSchedule(inv) {
    const f = inv.fiscal || {};
    const years = Math.max(1, Number(f.amortYears) || 4);
    const base = round2(Math.abs(inv.totals.imponibile || 0) * pct(f.deductPct) / 100);
    const full = base / years;
    const startYear = Number(String(inv.date || '').slice(0, 4));
    const half = f.firstYearHalf !== false;

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
      id: inv.id,
      desc: inv.causale || (inv.lines && inv.lines[0] && inv.lines[0].desc) || '',
      date: inv.date,
      startYear,
      cost: base,
      years,
      firstYearHalf: half,
      quotas,
    };
  }

  function amortQuotaFor(schedule, year) {
    const q = schedule.quotas.find(x => x.year === Number(year));
    return q ? q.amount : 0;
  }

  function amortResidualAt(schedule, year) {
    const spent = schedule.quotas.filter(q => q.year <= Number(year)).reduce((s, q) => s + q.amount, 0);
    return round2(schedule.cost - spent);
  }

  return {
    round2, CATEGORY_RULES, AMORTIZE_THRESHOLD,
    computeExpenseFiscals, invoiceCostFiscals,
    buildAmortSchedule, amortQuotaFor, amortResidualAt,
  };
});
