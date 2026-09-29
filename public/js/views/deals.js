import { api } from '../api.js';
import {
  state, $, $$, esc, icon, badge, L, ownerCell, tagsHtml, fdate, money, num, setTitle, toast, toastError, avatar, isOverdue,
  promptDialog, listSetting, ownerOptions, hasFeature, dropdown, fdatetime, today,
} from '../ui.js';
import { listView } from '../list.js';
import {
  openDealForm, openActivityForm, deleteRecord, propsList, customProps, timeline, relatedTable, quoteColumns, linkOrDash,
} from './shared.js';

let viewMode = 'board';

export async function render(root, query = {}) {
  setTitle('Oportunidades');
  const pipelineId = Number(query.pipeline) || state.pipelines[0]?.id;
  const pipeline = state.pipelines.find((p) => p.id === pipelineId) || state.pipelines[0];
  if (query.view) viewMode = query.view;

  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Oportunidades</h1><div class="sub" data-summary></div></div>
      ${state.pipelines.length > 1 ? `<select data-pipeline style="width:auto">${state.pipelines.map((p) => `<option value="${p.id}" ${p.id === pipeline.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
      <div class="btn-group">
        <button class="btn ${viewMode === 'board' ? 'active' : ''}" data-mode="board" title="Tablero">${icon('kanban')}<span class="hide-sm">Tablero</span></button>
        <button class="btn ${viewMode === 'list' ? 'active' : ''}" data-mode="list" title="Lista">${icon('list')}<span class="hide-sm">Lista</span></button>
      </div>
      <button class="btn primary" data-new>${icon('plus')}Nueva oportunidad</button>
    </div>
    <div data-body></div>`;

  $('[data-pipeline]', root)?.addEventListener('change', (e) => { location.hash = `#/deals?pipeline=${e.target.value}`; });
  $$('[data-mode]', root).forEach((b) => b.addEventListener('click', () => { viewMode = b.dataset.mode; render(root, { ...query, view: viewMode }); }));
  const body = $('[data-body]', root);
  const reload = () => (viewMode === 'board' ? board(body, pipeline, root) : list(body, pipeline));
  $('[data-new]', root).addEventListener('click', async () => { if (await openDealForm({ pipeline_id: pipeline.id })) reload(); });
  if (query.new) openDealForm({ pipeline_id: pipeline.id }).then((r) => r && reload());
  reload();
}

function list(body, pipeline) {
  listView(body, {
    embedded: true,
    endpoint: '/deals',
    memoryKey: 'list',
    fixedFilters: { pipeline_id: pipeline.id },
    defaultSort: 'created_at',
    hasTags: true,
    filters: [
      { key: 'status', label: 'Estado', options: [['open', 'Abiertas'], ['won', 'Ganadas'], ['lost', 'Perdidas']] },
      { key: 'stage_id', label: 'Etapa', options: pipeline.stages.map((s) => [s.id, s.name]) },
      { key: 'owner_id', label: 'Responsable', options: 'owner' },
    ],
    bulkFields: [{ key: 'stage_id', label: 'Mover a etapa', options: pipeline.stages.map((s) => [s.id, s.name]) }],
    columns: [
      { label: 'Oportunidad', sort: 'title', render: (d) => `<a href="#/deals/${d.id}"><b>${esc(d.title)}</b></a><div class="small muted">${esc(d.company_name || d.contact_name || '')}</div>` },
      { label: 'Etapa', sort: 'stage', render: (d) => `<span class="row nowrap"><span class="dot" style="background:${esc(d.stage_color || 'var(--muted)')}"></span>${esc(d.stage_name)}</span>` },
      { label: 'Importe', sort: 'value', cls: 'num', render: (d) => money(d.value) },
      { label: 'Ponderado', cls: 'num', render: (d) => `<span class="muted">${money(d.weighted_value)}</span>` },
      { label: 'Cierre previsto', sort: 'expected_close', cls: 'nowrap', render: (d) => `<span class="${d.status === 'open' && d.expected_close && d.expected_close < today() ? 'prio-high' : ''}">${fdate(d.expected_close)}</span>` },
      { label: 'Estado', render: (d) => badge(L.dealStatus, d.status) },
      { label: 'Responsable', sort: 'owner', render: (d) => ownerCell(d.owner_id, d.owner_name) },
    ],
    footer: (st) => `<tr><td colspan="3">Total página</td><td class="num">${money(st.rows.reduce((s, d) => s + d.value, 0))}</td><td colspan="5"></td></tr>`,
    rowHref: (d) => `#/deals/${d.id}`,
  });
}

async function board(body, pipeline, root) {
  const ownerFilter = sessionStorageGet('deals_owner') || '';
  body.innerHTML = `
    <div class="row wrap" style="margin-bottom:12px">
      <input type="search" data-q placeholder="Filtrar tablero…" style="max-width:260px">
      <select data-owner style="width:auto"><option value="">Todos los responsables</option><option value="me" ${ownerFilter === 'me' ? 'selected' : ''}>Mis oportunidades</option>
        ${ownerOptions(false).map(([v, l]) => `<option value="${v}" ${ownerFilter === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
      <span class="muted small">Arrastra las tarjetas para cambiar de etapa. Ganadas/perdidas: últimos 30 días.</span>
    </div>
    <div class="kanban" data-kanban></div>`;

  let deals = [];
  const kanban = $('[data-kanban]', body);

  async function load() {
    try {
      const res = await api.get('/deals', { pipeline_id: pipeline.id, board: 30, limit: 500, owner_id: $('[data-owner]', body).value, q: $('[data-q]', body).value });
      deals = res.data;
      draw();
    } catch (err) { toastError(err); }
  }

  function draw() {
    const open = deals.filter((d) => d.status === 'open');
    $('[data-summary]', root).textContent = `${num(open.length)} abiertas · ${money(open.reduce((s, d) => s + d.value, 0))} · ponderado ${money(open.reduce((s, d) => s + d.weighted_value, 0))}`;
    kanban.innerHTML = pipeline.stages.map((s) => {
      const items = deals.filter((d) => d.stage_id === s.id).sort((a, b) => a.position - b.position || a.id - b.id);
      const total = items.reduce((sum, d) => sum + d.value, 0);
      return `<section class="kcol ${s.kind}" data-stage="${s.id}">
        <div class="kcol-head"><div class="name"><span class="dot" style="background:${esc(s.color || 'var(--muted)')}"></span><span class="grow ellipsis">${esc(s.name)}</span><span class="badge">${items.length}</span></div>
          <div class="meta">${money(total)}${s.kind === 'open' ? ` · ${s.probability}%` : ''}</div></div>
        <div class="kcol-body">${items.map(card).join('') || '<div class="muted small" style="padding:8px;text-align:center">Suelta aquí</div>'}</div>
      </section>`;
    }).join('');
  }

  const card = (d) => {
    const late = d.status === 'open' && d.expected_close && d.expected_close < today();
    const u = state.users.find((x) => x.id === d.owner_id);
    return `<article class="kcard" draggable="true" data-deal="${d.id}">
      <a class="title" href="#/deals/${d.id}">${esc(d.title)}</a>
      <div class="meta">${esc(d.company_name || d.contact_name || '')}</div>
      <div class="meta" style="margin-top:6px"><span class="value">${money(d.value)}</span><span class="spacer"></span>
        ${d.next_activity_at ? `<span class="${isOverdue(d.next_activity_at, 0) ? 'late' : ''}" title="Próxima actividad: ${esc(fdatetime(d.next_activity_at))}">${icon('calendar', 'small')}</span>` : `<span class="late" title="Sin actividad planificada">${icon('clock')}</span>`}
        ${d.expected_close ? `<span class="${late ? 'late' : ''}">${fdate(d.expected_close, { day: '2-digit', month: 'short' })}</span>` : ''}
        ${d.owner_name ? avatar(d.owner_name, u?.color, 'sm') : ''}</div>
    </article>`;
  };

  let dragId = null;
  kanban.addEventListener('dragstart', (e) => {
    const c = e.target.closest('.kcard');
    if (!c) return;
    dragId = Number(c.dataset.deal);
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  kanban.addEventListener('dragend', (e) => { e.target.closest('.kcard')?.classList.remove('dragging'); $$('.kcol.drop', kanban).forEach((c) => c.classList.remove('drop')); });
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
    const stageId = Number(col.dataset.stage);
    const deal = deals.find((d) => d.id === dragId);
    dragId = null;
    if (!deal) return;
    // Posición: antes de la tarjeta sobre la que se suelta, o al final
    const over = e.target.closest('.kcard');
    const colDeals = deals.filter((d) => d.stage_id === stageId && d.id !== deal.id).sort((a, b) => a.position - b.position);
    let position;
    if (over && Number(over.dataset.deal) !== deal.id) {
      const idx = colDeals.findIndex((d) => d.id === Number(over.dataset.deal));
      const prev = colDeals[idx - 1];
      position = prev ? (prev.position + colDeals[idx].position) / 2 : colDeals[idx].position - 1;
    } else position = (colDeals.at(-1)?.position ?? 0) + 1;
    await moveDeal(deal, stageId, position, pipeline);
    load();
  });
  kanban.addEventListener('click', (e) => {
    const c = e.target.closest('.kcard');
    if (c && !e.target.closest('a')) location.hash = `#/deals/${c.dataset.deal}`;
  });

  $('[data-owner]', body).addEventListener('change', (e) => { sessionStorageSet('deals_owner', e.target.value); load(); });
  let t;
  $('[data-q]', body).addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  load();
}

async function moveDeal(deal, stageId, position, pipeline) {
  const stage = pipeline.stages.find((s) => s.id === stageId);
  let lostReason;
  if (stage.kind === 'lost' && deal.status !== 'lost') {
    lostReason = await promptDialog('Marcar como perdida', { label: 'Motivo de la pérdida', options: listSetting('lost_reasons'), okLabel: 'Marcar como perdida' });
    if (lostReason === null) return false;
  }
  try {
    await api.post(`/deals/${deal.id}/move`, { stage_id: stageId, position, lost_reason: lostReason });
    if (stage.kind === 'won' && deal.status !== 'won') toast(`🎉 ¡Oportunidad ganada! ${money(deal.value)}`, 'success');
    return true;
  } catch (err) { toastError(err); return false; }
}

function sessionStorageGet(k) { try { return sessionStorage.getItem(k); } catch { return null; } }
function sessionStorageSet(k, v) { try { sessionStorage.setItem(k, v); } catch { /* */ } }

export async function detail(root, id) {
  let d;
  try { d = await api.get(`/deals/${id}`); } catch (err) { root.innerHTML = `<div class="empty">${esc(err.message)}</div>`; return; }
  setTitle(d.title);
  const pipeline = state.pipelines.find((p) => p.id === d.pipeline_id);
  const [quotes, custom] = await Promise.all([
    hasFeature('quotes') ? api.get('/quotes', { deal_id: id, limit: 50 }) : { data: [] },
    customProps('deals', d),
  ]);
  const invoices = hasFeature('quotes') ? await api.get('/quotes', { deal_id: id, kind: 'invoice', limit: 50 }) : { data: [] };
  const stages = pipeline?.stages || [];
  const curIdx = stages.findIndex((s) => s.id === d.stage_id);

  root.innerHTML = `
    <div class="breadcrumb"><a href="#/deals">Oportunidades</a> / ${esc(pipeline?.name || '')}</div>
    <div class="detail-head">
      <div class="grow"><h1>${esc(d.title)} ${badge(L.dealStatus, d.status)}</h1>
        <div class="muted">${money(d.value)} · ${esc(d.company_name || d.contact_name || 'Sin cliente')}${d.status === 'lost' && d.lost_reason ? ` · Motivo: ${esc(d.lost_reason)}` : ''}</div></div>
      ${d.status === 'open' ? `<button class="btn" data-won style="color:var(--good-text)">${icon('check')}Ganada</button><button class="btn" data-lost style="color:var(--bad-text)">${icon('x')}Perdida</button>` : `<button class="btn" data-reopen>${icon('refresh')}Reabrir</button>`}
      ${hasFeature('quotes') ? `<a class="btn" href="#/quotes/new?deal_id=${d.id}">${icon('file')}Presupuesto</a>` : ''}
      <div class="dropdown"><button class="btn icon-only" data-more aria-label="Más acciones">${icon('more')}</button></div>
    </div>
    <div class="stage-bar" role="group" aria-label="Etapas">${stages.map((s, i) => `<button data-stage="${s.id}" class="${s.kind} ${i === curIdx ? 'current' : (i < curIdx && d.status === 'open' ? 'passed' : '')}" title="${esc(s.name)}">${esc(s.name)}</button>`).join('')}</div>
    <div class="grid detail">
      <div class="stack">
        <div class="card"><div class="card-head"><h3 class="grow">Detalles</h3><button class="btn ghost sm" data-edit>${icon('edit')}Editar</button></div>
          <div class="card-body">${propsList([
            ['Importe', `<b>${money(d.value)}</b>`], ['Probabilidad', `${d.probability}% · ponderado ${money(d.weighted_value)}`],
            ['Cierre previsto', d.expected_close ? `<span class="${d.status === 'open' && d.expected_close < today() ? 'prio-high' : ''}">${fdate(d.expected_close)}</span>` : null],
            ['Cerrada', d.closed_at ? fdate(d.closed_at) : null],
            ['Contacto', d.contact_id ? linkOrDash(`#/contacts/${d.contact_id}`, d.contact_name) : null],
            ['Empresa', d.company_id ? linkOrDash(`#/companies/${d.company_id}`, d.company_name) : null],
            ['Responsable', ownerCell(d.owner_id, d.owner_name)], ['Prioridad', badge(L.priority, d.priority)],
            ['Origen', esc(d.source || '')], ['Etiquetas', tagsHtml(d.tags)], ...custom, ['Creada', fdate(d.created_at)],
          ])}
          ${d.description ? `<p class="small" style="white-space:pre-wrap;margin:14px 0 0">${esc(d.description)}</p>` : ''}</div></div>
        ${hasFeature('quotes') ? `<div class="card"><div class="card-head"><h3 class="grow">Presupuestos y facturas</h3></div>
          <div class="card-body flush">${relatedTable([...quotes.data, ...invoices.data], quoteColumns, 'Sin documentos. Crea un presupuesto para esta oportunidad.')}</div></div>` : ''}
      </div>
      <div data-timeline></div>
    </div>`;

  const defaults = {};
  if (d.contact_id) defaults.contact_id = d.contact_id;
  if (d.company_id) defaults.company_id = d.company_id;
  timeline($('[data-timeline]', root), { key: 'deal_id', id: d.id, defaults });

  const refresh = () => detail(root, id);
  $('[data-edit]', root).addEventListener('click', async () => { if (await openDealForm(d)) refresh(); });
  $$('[data-stage]', root).forEach((b) => b.addEventListener('click', async () => {
    const sid = Number(b.dataset.stage);
    if (sid !== d.stage_id && await moveDeal(d, sid, Date.now(), pipeline)) refresh();
  }));
  const won = stages.find((s) => s.kind === 'won');
  const lost = stages.find((s) => s.kind === 'lost');
  $('[data-won]', root)?.addEventListener('click', async () => { if (won && await moveDeal(d, won.id, Date.now(), pipeline)) refresh(); });
  $('[data-lost]', root)?.addEventListener('click', async () => { if (lost && await moveDeal(d, lost.id, Date.now(), pipeline)) refresh(); });
  $('[data-reopen]', root)?.addEventListener('click', async () => {
    const first = stages.find((s) => s.kind === 'open');
    if (first && await moveDeal(d, first.id, Date.now(), pipeline)) refresh();
  });
  dropdown($('[data-more]', root), `
    <button data-act>${icon('calendar')}Programar actividad</button>
    <button data-del>${icon('trash')}Eliminar oportunidad</button>`, (m) => {
    $('[data-act]', m).addEventListener('click', async () => {
      if (await openActivityForm({ deal_id: d.id, deal_title: d.title, ...defaults, contact_name: d.contact_name, company_name: d.company_name })) refresh();
    });
    $('[data-del]', m).addEventListener('click', async () => {
      if (await deleteRecord('/deals', d.id, `la oportunidad «${d.title}»`)) location.hash = '#/deals';
    });
  });
}
