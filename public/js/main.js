import { api, auth, setUnauthorizedHandler } from './api.js';
import {
  state, loadBase, $, $$, esc, icon, hasFeature, isManager, avatar, L, debounce, fdatetime, dropdown, toastError, activityIcon,
} from './ui.js';
import { renderLogin, renderSetup } from './views/auth.js';

const ROUTES = [
  { path: /^\/?$/, view: () => import('./views/dashboard.js'), nav: 'dashboard' },
  { path: /^\/contacts\/?$/, view: () => import('./views/contacts.js'), nav: 'contacts' },
  { path: /^\/contacts\/(\d+)$/, view: () => import('./views/contacts.js'), fn: 'detail', nav: 'contacts' },
  { path: /^\/companies\/?$/, view: () => import('./views/companies.js'), nav: 'companies' },
  { path: /^\/companies\/(\d+)$/, view: () => import('./views/companies.js'), fn: 'detail', nav: 'companies' },
  { path: /^\/deals\/?$/, view: () => import('./views/deals.js'), nav: 'deals' },
  { path: /^\/deals\/(\d+)$/, view: () => import('./views/deals.js'), fn: 'detail', nav: 'deals' },
  { path: /^\/activities\/?$/, view: () => import('./views/activities.js'), nav: 'activities' },
  { path: /^\/products\/?$/, view: () => import('./views/products.js'), nav: 'products', feature: 'products' },
  { path: /^\/quotes\/?$/, view: () => import('./views/quotes.js'), nav: 'quotes', feature: 'quotes', args: ['quote'] },
  { path: /^\/invoices\/?$/, view: () => import('./views/quotes.js'), nav: 'invoices', feature: 'quotes', args: ['invoice'] },
  { path: /^\/(quotes|invoices)\/(new|\d+)$/, view: () => import('./views/quotes.js'), fn: 'editor', feature: 'quotes', navFrom: 1 },
  { path: /^\/(quotes|invoices)\/(\d+)\/print$/, view: () => import('./views/quotes.js'), fn: 'print', feature: 'quotes', navFrom: 1 },
  { path: /^\/tickets\/?$/, view: () => import('./views/tickets.js'), nav: 'tickets', feature: 'tickets' },
  { path: /^\/tickets\/(\d+)$/, view: () => import('./views/tickets.js'), fn: 'detail', nav: 'tickets', feature: 'tickets' },
  { path: /^\/reports\/?$/, view: () => import('./views/reports.js'), nav: 'reports', feature: 'reports' },
  { path: /^\/settings(?:\/([a-z-]+))?$/, view: () => import('./views/settings.js'), nav: 'settings' },
  { path: /^\/profile$/, view: () => import('./views/settings.js'), fn: 'profile', nav: 'profile' },
];

const NAV = [
  { id: 'dashboard', href: '#/', label: 'Panel', icon: 'home' },
  { section: 'Ventas' },
  { id: 'contacts', href: '#/contacts', label: 'Contactos', icon: 'users' },
  { id: 'companies', href: '#/companies', label: 'Empresas', icon: 'building' },
  { id: 'deals', href: '#/deals', label: 'Oportunidades', icon: 'target' },
  { id: 'activities', href: '#/activities', label: 'Actividades', icon: 'checkSquare', badge: 'tasks' },
  { section: 'Facturación', feature: 'quotes' },
  { id: 'products', href: '#/products', label: 'Productos', icon: 'box', feature: 'products' },
  { id: 'quotes', href: '#/quotes', label: 'Presupuestos', icon: 'file', feature: 'quotes' },
  { id: 'invoices', href: '#/invoices', label: 'Facturas', icon: 'receipt', feature: 'quotes' },
  { section: 'Servicio', feature: 'tickets' },
  { id: 'tickets', href: '#/tickets', label: 'Soporte', icon: 'lifebuoy', feature: 'tickets' },
  { section: 'Análisis' },
  { id: 'reports', href: '#/reports', label: 'Informes', icon: 'chart', feature: 'reports' },
  { id: 'settings', href: '#/settings', label: 'Configuración', icon: 'settings' },
];

let cleanup = null;
let notifTimer = null;

function applyTheme() {
  let t = null;
  try { t = localStorage.getItem('crm_theme'); } catch { /* */ }
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}

function licenseBanner() {
  const lic = state.license;
  if (!lic) return '';
  const cta = (label) => `<a class="btn sm ${lic.storeEnabled ? 'primary' : ''}" href="#/settings/license">${label}</a>`;
  const buy = lic.storeEnabled ? 'Comprar licencia' : 'Activar licencia';
  if (lic.readOnly) {
    return `<div class="banner bad">${icon('shield')}<span class="grow">${lic.status === 'trial_expired' ? 'Tu prueba gratuita ha terminado.' : 'Tu licencia ha caducado.'} El CRM está en <b>modo solo lectura</b>; tus datos están a salvo.</span>${cta(buy)}</div>`;
  }
  if (lic.status === 'grace') return `<div class="banner bad">${icon('shield')}<span class="grow">Tu licencia caducó. Te quedan ${lic.daysLeft + 7} días de gracia antes del modo solo lectura.</span>${cta(lic.storeEnabled ? 'Renovar ahora' : 'Renovar')}</div>`;
  if (lic.status === 'trial' && lic.daysLeft <= 7) return `<div class="banner warn">${icon('clock')}<span class="grow">Quedan ${lic.daysLeft} días de prueba gratuita.</span>${cta(buy)}</div>`;
  // Las licencias con renovación automática (suscripción) no muestran aviso de caducidad.
  if (lic.status === 'active' && !lic.billing && lic.daysLeft <= 30) return `<div class="banner warn">${icon('clock')}<span class="grow">Tu licencia caduca en ${lic.daysLeft} días.</span>${cta('Renovar')}</div>`;
  return '';
}

function renderShell() {
  const s = state.settings;
  const lic = state.license;
  const pillCls = lic.readOnly || lic.status === 'grace' ? 'bad' : (lic.daysLeft <= 14 ? 'warn' : '');
  const logo = s.company_logo ? `<img src="${esc(s.company_logo)}" alt="">` : esc((s.company_name || 'N')[0]);
  if (s.brand_color) {
    document.documentElement.style.setProperty('--brand', s.brand_color);
  }
  $('#app').innerHTML = `
    <div class="shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand"><span class="brand-logo">${logo}</span><span class="ellipsis">${esc(s.company_name || 'NexoCRM')}</span></div>
        <nav class="nav">
          ${NAV.filter((n) => !n.feature || hasFeature(n.feature)).map((n) => (n.section
            ? `<div class="nav-section">${esc(n.section)}</div>`
            : `<a href="${n.href}" data-nav="${n.id}">${icon(n.icon)}<span>${esc(n.label)}</span>${n.badge ? '<span class="badge count hidden" data-badge="tasks"></span>' : ''}</a>`)).join('')}
        </nav>
        <div class="sidebar-foot">
          <a class="license-pill ${pillCls}" href="#/settings/license">
            <b>${esc(lic.planLabel)}</b> · ${lic.readOnly ? 'caducada' : `${lic.daysLeft} días`}<br>
            <span class="muted small">${lic.seatsUsed ?? ''}/${lic.seats} usuarios</span>
          </a>
        </div>
      </aside>
      <div class="main">
        ${licenseBanner()}
        <header class="topbar">
          <button class="btn ghost icon-only menu-btn" id="menu-btn" aria-label="Menú">${icon('menu')}</button>
          <div class="global-search">
            ${icon('search')}
            <input type="search" id="gsearch" placeholder="Buscar contactos, empresas, oportunidades… ( / )" autocomplete="off" aria-label="Búsqueda global">
            <div class="search-results hidden" id="gresults"></div>
          </div>
          <span class="spacer"></span>
          <div class="dropdown"><button class="btn ghost icon-only" id="quick-add" aria-label="Crear" title="Crear">${icon('plus')}</button></div>
          <div class="dropdown"><button class="btn ghost icon-only" id="notif-btn" aria-label="Notificaciones" style="position:relative">${icon('bell')}<span class="badge count hidden" id="notif-count" style="position:absolute;top:2px;right:0"></span></button></div>
          <div class="dropdown"><button class="btn ghost" id="user-btn" style="padding:0 6px">${avatar(state.user.name, state.user.color, 'sm')}<span class="hide-sm">${esc(state.user.name.split(' ')[0])}</span></button></div>
        </header>
        <main class="content" id="view"></main>
      </div>
    </div>`;

  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });

  dropdown($('#user-btn'), () => `
    <div class="menu-title">${esc(state.user.email)}<br>${esc(L.role[state.user.role])}</div><hr>
    <a href="#/profile">${icon('user')}Mi perfil</a>
    <button data-theme-toggle>${icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')}Cambiar tema</button>
    <a href="#/settings/license">${icon('key')}Licencia</a>
    <hr><button data-logout>${icon('logout')}Cerrar sesión</button>`, (m) => {
    $('[data-logout]', m).addEventListener('click', logout);
    $('[data-theme-toggle]', m).addEventListener('click', () => {
      const dark = document.documentElement.dataset.theme === 'dark'
        || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
      try { localStorage.setItem('crm_theme', dark ? 'light' : 'dark'); } catch { /* */ }
      applyTheme();
    });
  });

  dropdown($('#quick-add'), () => `
    <a href="#/contacts?new=1">${icon('user')}Contacto</a>
    <a href="#/companies?new=1">${icon('building')}Empresa</a>
    <a href="#/deals?new=1">${icon('target')}Oportunidad</a>
    <a href="#/activities?new=1">${icon('checkSquare')}Actividad</a>
    ${hasFeature('quotes') ? `<a href="#/quotes/new">${icon('file')}Presupuesto</a><a href="#/invoices/new">${icon('receipt')}Factura</a>` : ''}
    ${hasFeature('tickets') ? `<a href="#/tickets?new=1">${icon('lifebuoy')}Ticket</a>` : ''}`);

  dropdown($('#notif-btn'), () => '<div class="notif-list" id="notif-list"><div class="muted small" style="padding:10px">Cargando…</div></div>', async (m) => {
    try {
      const n = await api.get('/notifications');
      const item = (href, ic, title, sub, cls = '') => `<a class="item" href="${href}"><div class="row">${icon(ic)}<div class="grow"><div class="ellipsis ${cls}">${esc(title)}</div><div class="small muted">${esc(sub)}</div></div></div></a>`;
      const parts = [];
      if (n.overdue.length) parts.push('<div class="menu-title">Actividades vencidas</div>', ...n.overdue.map((a) => item('#/activities?when=overdue', activityIcon(a.type), a.subject, fdatetime(a.due_at), 'prio-high')));
      if (n.today.length) parts.push('<div class="menu-title">Para hoy</div>', ...n.today.map((a) => item('#/activities?when=today', activityIcon(a.type), a.subject, fdatetime(a.due_at))));
      if (n.closing.length) parts.push('<div class="menu-title">Cierres esta semana</div>', ...n.closing.map((d) => item(`#/deals/${d.id}`, 'target', d.title, fdatetime(d.expected_close))));
      if (n.tickets.length) parts.push('<div class="menu-title">Tickets abiertos asignados</div>', ...n.tickets.map((t) => item(`#/tickets/${t.id}`, 'lifebuoy', `#${t.id} ${t.subject}`, L.priority[t.priority]?.[0] || '')));
      $('#notif-list', m).innerHTML = parts.join('') || '<div class="empty" style="padding:24px">Todo al día 🎉</div>';
    } catch (err) { toastError(err); }
  });

  bindGlobalSearch();
  refreshBadges();
  clearInterval(notifTimer);
  notifTimer = setInterval(refreshBadges, 120000);
}

async function refreshBadges() {
  try {
    const n = await api.get('/notifications');
    const c = $('#notif-count');
    if (!c) return;
    c.textContent = n.count;
    c.classList.toggle('hidden', !n.count);
    const t = $('[data-badge="tasks"]');
    const tasks = n.overdue.length + n.today.length;
    if (t) { t.textContent = tasks; t.classList.toggle('hidden', !tasks); }
  } catch { /* silencioso */ }
}

function bindGlobalSearch() {
  const input = $('#gsearch');
  const box = $('#gresults');
  let focus = -1;
  const groups = { contacts: ['Contactos', 'contacts'], companies: ['Empresas', 'companies'], deals: ['Oportunidades', 'deals'], tickets: ['Tickets', 'tickets'] };
  const run = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { box.classList.add('hidden'); return; }
    try {
      const res = await api.get('/search', { q });
      const html = Object.entries(groups).map(([k, [label, path]]) => (res[k]?.length
        ? `<div class="group">${label}</div>${res[k].map((r) => `<a href="#/${path}/${r.id}"><div class="ellipsis">${esc(r.title)}</div><div class="small muted ellipsis">${esc(r.subtitle || '')}</div></a>`).join('')}`
        : '')).join('');
      box.innerHTML = html || '<div class="muted" style="padding:12px">Sin resultados</div>';
      focus = -1;
      box.classList.remove('hidden');
    } catch { /* */ }
  }, 200);
  input.addEventListener('input', run);
  input.addEventListener('focus', () => { if (input.value.trim().length >= 2) run(); });
  input.addEventListener('keydown', (e) => {
    const links = $$('a', box);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      focus = Math.max(0, Math.min(links.length - 1, focus + (e.key === 'ArrowDown' ? 1 : -1)));
      links.forEach((l, i) => l.classList.toggle('focus', i === focus));
    } else if (e.key === 'Enter' && links[focus]) { location.hash = links[focus].getAttribute('href'); input.blur(); }
    else if (e.key === 'Escape') { box.classList.add('hidden'); input.blur(); }
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.add('hidden'), 200));
  box.addEventListener('click', () => { input.value = ''; box.classList.add('hidden'); });
}

document.addEventListener('keydown', (e) => {
  if (e.key === '/' && !e.target.closest('input, textarea, select, [contenteditable]') && $('#gsearch')) {
    e.preventDefault();
    $('#gsearch').focus();
  }
});

function sessionFlag(key) {
  try {
    if (sessionStorage.getItem(key)) return true;
    sessionStorage.setItem(key, '1');
  } catch { /* sin almacenamiento */ }
  return false;
}

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

async function route() {
  if (!state.user) return;
  const { path, query } = parseHash();
  const view = $('#view');
  if (!view) return;
  if (typeof cleanup === 'function') { try { cleanup(); } catch { /* */ } }
  cleanup = null;
  $$('#modal-root > *').forEach((m) => m.remove());
  let match = null;
  let r;
  for (r of ROUTES) { match = path.match(r.path); if (match) break; }
  if (!match) { view.innerHTML = `<div class="empty"><h2>Página no encontrada</h2><p><a href="#/">Volver al panel</a></p></div>`; return; }
  if (path === '/' && state.license?.readOnly && state.license?.storeEnabled && state.user.role === 'admin' && !sessionFlag('buy_redirect')) {
    location.hash = '#/settings/license';
    return;
  }
  const navId = r.navFrom ? match[r.navFrom] : r.nav;
  $$('[data-nav]').forEach((a) => a.classList.toggle('active', a.dataset.nav === navId));
  if (r.feature && !hasFeature(r.feature)) {
    view.innerHTML = `<div class="card"><div class="empty">${icon('shield')}<h2>Función no incluida en tu plan</h2><p>Amplía tu licencia para acceder a este módulo.</p><a class="btn primary" href="#/settings/license">Ver licencia</a></div></div>`;
    return;
  }
  view.innerHTML = '<div class="muted" style="padding:20px">Cargando…</div>';
  try {
    const mod = await r.view();
    const fn = mod[r.fn || 'render'];
    const params = match.slice(1);
    cleanup = await fn(view, ...(r.args || []), ...params, query);
    window.scrollTo(0, 0);
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card"><div class="empty"><h2>No se pudo cargar</h2><p>${esc(err.message)}</p><a href="#/">Volver al panel</a></div></div>`;
  }
}

function logout() {
  auth.token = null;
  state.user = null;
  clearInterval(notifTimer);
  location.hash = '#/';
  start();
}

export async function afterLogin(token, user) {
  auth.token = token;
  state.user = user;
  await loadBase();
  renderShell();
  route();
}

export async function reloadShell() {
  await loadBase();
  state.license.seatsUsed = state.license.seatsUsed ?? 0;
  renderShell();
  route();
}

setUnauthorizedHandler(() => {
  if (!state.user) return;
  auth.token = null;
  state.user = null;
  start();
});

async function start() {
  applyTheme();
  try {
    const { needsSetup } = await api.get('/setup/status');
    if (needsSetup) { renderSetup($('#app'), afterLogin); return; }
    if (auth.token) {
      try {
        state.user = await api.get('/me');
        await loadBase();
        renderShell();
        route();
        return;
      } catch { auth.token = null; state.user = null; }
    }
    renderLogin($('#app'), afterLogin);
  } catch (err) {
    $('#app').innerHTML = `<div class="boot">No se puede conectar con el servidor: ${esc(err.message)}</div>`;
  }
}

window.addEventListener('hashchange', route);
export { isManager };
start();
