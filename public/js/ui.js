import { api } from './api.js';

// ---------------- Estado global ----------------
export const state = {
  user: null,
  settings: {},
  license: null,
  users: [],
  pipelines: [],
  customFields: {},
};

export async function loadBase() {
  const [settings, license, users, pipelines] = await Promise.all([
    api.get('/settings'), api.get('/license'), api.get('/users'), api.get('/pipelines'),
  ]);
  Object.assign(state, { settings, license, users, pipelines });
  state.customFields = {};
}

export const hasFeature = (f) => !!state.license?.features?.includes(f);
export const isAdmin = () => state.user?.role === 'admin';
export const isManager = () => ['admin', 'manager'].includes(state.user?.role);
export const listSetting = (key) => String(state.settings[key] || '').split(',').map((s) => s.trim()).filter(Boolean);

export async function refreshPipelines() { state.pipelines = await api.get('/pipelines'); }
export async function refreshUsers() { state.users = await api.get('/users'); }

export async function customFieldsFor(entity) {
  if (!hasFeature('custom_fields')) return [];
  if (!state.customFields[entity]) state.customFields[entity] = await api.get('/custom-fields', { entity });
  return state.customFields[entity];
}

// ---------------- Utilidades ----------------
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const locale = () => state.settings.locale || 'es-ES';

export function money(n, currency) {
  const v = Number(n || 0);
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || state.settings.currency || 'EUR', maximumFractionDigits: Math.abs(v) >= 1000 || Number.isInteger(v) ? 0 : 2 }).format(v);
  } catch { return v.toFixed(2); }
}
export function moneyExact(n, currency) {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: currency || state.settings.currency || 'EUR' }).format(Number(n || 0));
  } catch { return Number(n || 0).toFixed(2); }
}
export function compactMoney(n) {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: state.settings.currency || 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));
  } catch { return String(n); }
}
export const num = (n, d = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d }).format(Number(n || 0));

const parseDate = (s) => {
  if (!s) return null;
  const str = String(s);
  // Las fechas SQLite "YYYY-MM-DD HH:MM:SS" están en UTC
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)) return new Date(`${str.replace(' ', 'T')}Z`);
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return new Date(`${str}T00:00`);
  return new Date(str);
};
export function fdate(s, opts = { day: '2-digit', month: 'short', year: 'numeric' }) {
  const d = parseDate(s);
  return d && !Number.isNaN(d) ? d.toLocaleDateString(locale(), opts) : '';
}
export function fdatetime(s) {
  const d = parseDate(s);
  if (!d || Number.isNaN(d)) return '';
  const hasTime = String(s).length > 10;
  return d.toLocaleDateString(locale(), { day: '2-digit', month: 'short', year: 'numeric' }) + (hasTime ? ` ${d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })}` : '');
}
export function ago(s) {
  const d = parseDate(s);
  if (!d) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
  const abs = Math.abs(diff);
  if (abs < 60) return 'ahora mismo';
  if (abs < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(-Math.round(diff / 86400), 'day');
  return fdate(s);
}
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isOverdue = (due, done) => !done && due && String(due).slice(0, 10) < today();

export function initials(name) {
  return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';
}
export function avatar(name, color, size = '') {
  return `<span class="avatar ${size}" style="background:${esc(color || '#898781')}" title="${esc(name)}">${esc(initials(name))}</span>`;
}
export function ownerCell(ownerId, ownerName) {
  if (!ownerName) return '<span class="muted">—</span>';
  const u = state.users.find((x) => x.id === ownerId);
  return `<span class="owner">${avatar(ownerName, u?.color, 'sm')}<span class="ellipsis">${esc(ownerName)}</span></span>`;
}
export const tagsHtml = (tags) => (tags ? String(tags).split(',').map((t) => `<span class="tag">${esc(t)}</span>`).join('') : '');

export function debounce(fn, ms = 250) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ---------------- Etiquetas ----------------
export const L = {
  contactStatus: { lead: ['Lead', 'blue'], prospect: ['Prospecto', 'yellow'], customer: ['Cliente', 'green'], inactive: ['Inactivo', ''] },
  activityType: { task: 'Tarea', call: 'Llamada', meeting: 'Reunión', email: 'Email', deadline: 'Plazo' },
  priority: { low: ['Baja', ''], normal: ['Normal', 'blue'], high: ['Alta', 'red'], urgent: ['Urgente', 'red'] },
  ticketStatus: { open: ['Abierto', 'blue'], pending: ['Pendiente', 'yellow'], resolved: ['Resuelto', 'green'], closed: ['Cerrado', ''] },
  channel: { email: 'Email', phone: 'Teléfono', web: 'Web', chat: 'Chat', whatsapp: 'WhatsApp', other: 'Otro' },
  dealStatus: { open: ['Abierta', 'blue'], won: ['Ganada', 'green'], lost: ['Perdida', 'red'] },
  quoteStatus: { draft: ['Borrador', ''], sent: ['Enviado', 'blue'], accepted: ['Aceptado', 'green'], rejected: ['Rechazado', 'red'], expired: ['Caducado', 'yellow'] },
  invoiceStatus: { draft: ['Borrador', ''], sent: ['Emitida', 'blue'], paid: ['Pagada', 'green'], overdue: ['Vencida', 'red'], cancelled: ['Anulada', ''] },
  role: { admin: 'Administrador', manager: 'Responsable', sales: 'Comercial' },
};
export function badge(map, key) {
  const v = map[key];
  if (!v) return key ? `<span class="badge">${esc(key)}</span>` : '';
  const [label, color] = Array.isArray(v) ? v : [v, ''];
  return `<span class="badge ${color}">${esc(label)}</span>`;
}
export const opts = (map) => Object.entries(map).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v]);

// ---------------- Iconos (trazos estilo Lucide) ----------------
const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V21a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M12 10h.01M12 14h.01M16 10h.01M16 14h.01M8 10h.01M8 14h.01"/>',
  target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  checkSquare: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m9 12 2 2 4-4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  receipt: '<path d="M4 2v20l3-2 3 2 2-2 2 2 3-2 3 2V2l-3 2-3-2-2 2-2-2-3 2z"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  lifebuoy: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><path d="m4.93 4.93 4.24 4.24M14.83 14.83l4.24 4.24M14.83 9.17l4.24-4.24M4.93 19.07l4.24-4.24"/>',
  chart: '<path d="M3 3v18h18"/><path d="M8 17V10M13 17V6M18 17v-4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.18 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.1 9.9a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7"/>',
  pin: '<path d="M12 17v5M9 10.76V6h6v4.76l2 3.24H7z"/><path d="M8 2h8"/>',
  note: '<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5z"/><path d="M15 3v6h6"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  kanban: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 7v7M12 7v4M16 7v9"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  external: '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3"/>',
  moon: '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
  database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
  sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  trophy: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22M18 2H6v7a6 6 0 0 0 12 0z"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
};
export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
export const activityIcon = (t) => ({ task: 'checkSquare', call: 'phone', meeting: 'users', email: 'mail', deadline: 'flag' }[t] || 'checkSquare');

// ---------------- Toast / modal ----------------
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), type === 'error' ? 6000 : 3000);
}
export const toastError = (err) => toast(err?.message || String(err), 'error');

export function modal({ title, body, footer = '', size = '', onMount }) {
  const root = $('#modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-backdrop';
  wrap.innerHTML = `<div class="modal ${size}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <div class="modal-head"><h2 class="grow">${esc(title)}</h2><button class="btn ghost icon-only sm" data-close aria-label="Cerrar">${icon('x')}</button></div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const prevFocus = document.activeElement;
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    prevFocus?.focus?.();
  };
  const onKey = (e) => { if (e.key === 'Escape' && root.lastElementChild === wrap) close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) wrap.dataset.downOutside = '1'; });
  wrap.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || (e.target === wrap && wrap.dataset.downOutside)) close();
    delete wrap.dataset.downOutside;
  });
  root.appendChild(wrap);
  const el = $('.modal', wrap);
  onMount?.(el, close);
  setTimeout(() => $('input:not([type=hidden]):not([type=checkbox]), select, textarea', el)?.focus(), 30);
  return { el, close };
}

export function confirmDialog(message, { title = 'Confirmar', okLabel = 'Eliminar', danger = true } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { close } = modal({
      title,
      size: 'narrow',
      body: `<p style="margin:0">${esc(message)}</p>`,
      footer: `<button class="btn" data-close>Cancelar</button><button class="btn ${danger ? 'primary' : 'primary'}" data-ok style="${danger ? 'background:var(--bad);border-color:var(--bad)' : ''}">${esc(okLabel)}</button>`,
      onMount(el, closeFn) {
        $('[data-ok]', el).addEventListener('click', () => { done = true; closeFn(); resolve(true); });
        setTimeout(() => $('[data-ok]', el).focus(), 40);
        new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(false); } })
          .observe($('#modal-root'), { childList: true });
      },
    });
    return close;
  });
}

export function promptDialog(title, { label = '', value = '', options = null, okLabel = 'Aceptar' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const input = options
      ? `<select name="v">${options.map((o) => `<option ${o === value ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`
      : `<input type="text" name="v" value="${esc(value)}">`;
    modal({
      title,
      size: 'narrow',
      body: `<form><label class="field"><span>${esc(label)}</span>${input}</label></form>`,
      footer: `<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>${esc(okLabel)}</button>`,
      onMount(el, close) {
        const submit = (e) => { e?.preventDefault(); done = true; const v = $('[name=v]', el).value; close(); resolve(v); };
        $('[data-ok]', el).addEventListener('click', submit);
        $('form', el).addEventListener('submit', submit);
        new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); if (!done) resolve(null); } })
          .observe($('#modal-root'), { childList: true });
      },
    });
  });
}

// ---------------- Formularios ----------------
const LOOKUPS = {
  contacts: { path: '/contacts', label: (r) => r.full_name, sub: (r) => r.company_name || r.email || '' },
  companies: { path: '/companies', label: (r) => r.name, sub: (r) => r.city || '' },
  deals: { path: '/deals', label: (r) => r.title, sub: (r) => `${r.stage_name} · ${money(r.value)}` },
  products: { path: '/products', label: (r) => r.name, sub: (r) => `${r.sku || ''} ${money(r.price)}` },
  tickets: { path: '/tickets', label: (r) => `#${r.id} ${r.subject}`, sub: (r) => r.contact_name || '' },
};

export const ownerOptions = (includeEmpty = true) => [
  ...(includeEmpty ? [['', '— Sin asignar —']] : []),
  ...state.users.filter((u) => u.active).map((u) => [String(u.id), u.name]),
];

function optionList(options, value, placeholder) {
  const list = typeof options === 'function' ? options() : options;
  const v = value == null ? '' : String(value);
  let found = false;
  const html = list.map(([k, lbl]) => {
    const sel = String(k) === v;
    if (sel) found = true;
    return `<option value="${esc(k)}" ${sel ? 'selected' : ''}>${esc(lbl)}</option>`;
  }).join('');
  const extra = v && !found ? `<option value="${esc(v)}" selected>${esc(v)}</option>` : '';
  return (placeholder !== undefined ? `<option value="">${esc(placeholder)}</option>` : '') + extra + html;
}

function getValue(values, key) {
  if (key.startsWith('custom.')) return values.custom?.[key.slice(7)];
  return values[key];
}

export function renderField(f, values = {}) {
  if (f.type === 'section') return `<div class="form-section">${esc(f.label)}</div>`;
  const v = getValue(values, f.key);
  const name = esc(f.key);
  const req = f.required ? ' required' : '';
  const lbl = `<span>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</span>`;
  const cls = `field${f.full || f.type === 'textarea' ? ' full' : ''}`;
  const ph = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : '';
  let input;
  switch (f.type) {
    case 'textarea':
      input = `<textarea name="${name}" rows="${f.rows || 3}"${req}${ph}>${esc(v)}</textarea>`; break;
    case 'select':
      input = `<select name="${name}"${req}>${optionList(f.options, v ?? f.default, f.placeholder ?? (f.required ? undefined : ''))}</select>`; break;
    case 'owner':
      input = `<select name="${name}">${optionList(ownerOptions(!f.required), v ?? (values.id ? '' : state.user.id))}</select>`; break;
    case 'checkbox':
      return `<label class="check ${f.full ? 'full' : ''}" style="align-self:end;padding-bottom:6px"><input type="checkbox" name="${name}" ${v ? 'checked' : ''}> ${esc(f.label)}</label>`;
    case 'lookup': {
      const label = f.labelKey ? values[f.labelKey] : '';
      input = `<div class="lookup" data-lookup="${esc(f.entity)}">
        <input type="hidden" name="${name}" value="${esc(v ?? '')}">
        <input type="text" class="lookup-input" value="${esc(label || '')}" placeholder="${esc(f.placeholder || 'Buscar…')}" autocomplete="off">
        <button type="button" class="lookup-clear" aria-label="Quitar" title="Quitar">×</button>
        <div class="lookup-results hidden"></div></div>`;
      break;
    }
    case 'datetime': {
      const val = v ? String(v).slice(0, 16) : '';
      input = `<input type="datetime-local" name="${name}" value="${esc(val)}"${req}>`; break;
    }
    case 'number':
      input = `<input type="number" step="${f.step || 'any'}" name="${name}" value="${esc(v ?? f.default ?? '')}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''}${req}${ph}>`; break;
    case 'datalist': {
      const id = `dl-${Math.random().toString(36).slice(2, 8)}`;
      const list = typeof f.options === 'function' ? f.options() : f.options;
      input = `<input type="text" name="${name}" value="${esc(v ?? '')}" list="${id}"${req}${ph}><datalist id="${id}">${list.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>`; break;
    }
    default:
      input = `<input type="${f.type || 'text'}" name="${name}" value="${esc(f.type === 'date' && v ? String(v).slice(0, 10) : v ?? '')}"${req}${ph}>`;
  }
  return `<label class="${cls}">${lbl}${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
}

export const renderForm = (fields, values = {}) => `<div class="form-grid">${fields.map((f) => renderField(f, values)).join('')}</div>`;

export function readForm(root, fields) {
  const out = {};
  for (const f of fields) {
    if (f.type === 'section' || f.readonly) continue;
    const el = root.querySelector(`[name="${CSS.escape(f.key)}"]`);
    if (!el) continue;
    let v;
    if (f.type === 'checkbox') v = el.checked;
    else if (f.type === 'number') v = el.value === '' ? null : Number(el.value);
    else if (['lookup', 'owner'].includes(f.type) || f.ref) v = el.value === '' ? null : Number(el.value);
    else v = el.value.trim() === '' ? null : el.value.trim();
    if (f.key.startsWith('custom.')) (out.custom ||= {})[f.key.slice(7)] = v;
    else out[f.key] = v;
  }
  return out;
}

export function bindLookups(root) {
  for (const box of $$('.lookup', root)) {
    if (box.dataset.bound) continue;
    box.dataset.bound = '1';
    const cfg = LOOKUPS[box.dataset.lookup];
    const hidden = $('input[type=hidden]', box);
    const input = $('.lookup-input', box);
    const results = $('.lookup-results', box);
    let items = [];
    let focus = -1;
    const choose = (r) => {
      hidden.value = r ? r.id : '';
      input.value = r ? cfg.label(r) : '';
      results.classList.add('hidden');
      box.dispatchEvent(new CustomEvent('lookup-change', { bubbles: true, detail: r }));
    };
    const renderResults = () => {
      results.innerHTML = items.length
        ? items.map((r, i) => `<button type="button" data-i="${i}" class="${i === focus ? 'focus' : ''}">${esc(cfg.label(r))}<div class="small muted">${esc(cfg.sub(r))}</div></button>`).join('')
        : '<div class="small muted" style="padding:8px 10px">Sin resultados</div>';
      results.classList.remove('hidden');
    };
    const search = debounce(async () => {
      try {
        const res = await api.get(cfg.path, { q: input.value, limit: 8, ...(box.dataset.lookup === 'products' ? { active: 1 } : {}) });
        items = res.data; focus = -1; renderResults();
      } catch { /* ignorar */ }
    }, 200);
    input.addEventListener('input', () => { hidden.value = ''; search(); });
    input.addEventListener('focus', () => search());
    input.addEventListener('keydown', (e) => {
      if (results.classList.contains('hidden')) return;
      if (e.key === 'ArrowDown') { focus = Math.min(items.length - 1, focus + 1); renderResults(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { focus = Math.max(0, focus - 1); renderResults(); e.preventDefault(); }
      else if (e.key === 'Enter' && focus >= 0) { choose(items[focus]); e.preventDefault(); }
      else if (e.key === 'Escape') { results.classList.add('hidden'); e.stopPropagation(); }
    });
    input.addEventListener('blur', () => setTimeout(() => {
      results.classList.add('hidden');
      if (!hidden.value) input.value = '';
    }, 180));
    results.addEventListener('mousedown', (e) => {
      const b = e.target.closest('button[data-i]');
      if (b) { e.preventDefault(); choose(items[Number(b.dataset.i)]); }
    });
    $('.lookup-clear', box).addEventListener('click', () => choose(null));
    box.setValue = (r) => choose(r);
  }
}

export async function withCustomFields(entity, fields) {
  const cf = await customFieldsFor(entity);
  if (!cf.length) return fields;
  const map = { text: 'text', textarea: 'textarea', number: 'number', date: 'date', select: 'select', checkbox: 'checkbox', url: 'url' };
  return [...fields, { type: 'section', label: 'Campos personalizados' }, ...cf.map((c) => ({
    key: `custom.${c.key}`, label: c.label, type: map[c.type], required: c.required,
    options: c.type === 'select' ? c.options.map((o) => [o, o]) : undefined,
  }))];
}

/** Modal con formulario. onSubmit recibe los datos; si lanza error se muestra y el modal sigue abierto. */
export function formModal({ title, fields, values = {}, onSubmit, submitLabel = 'Guardar', size = '', extraFooter = '' }) {
  return new Promise((resolve) => {
    modal({
      title,
      size,
      body: `<form novalidate>${renderForm(fields, values)}<div class="form-error badge red hidden" style="margin-top:14px;height:auto;padding:8px 12px;white-space:normal"></div><button type="submit" hidden></button></form>`,
      footer: `${extraFooter}<span class="spacer"></span><button class="btn" data-close>Cancelar</button><button class="btn primary" data-submit>${esc(submitLabel)}</button>`,
      onMount(el, close) {
        const form = $('form', el);
        bindLookups(form);
        const errBox = $('.form-error', el);
        const submitBtn = $('[data-submit]', el);
        const submit = async (e) => {
          e?.preventDefault();
          const missing = fields.find((f) => f.required && f.type !== 'checkbox' && !form.querySelector(`[name="${CSS.escape(f.key)}"]`)?.value);
          if (missing) { errBox.textContent = `El campo «${missing.label}» es obligatorio`; errBox.classList.remove('hidden'); return; }
          submitBtn.disabled = true;
          try {
            const result = await onSubmit(readForm(form, fields), form);
            close();
            resolve(result);
          } catch (err) {
            errBox.textContent = err.message;
            errBox.classList.remove('hidden');
          } finally { submitBtn.disabled = false; }
        };
        form.addEventListener('submit', submit);
        submitBtn.addEventListener('click', submit);
        new MutationObserver((_, obs) => { if (!el.isConnected) { obs.disconnect(); resolve(null); } })
          .observe($('#modal-root'), { childList: true });
      },
    });
  });
}

export function emptyState(text, iconName = 'search') {
  return `<div class="empty">${icon(iconName)}<div>${esc(text)}</div></div>`;
}

export function dropdown(trigger, menuHtml, onMount) {
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const holder = trigger.parentElement;
    const existing = $('.menu', holder);
    $$('.menu').forEach((m) => m.remove());
    if (existing) return;
    const m = document.createElement('div');
    m.className = 'menu';
    m.innerHTML = typeof menuHtml === 'function' ? menuHtml() : menuHtml;
    holder.appendChild(m);
    onMount?.(m);
  });
}
document.addEventListener('click', (e) => {
  if (!e.target.closest('.menu') || e.target.closest('.menu a, .menu button')) $$('.menu').forEach((m) => m.remove());
});

export function setTitle(t) {
  document.title = `${t} · ${state.settings.company_name || 'NexoCRM'}`;
}
