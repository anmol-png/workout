/**
 * cloud.js — automatic backup to a secret GitHub Gist.
 *
 * WHY A GIST, AND NOT A DATABASE
 *
 * The app has no server and needs none: a whole year of training is ~500 KB of JSON. A gist is a
 * single addressable JSON blob behind an API that already speaks CORS, needs no account beyond
 * the GitHub one that hosts this app, and can be read from a laptop with one `gh gist view`.
 * Anything more — Firebase, Supabase, a backend of my own — buys nothing except a second service
 * that can be down while you're standing in a gym.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 *
 * 1. **Sync never blocks logging.** Every network call is fire-and-forget with a retry. The app
 *    is offline-first by design; if sync fails, it queues and the user never finds out mid-set.
 *
 * 2. **The token lives OUTSIDE the app state.** `store.exportJSON()` serialises the entire state
 *    object, and that export gets shared — the user has already mailed me one. A credential in
 *    there would leak on the first backup. It gets its own localStorage key, and nothing in this
 *    module ever writes it into a session, a profile or an export.
 */

import * as store from './store.js';

const KEY = 'workout.cloud';
const FILENAME = 'workout-log.json';
const API = 'https://api.github.com';

/** How long to wait after the last change before pushing. Long enough that logging a full
 *  exercise is one upload, short enough that backgrounding the app doesn't lose it. */
const DEBOUNCE_MS = 5000;

let timer = null;
let inflight = false;
let cfg = read();

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') || {};
  } catch {
    return {};
  }
}

function write(patch) {
  cfg = { ...cfg, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch { /* quota — sync config is not worth failing the app over */ }
  window.dispatchEvent(new CustomEvent('cloud:changed'));
}

export function isConnected() {
  return Boolean(cfg.token && cfg.gistId);
}

export function status() {
  return {
    connected: isConnected(),
    gistId: cfg.gistId || null,
    gistUrl: cfg.gistId ? `https://gist.github.com/${cfg.gistId}` : null,
    lastPushAt: cfg.lastPushAt || null,
    lastError: cfg.lastError || null,
    pending: Boolean(cfg.pending),
  };
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    // 401 is the one worth naming precisely — a revoked or expired token is by far the most
    // likely failure months from now, and "sync failed" would send the user hunting the wrong bug.
    const detail = res.status === 401 ? 'Token rejected — it may have expired or been revoked.'
      : res.status === 404 ? 'Gist not found — it may have been deleted.'
        : `GitHub returned ${res.status}.`;
    throw new Error(detail);
  }
  return res.status === 204 ? null : res.json();
}

/**
 * Attach to a gist, creating one if this is the first device.
 *
 * The existing-gist path MERGES before it uploads. Without that, connecting a second device would
 * push its (empty) state straight over the history already in the cloud — the classic way sync
 * eats data on day one.
 */
export async function connect(token, gistId = null) {
  if (!token) throw new Error('Paste a token first.');
  write({ token, lastError: null });

  try {
    if (gistId) {
      write({ gistId });
      await pull();          // merge what's already up there BEFORE overwriting it
      await push({ force: true });
      return status();
    }

    const gist = await api('/gists', {
      method: 'POST',
      body: JSON.stringify({
        description: 'Workout log — automatic backup from the PPLUL tracker',
        public: false,
        files: { [FILENAME]: { content: store.exportJSON() } },
      }),
    });
    write({ gistId: gist.id, lastPushAt: new Date().toISOString(), pending: false });
    return status();
  } catch (err) {
    write({ token: null, lastError: err.message });
    throw err;
  }
}

export function disconnect() {
  try {
    localStorage.removeItem(KEY);
  } catch { /* ignore */ }
  cfg = {};
  window.dispatchEvent(new CustomEvent('cloud:changed'));
}

/** Upload the current state. Silent on failure unless `force` — see rule 1. */
export async function push({ force = false } = {}) {
  if (!isConnected() || inflight) return false;
  inflight = true;
  try {
    await api(`/gists/${cfg.gistId}`, {
      method: 'PATCH',
      body: JSON.stringify({ files: { [FILENAME]: { content: store.exportJSON() } } }),
    });
    write({ lastPushAt: new Date().toISOString(), pending: false, lastError: null });
    return true;
  } catch (err) {
    // Queue it. `pending` is what makes the retry on reconnect meaningful rather than a guess.
    write({ pending: true, lastError: err.message });
    if (force) throw err;
    return false;
  } finally {
    inflight = false;
  }
}

/**
 * Download and MERGE — never replace.
 *
 * Two devices can each hold sessions the other has never seen, so the safe operation is a union.
 * `store.importJSON` runs everything through the same dedupe that repairs split sessions, so two
 * partial records of one workout collapse into the complete one rather than becoming duplicates.
 */
export async function pull() {
  if (!isConnected()) throw new Error('Not connected.');
  const gist = await api(`/gists/${cfg.gistId}`);
  const file = gist.files?.[FILENAME];
  if (!file) throw new Error(`That gist has no ${FILENAME}.`);

  // Files over 1 MB come back truncated, with the full copy behind raw_url.
  const text = file.truncated ? await (await fetch(file.raw_url)).text() : file.content;
  const remote = JSON.parse(text);
  if (!remote || !Array.isArray(remote.sessions)) throw new Error('Cloud copy is not a valid backup.');

  const local = store.getState();
  const merged = {
    ...remote,
    ...local,
    profile: { ...remote.profile, ...local.profile },
    // Remote first so a local record of the same workout wins the dedupe — the local device is
    // the one that was actually in the gym most recently.
    sessions: [...(remote.sessions || []), ...(local.sessions || [])],
    dailyLogs: { ...(remote.dailyLogs || {}), ...(local.dailyLogs || {}) },
    substitutions: { ...(remote.substitutions || {}), ...(local.substitutions || {}) },
    exerciseUnits: { ...(remote.exerciseUnits || {}), ...(local.exerciseUnits || {}) },
    schedule: { ...(remote.schedule || {}), ...(local.schedule || {}) },
  };
  store.importJSON(JSON.stringify(merged));
  write({ lastPullAt: new Date().toISOString(), lastError: null });
  return store.getSessions().length;
}

/** Debounced push, wired to store changes. */
export function schedulePush() {
  if (!isConnected()) return;
  clearTimeout(timer);
  timer = setTimeout(() => { push(); }, DEBOUNCE_MS);
}

/** Push now if anything is waiting — used when the app is about to be backgrounded. */
export function flush() {
  if (!isConnected()) return;
  clearTimeout(timer);
  push();
}

export function init() {
  window.addEventListener('store:changed', schedulePush);

  // A phone backgrounds the app the moment it goes in a pocket, and a pending timer dies with it.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) flush();
    else if (cfg.pending) push();
  });

  // Coming back onto wifi is the single most likely moment for a queued push to succeed.
  window.addEventListener('online', () => { if (cfg.pending) push(); });
}
