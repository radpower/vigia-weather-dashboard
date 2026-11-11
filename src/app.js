import { fetchWarnings, normalizeWarnings } from './weather.js';
import { fetchLocalWeather } from './local-weather.js';
import { fetchStation } from './station.js';
import { fetchNews } from './news.js';
import { fetchScheduledElectricity } from './electricity.js';
import { setupWindyMap } from './map.js';
import { setupPreparedness } from './preparedness.js';
import { setupForegroundAlerts } from './alerts.js';
import { summarizeWarnings, summarizeLocalForecast } from './impact-summary.js';

const $ = (id) => document.getElementById(id);
const levels = { red: 'Vermelho', orange: 'Laranja', yellow: 'Amarelo' };
const state = { warnings: null, weather: null, station: null, news: null, power: null, selectedTime: null, errors: {}, attempts: {}, controller: null, sequence: 0, inFlight: false, pendingWarnings: false, showAll: false };
const format = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const hourFormat = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' });
const impactTime = new Intl.DateTimeFormat('pt-PT', { timeZone: 'Europe/Lisbon', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dateText = (value) => { const d = new Date(value); return value && Number.isFinite(d.getTime()) ? format.format(d) : 'data indisponível'; };
const read = (key) => { try { return JSON.parse(localStorage.getItem(`vigia:${key}`)); } catch { return null; } };
const save = (key, value) => { try { localStorage.setItem(`vigia:${key}`, JSON.stringify(value)); } catch { /* Storage is optional. */ } };
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const isOld = (value) => !value || !Number.isFinite(Date.parse(value)) || Date.now() - Date.parse(value) > 10 * 60 * 1000;
const stale = (key) => { const at = Date.parse(state[key]?.at); const limit = key === 'power' ? 60 : key === 'station' ? 20 : key === 'weather' ? 15 : 3; return state.errors[key] || !navigator.onLine || !Number.isFinite(at) || Date.now() - at > limit * 60 * 1000; };
const num = (value, unit) => typeof value === 'number' && Number.isFinite(value) ? `${new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 }).format(value)}${unit}` : '—';
const stamp = (key) => `${stale(key) ? 'Dados guardados; podem estar desatualizados · ' : ''}Consulta: ${dateText(state[key]?.at)}`;
const foregroundAlerts = setupForegroundAlerts({ container: $('alert-controls') });
setupPreparedness({ container: $('preparedness') });

function impactDate(value) { const date = new Date(value); return Number.isFinite(date.getTime()) ? impactTime.format(date) : 'hora indisponível'; }
function renderImpactWarning(containerId, title, group) {
  const box = $(containerId); box.replaceChildren(); box.className = 'impact-card';
  if (!group) {
    box.append(element('span', 'impact-kicker', `${title} · IPMA / COIMBRA`), element('h2', '', state.errors.warnings ? 'Aviso indisponível' : 'A consultar…'), element('p', '', state.errors.warnings ? 'Não foi possível verificar os avisos oficiais.' : 'A obter horários do aviso oficial.')); return;
  }
  const urgent = group.significant.filter((warning) => warning.status === 'active');
  const futureUrgent = group.significant.filter((warning) => warning.status === 'upcoming');
  const selected = urgent[0] || futureUrgent[0] || group.active[0] || group.upcoming[0];
  if (!selected) { box.append(element('span', 'impact-kicker', `${title} · IPMA / COIMBRA`), element('h2', '', 'Sem aviso neste tipo'), element('p', '', `Nenhum aviso de ${title.toLowerCase()} nos dados consultados. Isto não garante ausência de perigo.`)); return; }
  box.classList.add(selected.level);
  const level = levels[selected.level] || selected.level;
  box.append(element('span', 'impact-kicker', `${title} · AVISO ${level.toUpperCase()}`));
  box.append(element('h2', '', selected.status === 'active' ? 'Aviso em vigor' : `A partir de ${impactDate(selected.startTime)}`));
  box.append(element('p', '', `IPMA · distrito de Coimbra · ${impactDate(selected.startTime)} até ${impactDate(selected.endTime)}`));
  if (selected.text) box.append(element('p', 'impact-detail', selected.text));
  const otherActive = group.active.find((warning) => warning !== selected);
  if (otherActive) box.append(element('p', 'impact-detail', `Também em vigor: aviso ${levels[otherActive.level].toLowerCase()} até ${impactDate(otherActive.endTime)}.`));
  const next = group.upcoming.find((warning) => warning !== selected);
  if (next) box.append(element('p', 'impact-detail', `Outro aviso ${levels[next.level].toLowerCase()}: ${impactDate(next.startTime)} até ${impactDate(next.endTime)}.`));
}

function renderImpact() {
  let warnings = null;
  if (state.warnings) { try { warnings = summarizeWarnings(normalizeWarnings(state.warnings.data, 'CBR')); } catch { warnings = null; } }
  renderImpactWarning('impact-wind', 'VENTO', warnings?.wind);
  renderImpactWarning('impact-rain', 'PRECIPITAÇÃO', warnings?.rain);
  const model = $('impact-model'); model.replaceChildren();
  let estimate;
  try { estimate = state.weather?.data ? summarizeLocalForecast(state.weather.data) : null; } catch { estimate = null; }
  if (estimate?.maxGust) {
    const point = estimate.firstGustAboveThreshold || estimate.maxGust;
    const description = estimate.firstGustAboveThreshold ? `Primeira hora com rajadas previstas ≥ ${estimate.thresholdKmh} km/h` : 'Maior rajada prevista nas horas disponíveis';
    const wind = element('span'); wind.append(element('strong', '', `Figueira da Foz · ${description}: `), document.createTextNode(`${num(point.value, ' km/h')} entre ${impactDate(point.startTime)} e ${impactDate(point.endTime)}.`)); model.append(wind);
    if (estimate.maxHourlyPrecipitation) { const rain = element('span'); rain.append(element('strong', '', 'Pico de precipitação previsto: '), document.createTextNode(`${num(estimate.maxHourlyPrecipitation.value, ' mm')} entre ${impactDate(estimate.maxHourlyPrecipitation.startTime)} e ${impactDate(estimate.maxHourlyPrecipitation.endTime)}.`)); model.append(rain); }
  } else model.append(element('span', '', state.errors.weather ? 'Previsão local indisponível.' : 'A obter previsão para Figueira da Foz…'));
  const freshness = $('impact-freshness');
  const warningsStale = state.warnings && stale('warnings'); const weatherStale = state.weather && stale('weather');
  freshness.classList.toggle('stale', Boolean(warningsStale || weatherStale || state.errors.warnings || state.errors.weather));
  const warningStamp = state.warnings ? `IPMA: ${dateText(state.warnings.at)}${warningsStale ? ' (dados guardados, podem estar desatualizados)' : ''}` : 'IPMA: sem dados';
  const weatherStamp = state.weather ? `modelo: ${dateText(state.weather.at)}${weatherStale ? ' (dados guardados, podem estar desatualizados)' : ''}` : 'modelo: sem dados';
  freshness.textContent = `${warningStamp} · ${weatherStamp}. Avisos abrangem todo o distrito; o modelo é uma estimativa e não substitui o IPMA. Horas de Lisboa.`;
}

function renderStatus() {
  const offline = !navigator.onLine;
  $('connection').textContent = offline ? 'Sem ligação' : state.errors.warnings ? 'Falha ao contactar o IPMA' : state.warnings ? 'Ligação disponível' : 'A verificar ligação';
  $('connection').parentElement.parentElement.classList.toggle('offline', offline || Boolean(state.errors.warnings));
  $('last-update').textContent = state.warnings ? `${stale('warnings') ? 'Dados guardados · ' : ''}Consulta IPMA: ${dateText(state.warnings.at)}` : 'Sem dados guardados';
}

function renderWarnings() {
  const list = $('warning-list'); list.replaceChildren(); const output = $('warning-state');
  if (!state.warnings) { output.textContent = state.errors.warnings ? 'Não foi possível obter avisos. Consulta o IPMA diretamente quando tiveres ligação.' : 'A obter avisos oficiais…'; return; }
  let all;
  try { all = normalizeWarnings(state.warnings.data, 'CBR'); } catch { output.textContent = 'Não foi possível validar os avisos de Coimbra. Consulta o IPMA diretamente.'; return; }
  const prefix = stale('warnings') ? `Dados guardados de ${dateText(state.warnings.at)}; podem estar desatualizados. ` : '';
  output.textContent = prefix + (all.length ? `${all.length} ${all.length === 1 ? 'aviso em vigor ou previsto' : 'avisos em vigor ou previstos'}.` : 'Sem avisos amarelos, laranja ou vermelhos nos dados recebidos. Confirma sempre no IPMA.');
  for (const warning of state.showAll ? all : all.slice(0, 8)) {
    const card = element('article', `warning ${warning.level}`); const top = element('div', 'warning-top');
    top.append(element('span', 'level', levels[warning.level]), element('strong', '', `Coimbra · ${warning.type}`)); card.append(top);
    if (warning.text) card.append(element('p', '', warning.text));
    card.append(element('small', '', `${warning.status === 'active' ? 'Em vigor' : 'Previsto'} · ${dateText(warning.startTime)} — ${dateText(warning.endTime)} (hora de Lisboa)`)); list.append(card);
  }
  if (!state.showAll && all.length > 8) { const more = element('button', 'show-more', `Mostrar todos os ${all.length} avisos ↓`); more.type = 'button'; more.addEventListener('click', () => { state.showAll = true; renderWarnings(); }); list.append(more); }
}

function metric(label, value) { const box = element('div', 'metric'); box.append(element('strong', '', value), element('span', '', label)); return box; }
function renderWeather() {
  const box = $('forecast'); box.replaceChildren();
  if (!state.weather) { box.textContent = state.errors.weather ? 'Previsão indisponível. Consulta as fontes oficiais quando tiveres ligação.' : 'A obter previsão…'; return; }
  const data = state.weather.data; const current = data?.current;
  if (!current || !Array.isArray(data.hourly)) { box.textContent = 'Previsão guardada inválida.'; return; }
  box.append(element('div', 'footnote', `Estimativa para ${dateText(current.time)} · ${stamp('weather')}`));
  if (!Number.isFinite(Date.parse(current.time)) || Date.now() - Date.parse(current.time) > 2 * 60 * 60 * 1000) box.append(element('div', 'source-error', 'A hora desta estimativa é antiga. Consulta outra fonte.'));
  const interval = Number.isFinite(current.intervalSeconds) && current.intervalSeconds > 0 ? ` em ${current.intervalSeconds / 60} min` : '';
  const grid = element('div', 'metric-grid'); grid.append(metric('Temperatura estimada', num(current.temperature, ' °C')), metric('Vento estimado', num(current.windSpeed, ' km/h')), metric('Rajada estimada', num(current.windGust, ' km/h')), metric(`Precipitação estimada${interval}`, num(current.precipitation, ' mm'))); box.append(grid);
  const future = data.hourly.filter((item) => Date.parse(item.time) >= Date.now()).slice(0, 48);
  if (future.length) {
    const label = element('label', 'kicker', 'ATÉ 48 HORAS · ARRASTA PARA AVANÇAR'); label.htmlFor = 'forecast-time'; box.append(label);
    const slider = element('input', 'forecast-slider'); slider.type = 'range'; slider.id = 'forecast-time'; slider.min = '0'; slider.max = String(future.length - 1); slider.step = '1';
    const savedIndex = future.findIndex((item) => item.time === state.selectedTime); slider.value = String(savedIndex < 0 ? 0 : savedIndex);
    const display = element('div', 'slider-result');
    const update = () => { const item = future[Number(slider.value)]; if (!item) return; state.selectedTime = item.time; const from = new Date(Date.parse(item.time) - 3600000).toISOString(); const when = `${dateText(from)} — ${dateText(item.time)}`; slider.setAttribute('aria-valuetext', when); display.replaceChildren(element('strong', '', when), element('span', '', `Nesta hora: chuva ${num(item.precipitationProbability, '%')} · precipitação ${num(item.precipitation, ' mm')} · rajada máxima ${num(item.windGust, ' km/h')}. No final da hora: vento ${num(item.windSpeed, ' km/h')} · ${num(item.temperature, ' °C')}.`)); };
    slider.addEventListener('input', update); box.append(slider, display); update();
  } else box.append(element('div', 'source-error', 'Sem previsão horária futura nos dados guardados.'));
}

function renderStation() {
  const box = $('station'); box.replaceChildren();
  if (!state.station) { box.textContent = state.errors.station ? 'Observação indisponível.' : 'A obter observações…'; return; }
  const data = state.station.data;
  box.append(element('div', 'footnote', `Observação: ${dateText(data.observedAt)} · ${stamp('station')}`));
  if (!Number.isFinite(Date.parse(data.observedAt)) || Date.now() - Date.parse(data.observedAt) > 2 * 60 * 60 * 1000) box.append(element('div', 'source-error', 'A última observação da estação tem mais de duas horas.'));
  const grid = element('div', 'metric-grid'); grid.append(metric('Temperatura', num(data.temperature, ' °C')), metric('Vento médio', num(data.windKmh, ' km/h')), metric('Chuva na última hora', num(data.rainMm, ' mm')), metric('Humidade', num(data.humidity, '%'))); box.append(grid);
}

function renderNews() {
  const box = $('news'); box.replaceChildren(); const data = state.news?.data;
  if (!data) { box.append(element('p', 'news-empty', state.errors.news ? 'Notícias indisponíveis. Consulta as fontes diretamente quando tiveres ligação.' : 'A procurar notícias…')); return; }
  box.append(element('p', 'footnote', `${stamp('news')} · Algumas fontes são consultadas através de serviço de terceiros.`));
  const unavailable = data.sources?.filter((source) => !source.available).map((source) => source.name) || [];
  if (unavailable.length) box.append(element('p', 'source-error', `Fontes sem resposta: ${unavailable.join(', ')}. Quando disponíveis, são mostradas as últimas notícias guardadas de cada fonte.`));
  if (!data.items?.length) { box.append(element('p', 'news-empty', 'Sem notícias disponíveis nestas fontes.')); return; }
  const list = element('div', 'news-list');
  for (const item of data.items) {
    try { const url = new URL(item.url); if (url.protocol !== 'https:' || !['www.rtp.pt','rtp.pt','www.asbeiras.pt','asbeiras.pt','rfmondego.pt','www.rfmondego.pt'].includes(url.hostname)) continue;
      const article = element('article', 'news-item'); article.append(element('strong', '', item.title));
      if (item.summary) article.append(element('p', 'news-summary', item.summary));
      else article.append(element('p', 'news-summary', 'A fonte não disponibilizou resumo para esta notícia.'));
      article.append(element('small', '', `${item.source} · Publicada: ${item.publishedAt ? dateText(item.publishedAt) : 'data indisponível'}${item.cached ? ` · Guardada; última consulta: ${dateText(item.sourceFetchedAt)}` : ''}`)); list.append(article);
    } catch { /* Ignore malformed cached links. */ }
  }
  box.append(list);
}

function wallTime(value) { const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || ''); return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : 'Hora não indicada'; }
function renderPower() {
  const box = $('power'); box.replaceChildren(); const data = state.power?.data;
  if (!data || !Array.isArray(data.records)) { box.textContent = state.errors.power ? 'Dados de interrupções programadas indisponíveis.' : 'A consultar interrupções programadas…'; return; }
  box.append(element('p', 'footnote', `${stamp('power')}${data.sourceUpdatedAt ? ` · Fonte atualizada: ${dateText(data.sourceUpdatedAt)}` : ''}`));
  if (data.sourceUpdatedAt && Number.isFinite(Date.parse(data.sourceUpdatedAt)) && Date.now() - Date.parse(data.sourceUpdatedAt) > 24 * 60 * 60 * 1000) box.append(element('p', 'source-error', 'A fonte não é atualizada há mais de 24 horas.'));
  if (!data.records.length) box.append(element('p', '', 'Sem interrupções programadas anunciadas para o concelho nos dados recebidos.'));
  else {
    box.append(element('p', '', `Há ${data.records.length} interrupções programadas no concelho.`));
    const list = element('div', 'power-list');
    for (const item of data.records) { const card = element('div', 'power-item'); card.append(element('strong', '', `${item.parish || 'Freguesia não indicada'} · ${item.postcode || 'Código postal não indicado'}`), element('span', '', `Programado: ${wallTime(item.startsAt)} — ${wallTime(item.endsAt)}`)); list.append(card); } box.append(list);
  }
  box.append(element('p', 'source-error', 'Isto não mostra avarias imprevistas nem confirma se tens eletricidade.'));
}
function render() { renderStatus(); renderImpact(); renderWarnings(); renderWeather(); renderStation(); renderPower(); renderNews(); }
function loadCache() {
  const oldWarnings = read('warnings');
  if (Array.isArray(oldWarnings?.data) && oldWarnings.at) state.warnings = oldWarnings;
  for (const key of ['weather', 'station', 'news', 'power']) { const value = read(`figueira:${key}`); if (value?.data && value.at) state[key] = value; }
}
async function refresh(periodic = false, forceWarnings = false) {
  if (periodic && state.inFlight) { if (forceWarnings) state.pendingWarnings = true; return; }
  const jobs = [['warnings', fetchWarnings], ['weather', fetchLocalWeather], ['station', fetchStation], ['news', fetchNews], ['power', fetchScheduledElectricity]].filter(([key]) => {
    if (key === 'warnings' && forceWarnings) return true;
    const interval = key === 'power' ? 30 * 60 * 1000 : key === 'station' ? 15 * 60 * 1000 : key === 'weather' ? 10 * 60 * 1000 : 60 * 1000;
    const lastAttempt = Math.max(Date.parse(state[key]?.at) || 0, state.attempts[key] || 0);
    return !periodic || Date.now() - lastAttempt >= interval;
  });
  if (!jobs.length) return;
  state.controller?.abort(); const controller = new AbortController(); state.controller = controller; const sequence = ++state.sequence;
  state.inFlight = true;
  for (const [key] of jobs) state.attempts[key] = Date.now();
  $('refresh').disabled = true;
  $('news-refresh').disabled = true; $('news-refresh').textContent = 'A atualizar…';
  await Promise.allSettled(jobs.map(async ([key, fetcher]) => {
    try {
      const data = await fetcher({ signal: controller.signal, previous: key === 'news' ? state.news?.data : undefined });
      if (sequence !== state.sequence) return;
      const normalizedWarnings = key === 'warnings' ? normalizeWarnings(data, 'CBR') : null;
      state[key] = { data, at: new Date().toISOString() }; state.errors[key] = false;
      save(key === 'warnings' ? 'warnings' : `figueira:${key}`, state[key]);
      if (key === 'warnings') foregroundAlerts.observe(normalizedWarnings);
    } catch { if (sequence !== state.sequence) return; state.errors[key] = true; if (key === 'warnings') foregroundAlerts.unavailable(); }
    if (key === 'warnings') { renderStatus(); renderImpact(); renderWarnings(); }
    else if (key === 'weather') { renderImpact(); renderWeather(); }
    else if (key === 'station') renderStation();
    else if (key === 'power') renderPower();
    else renderNews();
  }));
  if (sequence === state.sequence) {
    state.inFlight = false; $('refresh').disabled = false; $('news-refresh').disabled = false; $('news-refresh').textContent = 'Atualizar tudo ↻';
    if (state.pendingWarnings && !document.hidden && navigator.onLine) { state.pendingWarnings = false; refresh(true, true); }
  }
}
$('refresh').addEventListener('click', () => refresh());
$('news-refresh').addEventListener('click', () => refresh());
window.addEventListener('online', () => refresh()); window.addEventListener('offline', () => { foregroundAlerts.unavailable(); render(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) refresh(true, true); });
setInterval(() => { if (!document.hidden && navigator.onLine) refresh(true); }, 15 * 1000);
loadCache(); render(); refresh();
setupWindyMap({ container: $('windy-map'), status: $('map-status'), loadButton: $('map-load'), closeButton: $('map-close'), layerButtons: document.querySelectorAll('[data-layer]'), autoload: true });
if ('serviceWorker' in navigator) {
  const hadController = Boolean(navigator.serviceWorker.controller); let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController && !reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').then((registration) => registration.update()).catch(() => {});
}
