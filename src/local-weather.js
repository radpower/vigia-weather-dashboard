// Figueira da Foz village centre (OpenStreetMap); forecasts represent a model grid cell.
export const FIGUEIRA_COORDINATES = Object.freeze({ latitude: 40.1417, longitude: -8.8783 });

const API = 'https://api.open-meteo.com/v1/forecast';
const CURRENT = ['temperature_2m', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'wind_direction_10m', 'weather_code'];
const HOURLY = ['temperature_2m', 'precipitation_probability', 'precipitation', 'wind_speed_10m', 'wind_gusts_10m', 'weather_code'];
const asNumber = (value) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const iso = (seconds) => typeof seconds === 'number' && Number.isFinite(seconds) && Number.isFinite(new Date(seconds * 1000).getTime()) ? new Date(seconds * 1000).toISOString() : null;

// These values are model estimates, not observations at a station in Figueira da Foz.
export async function fetchLocalWeather({ signal, timeoutMs = 12000 } = {}) {
  const params = new URLSearchParams({
    latitude: String(FIGUEIRA_COORDINATES.latitude), longitude: String(FIGUEIRA_COORDINATES.longitude),
    current: CURRENT.join(','), hourly: HOURLY.join(','), forecast_days: '3',
    timeformat: 'unixtime', timezone: 'GMT', wind_speed_unit: 'kmh',
  });
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const response = await fetch(`${API}?${params}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw new Error(`Previsão local indisponível (HTTP ${response.status}).`);
    const data = await response.json();
    const currentTime = iso(data?.current?.time);
    if (!currentTime || !data.hourly || !Array.isArray(data.hourly.time) || data.hourly.time.length === 0 || !HOURLY.every((key) => Array.isArray(data.hourly[key]) && data.hourly[key].length === data.hourly.time.length)) {
      throw new Error('A previsão local não tem um formato válido.');
    }
    const value = (source, key, index) => asNumber(index == null ? source[key] : source[key][index]);
    const hourly = data.hourly.time.map((time, index) => ({
      time: iso(time),
      temperature: value(data.hourly, 'temperature_2m', index),
      precipitationProbability: value(data.hourly, 'precipitation_probability', index),
      precipitation: value(data.hourly, 'precipitation', index),
      windSpeed: value(data.hourly, 'wind_speed_10m', index),
      windGust: value(data.hourly, 'wind_gusts_10m', index),
      weatherCode: value(data.hourly, 'weather_code', index),
    })).filter((row) => row.time && Date.parse(row.time) >= Date.now() - 3600000);
    if (!hourly.length) throw new Error('A previsão local não contém horas atuais ou futuras.');
    return {
      latitude: asNumber(data.latitude), longitude: asNumber(data.longitude),
      fetchedAt: new Date().toISOString(),
      current: {
        time: currentTime, intervalSeconds: asNumber(data.current.interval),
        temperature: value(data.current, 'temperature_2m'),
        precipitation: value(data.current, 'precipitation'),
        windSpeed: value(data.current, 'wind_speed_10m'),
        windGust: value(data.current, 'wind_gusts_10m'),
        windDirection: value(data.current, 'wind_direction_10m'),
        weatherCode: value(data.current, 'weather_code'),
      },
      hourly,
    };
  } catch (error) {
    if (timedOut) throw new Error('A ligação à previsão local demorou demasiado tempo.');
    throw error;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}
