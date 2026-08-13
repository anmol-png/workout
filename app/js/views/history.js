/**
 * views/history.js — every logged session, newest first, with a per-session breakdown.
 */

import { getDay, getExercise, prescription } from '../program.js';
import * as store from '../store.js';
import { sessionVolume, sessionSetCount, currentStreak, weekStart, weeklySetCounts } from '../stats.js';
import { openSheet, confirmSheet, toast, escapeHtml } from '../ui.js';
import * as U from '../units.js';

export function title() { return 'History'; }
export function subtitle() {
  const n = store.getSessions().length;
  const streak = currentStreak();
  return n ? `${n} session${n === 1 ? '' : 's'}${streak ? ` · ${streak}-week streak` : ''}` : 'Nothing logged yet';
}

export function render(root) {
  const sessions = [...store.getSessions()].sort((a, b) => b.date.localeCompare(a.date));

  if (!sessions.length) {
    root.innerHTML = `<div class="empty">
      <p>No sessions logged yet.</p>
      <p class="small mt">Head to <b>Today</b> and log your first set.</p>
    </div>`;
    return;
  }

  // Group by week so you can see the shape of a training week at a glance.
  const byWeek = new Map();
  for (const s of sessions) {
    const w = weekStart(s.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(s);
  }

  const html = [];
  for (const [w, list] of byWeek) {
    // Actual sets performed, not the muscle-weighted sum — see weeklySetCounts().
    const { total, legs } = weeklySetCounts(w);
    html.push(`<div class="row between" style="margin:16px 2px 8px">
      <b class="small">Week of ${formatDate(w)}</b>
      <span class="xs muted">${list.length} session${list.length === 1 ? '' : 's'} · ${total} sets · ${legs} legs</span>
    </div>`);

    for (const s of list) {
      const day = getDay(s.dayKey);
      html.push(`
        <button class="hist" data-session="${s.id}">
          <span class="hist-day">${day ? day.code : '—'}</span>
          <span class="grow">
            <b class="small">${formatDate(s.date)}</b>
            <div class="hist-meta">${sessionSetCount(s)} sets · ${U.volume(sessionVolume(s))} volume</div>
          </span>
          ${s.completedAt ? '<span class="pill good">done</span>' : '<span class="pill">partial</span>'}
        </button>`);
    }
  }

  root.innerHTML = html.join('');

  root.querySelectorAll('[data-session]').forEach((b) => {
    b.addEventListener('click', () => showSession(b.dataset.session));
  });
}

function showSession(id) {
  const s = store.getSession(id);
  if (!s) return;
  const day = getDay(s.dayKey);
  const log = store.getDailyLog(s.date);

  const rows = s.entries.map((entry) => {
    const ex = getExercise(entry.exerciseId);
    if (!ex) return '';
    const done = entry.sets.filter((x) => x.done && x.reps > 0);
    if (!done.length) return '';
    const bw = ex.unit === 'bodyweight';
    const sets = done.map((x) => {
      const kg = Number(x.weight) || 0;
      const wLabel = bw ? (kg > 0 ? `BW+${U.num(kg, ex.id)}` : 'BW') : U.num(kg, ex.id);
      return `${wLabel}×${x.reps}${x.rpe ? `@${x.rpe}` : ''}${x.isPR ? ' ★' : ''}`;
    }).join('  ·  ');
    return `<div style="padding:9px 0;border-top:1px solid var(--line)">
      <div class="row between"><b class="small">${escapeHtml(ex.name)}</b>
        <span class="xs dim">${prescription(ex)}</span></div>
      <div class="xs muted" style="margin-top:3px;font-variant-numeric:tabular-nums">${sets}</div>
    </div>`;
  }).join('');

  openSheet(`
    <h2>${day ? day.name : 'Session'} — ${formatDate(s.date)}</h2>
    <p class="sheet-sub">Week ${s.week} · ${sessionSetCount(s)} sets · ${U.volume(sessionVolume(s))}
      ${log?.sleepHours ? ` · slept ${log.sleepHours} h` : ''}</p>
    ${rows || '<p class="muted small">No completed sets.</p>'}
    ${s.notes ? `<div class="divider"></div><p class="small muted">${escapeHtml(s.notes)}</p>` : ''}
    <div class="divider"></div>
    <button class="btn full danger" data-del>Delete this session</button>
  `, (sheet) => {
    sheet.querySelector('[data-del]').addEventListener('click', () => {
      window.__closeSheet();
      confirmSheet('Delete session?', 'This removes every set logged that day. It can’t be undone.',
        'Delete', () => {
          store.deleteSession(id);
          toast('Session deleted');
          window.dispatchEvent(new CustomEvent('view:rerender'));
        });
    });
  });
}

function formatDate(iso) {
  const d = store.parseISO(iso);
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtNum(n) {
  return Number.isInteger(Number(n)) ? String(n) : Number(n).toFixed(1);
}
