// tests/helpers/f24-scenarios.js
//
// Gli scenari su cui si fotografa il calendario F24 prima dello scadenzario
// (capture-legacy-f24.js) e su cui il generatore nuovo deve ridare le stesse
// date e gli stessi importi (test-f24-scheme-equivalence.js). Spunte tutte
// false e storico vuoto: si confrontano le stime, non gli stati.

// Una fattura attiva incassata per trimestre, così ogni periodo IVA ha un saldo
// positivo; l'anno prima vale una volta e mezza quello corrente, così una rata
// misurata sull'anno sbagliato non passa per coincidenza.
const invoice = (year, quarter, imponibile) => {
  const month = String(quarter * 3 - 1).padStart(2, '0');
  const imposta = Math.round(imponibile * 0.22 * 100) / 100;
  return {
    id: `a${year}q${quarter}`, direction: 'active', reverseCharge: false, sign: 1, tipoDoc: 'TD01',
    date: `${year}-${month}-10`, monthKey: `${year}-${month}`, clientId: null, linkedMonthKey: null,
    totals: { imponibile, imposta, documento: imponibile + imposta },
    vatSummary: [{ vatPct: 22, imponibile, imposta }],
    withholding: null, cassa: null, payment: null, counterparty: { name: 'Cliente' },
    fiscal: null, settlement: { status: 'settled', date: `${year}-${month}-20`, amount: imponibile + imposta },
  };
};
const yearOf = (year, perQuarter) => [1, 2, 3, 4].map(q => invoice(year, q, perQuarter));

const flagsOff = {
  irpefAcconto1Paid: false, irpefAcconto2Paid: false,
  cassaAcconto1Paid: false, cassaAcconto2Paid: false,
  ivaQ1Paid: false, ivaQ2Paid: false, ivaQ3Paid: false, ivaQ4Paid: false,
};
const baseFiscal = {
  ...flagsOff, cassaContribPct: 26.07, addRegPct: 1.73, addComPct: 0.8,
  irpefPrevYear: 0, cassaPrevYear: 0, f24History: [],
};

const SCENARIOS = [
  {
    name: 'gs-con-anno-prima', year: '2026',
    fiscal: { ...baseFiscal },
    studio: { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' },
    invoices: [...yearOf(2026, 10000), ...yearOf(2025, 15000)],
  },
  {
    name: 'gs-ripiego', year: '2026',
    fiscal: { ...baseFiscal, irpefPrevYear: 28400, cassaPrevYear: 6800 },
    studio: { tipoSoggetto: 'professionista', cassaName: 'Gestione Separata INPS' },
    invoices: yearOf(2026, 10000),
  },
  {
    name: 'cassa-privata', year: '2026',
    fiscal: { ...baseFiscal },
    studio: { tipoSoggetto: 'professionista', cassaName: 'Inarcassa' },
    invoices: [...yearOf(2026, 10000), ...yearOf(2025, 15000)],
  },
  {
    name: 'ditta', year: '2026',
    fiscal: { ...baseFiscal, inpsMinimale: 4427, inpsPctVariabile: 24 },
    studio: { tipoSoggetto: 'ditta_individuale' },
    invoices: [...yearOf(2026, 10000), ...yearOf(2025, 15000)],
  },
  {
    name: 'societa', year: '2026',
    fiscal: { ...baseFiscal },
    studio: { tipoSoggetto: 'societa' },
    invoices: [...yearOf(2026, 10000), ...yearOf(2025, 15000)],
  },
];

module.exports = { SCENARIOS };
