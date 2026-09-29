import { api } from '../api.js';
import {
  $, esc, icon, badge, L, ownerCell, tagsHtml, fdate, avatar, listSetting, setTitle, money, num, hasFeature, dropdown,
} from '../ui.js';
import { listView } from '../list.js';
import {
  openCompanyForm, openContactForm, openDealForm, deleteRecord, propsList, customProps, timeline, relatedTable, dealColumns, quoteColumns, mailto, tel,
} from './shared.js';

export function render(root, query = {}) {
  const lv = listView(root, {
    title: 'Empresas',
    endpoint: '/companies',
    singular: 'empresa',
    plural: 'empresas',
    newLabel: 'Nueva empresa',
    searchPlaceholder: 'Buscar por nombre, CIF, ciudad…',
    defaultSort: 'name',
    defaultDir: 'asc',
    hasTags: true,
    emptyIcon: 'building',
    headerActions: hasFeature('import_export') ? `<a class="btn" href="#/settings/import">${icon('upload')}<span class="hide-sm">Importar</span></a>` : '',
    filters: [
      { key: 'industry', label: 'Sector', options: () => listSetting('industries').map((s) => [s, s]) },
      { key: 'owner_id', label: 'Responsable', options: 'owner' },
    ],
    bulkFields: [{ key: 'industry', label: 'Cambiar sector', options: listSetting('industries').map((s) => [s, s]) }],
    columns: [
      { label: 'Empresa', sort: 'name', render: (r) => `<div class="row">${avatar(r.name, 'var(--series-7)')}<div style="min-width:0"><a href="#/companies/${r.id}"><b>${esc(r.name)}</b></a><div class="small muted ellipsis">${esc(r.website?.replace(/^https?:\/\//, '') || '')}</div></div></div>` },
      { label: 'Sector', sort: 'industry', render: (r) => esc(r.industry || '') },
      { label: 'Ciudad', sort: 'city', render: (r) => esc(r.city || '') },
      { label: 'Contactos', cls: 'num', render: (r) => num(r.contacts_count) },
      { label: 'Embudo abierto', sort: 'open_deals_value', cls: 'num', render: (r) => (r.open_deals_value ? money(r.open_deals_value) : '<span class="muted">—</span>') },
      { label: 'Etiquetas', render: (r) => tagsHtml(r.tags) },
      { label: 'Responsable', sort: 'owner', render: (r) => ownerCell(r.owner_id, r.owner_name) },
    ],
    rowHref: (r) => `#/companies/${r.id}`,
    onNew: () => openCompanyForm(),
  });
  if (query.new) openCompanyForm().then((r) => r && lv.reload());
}

export async function detail(root, id) {
  let c;
  try { c = await api.get(`/companies/${id}`); } catch (err) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  setTitle(c.name);
  const [contacts, deals, quotes, tickets, custom] = await Promise.all([
    api.get('/contacts', { company_id: id, limit: 100, sort: 'name', dir: 'asc' }),
    api.get('/deals', { company_id: id, limit: 100 }),
    hasFeature('quotes') ? api.get('/quotes', { company_id: id, limit: 50 }) : { data: [] },
    hasFeature('tickets') ? api.get('/tickets', { company_id: id, limit: 50 }) : { data: [] },
    customProps('companies', c),
  ]);
  const won = deals.data.filter((d) => d.status === 'won').reduce((s, d) => s + d.value, 0);

  root.innerHTML = `
    <div class="breadcrumb"><a href="#/companies">Empresas</a> / ${esc(c.name)}</div>
    <div class="detail-head">
      ${avatar(c.name, 'var(--series-7)', 'lg')}
      <div class="grow"><h1>${esc(c.name)}</h1><div class="muted">${esc([c.industry, c.city].filter(Boolean).join(' · '))}</div></div>
      ${c.website ? `<a class="btn" href="${esc(c.website)}" target="_blank" rel="noopener">${icon('external')}Web</a>` : ''}
      <button class="btn" data-new-contact>${icon('plus')}Contacto</button>
      <button class="btn primary" data-new-deal>${icon('plus')}Oportunidad</button>
      <div class="dropdown"><button class="btn icon-only" data-more aria-label="Más acciones">${icon('more')}</button></div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Contactos</div><div class="value">${num(contacts.total)}</div></div>
      <div class="card kpi"><div class="label">Oportunidades abiertas</div><div class="value">${money(c.open_deals_value)}</div></div>
      <div class="card kpi"><div class="label">Ganado histórico</div><div class="value">${money(won)}</div></div>
      <div class="card kpi"><div class="label">Tickets</div><div class="value">${num(tickets.data.filter((t) => ['open', 'pending'].includes(t.status)).length)}</div><div class="foot">abiertos</div></div>
    </div>
    <div class="grid detail">
      <div class="stack">
        <div class="card"><div class="card-head"><h3 class="grow">Información</h3><button class="btn ghost sm" data-edit>${icon('edit')}Editar</button></div>
          <div class="card-body">${propsList([
            ['CIF/NIF', esc(c.tax_id || '')], ['Email', mailto(c.email)], ['Teléfono', tel(c.phone)],
            ['Web', c.website ? `<a href="${esc(c.website)}" target="_blank" rel="noopener">${esc(c.website.replace(/^https?:\/\//, ''))}</a>` : null],
            ['Sector', esc(c.industry || '')], ['Empleados', c.employees ? num(c.employees) : null],
            ['Facturación', c.annual_revenue ? money(c.annual_revenue) : null],
            ['Dirección', esc([c.address, c.postal_code, c.city, c.state, c.country].filter(Boolean).join(', '))],
            ['Responsable', ownerCell(c.owner_id, c.owner_name)], ['Etiquetas', tagsHtml(c.tags)], ...custom,
            ['Creada', fdate(c.created_at)],
          ])}
          ${c.description ? `<p class="small" style="white-space:pre-wrap;margin:14px 0 0">${esc(c.description)}</p>` : ''}</div></div>
        <div class="card"><div class="card-head"><h3 class="grow">Contactos (${contacts.total})</h3></div>
          <div class="card-body flush">${relatedTable(contacts.data, [
            { label: 'Nombre', render: (p) => `<a href="#/contacts/${p.id}">${esc(p.full_name)}</a><div class="small muted">${esc(p.job_title || '')}</div>` },
            { label: 'Estado', render: (p) => badge(L.contactStatus, p.status) },
          ], 'Sin contactos')}</div></div>
        <div class="card"><div class="card-head"><h3 class="grow">Oportunidades (${deals.total})</h3></div>
          <div class="card-body flush">${relatedTable(deals.data, dealColumns.slice(0, 3), 'Sin oportunidades')}</div></div>
        ${hasFeature('quotes') ? `<div class="card"><div class="card-head"><h3 class="grow">Presupuestos y facturas</h3><a class="btn ghost sm" href="#/quotes/new?company_id=${c.id}">${icon('plus')}Presupuesto</a></div>
          <div class="card-body flush">${relatedTable(quotes.data, quoteColumns, 'Sin presupuestos')}</div></div>` : ''}
      </div>
      <div data-timeline></div>
    </div>`;

  timeline($('[data-timeline]', root), { key: 'company_id', id: c.id });
  $('[data-edit]', root).addEventListener('click', async () => { if (await openCompanyForm(c)) detail(root, id); });
  $('[data-new-contact]', root).addEventListener('click', async () => { if (await openContactForm({ company_id: c.id, company_name: c.name })) detail(root, id); });
  $('[data-new-deal]', root).addEventListener('click', async () => {
    const d = await openDealForm({ company_id: c.id, company_name: c.name, title: `${c.name} - ` });
    if (d) location.hash = `#/deals/${d.id}`;
  });
  dropdown($('[data-more]', root), `<button data-del>${icon('trash')}Eliminar empresa</button>`, (m) => {
    $('[data-del]', m).addEventListener('click', async () => {
      if (await deleteRecord('/companies', c.id, `la empresa «${c.name}» (sus contactos se conservarán sin empresa)`)) location.hash = '#/companies';
    });
  });
}
