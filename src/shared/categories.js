// Expense/cost categories and their default fiscal treatment.
// UMD: require()-able from the Electron main process, window.* in the renderer
// (there is no bundler — the renderer loads this via a <script> tag).
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') Object.assign(window, api);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {

  const CATEGORY_RULES = {
    "Trasferta": { deductPct: 100, vatPct: 10, vatExempt: false },
    "Pasti": { deductPct: 75, vatPct: 10, vatExempt: false, hint: "Pasti deducibili 75% (art. 109 TUIR)" },
    "Pernottamento": { deductPct: 75, vatPct: 10, vatExempt: false },
    "Software": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Stock photo": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Cancelleria": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Formazione": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Telefonia": { deductPct: 80, vatPct: 22, vatExempt: false, hint: "Telefonia deducibile 80% (art. 102 TUIR)" },
    "Utenze": { deductPct: 100, vatPct: 22, vatExempt: false, hint: "Energia, gas, internet dello studio" },
    "Commissioni bancarie": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Esenti IVA art. 10 DPR 633/72" },
    "Consulenze": { deductPct: 100, vatPct: 22, vatExempt: false },
    "Auto": { deductPct: 20, vatPct: 22, vatExempt: false, hint: "Auto non strumentale: deducibilità 20%" },
    "Rimborso km": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Rimborso chilometrico al tasso ACI (fuori campo IVA). Importo = km × tariffa ACI vigente." },
    "Hardware": { deductPct: 100, vatPct: 22, vatExempt: false, hint: "Cespite > 516,46€ → ammortamento pluriennale" },
    "Assicurazioni": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Assicurazioni esenti IVA art. 10 DPR 633/72" },
    "Bolli/Tasse": { deductPct: 100, vatPct: 0, vatExempt: true, hint: "Operazioni fuori campo IVA" },
    "Altro": { deductPct: 100, vatPct: 22, vatExempt: false },
  };

  const AMORTIZE_THRESHOLD = 516.46;

  // ORDER IS THE POLICY: first match wins, so concrete/physical categories are
  // listed before generic ones. A parking invoice reading "Totale soste" and
  // "Canone abbonamento" must land on Auto, not on Software.
  const KEYWORDS = [
    [/\b(carburant|benzina|gasolio|pedaggi|autostrad|sost\w*|parcheggi|noleggio auto|revisione|pneumatic)\b/i, "Auto"],
    [/\b(notebook|laptop|macbook|monitor|server|stampante|hardware|pc |computer|iphone|ipad|alimentatore)\b/i, "Hardware"],
    [/\b(abbonament|licen[zc]|subscription|saas|cloud|software|hosting|dominio|github|microsoft|adobe|figma)\b/i, "Software"],
    [/\b(corso|formazione|training|webinar|master|certificazione)\b/i, "Formazione"],
    [/\b(telefon|mobile|sim|fibra|adsl|connettivit)\b/i, "Telefonia"],
    [/\b(energia|elettric|gas|acqua|utenz|bolletta|enel|luce)\b/i, "Utenze"],
    [/\b(commission|spese bancarie|bollo c\/c|canone conto)\b/i, "Commissioni bancarie"],
    [/\b(consulen|notaio|commercialista|avvocato|perizia)\b/i, "Consulenze"],
    [/\b(hotel|albergo|pernottament|b&b)\b/i, "Pernottamento"],
    [/\b(ristorant|pranzo|cena|bar |catering)\b/i, "Pasti"],
    [/\b(treno|trenitalia|italo|volo|aereo|taxi|trasfert|biglietto)\b/i, "Trasferta"],
    [/\b(cancelleri|toner|carta|ufficio)\b/i, "Cancelleria"],
    [/\b(polizza|assicurazion|rc professionale)\b/i, "Assicurazioni"],
    [/\b(imposta di bollo|marca da bollo|diritti camerali)\b/i, "Bolli/Tasse"],
  ];

  function guessCategory(text) {
    const s = String(text || '');
    for (const [re, category] of KEYWORDS) if (re.test(s)) return category;
    return "Altro";
  }

  return { CATEGORY_RULES, AMORTIZE_THRESHOLD, guessCategory };
});
