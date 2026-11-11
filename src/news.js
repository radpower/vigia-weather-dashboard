// Feeds públicos. O serviço de acesso externo recebe apenas os URLs públicos,
// não uma morada nem coordenadas. Cada fonte pode falhar independentemente.
export const NEWS_FEED_URL = 'https://www.rtp.pt/noticias/rss';
export const NEWS_RELAY_URL = `https://proxy.cors.dev/${NEWS_FEED_URL}`;
export const LOCAL_NEWS_FEED_URL = 'https://www.asbeiras.pt/categoria/figueira-da-foz/feed/';
const SOURCES = [
  { name: 'Diário As Beiras · Figueira', legacyNames: ['Diário As Beiras'], url: LOCAL_NEWS_FEED_URL, hosts: ['asbeiras.pt', 'www.asbeiras.pt'], local: true, direct: true },
  { name: 'Diário As Beiras · Região', url: 'https://www.asbeiras.pt/feed/', hosts: ['asbeiras.pt', 'www.asbeiras.pt'], local: true, direct: true },
  { name: 'Rádio Foz Mondego', url: 'https://rfmondego.pt/feed/', hosts: ['rfmondego.pt', 'www.rfmondego.pt'], local: true },
  { name: 'RTP Notícias', url: NEWS_FEED_URL, hosts: ['rtp.pt', 'www.rtp.pt'], local: false },
];
const STORM_TERMS = /\b(?:mau tempo|tempestade|tempestades|temporal|depress[aã]o|chuvas?|precipita[çc][aã]o|inunda[çc][aã]o|inunda[çc][oõ]es|cheias?|vento|ventos|rajadas?|prote[çc][aã]o civil|ipma|charles|bruna|alerta meteorol[oó]gico|aviso meteorol[oó]gico)\b/i;
const LOCAL_TERMS = /\b(?:figueira da foz|figueira|coimbra|figueira|brenha|quiaios|mondego)\b/i;

function value(node, tag) { return node.getElementsByTagName(tag)[0]?.textContent?.trim() || ''; }
function safeUrl(value, hosts) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && hosts.includes(url.hostname) ? url.href : null;
  } catch { return null; }
}
function dateOrNull(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? null : date.toISOString(); }
function plainSummary(value) {
  const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const text = value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      if (entity[0] !== '#') return entities[entity.toLowerCase()] ?? match;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : ' ';
    })
    .replace(/\s+/g, ' ').trim();
  if (text.length <= 320) return text;
  const short = text.slice(0, 320);
  const boundary = short.lastIndexOf(' ');
  return `${short.slice(0, boundary > 200 ? boundary : 320).trimEnd()}…`;
}

/** Parse published items as text; only allow links belonging to the feed's publisher. */
export function parseNews(xml, parser = new DOMParser(), source = SOURCES[3]) {
  const doc = parser.parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement?.localName !== 'rss') throw new Error('O feed de notícias não está disponível.');
  const channel = doc.querySelector('channel');
  if (!channel) throw new Error('O feed de notícias está incompleto.');
  const seen = new Set();
  const items = [...channel.getElementsByTagName('item')].flatMap((entry) => {
    const title = value(entry, 'title');
    const url = safeUrl(value(entry, 'link'), source.hosts);
    const description = plainSummary(value(entry, 'description'));
    const text = `${title} ${description}`;
    const stormRelated = STORM_TERMS.test(text);
    if (!title || !url || seen.has(url)) return [];
    seen.add(url);
    return [{ title, summary: description === title ? '' : description, url, publishedAt: dateOrNull(value(entry, 'pubDate')), source: source.name,
      local: source.local || LOCAL_TERMS.test(text), stormRelated }];
  });
  items.sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));
  return { items, feedUpdatedAt: dateOrNull(value(channel, 'lastBuildDate')) };
}

async function fetchSource(source, signal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await fetch(source.direct ? source.url : `https://proxy.cors.dev/${source.url}`, {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    });
    if (!response.ok) throw new Error(`Notícias indisponíveis (HTTP ${response.status}).`);
    return parseNews(await response.text(), new DOMParser(), source);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

const timestamp = (item) => Number.isFinite(Date.parse(item.publishedAt)) ? Date.parse(item.publishedAt) : 0;
const newestFirst = (a, b) => timestamp(b) - timestamp(a);

/** Select a few local items per feed, then fill with the most recent stories. */
export function selectNews(groups, maxItems = 24) {
  const selected = []; const seen = new Set();
  const add = (item) => {
    if (selected.length >= maxItems || !item?.url || seen.has(item.url)) return;
    seen.add(item.url); selected.push(item);
  };
  for (const group of groups) if (group.local) {
    group.items.filter((item) => item.stormRelated).sort(newestFirst).slice(0, 2).forEach(add);
    [...group.items].sort(newestFirst).slice(0, 3).forEach(add);
  }
  groups.flatMap((group) => group.items).sort(newestFirst).forEach(add);
  return selected.sort(newestFirst);
}

/** Preserve previous results per failed source and expose their actual freshness. */
export async function fetchNews({ signal, timeoutMs = 12000, previous = null } = {}) {
  const results = await Promise.allSettled(SOURCES.map((source) => fetchSource(source, signal, timeoutMs)));
  if (signal?.aborted) throw new DOMException('Pedido cancelado.', 'AbortError');
  if (results.every((result) => result.status === 'rejected')) throw new Error('As fontes de notícias não estão disponíveis.');
  const checkedAt = new Date().toISOString();
  const previousSources = Array.isArray(previous?.sources) ? previous.sources : [];
  const previousItems = Array.isArray(previous?.items) ? previous.items : [];
  const sources = []; const groups = [];
  SOURCES.forEach((source, index) => {
    const names = [source.name, ...(source.legacyNames || [])];
    const result = results[index]; const available = result.status === 'fulfilled';
    const priorSource = previousSources.find((entry) => names.includes(entry.name));
    const priorTime = priorSource?.lastSuccessAt || (priorSource?.available ? previous?.fetchedAt : null) || null;
    const lastSuccessAt = available ? checkedAt : priorTime;
    const rawItems = available ? result.value.items : previousItems.filter((item) => names.includes(item.source));
    const items = rawItems.map((item) => ({ ...item, source: source.name, cached: !available, sourceFetchedAt: lastSuccessAt }));
    sources.push({ name: source.name, available, checkedAt, lastSuccessAt });
    groups.push({ local: source.local, items });
  });
  return { items: selectNews(groups), sources, fetchedAt: checkedAt };
}
