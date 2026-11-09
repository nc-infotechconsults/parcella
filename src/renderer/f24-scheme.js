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

  // ── Preset ───────────────────────────────────────────────────────────────
  // Date e quote riproducono il generatore che c'era in computeTaxes; i codici
  // sono quelli dell'Appendice A della spec, non quelli di prima.
  const GS = 'Gestione Separata INPS';

  function presetIdFor(studio) {
    const st = studio || {};
    const tipo = st.tipoSoggetto || 'professionista';
    if (tipo === 'ditta_individuale') return 'ditta';
    if (tipo === 'societa') return 'solo-iva';
    return st.cassaName === GS ? 'professionista-gs' : 'professionista-cassa';
  }

  const num0 = v => (v == null || v === '' || isNaN(Number(v)) ? 0 : Number(v));
  const acconto = (id, share, date, code, label) => ({ id, quota: 'acconto', share, date, yearOffset: 0, code, label });
  const saldo = (code, label) => ({ id: 'saldo', quota: 'saldo', date: '06-30', yearOffset: 1, code, label });

  const ivaTributo = () => ({
    id: 'iva', label: 'IVA', kind: 'iva', base: 'ivaPeriodo', sezione: 'erario', maggiorazionePct: 1,
    acconto: {
      metodo: 'storico', pct: 88, soglia: 103.29, fallbackPrevYear: 0,
      date: '12-27', yearOffset: 0, code: '6035', label: 'Acconto IVA {anno}', periodo: 'q4',
    },
    periodi: [
      { id: 'q1', months: ['01', '02', '03'], date: '05-16', yearOffset: 0, code: '6031', label: 'IVA 1° trim {anno}' },
      { id: 'q2', months: ['04', '05', '06'], date: '08-20', yearOffset: 0, code: '6032', label: 'IVA 2° trim {anno}' },
      { id: 'q3', months: ['07', '08', '09'], date: '11-16', yearOffset: 0, code: '6033', label: 'IVA 3° trim {anno}' },
      { id: 'q4', months: ['10', '11', '12'], date: '03-16', yearOffset: 1, code: '6099', label: 'IVA saldo annuale {anno}' },
    ],
  });

  const irpefTributi = (f) => [
    {
      id: 'irpef', label: 'IRPEF', kind: 'imposta', base: 'irpef', sezione: 'erario',
      acconti: { metodo: 'storico', pct: 100, fallbackPrevYear: num0(f.irpefPrevYear), soglia: 0 },
      righe: [
        acconto('acc1', 40, '06-30', '4033', '1° acconto IRPEF {anno}'),
        acconto('acc2', 60, '11-30', '4034', '2° acconto IRPEF {anno}'),
        saldo('4001', 'Saldo IRPEF {anno}'),
      ],
    },
    {
      id: 'addReg', label: 'Addizionale regionale', kind: 'imposta', base: 'addReg', sezione: 'regioni',
      acconti: { metodo: 'nessuno', fallbackPrevYear: 0, soglia: 0 },
      righe: [saldo('3801', 'Saldo addizionale regionale {anno}')],
    },
    {
      id: 'addCom', label: 'Addizionale comunale', kind: 'imposta', base: 'addCom', sezione: 'locali',
      acconti: { metodo: 'storico', pct: 30, fallbackPrevYear: 0, soglia: 0 },
      righe: [
        acconto('acc1', 100, '06-30', '3843', 'Acconto addizionale comunale {anno}'),
        saldo('3844', 'Saldo addizionale comunale {anno}'),
      ],
    },
  ];

  function presetScheme(id, fiscal) {
    const f = fiscal || {};
    const tributi = [];
    if (id === 'professionista-gs' || id === 'professionista-cassa') {
      const gs = id === 'professionista-gs';
      const who = gs ? 'INPS' : 'cassa';
      const code = gs ? 'PXX' : '';
      const pct = f.cassaAccontoPct != null && f.cassaAccontoPct !== '' && !isNaN(Number(f.cassaAccontoPct))
        ? Number(f.cassaAccontoPct) : (gs ? 80 : 100);
      tributi.push(...irpefTributi(f), {
        id: 'contributi', label: gs ? 'Contributi INPS' : 'Contributi cassa', kind: 'contributo',
        base: 'contribCassa', sezione: gs ? 'inps' : 'altri-enti',
        acconti: { metodo: 'storico', pct, fallbackPrevYear: num0(f.cassaPrevYear), soglia: 0 },
        righe: [
          acconto('acc1', 50, '06-30', code, `1° acconto ${who} {anno}`),
          acconto('acc2', 50, '11-30', code, `2° acconto ${who} {anno}`),
          saldo(code, `Saldo ${who} {anno}`),
        ],
      });
    } else if (id === 'ditta') {
      const fissa = (n, date, yearOffset) => ({
        id: `r${n}`, quota: 'corrente', share: 25, date, yearOffset, code: 'AF', label: `INPS ${n}ª rata fissa {anno}`,
      });
      tributi.push(...irpefTributi(f), {
        id: 'inpsFisso', label: 'INPS minimale', kind: 'contributo', base: 'contribFisso', sezione: 'inps',
        acconti: { metodo: 'nessuno', fallbackPrevYear: 0, soglia: 0 },
        righe: [fissa(1, '05-16', 0), fissa(2, '08-20', 0), fissa(3, '11-16', 0), fissa(4, '02-16', 1)],
      }, {
        id: 'inpsEccedente', label: 'INPS eccedente il minimale', kind: 'contributo', base: 'contribVar', sezione: 'inps',
        acconti: { metodo: 'storico', pct: 100, fallbackPrevYear: 0, soglia: 0 },
        righe: [
          acconto('acc1', 50, '06-30', 'AP', '1° acconto INPS eccedente {anno}'),
          acconto('acc2', 50, '11-30', 'AP', '2° acconto INPS eccedente {anno}'),
          saldo('AP', 'Saldo INPS eccedente {anno}'),
        ],
      }, {
        id: 'irap', label: 'IRAP', kind: 'imposta', base: 'irap', sezione: 'regioni',
        acconti: { metodo: 'storico', pct: 100, fallbackPrevYear: 0, soglia: 0 },
        righe: [
          acconto('acc1', 40, '06-30', '3812', '1° acconto IRAP {anno}'),
          acconto('acc2', 60, '11-30', '3813', '2° acconto IRAP {anno}'),
          saldo('3800', 'Saldo IRAP {anno}'),
        ],
      });
    } else if (id !== 'solo-iva') {
      throw new Error(`scadenzario: preset "${id}" sconosciuto`);
    }
    tributi.push(ivaTributo());
    return { version: 1, preset: id, tributi };
  }

  function activeScheme(fiscal, studio) {
    const f = fiscal || {};
    const preset = () => presetScheme(presetIdFor(studio), f);
    if (!f.scadenzario) return { scheme: preset(), source: 'preset', warning: null };
    const res = validateScheme(f.scadenzario);
    if (res.ok) return { scheme: f.scadenzario, source: 'saved', warning: null };
    const first = res.errors[0];
    return {
      scheme: preset(), source: 'preset',
      warning: `Scadenzario salvato non valido (${first.path}: ${first.message}): si usa il preset finché non lo correggi in Impostazioni.`,
    };
  }

  const fullDate = (year, r) => `${Number(year) + (r.yearOffset || 0)}-${r.date}`;
  const labelFor = (r, year) => String(r.label || '').replace(/\{anno\}/g, String(year));

  function schemeSlots(scheme, tributoId, year) {
    const t = ((scheme && scheme.tributi) || []).find(x => x.id === tributoId);
    if (!t) return [];
    const rows = t.kind === 'iva'
      ? [...(t.periodi || []), ...(t.acconto ? [{ ...t.acconto, id: 'acconto' }] : [])]
      : (t.righe || []);
    return rows
      .map(r => ({ slot: `${t.id}/${r.id}/${year}`, label: labelFor(r, year), date: fullDate(year, r) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  // ── Dal codice al tributo ─────────────────────────────────────────────────
  // Prima lo schema stesso (un codice che vi compare decide), poi la tabella dei
  // codici noti. Con { legacy: true } — le righe scritte prima dello scadenzario —
  // 3801 e 0601 si leggono come li usava l'app di prima, cioè contributi: nel
  // preset nuovo il 3801 è l'addizionale regionale, e senza questa lettura la
  // migrazione toglierebbe dalla deduzione i contributi già versati.
  const has = (scheme, id) => !!(scheme.tributi || []).find(t => t.id === id);
  const firstOfKind = (scheme, kind) => ((scheme.tributi || []).find(t => t.kind === kind) || {}).id || null;

  function inferTributo(code, scheme, opts) {
    const c = String(code == null ? '' : code).trim().toUpperCase();
    if (!c || !scheme) return null;
    if (opts && opts.legacy) {
      if (c === '3801' && has(scheme, 'contributi')) return 'contributi';
      if (c === '0601') {
        const id = ['contributi', 'inpsFisso'].find(x => has(scheme, x));
        if (id) return id;
      }
    }
    for (const t of scheme.tributi || []) {
      const rows = t.kind === 'iva' ? [...(t.periodi || []), ...(t.acconto ? [t.acconto] : [])] : (t.righe || []);
      if (rows.some(r => String(r.code || '').toUpperCase() === c)) return t.id;
    }
    const pick = (...ids) => ids.find(id => has(scheme, id)) || null;
    if (['4001', '4033', '4034'].includes(c)) return pick('irpef');
    if (/^60(0[1-9]|1[0-3]|3[1-5]|99)$/.test(c)) return firstOfKind(scheme, 'iva');
    if (['3800', '3812', '3813'].includes(c)) return pick('irap');
    if (['3843', '3844'].includes(c)) return pick('addCom');
    // Ruling P1: il 3801 l'app lo usava per i contributi del professionista;
    // dove quel tributo non c'è, è l'addizionale regionale vera.
    if (c === '3801') return pick('contributi', 'addReg');
    if (c === '0601') return pick('contributi', 'inpsFisso');
    if (['AF', 'CF'].includes(c)) return pick('inpsFisso') || firstOfKind(scheme, 'contributo');
    if (['AP', 'CP', 'APR', 'CPR'].includes(c)) return pick('inpsEccedente') || firstOfKind(scheme, 'contributo');
    if (['PXX', 'PXXR', 'P10'].includes(c)) return pick('contributi') || firstOfKind(scheme, 'contributo');
    return null;
  }

  function kindOf(row, scheme) {
    if (!row || !row.tributo || !scheme) return null;
    const t = (scheme.tributi || []).find(x => x.id === row.tributo);
    return t ? t.kind : null;
  }

  // I codici con cui il generatore di prima scriveva ogni scadenza. Servono a
  // riconoscere le righe registrate prima dello scadenzario (Ruling P2).
  const LEGACY_CODES = {
    'iva/q1': '6031', 'iva/q2': '6031', 'iva/q3': '6031', 'iva/q4': '6031',
    'irpef/acc1': '4033', 'irpef/acc2': '4034', 'irpef/saldo': '4001',
    'contributi/acc1': '3801', 'contributi/acc2': '3801', 'contributi/saldo': '3801',
    'inpsFisso/r1': '0601', 'inpsFisso/r2': '0601', 'inpsFisso/r3': '0601', 'inpsFisso/r4': '0601',
    'inpsEccedente/acc1': '0601', 'inpsEccedente/acc2': '0601',
    'irap/acc1': '3800', 'irap/acc2': '3800',
  };

  // ── Proposte e saldi ─────────────────────────────────────────────────────
  // Un importo scritto prima che upsertF24Entry normalizzasse può essere una
  // stringa, anche con la virgola decimale: deve valere come numero.
  const amountOf = v => {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    const n = Number(String(v == null ? '' : v).trim().replace(',', '.'));
    return isFinite(n) ? n : 0;
  };
  const isFact = f => f && (f.status === 'paid' || f.status === 'scheduled');
  const slotParts = slot => {
    const m = /^([^/]+)\/([^/]+)\/(\d{4})$/.exec(String(slot || ''));
    return m ? { tributo: m[1], riga: m[2], anno: Number(m[3]) } : null;
  };

  function scheduleFromScheme(o) {
    const scheme = o.scheme;
    const year = Number(o.year);
    const bases = o.bases || {};
    const prevBases = o.prevBases || null;
    const recorded = (o.recorded || []).filter(Boolean);
    const suffix = o.basedOn ? ` (${o.basedOn})` : '';

    const factBySlot = new Map();
    recorded.filter(isFact).forEach(f => { if (f.slot) factBySlot.set(f.slot, f); });

    const proposals = [];
    const saldi = {}, acconti = {}, crediti = {};
    const propose = (t, r, amount, desc) => {
      const slot = `${t.id}/${r.id}/${year}`;
      const value = round2(amount);
      if (!(value > 0) || factBySlot.has(slot)) return;
      proposals.push({
        id: '_' + slot, slot, tributo: t.id, kind: t.kind, sezione: t.sezione || null,
        date: fullDate(year, r), code: String(r.code == null ? '' : r.code), desc, amount: value, _generated: true,
      });
    };

    for (const t of scheme.tributi || []) {
      if (t.kind === 'iva') { scheduleIva(t, o, year, propose, factBySlot, saldi, acconti, crediti); continue; }

      const righe = t.righe || [];
      const base = amountOf(bases[t.base]);
      const acc = t.acconti || { metodo: 'nessuno' };
      const prevBase = prevBases ? amountOf(prevBases[t.base]) : amountOf(acc.fallbackPrevYear);
      let baseAcconti = acc.metodo === 'storico' ? round2(prevBase * amountOf(acc.pct == null ? 100 : acc.pct) / 100) : 0;
      if (baseAcconti < amountOf(acc.soglia)) baseAcconti = 0;

      // Ogni acconto vale l'importo registrato se c'è un fatto per il suo slot,
      // altrimenti la proposta.
      let sommaAcconti = 0;
      for (const r of righe) {
        const desc = labelFor(r, year);
        if (r.quota === 'acconto') {
          const proposto = round2(baseAcconti * amountOf(r.share) / 100);
          const fact = factBySlot.get(`${t.id}/${r.id}/${year}`);
          sommaAcconti += fact ? amountOf(fact.amount) : proposto;
          propose(t, r, proposto, desc + suffix);
        } else if (r.quota === 'corrente') {
          propose(t, r, base * amountOf(r.share) / 100, desc);
        }
      }

      const saldoRow = righe.find(r => r.quota === 'saldo');
      if (!saldoRow) continue;

      // Versamenti dello stesso tributo e anno che lo schema non prevede: uno
      // slot che lo schema non ha (più), o nessuno slot e l'anno dichiarato.
      const rowIds = new Set(righe.map(r => r.id));
      const extra = recorded.filter(isFact).filter(f => {
        if (f.tributo !== t.id) return false;
        const sp = slotParts(f.slot);
        if (sp) return sp.tributo === t.id && sp.anno === year && !rowIds.has(sp.riga);
        return !f.slot && Number(f.anno) === year;
      }).reduce((sum, f) => sum + amountOf(f.amount), 0);

      const totAcconti = round2(sommaAcconti + extra);
      const delta = round2(base - totAcconti);
      acconti[t.id] = totAcconti;
      saldi[t.id] = delta;
      if (delta < 0) crediti[t.id] = round2(-delta);
      propose(t, saldoRow, delta, labelFor(saldoRow, year));
    }

    proposals.sort((a, b) => a.date.localeCompare(b.date));
    return { proposals, saldi, acconti, crediti };
  }

  // IVA: Task 5.
  function scheduleIva() {}

  return {
    SCHEME_BASES, SCHEME_KINDS, SCHEME_SEZIONI, LEGACY_CODES,
    validateScheme,
    presetIdFor, presetScheme, activeScheme, schemeSlots, inferTributo, kindOf,
    scheduleFromScheme, amountOf,
  };
});
