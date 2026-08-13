/**
 * views/stats.js — is the program working?
 *
 * Three questions, in priority order:
 *   1. Is weekly volume landing where the program says it should — especially legs?
 *   2. Are the main lifts going up?
 *   3. Is bodyweight moving at the target rate?
 */

import {
  EXERCISES, MUSCLE_LABELS, VOLUME_TARGETS, DAYS, getExercise, resolveExercise,
} from '../program.js';
import * as store from '../store.js';
import {
  weeklyVolume, weeklySetCounts, weekStart, addDays, e1RMSeries, bestE1RM,
  bodyweightSeries, bodyweightTrend, currentStreak, personalBests,
} from '../stats.js';
import { lineChart, volumeBars, bindChartTooltips } from '../charts.js';
import { escapeHtml } from '../ui.js';
import * as U from '../units.js';

/** Muscle display order — legs first, because legs are the priority of this program. */
const ORDER = [
  'quads', 'hamstrings', 'glutes', 'calves',
  'chest', 'back', 'sideDelts', 'rearDelts', 'frontDelts',
  'biceps', 'triceps', 'core',
];

/** The lifts worth charting — the anchors, one per session. */
const KEY_LIFTS = ['back-squat', 'bench-press', 'hip-thrust', 'pull-up', 'rdl'];

let weekOffset = 0;      // 0 = this week, -1 = last week
let selectedLift = 'back-squat';

/**
 * Stats had grown to four stacked cards, which buried personal bests below three charts.
 * Splitting it into tabs gives each question its own screen instead of one long scroll.
 */
const TABS = [
  ['overview', 'Overview'],
  ['bests', 'Bests'],
  ['body', 'Body'],
];
let tab = 'overview';

export function title() { return 'Stats'; }
export function subtitle() {
  const n = store.getSessions().length;
  return n ? `${n} sessions · ${currentStreak()}-week streak` : 'Log a session to see this';
}

/** Personal bests, grouped by the session each lift belongs to. */
function bestsSection() {
  const bests = personalBests();
  if (!bests.length) {
    return `<div class="empty"><p>No bests yet.</p>
      <p class="small mt">Log a session and every lift gets a baseline here.</p></div>`;
  }

  const fresh = bests.filter((b) => b.isNew).length;
  const byId = new Map(bests.map((b) => [b.id, b]));

  // Grouped by day so it reads like your program rather than one flat list.
  const groups = DAYS.map((d) => {
    const rows = EXERCISES
      .filter((ex) => ex.day === d.key && byId.has(ex.id))
      .map((ex) => bestRow(byId.get(ex.id)))
      .join('');
    return rows
      ? `<div class="pb-group"><div class="pb-group-h">${d.name}</div>${rows}</div>`
      : '';
  }).join('');

  return `
    <div class="stat-row">
      <div class="stat"><div class="stat-v">${bests.length}</div><div class="stat-l">LIFTS TRACKED</div></div>
      <div class="stat"><div class="stat-v" style="color:var(--pr)">${fresh}</div><div class="stat-l">NEW BESTS</div></div>
      <div class="stat"><div class="stat-v">${currentStreak()}</div><div class="stat-l">WEEK STREAK</div></div>
    </div>
    <div class="card">
      <div class="chart-title">Personal bests</div>
      <div class="chart-sub">Your best set on every lift you've trained</div>
      ${groups}
      <p class="xs muted mt">The number on the right is your <b>estimated 1-rep max</b> — what that
        set suggests you could lift once. It's how sets at different weights and reps get compared.
        <b>NEW</b> means that session beat an earlier one.</p>
    </div>`;
}

function bestRow(b) {
  const base = getExercise(b.id);
  const ex = resolveExercise(base, store.getSubstitution(b.id));
  const load = ex.unit === 'bodyweight'
    ? ((Number(b.set.weight) || 0) > 0 ? `BW+${U.num(b.set.weight, b.id)}` : 'BW')
    : U.w(b.set.weight, b.id);
  return `<div class="pb">
    <span class="grow">
      <b class="small">${escapeHtml(ex.name)}</b>
      <div class="xs muted">${load} × ${b.set.reps}${b.set.rpe ? ` @ RPE ${b.set.rpe}` : ''} · ${formatDate(b.date)}</div>
    </span>
    ${b.isNew ? '<span class="pill pr">NEW</span>' : ''}
    <span class="pb-e1rm">${U.num(b.e1rm, b.id)}<span class="dim"> ${U.unitFor(b.id)}</span></span>
  </div>`;
}

export function render(root) {
  const sessions = store.getSessions();

  if (!sessions.length) {
    root.innerHTML = `<div class="empty">
      <p>Nothing to chart yet.</p>
      <p class="small mt">Log a couple of sessions and this fills in:<br>
      weekly volume per muscle, strength trends, PRs and bodyweight.</p>
    </div>`;
    return;
  }

  const wStart = addDays(weekStart(), weekOffset * 7);
  const vol = weeklyVolume(wStart);
  const counts = weeklySetCounts(wStart);
  const legShare = Math.round(counts.legShare * 100);

  const trend = bodyweightTrend();
  const bwSeries = bodyweightSeries();

  const html = [];

  html.push(`<div class="segmented">${TABS.map(([k, label]) => `
    <button data-tab="${k}" aria-pressed="${tab === k}">${label}</button>`).join('')}</div>`);

  if (tab === 'bests') {
    root.innerHTML = html.join('') + bestsSection() + liftChart();
    bindChartTooltips(root);
    wireStats(root);
    return;
  }

  if (tab === 'body') {
    root.innerHTML = html.join('') + bodySection(trend, bwSeries);
    bindChartTooltips(root);
    wireStats(root);
    return;
  }

  // ── Headline numbers. These are ACTUAL sets performed, not muscle-weighted — the weighted
  // figures live in the chart below, where per-muscle is the right unit.
  html.push(`<div class="stat-row">
    <div class="stat"><div class="stat-v">${counts.total}</div><div class="stat-l">SETS LOGGED</div></div>
    <div class="stat"><div class="stat-v">${counts.legs}</div><div class="stat-l">LEG SETS</div></div>
    <div class="stat"><div class="stat-v">${legShare}%</div><div class="stat-l">LEG SHARE</div></div>
  </div>
  <p class="xs muted center mb" style="margin-top:-4px">Program target: 90 sets/week, 35 legs (39%)</p>`);

  // ── Weekly volume — the chart that verifies the program's central claim.
  html.push(`<div class="card">
    <div class="row between mb">
      <div>
        <div class="chart-title">Hard sets per muscle</div>
        <div class="chart-sub">Week of ${formatDate(wStart)} · shaded = 10–20 target band</div>
      </div>
      <div class="row" style="gap:5px">
        <button class="btn sm ghost" data-week="-1">‹</button>
        <button class="btn sm ghost" data-week="1" ${weekOffset >= 0 ? 'disabled' : ''}>›</button>
      </div>
    </div>
    ${volumeBars(vol, VOLUME_TARGETS, MUSCLE_LABELS, ORDER)}
    <p class="xs muted mt">A set counts 1.0 for each primary muscle, 0.5 for each secondary.</p>
  </div>`);

  root.innerHTML = html.join('');
  bindChartTooltips(root);
  wireStats(root);
}

function wireStats(root) {
  root.querySelectorAll('[data-tab]').forEach((b) => {
    b.addEventListener('click', () => { tab = b.dataset.tab; rerender(); });
  });
  root.querySelectorAll('[data-week]').forEach((b) => {
    b.addEventListener('click', () => {
      weekOffset = Math.min(0, weekOffset + Number(b.dataset.week));
      rerender();
    });
  });
  root.querySelectorAll('[data-lift]').forEach((b) => {
    b.addEventListener('click', () => { selectedLift = b.dataset.lift; rerender(); });
  });
}

/** Estimated-1RM trend for the anchor lifts — lives with Bests, since it's the same question. */
function liftChart() {
  const lifts = KEY_LIFTS
    .map((id) => {
      const base = getExercise(id);
      return base
        ? { ex: resolveExercise(base, store.getSubstitution(id)), history: store.historyFor(id) }
        : null;
    })
    .filter((l) => l && l.history.length);

  if (!lifts.length) return '';
  if (!lifts.some((l) => l.ex.id === selectedLift)) selectedLift = lifts[0].ex.id;
  const active = lifts.find((l) => l.ex.id === selectedLift);
  const series = e1RMSeries(active.history);
  const best = Math.max(...series.map((p) => p.value), 0);
  const first = series.length ? series[0].value : 0;
  const gain = series.length > 1 ? best - first : 0;

  return `<div class="card">
    <div class="chart-title">Estimated 1RM over time</div>
    <div class="chart-sub">${escapeHtml(active.ex.name)}${gain > 0 ? ` · +${U.w(gain, active.ex.id)} since you started` : ''}</div>
    <div class="row wrap mb" style="gap:6px">
      ${lifts.map((l) => `<button class="btn sm ${l.ex.id === selectedLift ? 'primary' : 'ghost'}"
        data-lift="${l.ex.id}">${escapeHtml(shortName(l.ex.name))}</button>`).join('')}
    </div>
    ${lineChart(series.map((q) => ({ ...q, value: Number(U.num(q.value, active.ex.id)) })),
      { label: 'Estimated 1RM', unit: ` ${U.unitFor(active.ex.id)}` })}
    <p class="xs muted mt">Epley, adjusted for reps-in-reserve from your logged RPE.</p>
  </div>`;
}

function bodySection(trend, bwSeries) {
  if (!bwSeries.length) {
    return `<div class="card">
      <div class="chart-title">Bodyweight</div>
      <div class="chart-sub">No weigh-ins yet.</div>
      <p class="small muted mt">Log your morning weight on the <b>Me</b> tab. Two weeks of data and
        this tells you whether to add or cut calories.</p>
    </div>`;
  }
  const daily = bwSeries.map((x) => ({ date: x.date, value: Number(U.bw(x.kg, false)) }));
  const avg = bwSeries.map((x) => ({ date: x.date, value: Number(U.bw(x.avg, false)) }));

  return `<div class="card">
    <div class="chart-title">Bodyweight</div>
    <div class="chart-sub">${trendCopy(trend)}</div>
    ${lineChart(avg, { series2: daily, label: '7-day average', label2: 'Daily', unit: ` ${U.unit()}`, dots: false })}
    <p class="xs muted mt">Only the 7-day average is worth acting on — daily weight swings
      ${U.isLb() ? '2–4 lb' : '1–2 kg'} on water and food volume.
      Target: ${U.isLb() ? '0.45–0.9 lb' : '0.2–0.4 kg'}/week.</p>
  </div>`;
}


function trendCopy(t) {
  if (!t.ready) return 'Need ~2 weeks of daily weigh-ins before this means anything.';
  const r = U.rate(t.ratePerWeek);
  switch (t.verdict) {
    case 'on-target': return `${r} — on target. Change nothing.`;
    case 'flat': return `${r} — flat. Add ~250 kcal/day.`;
    case 'losing': return `${r} — losing. Add ~350 kcal/day.`;
    case 'fast': return `${r} — too fast. Cut ~200 kcal/day, that's mostly fat.`;
    default: return r;
  }
}

function shortName(name) {
  return name
    .replace('Barbell ', '').replace('Romanian Deadlift', 'RDL')
    .replace('Weighted ', '').replace(' Press', ' Press');
}

function formatDate(iso) {
  return store.parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function rerender() {
  window.dispatchEvent(new CustomEvent('view:rerender'));
}
