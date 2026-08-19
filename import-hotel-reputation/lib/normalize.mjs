// La respuesta de reputación agrupa por OTA, pero el envoltorio ha ido cambiando
// (a veces un objeto {booking: {...}}, a veces una lista con la OTA dentro del
// elemento) y una OTA puede traer o no desglose por categorías. En vez de atarnos
// a una forma concreta, aplanamos cualquiera de ellas a una lista de filas y
// dejamos fuera lo que no reconozcamos, que se reporta aparte.

const SCORE_KEYS = ['score', 'rating', 'value', 'average', 'global_score'];
const REVIEW_KEYS = ['reviews', 'review_count', 'reviews_count', 'num_reviews', 'total_reviews'];
const CATEGORY_KEYS = ['categories', 'breakdown', 'scores', 'subscores'];

const firstNumber = (obj, keys) => {
  for (const key of keys) {
    const raw = obj?.[key];
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
};

/** Las categorías llegan como {location: 9.8} o como [{name, score}]. */
function normalizeCategories(node) {
  for (const key of CATEGORY_KEYS) {
    const raw = node?.[key];
    if (!raw) continue;

    if (Array.isArray(raw)) {
      return raw
        .map((c) => ({
          name: c.name ?? c.category ?? c.label ?? '',
          score: firstNumber(c, SCORE_KEYS),
        }))
        .filter((c) => c.name && c.score !== null);
    }

    if (typeof raw === 'object') {
      return Object.entries(raw)
        .map(([name, value]) => ({
          name,
          score: typeof value === 'object' ? firstNumber(value, SCORE_KEYS) : Number(value),
        }))
        .filter((c) => Number.isFinite(c.score));
    }
  }
  return [];
}

/** Busca el bloque de OTAs mire donde mire la respuesta. */
function findOtaContainer(payload) {
  if (!payload || typeof payload !== 'object') return null;
  for (const key of ['reputation', 'otas', 'data', 'results']) {
    if (payload[key] && typeof payload[key] === 'object') return payload[key];
  }
  return payload;
}

function toEntries(container) {
  if (Array.isArray(container)) {
    return container.map((item) => [item.ota ?? item.name ?? item.source ?? 'unknown', item]);
  }
  if (container && typeof container === 'object') return Object.entries(container);
  return [];
}

/**
 * @returns {{rows: Array, skipped: string[]}} una fila por OTA con datos legibles,
 *   y los nombres de las claves que se han ignorado por no parecer una OTA.
 */
export function normalizeReputation(payload) {
  const rows = [];
  const skipped = [];

  for (const [name, node] of toEntries(findOtaContainer(payload))) {
    // `competitors` llega como lista, y las claves sueltas (slug, name…) como
    // texto: ninguna es una OTA, pero conviene saber que venían.
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      skipped.push(name);
      continue;
    }

    const score = firstNumber(node, SCORE_KEYS);
    const reviews = firstNumber(node, REVIEW_KEYS);
    const categories = normalizeCategories(node);

    // Los bloques hermanos (import, competitors, accommodation…) no traen nota:
    // así se distinguen de una OTA sin tener que listarlas a mano.
    if (score === null && reviews === null && !categories.length) {
      skipped.push(name);
      continue;
    }

    rows.push({ ota: name, score, reviews, categories });
  }

  rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  return { rows, skipped };
}

/** Metadatos de la ejecución de la que sale el dato, si vienen. */
export function extractImportInfo(payload) {
  const node = payload?.import ?? payload?.last_import ?? null;
  if (!node || typeof node !== 'object') return null;
  return {
    id: node.id ?? node.identifier ?? node.name ?? null,
    date: node.date ?? node.created_at ?? node.finished_at ?? null,
  };
}
