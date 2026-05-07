// Mock data for the timesheet app
window.APP_DATA = {
  user: {
    name: "Marco Rinaldi",
    role: "Ing. Informatico",
    initials: "MR",
    firm: "Studio Rinaldi",
    address: "Via Mazzini 14, 20121 Milano",
    piva: "P.IVA 09876543210",
    cf: "RNLMRC85A01F205X",
    email: "marco@studiorinaldi.it",
    iban: "IT60 X054 2811 1010 0000 0123 456",
    phone: "+39 02 8765432",
    bank: "Intesa Sanpaolo",
    bic: "BCITITMM",
    regime: "ordinario",
    cassaName: "Inarcassa",
    tipoSoggetto: "professionista",  // "professionista" | "ditta_individuale" | "societa"
    tipoInps: "artigiano",           // usato solo per ditta_individuale
  },

  clients: [
    {
      id: "c1",
      name: "Acme Industries S.p.A.",
      shortName: "Acme",
      piva: "IT12345678901",
      address: "Corso Buenos Aires 33, 20124 Milano",
      contact: "Laura Bianchi",
      email: "l.bianchi@acme.it",
      status: "active",
      // contractual conditions
      hourlyRate: 85,
      hoursPlafond: 40, // monthly cap
      cassaPct: 4,
      cassaIncluded: false,
      vatPct: 22,
      withholding: false,
      paymentDays: 30,
      contractStart: "2026-01-01",
      contractEnd: "2026-12-31",
      commesse: [
        { code: "ACM-2026-01", name: "Migrazione ERP", color: "oklch(0.6 0.13 250)" },
        { code: "ACM-2026-02", name: "Consulenza DPO", color: "oklch(0.65 0.12 180)" },
      ],
      notes: "Riunione settimanale lunedì ore 10. Fattura entro il 5 del mese successivo."
    },
    {
      id: "c2",
      name: "Borealis Tech S.r.l.",
      shortName: "Borealis",
      piva: "IT98765432109",
      address: "Via Tortona 25, 20144 Milano",
      contact: "Davide Conti",
      email: "davide@borealis.tech",
      status: "active",
      hourlyRate: 95,
      hoursPlafond: 20,
      cassaPct: 4,
      cassaIncluded: true,
      vatPct: 22,
      withholding: false,
      paymentDays: 60,
      contractStart: "2026-03-01",
      contractEnd: null,
      commesse: [
        { code: "BOR-AUDIT", name: "Audit infrastruttura", color: "oklch(0.65 0.13 50)" },
      ],
      notes: ""
    },
    {
      id: "c3",
      name: "Fondazione Civita",
      shortName: "Civita",
      piva: "IT11223344556",
      address: "Piazza Duomo 7, 20121 Milano",
      contact: "Anna Greco",
      email: "a.greco@civita.org",
      status: "active",
      hourlyRate: 70,
      hoursPlafond: 30,
      cassaPct: 4,
      cassaIncluded: false,
      vatPct: 0,
      withholding: true,
      paymentDays: 30,
      contractStart: "2026-02-15",
      contractEnd: "2026-08-15",
      commesse: [
        { code: "FCV-WEB", name: "Restyling sito istituzionale", color: "oklch(0.6 0.13 320)" },
      ],
      notes: "Esente IVA art. 10. Ritenuta d'acconto 20%."
    },
    {
      id: "c4",
      name: "Helios Renewables",
      shortName: "Helios",
      piva: "IT55667788990",
      address: "Via Solferino 1, 20121 Milano",
      contact: "Pietro Morandi",
      email: "p.morandi@helios.energy",
      status: "paused",
      hourlyRate: 110,
      hoursPlafond: 15,
      cassaPct: 4,
      cassaIncluded: false,
      vatPct: 22,
      withholding: false,
      paymentDays: 45,
      contractStart: "2025-09-01",
      contractEnd: "2026-03-31",
      commesse: [
        { code: "HEL-DD-2026", name: "Due diligence impianto FV", color: "oklch(0.7 0.13 100)" },
      ],
      notes: ""
    },
  ],

  // Activities for May 2026 (current month)
  // day is 1-indexed day of month, monthKey "2026-05"
  activities: [
    // Acme - 2 commesse alternate
    { id: "a1", clientId: "c1", commessa: "ACM-2026-01", day: 4, hours: 4, desc: "Analisi requisiti modulo magazzino", monthKey: "2026-05" },
    { id: "a2", clientId: "c1", commessa: "ACM-2026-01", day: 5, hours: 6, desc: "Setup ambienti staging", monthKey: "2026-05" },
    { id: "a3", clientId: "c1", commessa: "ACM-2026-01", day: 6, hours: 4, desc: "Migrazione dati anagrafica", monthKey: "2026-05" },
    { id: "a4", clientId: "c1", commessa: "ACM-2026-02", day: 7, hours: 2, desc: "Audit privacy registro trattamenti", monthKey: "2026-05" },
    { id: "a5", clientId: "c1", commessa: "ACM-2026-01", day: 11, hours: 5, desc: "Test integrazione fatturazione", monthKey: "2026-05" },
    { id: "a6", clientId: "c1", commessa: "ACM-2026-01", day: 12, hours: 7, desc: "Bug fixing post-migrazione", monthKey: "2026-05" },
    { id: "a7", clientId: "c1", commessa: "ACM-2026-02", day: 13, hours: 3, desc: "Riunione DPO mensile", monthKey: "2026-05" },

    // Borealis
    { id: "b1", clientId: "c2", commessa: "BOR-AUDIT", day: 5, hours: 2, desc: "Kick-off audit", monthKey: "2026-05" },
    { id: "b2", clientId: "c2", commessa: "BOR-AUDIT", day: 8, hours: 4, desc: "Scansione vulnerabilità", monthKey: "2026-05" },
    { id: "b3", clientId: "c2", commessa: "BOR-AUDIT", day: 11, hours: 3.5, desc: "Stesura report intermedio", monthKey: "2026-05" },

    // Civita
    { id: "v1", clientId: "c3", commessa: "FCV-WEB", day: 4, hours: 2, desc: "Wireframe homepage", monthKey: "2026-05" },
    { id: "v2", clientId: "c3", commessa: "FCV-WEB", day: 6, hours: 3, desc: "Design system iniziale", monthKey: "2026-05" },
    { id: "v3", clientId: "c3", commessa: "FCV-WEB", day: 7, hours: 4, desc: "Implementazione header e nav", monthKey: "2026-05" },
    { id: "v4", clientId: "c3", commessa: "FCV-WEB", day: 12, hours: 2.5, desc: "Revisione contenuti sezione storia", monthKey: "2026-05" },
  ],

  expenses: [
    // Per conto del cliente (rimborsabili) — sempre 100% deducibili, no ammortamento
    { id: "e1", clientId: "c1", day: 5, monthKey: "2026-05", category: "Trasferta", desc: "Treno A/R Milano-Bologna riunione kickoff", amount: 78.40, billable: true, vatExempt: false, vatPct: 10, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e2", clientId: "c1", day: 5, monthKey: "2026-05", category: "Pasti", desc: "Pranzo cliente con team Acme", amount: 42.00, billable: true, vatExempt: false, vatPct: 10, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e3", clientId: "c1", day: 11, monthKey: "2026-05", category: "Software", desc: "Licenza tool migrazione (1 mese)", amount: 89.00, billable: true, vatExempt: false, vatPct: 22, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e4", clientId: "c2", day: 8, monthKey: "2026-05", category: "Trasferta", desc: "Taxi sopralluogo data center", amount: 24.50, billable: true, vatExempt: false, vatPct: 10, deductPct: 100, amortize: false, paymentMethod: "Contanti", hasReceipt: true },
    { id: "e5", clientId: "c3", day: 7, monthKey: "2026-05", category: "Stock photo", desc: "Pacchetto immagini Unsplash+", amount: 35.00, billable: true, vatExempt: false, vatPct: 22, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: false },
    // Per conto proprio (studio) - con regole fiscali realistiche
    { id: "e6", clientId: null, day: 2, monthKey: "2026-05", category: "Software", desc: "Abbonamento Figma annuale", amount: 180.00, billable: false, vatExempt: false, vatPct: 22, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e7", clientId: null, day: 4, monthKey: "2026-05", category: "Cancelleria", desc: "Materiale ufficio", amount: 28.30, billable: false, vatExempt: false, vatPct: 22, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e8", clientId: null, day: 6, monthKey: "2026-05", category: "Formazione", desc: "Corso online architettura cloud", amount: 149.00, billable: false, vatExempt: false, vatPct: 22, deductPct: 100, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e9", clientId: null, day: 9, monthKey: "2026-05", category: "Telefonia", desc: "Bolletta TIM Business maggio", amount: 45.00, billable: false, vatExempt: false, vatPct: 22, deductPct: 80, amortize: false, paymentMethod: "Bonifico", hasReceipt: true },
    { id: "e10", clientId: null, day: 14, monthKey: "2026-05", category: "Auto", desc: "Carburante", amount: 65.00, billable: false, vatExempt: false, vatPct: 22, deductPct: 20, amortize: false, paymentMethod: "Carta", hasReceipt: true },
    { id: "e11", clientId: null, day: 15, monthKey: "2026-05", category: "Hardware", desc: "MacBook Pro 14\" M4 (cespite)", amount: 2499.00, billable: false, vatExempt: false, vatPct: 22, deductPct: 100, amortize: true, amortYears: 4, paymentMethod: "Bonifico", hasReceipt: true },
    { id: "e12", clientId: null, day: 18, monthKey: "2026-05", category: "Assicurazioni", desc: "Polizza RC professionale (esente IVA art. 10)", amount: 320.00, billable: false, vatExempt: true, vatPct: 0, deductPct: 100, amortize: false, paymentMethod: "Bonifico", hasReceipt: true },
    { id: "e13", clientId: null, day: 20, monthKey: "2026-05", category: "Bolli/Tasse", desc: "Marca da bollo (fuori campo IVA)", amount: 16.00, billable: false, vatExempt: true, vatPct: 0, deductPct: 100, amortize: false, paymentMethod: "Contanti", hasReceipt: true },
    { id: "e14", clientId: null, day: 22, monthKey: "2026-05", category: "Pasti", desc: "Pranzi di lavoro vari (deducibilità 75%)", amount: 84.00, billable: false, vatExempt: false, vatPct: 10, deductPct: 75, amortize: false, paymentMethod: "Carta", hasReceipt: true },
  ],

  // Dati fiscali / contabili per la schermata Tasse
  fiscal: {
    year: 2026,
    // Parametri INPS per ditta individuale (ignorati per professionisti)
    inpsMinimale: 4427.00,          // minimale fisso annuo 2025 (artigiani INPS)
    inpsPctVariabile: 24.0,         // % su reddito eccedente il minimale (artigiani)
    irapPct: 3.9,                   // aliquota IRAP base (solo ditta/società con autonoma org.)
    ivaLiquidazione: "trimestrale", // "trimestrale" | "mensile"
    // Acconti già versati (es: dichiarazione anno precedente)
    irpefPrevYear: 28400,
    irpefAcconto1Paid: true,
    irpefAcconto2Paid: false,
    cassaPrevYear: 6800,
    cassaAcconto1Paid: true,
    cassaAcconto2Paid: false,
    // IVA — saldi trimestrali già liquidati
    ivaQ1Paid: true,
    ivaQ1Amount: 4280.00,
    ivaQ2Paid: false,
    ivaQ3Paid: false,
    ivaQ4Paid: false,
    // Aliquote
    cassaContribPct: 14.5,
    irpefBrackets: [
      { upTo: 28000, rate: 23 },
      { upTo: 50000, rate: 35 },
      { upTo: Infinity, rate: 43 },
    ],
    addRegPct: 1.73,
    addComPct: 0.80,
    // F24 storico — voci manuali (integrate con quelle calcolate)
    f24History: [
      { id: "f1", date: "2026-02-16", code: "6031", desc: "IVA 4° trim 2025", amount: 3120.00, status: "paid" },
      { id: "f2", date: "2026-05-16", code: "6031", desc: "IVA 1° trim 2026", amount: 4280.00, status: "paid" },
    ],
  },
};
