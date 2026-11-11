// Pure helpers. IPMA warnings are district-wide; Open-Meteo values are model
// estimates for the grid near Figueira da Foz. Neither describes a house precisely.
export const GUST_THRESHOLD_KMH = 70;
const FORECAST_WINDOW_MS = 48 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const LEVELS = new Set(['yellow', 'orange', 'red']);
const validTime = (value) => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) && Number.isFinite(Date.parse(value));
const normalizeType = (value) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();

/**
 * Group already-normalized IPMA records, preserving all active and future
 * periods. Significant means orange/red, not a local measured intensity.
 * Null inputs and malformed district warnings throw; an empty group is not an
 * upstream failure and must not be described as a guarantee of safety.
 */
export function summarizeWarnings(warnings, now = Date.now()) {
  if (!Array.isArray(warnings) || !Number.isFinite(now)) throw new TypeError('Avisos IPMA inválidos.');
  const groups = { wind: [], rain: [] };
  for (const warning of warnings) {
    if (!warning || warning.areaId !== 'CBR' || typeof warning.type !== 'string' ||
        !LEVELS.has(warning.level) || !validTime(warning.startTime) || !validTime(warning.endTime) ||
        Date.parse(warning.endTime) <= Date.parse(warning.startTime)) throw new TypeError('Aviso IPMA inválido.');
    const type = normalizeType(warning.type);
    const group = type === 'vento' ? 'wind' : ['precipitacao', 'chuva'].includes(type) ? 'rain' : null;
    if (!group || Date.parse(warning.endTime) <= now) continue;
    groups[group].push({
      level: warning.level,
      type: warning.type,
      startTime: warning.startTime,
      endTime: warning.endTime,
      text: typeof warning.text === 'string' ? warning.text : '',
      status: Date.parse(warning.startTime) <= now ? 'active' : 'upcoming',
    });
  }
  for (const key of ['wind', 'rain']) {
    const entries = groups[key].sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime) || Date.parse(a.endTime) - Date.parse(b.endTime));
    const active = entries.filter((item) => item.status === 'active');
    const upcoming = entries.filter((item) => item.status === 'upcoming');
    const significant = entries.filter((item) => item.level === 'orange' || item.level === 'red');
    groups[key] = { active, upcoming, significant, all: entries };
  }
  return groups;
}

/**
 * Summarize valid hourly grid estimates intersecting the next 48 hours.
 * The timestamps denote the END of the previous one-hour interval for both
 * wind gusts and precipitation. A first threshold value is only the first
 * qualifying available model interval, not a warning or an exact onset.
 * Counts make missing/partial data distinguishable from zero.
 */
export function summarizeLocalForecast(data, now = Date.now()) {
  if (!data || !Array.isArray(data.hourly) || !Number.isFinite(now)) throw new TypeError('Previsão local inválida.');
  const rows = data.hourly.flatMap((row) => {
    if (!row || !validTime(row.time)) return [];
    const time = Date.parse(row.time);
    if (time <= now || time - HOUR_MS >= now + FORECAST_WINDOW_MS) return [];
    return [{ ...row, timestamp: time }];
  }).sort((a, b) => a.timestamp - b.timestamp);
  const safeMetric = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;
  const gusts = rows.filter((item) => safeMetric(item.windGust, 500));
  const rain = rows.filter((item) => safeMetric(item.precipitation, 500));
  const point = (item, field) => item ? { startTime: new Date(item.timestamp - HOUR_MS).toISOString(), endTime: item.time, value: item[field], status: item.timestamp - HOUR_MS <= now ? 'active' : 'upcoming' } : null;
  const maxPoint = (items, field) => point(items.reduce((best, item) => !best || item[field] > best[field] ? item : best, null), field);
  return {
    thresholdKmh: GUST_THRESHOLD_KMH,
    firstGustAboveThreshold: point(gusts.find((item) => item.windGust >= GUST_THRESHOLD_KMH), 'windGust'),
    maxGust: maxPoint(gusts, 'windGust'),
    maxHourlyPrecipitation: maxPoint(rain, 'precipitation'),
    validHourCount: rows.length,
    validGustCount: gusts.length,
    validPrecipitationCount: rain.length,
  };
}
