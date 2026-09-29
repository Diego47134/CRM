import { api, download } from './api.js';
import {
  $, $$, esc, icon, toastError, toast, confirmDialog, emptyState, ownerOptions, num, hasFeature, promptDialog, setTitle,
} from './ui.js';

const memory = new Map();

/**
 * Vista de listado genérica: búsqueda, filtros, orden, paginación, selección múltiple,
 * acciones masivas y exportación CSV.
 */
export function listView(host, cfg) {
  // Contenedor nuevo en cada llamada para no acumular manejadores de eventos
  host.innerHTML = '<div></div>';
  const root = host.firstElementChild;
  const saved = memory.get(cfg.endpoint + (cfg.memoryKey || '')) || {};
  const st = {
    q: saved.q || '',
    page: 1,
    limit: cfg.pageSize || 25,
    sort: saved.sort || cfg.defaultSort || '',
    dir: saved.dir || cfg.defaultDir || 'desc',
    filters: { ...Object.fromEntries((cfg.filters || []).filter((f) => f.default !== undefined).map((f) => [f.key, f.default])), ...(saved.filters || {}), ...(cfg.fixedFilters || {}) },
    selected: new Set(),
    rows: [],
    total: 0,
  };
  const persist = () => memory.set(cfg.endpoint + (cfg.memoryKey || ''), { q: st.q, sort: st.sort, dir: st.dir, filters: st.filters });

  if (cfg.title) setTitle(cfg.title);

  const filterHtml = (cfg.filters || []).map((f) => {
    const list = f.options === 'owner' ? [['me', 'Mis registros'], ...ownerOptions(false), ['none', 'Sin asignar']] : (typeof f.options === 'function' ? f.options() : f.options);
    return `<select data-filter="${esc(f.key)}" aria-label="${esc(f.label)}"><option value="">${esc(f.label)}: todos</option>${list.map(([v, l]) => `<option value="${esc(v)}" ${String(st.filters[f.key] ?? '') === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
  }).join('');

  const canExport = cfg.exportable !== false && hasFeature('import_export');

  root.innerHTML = `
    ${cfg.embedded ? '' : `<div class="page-head">
      <div class="grow"><h1>${esc(cfg.title)}</h1><div class="sub" data-count></div></div>
      ${cfg.headerActions || ''}
      ${canExport ? `<button class="btn" data-export>${icon('download')}<span class="hide-sm">Exportar</span></button>` : ''}
      ${cfg.onNew ? `<button class="btn primary" data-new>${icon('plus')}${esc(cfg.newLabel || 'Nuevo')}</button>` : ''}
    </div>`}
    <div class="card">
      <div class="toolbar">
        <input type="search" data-q placeholder="${esc(cfg.searchPlaceholder || 'Buscar…')}" value="${esc(st.q)}">
        ${filterHtml}
        ${cfg.extraToolbar || ''}
        <span class="spacer"></span>
        ${cfg.embedded && cfg.onNew ? `<button class="btn sm primary" data-new>${icon('plus')}${esc(cfg.newLabel || 'Nuevo')}</button>` : ''}
      </div>
      <div class="bulkbar hidden" data-bulk></div>
      <div class="table-wrap"><table class="table"><thead></thead><tbody></tbody>${cfg.footer ? '<tfoot></tfoot>' : ''}</table></div>
      <div class="pager" data-pager></div>
    </div>`;

  const thead = $('thead', root);
  const tbody = $('tbody', root);
  const bulkEnabled = cfg.bulk !== false;

  function renderHead() {
    thead.innerHTML = `<tr>
      ${bulkEnabled ? '<th class="check"><input type="checkbox" data-all aria-label="Seleccionar todo"></th>' : ''}
      ${cfg.columns.map((c) => {
        const active = c.sort && st.sort === c.sort;
        return `<th class="${c.sort ? 'sortable' : ''} ${c.cls || ''}" ${c.sort ? `data-sort="${esc(c.sort)}"` : ''}>${esc(c.label)}${active ? `<span class="arrow">${st.dir === 'asc' ? '↑' : '↓'}</span>` : ''}</th>`;
      }).join('')}
      ${cfg.rowActions ? '<th class="actions"></th>' : ''}
    </tr>`;
  }

  function renderBody() {
    if (!st.rows.length) {
      tbody.innerHTML = `<tr><td colspan="${cfg.columns.length + 2}">${emptyState(st.q || Object.values(st.filters).some(Boolean) ? 'No hay resultados con estos filtros' : (cfg.emptyText || 'Todavía no hay registros'), cfg.emptyIcon || 'search')}</td></tr>`;
    } else {
      tbody.innerHTML = st.rows.map((r) => `<tr class="${cfg.rowHref || cfg.onRowClick ? 'clickable' : ''}" data-id="${r.id}">
        ${bulkEnabled ? `<td class="check"><input type="checkbox" data-sel="${r.id}" ${st.selected.has(r.id) ? 'checked' : ''} aria-label="Seleccionar"></td>` : ''}
        ${cfg.columns.map((c) => `<td class="${c.cls || ''}">${c.render ? c.render(r) : esc(r[c.key] ?? '')}</td>`).join('')}
        ${cfg.rowActions ? `<td class="actions">${cfg.rowActions(r)}</td>` : ''}
      </tr>`).join('');
    }
    if (cfg.footer) $('tfoot', root).innerHTML = cfg.footer(st);
    const pages = Math.max(1, Math.ceil(st.total / st.limit));
    const from = st.total ? (st.page - 1) * st.limit + 1 : 0;
    $('[data-pager]', root).innerHTML = `
      <span>${num(from)}–${num(Math.min(st.page * st.limit, st.total))} de ${num(st.total)}</span>
      <span class="spacer"></span>
      <select data-limit aria-label="Filas por página" style="width:auto">${[25, 50, 100, 200].map((n) => `<option ${n === st.limit ? 'selected' : ''}>${n}</option>`).join('')}</select>
      <button class="btn sm icon-only" data-prev ${st.page <= 1 ? 'disabled' : ''} aria-label="Anterior">${icon('left')}</button>
      <span>${st.page} / ${pages}</span>
      <button class="btn sm icon-only" data-next ${st.page >= pages ? 'disabled' : ''} aria-label="Siguiente">${icon('right')}</button>`;
    const countEl = $('[data-count]', root);
    if (countEl) countEl.textContent = `${num(st.total)} ${st.total === 1 ? (cfg.singular || 'registro') : (cfg.plural || 'registros')}${cfg.subtitle ? ` · ${cfg.subtitle(st)}` : ''}`;
    renderBulk();
  }

  function renderBulk() {
    const bar = $('[data-bulk]', root);
    if (!bulkEnabled || !st.selected.size) { bar.classList.add('hidden'); return; }
    bar.classList.remove('hidden');
    const fields = cfg.bulkFields || [];
    bar.innerHTML = `<span>${st.selected.size} seleccionados</span>
      ${cfg.hasOwner !== false ? `<select data-bulk-owner style="width:auto"><option value="">Asignar a…</option>${ownerOptions(false).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>` : ''}
      ${fields.map((f) => `<select data-bulk-field="${esc(f.key)}" style="width:auto"><option value="">${esc(f.label)}…</option>${f.options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`).join('')}
      ${cfg.hasTags ? `<button class="btn sm" data-bulk-tag>Añadir etiqueta</button>` : ''}
      <button class="btn sm danger" data-bulk-delete>${icon('trash')}Eliminar</button>
      <span class="spacer"></span><button class="btn sm ghost" data-bulk-clear>Deseleccionar</button>`;
  }

  async function load() {
    try {
      const res = await api.get(cfg.endpoint, { q: st.q, page: st.page, limit: st.limit, sort: st.sort, dir: st.dir, ...st.filters });
      st.rows = res.data;
      st.total = res.total;
      st.extra = res;
      renderHead();
      renderBody();
    } catch (err) { toastError(err); }
  }

  async function bulk(action, extra) {
    try {
      const res = await api.post(`${cfg.endpoint}/bulk`, { ids: [...st.selected], action, ...extra });
      toast(`${res.affected} registros actualizados`, 'success');
      st.selected.clear();
      load();
    } catch (err) { toastError(err); }
  }

  const reloadDebounced = (() => { let t; return () => { clearTimeout(t); t = setTimeout(() => { st.page = 1; persist(); load(); }, 250); }; })();

  root.addEventListener('input', (e) => {
    if (e.target.matches('[data-q]')) { st.q = e.target.value; reloadDebounced(); }
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.matches('[data-filter]')) { st.filters[t.dataset.filter] = t.value; st.page = 1; persist(); load(); }
    else if (t.matches('[data-limit]')) { st.limit = Number(t.value); st.page = 1; load(); }
    else if (t.matches('[data-all]')) { st.rows.forEach((r) => (t.checked ? st.selected.add(r.id) : st.selected.delete(r.id))); renderBody(); }
    else if (t.matches('[data-sel]')) { const id = Number(t.dataset.sel); t.checked ? st.selected.add(id) : st.selected.delete(id); renderBulk(); }
    else if (t.matches('[data-bulk-owner]') && t.value) bulk('update', { data: { owner_id: Number(t.value) } });
    else if (t.matches('[data-bulk-field]') && t.value) bulk('update', { data: { [t.dataset.bulkField]: t.value } });
  });
  root.addEventListener('click', async (e) => {
    const t = e.target;
    const sortTh = t.closest('th[data-sort]');
    if (sortTh) {
      const key = sortTh.dataset.sort;
      if (st.sort === key) st.dir = st.dir === 'asc' ? 'desc' : 'asc'; else { st.sort = key; st.dir = 'asc'; }
      persist(); load(); return;
    }
    if (t.closest('[data-prev]')) { st.page--; load(); return; }
    if (t.closest('[data-next]')) { st.page++; load(); return; }
    if (t.closest('[data-new]')) { const r = await cfg.onNew(); if (r) load(); return; }
    if (t.closest('[data-export]')) {
      try { await download(cfg.exportPath || `${cfg.endpoint}/export.csv`, { q: st.q, sort: st.sort, dir: st.dir, ...st.filters }, 'export.csv'); } catch (err) { toastError(err); }
      return;
    }
    if (t.closest('[data-bulk-clear]')) { st.selected.clear(); renderBody(); return; }
    if (t.closest('[data-bulk-delete]')) {
      if (await confirmDialog(`¿Eliminar ${st.selected.size} registros? Esta acción no se puede deshacer.`)) bulk('delete');
      return;
    }
    if (t.closest('[data-bulk-tag]')) {
      const tag = await promptDialog('Añadir etiqueta', { label: 'Etiqueta' });
      if (tag) bulk('add_tag', { tag });
      return;
    }
    if (t.closest('input, button, a, select, .actions')) {
      const act = t.closest('[data-row-action]');
      if (act && cfg.onRowAction) {
        const row = st.rows.find((r) => r.id === Number(act.closest('tr').dataset.id));
        const changed = await cfg.onRowAction(act.dataset.rowAction, row);
        if (changed) load();
      }
      return;
    }
    const tr = t.closest('tbody tr[data-id]');
    if (tr) {
      const row = st.rows.find((r) => r.id === Number(tr.dataset.id));
      if (cfg.onRowClick) { if (await cfg.onRowClick(row)) load(); } else if (cfg.rowHref) location.hash = cfg.rowHref(row);
    }
  });

  renderHead();
  load();
  return { reload: load, state: st };
}

export { $$ };
