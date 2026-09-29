import { api, download, auth } from '../api.js';
import {
  state, $, $$, esc, icon, L, opts, formModal, toast, toastError, confirmDialog, isAdmin, isManager, hasFeature, fdate, fdatetime, ago,
  avatar, num, renderForm, readForm, setTitle, refreshPipelines, refreshUsers, modal, emptyState,
} from '../ui.js';

const TABS = [
  { id: 'general', label: 'Empresa', icon: 'building', show: isAdmin },
  { id: 'users', label: 'Usuarios', icon: 'users', show: isAdmin },
  { id: 'pipelines', label: 'Embudos', icon: 'kanban', show: isManager },
  { id: 'fields', label: 'Campos personalizados', icon: 'sliders', show: isAdmin, feature: 'custom_fields' },
  { id: 'import', label: 'Importar / exportar', icon: 'upload', show: isManager, feature: 'import_export' },
  { id: 'integrations', label: 'API y webhooks', icon: 'zap', show: () => true, feature: 'api' },
  { id: 'audit', label: 'Auditoría', icon: 'shield', show: isManager, feature: 'audit' },
  { id: 'backup', label: 'Copia de seguridad', icon: 'database', show: isAdmin },
  { id: 'license', label: 'Licencia', icon: 'key', show: () => true },
];

export async function render(root, tab, query = {}) {
  setTitle('Configuración');
  const visible = TABS.filter((t) => t.show());
  const current = visible.find((t) => t.id === tab) || visible[0];
  root.innerHTML = `
    <div class="page-head"><div class="grow"><h1>Configuración</h1></div></div>
    <div class="tabs">${visible.map((t) => `<button data-tab="${t.id}" class="${t.id === current.id ? 'active' : ''}">${esc(t.label)}${t.feature && !hasFeature(t.feature) ? ' 🔒' : ''}</button>`).join('')}</div>
    <div data-pane></div>`;
  $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => { location.hash = `#/settings/${b.dataset.tab}`; }));
  const pane = $('[data-pane]', root);
  pane.onclick = null;
  if (current.feature && !hasFeature(current.feature)) {
    pane.innerHTML = `<div class="card"><div class="empty">${icon('shield')}<h2>No incluido en tu plan</h2><p>Amplía tu licencia para usar «${esc(current.label)}».</p><a class="btn primary" href="#/settings/license">Ver licencia</a></div></div>`;
    return;
  }
  await PANES[current.id](pane, query);
}

// ---------------- Empresa / general ----------------
async function general(pane) {
  const s = state.settings;
  const fields = [
    { type: 'section', label: 'Datos de la empresa (aparecen en presupuestos y facturas)' },
    { key: 'company_name', label: 'Nombre comercial', required: true },
    { key: 'company_tax_id', label: 'CIF/NIF' },
    { key: 'company_email', label: 'Email', type: 'email' },
    { key: 'company_phone', label: 'Teléfono' },
    { key: 'company_address', label: 'Dirección fiscal', type: 'textarea', rows: 2 },
    { type: 'section', label: 'Regional' },
    { key: 'currency', label: 'Moneda', type: 'select', options: ['EUR', 'USD', 'MXN', 'COP', 'ARS', 'CLP', 'PEN', 'GBP', 'BRL', 'UYU'].map((c) => [c, c]), required: true },
    { key: 'locale', label: 'Formato regional', type: 'select', options: [['es-ES', 'España'], ['es-MX', 'México'], ['es-AR', 'Argentina'], ['es-CO', 'Colombia'], ['es-CL', 'Chile'], ['es-PE', 'Perú'], ['en-US', 'Estados Unidos'], ['pt-BR', 'Brasil']], required: true },
    { key: 'default_tax_rate', label: 'Impuesto por defecto (%)', type: 'number', min: 0, max: 100 },
    { key: 'brand_color', label: 'Color de marca', type: 'color' },
    { type: 'section', label: 'Numeración y condiciones' },
    { key: 'quote_prefix', label: 'Prefijo presupuestos' },
    { key: 'next_quote_number', label: 'Siguiente nº presupuesto', type: 'number', min: 1 },
    { key: 'invoice_prefix', label: 'Prefijo facturas' },
    { key: 'next_invoice_number', label: 'Siguiente nº factura', type: 'number', min: 1 },
    { key: 'quote_validity_days', label: 'Validez presupuestos (días)', type: 'number', min: 1 },
    { key: 'invoice_due_days', label: 'Vencimiento facturas (días)', type: 'number', min: 0 },
    { key: 'quote_terms', label: 'Condiciones de presupuestos', type: 'textarea', rows: 2 },
    { key: 'invoice_terms', label: 'Condiciones de facturas (p. ej. IBAN)', type: 'textarea', rows: 2 },
    { type: 'section', label: 'Listas desplegables (separadas por comas)' },
    { key: 'contact_sources', label: 'Orígenes de contactos', full: true },
    { key: 'industries', label: 'Sectores', full: true },
    { key: 'lost_reasons', label: 'Motivos de pérdida', full: true },
    { key: 'ticket_categories', label: 'Categorías de tickets', full: true },
    { type: 'section', label: 'Privacidad' },
    { key: 'sales_see_own_only', label: 'Los comerciales solo ven sus propios registros', type: 'checkbox', full: true },
  ];
  pane.innerHTML = `
    <div class="card" style="max-width:900px"><div class="card-body">
      <div class="row" style="margin-bottom:16px">
        <div class="brand-logo" style="width:64px;height:64px;font-size:26px" data-logo-preview>${s.company_logo ? `<img src="${esc(s.company_logo)}" alt="Logo">` : esc((s.company_name || 'N')[0])}</div>
        <div><b>Logotipo</b><div class="hint">PNG, JPG, SVG o WebP. Máximo 300 KB.</div>
          <div class="row" style="margin-top:6px"><label class="btn sm">${icon('upload')}Subir<input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" hidden data-logo></label>
          ${s.company_logo ? '<button class="btn sm ghost" data-logo-remove>Quitar</button>' : ''}</div></div>
      </div>
      <form data-form>${renderForm(fields, { ...s, sales_see_own_only: s.sales_see_own_only === '1', brand_color: s.brand_color || '#2a78d6' })}</form>
      <div class="row" style="margin-top:16px"><span class="spacer"></span><button class="btn primary" data-save>Guardar cambios</button></div>
    </div></div>`;
  const save = async (patch) => {
    try {
      state.settings = await api.patch('/settings', patch);
      toast('Configuración guardada', 'success');
      const { reloadShell } = await import('../main.js');
      await reloadShell();
    } catch (err) { toastError(err); }
  };
  $('[data-save]', pane).addEventListener('click', () => {
    const data = readForm($('[data-form]', pane), fields);
    data.sales_see_own_only = data.sales_see_own_only ? '1' : '0';
    save(data);
  });
  $('[data-logo]', pane).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 300 * 1024) { toastError(new Error('El logo supera 300 KB')); return; }
    const reader = new FileReader();
    reader.onload = () => save({ company_logo: reader.result });
    reader.readAsDataURL(file);
  });
  $('[data-logo-remove]', pane)?.addEventListener('click', () => save({ company_logo: '' }));
}

// ---------------- Usuarios ----------------
async function users(pane) {
  await refreshUsers();
  const lic = state.license;
  const active = state.users.filter((u) => u.active).length;
  pane.innerHTML = `
    <div class="card">
      <div class="card-head"><div class="grow"><h3>Usuarios</h3><div class="small muted">${active} de ${lic.seats} licencias en uso</div></div>
        <button class="btn primary sm" data-new ${active >= lic.seats ? 'disabled title="Has alcanzado el límite de usuarios de tu licencia"' : ''}>${icon('plus')}Nuevo usuario</button></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th class="actions"></th></tr></thead>
        <tbody>${state.users.map((u) => `<tr>
          <td><div class="row">${avatar(u.name, u.color)}<div><b>${esc(u.name)}</b>${u.id === state.user.id ? ' <span class="badge">Tú</span>' : ''}<div class="small muted">${esc(u.email)}</div></div></div></td>
          <td>${esc(L.role[u.role])}</td>
          <td>${u.active ? '<span class="badge green">Activo</span>' : '<span class="badge">Desactivado</span>'}</td>
          <td class="small muted">${u.last_login ? ago(u.last_login) : 'Nunca'}</td>
          <td class="actions"><button class="btn ghost sm" data-edit="${u.id}">${icon('edit')}Editar</button>
            ${u.id !== state.user.id ? `<button class="btn ghost sm icon-only danger" data-del="${u.id}" aria-label="Eliminar">${icon('trash')}</button>` : ''}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
    <div class="card" style="margin-top:16px"><div class="card-body small text-2">
      <b>Roles:</b> <b>Administrador</b> — acceso total, configuración, usuarios y licencia. <b>Responsable</b> — gestiona todos los registros, embudos, importaciones e informes del equipo.
      <b>Comercial</b> — gestiona clientes y ventas (si activas la privacidad, solo ve los suyos).
    </div></div>`;
  const fields = (isNew) => [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'email', label: 'Email', type: 'email', required: true },
    { key: 'role', label: 'Rol', type: 'select', options: opts(L.role), required: true, default: 'sales' },
    { key: 'title', label: 'Cargo' },
    { key: 'phone', label: 'Teléfono' },
    { key: 'password', label: isNew ? 'Contraseña' : 'Nueva contraseña (opcional)', type: 'password', required: isNew, hint: 'Mínimo 8 caracteres' },
    ...(isNew ? [] : [{ key: 'active', label: 'Usuario activo', type: 'checkbox' }]),
  ];
  $('[data-new]', pane).addEventListener('click', async () => {
    if (await formModal({ title: 'Nuevo usuario', fields: fields(true), values: { role: 'sales' }, onSubmit: (d) => api.post('/users', d) })) { toast('Usuario creado', 'success'); users(pane); }
  });
  pane.onclick = async (e) => {
    const ed = e.target.closest('[data-edit]');
    if (ed) {
      const u = state.users.find((x) => x.id === Number(ed.dataset.edit));
      const r = await formModal({
        title: `Editar ${u.name}`, fields: fields(false), values: u,
        onSubmit: (d) => { if (!d.password) delete d.password; return api.patch(`/users/${u.id}`, d); },
      });
      if (r) { toast('Usuario actualizado', 'success'); users(pane); }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      const u = state.users.find((x) => x.id === Number(del.dataset.del));
      if (!(await confirmDialog(`¿Eliminar a ${u.name}? Sus registros se reasignarán a ti. Si solo quieres bloquear el acceso, desactívalo.`))) return;
      try { await api.del(`/users/${u.id}`); toast('Usuario eliminado', 'success'); users(pane); } catch (err) { toastError(err); }
    }
  };
}

// ---------------- Embudos ----------------
async function pipelines(pane) {
  await refreshPipelines();
  pane.innerHTML = `
    <div class="row" style="margin-bottom:12px"><p class="muted grow" style="margin:0">Define las etapas de tu proceso de venta. La probabilidad se usa para la previsión ponderada.</p>
      <button class="btn primary sm" data-new>${icon('plus')}Nuevo embudo</button></div>
    <div class="stack">${state.pipelines.map((p) => `
      <div class="card"><div class="card-head"><h3 class="grow">${esc(p.name)}</h3>
        <button class="btn ghost sm" data-edit="${p.id}">${icon('edit')}Editar</button>
        ${state.pipelines.length > 1 && isAdmin() ? `<button class="btn ghost sm icon-only" data-del="${p.id}" aria-label="Eliminar">${icon('trash')}</button>` : ''}</div>
        <div class="card-body"><div class="row wrap">${p.stages.map((s) => `<span class="badge" style="height:28px"><span class="dot" style="background:${esc(s.color || 'var(--muted)')}"></span>${esc(s.name)} · ${s.probability}% · ${s.deals_count}</span>`).join('<span class="muted">→</span>')}</div></div>
      </div>`).join('')}</div>`;

  const editor = (p) => {
    let stages = p ? p.stages.map((s) => ({ ...s })) : [
      { name: 'Nuevo', probability: 10, kind: 'open', color: '#2a78d6' }, { name: 'Propuesta', probability: 50, kind: 'open', color: '#eda100' },
      { name: 'Ganado', probability: 100, kind: 'won', color: '#0ca30c' }, { name: 'Perdido', probability: 0, kind: 'lost', color: '#d03b3b' },
    ];
    const rows = () => stages.map((s, i) => `<tr data-i="${i}">
      <td><input type="text" data-k="name" value="${esc(s.name)}" required></td>
      <td><input type="number" data-k="probability" min="0" max="100" value="${s.probability}" style="width:80px"></td>
      <td><select data-k="kind">${[['open', 'Abierta'], ['won', 'Ganada'], ['lost', 'Perdida']].map(([k, l]) => `<option value="${k}" ${s.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input type="color" data-k="color" value="${esc(s.color || '#2a78d6')}"></td>
      <td class="actions nowrap"><button type="button" class="btn ghost sm icon-only" data-up="${i}" aria-label="Subir">↑</button><button type="button" class="btn ghost sm icon-only" data-down="${i}" aria-label="Bajar">↓</button><button type="button" class="btn ghost sm icon-only" data-rm="${i}" aria-label="Quitar">${icon('trash')}</button></td></tr>`).join('');
    modal({
      title: p ? `Editar embudo «${p.name}»` : 'Nuevo embudo', size: 'wide',
      body: `<label class="field" style="margin-bottom:14px"><span>Nombre</span><input type="text" data-name value="${esc(p?.name || '')}"></label>
        <table class="table"><thead><tr><th>Etapa</th><th>Prob. %</th><th>Tipo</th><th>Color</th><th></th></tr></thead><tbody data-rows>${rows()}</tbody></table>
        <button class="btn sm" data-add style="margin-top:10px">${icon('plus')}Añadir etapa</button>
        <p class="hint">Si eliminas una etapa con oportunidades, estas se moverán a la primera etapa del embudo.</p>`,
      footer: '<button class="btn" data-close>Cancelar</button><button class="btn primary" data-ok>Guardar</button>',
      onMount(el, close) {
        const tbody = $('[data-rows]', el);
        const sync = () => $$('tr', tbody).forEach((tr) => {
          const s = stages[Number(tr.dataset.i)];
          $$('[data-k]', tr).forEach((inp) => { s[inp.dataset.k] = inp.dataset.k === 'probability' ? Number(inp.value) : inp.value; });
        });
        el.addEventListener('click', (e) => {
          const t = e.target.closest('button');
          if (!t) return;
          if (t.matches('[data-add]')) { sync(); stages.splice(stages.findIndex((s) => s.kind !== 'open') >= 0 ? stages.findIndex((s) => s.kind !== 'open') : stages.length, 0, { name: 'Nueva etapa', probability: 50, kind: 'open', color: '#4a3aa7' }); tbody.innerHTML = rows(); }
          else if (t.dataset.rm !== undefined) { sync(); stages.splice(Number(t.dataset.rm), 1); tbody.innerHTML = rows(); }
          else if (t.dataset.up !== undefined) { sync(); const i = Number(t.dataset.up); if (i > 0) [stages[i - 1], stages[i]] = [stages[i], stages[i - 1]]; tbody.innerHTML = rows(); }
          else if (t.dataset.down !== undefined) { sync(); const i = Number(t.dataset.down); if (i < stages.length - 1) [stages[i + 1], stages[i]] = [stages[i], stages[i + 1]]; tbody.innerHTML = rows(); }
          else if (t.matches('[data-ok]')) {
            sync();
            const body = { name: $('[data-name]', el).value, stages };
            (p ? api.put(`/pipelines/${p.id}`, body) : api.post('/pipelines', body))
              .then(async () => { close(); toast('Embudo guardado', 'success'); pipelines(pane); })
              .catch(toastError);
          }
        });
      },
    });
  };
  $('[data-new]', pane).addEventListener('click', () => editor(null));
  $$('[data-edit]', pane).forEach((b) => b.addEventListener('click', () => editor(state.pipelines.find((p) => p.id === Number(b.dataset.edit)))));
  $$('[data-del]', pane).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Eliminar este embudo?'))) return;
    try { await api.del(`/pipelines/${b.dataset.del}`); toast('Embudo eliminado', 'success'); pipelines(pane); } catch (err) { toastError(err); }
  }));
}

// ---------------- Campos personalizados ----------------
const ENTITY_LABEL = { contacts: 'Contactos', companies: 'Empresas', deals: 'Oportunidades', tickets: 'Tickets', products: 'Productos' };
const TYPE_LABEL = { text: 'Texto', textarea: 'Texto largo', number: 'Número', date: 'Fecha', select: 'Desplegable', checkbox: 'Casilla', url: 'URL' };

async function fields(pane) {
  const list = await api.get('/custom-fields');
  state.customFields = {};
  pane.innerHTML = `
    <div class="card"><div class="card-head"><div class="grow"><h3>Campos personalizados</h3><div class="small muted">Añade la información específica de tu negocio a cualquier registro.</div></div>
      <button class="btn primary sm" data-new>${icon('plus')}Nuevo campo</button></div>
      ${list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Entidad</th><th>Etiqueta</th><th>Clave</th><th>Tipo</th><th>Obligatorio</th><th class="actions"></th></tr></thead>
      <tbody>${list.map((f) => `<tr><td>${esc(ENTITY_LABEL[f.entity])}</td><td><b>${esc(f.label)}</b>${f.options.length ? `<div class="small muted">${esc(f.options.join(', '))}</div>` : ''}</td><td><code>${esc(f.key)}</code></td><td>${esc(TYPE_LABEL[f.type])}</td><td>${f.required ? 'Sí' : 'No'}</td>
        <td class="actions"><button class="btn ghost sm" data-edit="${f.id}">${icon('edit')}</button><button class="btn ghost sm" data-del="${f.id}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Aún no has creado campos personalizados', 'sliders')}
    </div>`;
  const def = (isNew) => [
    ...(isNew ? [{ key: 'entity', label: 'Entidad', type: 'select', options: Object.entries(ENTITY_LABEL), required: true }] : []),
    { key: 'label', label: 'Etiqueta', required: true },
    { key: 'type', label: 'Tipo', type: 'select', options: Object.entries(TYPE_LABEL), required: true },
    { key: 'options', label: 'Opciones (para desplegables, separadas por comas)', full: true },
    { key: 'position', label: 'Orden', type: 'number' },
    { key: 'required', label: 'Obligatorio', type: 'checkbox' },
  ];
  const submit = (id) => (d) => {
    d.options = d.options ? d.options.split(',').map((s) => s.trim()).filter(Boolean) : [];
    return id ? api.patch(`/custom-fields/${id}`, d) : api.post('/custom-fields', d);
  };
  $('[data-new]', pane).addEventListener('click', async () => {
    if (await formModal({ title: 'Nuevo campo', fields: def(true), values: { entity: 'contacts', type: 'text' }, onSubmit: submit(null) })) fields(pane);
  });
  $$('[data-edit]', pane).forEach((b) => b.addEventListener('click', async () => {
    const f = list.find((x) => x.id === Number(b.dataset.edit));
    if (await formModal({ title: `Editar «${f.label}»`, fields: def(false), values: { ...f, options: f.options.join(', ') }, onSubmit: submit(f.id) })) fields(pane);
  }));
  $$('[data-del]', pane).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Eliminar este campo? Los valores guardados dejarán de mostrarse.'))) return;
    try { await api.del(`/custom-fields/${b.dataset.del}`); fields(pane); } catch (err) { toastError(err); }
  }));
}

// ---------------- Importar / exportar ----------------
async function importPane(pane) {
  const entities = [['contacts', 'Contactos'], ['companies', 'Empresas'], ...(hasFeature('products') ? [['products', 'Productos']] : [])];
  pane.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Importar desde CSV / Excel</h3></div><div class="card-body stack">
        <p class="small text-2" style="margin:0">Exporta tu hoja de cálculo como CSV (separado por comas o punto y coma). La primera fila debe contener los nombres de columna: se reconocen automáticamente cabeceras como <i>Nombre, Apellidos, Email, Teléfono, Empresa, Ciudad…</i></p>
        <label class="field"><span>¿Qué quieres importar?</span><select data-entity>${entities.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></label>
        <label class="field"><span>Archivo CSV</span><input type="file" accept=".csv,text/csv" data-file></label>
        <label class="check"><input type="checkbox" data-skip checked> Omitir duplicados (mismo email / nombre / SKU)</label>
        <div data-preview></div>
        <div class="row"><span class="spacer"></span><button class="btn primary" data-go disabled>${icon('upload')}Importar</button></div>
        <div data-result></div>
      </div></div>
      <div class="card"><div class="card-head"><h3>Exportar datos</h3></div><div class="card-body stack">
        <p class="small text-2" style="margin:0">Descarga tus datos en CSV compatible con Excel. Tus datos son tuyos: sin permanencia.</p>
        ${[['contacts', 'Contactos'], ['companies', 'Empresas'], ['deals', 'Oportunidades'], ['activities', 'Actividades'],
          ...(hasFeature('products') ? [['products', 'Productos']] : []), ...(hasFeature('tickets') ? [['tickets', 'Tickets']] : [])]
          .map(([k, l]) => `<button class="btn" data-export="${k}" style="justify-content:flex-start">${icon('download')}${l}</button>`).join('')}
        ${hasFeature('quotes') ? `<button class="btn" data-export-q="quote" style="justify-content:flex-start">${icon('download')}Presupuestos</button><button class="btn" data-export-q="invoice" style="justify-content:flex-start">${icon('download')}Facturas</button>` : ''}
      </div></div>
    </div>`;
  let csv = '';
  $('[data-file]', pane).addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      csv = String(reader.result);
      const lines = csv.split(/\r?\n/).filter(Boolean);
      $('[data-preview]', pane).innerHTML = `<div class="small muted">${num(lines.length - 1)} filas detectadas. Cabecera: <code>${esc(lines[0]?.slice(0, 200))}</code></div>`;
      $('[data-go]', pane).disabled = false;
    };
    reader.readAsText(file, 'utf-8');
  });
  $('[data-go]', pane).addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await api.post(`/import/${$('[data-entity]', pane).value}`, { csv, skip_duplicates: $('[data-skip]', pane).checked });
      $('[data-result]', pane).innerHTML = `<div class="badge green" style="height:auto;padding:8px 12px">${num(r.created)} creados · ${num(r.skipped)} omitidos · ${num(r.errors.length)} errores</div>
        ${r.errors.length ? `<ul class="small" style="max-height:160px;overflow:auto">${r.errors.map((x) => `<li>Línea ${x.line}: ${esc(x.error)}</li>`).join('')}</ul>` : ''}`;
      state.customFields = {};
    } catch (err) { toastError(err); } finally { e.target.disabled = false; }
  });
  $$('[data-export]', pane).forEach((b) => b.addEventListener('click', () => download(`/${b.dataset.export}/export.csv`).catch(toastError)));
  $$('[data-export-q]', pane).forEach((b) => b.addEventListener('click', () => download('/quotes/export.csv', { kind: b.dataset.exportQ }).catch(toastError)));
}

// ---------------- API y webhooks ----------------
async function integrations(pane) {
  const keys = await api.get('/api-keys');
  const hooks = isAdmin() && hasFeature('webhooks') ? await api.get('/webhooks') : null;
  const origin = location.origin;
  pane.innerHTML = `
    <div class="card" style="margin-bottom:16px"><div class="card-head"><div class="grow"><h3>Claves de API</h3><div class="small muted">Conecta el CRM con tu web, Zapier, Make, n8n o tus propios sistemas.</div></div>
      <button class="btn primary sm" data-new-key>${icon('plus')}Nueva clave</button></div>
      ${keys.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Nombre</th><th>Prefijo</th><th>Creada</th><th>Último uso</th><th></th></tr></thead>
        <tbody>${keys.map((k) => `<tr><td>${esc(k.name)}</td><td><code>${esc(k.prefix)}…</code></td><td>${fdate(k.created_at)}</td><td>${k.last_used ? ago(k.last_used) : 'Nunca'}</td><td class="actions"><button class="btn ghost sm danger" data-del-key="${k.id}">Revocar</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('No has creado ninguna clave de API', 'key')}
      <div class="card-body small text-2" style="border-top:1px solid var(--border)">
        <b>Ejemplo</b> — crear un contacto desde tu formulario web:
        <pre style="background:var(--surface-3);padding:10px;border-radius:6px;overflow:auto;margin:8px 0 0">curl -X POST ${esc(origin)}/api/contacts \\
  -H "X-API-Key: nxk_..." -H "Content-Type: application/json" \\
  -d '{"first_name":"Ana","email":"ana@ejemplo.com","source":"Web"}'</pre>
        <p style="margin:8px 0 0">Endpoints REST: <code>/api/contacts</code>, <code>/api/companies</code>, <code>/api/deals</code>, <code>/api/activities</code>, <code>/api/tickets</code>, <code>/api/products</code>, <code>/api/quotes</code> (GET, POST, PATCH /:id, DELETE /:id).</p>
      </div>
    </div>
    ${hooks ? `<div class="card"><div class="card-head"><div class="grow"><h3>Webhooks</h3><div class="small muted">Recibe un POST en tu URL cuando ocurran eventos (p. ej. <code>deals.created</code>, <code>contacts.*</code> o <code>*</code>).</div></div>
      <button class="btn primary sm" data-new-hook>${icon('plus')}Nuevo webhook</button></div>
      ${hooks.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>URL</th><th>Eventos</th><th>Secreto (firma HMAC)</th><th>Último envío</th><th></th></tr></thead>
        <tbody>${hooks.map((h) => `<tr><td class="ellipsis" style="max-width:260px">${esc(h.url)}</td><td><code>${esc(h.events)}</code></td><td><code class="small">${esc(h.secret.slice(0, 8))}…</code> <button class="btn ghost sm" data-copy="${esc(h.secret)}">Copiar</button></td>
          <td class="small">${h.last_status ? `${esc(h.last_status)} · ${ago(h.last_at)}` : '—'}</td>
          <td class="actions"><button class="btn ghost sm" data-test-hook="${h.id}">Probar</button><button class="btn ghost sm" data-toggle-hook="${h.id}" data-active="${h.active}">${h.active ? 'Pausar' : 'Activar'}</button><button class="btn ghost sm danger" data-del-hook="${h.id}">${icon('trash')}</button></td></tr>`).join('')}</tbody></table></div>`
        : emptyState('Sin webhooks configurados', 'zap')}
      <div class="card-body small text-2" style="border-top:1px solid var(--border)">Cada petición incluye la cabecera <code>X-CRM-Signature: sha256=&lt;HMAC del cuerpo con tu secreto&gt;</code> para verificar su autenticidad.</div>
    </div>` : ''}`;

  $('[data-new-key]', pane).addEventListener('click', async () => {
    const r = await formModal({ title: 'Nueva clave de API', fields: [{ key: 'name', label: 'Nombre (p. ej. «Formulario web»)', required: true, full: true }], onSubmit: (d) => api.post('/api-keys', d) });
    if (!r) return;
    modal({
      title: 'Copia tu clave ahora', size: 'narrow',
      body: `<p>Por seguridad no volveremos a mostrarla.</p><input type="text" readonly value="${esc(r.key)}" style="font-family:monospace">`,
      footer: '<button class="btn primary" data-close>Hecho</button>',
      onMount: (el) => { const i = $('input', el); i.focus(); i.select(); },
    });
    integrations(pane);
  });
  $$('[data-del-key]', pane).forEach((b) => b.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Revocar esta clave? Las integraciones que la usen dejarán de funcionar.', { okLabel: 'Revocar' }))) return;
    await api.del(`/api-keys/${b.dataset.delKey}`).catch(toastError);
    integrations(pane);
  }));
  $('[data-new-hook]', pane)?.addEventListener('click', async () => {
    const r = await formModal({
      title: 'Nuevo webhook',
      fields: [{ key: 'url', label: 'URL de destino', type: 'url', required: true, full: true }, { key: 'events', label: 'Eventos (separados por comas)', full: true, placeholder: '*  ó  deals.created, contacts.updated' }],
      values: { events: '*' }, onSubmit: (d) => api.post('/webhooks', d),
    });
    if (r) integrations(pane);
  });
  pane.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.copy) { navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Copiado')); }
    else if (b.dataset.testHook) { await api.post(`/webhooks/${b.dataset.testHook}/test`).catch(toastError); toast('Enviado. Recarga en unos segundos para ver el resultado.'); }
    else if (b.dataset.toggleHook) { await api.patch(`/webhooks/${b.dataset.toggleHook}`, { active: b.dataset.active !== '1' }).catch(toastError); integrations(pane); }
    else if (b.dataset.delHook) { if (await confirmDialog('¿Eliminar este webhook?')) { await api.del(`/webhooks/${b.dataset.delHook}`).catch(toastError); integrations(pane); } }
  };
}

// ---------------- Auditoría ----------------
async function audit(pane, query = {}) {
  const page = Number(query.page) || 1;
  const res = await api.get('/audit', { page, limit: 50, entity: query.entity, user_id: query.user_id });
  const actions = { created: 'Creó', updated: 'Modificó', deleted: 'Eliminó', login: 'Inició sesión', stage_changed: 'Cambió etapa', import: 'Importó', export: 'Exportó', backup: 'Copia de seguridad', activated: 'Activó licencia', removed: 'Quitó licencia', password_changed: 'Cambió contraseña' };
  pane.innerHTML = `<div class="card">
    <div class="toolbar"><select data-entity style="width:auto"><option value="">Todas las entidades</option>${['contacts', 'companies', 'deals', 'activities', 'tickets', 'quotes', 'invoices', 'products', 'users', 'settings', 'license'].map((e) => `<option ${query.entity === e ? 'selected' : ''}>${e}</option>`).join('')}</select>
      <select data-user style="width:auto"><option value="">Todos los usuarios</option>${state.users.map((u) => `<option value="${u.id}" ${String(u.id) === query.user_id ? 'selected' : ''}>${esc(u.name)}</option>`).join('')}</select></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Entidad</th><th>Detalle</th><th>IP</th></tr></thead>
    <tbody>${res.data.map((a) => `<tr><td class="nowrap small">${fdatetime(a.created_at)}</td><td>${esc(a.user_name || '—')}</td><td>${esc(actions[a.action] || a.action)}</td><td><code>${esc(a.entity)}${a.entity_id ? ` #${a.entity_id}` : ''}</code></td><td class="small">${esc(a.summary || '')}</td><td class="small muted">${esc(a.ip || '')}</td></tr>`).join('')}</tbody></table></div>
    <div class="pager"><span>${num(res.total)} eventos</span><span class="spacer"></span>
      ${page > 1 ? `<a class="btn sm" href="#/settings/audit?${new URLSearchParams({ ...query, page: page - 1 })}">Anterior</a>` : ''}
      ${page * 50 < res.total ? `<a class="btn sm" href="#/settings/audit?${new URLSearchParams({ ...query, page: page + 1 })}">Siguiente</a>` : ''}</div></div>`;
  const nav = (patch) => { location.hash = `#/settings/audit?${new URLSearchParams(Object.fromEntries(Object.entries({ ...query, page: 1, ...patch }).filter(([, v]) => v)))}`; };
  $('[data-entity]', pane).addEventListener('change', (e) => nav({ entity: e.target.value }));
  $('[data-user]', pane).addEventListener('change', (e) => nav({ user_id: e.target.value }));
}

// ---------------- Copia de seguridad ----------------
async function backup(pane) {
  pane.innerHTML = `<div class="card" style="max-width:720px"><div class="card-body stack">
    <h3>Copia de seguridad completa</h3>
    <p class="text-2" style="margin:0">Descarga un archivo con toda la base de datos (SQLite). Guárdalo en un lugar seguro. Para restaurarlo, sustituye el archivo <code>data/crm.db</code> del servidor con el CRM detenido.</p>
    <p class="text-2" style="margin:0">Recomendación: programa también copias automáticas del directorio <code>data/</code> en tu servidor (ver README).</p>
    <div><button class="btn primary" data-backup>${icon('download')}Descargar copia ahora</button></div>
  </div></div>`;
  $('[data-backup]', pane).addEventListener('click', () => download('/backup', null, 'crm-backup.db').catch(toastError));
}

// ---------------- Licencia ----------------
async function license(pane) {
  const lic = await api.get('/license');
  state.license = { ...state.license, ...lic };
  const statusBadge = {
    active: '<span class="badge green">Activa</span>', grace: '<span class="badge red">Caducada (periodo de gracia)</span>', expired: '<span class="badge red">Caducada</span>',
    trial: '<span class="badge blue">Prueba gratuita</span>', trial_expired: '<span class="badge red">Prueba finalizada</span>',
  }[lic.status];
  pane.innerHTML = `
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3 class="grow">Estado de la licencia</h3>${statusBadge}</div><div class="card-body">
        <dl class="props">
          <dt>Plan</dt><dd><b>${esc(lic.planLabel)}</b></dd>
          ${lic.customer ? `<dt>Titular</dt><dd>${esc(lic.customer)}</dd>` : ''}
          ${lic.licenseId ? `<dt>Nº licencia</dt><dd><code>${esc(lic.licenseId)}</code></dd>` : ''}
          <dt>${lic.readOnly ? 'Caducó' : 'Válida hasta'}</dt><dd>${fdate(lic.expires)} ${lic.readOnly ? '' : `<span class="muted">(${lic.daysLeft} días)</span>`}</dd>
          <dt>Usuarios</dt><dd>${lic.seatsUsed} de ${lic.seats}</dd>
          <dt>ID de instalación</dt><dd><code class="small">${esc(lic.instanceId)}</code></dd>
        </dl>
        ${lic.error ? `<div class="badge red" style="height:auto;padding:8px 12px;margin-top:12px;white-space:normal">Licencia guardada no válida: ${esc(lic.error)}</div>` : ''}
        <h3 style="margin:18px 0 8px">Funciones incluidas</h3>
        <div class="stack" style="gap:6px">${Object.entries(lic.allFeatures).map(([k, label]) => `<div class="row small">${lic.features.includes(k) ? `<span style="color:var(--good-text)">${icon('check')}</span>` : `<span class="muted">${icon('x')}</span>`}<span class="${lic.features.includes(k) ? '' : 'muted'}">${esc(label)}</span></div>`).join('')}</div>
      </div></div>
      <div class="stack">
        ${isAdmin() ? `<div class="card"><div class="card-head"><h3>Activar o renovar licencia</h3></div><div class="card-body stack">
          <p class="small text-2" style="margin:0">Pega la clave de licencia que recibiste tras la compra. Si tu proveedor te la pide, facilítale el <b>ID de instalación</b>.</p>
          ${lic.publicKeyLoaded ? '' : '<div class="badge yellow" style="height:auto;padding:8px 12px;white-space:normal">Esta instalación no incluye la clave pública del proveedor (server/license-public.pem), por lo que no se pueden validar licencias.</div>'}
          <textarea data-key rows="4" placeholder="eyJpZCI6…" style="font-family:monospace;font-size:12px"></textarea>
          <div class="row"><span class="spacer"></span>${lic.plan !== 'trial' ? '<button class="btn ghost danger" data-remove>Quitar licencia</button>' : ''}<button class="btn primary" data-activate>${icon('key')}Activar</button></div>
        </div></div>` : ''}
        <div class="card"><div class="card-head"><h3>Planes anuales</h3></div><div class="card-body flush">
          <table class="table"><thead><tr><th>Plan</th><th class="num">Usuarios</th><th>Incluye</th></tr></thead>
          <tbody>${Object.entries(lic.plans).map(([k, p]) => `<tr ${k === lic.plan ? 'style="background:var(--brand-soft)"' : ''}><td><b>${esc(p.label)}</b></td><td class="num">${p.seats}</td><td class="small">${p.features.length === Object.keys(lic.allFeatures).length ? 'Todo' : esc(p.features.map((f) => lic.allFeatures[f].split(/[ ,/]/)[0]).join(', '))}</td></tr>`).join('')}</tbody></table>
        </div></div>
      </div>
    </div>`;
  $('[data-activate]', pane)?.addEventListener('click', async () => {
    const key = $('[data-key]', pane).value.trim();
    if (!key) return;
    try {
      await api.post('/license', { key });
      toast('¡Licencia activada! Gracias por tu confianza.', 'success');
      const { reloadShell } = await import('../main.js');
      await reloadShell();
    } catch (err) { toastError(err); }
  });
  $('[data-remove]', pane)?.addEventListener('click', async () => {
    if (!(await confirmDialog('¿Quitar la licencia de esta instalación?', { okLabel: 'Quitar' }))) return;
    try { await api.del('/license'); const { reloadShell } = await import('../main.js'); await reloadShell(); } catch (err) { toastError(err); }
  });
}

const PANES = { general, users, pipelines, fields, import: importPane, integrations, audit, backup, license };

// ---------------- Perfil ----------------
export async function profile(root) {
  setTitle('Mi perfil');
  const u = state.user;
  const fieldsDef = [
    { key: 'name', label: 'Nombre', required: true },
    { key: 'title', label: 'Cargo' },
    { key: 'phone', label: 'Teléfono' },
    { key: 'color', label: 'Color', type: 'color' },
  ];
  root.innerHTML = `
    <div class="page-head"><div class="row">${avatar(u.name, u.color, 'lg')}<div><h1>${esc(u.name)}</h1><div class="sub">${esc(u.email)} · ${esc(L.role[u.role])}</div></div></div></div>
    <div class="grid cols-2">
      <div class="card"><div class="card-head"><h3>Datos personales</h3></div><div class="card-body">
        <form data-p>${renderForm(fieldsDef, u)}</form>
        <div class="row" style="margin-top:14px"><span class="spacer"></span><button class="btn primary" data-save>Guardar</button></div></div></div>
      <div class="card"><div class="card-head"><h3>Cambiar contraseña</h3></div><div class="card-body">
        <form data-pw class="stack">
          <label class="field"><span>Contraseña actual</span><input type="password" name="current" autocomplete="current-password"></label>
          <label class="field"><span>Nueva contraseña</span><input type="password" name="password" autocomplete="new-password" minlength="8"></label>
          <label class="field"><span>Repite la nueva contraseña</span><input type="password" name="password2" autocomplete="new-password"></label>
          <div class="row"><span class="spacer"></span><button class="btn primary" type="submit">Cambiar contraseña</button></div>
        </form></div></div>
    </div>`;
  $('[data-save]', root).addEventListener('click', async () => {
    try {
      state.user = { ...state.user, ...(await api.patch('/me', readForm($('[data-p]', root), fieldsDef))) };
      await refreshUsers();
      toast('Perfil actualizado', 'success');
      const { reloadShell } = await import('../main.js');
      await reloadShell();
    } catch (err) { toastError(err); }
  });
  $('[data-pw]', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.password.value !== f.password2.value) { toastError(new Error('Las contraseñas no coinciden')); return; }
    try {
      const r = await api.post('/me/password', { current: f.current.value, password: f.password.value });
      auth.token = r.token;
      f.reset();
      toast('Contraseña cambiada. Se ha cerrado la sesión en otros dispositivos.', 'success');
    } catch (err) { toastError(err); }
  });
}
