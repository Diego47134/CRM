import { api } from '../api.js';
import {
  state, $, esc, money, compactMoney, num, setTitle, L, ownerOptions, isManager, hasFeature, icon,
} from '../ui.js';
import { barChart, hbars } from '../charts.js';

const PRESETS = {
  month: () => { const d = new Date(); return [`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, iso(d)]; },
  quarter: () => { const d = new Date(); const q = Math.floor(d.getMonth() / 3) * 3; return [iso(new Date(d.getFullYear(), q, 1)), iso(d)]; },
  year: () => { const d = new Date(); return [`${d.getFullYear()}-01-01`, iso(d)]; },
  last12: () => { const d = new Date(); return [iso(new Date(d.getFullYear() - 1, d.getMonth(), d.getDate() + 1)), iso(d)]; },
  lastyear: () => { const y = new Date().getFullYear() - 1; return [`${y}-01-01`, `${y}-12-31`]; },
};
function iso(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

export async function render(root, query = {}) {
  setTitle('Informes');
  const preset = query.preset || (query.from ? 'custom' : 'year');
  const [from, to] = preset !== 'custom' && PRESETS[preset] ? PRESETS[preset]() : [query.from, query.to];
  const ownerId = query.owner_id || '';
  const r = await api.get('/reports', { from, to, owner_id: ownerId });

  const nav = (patch) => { location.hash = `#/reports?${new URLSearchParams({ preset, from, to, owner_id: ownerId, ...patch })}`; };

  root.innerHTML = `
    <div class="page-head">
      <div class="grow"><h1>Informes</h1><div class="sub">Del ${esc(r.from)} al ${esc(r.to)}</div></div>
      <select data-preset style="width:auto" aria-label="Periodo">
        ${[['month', 'Este mes'], ['quarter', 'Este trimestre'], ['year', 'Este año'], ['last12', 'Últimos 12 meses'], ['lastyear', 'Año pasado'], ['custom', 'Personalizado']].map(([k, l]) => `<option value="${k}" ${k === preset ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <input type="date" data-from value="${esc(r.from)}" style="width:auto" aria-label="Desde">
      <input type="date" data-to value="${esc(r.to)}" style="width:auto" aria-label="Hasta">
      ${isManager() ? `<select data-owner style="width:auto" aria-label="Comercial"><option value="">Todo el equipo</option>${ownerOptions(false).map(([v, l]) => `<option value="${v}" ${v === ownerId ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>` : ''}
      <button class="btn no-print" data-print>${icon('printer')}Imprimir</button>
    </div>

    <div class="grid cols-4" style="margin-bottom:16px">
      <div class="card kpi"><div class="label">Ventas ganadas</div><div class="value">${money(r.totals.won_value)}</div><div class="foot">${num(r.totals.won_count)} oportunidades</div></div>
      <div class="card kpi"><div class="label">Ticket medio</div><div class="value">${money(r.avg_deal)}</div><div class="foot">Por oportunidad ganada</div></div>
      <div class="card kpi"><div class="label">Tasa de cierre</div><div class="value">${r.win_rate == null ? '—' : `${r.win_rate}%`}</div><div class="foot">${num(r.totals.won_count)} ganadas · ${num(r.totals.lost_count)} perdidas</div></div>
      ${hasFeature('quotes')
        ? `<div class="card kpi"><div class="label">Facturado cobrado</div><div class="value">${money(r.invoices.paid)}</div><div class="foot">Pendiente ${money(r.invoices.pending)}${r.invoices.overdue ? ` · <span class="prio-high">vencido ${money(r.invoices.overdue)}</span>` : ''}</div></div>`
        : `<div class="card kpi"><div class="label">Perdidas</div><div class="value">${num(r.totals.lost_count)}</div></div>`}
    </div>

    <div class="card" style="margin-bottom:16px">
      <div class="card-head"><h3 class="grow">Rendimiento por comercial</h3></div>
      <div class="table-wrap"><table class="table">
        <thead><tr><th>Comercial</th><th class="num">Ganadas</th><th class="num">Importe ganado</th><th class="num">Perdidas</th><th class="num">Tasa cierre</th><th class="num">Nuevas</th><th class="num">Abiertas</th><th class="num">Embudo abierto</th><th class="num">Actividades hechas</th></tr></thead>
        <tbody>${r.by_owner.map((o) => {
          const closed = o.won_count + o.lost_count;
          return `<tr><td><span class="owner"><span class="dot" style="background:${esc(o.color || 'var(--muted)')}"></span>${esc(o.name)}</span></td>
            <td class="num">${num(o.won_count)}</td><td class="num"><b>${money(o.won_value)}</b></td><td class="num">${num(o.lost_count)}</td>
            <td class="num">${closed ? `${Math.round((o.won_count / closed) * 100)}%` : '—'}</td><td class="num">${num(o.created_count)}</td>
            <td class="num">${num(o.open_count)}</td><td class="num">${money(o.open_value)}</td><td class="num">${num(o.activities_done)}</td></tr>`;
        }).join('')}</tbody>
      </table></div>
    </div>

    <div class="grid cols-2" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3 class="grow">Ventas ganadas por comercial</h3></div><div class="card-body" id="rep-owner"></div></div>
      <div class="card"><div class="card-head"><h3 class="grow">Previsión de cierre (ponderada)</h3></div><div class="card-body" id="rep-forecast"></div></div>
    </div>
    <div class="grid cols-3" style="margin-bottom:16px">
      <div class="card"><div class="card-head"><h3 class="grow">Embudo (creadas en el periodo)</h3></div><div class="card-body" id="rep-funnel"></div></div>
      <div class="card"><div class="card-head"><h3 class="grow">Motivos de pérdida</h3></div><div class="card-body" id="rep-lost"></div></div>
      <div class="card"><div class="card-head"><h3 class="grow">Ventas por origen</h3></div><div class="card-body" id="rep-source"></div></div>
    </div>
    <div class="grid cols-3">
      <div class="card"><div class="card-head"><h3 class="grow">Actividades completadas</h3></div><div class="card-body" id="rep-acts"></div></div>
      ${hasFeature('quotes') ? `<div class="card"><div class="card-head"><h3 class="grow">Presupuestos</h3></div><div class="card-body">
        <dl class="props"><dt>Emitidos</dt><dd>${num(r.quotes.n)}</dd><dt>Aceptados</dt><dd>${num(r.quotes.accepted || 0)}${r.quotes.n ? ` (${Math.round(((r.quotes.accepted || 0) / r.quotes.n) * 100)}%)` : ''}</dd><dt>Importe total</dt><dd>${money(r.quotes.value)}</dd><dt>Facturas</dt><dd>${num(r.invoices.n)}</dd></dl></div></div>` : ''}
      ${hasFeature('tickets') ? `<div class="card"><div class="card-head"><h3 class="grow">Soporte</h3></div><div class="card-body">
        <dl class="props"><dt>Tickets creados</dt><dd>${num(r.tickets.n)}</dd><dt>Resueltos</dt><dd>${num(r.tickets.resolved || 0)}</dd><dt>Tiempo medio</dt><dd>${r.tickets.avg_hours != null ? `${num(r.tickets.avg_hours, 1)} h` : '—'}</dd></dl></div></div>` : ''}
    </div>`;

  hbars($('#rep-owner', root), r.by_owner.filter((o) => o.won_value > 0).map((o) => ({ label: o.name, value: o.won_value, display: money(o.won_value), dot: o.color })), { emptyText: 'Sin ventas en el periodo' });
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  if (r.forecast.length) {
    barChart($('#rep-forecast', root), r.forecast.map((f) => ({
      label: `${months[Number(f.month.slice(5)) - 1]} ${f.month.slice(2, 4)}`,
      value: f.weighted,
      tip: `${esc(f.month)}: <b>${esc(money(f.weighted))}</b> ponderado · ${esc(money(f.value))} total · ${f.n} oportunidades`,
    })), { format: (v, axis) => (axis ? compactMoney(v) : money(v)), height: 200 });
  } else $('#rep-forecast', root).innerHTML = '<div class="empty" style="padding:20px">No hay oportunidades abiertas con fecha de cierre prevista.</div>';
  hbars($('#rep-funnel', root), r.funnel.map((s) => ({ label: s.name, sub: state.pipelines.length > 1 ? s.pipeline : '', value: s.n, display: `${num(s.n)} · ${compactMoney(s.value)}`, dot: s.color })));
  hbars($('#rep-lost', root), r.lost_reasons.map((l) => ({ label: l.reason, value: l.n, display: `${num(l.n)} · ${compactMoney(l.value)}`, color: 'var(--series-8)' })), { emptyText: 'Sin oportunidades perdidas' });
  hbars($('#rep-source', root), r.by_source.map((s) => ({ label: s.source, value: s.won_value, display: `${money(s.won_value)} · ${num(s.won || 0)}/${num(s.n)}` })), { emptyText: 'Sin datos' });
  hbars($('#rep-acts', root), r.activities_by_type.map((a) => ({ label: L.activityType[a.type] || a.type, value: a.n, display: num(a.n), color: 'var(--series-3)' })), { emptyText: 'Sin actividades completadas' });

  $('[data-preset]', root).addEventListener('change', (e) => nav({ preset: e.target.value }));
  $('[data-from]', root).addEventListener('change', (e) => nav({ preset: 'custom', from: e.target.value }));
  $('[data-to]', root).addEventListener('change', (e) => nav({ preset: 'custom', to: e.target.value }));
  $('[data-owner]', root)?.addEventListener('change', (e) => nav({ owner_id: e.target.value }));
  $('[data-print]', root).addEventListener('click', () => window.print());
}
