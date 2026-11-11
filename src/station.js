// IPMA observations are hourly station measurements, not live readings in Figueira da Foz.
export const STATION_ID = 1210713;
export const STATION_NAME = 'Figueira da Foz, Vila Verde';
const OBSERVATIONS_URL = 'https://api.ipma.pt/open-data/observation/meteorology/stations/obs-surface.geojson';

function parseUtc(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value)) return null;
  const timestamp = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function metric(value, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === -99 || value < minimum || value > maximum) return null;
  return value;
}

/** Normalize the most recent observation for Vila Verde, preserving missing fields. */
export function parseStation(data) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('Formato inválido de observações IPMA.');
  const entries = data.features.flatMap((feature) => {
    const p = feature?.properties;
    const observedAt = parseUtc(p?.time);
    if (Number(p?.idEstacao) !== STATION_ID || !observedAt) return [];
    return [{ observedAt, properties: p }];
  }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt));
  if (!entries.length) throw new Error('A estação de Vila Verde não disponibilizou observações válidas.');
  const { observedAt, properties: p } = entries[0];
  const result = {
    stationId: STATION_ID,
    stationName: STATION_NAME,
    observedAt,
    temperature: metric(p.temperatura, -90, 65),
    windKmh: metric(p.intensidadeVentoKM, 0, 500),
    rainMm: metric(p.precAcumulada, 0, 1000),
    humidity: metric(p.humidade, 0, 100),
    windDirection: typeof p.descDirVento === 'string' && /^(N|NE|E|SE|S|SW|W|NW)$/.test(p.descDirVento) ? p.descDirVento : null,
  };
  if ([result.temperature, result.windKmh, result.rainMm, result.humidity].every((value) => value === null)) {
    throw new Error('A última observação da estação não contém medições disponíveis.');
  }
  return result;
}

/** Fetch a timestamped observation; caller is responsible for caching and staleness. */
export async function fetchStation({ signal, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(OBSERVATIONS_URL, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`Observações IPMA indisponíveis (HTTP ${response.status}).`);
    const observation = parseStation(await response.json());
    return { ...observation, fetchedAt: new Date().toISOString() };
  } catch (error) {
    if (timedOut) throw new Error('A consulta da estação do IPMA demorou demasiado tempo.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
