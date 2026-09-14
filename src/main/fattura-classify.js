// Decides whether a parsed document is active or passive, whether it is a
// reverse-charge self-invoice, and what identity it dedups on. Pure functions.

// forcePassive: the studio issues these, but they record a *purchase*.
// Counting them as revenue would inflate income by every foreign supplier bill.
const TIPO_DOC = {
  TD01: { label: 'Fattura' },
  TD02: { label: 'Acconto/anticipo su fattura' },
  TD03: { label: 'Acconto/anticipo su parcella' },
  TD04: { label: 'Nota di credito' },
  TD05: { label: 'Nota di debito' },
  TD06: { label: 'Parcella' },
  TD16: { label: 'Integrazione reverse charge interno', forcePassive: true, reverseCharge: true },
  TD17: { label: 'Integrazione/autofattura acquisto servizi estero', forcePassive: true, reverseCharge: true },
  TD18: { label: 'Integrazione acquisto beni intracomunitari', forcePassive: true, reverseCharge: true },
  TD19: { label: 'Integrazione/autofattura art. 17 c.2', forcePassive: true, reverseCharge: true },
  TD20: { label: 'Autofattura per regolarizzazione', forcePassive: true },
  TD21: { label: 'Autofattura per splafonamento', forcePassive: true },
  TD24: { label: 'Fattura differita' },
  TD25: { label: 'Fattura differita art. 21 c.4' },
  TD26: { label: 'Cessione di beni ammortizzabili' },
  TD27: { label: 'Fattura per autoconsumo' },
};

function normalizeId(value) {
  const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^IT\d{11}$/.test(raw) ? raw.slice(2) : raw;
}

function idsOf(party) {
  return [normalizeId(party.vat), normalizeId(party.cf)].filter(Boolean);
}

function classify(doc, studioIds) {
  const studio = (studioIds || []).map(normalizeId).filter(Boolean);
  if (!studio.length) throw new Error('studioIds mancante: configura P.IVA/CF in Impostazioni');

  const rule = TIPO_DOC[doc.tipoDoc];
  const isStudio = ids => ids.some(id => studio.includes(id));
  const studioIsCedente = isStudio(idsOf(doc.cedente));
  const studioIsCessionario = isStudio(idsOf(doc.cessionario));

  let direction;
  let needsReview = false;
  let reviewReason = null;

  if (rule && rule.forcePassive) {
    direction = 'passive';
  } else if (studioIsCedente && !studioIsCessionario) {
    direction = 'active';
  } else if (studioIsCessionario && !studioIsCedente) {
    direction = 'passive';
  } else {
    // Both or neither: cannot be decided safely, so ask instead of guessing.
    direction = studioIsCedente ? 'active' : 'passive';
    needsReview = true;
    reviewReason = studioIsCedente
      ? 'Lo studio risulta sia cedente sia cessionario'
      : 'Lo studio non è nessuna delle parti del documento';
  }

  if (!rule) {
    needsReview = true;
    reviewReason = `TipoDocumento ${doc.tipoDoc || '(assente)'} non riconosciuto`;
  }

  return {
    direction,
    reverseCharge: !!(rule && rule.reverseCharge),
    counterparty: direction === 'active' ? doc.cessionario : doc.cedente,
    tipoDocLabel: rule ? rule.label : null,
    needsReview,
    reviewReason,
  };
}

// The cedente is stable across both copies of a reverse-charge self-invoice,
// which is what makes COPIA_x.xml and x.xml collapse to one record.
function dedupKey(doc) {
  const cedenteId = normalizeId(doc.cedente.vat) || normalizeId(doc.cedente.cf);
  return [cedenteId, doc.tipoDoc, String(doc.number).trim(), doc.date].join('|');
}

module.exports = { TIPO_DOC, normalizeId, classify, dedupKey };
