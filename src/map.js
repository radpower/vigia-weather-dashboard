// Windy's public embed owns the map, weather layers and time slider.
// Loading is opt-in so the animated map does not consume mobile data by default.
export const WINDY_LAYERS = Object.freeze({ wind: 'Vento', gust: 'Rajadas', rain: 'Chuva e trovoada', clouds: 'Nuvens' });

export function windyEmbedUrl(layer = 'wind') {
  if (!Object.hasOwn(WINDY_LAYERS, layer)) throw new Error('Camada de mapa inválida.');
  const url = new URL('https://embed.windy.com/embed2.html');
  const params = {
    lat: '40.1417', lon: '-8.8783', detailLat: '40.1417', detailLon: '-8.8783',
    zoom: '9', level: 'surface', overlay: layer, menu: 'true', marker: 'true',
    calendar: 'now', type: 'map', location: 'coordinates', metricWind: 'km/h',
    metricTemp: '°C', metricRain: 'mm', lang: 'pt',
  };
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

/** Attach the official map to a container; return a cleanup for listeners. */
export function setupWindyMap({ container, status, loadButton, closeButton, layerButtons, autoload = false }) {
  if (!container || !status || !loadButton || !layerButtons) throw new Error('Controlos de mapa em falta.');
  let frame = null;
  let layer = 'wind';
  const buttons = [...layerButtons];
  const updateButtons = () => buttons.forEach((button) => {
    button.setAttribute('aria-pressed', String(button.dataset.layer === layer));
  });
  const updateStatus = () => {
    container.classList.toggle('map-collapsed', !frame);
    status.textContent = !navigator.onLine
      ? 'Sem ligação: o mapa e a linha temporal precisam de internet.'
      : frame ? 'Mapa interativo fornecido pelo Windy. Usa a barra inferior para alterar a hora.'
        : 'O mapa precisa de ligação e pode consumir mais dados móveis.';
  };
  const load = () => {
    if (!navigator.onLine) { updateStatus(); return; }
    if (!frame) {
      frame = document.createElement('iframe');
      frame.className = 'windy-frame';
      frame.title = 'Mapa meteorológico Windy centrado em Figueira da Foz';
      frame.loading = 'lazy';
      frame.referrerPolicy = 'no-referrer';
      frame.allowFullscreen = true;
      container.replaceChildren(frame);
      loadButton.textContent = 'Atualizar mapa';
    }
    frame.src = windyEmbedUrl(layer);
    updateStatus();
  };
  const choose = (event) => {
    const next = event.currentTarget.dataset.layer;
    if (!Object.hasOwn(WINDY_LAYERS, next) || next === layer) return;
    layer = next; updateButtons();
    if (frame) load();
  };
  let manuallyClosed = false;
  const close = () => { frame?.remove(); frame = null; manuallyClosed = true; loadButton.textContent = 'Carregar mapa'; updateStatus(); };
  const onOnline = () => { if (autoload && !frame && !manuallyClosed) load(); else updateStatus(); };
  buttons.forEach((button) => button.addEventListener('click', choose));
  loadButton.addEventListener('click', load);
  closeButton?.addEventListener('click', close);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', updateStatus);
  updateButtons(); updateStatus(); if (autoload && navigator.onLine) load();
  return () => {
    buttons.forEach((button) => button.removeEventListener('click', choose));
    loadButton.removeEventListener('click', load);
    closeButton?.removeEventListener('click', close);
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', updateStatus);
    frame?.remove();
  };
}
