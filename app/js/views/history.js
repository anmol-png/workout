/**
 * views/history.js — every logged session, newest first.
 *
 * Two levels: a scannable list (what did I train, how much) and a per-session breakdown (exactly
 * what I lifted, set by set). Both resolve substitutions, so a swapped slot shows the exercise
 * you ACTUALLY did rather than the one the program originally prescribed.
 */

import { getDay, getExercise, resolveExercise } from '../program.js';
import * as store from '../store.js';
import {
  sessionVolume, sessionSetCount, currentStreak, weekStart, weeklySetCounts, bestE1RM, bestSet,
} from '../stats.js';
import { openSheet, confirmSheet, toast, escapeHtml } from '../ui.js';
import * as U from '../units.js';

export function title() { return 'History'; }
export function subtitle() {
  const n = store.getSessions().length;
  const streak = currentStreak();
  return n ? `${n} session${n === 1 ? '' : 's'}${streak ? ` · ${streak}-week streak` : ''}` : 'Nothing logged yet';
}

/** The exercise as performed, with any substitution applied. */
function performed(exerciseId) {
  const base = getExercise(exerciseId);
  return base ? resolveExercise(base, store.getSubstitution(base.id)) : null;
}

/** Sets actually done — reps recorded, tick or no tick. */
function doneSets(entry) {
  return entry.sets.filter((x) => (x.reps || 0) > 0);
}

/** "70 lb" · "BW" · "BW+5 kg" */
function loadLabel(kg, ex) {
  const n = Number(kg) || 0;
  if (ex.unit === 'bodyweight') return n > 0 ? `BW+${U.num(n, ex.id)}` : 'BW';
  return `${U.num(n, ex.id)} ${U.unitFor(ex.id)}`;
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

  const byWeek = new Map();
  for (const s of sessions) {
    const w = weekStart(s.date);
    if (!byWeek.has(w)) byWeek.set(w, []);
    byWeek.get(w).push(s);
  }

  const html = [];
  for (const [w, list] of byWeek) {
    const { total, legs } = weeklySetCounts(w);
    html.push(`<div class="row between" style="margin:18px 2px 8px">
      <b class="small">Week of ${formatDate(w)}</b>
      <span class="xs muted">${list.length} session${list.length === 1 ? '' : 's'} · ${total} sets${legs ? ` · ${legs} legs` : ''}</span>
    </div>`);

    for (const s of list) {
      const day = getDay(s.dayKey);
      // What was actually trained — far more useful at a glance than a bare set count.
      const names = s.entries
        .filter((e) => doneSets(e).length)
        .map((e) => performed(e.exerciseId))
        .filter(Boolean)
        .map((ex) => ex.name);
      const preview = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` +${names.length - 3} more` : '');

      html.push(`
        <button class="hist" data-session="${s.id}">
          <span class="hist-day">${day ? day.code : '—'}</span>
          <span class="grow">
            <b class="small">${formatDate(s.date)}</b>
            <div class="hist-meta">${sessionSetCount(s)} sets · ${U.volume(sessionVolume(s))}</div>
            <div class="hist-preview">${escapeHtml(preview) || 'nothing logged'}</div>
          </span>
          <span class="hist-chev">›</span>
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

  const blocks = s.entries.map((entry) => {
    const ex = performed(entry.exerciseId);
    if (!ex) return '';
    const sets = doneSets(entry);
    if (!sets.length) return '';

    // "best" is recomputed live rather than trusting the isPR flag stored at tap time — those
    // could be stale from before the duplicate-session bug was fixed.
    const allTime = bestE1RM(store.historyFor(ex.id).flatMap((h) => h.sets));

    // Exactly ONE set gets the badge — shared comparator so History and Stats always agree.
    const top = bestSet(sets);
    const bestIdx = top ? sets.indexOf(top.set) : -1;
    const tiesAllTime = top && allTime > 0 && top.e1rm >= allTime - 0.01;

    const rows = sets.map((x, i) => {
      const isBest = i === bestIdx && tiesAllTime;
      return `<tr${isBest ? ' class="best"' : ''}>
        <td class="dim">${i + 1}</td>
        <td><b>${loadLabel(x.weight, ex)}</b></td>
        <td>${x.reps} reps</td>
        <td class="muted">${x.rpe ? `RPE ${x.rpe}` : '—'}</td>
        <td>${isBest ? '<span class="pill pr">best</span>' : ''}</td>
      </tr>`;
    }).join('');

    const vol = sets.reduce((n, x) => n + (Number(x.weight) || 0) * (Number(x.reps) || 0), 0);
    const totalReps = sets.reduce((n, x) => n + x.reps, 0);

    return `<div class="sess-ex">
      <div class="row between">
        <b class="small">${escapeHtml(ex.name)}</b>
        <span class="xs dim">${sets.length} sets · ${totalReps} reps${vol ? ` · ${U.volume(vol)}` : ''}</span>
      </div>
      <table class="sess-tbl">${rows}</table>
    </div>`;
  }).join('');

  openSheet(`
    <h2>${day ? day.name : 'Session'}</h2>
    <p class="sheet-sub">${formatDate(s.date)} · Week ${s.week} · ${sessionSetCount(s)} sets ·
      ${U.volume(sessionVolume(s))}${log?.sleepHours ? ` · slept ${log.sleepHours} h` : ''}</p>
    ${blocks || '<p class="muted small">No sets recorded.</p>'}
    ${s.notes ? `<div class="divider"></div>
      <div class="xs dim" style="text-transform:uppercase;letter-spacing:.05em;font-weight:700">Notes</div>
      <p class="small muted mt" style="white-space:pre-wrap">${escapeHtml(s.notes)}</p>` : ''}
    <div class="divider"></div>
    <button class="btn full primary mb" data-copy>Copy summary</button>
    ${navigator.share ? '<button class="btn full ghost mb" data-share>Share…</button>' : ''}
    <button class="btn full danger" data-del>Delete this session</button>
  `, (sheet) => {
    sheet.querySelector('[data-copy]').addEventListener('click', async () => {
      const done = await copyText(sessionText(s));
      toast(done ? 'Copied — paste it anywhere' : 'Could not copy');
    });
    sheet.querySelector('[data-share]')?.addEventListener('click', () => {
      navigator.share({ text: sessionText(s) }).catch(() => {});
    });
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

/**
 * A plain-text summary, for pasting anywhere.
 *
 * The app is deliberately offline-only — no server, so no link to share. The export path has to
 * be text you can paste into a message.
 */
function sessionText(s) {
  const day = getDay(s.dayKey);
  const log = store.getDailyLog(s.date);
  const lines = [`${day ? day.name : 'Session'} — ${formatDate(s.date)} (Week ${s.week})`];

  const meta = [`${sessionSetCount(s)} sets`, `${U.volume(sessionVolume(s))} volume`];
  if (log?.bodyweightKg) meta.push(`BW ${U.bw(log.bodyweightKg)}`);
  if (log?.sleepHours) meta.push(`slept ${log.sleepHours}h`);
  lines.push(meta.join(' · '), '');

  for (const entry of s.entries) {
    const ex = performed(entry.exerciseId);
    if (!ex) continue;
    const sets = doneSets(entry);
    if (!sets.length) continue;
    const txt = sets.map((x) => {
      const w = ex.unit === 'bodyweight'
        ? ((Number(x.weight) || 0) > 0 ? `BW+${U.num(x.weight, ex.id)}` : 'BW')
        : `${U.num(x.weight, ex.id)}${U.unitFor(ex.id)}`;
      return `${w}×${x.reps}${x.rpe ? `@${x.rpe}` : ''}`;
    }).join(', ');
    lines.push(`${ex.order}. ${ex.name} — ${txt}`);
  }

  if (s.notes) { lines.push('', `Notes: ${s.notes}`); }
  return lines.join('\n');
}

/** Clipboard with a fallback for browsers that block the async API. */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

function formatDate(iso) {
  return store.parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}
