// Public E-REDES dataset: planned maintenance, not unplanned faults or
// restoration estimates for a particular electricity contract.
export const SCHEDULED_SOURCE = 'https://e-redes.opendatasoft.com/explore/dataset/network-scheduling-work/';
const API = 'https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/network-scheduling-work/records';
const LOCATION = 'Figueira da Foz';
const FIGUEIRA_POSTCODE = '0000-000';
const MAX_RESULTS = 100;

const text = (value) => typeof value === 'string' ? value.trim() : '';

/** Return planned outages in Figueira da Foz, identifying Figueira da Foz's postcode.
 * Times are returned as published by E-REDES (local wall-clock strings).
 * Absence of planned works cannot establish whether power is currently on.
 */
export async function fetchScheduledElectricity({ signal, timeoutMs = 12000 } = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    const metadata = fetch('https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/network-scheduling-work', {
      signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
    }).then(async (response) => response.ok ? response.json() : null).catch(() => null);
    const records = [];
    let total;
    do {
      const params = new URLSearchParams({
        where: 'municipality="Figueira da Foz" and interrupcao_programada=1',
        limit: String(MAX_RESULTS), offset: String(records.length),
      });
      const response = await fetch(`${API}?${params}`, { signal: controller.signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error(`E-REDES indisponível (HTTP ${response.status}).`);
      const data = await response.json();
      if (!Number.isSafeInteger(data?.total_count) || data.total_count < 0 || !Array.isArray(data.results) || data.results.length > MAX_RESULTS) throw new Error('Formato de dados da E-REDES inválido.');
      if (total !== undefined && data.total_count !== total) throw new Error('A informação da E-REDES mudou durante a consulta.');
      total = data.total_count;
      if (total > 10000 || (!data.results.length && records.length < total)) throw new Error('Não foi possível obter a lista completa da E-REDES.');
      records.push(...data.results);
    } while (records.length < total);
    const meta = await metadata;
    return {
      location: LOCATION,
      fetchedAt: new Date().toISOString(),
      sourceUpdatedAt: text(meta?.metas?.default?.modified) || null,
      records: records.map((row) => ({
        postcode: text(row.zipcode), municipality: text(row.municipality), parish: text(row.parish),
        startsAt: text(row.startdatetime), endsAt: text(row.enddatetime),
        sourceUpdatedAt: text(row.updatedatetime), inFigueira da Foz: text(row.zipcode) === FIGUEIRA_POSTCODE,
      })).sort((a, b) => Number(b.inFigueira da Foz) - Number(a.inFigueira da Foz) || a.startsAt.localeCompare(b.startsAt)),
    };
  } catch (error) {
    if (timedOut) throw new Error('A consulta da E-REDES demorou demasiado tempo.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
