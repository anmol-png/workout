/**
 * views/settings.js — daily check-in, profile, and data safety.
 *
 * The daily check-in lives here rather than on Today because it's a once-a-day action, not a
 * between-sets one. Today links to it when the log is missing.
 */

import * as store from '../store.js';
import { BLOCK_WEEKS, DELOAD_WEEK } from '../program.js';
import { bodyweightTrend } from '../stats.js';
import { confirmSheet, toast, escapeHtml } from '../ui.js';
import * as U from '../units.js';
import * as cloud from '../cloud.js';

/** "2 min ago" · "3 h ago" — a timestamp only matters here as a freshness check. */
function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * Cloud backup — connected and disconnected states.
 *
 * The disconnected state carries the full token instructions inline. A link out to GitHub's docs
 * would be one more thing to lose track of, and the scope choice is the part that actually
 * matters: `gist` and nothing else, so a stolen phone cannot reach any repository.
 */
function cloudCard() {
  const s = cloud.status();

  if (!s.connected) {
    return `<div class="card">
      <div class="chart-title">Cloud backup</div>
      <div class="chart-sub">Push every session to a secret GitHub Gist automatically.</div>
      <ol class="small muted" style="padding-left:18px;margin:10px 0;line-height:1.7">
        <li>Open <b>github.com/settings/tokens</b> → Tokens (classic) → Generate new</li>
        <li>Tick <b>only</b> the <b>gist</b> scope — nothing else. It cannot touch your repos.</li>
        <li>Set an expiry you'll remember, generate, and paste it below.</li>
      </ol>
      <input class="input mb" type="password" id="gh-token" placeholder="ghp_…" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false">
      <input class="input mb" type="text" id="gh-gist" placeholder="Existing gist ID (leave blank to create one)"
        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">
      <button class="btn full primary" data-act="cloud-connect">Connect</button>
      <p class="xs muted mt">The token is stored on this device only and is deliberately kept
        <b>out</b> of your exported backup file, so sharing an export never leaks it. A secret gist
        is unlisted rather than truly private — anyone with the link can read it, so treat the URL
        as the secret.</p>
    </div>`;
  }

  return `<div class="card">
    <div class="row between">
      <div class="grow">
        <div class="chart-title">Cloud backup</div>
        <div class="chart-sub">Last upload ${ago(s.lastPushAt)}${s.pending ? ' · <b>queued</b>' : ''}</div>
      </div>
      <span class="pill ${s.pending ? 'warn' : 'pr'}">${s.pending ? 'PENDING' : 'ON'}</span>
    </div>
    ${s.lastError ? `<div class="banner warn" style="margin:10px 0"><b>Last sync failed.</b>
      ${escapeHtml(s.lastError)}</div>` : ''}
    <div class="divider"></div>
    <label class="small">Gist ID<input class="input" type="text" value="${escapeHtml(s.gistId)}" readonly
      onclick="this.select()"></label>
    <div class="row mt" style="gap:8px">
      <button class="btn sm ghost grow" data-act="cloud-push">Push now</button>
      <button class="btn sm ghost grow" data-act="cloud-pull">Pull &amp; merge</button>
    </div>
    <button class="btn full ghost mt" data-act="cloud-off">Disconnect</button>
    <p class="xs muted mt">Uploads a few seconds after you finish logging, and again whenever the
      app is backgrounded. Offline sets are queued and sent when you're back on wifi — sync never
      blocks logging.</p>
  </div>`;
}

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
      <div class="row between">
        <div>
          <div class="chart-title">Default units</div>
          <div class="xs muted">Display only — everything is stored in kg, so switching never
            changes your logged history. Mixed gym? Override any single exercise from its
            <b>ⓘ</b> button on the Today screen.</div>
        </div>
        <div class="unit-toggle" id="unit-toggle">
          <button data-u="kg" aria-pressed="${!U.isLb()}">kg</button>
          <button data-u="lb" aria-pressed="${U.isLb()}">lb</button>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="chart-title mb">Today's check-in</div>
      <label class="field"><span>Bodyweight (${U.unit()}) — morning, after the bathroom, before eating</span>
        <input class="input" type="number" inputmode="decimal" step="0.1" id="checkin-bw"
          value="${log.bodyweightKg == null ? '' : U.bw(log.bodyweightKg, false)}"
          placeholder="${U.bw(p.startingWeightKg, false)}"></label>
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
      ${trend.ready ? `<p class="xs muted">7-day average: <b>${U.bw(trend.current)}</b> ·
        ${U.rate(trend.ratePerWeek)}</p>` : ''}
    </div>

    <div class="card">
      <div class="chart-title mb">Profile</div>
      <label class="field"><span>Height (cm) — affects form cues only, never load</span>
        <input class="input" type="number" inputmode="numeric" data-p="heightCm"
          value="${p.heightCm ?? ''}" placeholder="e.g. 175"></label>
      <label class="field"><span>Barbell weight (${U.unit()})</span>
        <input class="input" type="number" inputmode="decimal" step="${U.step()}" data-p="barWeightKg"
          value="${U.num(p.barWeightKg)}"></label>
      <label class="field"><span>Plates available per side (${U.unit()}, comma separated)</span>
        <input class="input" type="text" inputmode="decimal" data-p="platesKg"
          value="${p.platesKg.map((x) => U.num(x)).join(', ')}"></label>
      <label class="field"><span>Program start date — sets your week number</span>
        <input class="input" type="date" data-p="programStart" value="${p.programStart}"></label>
    </div>

    ${cloudCard()}

    <div class="card">
      <div class="chart-title">Your data</div>
      <div class="chart-sub">${sessionCount} session${sessionCount === 1 ? '' : 's'} stored on this device.</div>
      ${sinceBackup >= 28 && sessionCount > 0 && !cloud.isConnected() ? `<div class="banner warn" style="margin:10px 0">
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
      <p class="small muted">5-day PPLUL · 90 working sets/week, 35 of them legs ·
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
    store.saveDailyLog(iso, { bodyweightKg: bw.value === '' ? null : U.bwToKg(bw.value) });
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
        value = value.split(',').map((s) => U.bwToKg(s.trim()))
          .filter((n) => n > 0).sort((a, b) => b - a);
        if (!value.length) return toast('Need at least one plate size');
      } else if (key === 'barWeightKg') {
        value = value === '' ? null : U.bwToKg(value);
      } else if (key === 'heightCm') {
        value = value === '' ? null : Number(value);
      }
      store.updateProfile({ [key]: value });
      toast('Saved');
    });
  });

  root.querySelectorAll('#unit-toggle button').forEach((b) => {
    b.addEventListener('click', () => {
      store.updateProfile({ units: b.dataset.u });
      window.dispatchEvent(new CustomEvent('view:rerender'));
      toast(`Showing weights in ${b.dataset.u}`);
    });
  });

  root.querySelector('[data-act="export"]').addEventListener('click', () => {
    store.downloadBackup();
    toast('Backup downloaded');
  });

  // ── Cloud backup
  const rerender = () => window.dispatchEvent(new CustomEvent('view:rerender'));

  root.querySelector('[data-act="cloud-connect"]')?.addEventListener('click', async (e) => {
    const token = root.querySelector('#gh-token').value.trim();
    const gistId = root.querySelector('#gh-gist').value.trim();
    if (!token) return toast('Paste a token first');
    e.target.disabled = true;
    e.target.textContent = 'Connecting…';
    try {
      const s = await cloud.connect(token, gistId || null);
      toast('Cloud backup on');
      // The gist id is the one thing worth surfacing — it's how a second device attaches.
      console.info('[cloud] gist:', s.gistUrl);
      rerender();
    } catch (err) {
      toast(err.message || 'Could not connect');
      e.target.disabled = false;
      e.target.textContent = 'Connect';
    }
  });

  root.querySelector('[data-act="cloud-push"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      await cloud.push({ force: true });
      toast('Uploaded');
    } catch (err) {
      toast(err.message || 'Upload failed');
    }
    rerender();
  });

  root.querySelector('[data-act="cloud-pull"]')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const n = await cloud.pull();
      toast(`Merged — ${n} sessions`);
    } catch (err) {
      toast(err.message || 'Download failed');
    }
    rerender();
  });

  root.querySelector('[data-act="cloud-off"]')?.addEventListener('click', () => {
    confirmSheet('Turn off cloud backup?',
      'The token is deleted from this device. The gist itself stays where it is — nothing is lost.',
      'Disconnect', () => { cloud.disconnect(); toast('Cloud backup off'); rerender(); });
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
