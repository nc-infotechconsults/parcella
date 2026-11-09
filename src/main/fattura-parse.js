// Parses FatturaPA XML (FPR12/FPA12) into normalized document objects.
// Pure: no filesystem, no classification, no fiscal interpretation.
const { XMLParser } = require('fast-xml-parser');

// parseTagValue:false is deliberate — "16/PRV/26" and "1300" are document
// numbers, not numbers, and "1.00000000" must not become a float by accident.
// removeNSPrefix:true normalizes the p:/ns3: prefixes real exports differ on.
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
});

const asArray = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);
const str = v => (v === undefined || v === null ? '' : String(v).trim());
const money = v => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};
const numOrNull = v => {
  if (v === undefined || v === null || str(v) === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

// TD04 (nota di credito) reverses every amount it carries.
const NEGATIVE_DOCS = new Set(['TD04', 'TD08']);

function party(node) {
  const da = (node && node.DatiAnagrafici) || {};
  const an = da.Anagrafica || {};
  const iva = da.IdFiscaleIVA || {};
  const sede = (node && node.Sede) || {};
  const name = str(an.Denominazione) || [str(an.Nome), str(an.Cognome)].filter(Boolean).join(' ');
  const street = [str(sede.Indirizzo), str(sede.NumeroCivico)].filter(Boolean).join(' ');
  return {
    name,
    vat: str(iva.IdCodice),
    vatCountry: str(iva.IdPaese),
    cf: str(da.CodiceFiscale),
    country: str(sede.Nazione) || str(iva.IdPaese),
    address: [street, str(sede.CAP), str(sede.Comune), str(sede.Provincia)].filter(Boolean).join(', '),
    regimeFiscale: str(da.RegimeFiscale),
  };
}

function parseFattura(xml) {
  const root = parser.parse(xml);
  const doc = root.FatturaElettronica;
  if (!doc) throw new Error('Non è una FatturaElettronica');

  const header = doc.FatturaElettronicaHeader || {};
  const format = str(doc['@_versione']) || str((header.DatiTrasmissione || {}).FormatoTrasmissione);
  const cedente = party(header.CedentePrestatore);
  const cessionario = party(header.CessionarioCommittente);

  return asArray(doc.FatturaElettronicaBody).map((body, bodyIndex) => {
    const dg = ((body.DatiGenerali || {}).DatiGeneraliDocumento) || {};
    const bs = body.DatiBeniServizi || {};
    const tipoDoc = str(dg.TipoDocumento);
    const date = str(dg.Data);

    const lines = asArray(bs.DettaglioLinee).map(l => ({
      n: numOrNull(l.NumeroLinea),
      desc: str(l.Descrizione),
      qty: numOrNull(l.Quantita),
      unitPrice: numOrNull(l.PrezzoUnitario),
      total: money(l.PrezzoTotale),
      vatPct: numOrNull(l.AliquotaIVA),
      natura: str(l.Natura) || null,
      periodStart: str(l.DataInizioPeriodo) || null,
      periodEnd: str(l.DataFinePeriodo) || null,
      ritenuta: str(l.Ritenuta) === 'SI',
    }));

    const vatSummary = asArray(bs.DatiRiepilogo).map(r => ({
      vatPct: numOrNull(r.AliquotaIVA),
      natura: str(r.Natura) || null,
      imponibile: money(r.ImponibileImporto),
      imposta: money(r.Imposta),
      esigibilita: str(r.EsigibilitaIVA) || null,
      riferimentoNormativo: str(r.RiferimentoNormativo) || null,
    }));

    const rit = dg.DatiRitenuta ? asArray(dg.DatiRitenuta)[0] : null;
    const cassaNode = dg.DatiCassaPrevidenziale ? asArray(dg.DatiCassaPrevidenziale)[0] : null;
    const bollo = dg.DatiBollo ? asArray(dg.DatiBollo)[0] : null;
    const payNode = body.DatiPagamento ? asArray(body.DatiPagamento)[0] : null;
    const payDet = payNode ? asArray(payNode.DettaglioPagamento)[0] : null;

    const imponibile = money(vatSummary.reduce((s, v) => s + v.imponibile, 0));
    const imposta = money(vatSummary.reduce((s, v) => s + v.imposta, 0));

    return {
      format,
      bodyIndex,
      cedente,
      cessionario,
      tipoDoc,
      number: str(dg.Numero),
      date,
      monthKey: date.slice(0, 7),
      sign: NEGATIVE_DOCS.has(tipoDoc) ? -1 : 1,
      currency: str(dg.Divisa) || 'EUR',
      causale: asArray(dg.Causale).map(str).filter(Boolean).join(' — '),
      lines,
      vatSummary,
      totals: {
        imponibile,
        imposta,
        documento: money(dg.ImportoTotaleDocumento) || money(imponibile + imposta),
        arrotondamento: money(dg.Arrotondamento),
        bollo: bollo ? money(bollo.ImportoBollo) : 0,
      },
      withholding: rit ? {
        tipo: str(rit.TipoRitenuta),
        aliquota: numOrNull(rit.AliquotaRitenuta),
        importo: money(rit.ImportoRitenuta),
        causale: str(rit.CausalePagamento) || null,
      } : null,
      cassa: cassaNode ? {
        tipo: str(cassaNode.TipoCassa),
        aliquota: numOrNull(cassaNode.AlCassa),
        importo: money(cassaNode.ImportoContributoCassa),
        imponibile: money(cassaNode.ImponibileCassa),
        vatPct: numOrNull(cassaNode.AliquotaIVA),
      } : null,
      payment: payDet ? {
        conditions: str(payNode.CondizioniPagamento) || null,
        method: str(payDet.ModalitaPagamento) || null,
        dueDate: str(payDet.DataScadenzaPagamento) || null,
        amount: money(payDet.ImportoPagamento),
      } : null,
    };
  });
}

module.exports = { parseFattura, money, asArray, str, numOrNull };
