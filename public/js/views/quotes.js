import { api } from '../api.js';
import {
  state, $, $$, esc, icon, badge, L, opts, fdate, moneyExact, money, setTitle, toast, toastError, confirmDialog, ownerCell,
  bindLookups, renderField, readForm, dropdown, isAdmin,
} from '../ui.js';
import { listView } from '../list.js';

const CFG = {
  quote: { title: 'Presupuestos', singular: 'Presupuesto', path: 'quotes', statuses: L.quoteStatus, icon: 'file' },
  invoice: { title: 'Facturas', singular: 'Factura', path: 'invoices', statuses: L.invoiceStatus, icon: 'receipt' },
};

export function render(root, kind) {
  const c = CFG[kind];
  setTitle(c.title);
  listView(root, {
    title: c.title,
    endpoint: `/quotes?kind=${kind}`,
    singular: c.singular.toLowerCase(),
    plural: c.title.toLowerCase(),
    newLabel: kind === 'invoice' ? 'Nueva factura' : 'Nuevo presupuesto',
    searchPlaceholder: 'Buscar por número, cliente…',
    bulk: false,
    emptyIcon: c.icon,
    filters: [
      { key: 'status', label: 'Estado', options: opts(c.statuses) },
      { key: 'owner_id', label: 'Responsable', options: 'owner' },
    ],
    subtitle: (st) => `total ${money(st.extra?.sum_total || 0)}`,
    columns: [
      { label: 'Número', sort: 'number', render: (q) => `<a href="#/${c.path}/${q.id}"><b>${esc(q.number)}</b></a><div class="small muted ellipsis" style="max-width:260px">${esc(q.title || '')}</div>` },
      { label: 'Cliente', render: (q) => esc(q.company_name || q.contact_name || '—') },
      { label: 'Fecha', sort: 'issue_date', cls: 'nowrap', render: (q) => fdate(q.issue_date) },
      { label: kind === 'invoice' ? 'Vencimiento' : 'Válido hasta', sort: 'due_date', cls: 'nowrap', render: (q) => `<span class="${kind === 'invoice' && ['sent', 'overdue'].includes(q.status) && q.due_date < new Date().toISOString().slice(0, 10) ? 'prio-high' : ''}">${fdate(q.due_date)}</span>` },
      { label: 'Estado', sort: 'status', render: (q) => badge(c.statuses, q.status) },
      { label: 'Total', sort: 'total', cls: 'num', render: (q) => `<b>${moneyExact(q.total, q.currency)}</b>` },
      { label: 'Responsable', render: (q) => ownerCell(q.owner_id, q.owner_name) },
    ],
    rowHref: (q) => `#/${c.path}/${q.id}`,
    onNew: () => { location.hash = `#/${c.path}/new`; },
    exportPath: `/quotes/export.csv?kind=${kind}`,
  });
}

const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
function calc(it) {
  const gross = (Number(it.quantity) || 0) * (Number(it.unit_price) || 0);
  const subtotal = r2(gross * (1 - (Number(it.discount_pct) || 0) / 100));
  const tax = r2(subtotal * ((Number(it.tax_rate) || 0) / 100));
  return { subtotal, tax, total: r2(subtotal + tax), discount: r2(gross - subtotal) };
}

export async function editor(root, path, idOrNew, query = {}) {
  const kind = path === 'invoices' ? 'invoice' : 'quote';
  const c = CFG[kind];
  let q;
  if (idOrNew === 'new') {
    q = { kind, status: 'draft', items: [], currency: state.settings.currency, owner_id: state.user.id };
    if (query.deal_id) {
      const d = await api.get(`/deals/${query.deal_id}`);
      Object.assign(q, { deal_id: d.id, deal_title: d.title, title: d.title, contact_id: d.contact_id, contact_name: d.contact_name, company_id: d.company_id, company_name: d.company_name });
    }
    if (query.contact_id) {
      const ct = await api.get(`/contacts/${query.contact_id}`);
      Object.assign(q, { contact_id: ct.id, contact_name: ct.full_name, company_id: ct.company_id, company_name: ct.company_name });
    }
    if (query.company_id) {
      const co = await api.get(`/companies/${query.company_id}`);
      Object.assign(q, { company_id: co.id, company_name: co.name });
    }
    q.items = [{ description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_rate: Number(state.settings.default_tax_rate || 21) }];
  } else {
    q = await api.get(`/quotes/${idOrNew}`);
  }
  if (q.kind !== kind) { location.hash = `#/${CFG[q.kind].path}/${q.id}`; return; }
  setTitle(q.number || `Nuevo ${c.singular.toLowerCase()}`);
  let items = q.items.map((it) => ({ ...it }));
  let dirty = false;

  const headFields = [
    { key: 'title', label: 'Título / concepto', full: true },
    { key: 'company_id', label: 'Empresa', type: 'lookup', entity: 'companies', labelKey: 'company_name' },
    { key: 'contact_id', label: 'Contacto', type: 'lookup', entity: 'contacts', labelKey: 'contact_name' },
    { key: 'deal_id', label: 'Oportunidad', type: 'lookup', entity: 'deals', labelKey: 'deal_title' },
    { key: 'owner_id', label: 'Responsable', type: 'owner' },
    { key: 'issue_date', label: 'Fecha de emisión', type: 'date' },
    { key: 'due_date', label: kind === 'invoice' ? 'Vencimiento' : 'Válido hasta', type: 'date' },
    { key: 'status', label: 'Estado', type: 'select', options: opts(c.statuses), required: true },
  ];
  const footFields = [
    { key: 'notes', label: 'Notas para el cliente', type: 'textarea' },
    { key: 'terms', label: 'Condiciones', type: 'textarea' },
  ];

  root.innerHTML = `
    <div class="breadcrumb"><a href="#/${c.path}">${c.title}</a> / ${esc(q.number || 'Nuevo')}</div>
    <div class="page-head">
      <div class="grow"><h1>${q.id ? `${c.singular} ${esc(q.number)}` : `Nuevo ${c.singular.toLowerCase()}`} ${q.id ? badge(c.statuses, q.status) : ''}</h1>
        ${q.source_quote_id ? `<div class="sub">Generada desde el presupuesto <a href="#/quotes/${q.source_quote_id}">#${q.source_quote_id}</a></div>` : ''}</div>
      ${q.id ? `<a class="btn" href="#/${c.path}/${q.id}/print">${icon('printer')}Ver / PDF</a>` : ''}
      ${q.id && kind === 'quote' ? `<button class="btn" data-convert>${icon('receipt')}Convertir en factura</button>` : ''}
      ${q.id ? `<div class="dropdown"><button class="btn icon-only" data-more aria-label="Más">${icon('more')}</button></div>` : ''}
      <button class="btn primary" data-save>${icon('check')}Guardar</button>
    </div>
    <form data-form novalidate>
      <div class="card" style="margin-bottom:16px"><div class="card-body"><div class="form-grid" style="grid-template-columns:repeat(4,minmax(0,1fr))">
        ${headFields.map((f) => renderField(f, q)).join('')}
      </div></div></div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h3 class="grow">Líneas</h3>
          <div class="lookup" data-lookup="products" style="width:300px;max-width:50vw"><input type="hidden"><input type="text" class="lookup-input" placeholder="Añadir producto del catálogo…" autocomplete="off"><button type="button" class="lookup-clear" aria-label="Quitar">×</button><div class="lookup-results hidden"></div></div>
          <button type="button" class="btn sm" data-add-line>${icon('plus')}Línea libre</button>
        </div>
        <div class="table-wrap"><table class="table items-table">
          <thead><tr><th style="width:40%">Descripción</th><th class="num" style="width:90px">Cant.</th><th class="num" style="width:120px">Precio</th><th class="num" style="width:80px">Dto. %</th><th class="num" style="width:80px">IVA %</th><th class="num" style="width:120px">Importe</th><th></th></tr></thead>
          <tbody data-lines></tbody>
        </table></div>
        <div class="card-body"><div class="totals" data-totals></div></div>
      </div>
      <div class="card"><div class="card-body"><div class="form-grid">${footFields.map((f) => renderField(f, q)).join('')}</div></div></div>
    </form>`;

  const form = $('[data-form]', root);
  bindLookups(root);

  function drawLines() {
    $('[data-lines]', root).innerHTML = items.map((it, i) => {
      const t = calc(it);
      return `<tr data-i="${i}">
        <td><textarea data-f="description" rows="1" placeholder="Descripción del producto o servicio">${esc(it.description)}</textarea></td>
        <td><input type="number" step="any" min="0" data-f="quantity" value="${esc(it.quantity)}" class="num"></td>
        <td><input type="number" step="any" data-f="unit_price" value="${esc(it.unit_price)}" class="num"></td>
        <td><input type="number" step="any" min="0" max="100" data-f="discount_pct" value="${esc(it.discount_pct)}" class="num"></td>
        <td><input type="number" step="any" min="0" max="100" data-f="tax_rate" value="${esc(it.tax_rate)}" class="num"></td>
        <td class="num" data-line-total>${moneyExact(t.subtotal, q.currency)}</td>
        <td class="actions"><button type="button" class="btn ghost sm icon-only" data-del-line="${i}" aria-label="Eliminar línea">${icon('trash')}</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">Añade productos o líneas libres</td></tr>';
    drawTotals();
  }

  function drawTotals() {
    let sub = 0; let tax = 0; let disc = 0;
    const byRate = {};
    for (const it of items) {
      const t = calc(it);
      sub += t.subtotal; tax += t.tax; disc += t.discount;
      byRate[it.tax_rate] = (byRate[it.tax_rate] || 0) + t.tax;
    }
    $('[data-totals]', root).innerHTML = `
      ${disc ? `<div><span>Descuentos</span><span>−${moneyExact(disc, q.currency)}</span></div>` : ''}
      <div><span>Base imponible</span><span>${moneyExact(sub, q.currency)}</span></div>
      ${Object.entries(byRate).filter(([, v]) => v).map(([rate, v]) => `<div><span>IVA ${rate}%</span><span>${moneyExact(v, q.currency)}</span></div>`).join('')}
      <div class="grand"><span>Total</span><span>${moneyExact(sub + tax, q.currency)}</span></div>`;
  }

  $('[data-lines]', root).addEventListener('input', (e) => {
    const el = e.target.closest('[data-f]');
    if (!el) return;
    const tr = el.closest('tr');
    const it = items[Number(tr.dataset.i)];
    it[el.dataset.f] = el.dataset.f === 'description' ? el.value : el.value;
    $('[data-line-total]', tr).textContent = moneyExact(calc(it).subtotal, q.currency);
    drawTotals();
    dirty = true;
  });
  $('[data-lines]', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-del-line]');
    if (b) { items.splice(Number(b.dataset.delLine), 1); drawLines(); dirty = true; }
  });
  $('[data-add-line]', root).addEventListener('click', () => {
    items.push({ description: '', quantity: 1, unit_price: 0, discount_pct: 0, tax_rate: Number(state.settings.default_tax_rate || 21) });
    drawLines();
    $$('[data-f="description"]', root).at(-1)?.focus();
  });
  const productBox = $('.card-head .lookup[data-lookup="products"]', root);
  productBox.addEventListener('lookup-change', (e) => {
    const p = e.detail;
    if (!p) return;
    const empty = items.findIndex((it) => !it.description && !Number(it.unit_price));
    const line = { product_id: p.id, description: p.name + (p.description ? `\n${p.description}` : ''), quantity: 1, unit_price: p.price, discount_pct: 0, tax_rate: p.tax_rate };
    if (empty >= 0) items[empty] = line; else items.push(line);
    productBox.setValue(null);
    drawLines();
    dirty = true;
  });
  form.addEventListener('input', () => { dirty = true; });
  // Al elegir contacto, rellenar empresa
  $('.lookup[data-lookup="contacts"]', form).addEventListener('lookup-change', (e) => {
    const ct = e.detail;
    const coBox = $('.lookup[data-lookup="companies"]', form);
    if (ct?.company_id && !$('input[type=hidden]', coBox).value) coBox.setValue({ id: ct.company_id, name: ct.company_name });
  });

  async function save() {
    const data = { ...readForm(form, [...headFields, ...footFields]), kind, items: items.filter((it) => String(it.description).trim()) };
    try {
      const saved = q.id ? await api.patch(`/quotes/${q.id}`, data) : await api.post('/quotes', data);
      dirty = false;
      toast(`${c.singular} guardado`, 'success');
      if (!q.id) location.hash = `#/${c.path}/${saved.id}`;
      else editor(root, path, saved.id);
      return saved;
    } catch (err) { toastError(err); return null; }
  }
  $('[data-save]', root).addEventListener('click', save);

  $('[data-convert]', root)?.addEventListener('click', async () => {
    if (dirty && !(await save())) return;
    if (!(await confirmDialog('Se creará una factura en borrador con las mismas líneas y el presupuesto se marcará como aceptado.', { title: 'Convertir en factura', okLabel: 'Crear factura', danger: false }))) return;
    try { const inv = await api.post(`/quotes/${q.id}/convert`); toast('Factura creada', 'success'); location.hash = `#/invoices/${inv.id}`; } catch (err) { toastError(err); }
  });
  if (q.id) {
    dropdown($('[data-more]', root), `
      <button data-dup>${icon('copy')}Duplicar</button>
      ${q.contact_email ? `<a href="mailto:${esc(q.contact_email)}?subject=${encodeURIComponent(`${c.singular} ${q.number}`)}">${icon('mail')}Enviar por email</a>` : ''}
      ${kind === 'invoice' && q.status !== 'paid' ? `<button data-paid>${icon('check')}Marcar como pagada</button>` : ''}
      ${kind === 'quote' || q.status === 'draft' || isAdmin() ? `<hr><button data-del>${icon('trash')}Eliminar</button>` : ''}`, (m) => {
      $('[data-dup]', m).addEventListener('click', async () => {
        try { const d = await api.post(`/quotes/${q.id}/duplicate`); toast('Duplicado', 'success'); location.hash = `#/${c.path}/${d.id}`; } catch (err) { toastError(err); }
      });
      $('[data-paid]', m)?.addEventListener('click', async () => {
        try { await api.patch(`/quotes/${q.id}`, { status: 'paid' }); toast('Factura marcada como pagada', 'success'); editor(root, path, q.id); } catch (err) { toastError(err); }
      });
      $('[data-del]', m)?.addEventListener('click', async () => {
        if (!(await confirmDialog(`¿Eliminar ${c.singular.toLowerCase()} ${q.number}?`))) return;
        try { await api.del(`/quotes/${q.id}`); location.hash = `#/${c.path}`; } catch (err) { toastError(err); }
      });
    });
  }

  drawLines();
  const beforeUnload = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  return () => window.removeEventListener('beforeunload', beforeUnload);
}

export async function print(root, path, id) {
  const q = await api.get(`/quotes/${id}`);
  const c = CFG[q.kind];
  const s = state.settings;
  setTitle(`${c.singular} ${q.number}`);
  const [company, contact] = await Promise.all([
    q.company_id ? api.get(`/companies/${q.company_id}`).catch(() => null) : null,
    q.contact_id ? api.get(`/contacts/${q.contact_id}`).catch(() => null) : null,
  ]);
  const byRate = {};
  for (const it of q.items) byRate[it.tax_rate] = (byRate[it.tax_rate] || 0) + it.tax;
  const client = company || contact;
  const addr = (o) => [o?.address, [o?.postal_code, o?.city].filter(Boolean).join(' '), o?.state, o?.country].filter(Boolean).map(esc).join('<br>');

  root.innerHTML = `
    <div class="row no-print" style="margin-bottom:16px">
      <a class="btn" href="#/${c.path}/${q.id}">${icon('left')}Volver</a><span class="spacer"></span>
      <span class="muted small">Usa «Guardar como PDF» en el diálogo de impresión</span>
      <button class="btn primary" data-print>${icon('printer')}Imprimir / PDF</button>
    </div>
    <div class="doc-print">
      <div class="doc-head">
        <div>
          ${s.company_logo ? `<img src="${esc(s.company_logo)}" alt="">` : `<h2 style="color:#111">${esc(s.company_name)}</h2>`}
          <div style="margin-top:8px;color:#444">${esc(s.company_name)}${s.company_tax_id ? `<br>${esc(s.company_tax_id)}` : ''}${s.company_address ? `<br>${esc(s.company_address).replace(/\n/g, '<br>')}` : ''}
          ${s.company_email ? `<br>${esc(s.company_email)}` : ''}${s.company_phone ? ` · ${esc(s.company_phone)}` : ''}</div>
        </div>
        <div style="text-align:right">
          <h1>${esc(c.singular.toUpperCase())}</h1>
          <div style="font-size:15px;font-weight:600;margin-top:4px">${esc(q.number)}</div>
          <div style="margin-top:8px;color:#444">Fecha: ${fdate(q.issue_date)}<br>${q.kind === 'invoice' ? 'Vencimiento' : 'Válido hasta'}: ${fdate(q.due_date)}</div>
        </div>
      </div>
      <div class="parties">
        <div><div class="label">Cliente</div>
          <b>${esc(company?.name || contact?.full_name || '—')}</b><br>
          ${company?.tax_id ? `${esc(company.tax_id)}<br>` : ''}${addr(client)}
          ${contact && company ? `<br>Att.: ${esc(contact.full_name)}` : ''}${contact?.email ? `<br>${esc(contact.email)}` : ''}
        </div>
        ${q.title ? `<div><div class="label">Concepto</div>${esc(q.title)}</div>` : ''}
      </div>
      <table>
        <thead><tr><th>Descripción</th><th class="num">Cant.</th><th class="num">Precio</th><th class="num">Dto.</th><th class="num">IVA</th><th class="num">Importe</th></tr></thead>
        <tbody>${q.items.map((it) => `<tr><td style="white-space:pre-wrap">${esc(it.description)}</td><td class="num">${esc(it.quantity)}</td><td class="num">${moneyExact(it.unit_price, q.currency)}</td><td class="num">${it.discount_pct ? `${it.discount_pct}%` : ''}</td><td class="num">${it.tax_rate}%</td><td class="num">${moneyExact(it.subtotal, q.currency)}</td></tr>`).join('')}</tbody>
      </table>
      <div class="totals">
        ${q.discount_total ? `<div><span>Descuentos</span><span>−${moneyExact(q.discount_total, q.currency)}</span></div>` : ''}
        <div><span>Base imponible</span><span>${moneyExact(q.subtotal, q.currency)}</span></div>
        ${Object.entries(byRate).filter(([, v]) => v).map(([rate, v]) => `<div><span>IVA ${rate}%</span><span>${moneyExact(v, q.currency)}</span></div>`).join('')}
        <div class="grand"><span>Total</span><span>${moneyExact(q.total, q.currency)}</span></div>
      </div>
      ${q.notes ? `<div style="margin-top:28px"><div class="label">Notas</div><div style="white-space:pre-wrap">${esc(q.notes)}</div></div>` : ''}
      ${q.terms ? `<div style="margin-top:18px"><div class="label">Condiciones</div><div style="white-space:pre-wrap;color:#444">${esc(q.terms)}</div></div>` : ''}
      ${q.kind === 'quote' ? '<div style="margin-top:48px;display:flex;justify-content:flex-end"><div style="border-top:1px solid #999;width:240px;padding-top:6px;text-align:center;color:#666">Firma y fecha de aceptación</div></div>' : ''}
    </div>`;
  $('[data-print]', root).addEventListener('click', () => window.print());
}
