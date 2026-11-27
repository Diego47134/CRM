import { api } from '../api.js';
import {
  $, $$, esc, icon, L, opts, ownerCell, fdatetime, setTitle, toast, toastError, isOverdue, activityIcon, today,
} from '../ui.js';
import { listView } from '../list.js';
import { openActivityForm } from './shared.js';

let mode = 'board';
let calMonth = null;

const STATUS = [
  ['todo', 'Por hacer', 'var(--series-1)'],
  ['doing', 'En curso', 'var(--series-4)'],
  ['done', 'Hecho', 'var(--good)'],
];

export function render(root, query = {}) {
  setTitle('Tareas');
  if (query.when) mode = 'list';
  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Tareas</h1><div class="sub">Tu trabajo con cada cliente: tareas, llamadas, reuniones y plazos</div></div>
      <div class="btn-group">
        <button class="btn ${mode === 'board' ? 'active' : ''}" data-mode="board">${icon('kanban')}<span class="hide-sm">Tablero</span></button>
        <button class="btn ${mode === 'list' ? 'active' : ''}" data-mode="list">${icon('list')}<span class="hide-sm">Lista</span></button>
        <button class="btn ${mode === 'calendar' ? 'active' : ''}" data-mode="calendar">${icon('calendar')}<span class="hide-sm">Calendario</span></button>
      </div>
      <button class="btn primary" data-new>${icon('plus')}Nueva tarea</button>
    </div>
    <div data-body></div>`;
  const body = $('[data-body]', root);
  const draw = () => (mode === 'board' ? board(body) : mode === 'list' ? list(body, query) : calendar(body));
  $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(root, {}); }));
  $('[data-new]', root).addEventListener('click', async () => { if (await openActivityForm({ status: 'todo' })) draw(); });
  if (query.new) openActivityForm({ status: 'todo' }).then((r) => r && draw());
  draw();
}

// ---------------- Tablero de trabajo: Por hacer → En curso → Hecho ----------------
async function board(body) {
  let ownerSel = 'me';
  try { ownerSel = sessionStorage.getItem('tasks_owner') ?? 'me'; } catch { /* sin almacenamiento */ }
  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:12px">
      <input type="search" data-q placeholder="Filtrar por tarea o cliente…" style="max-width:280px">
      <select data-owner style="width:auto" aria-label="Responsable">
        <option value="me" ${ownerSel === 'me' ? 'selected' : ''}>Mis tareas</option>
        <option value="" ${ownerSel === '' ? 'selected' : ''}>Todo el equipo</option>
      </select>
      <span class="muted small">Arrastra las tarjetas para cambiar su estado. «Hecho» muestra las últimas 2 semanas.</span>
    </div>
    <div class="kanban" data-kanban></div>`;
  const kanban = $('[data-kanban]', body);
  let tasks = [];

  async function load() {
    try {
      const res = await api.get('/activities', { board: 14, limit: 500, owner_id: $('[data-owner]', body).value, q: $('[data-q]', body).value });
      tasks = res.data;
      draw();
    } catch (err) { toastError(err); }
  }

  const client = (a) => a.company_name || a.contact_name || '';
  const card = (a) => {
    const late = isOverdue(a.due_at, a.done);
    const done = a.status === 'done';
    return `<article class="kcard" draggable="true" data-task="${a.id}" style="${done ? 'opacity:.7' : ''}">
      <div class="row" style="align-items:flex-start;gap:6px">${icon(activityIcon(a.type))}
        <span class="title grow" style="${done ? 'text-decoration:line-through' : ''}">${esc(a.subject)}</span>
        ${a.priority === 'high' ? '<span class="badge red" title="Prioridad alta">!</span>' : ''}</div>
      ${client(a)
        ? `<div class="meta"><a href="#/${a.company_id ? 'companies' : 'contacts'}/${a.company_id || a.contact_id}">${esc(client(a))}</a>${a.deal_title ? ` · ${esc(a.deal_title)}` : ''}</div>`
        : '<div class="meta muted">Sin cliente · haz clic para asignarlo</div>'}
      ${a.due_at ? `<div class="meta ${late ? 'late' : ''}" style="margin-top:4px">${icon('clock')} ${esc(fdatetime(a.due_at))}</div>` : ''}
    </article>`;
  };

  function draw() {
    kanban.innerHTML = STATUS.map(([key, label, color]) => {
      const items = tasks.filter((a) => a.status === key)
        .sort((x, y) => (x.position - y.position) || String(x.due_at || '9').localeCompare(String(y.due_at || '9')) || x.id - y.id);
      return `<section class="kcol" data-status="${key}">
        <div class="kcol-head"><div class="name"><span class="dot" style="background:${color}"></span><span class="grow">${label}</span><span class="badge">${items.length}</span></div></div>
        <div class="kcol-body">
          ${key === 'todo' ? '<form data-quick><input type="text" name="subject" placeholder="+ Nueva tarea (Enter)" aria-label="Nueva tarea rápida"></form>' : ''}
          ${items.map(card).join('') || '<div class="muted small" style="padding:8px;text-align:center">Suelta aquí</div>'}
        </div></section>`;
    }).join('');
    $('[data-quick]', kanban)?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const subject = e.target.subject.value.trim();
      if (!subject) return;
      try {
        const first = tasks.filter((t) => t.status === 'todo').reduce((m, t) => Math.min(m, t.position), 0);
        tasks.push(await api.post('/activities', { subject, type: 'task', status: 'todo', position: first - 1 }));
        draw();
        $('[data-quick] input', kanban)?.focus();
      } catch (err) { toastError(err); }
    });
  }

  let dragId = null;
  kanban.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.kcard');
    if (!c) return;
    dragId = Number(c.dataset.task);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  kanban.addEventListener('dragend', (e) => {
    e.target.closest('.kcard')?.classList.remove('dragging');
    $$('.kcol.drop', kanban).forEach((c) => c.classList.remove('drop'));
  });
  kanban.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kcol');
    if (!col) return;
    e.preventDefault();
    $$('.kcol.drop', kanban).forEach((c) => c !== col && c.classList.remove('drop'));
    col.classList.add('drop');
  });
  kanban.addEventListener('drop', async (e) => {
    const col = e.target.closest('.kcol');
    if (!col || !dragId) return;
    e.preventDefault();
    col.classList.remove('drop');
    const task = tasks.find((t) => t.id === dragId);
    dragId = null;
    if (!task) return;
    const status = col.dataset.status;
    const others = tasks.filter((t) => t.status === status && t.id !== task.id).sort((a, b) => a.position - b.position);
    const over = e.target.closest('.kcard');
    let position;
    if (over && Number(over.dataset.task) !== task.id) {
      const idx = others.findIndex((t) => t.id === Number(over.dataset.task));
      position = idx > 0 ? (others[idx - 1].position + others[idx].position) / 2 : others[idx].position - 1;
    } else position = (others.at(-1)?.position ?? 0) + 1;
    try {
      Object.assign(task, await api.patch(`/activities/${task.id}`, { status, position }));
      draw();
      if (status === 'done') toast('✔ Tarea hecha', 'success');
    } catch (err) { toastError(err); }
  });
  kanban.addEventListener('click', async (e) => {
    const c = e.target.closest('.kcard');
    if (!c || e.target.closest('a')) return;
    const a = tasks.find((t) => t.id === Number(c.dataset.task));
    if (a && await openActivityForm(a)) load();
  });

  $('[data-owner]', body).addEventListener('change', (e) => {
    try { sessionStorage.setItem('tasks_owner', e.target.value); } catch { /* sin almacenamiento */ }
    load();
  });
  let t;
  $('[data-q]', body).addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}

function list(body, query) {
  const lv = listView(body, {
    embedded: true,
    endpoint: '/activities',
    defaultSort: '',
    memoryKey: 'acts',
    fixedFilters: query.when ? { when: query.when, done: '0' } : {},
    filters: [
      { key: 'when', label: 'Cuándo', options: [['overdue', 'Vencidas'], ['today', 'Hoy'], ['upcoming', 'Próximas'], ['nodate', 'Sin fecha']] },
      { key: 'done', label: 'Estado', options: [['0', 'Pendientes'], ['1', 'Completadas']], default: '0' },
      { key: 'type', label: 'Tipo', options: opts(L.activityType) },
      { key: 'owner_id', label: 'Responsable', options: 'owner', default: 'me' },
    ],
    bulkFields: [{ key: 'done', label: 'Marcar', options: [['1', 'Completada'], ['0', 'Pendiente']] }],
    columns: [
      { label: '', render: (a) => `<input type="checkbox" data-row-action="toggle" ${a.done ? 'checked' : ''} aria-label="Completada">` },
      { label: 'Asunto', sort: 'subject', render: (a) => `<div class="row">${icon(activityIcon(a.type))}<div><b style="${a.done ? 'text-decoration:line-through;opacity:.6' : ''}">${esc(a.subject)}</b><div class="small muted">${esc(L.activityType[a.type])}${a.priority === 'high' ? ' · <span class="prio-high">Prioridad alta</span>' : ''}</div></div></div>` },
      { label: 'Fecha', sort: 'due_at', cls: 'nowrap', render: (a) => `<span class="${isOverdue(a.due_at, a.done) ? 'prio-high' : ''}">${a.due_at ? fdatetime(a.due_at) : '<span class="muted">Sin fecha</span>'}</span>` },
      { label: 'Relacionado con', render: (a) => [
        a.contact_id ? `<a href="#/contacts/${a.contact_id}">${esc(a.contact_name)}</a>` : '',
        a.deal_id ? `<a href="#/deals/${a.deal_id}">${esc(a.deal_title)}</a>` : '',
        a.company_id && !a.contact_id ? `<a href="#/companies/${a.company_id}">${esc(a.company_name)}</a>` : '',
        a.ticket_id ? `<a href="#/tickets/${a.ticket_id}">#${a.ticket_id}</a>` : '',
      ].filter(Boolean).join(' · ') || '<span class="muted">—</span>' },
      { label: 'Responsable', sort: 'owner', render: (a) => ownerCell(a.owner_id, a.owner_name) },
    ],
    rowActions: () => `<button class="btn ghost sm icon-only" data-row-action="edit" aria-label="Editar">${icon('edit')}</button>`,
    onRowAction: async (action, a) => {
      if (action === 'toggle') {
        try { await api.patch(`/activities/${a.id}`, { done: !a.done }); return true; } catch (err) { toastError(err); return true; }
      }
      if (action === 'edit') return openActivityForm(a);
      return false;
    },
    onRowClick: (a) => openActivityForm(a),
  });
  return lv;
}

async function calendar(body) {
  const now = new Date();
  if (!calMonth) calMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = calMonth.getFullYear();
  const m = calMonth.getMonth();
  const first = new Date(y, m, 1);
  const startOffset = (first.getDay() + 6) % 7; // lunes = 0
  const start = new Date(y, m, 1 - startOffset);
  const days = [];
  for (let i = 0; i < 42; i++) days.push(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
  const key = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const ownerSel = body.querySelector('[data-cal-owner]')?.value ?? 'me';

  let acts = [];
  try {
    const res = await api.get('/activities', { due_at_from: key(days[0]), due_at_to: key(days[41]), limit: 500, owner_id: ownerSel, sort: 'due_at', dir: 'asc' });
    acts = res.data;
  } catch (err) { toastError(err); }

  const monthName = calMonth.toLocaleDateString('es-ES', { month: 'long' });
  const title = `${monthName[0].toUpperCase()}${monthName.slice(1)} ${y}`;
  body.innerHTML = `
    <div class="card">
      <div class="toolbar">
        <button class="btn sm icon-only" data-prev aria-label="Mes anterior">${icon('left')}</button>
        <button class="btn sm" data-today>Hoy</button>
        <button class="btn sm icon-only" data-next aria-label="Mes siguiente">${icon('right')}</button>
        <h2 style="margin-left:8px">${esc(title)}</h2>
        <span class="spacer"></span>
        <select data-cal-owner style="width:auto"><option value="me" ${ownerSel === 'me' ? 'selected' : ''}>Mis actividades</option><option value="" ${ownerSel === '' ? 'selected' : ''}>Todo el equipo</option></select>
      </div>
      <div class="cal">
        ${['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map((d) => `<div class="dow">${d}</div>`).join('')}
        ${days.map((d) => {
          const k = key(d);
          const items = acts.filter((a) => a.due_at?.slice(0, 10) === k);
          return `<div class="day ${d.getMonth() !== m ? 'other' : ''} ${k === today() ? 'today' : ''}" data-day="${k}">
            <span class="dnum">${d.getDate()}</span>
            ${items.slice(0, 4).map((a) => `<button class="ev ${a.type} ${a.done ? 'done' : ''}" data-ev="${a.id}" title="${esc(a.subject)}">${esc(a.due_at.slice(11, 16))} ${esc(a.subject)}</button>`).join('')}
            ${items.length > 4 ? `<span class="small muted">+${items.length - 4} más</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    </div>
    <p class="small muted">Haz doble clic en un día para crear una actividad.</p>`;

  $('[data-prev]', body).addEventListener('click', () => { calMonth = new Date(y, m - 1, 1); calendar(body); });
  $('[data-next]', body).addEventListener('click', () => { calMonth = new Date(y, m + 1, 1); calendar(body); });
  $('[data-today]', body).addEventListener('click', () => { calMonth = new Date(now.getFullYear(), now.getMonth(), 1); calendar(body); });
  $('[data-cal-owner]', body).addEventListener('change', () => calendar(body));
  body.querySelector('.cal').addEventListener('click', async (e) => {
    const ev = e.target.closest('[data-ev]');
    if (ev) { const a = acts.find((x) => x.id === Number(ev.dataset.ev)); if (await openActivityForm(a)) calendar(body); }
  });
  body.querySelector('.cal').addEventListener('dblclick', async (e) => {
    const day = e.target.closest('[data-day]');
    if (day && !e.target.closest('[data-ev]')) { if (await openActivityForm({ due_at: `${day.dataset.day}T10:00` })) calendar(body); }
  });
}
