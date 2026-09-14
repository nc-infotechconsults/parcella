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

  // ORDER IS THE POLICY: first match wins, so concrete categories precede
  // generic ones. A parking invoice reading "Totale soste" and "Canone
  // abbonamento" must land on Auto, not Software; a line reading "corso" is
  // training whatever its subject, so Formazione precedes Software.
  //
  // Each entry has two halves: STEMS take \w* so Italian inflections match
  // ("carburant" -> carburante, "pedagg" -> pedaggio/pedaggi), while genuinely
  // ambiguous short tokens stay whole words so they cannot swallow longer ones
  // ("monitor" must not match "monitoraggio", "sim" must not match
  // "simulazione", "volo" must not match "volontariato"). A trailing \b after a
  // stem is the bug this shape exists to prevent: it silently blocks every
  // inflected form, dropping real invoices into Altro at 100% deducibilita.
  const KEYWORDS = [
    [/\b(?:carburant|benzina|gasolio|pedagg|autostrad|sost[ae]|parchegg|pneumatic|revision)\w*|\b(?:noleggio auto|gasolio)\b/i, "Auto"],
    [/\b(?:notebook|laptop|macbook|stampant|hardware|computer|iphone|ipad|alimentator)\w*|\b(?:monitor|server|pc)\b/i, "Hardware"],
    [/\b(?:corso|corsi|formazion|training|webinar|certificazion)\w*/i, "Formazione"],
    [/\b(?:abbonament|licen[zc]|subscription|software|hosting|dominio|github|microsoft|adobe|figma)\w*|\b(?:saas|cloud)\b/i, "Software"],
    [/\b(?:telefon|fibra|connettivit)\w*|\b(?:mobile|sim|adsl)\b/i, "Telefonia"],
    // 'acqua' alone is not a utility signal — bottled water is a beverage
    // purchase, so utility matching keys on idric/acquedott instead.
    [/\b(?:energia|elettric|utenz|bolletta|bollette|idric|acquedott)\w*|\b(?:gas|enel|luce)\b/i, "Utenze"],
    [/\b(?:commission)\w*|\b(?:spese bancarie|bollo c\/c|canone conto)\b/i, "Commissioni bancarie"],
    [/\b(?:consulen|notai|commercialist|avvocat|perizi)\w*/i, "Consulenze"],
    [/\b(?:albergh|pernottament)\w*|\b(?:hotel|albergo|b&b)\b/i, "Pernottamento"],
    [/\b(?:ristorant|catering)\w*|\b(?:pranzo|pranzi|cena|cene|bar|menu|menù|coperto)\b/i, "Pasti"],
    [/\b(?:trasfert|bigliett|trenitalia)\w*|\b(?:treno|treni|italo|volo|voli|aereo|taxi)\b/i, "Trasferta"],
    [/\b(?:cancelleri|toner)\w*|\b(?:carta|ufficio)\b/i, "Cancelleria"],
    [/\b(?:polizz|assicurazion)\w*|\brc professionale\b/i, "Assicurazioni"],
    [/\b(?:imposta di bollo|marca da bollo|diritti camerali)\b/i, "Bolli/Tasse"],
  ];

  function guessCategory(text) {
    const s = String(text || '');
    for (const [re, category] of KEYWORDS) if (re.test(s)) return category;
    return "Altro";
  }

  return { CATEGORY_RULES, AMORTIZE_THRESHOLD, guessCategory };
});
