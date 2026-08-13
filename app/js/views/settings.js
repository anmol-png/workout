/**
 * views/settings.js — daily check-in, profile, and data safety.
 *
 * The daily check-in lives here rather than on Today because it's a once-a-day action, not a
 * between-sets one. Today links to it when the log is missing.
 */

import * as store from '../store.js';
import { BLOCK_WEEKS, DELOAD_WEEK } from '../program.js';
import { bodyweightTrend } from '../stats.js';
import { confirmSheet, toast } from '../ui.js';

export function title() { return 'Me'; }
export function subtitle() {
  const w = store.currentWeek();
  const inBlock = ((w - 1) % BLOCK_WEEKS) + 1;
  return `Week ${w} · block week ${inBlock}/${BLOCK_WEEKS}${inBlock === DELOAD_WEEK ? ' — DELOAD' : ''}`;
}

export function render(root) {
  const p = store.getProfile();
  const iso = store.todayISO();
  const log = store.getDailyLog(iso) || {};
  const w = store.currentWeek();
  const inBlock = ((w - 1) % BLOCK_WEEKS) + 1;
  const trend = bodyweightTrend();
  const sinceBackup = store.daysSinceBackup();
  const sessionCount = store.getSessions().length;

  root.innerHTML = `
    ${inBlock === DELOAD_WEEK ? `<div class="banner warn">
      <b>Deload week.</b> Half the sets, same loads, RPE ≤ 6. This is where adaptation is realized —
      skipping it doesn't get you an extra week of gains, it gets you a week where the numbers go backwards.
    </div>` : ''}
    ${w === 1 ? `<div class="banner accent">
      <b>Week 1 is calibration.</b> Bottom of every rep range, compounds capped at RPE 7. Find your real
      loads and write them down. Don't chase progression yet.
    </div>` : ''}

    <div class="card">
      <div class="chart-title mb">Today's check-in</div>
      <label class="field"><span>Bodyweight (kg) — morning, after the bathroom, before eating</span>
        <input class="input" type="number" inputmode="decimal" step="0.1" id="checkin-bw"
          value="${log.bodyweightKg ?? ''}" placeholder="${p.startingWeightKg}"></label>
      <label class="field"><span>Sleep last night (hours)</span>
        <input class="input" type="number" inputmode="decimal" step="0.5" id="checkin-sleep"
          value="${log.sleepHours ?? ''}" placeholder="6.5"></label>
      <div class="field"><span>Readiness — how do you actually feel?</span>
        <div class="rate" id="checkin-readiness">
          ${[1, 2, 3, 4, 5].map((n) => `<button data-r="${n}" aria-pressed="${log.readiness === n}">${n}</button>`).join('')}
        </div>
        <p class="xs muted" style="margin-top:6px">1 = wrecked · 5 = excellent.
          Under 6 h sleep or 2 or below triggers the autoregulation cut on Today.</p>
      </div>
      ${trend.ready ? `<p class="xs muted">7-day average: <b>${trend.current.toFixed(1)} kg</b> ·
        ${trend.ratePerWeek >= 0 ? '+' : ''}${trend.ratePerWeek.toFixed(2)} kg/week</p>` : ''}
    </div>

    <div class="card">
      <div class="chart-title mb">Profile</div>
      <label class="field"><span>Height (cm) — affects form cues only, never load</span>
        <input class="input" type="number" inputmode="numeric" data-p="heightCm"
          value="${p.heightCm ?? ''}" placeholder="e.g. 175"></label>
      <label class="field"><span>Barbell weight (kg)</span>
        <input class="input" type="number" inputmode="decimal" step="0.5" data-p="barWeightKg"
          value="${p.barWeightKg}"></label>
      <label class="field"><span>Plates available per side (kg, comma separated)</span>
        <input class="input" type="text" inputmode="decimal" data-p="platesKg"
          value="${p.platesKg.join(', ')}"></label>
      <label class="field"><span>Program start date — sets your week number</span>
        <input class="input" type="date" data-p="programStart" value="${p.programStart}"></label>
    </div>

    <div class="card">
      <div class="chart-title">Your data</div>
      <div class="chart-sub">${sessionCount} session${sessionCount === 1 ? '' : 's'} stored on this device only.
        Nothing is uploaded anywhere.</div>
      ${sinceBackup >= 28 && sessionCount > 0 ? `<div class="banner warn" style="margin:10px 0">
        <b>Back up your data.</b> It's been ${sinceBackup} days. Clearing your browser storage would
        wipe every session — export a file and keep it somewhere safe.
      </div>` : ''}
      <button class="btn full mb" data-act="export">Export backup (JSON)</button>
      <button class="btn full ghost mb" data-act="import">Import backup</button>
      <input type="file" accept="application/json,.json" id="import-file" hidden>
      <button class="btn full danger" data-act="reset">Erase all data</button>
    </div>

    <div class="card">
      <div class="chart-title mb">The program</div>
      <p class="small muted">5-day PPLUL · ~89 working sets/week, ~35 of them legs ·
        ${BLOCK_WEEKS}-week blocks with a deload in week ${DELOAD_WEEK}.</p>
      <div class="divider"></div>
      <p class="xs muted">Full write-ups with the reasoning behind every set, rep and RPE live in the
        <b>program/</b> folder of the repo — session docs, the volume table, progression rules and
        the nutrition protocol.</p>
    </div>

    <p class="xs dim center" style="padding:8px 0 4px">Works offline · data stays on this device</p>
  `;

  wire(root);
}

function wire(root) {
  const iso = store.todayISO();

  const bw = root.querySelector('#checkin-bw');
  const sleep = root.querySelector('#checkin-sleep');

  bw.addEventListener('change', () => {
    store.saveDailyLog(iso, { bodyweightKg: bw.value === '' ? null : Number(bw.value) });
    toast('Weight logged');
  });
  sleep.addEventListener('change', () => {
    store.saveDailyLog(iso, { sleepHours: sleep.value === '' ? null : Number(sleep.value) });
    toast('Sleep logged');
  });

  root.querySelectorAll('#checkin-readiness button').forEach((b) => {
    b.addEventListener('click', () => {
      const r = Number(b.dataset.r);
      store.saveDailyLog(iso, { readiness: r });
      root.querySelectorAll('#checkin-readiness button').forEach((x) => {
        x.setAttribute('aria-pressed', String(Number(x.dataset.r) === r));
      });
      toast(r <= 2 ? 'Logged — Today will offer the cut-back session' : 'Readiness logged');
    });
  });

  root.querySelectorAll('[data-p]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.p;
      let value = input.value;
      if (key === 'platesKg') {
        value = value.split(',').map((s) => Number(s.trim())).filter((n) => n > 0).sort((a, b) => b - a);
        if (!value.length) return toast('Need at least one plate size');
      } else if (key === 'heightCm' || key === 'barWeightKg') {
        value = value === '' ? null : Number(value);
      }
      store.updateProfile({ [key]: value });
      toast('Saved');
    });
  });

  root.querySelector('[data-act="export"]').addEventListener('click', () => {
    store.downloadBackup();
    toast('Backup downloaded');
  });

  const fileInput = root.querySelector('#import-file');
  root.querySelector('[data-act="import"]').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    try {
      store.importJSON(await file.text());
      toast('Backup restored');
      window.dispatchEvent(new CustomEvent('view:rerender'));
    } catch (err) {
      toast(err.message || 'Could not read that file');
    }
    fileInput.value = '';
  });

  root.querySelector('[data-act="reset"]').addEventListener('click', () => {
    confirmSheet(
      'Erase everything?',
      'Every session, weigh-in and setting is deleted permanently. Export a backup first if you might want it back.',
      'Erase all data',
      () => {
        store.resetAll();
        toast('All data erased');
        window.dispatchEvent(new CustomEvent('view:rerender'));
      },
    );
  });
}
