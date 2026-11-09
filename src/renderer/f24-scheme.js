// Scadenzario F24 dichiarato. Le scadenze non sono più codice in computeTaxes
// ma uno schema salvato nei dati fiscali: per ogni tributo la base, gli acconti,
// le rate con data e codice, il saldo. Qui vive tutto quello che legge, valida,
// genera e migra quello schema; il QUANTO si deve resta in taxLiability.
// Spec: docs/superpowers/specs/2026-11-08-f24-scadenzario-design.md
//
// UMD come fiscal.js: require()-abile nei test, window.* nel renderer.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

  const SCHEME_BASES = ['irpef', 'addReg', 'addCom', 'contribCassa', 'contribFisso', 'contribVar', 'irap', 'ivaPeriodo'];
  const SCHEME_KINDS = ['imposta', 'contributo', 'iva'];
  const SCHEME_SEZIONI = ['erario', 'inps', 'regioni', 'locali', 'altri-enti'];
  const QUOTE = ['acconto', 'corrente', 'saldo'];
  const METODI = ['nessuno', 'storico'];

  // Il 29 febbraio non c'è tutti gli anni: una scadenza ricorrente su quel
  // giorno sparirebbe tre anni su quattro.
  const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  function isMonthDay(v) {
    const m = /^(\d{2})-(\d{2})$/.exec(String(v == null ? '' : v));
    if (!m) return false;
    const mm = Number(m[1]), dd = Number(m[2]);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= DAYS_IN_MONTH[mm - 1];
  }
  const isMonth = v => /^(0[1-9]|1[0-2])$/.test(String(v));
  const isPct = v => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100;
  const isNonNeg = v => v == null || (typeof v === 'number' && isFinite(v) && v >= 0);

  // ── Validazione ──────────────────────────────────────────────────────────
  function validateScheme(scheme) {
    const errors = [];
    const warnings = [];
    const err = (path, message) => errors.push({ path, message });

    if (!scheme || !Array.isArray(scheme.tributi)) {
      err('tributi', 'lo schema non ha un elenco di tributi');
      return { ok: false, errors, warnings };
    }

    const tributoIds = new Set();
    scheme.tributi.forEach((t, ti) => {
      const p = `tributi[${ti}]`;
      if (!t || typeof t !== 'object') { err(p, 'tributo non valido'); return; }

      if (!t.id) err(`${p}.id`, 'id mancante');
      else if (tributoIds.has(t.id)) err(`${p}.id`, `id "${t.id}" già usato da un altro tributo`);
      tributoIds.add(t.id);

      if (!SCHEME_KINDS.includes(t.kind)) err(`${p}.kind`, `tipo "${t.kind}" sconosciuto`);
      if (!SCHEME_BASES.includes(t.base)) err(`${p}.base`, `base "${t.base}" sconosciuta`);
      else if ((t.base === 'ivaPeriodo') !== (t.kind === 'iva')) {
        err(`${p}.base`, 'la base ivaPeriodo vale solo, e sempre, per un tributo di tipo iva');
      }
      if (t.sezione != null && !SCHEME_SEZIONI.includes(t.sezione)) err(`${p}.sezione`, `sezione "${t.sezione}" sconosciuta`);

      // Il codice vuoto è ammesso solo dove l'app non può saperlo: i contributi
      // delle casse private hanno codici propri, o si pagano con pagoPA.
      const codeOptional = t.kind === 'contributo' && t.sezione === 'altri-enti';
      const checkDated = (q, r) => {
        if (!isMonthDay(r.date)) err(`${q}.date`, `data "${r.date}" non valida (attesa MM-GG)`);
        if (r.yearOffset !== 0 && r.yearOffset !== 1) err(`${q}.yearOffset`, 'anno: 0 (stesso) o 1 (successivo)');
        if (!codeOptional && !String(r.code == null ? '' : r.code).trim()) err(`${q}.code`, 'codice mancante');
      };

      if (t.kind === 'iva') {
        const periodi = Array.isArray(t.periodi) ? t.periodi : [];
        const ids = new Set();
        const months = new Set();
        periodi.forEach((per, pi) => {
          const q = `${p}.periodi[${pi}]`;
          if (!per.id) err(`${q}.id`, 'id mancante');
          else if (ids.has(per.id)) err(`${q}.id`, `id "${per.id}" già usato`);
          ids.add(per.id);
          const ms = Array.isArray(per.months) ? per.months : [];
          if (!ms.length || !ms.every(isMonth)) err(`${q}.months`, 'mesi non validi (attesi "01"…"12")');
          else if (ms.some(m => months.has(m))) err(`${q}.months`, 'un mese compare in due periodi');
          ms.forEach(m => months.add(m));
          checkDated(q, per);
        });
        if (!isNonNeg(t.maggiorazionePct)) err(`${p}.maggiorazionePct`, 'maggiorazione non valida');
        if (t.acconto) {
          const q = `${p}.acconto`;
          if (!METODI.includes(t.acconto.metodo)) err(`${q}.metodo`, `metodo "${t.acconto.metodo}" sconosciuto`);
          if (!isPct(t.acconto.pct)) err(`${q}.pct`, 'percentuale fra 0 e 100');
          if (!ids.has(t.acconto.periodo)) err(`${q}.periodo`, `il periodo "${t.acconto.periodo}" non esiste`);
          if (!isNonNeg(t.acconto.soglia)) err(`${q}.soglia`, 'la soglia non può essere negativa');
          if (!isNonNeg(t.acconto.fallbackPrevYear)) err(`${q}.fallbackPrevYear`, 'il ripiego non può essere negativo');
          checkDated(q, t.acconto);
        }
        return;
      }

      const acc = t.acconti || { metodo: 'nessuno' };
      if (!METODI.includes(acc.metodo)) err(`${p}.acconti.metodo`, `metodo "${acc.metodo}" sconosciuto`);
      if (acc.pct != null && !isPct(acc.pct)) err(`${p}.acconti.pct`, 'percentuale fra 0 e 100');
      if (!isNonNeg(acc.soglia)) err(`${p}.acconti.soglia`, 'la soglia non può essere negativa');
      if (!isNonNeg(acc.fallbackPrevYear)) err(`${p}.acconti.fallbackPrevYear`, 'il ripiego non può essere negativo');

      const righe = Array.isArray(t.righe) ? t.righe : [];
      const ids = new Set();
      let saldi = 0;
      let shareAcconti = 0, nAcconti = 0;
      righe.forEach((r, ri) => {
        const q = `${p}.righe[${ri}]`;
        if (!r.id) err(`${q}.id`, 'id mancante');
        else if (ids.has(r.id)) err(`${q}.id`, `id "${r.id}" già usato`);
        ids.add(r.id);
        if (!QUOTE.includes(r.quota)) err(`${q}.quota`, `quota "${r.quota}" sconosciuta`);
        if (r.quota === 'saldo' && ++saldi > 1) err(`${q}.quota`, 'un tributo ha al massimo un saldo');
        if (r.quota === 'acconto' && acc.metodo !== 'storico') err(`${q}.quota`, 'una rata di acconto richiede il metodo storico');
        if (r.quota !== 'saldo' && !isPct(r.share)) err(`${q}.share`, 'quota fra 0 e 100');
        if (r.quota === 'acconto' && isPct(r.share)) { shareAcconti += r.share; nAcconti++; }
        checkDated(q, r);
      });
      // Un acconto ridotto è legittimo, ma di solito è un errore di battitura.
      if (nAcconti > 0 && Math.abs(shareAcconti - 100) > 1e-9) {
        warnings.push({ path: `${p}.acconti`, message: `le rate di acconto sommano ${round2(shareAcconti)}%, non 100%` });
      }
    });

    return { ok: errors.length === 0, errors, warnings };
  }

  return {
    SCHEME_BASES, SCHEME_KINDS, SCHEME_SEZIONI,
    validateScheme,
  };
});
