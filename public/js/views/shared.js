import { api } from '../api.js';
import {
  state, $, $$, esc, icon, formModal, withCustomFields, opts, L, listSetting, fdatetime, ago, avatar, activityIcon,
  toast, toastError, confirmDialog, isOverdue, money, badge, today,
} from '../ui.js';

// ---------------- Definiciones de formularios ----------------
export const contactFields = () => [
  { key: 'first_name', label: 'Nombre', required: true },
  { key: 'last_name', label: 'Apellidos' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Teléfono', type: 'tel' },
  { key: 'mobile', label: 'Móvil', type: 'tel' },
  { key: 'job_title', label: 'Cargo' },
  { key: 'company_id', label: 'Empresa', type: 'lookup', entity: 'companies', labelKey: 'company_name' },
  { key: 'status', label: 'Estado', type: 'select', options: opts(L.contactStatus), default: 'lead', required: true },
  { key: 'source', label: 'Origen', type: 'datalist', options: () => listSetting('contact_sources') },
  { key: 'owner_id', label: 'Responsable', type: 'owner' },
  { key: 'score', label: 'Puntuación (0-100)', type: 'number', min: 0, max: 100 },
  { key: 'tags', label: 'Etiquetas', placeholder: 'vip, newsletter…' },
  { type: 'section', label: 'Dirección y otros' },
  { key: 'address', label: 'Dirección', full: true },
  { key: 'city', label: 'Ciudad' },
  { key: 'state', label: 'Provincia' },
  { key: 'postal_code', label: 'Código postal' },
  { key: 'country', label: 'País' },
  { key: 'birthday', label: 'Cumpleaños', type: 'date' },
  { key: 'linkedin', label: 'LinkedIn', type: 'url' },
  { key: 'email_opt_out', label: 'No desea recibir emails', type: 'checkbox' },
  { key: 'description', label: 'Descripción', type: 'textarea' },
];

export const companyFields = () => [
  { key: 'name', label: 'Nombre', required: true, full: true },
  { key: 'industry', label: 'Sector', type: 'datalist', options: () => listSetting('industries') },
  { key: 'tax_id', label: 'CIF/NIF' },
  { key: 'website', label: 'Web', type: 'url' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'phone', label: 'Teléfono', type: 'tel' },
  { key: 'owner_id', label: 'Responsable', type: 'owner' },
  { key: 'employees', label: 'Empleados', type: 'number', min: 0 },
  { key: 'annual_revenue', label: 'Facturación anual', type: 'number', min: 0 },
  { key: 'tags', label: 'Etiquetas', full: true },
  { type: 'section', label: 'Dirección' },
  { key: 'address', label: 'Dirección', full: true },
  { key: 'city', label: 'Ciudad' },
  { key: 'state', label: 'Provincia' },
  { key: 'postal_code', label: 'Código postal' },
  { key: 'country', label: 'País' },
  { key: 'description', label: 'Descripción', type: 'textarea' },
];

export const stageOptions = (pipelineId) => {
  const p = state.pipelines.find((x) => x.id === Number(pipelineId)) || state.pipelines[0];
  return (p?.stages || []).map((s) => [String(s.id), `${s.name} (${s.probability}%)`]);
};

export const dealFields = (values = {}) => [
  { key: 'title', label: 'Título', required: true, full: true },
  { key: 'value', label: `Importe (${state.settings.currency || 'EUR'})`, type: 'number', min: 0, default: 0 },
  { key: 'expected_close', label: 'Cierre previsto', type: 'date' },
  { key: 'pipeline_id', label: 'Embudo', type: 'select', options: state.pipelines.map((p) => [String(p.id), p.name]), required: true, ref: true },
  { key: 'stage_id', label: 'Etapa', type: 'select', options: stageOptions(values.pipeline_id || state.pipelines[0]?.id), required: true, ref: true },
  { key: 'contact_id', label: 'Contacto', type: 'lookup', entity: 'contacts', labelKey: 'contact_name' },
  { key: 'company_id', label: 'Empresa', type: 'lookup', entity: 'companies', labelKey: 'company_name' },
  { key: 'owner_id', label: 'Responsable', type: 'owner' },
  { key: 'priority', label: 'Prioridad', type: 'select', options: [['low', 'Baja'], ['normal', 'Normal'], ['high', 'Alta']], default: 'normal', required: true },
  { key: 'source', label: 'Origen', type: 'datalist', options: () => listSetting('contact_sources') },
  { key: 'tags', label: 'Etiquetas' },
  { key: 'description', label: 'Descripción', type: 'textarea' },
];

export const activityFields = () => [
  { key: 'type', label: 'Tipo', type: 'select', options: opts(L.activityType), default: 'task', required: true },
  { key: 'priority', label: 'Prioridad', type: 'select', options: [['low', 'Baja'], ['normal', 'Normal'], ['high', 'Alta']], default: 'normal', required: true },
  { key: 'subject', label: 'Asunto', required: true, full: true },
  { key: 'due_at', label: 'Fecha y hora', type: 'datetime' },
  { key: 'duration_min', label: 'Duración (minutos)', type: 'number', min: 0 },
  { key: 'owner_id', label: 'Responsable', type: 'owner' },
  { key: 'done', label: 'Completada', type: 'checkbox' },
  { key: 'contact_id', label: 'Contacto', type: 'lookup', entity: 'contacts', labelKey: 'contact_name' },
  { key: 'company_id', label: 'Empresa', type: 'lookup', entity: 'companies', labelKey: 'company_name' },
  { key: 'deal_id', label: 'Oportunidad', type: 'lookup', entity: 'deals', labelKey: 'deal_title' },
  { key: 'description', label: 'Descripción / notas', type: 'textarea' },
];

export const ticketFields = () => [
  { key: 'subject', label: 'Asunto', required: true, full: true },
  { key: 'status', label: 'Estado', type: 'select', options: opts(L.ticketStatus), default: 'open', required: true },
  { key: 'priority', label: 'Prioridad', type: 'select', options: opts(L.priority), default: 'normal', required: true },
  { key: 'channel', label: 'Canal', type: 'select', options: opts(L.channel) },
  { key: 'category', label: 'Categoría', type: 'datalist', options: () => listSetting('ticket_categories') },
  { key: 'contact_id', label: 'Contacto', type: 'lookup', entity: 'contacts', labelKey: 'contact_name' },
  { key: 'company_id', label: 'Empresa', type: 'lookup', entity: 'companies', labelKey: 'company_name' },
  { key: 'owner_id', label: 'Asignado a', type: 'owner' },
  { key: 'due_at', label: 'Vencimiento', type: 'datetime' },
  { key: 'tags', label: 'Etiquetas', full: true },
  { key: 'description', label: 'Descripción', type: 'textarea', rows: 5 },
];

// ---------------- Modales de alta / edición ----------------
async function saveRecord(path, id, data) {
  return id ? api.patch(`${path}/${id}`, data) : api.post(path, data);
}

export async function openContactForm(values = {}) {
  const fields = await withCustomFields('contacts', contactFields());
  return formModal({
    title: values.id ? 'Editar contacto' : 'Nuevo contacto', fields, values, size: 'wide',
    onSubmit: async (data) => {
      const r = await saveRecord('/contacts', values.id, data);
      toast(values.id ? 'Contacto actualizado' : 'Contacto creado', 'success');
      return r;
    },
  });
}

export async function openCompanyForm(values = {}) {
  const fields = await withCustomFields('companies', companyFields());
  return formModal({
    title: values.id ? 'Editar empresa' : 'Nueva empresa', fields, values, size: 'wide',
    onSubmit: async (data) => {
      const r = await saveRecord('/companies', values.id, data);
      toast(values.id ? 'Empresa actualizada' : 'Empresa creada', 'success');
      return r;
    },
  });
}

export async function openDealForm(values = {}) {
  const v = { pipeline_id: state.pipelines[0]?.id, ...values };
  const fields = await withCustomFields('deals', dealFields(v));
  const p = formModal({
    title: values.id ? 'Editar oportunidad' : 'Nueva oportunidad', fields, values: v, size: 'wide',
    onSubmit: async (data) => {
      const r = await saveRecord('/deals', values.id, data);
      toast(values.id ? 'Oportunidad actualizada' : 'Oportunidad creada', 'success');
      return r;
    },
  });
  // Recarga etapas al cambiar de embudo
  const sel = $('#modal-root [name="pipeline_id"]');
  sel?.addEventListener('change', () => {
    const stage = $('#modal-root [name="stage_id"]');
    stage.innerHTML = stageOptions(sel.value).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('');
  });
  // Al elegir contacto, rellena la empresa si está vacía
  $('#modal-root .lookup[data-lookup="contacts"]')?.addEventListener('lookup-change', (e) => {
    const c = e.detail;
    const companyBox = $('#modal-root .lookup[data-lookup="companies"]');
    if (c?.company_id && companyBox && !$('input[type=hidden]', companyBox).value) companyBox.setValue({ id: c.company_id, name: c.company_name });
  });
  return p;
}

export async function openActivityForm(values = {}) {
  return formModal({
    title: values.id ? 'Editar actividad' : 'Nueva actividad', fields: activityFields(), values, size: 'wide',
    onSubmit: async (data) => {
      const r = await saveRecord('/activities', values.id, data);
      toast(values.id ? 'Actividad actualizada' : 'Actividad creada', 'success');
      return r;
    },
  });
}

export async function openTicketForm(values = {}) {
  const fields = await withCustomFields('tickets', ticketFields());
  return formModal({
    title: values.id ? `Editar ticket #${values.id}` : 'Nuevo ticket', fields, values, size: 'wide',
    onSubmit: async (data) => {
      const r = await saveRecord('/tickets', values.id, data);
      toast(values.id ? 'Ticket actualizado' : 'Ticket creado', 'success');
      return r;
    },
  });
}

export async function deleteRecord(path, id, label) {
  if (!(await confirmDialog(`¿Eliminar ${label}? Esta acción no se puede deshacer.`))) return false;
  try {
    await api.del(`${path}/${id}`);
    toast('Eliminado', 'success');
    return true;
  } catch (err) { toastError(err); return false; }
}

// ---------------- Propiedades y campos personalizados ----------------
export function propsList(pairs) {
  return `<dl class="props">${pairs.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('') || '<dd class="muted">Sin datos</dd>'}</dl>`;
}

export async function customProps(entity, record) {
  const { customFieldsFor } = await import('../ui.js');
  const defs = await customFieldsFor(entity);
  const c = record.custom || {};
  return defs.map((f) => {
    let v = c[f.key];
    if (v === undefined || v === null || v === '') return [f.label, null];
    if (f.type === 'checkbox') v = v ? 'Sí' : 'No';
    else if (f.type === 'url') v = `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
    else if (f.type === 'date') v = esc(fdatetime(v));
    else v = esc(v);
    return [f.label, v];
  });
}

export const linkOrDash = (href, text) => (text ? `<a href="${href}">${esc(text)}</a>` : '<span class="muted">—</span>');
export const mailto = (e) => (e ? `<a href="mailto:${esc(e)}">${esc(e)}</a>` : null);
export const tel = (p) => (p ? `<a href="tel:${esc(p.replace(/\s/g, ''))}">${esc(p)}</a>` : null);

// ---------------- Cronología (notas + actividades) ----------------
/**
 * Bloque de cronología para una ficha.
 * target: { key: 'contact_id'|'company_id'|'deal_id'|'ticket_id', id, defaults: {...} }
 */
export function timeline(container, target) {
  let mode = 'note';
  container.innerHTML = `
    <div class="card composer" style="margin-bottom:14px">
      <div class="tabs" style="margin:0;padding:0 8px">
        <button data-mode="note" class="active">${icon('note')} Nota</button>
        <button data-mode="activity">${icon('calendar')} Actividad</button>
        <button data-mode="call">${icon('phone')} Registrar llamada</button>
      </div>
      <div class="card-body">
        <form data-composer class="stack">
          <textarea name="body" placeholder="Escribe una nota… (Ctrl+Enter para guardar)"></textarea>
          <div class="row" data-act-fields hidden>
            <select name="type" style="width:auto">${opts(L.activityType).map(([k, l]) => `<option value="${k}">${esc(l)}</option>`).join('')}</select>
            <input type="datetime-local" name="due_at" style="width:auto">
          </div>
          <div class="row"><span class="spacer"></span><button class="btn primary sm" type="submit">Guardar</button></div>
        </form>
      </div>
    </div>
    <div class="row" style="margin-bottom:8px"><h3 class="grow">Pendiente</h3></div>
    <div class="timeline" data-pending></div>
    <div class="row" style="margin:18px 0 8px"><h3 class="grow">Historial</h3></div>
    <div class="timeline" data-history></div>`;

  const form = $('[data-composer]', container);
  const setMode = (m) => {
    mode = m;
    $$('[data-mode]', container).forEach((b) => b.classList.toggle('active', b.dataset.mode === m));
    $('[data-act-fields]', container).hidden = m !== 'activity';
    form.body.placeholder = m === 'note' ? 'Escribe una nota… (Ctrl+Enter para guardar)' : m === 'call' ? 'Resumen de la llamada…' : 'Asunto de la actividad…';
    if (m === 'activity' && !form.due_at.value) {
      const d = new Date(Date.now() + 86400000);
      form.due_at.value = `${d.toISOString().slice(0, 10)}T10:00`;
    }
  };
  $$('[data-mode]', container).forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  const submit = async (e) => {
    e?.preventDefault();
    const body = form.body.value.trim();
    if (!body) return;
    try {
      const base = { [target.key]: target.id, ...(target.defaults || {}) };
      if (mode === 'note') await api.post('/notes', { ...base, body });
      else if (mode === 'call') {
        await api.post('/activities', { ...base, type: 'call', subject: body.split('\n')[0].slice(0, 120), description: body, done: true, due_at: new Date().toISOString().slice(0, 16) });
      } else {
        await api.post('/activities', { ...base, type: form.type.value, subject: body.split('\n')[0].slice(0, 300), description: body.includes('\n') ? body : null, due_at: form.due_at.value || null });
      }
      form.body.value = '';
      toast('Guardado', 'success');
      load();
    } catch (err) { toastError(err); }
  };
  form.addEventListener('submit', submit);
  form.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(e); });

  async function load() {
    try {
      const t = await api.get('/timeline', { [target.key]: target.id });
      const pending = t.activities.filter((a) => !a.done);
      const doneActs = t.activities.filter((a) => a.done);
      const history = [
        ...t.notes.map((n) => ({ kind: 'note', at: n.created_at, pinned: n.pinned, n })),
        ...doneActs.map((a) => ({ kind: 'act', at: a.done_at || a.due_at || a.created_at, a })),
        ...t.changes.filter((c) => ['created', 'stage_changed'].includes(c.action)).map((c) => ({ kind: 'change', at: c.created_at, c })),
      ].sort((x, y) => (y.pinned || 0) - (x.pinned || 0) || String(y.at).localeCompare(String(x.at)));

      $('[data-pending]', container).innerHTML = pending.length ? pending.map(actItem).join('') : '<div class="muted small">No hay actividades pendientes.</div>';
      $('[data-history]', container).innerHTML = history.length ? history.map((h) => (h.kind === 'note' ? noteItem(h.n) : h.kind === 'act' ? actItem(h.a) : changeItem(h.c))).join('') : '<div class="muted small">Sin historial todavía.</div>';
    } catch (err) { toastError(err); }
  }

  const actItem = (a) => `<div class="tl-item ${a.done ? 'done' : ''}" data-act="${a.id}">
    <div class="tl-icon">${icon(activityIcon(a.type))}</div>
    <div class="grow">
      <div class="row"><label class="check grow"><input type="checkbox" data-toggle="${a.id}" ${a.done ? 'checked' : ''}><b class="${a.done ? '' : ''}">${esc(a.subject)}</b></label>
        <button class="btn ghost sm icon-only" data-edit-act="${a.id}" aria-label="Editar">${icon('edit')}</button></div>
      <div class="small ${isOverdue(a.due_at, a.done) ? 'prio-high' : 'muted'}">${esc(L.activityType[a.type])}${a.due_at ? ` · ${fdatetime(a.due_at)}` : ''}${a.owner_name ? ` · ${esc(a.owner_name)}` : ''}${a.deal_title && target.key !== 'deal_id' ? ` · ${esc(a.deal_title)}` : ''}</div>
      ${a.description && a.description !== a.subject ? `<div class="tl-body small">${esc(a.description)}</div>` : ''}
    </div></div>`;

  const noteItem = (n) => `<div class="tl-item note ${n.pinned ? 'pinned' : ''}">
    <div class="tl-icon">${icon('note')}</div>
    <div class="grow">
      <div class="row"><span class="grow small muted"><b style="color:var(--text)">${esc(n.user_name || '')}</b> · ${ago(n.created_at)}${n.pinned ? ' · 📌 fijada' : ''}</span>
        <button class="btn ghost sm icon-only" data-pin="${n.id}" data-pinned="${n.pinned}" title="${n.pinned ? 'Desfijar' : 'Fijar'}" aria-label="Fijar">${icon('pin')}</button>
        <button class="btn ghost sm icon-only" data-del-note="${n.id}" title="Eliminar" aria-label="Eliminar">${icon('trash')}</button></div>
      <div class="tl-body">${esc(n.body)}</div>
    </div></div>`;

  const changeItem = (c) => {
    const u = state.users.find((x) => x.id === c.user_id);
    return `<div class="tl-item" style="background:transparent;border-style:dashed">
      ${avatar(c.user_name || '?', u?.color, 'sm')}
      <div class="small muted grow">${esc(c.user_name || 'Sistema')} ${c.action === 'created' ? 'creó el registro' : `cambió la etapa: ${esc(c.summary?.split('→')[1] || '')}`} · ${ago(c.created_at)}</div></div>`;
  };

  container.addEventListener('change', async (e) => {
    const t = e.target.closest('[data-toggle]');
    if (!t) return;
    try { await api.patch(`/activities/${t.dataset.toggle}`, { done: t.checked }); load(); } catch (err) { toastError(err); }
  });
  container.addEventListener('click', async (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) { try { await api.patch(`/notes/${pin.dataset.pin}`, { pinned: pin.dataset.pinned !== '1' }); load(); } catch (err) { toastError(err); } return; }
    const del = e.target.closest('[data-del-note]');
    if (del) { if (await confirmDialog('¿Eliminar esta nota?')) { try { await api.del(`/notes/${del.dataset.delNote}`); load(); } catch (err) { toastError(err); } } return; }
    const ed = e.target.closest('[data-edit-act]');
    if (ed) {
      const a = await api.get(`/activities/${ed.dataset.editAct}`);
      if (await openActivityForm(a)) load();
    }
  });

  load();
  return { reload: load };
}

/** Tabla compacta de registros relacionados. */
export function relatedTable(rows, columns, emptyText) {
  if (!rows.length) return `<div class="empty" style="padding:20px">${esc(emptyText)}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${columns.map((c) => `<th class="${c.cls || ''}">${esc(c.label)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td class="${c.cls || ''}">${c.render(r)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

export const dealColumns = [
  { label: 'Oportunidad', render: (d) => `<a href="#/deals/${d.id}">${esc(d.title)}</a>` },
  { label: 'Etapa', render: (d) => `<span class="row"><span class="dot" style="background:${esc(d.stage_color || 'var(--muted)')}"></span>${esc(d.stage_name)}</span>` },
  { label: 'Importe', cls: 'num', render: (d) => money(d.value) },
  { label: 'Estado', render: (d) => badge(L.dealStatus, d.status) },
];

export const quoteColumns = [
  { label: 'Número', render: (q) => `<a href="#/${q.kind === 'invoice' ? 'invoices' : 'quotes'}/${q.id}">${esc(q.number)}</a>` },
  { label: 'Fecha', render: (q) => esc(fdatetime(q.issue_date)) },
  { label: 'Estado', render: (q) => badge(q.kind === 'invoice' ? L.invoiceStatus : L.quoteStatus, q.status) },
  { label: 'Total', cls: 'num', render: (q) => money(q.total, q.currency) },
];

export { today };
