import { api } from '../api.js';
import {
  $, esc, icon, badge, L, opts, ownerCell, tagsHtml, fdate, ago, avatar, listSetting, setTitle, hasFeature, dropdown,
} from '../ui.js';
import { listView } from '../list.js';
import {
  openContactForm, openDealForm, openTicketForm, deleteRecord, propsList, customProps, timeline, relatedTable, dealColumns, quoteColumns,
  mailto, tel, linkOrDash,
} from './shared.js';

export function render(root, query = {}) {
  const lv = listView(root, {
    title: 'Contactos',
    endpoint: '/contacts',
    singular: 'contacto',
    plural: 'contactos',
    newLabel: 'Nuevo contacto',
    searchPlaceholder: 'Buscar por nombre, email, teléfono, empresa…',
    defaultSort: 'created_at',
    hasTags: true,
    emptyIcon: 'users',
    emptyText: 'Aún no hay contactos. Crea el primero o impórtalos desde un CSV.',
    headerActions: hasFeature('import_export') ? `<a class="btn" href="#/settings/import">${icon('upload')}<span class="hide-sm">Importar</span></a>` : '',
    filters: [
      { key: 'status', label: 'Estado', options: opts(L.contactStatus) },
      { key: 'owner_id', label: 'Responsable', options: 'owner' },
      { key: 'source', label: 'Origen', options: () => listSetting('contact_sources').map((s) => [s, s]) },
    ],
    bulkFields: [{ key: 'status', label: 'Cambiar estado', options: opts(L.contactStatus) }],
    columns: [
      { label: 'Nombre', sort: 'name', render: (r) => `<div class="row">${avatar(r.full_name)}<div class="grow" style="min-width:0"><a href="#/contacts/${r.id}"><b>${esc(r.full_name)}</b></a><div class="small muted ellipsis">${esc(r.job_title || '')}</div></div></div>` },
      { label: 'Empresa', sort: 'company', render: (r) => (r.company_id ? `<a href="#/companies/${r.company_id}">${esc(r.company_name)}</a>` : '<span class="muted">—</span>') },
      { label: 'Email', render: (r) => (r.email ? `<a href="mailto:${esc(r.email)}">${esc(r.email)}</a>` : '') },
      { label: 'Teléfono', render: (r) => esc(r.phone || r.mobile || '') },
      { label: 'Estado', sort: 'status', render: (r) => badge(L.contactStatus, r.status) },
      { label: 'Etiquetas', render: (r) => tagsHtml(r.tags) },
      { label: 'Responsable', sort: 'owner', render: (r) => ownerCell(r.owner_id, r.owner_name) },
      { label: 'Alta', sort: 'created_at', cls: 'nowrap', render: (r) => `<span class="muted small">${fdate(r.created_at)}</span>` },
    ],
    rowHref: (r) => `#/contacts/${r.id}`,
    onNew: () => openContactForm(),
  });
  if (query.new) openContactForm().then((r) => r && lv.reload());
}

export async function detail(root, id) {
  let c;
  try { c = await api.get(`/contacts/${id}`); } catch (err) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  setTitle(c.full_name);
  const [deals, quotes, tickets, custom] = await Promise.all([
    api.get('/deals', { contact_id: id, limit: 100 }),
    hasFeature('quotes') ? api.get('/quotes', { contact_id: id, limit: 50 }) : { data: [] },
    hasFeature('tickets') ? api.get('/tickets', { contact_id: id, limit: 50 }) : { data: [] },
    customProps('contacts', c),
  ]);

  root.innerHTML = `
    <div class="breadcrumb"><a href="#/contacts">Contactos</a> / ${esc(c.full_name)}</div>
    <div class="detail-head">
      ${avatar(c.full_name, null, 'lg')}
      <div class="grow">
        <h1>${esc(c.full_name)} ${badge(L.contactStatus, c.status)}</h1>
        <div class="muted">${esc([c.job_title, c.company_name].filter(Boolean).join(' · '))}</div>
      </div>
      ${c.email ? `<a class="btn" href="mailto:${esc(c.email)}">${icon('mail')}Email</a>` : ''}
      ${c.phone || c.mobile ? `<a class="btn" href="tel:${esc((c.phone || c.mobile).replace(/\s/g, ''))}">${icon('phone')}Llamar</a>` : ''}
      <button class="btn primary" data-new-deal>${icon('plus')}Oportunidad</button>
      <div class="dropdown"><button class="btn icon-only" data-more aria-label="Más acciones">${icon('more')}</button></div>
    </div>
    <div class="grid detail">
      <div class="stack">
        <div class="card"><div class="card-head"><h3 class="grow">Información</h3><button class="btn ghost sm" data-edit>${icon('edit')}Editar</button></div>
          <div class="card-body">${propsList([
            ['Email', mailto(c.email)], ['Teléfono', tel(c.phone)], ['Móvil', tel(c.mobile)],
            ['Empresa', c.company_id ? linkOrDash(`#/companies/${c.company_id}`, c.company_name) : null],
            ['Cargo', esc(c.job_title || '')], ['Origen', esc(c.source || '')], ['Puntuación', c.score ? `${c.score}/100` : null],
            ['Responsable', ownerCell(c.owner_id, c.owner_name)],
            ['Dirección', esc([c.address, c.postal_code, c.city, c.state, c.country].filter(Boolean).join(', '))],
            ['Cumpleaños', c.birthday ? fdate(c.birthday, { day: 'numeric', month: 'long' }) : null],
            ['LinkedIn', c.linkedin ? `<a href="${esc(c.linkedin)}" target="_blank" rel="noopener">Ver perfil</a>` : null],
            ['Emails', c.email_opt_out ? '<span class="badge red">No desea emails</span>' : null],
            ['Etiquetas', tagsHtml(c.tags)],
            ...custom,
            ['Creado', `${fdate(c.created_at)} <span class="muted small">(${ago(c.created_at)})</span>`],
          ])}
          ${c.description ? `<p class="small" style="white-space:pre-wrap;margin:14px 0 0">${esc(c.description)}</p>` : ''}</div></div>
        <div class="card"><div class="card-head"><h3 class="grow">Oportunidades (${deals.total})</h3></div>
          <div class="card-body flush">${relatedTable(deals.data, dealColumns.slice(0, 3), 'Sin oportunidades')}</div></div>
        ${hasFeature('quotes') ? `<div class="card"><div class="card-head"><h3 class="grow">Presupuestos</h3><a class="btn ghost sm" href="#/quotes/new?contact_id=${c.id}">${icon('plus')}Nuevo</a></div>
          <div class="card-body flush">${relatedTable(quotes.data, quoteColumns, 'Sin presupuestos')}</div></div>` : ''}
        ${hasFeature('tickets') ? `<div class="card"><div class="card-head"><h3 class="grow">Tickets</h3><button class="btn ghost sm" data-new-ticket>${icon('plus')}Nuevo</button></div>
          <div class="card-body flush">${relatedTable(tickets.data, [
            { label: 'Ticket', render: (t) => `<a href="#/tickets/${t.id}">#${t.id} ${esc(t.subject)}</a>` },
            { label: 'Estado', render: (t) => badge(L.ticketStatus, t.status) },
          ], 'Sin tickets')}</div></div>` : ''}
      </div>
      <div data-timeline></div>
    </div>`;

  timeline($('[data-timeline]', root), { key: 'contact_id', id: c.id, defaults: c.company_id ? { company_id: c.company_id } : {} });

  $('[data-edit]', root).addEventListener('click', async () => { if (await openContactForm(c)) detail(root, id); });
  $('[data-new-deal]', root).addEventListener('click', async () => {
    const d = await openDealForm({ contact_id: c.id, contact_name: c.full_name, company_id: c.company_id, company_name: c.company_name, title: c.company_name ? `${c.company_name} - ` : '' });
    if (d) location.hash = `#/deals/${d.id}`;
  });
  $('[data-new-ticket]', root)?.addEventListener('click', async () => {
    if (await openTicketForm({ contact_id: c.id, contact_name: c.full_name, company_id: c.company_id, company_name: c.company_name })) detail(root, id);
  });
  dropdown($('[data-more]', root), `<button data-del class="danger">${icon('trash')}Eliminar contacto</button>`, (m) => {
    $('[data-del]', m).addEventListener('click', async () => {
      if (await deleteRecord('/contacts', c.id, `el contacto «${c.full_name}»`)) location.hash = '#/contacts';
    });
  });
}
