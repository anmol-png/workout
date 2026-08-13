/**
 * views/today.js — the logger. The screen you actually stand in front of between sets.
 *
 * Design constraints that shaped this: one hand, poor light, 90 seconds of rest, sweaty fingers.
 * Hence oversized number inputs, a 42px tick target per set, last week's numbers rendered inline
 * as the thing to beat, and zero navigation required to log a set.
 */

import {
  DAYS, exercisesForDay, getDay, dayForWeekday, prescription, getExercise,
} from '../program.js';
import * as store from '../store.js';
import { computeNextTarget, describePerformance, ACTION } from '../progression.js';
import { shouldAutoregulate, applyAutoregulation, autoregulationPlan } from '../readiness.js';
import { isPersonalRecord, e1RM } from '../stats.js';
import { startTimer } from '../timer.js';
import { openSheet, toast, escapeHtml } from '../ui.js';
import { computePlates, plateClass } from '../plates.js';

let selectedDay = null;
let autoOn = false;

export function title() {
  const d = getDay(selectedDay || defaultDay());
  return d ? d.name : 'Today';
}

export function subtitle() {
  const d = getDay(selectedDay || defaultDay());
  const week = store.currentWeek();
  return d ? `${d.subtitle} · Week ${week}` : 'Rest day';
}

function defaultDay() {
  const scheduled = dayForWeekday(new Date().getDay());
  return scheduled ? scheduled.key : 'push';
}

export function render(root) {
  const dayKey = selectedDay || defaultDay();
  selectedDay = dayKey;

  const iso = store.todayISO();
  const log = store.getDailyLog(iso);
  const auto = shouldAutoregulate(log);
  const scheduled = dayForWeekday(new Date().getDay());
  const session = ensureSession(dayKey, iso);

  let exercises = exercisesForDay(dayKey);
  if (autoOn) exercises = applyAutoregulation(exercises);

  const html = [];

  // Day switcher — a rest day still lets you pick a session (life moves training days around).
  html.push(`<div class="daypick">${DAYS.map((d) => `
    <button data-day="${d.key}" aria-pressed="${d.key === dayKey}">
      ${d.name}${hasSessionThisWeek(d.key) ? '<span class="dot"></span>' : ''}
    </button>`).join('')}</div>`);

  if (!scheduled) {
    html.push(`<div class="banner accent">
      <b>Today is a rest day.</b> Walk, eat, sleep. Pick a session above if you're shifting the week around.
    </div>`);
  }

  // Readiness prompt / autoregulation offer.
  if (!log || log.sleepHours == null) {
    html.push(`<div class="card tight">
      <div class="row between">
        <div><b class="small">How did you sleep?</b>
          <div class="xs muted">Under 6 h and the app cuts the session back for you.</div></div>
        <button class="btn sm" data-act="checkin">Log it</button>
      </div>
    </div>`);
  } else if (auto.triggered) {
    const plan = autoregulationPlan();
    html.push(`<div class="banner warn">
      <b>Rough night — ${auto.reason}.</b>
      ${autoOn
        ? `Session cut back (${plan.label}): last set dropped, RPE ${plan.rpeDelta}, finisher skipped.`
        : 'Recommend cutting back: drop the last set of everything, RPE −1, skip the finisher.'}
      <div class="mt"><button class="btn sm ${autoOn ? '' : 'primary'}" data-act="toggle-auto">
        ${autoOn ? 'Train the full session instead' : 'Cut the session back'}
      </button></div>
    </div>`);
  }

  // Exercises.
  let lastGroup = null;
  for (const ex of exercises) {
    if (ex.supersetGroup && ex.supersetGroup !== lastGroup) {
      html.push(`<div class="superset-tag">Superset ${ex.supersetGroup} — back to back</div>`);
    }
    lastGroup = ex.supersetGroup || null;
    html.push(exerciseCard(ex, session));
  }

  // Session footer.
  const doneSets = countDone(session);
  const totalSets = exercises.filter((e) => !e.isFinisher).reduce((n, e) => n + e.sets, 0);
  html.push(`<div class="card">
    <div class="row between mb">
      <div><b>${doneSets} / ${totalSets} sets</b><div class="xs muted">logged today</div></div>
      <span class="pill ${doneSets >= totalSets ? 'good' : ''}">${Math.round((doneSets / (totalSets || 1)) * 100)}%</span>
    </div>
    <label class="field"><span>Session notes</span>
      <textarea class="input" rows="2" data-act="notes" placeholder="How did it feel? Anything to change next time?">${escapeHtml(session.notes || '')}</textarea>
    </label>
    <button class="btn full" data-act="finish">Finish session</button>
  </div>`);

  root.innerHTML = html.join('');
  wire(root, session, exercises);
}

function exerciseCard(ex, session) {
  const sub = store.getSubstitution(ex.id);
  const history = store.historyFor(ex.id).filter((h) => h.sessionId !== session.id);
  const last = history.length ? history[history.length - 1] : null;
  const target = computeNextTarget(history, ex.id);
  const entry = session.entries.find((e) => e.exerciseId === ex.id);
  const allDone = entry && entry.sets.length >= ex.sets && entry.sets.slice(0, ex.sets).every((s) => s.done);

  const hintClass = target.action === ACTION.ADD_LOAD ? 'up'
    : target.action === ACTION.STALL ? 'stall' : '';
  const hintIcon = target.action === ACTION.ADD_LOAD ? '↑'
    : target.action === ACTION.STALL ? '!' : '·';

  const rows = [];
  for (let i = 0; i < ex.sets; i++) {
    const s = (entry?.sets || [])[i] || {};
    rows.push(`
      <div class="set ${s.done ? 'done' : ''} ${s.isPR ? 'pr' : ''}" data-ex="${ex.id}" data-i="${i}">
        <span class="set-n">${s.isPR ? '★' : i + 1}</span>
        <input type="number" inputmode="decimal" step="0.5" data-f="weight"
          placeholder="${target.weight != null ? fmtNum(target.weight) : 'kg'}"
          value="${s.weight ?? ''}" aria-label="Set ${i + 1} weight">
        <input type="number" inputmode="numeric" step="1" data-f="reps"
          placeholder="${target.reps || ex.repRange[0]}"
          value="${s.reps ?? ''}" aria-label="Set ${i + 1} reps">
        <input type="number" inputmode="decimal" step="0.5" min="5" max="10" data-f="rpe"
          placeholder="RPE ${ex.rpe[1]}"
          value="${s.rpe ?? ''}" aria-label="Set ${i + 1} RPE">
        <button class="set-check" data-act="toggle" aria-label="Mark set ${i + 1} done" aria-pressed="${!!s.done}">
          <svg viewBox="0 0 24 24"><path d="M4 12.5l5.5 5.5L20 7"/></svg>
        </button>
      </div>`);
  }

  return `
  <div class="card ex ${allDone ? 'done' : ''}" data-card="${ex.id}">
    <div class="ex-head">
      <span class="ex-order">${ex.order}</span>
      <div class="grow">
        <div class="ex-name">${escapeHtml(sub || ex.name)}${sub ? ' <span class="pill">swapped</span>' : ''}</div>
        <div class="ex-presc">${prescription(ex)}${ex._autoregulated ? ' <span class="pill warn">cut</span>' : ''}</div>
      </div>
      <button class="ex-info" data-act="info" aria-label="Details for ${escapeHtml(ex.name)}">i</button>
    </div>

    ${ex.isFinisher ? '' : `
      <div class="ex-hint ${hintClass}">
        <span>${hintIcon}</span>
        <span class="grow">${last
          ? `Last: <b>${escapeHtml(describePerformance(last))}</b> — ${escapeHtml(target.note)}`
          : escapeHtml(target.note)}</span>
      </div>
      <div class="sets">
        <div class="sets-head"><span></span><span>kg</span><span>reps</span><span>rpe</span><span></span></div>
        ${rows.join('')}
        <div class="set-actions">
          ${ex.unit === 'barbell' ? `<button class="btn sm ghost" data-act="plates">Plates</button>` : ''}
          <button class="btn sm ghost" data-act="prefill">Fill target</button>
          <button class="btn sm ghost" data-act="swap">Swap</button>
        </div>
      </div>`}
    ${ex.isFinisher ? `<div class="sets"><div class="xs muted" style="padding-bottom:10px">${escapeHtml(ex.cues[0])}</div>
      <button class="btn sm full" data-act="finisher-done">Mark finisher done</button></div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------- events

function wire(root, session, exercises) {
  root.querySelectorAll('[data-day]').forEach((b) => {
    b.addEventListener('click', () => {
      selectedDay = b.dataset.day;
      autoOn = false;
      window.dispatchEvent(new CustomEvent('view:rerender'));
    });
  });

  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;
    const card = btn.closest('[data-card]');
    const ex = card ? getExercise(card.dataset.card) : null;
    const setRow = btn.closest('.set');

    if (act === 'toggle' && setRow) return toggleSet(setRow, session);
    if (act === 'info' && ex) return showInfo(ex);
    if (act === 'plates' && ex) return showPlates(ex, session);
    if (act === 'prefill' && ex) return prefill(ex, session);
    if (act === 'swap' && ex) return showSwap(ex);
    if (act === 'finisher-done' && ex) return markFinisher(ex, session);
    if (act === 'checkin') return openCheckin();
    if (act === 'toggle-auto') { autoOn = !autoOn; return rerender(); }
    if (act === 'finish') return finish(session, exercises);
  });

  // Live-persist typed values without re-rendering (re-rendering would steal focus mid-entry).
  root.addEventListener('input', (e) => {
    const input = e.target.closest('.set input');
    if (input) return updateSetField(input, session);
    if (e.target.matches('[data-act="notes"]')) {
      session.notes = e.target.value;
      store.upsertSession(session);
    }
  });
}

function ensureSession(dayKey, iso) {
  const existing = store.getSessions().find((s) => s.date === iso && s.dayKey === dayKey);
  if (existing) return existing;
  return {
    id: store.newId(),
    date: iso,
    dayKey,
    week: store.currentWeek(iso),
    entries: [],
    notes: '',
    createdAt: new Date().toISOString(),
  };
}

function entryFor(session, exerciseId) {
  let entry = session.entries.find((e) => e.exerciseId === exerciseId);
  if (!entry) {
    entry = { exerciseId, sets: [] };
    session.entries.push(entry);
  }
  return entry;
}

function setAt(entry, i) {
  while (entry.sets.length <= i) entry.sets.push({ weight: null, reps: null, rpe: null, done: false });
  return entry.sets[i];
}

function updateSetField(input, session) {
  const row = input.closest('.set');
  const entry = entryFor(session, row.dataset.ex);
  const set = setAt(entry, Number(row.dataset.i));
  const v = input.value === '' ? null : Number(input.value);
  set[input.dataset.f] = v;
  store.upsertSession(session);
}

function toggleSet(row, session) {
  const exId = row.dataset.ex;
  const i = Number(row.dataset.i);
  const ex = getExercise(exId);
  const entry = entryFor(session, exId);
  const set = setAt(entry, i);

  if (set.done) {
    set.done = false;
    set.isPR = false;
    row.classList.remove('done', 'pr');
    row.querySelector('.set-check').setAttribute('aria-pressed', 'false');
    store.upsertSession(session);
    return;
  }

  // Pull anything typed but not yet committed, then fall back to the target.
  const inputs = row.querySelectorAll('input');
  inputs.forEach((inp) => {
    const v = inp.value === '' ? null : Number(inp.value);
    if (v != null) set[inp.dataset.f] = v;
  });

  if (set.reps == null) {
    const history = store.historyFor(exId).filter((h) => h.sessionId !== session.id);
    const t = computeNextTarget(history, exId);
    set.reps = t.reps || ex.repRange[0];
    if (set.weight == null && t.weight != null) set.weight = t.weight;
    row.querySelector('[data-f="reps"]').value = set.reps;
    if (set.weight != null) row.querySelector('[data-f="weight"]').value = set.weight;
  }

  set.done = true;

  // PR check runs against history EXCLUDING this session, so a later set in the same session
  // doesn't get compared against an earlier one and steal its own record.
  const history = store.historyFor(exId).filter((h) => h.sessionId !== session.id);
  const pr = isPersonalRecord(set, history, ex);
  set.isPR = pr.isPR;

  row.classList.add('done');
  row.classList.toggle('pr', pr.isPR);
  row.querySelector('.set-check').setAttribute('aria-pressed', 'true');
  row.querySelector('.set-n').textContent = pr.isPR ? '★' : String(i + 1);

  store.upsertSession(session);

  if (pr.isPR) {
    toast(`PR — ${escapeHtml(ex.name)}, e1RM ${pr.value.toFixed(1)} kg`, 'pr');
    if (navigator.vibrate) navigator.vibrate([60, 40, 60, 40, 120]);
  }

  // Superset members carry a short restSec (~20 s, the transition to the next exercise) and the
  // group's LAST member carries the full rest. That's encoded in program.js, so the timer just
  // reads it — no special-casing needed here.
  if (ex.restSec > 0) startTimer(ex.restSec, `Rest · ${ex.name}`);
}

function prefill(ex, session) {
  const history = store.historyFor(ex.id).filter((h) => h.sessionId !== session.id);
  const t = computeNextTarget(history, ex.id);
  if (t.weight == null) return toast('No target yet — this one needs calibrating first.');
  const entry = entryFor(session, ex.id);
  for (let i = 0; i < ex.sets; i++) {
    const s = setAt(entry, i);
    if (!s.done) { s.weight = t.weight; s.reps = t.reps; }
  }
  store.upsertSession(session);
  rerender();
  toast(`Filled ${fmtNum(t.weight)} kg × ${t.reps}`);
}

function markFinisher(ex, session) {
  const entry = entryFor(session, ex.id);
  const s = setAt(entry, 0);
  s.done = true; s.reps = 1; s.weight = 0;
  store.upsertSession(session);
  toast('Finisher logged. Done for today.');
  rerender();
}

function countDone(session) {
  return session.entries.reduce((n, e) => {
    const ex = getExercise(e.exerciseId);
    if (ex?.isFinisher) return n;
    return n + e.sets.filter((s) => s.done).length;
  }, 0);
}

function hasSessionThisWeek(dayKey) {
  const from = store.todayISO();
  return store.getSessions().some((s) => s.dayKey === dayKey && store.daysBetween(s.date, from) < 7 && store.daysBetween(s.date, from) >= 0);
}

function finish(session, exercises) {
  const done = countDone(session);
  if (!done) return toast('Nothing logged yet.');
  session.completedAt = new Date().toISOString();
  const planned = exercises.filter((e) => !e.isFinisher).reduce((n, e) => n + e.sets, 0);
  store.upsertSession(session);
  toast(`Session saved — ${done}/${planned} sets.`);
  location.hash = '#/history';
}

// ---------------------------------------------------------------- sheets

function showInfo(ex) {
  const sub = store.getSubstitution(ex.id);
  openSheet(`
    <h2>${escapeHtml(sub || ex.name)}</h2>
    <p class="sheet-sub">${prescription(ex)} · rest ${formatRest(ex.restSec)}</p>
    <ul class="cue-list">${ex.cues.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>
    <div class="divider"></div>
    <p class="xs muted">Substitutes: ${ex.substitutes.map(escapeHtml).join(' · ') || '—'}</p>
    <p class="xs muted mt">Trains: ${[...ex.muscles.primary, ...ex.muscles.secondary].join(', ') || '—'}</p>
  `);
}

function showPlates(ex, session) {
  const p = store.getProfile();
  const history = store.historyFor(ex.id).filter((h) => h.sessionId !== session.id);
  const t = computeNextTarget(history, ex.id);
  const initial = t.weight ?? p.barWeightKg;

  openSheet(`
    <h2>Plate calculator</h2>
    <p class="sheet-sub">${escapeHtml(ex.name)} · ${p.barWeightKg} kg bar</p>
    <label class="field"><span>Total weight (kg)</span>
      <input class="input" type="number" inputmode="decimal" step="0.5" id="plate-target" value="${initial}">
    </label>
    <div id="plate-out"></div>
  `, (sheet) => {
    const input = sheet.querySelector('#plate-target');
    const out = sheet.querySelector('#plate-out');
    const draw = () => {
      const r = computePlates(Number(input.value), p.barWeightKg, p.platesKg);
      if (r.barOnly) {
        out.innerHTML = `<p class="center muted small">Empty ${p.barWeightKg} kg bar.</p>`;
        return;
      }
      out.innerHTML = `
        <p class="center small muted mb">Per side, heaviest first</p>
        <div class="plate-stack">${r.perSide.map((kg) => `<span class="plate ${plateClass(kg)}">${fmtNum(kg)}</span>`).join('') || '<span class="muted small">nothing</span>'}</div>
        <div class="bar-line"></div>
        <p class="center small">${r.ok
          ? `<b>${fmtNum(r.achieved)} kg</b> total`
          : `Closest loadable: <b>${fmtNum(r.achieved)} kg</b> <span class="muted">(${r.remainder > 0 ? `${fmtNum(r.remainder)} kg short` : 'over'})</span>`}</p>`;
    };
    input.addEventListener('input', draw);
    draw();
  });
}

function showSwap(ex) {
  const current = store.getSubstitution(ex.id);
  const options = [ex.name, ...ex.substitutes];
  openSheet(`
    <h2>Swap exercise</h2>
    <p class="sheet-sub">Your logged history stays attached to this slot.</p>
    ${options.map((name, i) => `
      <button class="btn full mb" data-swap="${i === 0 ? '' : escapeHtml(name)}"
        style="justify-content:space-between">
        <span>${escapeHtml(name)}${i === 0 ? ' <span class="pill accent">programmed</span>' : ''}</span>
        ${(current === name || (i === 0 && !current)) ? '<span class="pill good">current</span>' : ''}
      </button>`).join('')}
  `, (sheet) => {
    sheet.querySelectorAll('[data-swap]').forEach((b) => {
      b.addEventListener('click', () => {
        store.setSubstitution(ex.id, b.dataset.swap || null);
        window.__closeSheet();
        rerender();
        toast(b.dataset.swap ? `Swapped to ${b.dataset.swap}` : 'Back to the programmed exercise');
      });
    });
  });
}

function openCheckin() {
  location.hash = '#/settings';
  setTimeout(() => document.getElementById('checkin-sleep')?.focus(), 250);
}

function rerender() {
  window.dispatchEvent(new CustomEvent('view:rerender'));
}

function formatRest(sec) {
  if (!sec) return '—';
  return sec >= 60 ? `${Math.round((sec / 60) * 10) / 10} min` : `${sec}s`;
}

function fmtNum(n) {
  return Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
}
