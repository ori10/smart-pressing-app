// Graphiques SVG légers (sans bibliothèque) : barres groupées, barres +/−, répartition, barres horizontales.
// Un toucher sur une barre affiche sa valeur (bulle).
export const C = { ca: '#1c5fa6', wash: '#f08a24', exp: '#7a4fb8', pos: '#14855a', neg: '#c0392b', grid: '#e6ebf2', ink: '#667385' };

const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
export function short(n) {
  const a = Math.abs(n), s = n < 0 ? '−' : '';
  if (a >= 1e6) return s + (a / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' M';
  if (a >= 1e3) return s + (a / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) + ' k';
  return s + Math.round(a);
}

// Barre à coins arrondis côté valeur, ancrée sur la ligne de base.
function bar(x, y0, y1, w, r = 4) {
  const top = Math.min(y0, y1), bot = Math.max(y0, y1), h = bot - top;
  if (h < 0.5) return `M${x},${y0}h${w}`;
  r = Math.min(r, w / 2, h);
  if (y1 < y0) return `M${x},${bot}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bot}Z`;
  return `M${x},${top}V${bot - r}Q${x},${bot} ${x + r},${bot}H${x + w - r}Q${x + w},${bot} ${x + w},${bot - r}V${top}Z`;
}

function legend(series) {
  if (series.length < 2) return '';
  return `<div class="legend">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// labels: ['jan', …] ; series: [{ name, color, values, colorFn? }] ; fmt: valeur → texte de bulle
export function barChart({ labels, tips, series, fmt, height = 190, highlight = -1, every = 1 }) {
  const W = 340, H = height, L = 36, R = 6, T = 10, B = 24;
  const all = series.flatMap((s) => s.values);
  const max = niceMax(Math.max(0, ...all)), min = Math.min(0, ...all) < 0 ? -niceMax(-Math.min(...all)) : 0;
  const y = (v) => T + (H - T - B) * (max - v) / (max - min || 1);
  const n = labels.length, slot = (W - L - R) / n, gap = series.length > 1 ? 2 : 0;
  const groupW = Math.max(2, slot * (n > 20 ? 0.7 : 0.62));
  const bw = (groupW - gap * (series.length - 1)) / series.length;
  const ticks = min < 0 ? [min, 0, max] : [0, max / 2, max];
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">`;
  for (const t of ticks) svg += `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="${t === 0 ? '#c9d2de' : C.grid}" stroke-width="1"/><text x="${L - 5}" y="${y(t) + 3.5}" text-anchor="end" class="ax">${short(t)}</text>`;
  labels.forEach((lab, i) => {
    const gx = L + slot * i + (slot - groupW) / 2;
    series.forEach((s, k) => {
      const v = s.values[i] || 0;
      const col = s.colorFn ? s.colorFn(v) : s.color;
      const x = gx + k * (bw + gap);
      svg += `<path d="${bar(x, y(0), y(v), bw, Math.min(4, bw / 2))}" fill="${col}" opacity="${highlight >= 0 && i !== highlight ? 0.55 : 1}"/>`;
    });
    // zone tactile sur toute la colonne
    const tip = (tips ? tips[i] : lab) + '\n' + series.map((s) => `${s.name} : ${fmt(s.values[i] || 0)}`).join('\n');
    svg += `<rect x="${L + slot * i}" y="${T}" width="${slot}" height="${H - T - B}" fill="transparent" data-tip="${esc(tip)}"/>`;
    if (i % every === 0 || i === n - 1 && n <= 12) svg += `<text x="${L + slot * i + slot / 2}" y="${H - 8}" text-anchor="middle" class="ax">${esc(lab)}</text>`;
  });
  return svg + '</svg>' + legend(series);
}

// Barre de répartition (100 %) avec légende chiffrée.
export function splitBar(parts, fmt) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  if (!total) return '<p class="muted small">Pas encore de données.</p>';
  const segs = parts.filter((p) => p.value > 0).map((p) => `<i style="width:${(p.value / total) * 100}%;background:${p.color}" data-tip="${esc(p.name + '\n' + fmt(p.value) + ' · ' + Math.round((p.value / total) * 100) + ' %')}"></i>`).join('');
  return `<div class="split">${segs}</div><div class="split-legend">${parts.map((p) => `<div><span><i style="background:${p.color}"></i>${esc(p.name)}</span><b>${fmt(p.value)}</b><em>${total ? Math.round((Math.max(0, p.value) / total) * 100) : 0} %</em></div>`).join('')}</div>`;
}

// Barres horizontales (classements).
export function hbars(rows, fmt, color = C.ca) {
  const max = Math.max(1, ...rows.map((r) => r[1]));
  return rows.map(([n, v]) => `<div class="hbar" data-tip="${esc(n + '\n' + fmt(v))}"><span class="lbl">${esc(n)}</span><span class="track"><i style="width:${(v / max) * 100}%;background:${color}"></i></span><b>${fmt(v)}</b></div>`).join('');
}

// Bulle : un seul écouteur pour tout l'écran.
let tipEl = null;
export function enableTips(root) {
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tip]');
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    if (!t) { tipEl.style.display = 'none'; return; }
    tipEl.innerHTML = esc(t.getAttribute('data-tip')).replace(/\n/g, '<br>');
    tipEl.style.display = 'block';
    const r = t.getBoundingClientRect();
    const tw = tipEl.offsetWidth;
    tipEl.style.left = Math.max(8, Math.min(window.innerWidth - tw - 8, r.left + r.width / 2 - tw / 2)) + 'px';
    tipEl.style.top = (window.scrollY + r.top - tipEl.offsetHeight - 8) + 'px';
  });
  window.addEventListener('hashchange', () => { if (tipEl) tipEl.style.display = 'none'; });
}
