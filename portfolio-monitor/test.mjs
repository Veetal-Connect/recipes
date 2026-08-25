// Sin red y sin API key. Los datos son de mentira pero reproducen la forma real del
// endpoint v7 y los tres casos que hacen que una cartera mienta: un hotel medido de
// otra manera, uno con menos noches, y uno cuya tarifa más barata cambia de producto.
import assert from 'node:assert/strict';
import {
  board, cancellation, productKey, median, fingerprint,
  cheapestOfNight, summarise, withDeviation, comparability,
} from './portfolio.mjs';

const rate = (price, meal = {}, cancel = {}, meta = {}) => ({
  price_per_night: price,
  currency: 'EUR',
  provider: 'booking',
  meal_plan: { breakfast: false, half_board: false, full_board: false, all_inclusive: false, ...meal },
  cancellation: { free_cancellation: false, no_refundable: false, ...cancel },
  _meta: { is_primary: true, visitor_type: 'anonymous', device_type: 'desktop', ...meta },
});

let checks = 0;
const check = (label, fn) => { fn(); checks += 1; console.log('  ✓', label); };

check('el régimen se lee del más inclusivo al menos', () => {
  assert.equal(board(rate(1, { all_inclusive: true, breakfast: true })), 'AI');
  assert.equal(board(rate(1, { breakfast: true })), 'BB');
  assert.equal(board(rate(1)), 'RO');
});

check('sin bandera de cancelación se asume no reembolsable', () => {
  assert.equal(cancellation(rate(1)), 'nr');
  assert.equal(cancellation(rate(1, {}, { free_cancellation: true })), 'flex');
  assert.equal(productKey(rate(1, { breakfast: true }, { free_cancellation: true })), 'BB/flex');
});

check('la mediana no se deja arrastrar por un extremo', () => {
  assert.equal(median([100, 200, 300]), 200);
  assert.equal(median([100, 200, 300, 10000]), 250);
  assert.equal(median([]), null);
});

check('de una noche se queda la más barata, con su producto', () => {
  const best = cheapestOfNight([rate(300, { breakfast: true }), rate(200), rate(250)]);
  assert.equal(best.price, 200);
  assert.equal(best.product, 'RO/nr');
});

check('la huella distingue cómo se midió cada hotel', () => {
  const anon = fingerprint([rate(100)]);
  const genius = fingerprint([rate(100, {}, {}, { visitor_type: 'genius' })]);
  assert.notEqual(anon, genius, 'un precio Genius no es un precio público');
  assert.match(anon, /booking/);
});

const CARTERA = {
  alfa: { name: 'Alfa', nights: { '2026-08-19': [rate(100)], '2026-08-20': [rate(140)] }, rates: [rate(100), rate(140)] },
  beta: { name: 'Beta', nights: { '2026-08-19': [rate(200)], '2026-08-20': [rate(220)] }, rates: [rate(200), rate(220)] },
  // Menos noches: su ADR se construye sobre otro trozo del calendario.
  gamma: { name: 'Gamma', nights: { '2026-08-19': [rate(300)] }, rates: [rate(300)] },
  // Medido de otra forma: mismo aspecto, otra pregunta a Booking.
  delta: {
    name: 'Delta',
    nights: { '2026-08-19': [rate(150, {}, {}, { device_type: 'mobile' })], '2026-08-20': [rate(150, {}, {}, { device_type: 'mobile' })] },
    rates: [rate(150, {}, {}, { device_type: 'mobile' }), rate(150, {}, {}, { device_type: 'mobile' })],
  },
};

const rows = summarise(CARTERA);

check('una fila por hotel, ordenadas por ADR descendente', () => {
  assert.deepEqual(rows.map((r) => r.slug), ['gamma', 'beta', 'delta', 'alfa']);
  assert.equal(rows.find((r) => r.slug === 'alfa').adr, 120);
  assert.equal(rows.find((r) => r.slug === 'alfa').nights, 2);
});

const { median: mid, rows: conDesviacion } = withDeviation(rows);

check('la desviación se mide contra la mediana, no contra la media', () => {
  // ADRs: 300, 210, 150, 120 → mediana (210+150)/2 = 180. La media sería 195.
  assert.equal(mid, 180);
  assert.equal(Math.round(conDesviacion.find((r) => r.slug === 'gamma').deviation_pct), 67);
});

const hallazgos = comparability(conDesviacion);

check('avisa del hotel medido de otra manera', () => {
  const f = hallazgos.filter((h) => h.type === 'fingerprint');
  assert.ok(f.length >= 2, 'hay más de una huella en la cartera');
  assert.ok(f.some((h) => h.hotels.includes('delta')));
});

check('avisa del hotel con menos noches', () => {
  const c = hallazgos.find((h) => h.type === 'coverage');
  assert.equal(c.slug, 'gamma');
  assert.equal(c.nights, 1);
  assert.equal(c.of, 2);
});

check('una cartera homogénea no genera ningún aviso', () => {
  const limpia = summarise({
    uno: { name: 'Uno', nights: { d1: [rate(100)] }, rates: [rate(100)] },
    dos: { name: 'Dos', nights: { d1: [rate(120)] }, rates: [rate(120)] },
  });
  assert.equal(comparability(withDeviation(limpia).rows).length, 0);
});

console.log(`\nOK — ${checks} comprobaciones`);
