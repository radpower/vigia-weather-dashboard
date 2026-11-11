// Foreground-only alerting. This is not Web Push and does not run while the
// page is closed, suspended or lacks a successful source update.
const LEVELS = new Set(['yellow', 'orange', 'red']);
const LEVEL_LABELS = { yellow: 'amarelo', orange: 'laranja', red: 'vermelho' };

function signature(warnings) {
  if (!Array.isArray(warnings)) return null;
  const grouped = new Map();
  for (const item of warnings) {
    if (!item || item.areaId !== 'CBR' || !LEVELS.has(item.level) || typeof item.type !== 'string' || !item.type ||
        typeof item.startTime !== 'string' || !Number.isFinite(Date.parse(item.startTime)) ||
        typeof item.endTime !== 'string' || !Number.isFinite(Date.parse(item.endTime)) ||
        typeof item.text !== 'string') return null;
    const key = JSON.stringify([item.areaId, item.type, item.startTime]);
    const value = JSON.stringify([item.level, item.endTime, item.text]);
    const entries = grouped.get(key) || [];
    entries.push(value);
    grouped.set(key, entries);
  }
  return new Map([...grouped].map(([key, values]) => [key, values.sort().join('\n')]));
}

function sound(context) {
  if (!context || context.state !== 'running') return false;
  try {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(740, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
    oscillator.start(start);
    oscillator.stop(start + 0.51);
    return true;
  } catch { return false; }
}

/** Create on-page alerts, then call observe() only with validated IPMA data. */
export function setupForegroundAlerts({ container }) {
  if (!container) throw new Error('Contentor de alertas em falta.');
  let enabled = false;
  let baseline = null;
  let latest = null;
  let available = false;
  let context = null;
  let disposed = false;
  let audioAvailable = false;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'show-more';
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Ativar alerta sonoro nesta página';
  const status = document.createElement('p');
  status.className = 'footnote';
  status.textContent = 'Opcional: avisa sobre alterações dos avisos IPMA enquanto esta página estiver aberta e ativa.';
  const announcement = document.createElement('p');
  announcement.className = 'source-error';
  announcement.setAttribute('role', 'status');
  announcement.setAttribute('aria-live', 'polite');
  container.replaceChildren(button, status, announcement);

  const toggle = async () => {
    if (enabled) {
      enabled = false; baseline = null;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Ativar alerta sonoro nesta página';
      status.textContent = 'Alerta sonoro desativado.';
      announcement.textContent = '';
      return;
    }
    button.disabled = true;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (Audio) {
        context ||= new Audio();
        if (context.state === 'suspended') await context.resume();
        audioAvailable = context.state === 'running';
      }
    } catch { audioAvailable = false; }
    if (disposed) return;
    enabled = true;
    baseline = latest ? new Map(latest) : null;
    button.disabled = false;
    button.setAttribute('aria-pressed', 'true');
    button.textContent = 'Desativar alerta nesta página';
    status.textContent = `${audioAvailable ? 'Som ativado' : 'Som indisponível neste dispositivo; apenas aviso visual'} · ${baseline ? 'a acompanhar alterações' : 'a aguardar a primeira consulta válida'}. Funciona apenas com a página aberta e ativa.`;
    announcement.textContent = '';
    if (!available || navigator.onLine === false) unavailable();
  };
  button.addEventListener('click', toggle);

  function observe(warnings) {
    if (disposed || document.hidden) return;
    const current = signature(warnings);
    if (!current) { unavailable(); return; }
    available = true;
    latest = current;
    if (!enabled) return;
    if (!baseline) {
      baseline = new Map(current);
      status.textContent = `${audioAvailable ? 'Som ativado' : 'Som indisponível; apenas aviso visual'} · a acompanhar alterações. Funciona apenas com a página aberta e ativa.`;
      return;
    }
    const changed = [...current.keys()].filter((key) => !baseline.has(key) || baseline.get(key) !== current.get(key));
    baseline = new Map(current);
    status.textContent = `${audioAvailable ? 'Som ativado' : 'Som indisponível; apenas aviso visual'} · a acompanhar alterações. Funciona apenas com a página aberta e ativa.`;
    if (!changed.length) return;
    const changes = warnings.filter((item) => changed.includes(JSON.stringify([item.areaId, item.type, item.startTime])));
    const labels = [...new Set(changes.map((item) => `${item.type} (${LEVEL_LABELS[item.level]})`))];
    announcement.textContent = `Novo aviso ou alteração para Coimbra: ${labels.join(', ')}. Consulta a secção Avisos IPMA.`;
    if (audioAvailable && !sound(context)) {
      audioAvailable = false;
      status.textContent = 'Som indisponível neste momento; apenas aviso visual. Funciona apenas com a página aberta e ativa.';
    }
  }

  function unavailable() {
    available = false;
    if (disposed || !enabled) return;
    status.textContent = 'Não foi possível verificar os avisos agora. O último estado válido foi preservado.';
  }

  function destroy() {
    disposed = true;
    button.removeEventListener('click', toggle);
    if (context && context.state !== 'closed') context.close().catch(() => {});
    container.replaceChildren();
  }

  return { observe, unavailable, destroy };
}
