import { esc } from './ui.js';

const niceMax = (v) => {
  if (v <= 0) return 1;
  const exp = 10 ** Math.floor(Math.log10(v));
  const f = v / exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
};

/**
 * Gráfico de barras verticales (una serie). data: [{label, value, tip}]
 * Incluye rejilla, eje y tooltip al pasar el ratón.
 */
export function barChart(el, data, { format = (v) => v, height = 220, color = 'var(--series-1)', highlightLast = false } = {}) {
  const W = 640; const H = height; const padL = 56; const padB = 26; const padT = 12; const padR = 8;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const innerW = W - padL - padR; const innerH = H - padT - padB;
  const step = innerW / Math.max(data.length, 1);
  const bw = Math.min(36, step * 0.62);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const y = (v) => padT + innerH - (v / max) * innerH;
  const bars = data.map((d, i) => {
    const x = padL + i * step + (step - bw) / 2;
    const h = Math.max(0, innerH - (y(d.value) - padT));
    const r = Math.min(4, h / 2);
    const top = y(d.value);
    const path = h > 0
      ? `M${x},${padT + innerH} V${top + r} Q${x},${top} ${x + r},${top} H${x + bw - r} Q${x + bw},${top} ${x + bw},${top + r} V${padT + innerH} Z`
      : '';
    const fill = highlightLast && i !== data.length - 1 ? 'color-mix(in srgb, ' + color + ' 55%, transparent)' : color;
    return `<g data-i="${i}"><rect class="hit" x="${padL + i * step}" y="${padT}" width="${step}" height="${innerH}"></rect>${path ? `<path class="bar" d="${path}" fill="${fill}"></path>` : ''}
      <text class="tick" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text></g>`;
  }).join('');
  el.classList.add('chart');
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfico de barras">
    ${ticks.map((t) => `<line class="gridline" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"></line><text class="tick" x="${padL - 8}" y="${y(t) + 4}" text-anchor="end">${esc(format(t, true))}</text>`).join('')}
    <line class="baseline" x1="${padL}" x2="${W - padR}" y1="${padT + innerH}" y2="${padT + innerH}"></line>
    ${bars}</svg><div class="chart-tip hidden"></div>`;
  const tip = el.querySelector('.chart-tip');
  const svg = el.querySelector('svg');
  svg.addEventListener('mousemove', (e) => {
    const g = e.target.closest('g[data-i]');
    if (!g) { tip.classList.add('hidden'); return; }
    const d = data[Number(g.dataset.i)];
    tip.innerHTML = d.tip || `${esc(d.label)}: <b>${esc(format(d.value))}</b>`;
    const rect = el.getBoundingClientRect();
    tip.style.left = `${e.clientX - rect.left}px`;
    tip.style.top = `${e.clientY - rect.top - 8}px`;
    tip.classList.remove('hidden');
  });
  svg.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

/** Barras horizontales en HTML (ranking, embudo, orígenes). data: [{label, value, display, color, sub}] */
export function hbars(el, data, { format = (v) => v, emptyText = 'Sin datos' } = {}) {
  if (!data.length) { el.innerHTML = `<div class="empty" style="padding:20px">${esc(emptyText)}</div>`; return; }
  const max = Math.max(...data.map((d) => d.value), 0) || 1;
  el.innerHTML = `<div class="hbars">${data.map((d) => `
    <div class="hbar" title="${esc(d.label)}: ${esc(d.display ?? format(d.value))}">
      <div class="top"><span class="ellipsis">${d.dot ? `<span class="dot" style="background:${esc(d.dot)};margin-right:6px"></span>` : ''}${esc(d.label)}${d.sub ? ` <span class="muted small">${esc(d.sub)}</span>` : ''}</span><b class="num">${esc(d.display ?? format(d.value))}</b></div>
      <div class="track"><div class="fill" style="width:${Math.max(d.value > 0 ? 2 : 0, (d.value / max) * 100)}%;${d.color ? `background:${esc(d.color)}` : ''}"></div></div>
    </div>`).join('')}</div>`;
}
