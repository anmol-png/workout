/**
 * charts.js — inline SVG charts, hand-rolled, zero dependencies.
 *
 * No charting library, for the same reason there's no build step: this app has to work offline
 * forever, and every dependency is one more thing that can break the app shell.
 *
 * COLOURS: the data palette below was validated with the dataviz palette validator against the
 * dark chart surface (#161b23) — lightness band, chroma floor, CVD separation, normal-vision
 * floor and contrast all pass. Do not substitute "nicer" hexes without re-running it.
 *
 * Deliberately absent: red. Red-vs-green fails deuteranopia separation badly (ΔE 1.8), which is
 * the single most common colorblind chart failure. Red is reserved for destructive UI actions
 * and never encodes data here.
 */

export const C = {
  series1: '#4a90e2',  // blue   — primary series, "under target"
  series2: '#2fae63',  // green  — "in target band"
  series3: '#bf8615',  // amber  — "over target"
  grid: '#262f3d',
  axis: '#5c6675',
  text: '#8b96a7',
  surface: '#161b23',
};

const NS = 'http://www.w3.org/2000/svg';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function niceTicks(min, max, count = 4) {
  if (min === max) return [min];
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

function shortDate(iso) {
  const [, m, d] = iso.split('-');
  return `${Number(d)}/${Number(m)}`;
}

/**
 * Line chart with an optional secondary series and an optional target band.
 *
 * @param {Array<{date:string, value:number}>} series   primary series (the one that matters)
 * @param {object} opts
 *   - series2: same shape, drawn thinner/dimmer (e.g. daily weights under a rolling average)
 *   - label, label2: series names for the legend (legend only rendered when both exist)
 *   - band: {from:number, to:number, label:string} — a target corridor drawn behind the data
 *   - unit: appended to tooltip values
 *   - dots: draw markers on the primary series (off for dense series)
 * @returns {string} SVG markup
 */
export function lineChart(series, opts = {}) {
  const { series2 = null, label = '', label2 = '', band = null, unit = '', dots = true } = opts;

  if (!series.length) {
    return `<div class="empty small">Not enough data yet.</div>`;
  }
  if (series.length === 1) {
    const p = series[0];
    return `<div class="empty small">One data point so far (${fmt(p.value)}${unit}).<br>
      The chart appears once there are two.</div>`;
  }

  const W = 340, H = 176;
  const M = { t: 10, r: 12, b: 24, l: 34 };
  const iw = W - M.l - M.r;
  const ih = H - M.t - M.b;

  const all = [...series, ...(series2 || [])];
  let lo = Math.min(...all.map((p) => p.value));
  let hi = Math.max(...all.map((p) => p.value));
  if (band) { lo = Math.min(lo, band.from); hi = Math.max(hi, band.to); }
  const pad = (hi - lo) * 0.12 || Math.max(1, hi * 0.02);
  lo -= pad; hi += pad;

  const dates = series.map((p) => p.date);
  const x = (i, n = series.length) => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => M.t + ih - ((v - lo) / (hi - lo || 1)) * ih;

  const ticks = niceTicks(lo + pad, hi - pad, 4);

  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label || 'chart')}" preserveAspectRatio="none">`;

  // Target band, behind everything. Drawn first so data always sits on top.
  if (band) {
    const yTop = y(band.to);
    const yBot = y(band.from);
    svg += `<rect x="${M.l}" y="${yTop}" width="${iw}" height="${Math.max(1, yBot - yTop)}"
      fill="${C.series2}" opacity="0.11" rx="2"/>`;
  }

  // Recessive gridlines + y labels.
  for (const t of ticks) {
    const yy = y(t);
    svg += `<line x1="${M.l}" x2="${W - M.r}" y1="${yy}" y2="${yy}" stroke="${C.grid}" stroke-width="1"/>`;
    svg += `<text x="${M.l - 6}" y="${yy + 3.5}" fill="${C.text}" font-size="9.5" text-anchor="end">${fmt(t)}</text>`;
  }

  // Secondary series first — it sits behind the primary.
  if (series2 && series2.length > 1) {
    const d2 = series2.map((p, i) => `${i ? 'L' : 'M'}${x(i, series2.length).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
    svg += `<path d="${d2}" fill="none" stroke="${C.series1}" stroke-width="1.4" opacity="0.35"
      stroke-linejoin="round" stroke-linecap="round"/>`;
  }

  // Primary line: 2px, rounded joins.
  const d = series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join('');
  svg += `<path d="${d}" fill="none" stroke="${C.series2}" stroke-width="2"
    stroke-linejoin="round" stroke-linecap="round"/>`;

  // Markers, with a 2px surface ring so overlapping points stay separable.
  if (dots && series.length <= 30) {
    for (let i = 0; i < series.length; i++) {
      svg += `<circle cx="${x(i).toFixed(1)}" cy="${y(series[i].value).toFixed(1)}" r="3.2"
        fill="${C.series2}" stroke="${C.surface}" stroke-width="2"/>`;
    }
  }

  // Direct label on the latest value — the number you actually care about.
  const lastI = series.length - 1;
  const lastV = series[lastI].value;
  const lx = x(lastI);
  const ly = y(lastV);
  const anchor = lx > W - 60 ? 'end' : 'start';
  svg += `<text x="${anchor === 'end' ? lx - 7 : lx + 7}" y="${Math.max(12, ly - 8)}"
    fill="#e7ecf3" font-size="11.5" font-weight="700" text-anchor="${anchor}">${fmt(lastV)}${esc(unit)}</text>`;

  // X labels: first and last only. More than that collides on a phone.
  svg += `<text x="${M.l}" y="${H - 7}" fill="${C.text}" font-size="9.5">${shortDate(dates[0])}</text>`;
  svg += `<text x="${W - M.r}" y="${H - 7}" fill="${C.text}" font-size="9.5" text-anchor="end">${shortDate(dates[lastI])}</text>`;

  // Invisible hit targets, one per point, wider than the marker. Drives the hover tooltip.
  const step = iw / Math.max(1, series.length - 1);
  for (let i = 0; i < series.length; i++) {
    svg += `<rect class="hit" x="${(x(i) - step / 2).toFixed(1)}" y="${M.t}" width="${step.toFixed(1)}" height="${ih}"
      fill="transparent" data-date="${esc(dates[i])}" data-value="${fmt(series[i].value)}${esc(unit)}"/>`;
  }

  svg += '</svg>';

  const legend = (label && label2)
    ? `<div class="row wrap xs muted" style="gap:12px;margin-top:8px">
         <span class="row" style="gap:5px"><i style="width:9px;height:2.5px;border-radius:2px;background:${C.series2};display:inline-block"></i>${esc(label)}</span>
         <span class="row" style="gap:5px"><i style="width:9px;height:2.5px;border-radius:2px;background:${C.series1};opacity:.45;display:inline-block"></i>${esc(label2)}</span>
       </div>`
    : '';

  return `<div class="chart-wrap" data-chart>${svg}</div>${legend}`;
}

/**
 * Weekly hard-sets-per-muscle. Horizontal bars in HTML rather than SVG — they're a list with a
 * label, a track and a number, which is exactly what flexbox is for, and it keeps the text
 * selectable and the layout responsive without viewBox arithmetic.
 *
 * Every row is directly labelled with its set count and shows the target band, so status is
 * never encoded by colour alone.
 */
export function volumeBars(totals, targets, labels, order) {
  const max = Math.max(
    ...Object.values(totals),
    ...Object.values(targets).map((t) => t[1]),
    1,
  ) * 1.05;

  const rows = order.map((m) => {
    const v = totals[m] || 0;
    const [tlo, thi] = targets[m] || [0, 0];
    const status = v < tlo ? 'under' : v > thi ? 'over' : 'in';
    const pct = (n) => `${Math.min(100, (n / max) * 100)}%`;
    return `
      <div class="vol-row">
        <span class="vol-name">${esc(labels[m] || m)}</span>
        <span class="vol-track" title="${esc(labels[m])}: ${fmt(v)} sets · target ${tlo}–${thi}">
          <span class="vol-band" style="left:${pct(tlo)};width:${pct(thi - tlo)}"></span>
          <span class="vol-fill ${status}" style="width:${pct(v)}"></span>
        </span>
        <span class="vol-n">${fmt(v)}</span>
      </div>`;
  }).join('');

  return `${rows}
    <div class="row wrap xs muted" style="gap:12px;margin-top:10px">
      <span class="row" style="gap:5px"><i class="sw" style="background:${C.series1}"></i>Under target</span>
      <span class="row" style="gap:5px"><i class="sw" style="background:${C.series2}"></i>In band</span>
      <span class="row" style="gap:5px"><i class="sw" style="background:${C.series3}"></i>Over</span>
    </div>`;
}

/** Tiny inline trend line for a list row. No axes, no labels — shape only. */
export function sparkline(values, width = 62, height = 20) {
  if (values.length < 2) return '';
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - lo) / (hi - lo || 1)) * (height - 4) - 2;
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join('');
  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
    <path d="${d}" fill="none" stroke="${C.series2}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
  </svg>`;
}

/**
 * Attaches crosshair tooltips to every chart in a container.
 * Called after each render; safe to call repeatedly.
 */
export function bindChartTooltips(root) {
  for (const wrap of root.querySelectorAll('[data-chart]')) {
    if (wrap.dataset.bound) continue;
    wrap.dataset.bound = '1';

    const tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.hidden = true;
    wrap.style.position = 'relative';
    wrap.appendChild(tip);

    const show = (e) => {
      const hit = e.target.closest('.hit');
      if (!hit) return;
      tip.textContent = `${hit.dataset.date} · ${hit.dataset.value}`;
      tip.hidden = false;
      const box = wrap.getBoundingClientRect();
      const hb = hit.getBoundingClientRect();
      const cx = hb.left + hb.width / 2 - box.left;
      // Clamp so the tooltip never overflows the card on a narrow phone.
      tip.style.left = `${Math.max(4, Math.min(box.width - tip.offsetWidth - 4, cx - tip.offsetWidth / 2))}px`;
    };

    wrap.addEventListener('pointermove', show);
    wrap.addEventListener('pointerdown', show);
    wrap.addEventListener('pointerleave', () => { tip.hidden = true; });
  }
}

function fmt(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}
