import { api } from '../api.js';
import {
  $, $$, esc, icon, L, opts, ownerCell, fdatetime, setTitle, toastError, isOverdue, activityIcon, today,
} from '../ui.js';
import { listView } from '../list.js';
import { openActivityForm } from './shared.js';

let mode = 'list';
let calMonth = null;

export function render(root, query = {}) {
  setTitle('Actividades');
  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Actividades</h1><div class="sub">Tareas, llamadas, reuniones y plazos</div></div>
      <div class="btn-group">
        <button class="btn ${mode === 'list' ? 'active' : ''}" data-mode="list">${icon('list')}<span class="hide-sm">Lista</span></button>
        <button class="btn ${mode === 'calendar' ? 'active' : ''}" data-mode="calendar">${icon('calendar')}<span class="hide-sm">Calendario</span></button>
      </div>
      <button class="btn primary" data-new>${icon('plus')}Nueva actividad</button>
    </div>
    <div data-body></div>`;
  const body = $('[data-body]', root);
  const draw = () => (mode === 'list' ? list(body, query) : calendar(body));
  $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; render(root, {}); }));
  $('[data-new]', root).addEventListener('click', async () => { if (await openActivityForm()) draw(); });
  if (query.new) openActivityForm().then((r) => r && draw());
  draw();
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
