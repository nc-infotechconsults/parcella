// tests/test-addizionali.js
//
// Correzione 1 della spec: le ritenute d'acconto subite si scomputano solo
// dall'IRPEF. Le addizionali restano dovute per intero e si pagano con codici
// propri (3801, 3843/3844), non dentro il 4001. Prima l'eccedenza di ritenute
// sull'IRPEF si "mangiava" anche le addizionali.
//
// Reddito 50.000: IRPEF lorda 28.000 × 23% + 22.000 × 35% = 14.140;
// addizionale regionale 1,73% = 865, comunale 0,8% = 400.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadRenderer } = require('./helpers/load-renderer');

const r = loadRenderer();
const near = (a, b, tol = 0.006) => assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
const fy = (ritenuta) => ({
  consuntivo: {
    ricaviIncassati: 50000, costiDeducibili: 0, costiEsercizio: 0, quoteAmmortamento: 0,
    ritenutaIncassata: ritenuta,
  },
});
const fiscal = { addRegPct: 1.73, addComPct: 0.8, cassaContribPct: 26.07 };
const liab = (ritenuta) => r.taxLiability(fy(ritenuta), fiscal, 'professionista', 0);

test('le ritenute riducono solo l\'IRPEF', () => {
  const t = liab(10000);
  near(t.irpefLorda, 14140);
  near(t.irpefSola, 4140);
  near(t.addRegDovuta, 865);
  near(t.addComDovuta, 400);
  near(t.irpefNetta, 4140 + 865 + 400);
});

test('le ritenute oltre l\'IRPEF lorda non coprono le addizionali', () => {
  const t = liab(14640);
  near(t.irpefSola, 0);
  near(t.ritenutaCredito, 500);
  near(t.irpefNetta, 865 + 400);   // prima: max(0, 14.140 + 1.265 − 14.640) = 765
});

test('quando l\'IRPEF copre le ritenute il totale non cambia', () => {
  const t = liab(10000);
  const vecchio = Math.max(0, 14140 + 865 + 400 - 10000);
  near(t.irpefNetta, vecchio);
});
