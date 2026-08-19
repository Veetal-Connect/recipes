const BASE_URL = process.env.VEETAL_API_URL || 'https://api.veetal.app';

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

/** Alojamientos de la cuenta, indexados por slug. */
export const listAccommodations = (apiKey) => get('/v2/account/accommodation', apiKey);

/** Reputación almacenada de un alojamiento, con todas sus OTAs. */
export const getReputation = (apiKey, slug) =>
  get(`/v2/feed/accommodation/${encodeURIComponent(slug)}/reputation`, apiKey);
