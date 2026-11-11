// IPMA presents its timestamps in UTC, even when the JSON omits the suffix.
const API = 'https://api.ipma.pt/open-data';

// Forecasts refer to the district capital; alerts cover the whole district.
export const AREAS = Object.freeze([
  { id: 'AVR', name: 'Aveiro', forecastId: 1010500 },
  { id: 'BJA', name: 'Beja', forecastId: 1020500 },
  { id: 'BRG', name: 'Braga', forecastId: 1030300 },
  { id: 'BGC', name: 'Bragança', forecastId: 1040200 },
  { id: 'CBO', name: 'Castelo Branco', forecastId: 1050200 },
  { id: 'CBR', name: 'Coimbra', forecastId: 1060300 },
  { id: 'EVR', name: 'Évora', forecastId: 1070500 },
  { id: 'FAR', name: 'Faro', forecastId: 1080500 },
  { id: 'GDA', name: 'Guarda', forecastId: 1090700 },
  { id: 'LRA', name: 'Leiria', forecastId: 1100900 },
  { id: 'LSB', name: 'Lisboa', forecastId: 1110600 },
  { id: 'PTG', name: 'Portalegre', forecastId: 1121400 },
  { id: 'PTO', name: 'Porto', forecastId: 1131200 },
  { id: 'STM', name: 'Santarém', forecastId: 1141600 },
  { id: 'STB', name: 'Setúbal', forecastId: 1151200 },
  { id: 'VCT', name: 'Viana do Castelo', forecastId: 1160900 },
  { id: 'VRL', name: 'Vila Real', forecastId: 1171400 },
  { id: 'VIS', name: 'Viseu', forecastId: 1182300 },
]);

const LEVEL_ORDER = { red: 3, orange: 2, yellow: 1, green: 0 };

function utcTime(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)?$/.test(value)) return null;
  const withZone = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(withZone);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function requestJson(url, { signal, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
    if (!response.ok) throw new Error(`IPMA indisponível (HTTP ${response.status}).`);
    return await response.json();
  } catch (error) {
    if (timedOut) throw new Error('A ligação ao IPMA demorou demasiado tempo.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Fetch the complete upstream dataset. Throws on invalid or unavailable data. */
export async function fetchWarnings(options) {
  const data = await requestJson(`${API}/forecast/warnings/warnings_www.json`, options);
  if (!Array.isArray(data) || data.length === 0) throw new Error('O IPMA não devolveu dados de avisos válidos.');
  return data;
}

/** Return present and upcoming warnings for one district, never interpreting missing data as safe. */
export function normalizeWarnings(data, areaId, now = Date.now()) {
  if (!Array.isArray(data)) throw new Error('Formato de avisos do IPMA inválido.');
  const records = data.filter((item) => item && item.idAreaAviso === areaId);
  if (!records.length) throw new Error('O IPMA não disponibilizou dados para este distrito.');
  const warnings = [];
  let hasCoverage = false;
  for (const item of records) {
    const level = item.awarenessLevelID;
    if (!Object.prototype.hasOwnProperty.call(LEVEL_ORDER, level)) throw new Error('O IPMA devolveu um nível de aviso desconhecido.');
    const startTime = utcTime(item.startTime);
    const endTime = utcTime(item.endTime);
    if (!startTime || !endTime || Date.parse(startTime) >= Date.parse(endTime)) {
      throw new Error('O IPMA devolveu datas de aviso inválidas.');
    }
    if (Date.parse(endTime) <= now) continue;
    hasCoverage = true;
    if (level === 'green') continue;
    warnings.push({
      areaId,
      level,
      type: typeof item.awarenessTypeName === 'string' ? item.awarenessTypeName : 'Aviso meteorológico',
      text: typeof item.text === 'string' ? item.text : '',
      startTime,
      endTime,
      status: Date.parse(startTime) <= now ? 'active' : 'upcoming',
    });
  }
  if (!hasCoverage) throw new Error('Os dados de avisos do IPMA estão fora de validade.');
  return warnings.sort((a, b) => LEVEL_ORDER[b.level] - LEVEL_ORDER[a.level] || Date.parse(a.startTime) - Date.parse(b.startTime));
}

function numberOrNull(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Daily forecast for the district capital, not a live measurement. */
export async function fetchForecast(areaId, options) {
  const area = AREAS.find((item) => item.id === areaId);
  if (!area) throw new Error('Distrito inválido.');
  const data = await requestJson(`${API}/forecast/meteorology/cities/daily/${area.forecastId}.json`, options);
  if (!Array.isArray(data?.data) || !data.data.length || Number(data.globalIdLocal) !== area.forecastId) {
    throw new Error('O IPMA não devolveu uma previsão válida.');
  }
  return {
    areaId,
    location: area.name,
    updatedAt: utcTime(data.dataUpdate),
    days: data.data.map((day) => ({
      date: typeof day.forecastDate === 'string' ? day.forecastDate : '',
      min: numberOrNull(day.tMin),
      max: numberOrNull(day.tMax),
      precipitationProbability: numberOrNull(day.precipitaProb),
      windDirection: typeof day.predWindDir === 'string' ? day.predWindDir : '',
      weatherType: numberOrNull(day.idWeatherType),
    })),
  };
}
