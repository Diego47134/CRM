import { api } from '../api.js';
import {
  $, esc, icon, badge, L, opts, ownerCell, tagsHtml, fdatetime, ago, setTitle, listSetting, toast, toastError, dropdown,
} from '../ui.js';
import { listView } from '../list.js';
import { openTicketForm, deleteRecord, propsList, customProps, timeline, linkOrDash, mailto } from './shared.js';

export function render(root, query = {}) {
  const lv = listView(root, {
    title: 'Soporte',
    endpoint: '/tickets',
    singular: 'ticket',
    plural: 'tickets',
    newLabel: 'Nuevo ticket',
    searchPlaceholder: 'Buscar por asunto, cliente, email…',
    hasTags: true,
    emptyIcon: 'lifebuoy',
    filters: [
      { key: 'status', label: 'Estado', options: [['active', 'Activos (abiertos y pendientes)'], ...opts(L.ticketStatus)], default: 'active' },
      { key: 'priority', label: 'Prioridad', options: opts(L.priority) },
      { key: 'owner_id', label: 'Asignado', options: 'owner' },
      { key: 'category', label: 'Categoría', options: () => listSetting('ticket_categories').map((c) => [c, c]) },
    ],
    bulkFields: [
      { key: 'status', label: 'Estado', options: opts(L.ticketStatus) },
      { key: 'priority', label: 'Prioridad', options: opts(L.priority) },
    ],
    columns: [
      { label: '#', sort: 'created_at', cls: 'nowrap', render: (t) => `<span class="muted">#${t.id}</span>` },
      { label: 'Asunto', sort: 'subject', render: (t) => `<a href="#/tickets/${t.id}"><b>${esc(t.subject)}</b></a><div class="small muted">${esc(t.category || '')}${t.channel ? ` · ${esc(L.channel[t.channel] || t.channel)}` : ''}</div>` },
      { label: 'Cliente', render: (t) => (t.contact_id ? `<a href="#/contacts/${t.contact_id}">${esc(t.contact_name)}</a>` : '') + (t.company_name ? `<div class="small muted">${esc(t.company_name)}</div>` : '') },
      { label: 'Estado', sort: 'status', render: (t) => badge(L.ticketStatus, t.status) },
      { label: 'Prioridad', sort: 'priority', render: (t) => badge(L.priority, t.priority) },
      { label: 'Asignado', render: (t) => ownerCell(t.owner_id, t.owner_name) },
      { label: 'Actualizado', sort: 'updated_at', cls: 'nowrap', render: (t) => `<span class="small muted">${ago(t.updated_at)}</span>` },
    ],
    rowHref: (t) => `#/tickets/${t.id}`,
    onNew: () => openTicketForm(),
  });
  if (query.new) openTicketForm().then((r) => r && lv.reload());
}

export async function detail(root, id) {
  let t;
  try { t = await api.get(`/tickets/${id}`); } catch (err) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  setTitle(`#${t.id} ${t.subject}`);
  const custom = await customProps('tickets', t);
  root.innerHTML = `
    <div class="breadcrumb"><a href="#/tickets">Soporte</a> / #${t.id}</div>
    <div class="detail-head">
      <div class="grow"><h1>#${t.id} · ${esc(t.subject)}</h1>
        <div class="row" style="margin-top:6px">${badge(L.ticketStatus, t.status)} ${badge(L.priority, t.priority)} <span class="muted small">Abierto ${ago(t.created_at)}</span></div></div>
      <select data-status style="width:auto" aria-label="Estado">${opts(L.ticketStatus).map(([k, l]) => `<option value="${k}" ${k === t.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="btn" data-edit>${icon('edit')}Editar</button>
      <div class="dropdown"><button class="btn icon-only" data-more aria-label="Más">${icon('more')}</button></div>
    </div>
    <div class="grid detail">
      <div class="stack">
        <div class="card"><div class="card-head"><h3 class="grow">Detalles</h3></div>
          <div class="card-body">${propsList([
            ['Contacto', t.contact_id ? linkOrDash(`#/contacts/${t.contact_id}`, t.contact_name) : null],
            ['Email', mailto(t.contact_email)],
            ['Empresa', t.company_id ? linkOrDash(`#/companies/${t.company_id}`, t.company_name) : null],
            ['Asignado a', ownerCell(t.owner_id, t.owner_name)], ['Canal', esc(L.channel[t.channel] || '')],
            ['Categoría', esc(t.category || '')], ['Vencimiento', t.due_at ? fdatetime(t.due_at) : null],
            ['Resuelto', t.resolved_at ? fdatetime(t.resolved_at) : null], ['Etiquetas', tagsHtml(t.tags)], ...custom,
          ])}</div></div>
        ${t.description ? `<div class="card"><div class="card-head"><h3>Descripción</h3></div><div class="card-body" style="white-space:pre-wrap">${esc(t.description)}</div></div>` : ''}
      </div>
      <div data-timeline></div>
    </div>`;
  const defaults = {};
  if (t.contact_id) defaults.contact_id = t.contact_id;
  if (t.company_id) defaults.company_id = t.company_id;
  timeline($('[data-timeline]', root), { key: 'ticket_id', id: t.id, defaults });
  $('[data-status]', root).addEventListener('change', async (e) => {
    try { await api.patch(`/tickets/${t.id}`, { status: e.target.value }); toast('Estado actualizado', 'success'); detail(root, id); } catch (err) { toastError(err); }
  });
  $('[data-edit]', root).addEventListener('click', async () => { if (await openTicketForm(t)) detail(root, id); });
  dropdown($('[data-more]', root), `<button data-del>${icon('trash')}Eliminar ticket</button>`, (m) => {
    $('[data-del]', m).addEventListener('click', async () => { if (await deleteRecord('/tickets', t.id, `el ticket #${t.id}`)) location.hash = '#/tickets'; });
  });
}
