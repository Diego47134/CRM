import { api } from '../api.js';
import {
  state, $, esc, icon, money, compactMoney, num, fdatetime, ago, avatar, activityIcon, isOverdue, setTitle, hasFeature,
} from '../ui.js';
import { barChart, hbars } from '../charts.js';

const ENTITY_LINK = { contacts: 'contacts', companies: 'companies', deals: 'deals', tickets: 'tickets', quotes: 'quotes', invoices: 'invoices' };
const ENTITY_LABEL = { contacts: 'contacto', companies: 'empresa', deals: 'oportunidad', tickets: 'ticket', quotes: 'presupuesto', invoices: 'factura' };
const ACTION_LABEL = { created: 'creó', updated: 'actualizó', stage_changed: 'movió' };

export async function render(root, query = {}) {
  setTitle('Panel');
  const mine = query.mine === '1';
  const pipelineId = query.pipeline_id || '';
  const d = await api.get('/dashboard', { mine: mine ? 1 : '', pipeline_id: pipelineId });
  const k = d.kpis;
  const hour = new Date().getHours();
  const greet = hour < 13 ? 'Buenos días' : hour < 20 ? 'Buenas tardes' : 'Buenas noches';

  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>${greet}, ${esc(state.user.name.split(' ')[0])}</h1><div class="sub">Resumen de tu actividad comercial</div></div>
      <div class="btn-group">
        <a class="btn ${mine ? '' : 'active'}" href="#/">Todo el equipo</a>
        <a class="btn ${mine ? 'active' : ''}" href="#/?mine=1">Solo lo mío</a>
      </div>
    </div>

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Valor del embudo</div><a class="value" href="#/deals">${money(k.pipeline_value)}</a><div class="foot">${num(k.open_deals)} oportunidades abiertas</div></div>
      <div class="card kpi"><div class="label">Previsión ponderada</div><div class="value">${money(k.weighted_value)}</div><div class="foot">Según probabilidad de cada etapa</div></div>
      <div class="card kpi"><div class="label">Ganado este mes</div><div class="value">${money(k.won_month_value)}</div><div class="foot">${num(k.won_month_count)} oportunidades ganadas</div></div>
      <div class="card kpi"><div class="label">Tasa de cierre (90 días)</div><div class="value">${k.win_rate == null ? '—' : `${k.win_rate}%`}</div><div class="foot">Ganadas sobre cerradas</div></div>
    </div>
    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Actividades vencidas</div><a class="value" href="#/activities?when=overdue" style="${k.tasks_overdue ? 'color:var(--bad-text)' : ''}">${num(k.tasks_overdue)}</a><div class="foot">Pendientes con fecha pasada</div></div>
      <div class="card kpi"><div class="label">Actividades para hoy</div><a class="value" href="#/activities?when=today">${num(k.tasks_today)}</a><div class="foot">Llamadas, reuniones y tareas</div></div>
      <div class="card kpi"><div class="label">Nuevos contactos (mes)</div><a class="value" href="#/contacts">${num(k.new_contacts_month)}</a><div class="foot">Altas desde el día 1</div></div>
      ${k.open_tickets != null
        ? `<div class="card kpi"><div class="label">Tickets abiertos</div><a class="value" href="#/tickets">${num(k.open_tickets)}</a><div class="foot">Abiertos o pendientes</div></div>`
        : `<div class="card kpi"><div class="label">Oportunidades abiertas</div><a class="value" href="#/deals">${num(k.open_deals)}</a><div class="foot">En todos los embudos</div></div>`}
    </div>

    <div class="grid cols-2" style="margin-bottom:16px">
      <div class="card">
        <div class="card-head"><h3 class="grow">Ventas ganadas · últimos 12 meses</h3></div>
        <div class="card-body"><div id="chart-won"></div></div>
      </div>
      <div class="card">
        <div class="card-head"><h3 class="grow">Embudo por etapa</h3>
          ${state.pipelines.length > 1 ? `<select id="dash-pipeline" style="width:auto">${state.pipelines.map((p) => `<option value="${p.id}" ${p.id === d.pipeline_id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
        </div>
        <div class="card-body"><div id="chart-stages"></div></div>
      </div>
    </div>

    <div class="grid cols-3">
      <div class="card">
        <div class="card-head"><h3 class="grow">Mis próximas actividades</h3><a class="small" href="#/activities">Ver todas</a></div>
        <div class="card-body flush" id="upcoming"></div>
      </div>
      <div class="card">
        <div class="card-head">${icon('trophy')}<h3 class="grow">Ranking del mes</h3></div>
        <div class="card-body" id="leaderboard"></div>
      </div>
      <div class="card">
        <div class="card-head"><h3 class="grow">Origen de los contactos</h3></div>
        <div class="card-body" id="sources"></div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <div class="card-head"><h3 class="grow">Actividad reciente del equipo</h3>${hasFeature('audit') ? '<a class="small" href="#/settings/audit">Registro completo</a>' : ''}</div>
      <div class="card-body flush" id="recent"></div>
    </div>`;

  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  barChart($('#chart-won', root), d.won_by_month.map((m) => ({
    label: months[Number(m.month.slice(5)) - 1],
    value: m.value,
    tip: `${months[Number(m.month.slice(5)) - 1]} ${m.month.slice(0, 4)}: <b>${esc(money(m.value))}</b> · ${m.n} ganadas`,
  })), { format: (v, axis) => (axis ? compactMoney(v) : money(v)) });

  hbars($('#chart-stages', root), d.by_stage.map((s) => ({ label: s.name, value: s.value, display: `${money(s.value)} · ${s.n}`, dot: s.color })), { emptyText: 'Sin etapas abiertas' });

  $('#upcoming', root).innerHTML = d.upcoming.length
    ? d.upcoming.map((a) => `<a href="#/activities" class="row" style="padding:10px 16px;border-bottom:1px solid var(--border);color:var(--text)">
        ${icon(activityIcon(a.type))}
        <div class="grow"><div class="ellipsis">${esc(a.subject)}</div><div class="small ${isOverdue(a.due_at, a.done) ? 'prio-high' : 'muted'}">${a.due_at ? fdatetime(a.due_at) : 'Sin fecha'}${a.contact_name ? ` · ${esc(a.contact_name)}` : ''}</div></div>
      </a>`).join('')
    : '<div class="empty">No tienes actividades pendientes</div>';

  hbars($('#leaderboard', root), d.leaderboard.map((u) => ({ label: u.name, value: u.value, display: `${money(u.value)} · ${u.n}`, dot: u.color })), { emptyText: 'Sin ventas este mes' });
  hbars($('#sources', root), d.sources.map((s) => ({ label: s.source, value: s.n, display: num(s.n) })), { emptyText: 'Sin contactos' });

  $('#recent', root).innerHTML = d.recent.length
    ? `<div class="table-wrap"><table class="table"><tbody>${d.recent.map((r) => {
      const link = ENTITY_LINK[r.entity] && r.entity_id ? `#/${ENTITY_LINK[r.entity]}/${r.entity_id}` : null;
      const u = state.users.find((x) => x.id === r.user_id);
      return `<tr><td style="width:36px">${avatar(r.user_name || '?', u?.color, 'sm')}</td>
        <td><b>${esc(r.user_name || 'Sistema')}</b> ${ACTION_LABEL[r.action] || esc(r.action)} ${ENTITY_LABEL[r.entity] || esc(r.entity)} ${link ? `<a href="${link}">${esc(r.summary || '')}</a>` : esc(r.summary || '')}</td>
        <td class="muted small nowrap right">${ago(r.created_at)}</td></tr>`;
    }).join('')}</tbody></table></div>`
    : '<div class="empty">Sin actividad todavía</div>';

  $('#dash-pipeline', root)?.addEventListener('change', (e) => {
    location.hash = `#/?${new URLSearchParams({ ...(mine ? { mine: 1 } : {}), pipeline_id: e.target.value })}`;
  });
}
