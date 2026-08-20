const BASE_URL = process.env.VEETAL_API_URL || 'https://api.veetal.app/v2';

export class VeetalError extends Error {
  constructor(status, body, path) {
    super(`Connect API responded ${status} on ${path}`);
    this.status = status;
    this.body = body;
  }
}

async function get(path, apiKey) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'veetal-api-key': apiKey, Accept: 'application/json' },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    // Errores de infraestructura (502 de nginx, timeouts del balanceador) vuelven
    // en HTML, no en JSON: guardamos el texto crudo para poder enseñarlo.
    body = text;
  }

  if (!res.ok) throw new VeetalError(res.status, body, path);
  return body;
}

/** Búsquedas de ubicación de la cuenta. Su _id es el location_search_id. */
export const listLocationSearches = (apiKey) => get('/account/location-search', apiKey);

/**
 * Ejecuciones del import de búsquedas de ubicación. De aquí salen las fechas que
 * SÍ tienen datos: el feed indexa por fecha de entrada, y pedir una fecha que
 * nunca se buscó devuelve 404 (código 510), no una lista vacía.
 */
export const listImports = (apiKey, entityId) =>
  get(
    `/account/imports?service=feed-booking-location-search${entityId ? `&entity_id=${encodeURIComponent(entityId)}` : ''}`,
    apiKey,
  );

/**
 * Una página del mercado almacenado.
 *
 * Dos cosas que no son evidentes y cuestan un 404 cada una:
 *
 * 1. `date` es la fecha de ENTRADA que buscó el import, que coincide con el día en
 *    que se ejecutó. No es "hoy" ni una fecha futura que elijas tú.
 * 2. Sin `importId` el endpoint solo sirve la ÚLTIMA ejecución. Cualquier día
 *    anterior responde 404 aunque su import esté completado: para leer histórico
 *    hay que pasar el import_id de esa ejecución junto a SU fecha.
 *
 * Además `pagination.hasMore`: una ciudad entera necesita recorrer páginas, y
 * quedarse con la primera es quedarse con un trozo del mercado.
 */
export const getMarketPage = (apiKey, searchId, date, { page = 1, limit = 100, importId } = {}) =>
  get(
    `/feed/location-search/${encodeURIComponent(searchId)}/${date}/booking-location-search` +
      `?page=${page}&limit=${limit}${importId ? `&import_id=${encodeURIComponent(importId)}` : ''}`,
    apiKey,
  );

/** Recorre todas las páginas y devuelve el mercado completo de esa fecha. */
export async function getMarket(apiKey, searchId, date, { limit = 100, maxPages = 50, importId } = {}) {
  const accommodations = [];
  let page = 1;
  let pagination = null;

  while (page <= maxPages) {
    const body = await getMarketPage(apiKey, searchId, date, { page, limit, importId });
    accommodations.push(...(body.accommodations || []));
    pagination = body.pagination || null;
    if (!pagination || !pagination.hasMore) break;
    page += 1;
  }

  return { accommodations, pagination, truncated: Boolean(pagination && pagination.hasMore) };
}
