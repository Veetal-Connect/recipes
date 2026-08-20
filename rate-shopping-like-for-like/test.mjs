// Sin red y sin API key: los datos son de mentira, pero reproducen la forma exacta
// que devuelve el feed y el caso que motiva la receta — un competidor que no vende
// tarifa flexible, y otro cuya no reembolsable es MÁS cara que la flexible.
import assert from 'node:assert/strict';
import { board, cancellation, productKey, cheapestByProduct, buildMatrix, position } from './compare.mjs';

const rate = (price, meal = {}, cancel = {}, extra = {}) => ({
  price_per_night: price,
  currency: 'EUR',
  room_type: 'Doble',
  meal_plan: { breakfast: false, half_board: false, full_board: false, all_inclusive: false, ...meal },
  cancellation: { free_cancellation: false, free_cancellation_days: null, no_refundable: false, ...cancel },
  ...extra,
});

const meta = (slug, name, isPrimary) => ({ _meta: { accommodation_slug: slug, accommodation_name: name, is_primary: isPrimary } });

const REPORT = {
  mine: [
    { ...rate(411.4, {}, { free_cancellation: true }), ...meta('mine', 'My Hotel', true) },
    rate(435.2, { breakfast: true }, { free_cancellation: true }),
  ],
  // Solo vende no reembolsable: comparar contra "su tarifa más barata" es comparar
  // una flexible contra una no reembolsable.
  rival_nr: [
    { ...rate(567.4, {}, { no_refundable: true }), ...meta('rival_nr', 'Rival NR', false) },
    rate(631.4, { breakfast: true }, { no_refundable: true }),
  ],
  // Su no reembolsable es más cara que su flexible: lo contrario de lo que asume
  // todo el mundo.
  rival_both: [
    { ...rate(1010.9, {}, { free_cancellation: true }), ...meta('rival_both', 'Rival Both', false) },
    rate(2220.9, {}, { no_refundable: true }),
  ],
};

let checks = 0;
const check = (label, fn) => { fn(); checks += 1; console.log('  ✓', label); };

check('el régimen sale del meal_plan, del más inclusivo al menos', () => {
  assert.equal(board(rate(1, { all_inclusive: true, breakfast: true })), 'AI');
  assert.equal(board(rate(1, { half_board: true, breakfast: true })), 'HB');
  assert.equal(board(rate(1, { breakfast: true })), 'BB');
  assert.equal(board(rate(1)), 'RO');
});

check('sin ninguna bandera de cancelación se asume no reembolsable', () => {
  assert.equal(cancellation(rate(1)), 'nr');
  assert.equal(cancellation(rate(1, {}, { free_cancellation: true })), 'flex');
  assert.equal(cancellation(rate(1, {}, { no_refundable: true })), 'nr');
});

check('el producto es la pareja régimen + cancelación', () => {
  assert.equal(productKey(rate(1, { breakfast: true }, { free_cancellation: true })), 'BB/flex');
});

check('por producto se queda la más barata', () => {
  const m = cheapestByProduct([rate(200), rate(150), rate(180, { breakfast: true })]);
  assert.equal(m.get('RO/nr').price, 150);
  assert.equal(m.get('BB/nr').price, 180);
});

const matrix = buildMatrix(REPORT);

check('tu hotel va primero en la matriz', () => {
  assert.equal(matrix.hotels[0].slug, 'mine');
  assert.equal(matrix.hotels[0].isPrimary, true);
});

check('una celda vacía se queda en null, nunca en cero', () => {
  const flexRow = matrix.rows.find((r) => r.product === 'RO/flex');
  const rivalNr = flexRow.cells.find((c) => c.slug === 'rival_nr');
  assert.equal(rivalNr.price, null, 'ese competidor no vende flexible');
  assert.notEqual(rivalNr.price, 0);
});

const pos = position(matrix);

check('el denominador cuenta solo a quien vende ese producto', () => {
  const flex = pos.find((p) => p.product === 'RO/flex');
  // mine y rival_both venden RO/flex; rival_nr no. Son 2, no 3.
  assert.equal(flex.comparable, 2);
  assert.equal(flex.rank, 1);
});

check('el gap se mide contra el más barato del MISMO producto', () => {
  const flex = pos.find((p) => p.product === 'RO/flex');
  assert.equal(flex.gap_pct, 0, 'eres el más barato en RO/flex');
  // Contra "la tarifa más barata de cada hotel" el rival saldría a 567,40 y el gap
  // sería un +38% inventado: 567,40 es no reembolsable.
});

check('un producto que no vendes se reporta como tal, no como ausencia', () => {
  const nr = pos.find((p) => p.product === 'RO/nr');
  assert.equal(nr.selling, false);
  assert.equal(nr.comparable, 2, 'los dos rivales sí lo venden');
});

console.log(`\nOK — ${checks} comprobaciones`);
