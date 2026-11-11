// This plan stays in this browser's local storage; it is never sent to a server.
const STORAGE_KEY = 'vigia:figueira:preparedness:v1';
const DEFAULT_ITEMS = [
  'Carregar telemóvel e powerbank',
  'Preparar água e alimentos',
  'Verificar medicamentos necessários',
  'Ter lanterna e pilhas à mão',
  'Preparar rádio a pilhas',
  'Guardar contactos importantes',
  'Descarregar mapas para uso offline',
];
const INITIAL = () => ({
  contactName: '', contactPhone: '', meetingPoint: '', medications: '', notes: '',
  checklist: DEFAULT_ITEMS.map((label, index) => ({ id: `default-${index}`, label, checked: false })),
});
const make = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function normalize(value) {
  const initial = INITIAL();
  if (!value || typeof value !== 'object') return initial;
  for (const key of ['contactName', 'contactPhone', 'meetingPoint', 'medications', 'notes']) {
    initial[key] = typeof value[key] === 'string' ? value[key].slice(0, 2000) : '';
  }
  if (Array.isArray(value.checklist)) {
    initial.checklist = value.checklist.slice(0, 100).flatMap((item, index) => {
      if (!item || typeof item.label !== 'string' || !item.label.trim()) return [];
      return [{ id: typeof item.id === 'string' ? item.id.slice(0, 100) : `item-${index}`, label: item.label.trim().slice(0, 120), checked: item.checked === true }];
    });
  }
  return initial;
}

/** Mount the offline preparation plan. Returns a cleanup for event listeners. */
export function setupPreparedness({ container }) {
  if (!container) throw new Error('Falta o espaço do plano pessoal.');
  const listeners = new AbortController();
  let checklistListeners = new AbortController();
  let state = INITIAL();
  let readError = false;
  let timer = null;
  let counter = 0;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) state = normalize(JSON.parse(saved));
  } catch { readError = true; }

  container.replaceChildren();
  const form = make('form', 'preparedness-form');
  const intro = make('p', 'preparedness-privacy', 'O plano é guardado apenas neste dispositivo, sem cifragem. Safari e a aplicação adicionada ao ecrã principal podem guardar dados separados. Pode perder-se se os dados do site forem apagados.');
  const fields = make('div', 'preparedness-fields');
  const inputs = {};
  const definitions = [
    ['contactName', 'Nome do contacto de confiança', 'text', ''],
    ['contactPhone', 'Telefone do contacto', 'tel', ''],
    ['meetingPoint', 'Ponto de encontro', 'text', ''],
    ['medications', 'Medicamentos e necessidades', 'textarea', ''],
    ['notes', 'Outras notas importantes', 'textarea', ''],
  ];
  const saveStatus = make('p', 'preparedness-status');
  saveStatus.setAttribute('role', 'status');
  saveStatus.setAttribute('aria-live', 'polite');
  saveStatus.textContent = readError ? 'Não foi possível ler o plano guardado neste dispositivo.' : 'O plano fica guardado neste dispositivo.';

  const persist = () => {
    clearTimeout(timer);
    timer = null;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      saveStatus.textContent = 'Plano guardado neste dispositivo.';
      return true;
    } catch {
      saveStatus.textContent = 'Não foi possível guardar. Mantém esta página aberta e guarda uma cópia dos dados noutro local.';
      return false;
    }
  };
  const queueSave = () => {
    saveStatus.textContent = 'A guardar…';
    clearTimeout(timer);
    timer = setTimeout(persist, 400);
  };

  for (const [key, labelText, type] of definitions) {
    const wrapper = make('div', 'preparedness-field');
    const label = make('label', '', labelText);
    const input = make(type === 'textarea' ? 'textarea' : 'input', 'preparedness-input');
    input.id = `preparedness-${key}`;
    label.htmlFor = input.id;
    if (type !== 'textarea') input.type = type;
    if (type === 'tel') input.autocomplete = 'tel';
    if (type === 'textarea') input.rows = 3;
    input.maxLength = type === 'textarea' ? 2000 : 200;
    input.value = state[key];
    input.addEventListener('input', () => { state[key] = input.value; queueSave(); }, { signal: listeners.signal });
    inputs[key] = input;
    wrapper.append(label, input);
    fields.append(wrapper);
  }
  const contactLink = make('a', 'preparedness-call', 'Ligar ao contacto de confiança');
  const updateContact = () => {
    const phone = state.contactPhone.trim();
    if (/^\+?[0-9 ()-]{3,30}$/.test(phone) && phone.replace(/\D/g, '').length >= 3) {
      contactLink.href = `tel:${phone.replace(/[ ()-]/g, '')}`; contactLink.hidden = false;
    } else { contactLink.removeAttribute('href'); contactLink.hidden = true; }
  };
  inputs.contactPhone.addEventListener('input', updateContact, { signal: listeners.signal });
  updateContact();
  fields.append(contactLink);

  const checkSection = make('fieldset', 'preparedness-checklist');
  checkSection.append(make('legend', '', 'Checklist de preparação'));
  const list = make('div', 'preparedness-list');
  const addRow = make('div', 'preparedness-add');
  const addLabel = make('label', 'preparedness-add-label', 'Adicionar item à checklist');
  const addInput = make('input', 'preparedness-input');
  addInput.id = 'preparedness-new-item'; addInput.type = 'text'; addInput.maxLength = 120; addInput.placeholder = 'Por exemplo: carregar pilhas';
  addLabel.htmlFor = addInput.id;
  const addButton = make('button', 'preparedness-button', 'Adicionar'); addButton.type = 'button';
  addRow.append(addLabel, addInput, addButton);

  const renderList = () => {
    checklistListeners.abort();
    checklistListeners = new AbortController();
    list.replaceChildren();
    if (!state.checklist.length) list.append(make('p', 'preparedness-empty', 'Ainda não há itens na checklist.'));
    state.checklist.forEach((item) => {
      const row = make('div', 'preparedness-item');
      const label = make('label', 'preparedness-check-label');
      const checkbox = make('input'); checkbox.type = 'checkbox'; checkbox.checked = item.checked;
      checkbox.addEventListener('change', () => { item.checked = checkbox.checked; persist(); }, { signal: checklistListeners.signal });
      label.append(checkbox, make('span', '', item.label));
      const remove = make('button', 'preparedness-remove', 'Remover'); remove.type = 'button'; remove.setAttribute('aria-label', `Remover ${item.label}`);
      remove.addEventListener('click', () => { state.checklist = state.checklist.filter((entry) => entry !== item); persist(); renderList(); }, { signal: checklistListeners.signal });
      row.append(label, remove); list.append(row);
    });
  };
  const add = () => {
    const label = addInput.value.trim();
    if (!label) { saveStatus.textContent = 'Escreve um item antes de o adicionar.'; addInput.focus(); return; }
    if (state.checklist.length >= 100) { saveStatus.textContent = 'A checklist atingiu o limite de 100 itens.'; return; }
    state.checklist.push({ id: `custom-${Date.now()}-${counter++}`, label, checked: false });
    addInput.value = ''; persist(); renderList(); addInput.focus();
  };
  addButton.addEventListener('click', add, { signal: listeners.signal });
  addInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }, { signal: listeners.signal });
  form.addEventListener('submit', (event) => { event.preventDefault(); persist(); }, { signal: listeners.signal });
  checkSection.append(list, addRow);
  const saveButton = make('button', 'preparedness-button preparedness-save', 'Guardar plano'); saveButton.type = 'submit';
  form.append(intro, fields, checkSection, saveButton, saveStatus);
  container.append(form); renderList();
  window.addEventListener('pagehide', () => { if (timer !== null) persist(); }, { signal: listeners.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden && timer !== null) persist(); }, { signal: listeners.signal });

  return () => { if (timer !== null) persist(); checklistListeners.abort(); listeners.abort(); };
}
