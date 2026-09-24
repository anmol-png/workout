/**
 * store.js — persistence layer.
 *
 * localStorage, not IndexedDB, deliberately: a full year is ~260 sessions ≈ 500 KB, far under the
 * 5 MB quota, and synchronous reads keep the logging UI instant between sets — which matters when
 * you're tapping through it with 90 seconds of rest. The schema is versioned so a future move to
 * IndexedDB is a change inside this file only; nothing else touches localStorage directly.
 */

import { DAYS, exercisesForDay } from './program.js';

const KEY = 'workout.v1';
const BACKUP_KEY = 'workout.v1.pre-v2';
const SCHEMA_VERSION = 2;

/** Local (not UTC) YYYY-MM-DD. Using UTC here would roll the date over mid-evening in IST. */
export function todayISO(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function parseISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function daysBetween(isoA, isoB) {
  return Math.round((parseISO(isoB) - parseISO(isoA)) / 86400000);
}

function emptyState() {
  return {
    schemaVersion: SCHEMA_VERSION,
    profile: {
      name: '',
      heightCm: null,
      startingWeightKg: 82,
      barWeightKg: 20,
      // Plates available per side, heaviest first. Drives the plate calculator.
      platesKg: [25, 20, 15, 10, 5, 2.5, 1.25],
      programStart: todayISO(),
      units: 'kg',
    },
    /** Session[] — one per completed or in-progress training day. */
    sessions: [],
    /** dailyLogs[isoDate] = { bodyweightKg, sleepHours, readiness, note } */
    dailyLogs: {},
    /** exerciseId -> substitute name, when the user swaps an exercise. */
    substitutions: {},
    /**
     * exerciseId -> 'kg' | 'lb'. Real gyms mix equipment: a kg barbell next to a lb-stack
     * pulldown. A single global unit can't describe that, so each exercise may override it.
     */
    exerciseUnits: {},
    /** exerciseId -> { reading?: string } — see getExerciseConfig. */
    exerciseConfig: {},
    /** 'dayKey:GROUP' -> true when the pair can't be run back to back. */
    brokenSupersets: {},
    /**
     * isoDate -> dayKey. Life moves training days around: a missed session, a day you don't
     * fancy, an extra optional one. Pinning a session to a date lets the week be rearranged
     * without editing the program itself.
     */
    schedule: {},
    meta: {
      lastBackupAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

/**
 * ── SCHEMA 2 ──────────────────────────────────────────────────────────────────
 * Two repairs to data logged under schema 1, both caused by the same gap: a logged set recorded
 * WHAT WAS TYPED, never what was actually done.
 *
 * 1. SPLIT MIXED VARIANTS. `substitutions` is a flat {exerciseId: name} map with no date, and an
 *    entry carried no variant identity — so one slot accumulated sessions from two different
 *    exercises. `bench-press` held barbell sessions at 70 kg and dumbbell sessions at 25 kg, and
 *    the progression engine averaged across both, then offered a barbell load for a dumbbell.
 *    Each session below is re-filed under the exercise actually performed, read off the logged
 *    loads (the two clusters differ by more than 2x, so there is nothing to guess).
 *
 * 2. CORRECT DOUBLE-COUNTED LOADS. Three sessions recorded one side, or one plate of a pair, on
 *    equipment whose marking is ambiguous. Each correction below was verified against the same
 *    lift's neighbouring sessions at matching reps AND RPE — equal effort at half the load is
 *    impossible, so the doubled figure is the real one.
 *
 * Both are keyed by (date, exerciseId) and applied at most once, guarded by schemaVersion. The
 * pre-migration state is written to `workout.v1.pre-v2` first, so this is reversible.
 */
const VARIANT_SPLITS = {
  // exerciseId: { 'YYYY-MM-DD': 'name of the exercise actually performed' }
  'bench-press': {
    '2026-08-17': 'Barbell Bench Press', '2026-09-08': 'Barbell Bench Press',
    '2026-09-14': 'Barbell Bench Press',
    '2026-08-25': 'Dumbbell Bench Press', '2026-09-01': 'Dumbbell Bench Press',
    '2026-09-21': 'Dumbbell Bench Press',
  },
  'weighted-dip': {
    '2026-09-04': 'Incline Barbell Press', '2026-09-12': 'Incline Barbell Press',
    // 13 Aug note: "First was inclined dumbell and not barbell since it wasn't available"
    '2026-08-13': 'Incline DB Press', '2026-09-19': 'Incline DB Press',
  },
  rdl: {
    '2026-08-24': 'Romanian Deadlift',
    '2026-08-31': '45\u00b0 Back Extension', '2026-09-18': '45\u00b0 Back Extension',
  },
  'barbell-row': {
    '2026-08-18': 'Barbell Row',
    '2026-08-28': 'Single-arm DB Row', '2026-09-02': 'Single-arm DB Row',
    '2026-09-09': 'Single-arm DB Row', '2026-09-16': 'Single-arm DB Row',
    '2026-09-23': 'Single-arm DB Row',
  },
};

const WEIGHT_CORRECTIONS = [
  // 23 Sep read one plate of a pair marked 21.5. Doubled: 43/50/50 — which matches 9 Sep's
  // 43x14@8, 50x12@9 almost exactly. 21.5x12@RPE8 beside 16 Sep's 42.5x12@RPE9 is impossible.
  { date: '2026-09-23', exerciseId: 'seated-cable-row', factor: 2 },
  // 2 Sep, the athlete's own note: "2 35lb written on the plate so not sure if it is 35 or 70".
  { date: '2026-09-02', exerciseId: 'seated-cable-row', factor: 2 },
  // 29 Aug: "Barbell curl had prefix barbell with 25 30 marked" — one side. Doubled lands on
  // 50/60/50, matching 20 Aug and 11 Sep exactly.
  { date: '2026-08-29', exerciseId: 'arms-ez-curl', factor: 2 },
];

/**
 * Labelling rules recovered from the athlete's own session notes, seeded once so the convention
 * lives on the exercise card instead of in a note nobody re-reads.
 */
const READING_NOTES = {
  'seated-cable-row': 'Two plates marked 21.5 — they sum. Log 43, not 21.5',
  'arms-ez-curl': 'Bar is marked per side — double it (25+25 = 50)',
  'incline-db-press': 'Single arm — log the one side you pressed',
  'chest-supported-row': 'Single side at a time — log the one side',
  'leg-press': 'The 130 already includes the 40 lb sled',
};

/** Applies the two schema-2 repairs. Idempotent: re-running changes nothing. */
function repairV2(sessions) {
  const report = { split: 0, corrected: 0 };

  for (const s of sessions) {
    for (const entry of s.entries) {
      const variant = VARIANT_SPLITS[entry.exerciseId]?.[s.date];
      if (variant && !entry.performedAs) { entry.performedAs = variant; report.split += 1; }
    }
  }

  for (const fix of WEIGHT_CORRECTIONS) {
    const s = sessions.find((x) => x.date === fix.date);
    const entry = s?.entries.find((e) => e.exerciseId === fix.exerciseId);
    if (!entry || entry._corrected) continue;
    for (const set of entry.sets) {
      if (Number(set.weight) > 0) set.weight = Math.round(set.weight * fix.factor * 100) / 100;
    }
    entry._corrected = true;
    report.corrected += 1;
  }

  if (report.split || report.corrected) {
    console.info(`[migrate v2] tagged ${report.split} entries with the exercise actually performed, `
      + `corrected ${report.corrected} double-counted loads`);
  }
  return sessions;
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    // A migration bug must never cost someone their training history. Falling back to
    // emptyState() here would silently erase every session the moment a new migration threw —
    // and the write-back on the next commit() would make that permanent. So: salvage whatever
    // parsed, skip the migration, and leave the raw copy in localStorage untouched.
    console.error('Migration failed — loading raw data unmigrated:', err);
    try {
      const parsed = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (parsed && Array.isArray(parsed.sessions)) {
        const base = emptyState();
        return { ...base, ...parsed, profile: { ...base.profile, ...(parsed.profile || {}) } };
      }
    } catch { /* genuinely unreadable */ }
    return emptyState();
  }
}


/**
 * Forward-migrate older saved data, so a schema bump never silently drops training history.
 */
function migrate(data) {
  const base = emptyState();
  const merged = {
    ...base,
    ...data,
    profile: { ...base.profile, ...(data.profile || {}) },
    meta: { ...base.meta, ...(data.meta || {}) },
    dailyLogs: data.dailyLogs || {},
    substitutions: data.substitutions || {},
    exerciseUnits: data.exerciseUnits || {},
    schedule: data.schedule || {},
    exerciseConfig: data.exerciseConfig || {},
    // Seeded once, the first load after this field existed: the athlete reported that the hanging
    // leg raise frame and the cable stack are on different floors, so E can never be a superset
    // for them. Absence of the key — not a schema number — is the trigger, because their data is
    // already at the current version.
    brokenSupersets: data.brokenSupersets || { 'arms:E': true },
    sessions: dedupeSessions(Array.isArray(data.sessions) ? data.sessions : []),
  };

  // Keep one copy of the pre-repair data so the v2 migration is undoable.
  if ((data.schemaVersion || 1) < 2 && merged.sessions.length) {
    try {
      if (!localStorage.getItem(BACKUP_KEY)) localStorage.setItem(BACKUP_KEY, JSON.stringify(data));
    } catch { /* quota — the repair still runs, it just can't be rolled back */ }
  }
  merged.sessions = repairV2(merged.sessions);
  if ((data.schemaVersion || 1) < 2) {
    for (const [id, reading] of Object.entries(READING_NOTES)) {
      if (!merged.exerciseConfig[id]) merged.exerciseConfig[id] = { reading };
    }
  }

  merged.schemaVersion = SCHEMA_VERSION;
  return merged;
}

/**
 * Merge sessions that describe the same workout, and re-file them under the right day.
 *
 * Older builds minted a random session id on every render, so before the first set was saved a
 * single workout could be split across several records — and because the day picker and the
 * captured session object could disagree, some records were filed under the wrong dayKey.
 *
 * Rule: two sessions on the same date that share ANY exercise are the same workout. Merge them,
 * keeping the richest version of each exercise, then infer dayKey from what was actually logged
 * rather than trusting the stored label.
 */
function dedupeSessions(list) {
  const byDate = new Map();
  for (const s of list) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const out = [];
  for (const [, sameDay] of byDate) {
    const groups = [];
    for (const s of sameDay) {
      const ids = new Set(s.entries.map((e) => e.exerciseId));
      // Any overlap with an existing group means it's the same workout.
      const hit = groups.find((g) => [...ids].some((id) => g.ids.has(id)));
      if (hit) {
        hit.members.push(s);
        for (const id of ids) hit.ids.add(id);
      } else {
        groups.push({ ids, members: [s] });
      }
    }

    for (const g of groups) {
      const merged = mergeSessions(g.members);
      if (merged.entries.length) out.push(merged);
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function loggedCount(sets) {
  return (sets || []).filter((x) => (x.reps || 0) > 0).length;
}

function mergeSessions(members) {
  const base = { ...members[0] };
  const entries = new Map();

  for (const s of members) {
    for (const e of s.entries) {
      const prev = entries.get(e.exerciseId);
      // Keep whichever copy of this exercise actually has data.
      if (!prev || loggedCount(e.sets) > loggedCount(prev.sets)) entries.set(e.exerciseId, e);
    }
  }

  base.entries = [...entries.values()];
  base.notes = members.map((s) => s.notes).filter(Boolean).sort((a, b) => b.length - a.length)[0] || '';
  base.completedAt = members.map((s) => s.completedAt).find(Boolean) || base.completedAt;
  base.dayKey = inferDayKey(base.entries, base.dayKey);
  base.id = `${base.date}:${base.dayKey}`;
  return base;
}

/** Which session do these exercises actually belong to? Trust the contents over the label. */
function inferDayKey(entries, fallback) {
  const ids = entries.map((e) => e.exerciseId);
  if (!ids.length) return fallback;
  let best = fallback;
  let bestScore = 0;
  for (const day of DAYS) {
    const dayIds = new Set(exercisesForDay(day.key).map((e) => e.id));
    const score = ids.filter((id) => dayIds.has(id)).length;
    if (score > bestScore) { bestScore = score; best = day.key; }
  }
  return best;
}

let saveTimer = null;
function persist() {
  // Coalesce rapid writes (typing into a rep field fires many) into one localStorage hit.
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      // QuotaExceededError is the realistic failure. Tell the user rather than losing data silently.
      console.error('Save failed:', err);
      window.dispatchEvent(new CustomEvent('store:error', { detail: err }));
    }
  }, 150);
}

function commit() {
  persist();
  window.dispatchEvent(new CustomEvent('store:changed'));
}

// ---------------------------------------------------------------- reads

export function getState() {
  return state;
}

export function getProfile() {
  return state.profile;
}

export function getSessions() {
  return state.sessions;
}

/** Sessions for one day type, oldest first. */
export function sessionsForDay(dayKey) {
  return state.sessions
    .filter((s) => s.dayKey === dayKey)
    .sort((a, b) => a.date.localeCompare(b.date));
}

export function getSession(id) {
  return state.sessions.find((s) => s.id === id) || null;
}

export function sessionOnDate(iso) {
  return state.sessions.find((s) => s.date === iso) || null;
}

/**
 * Every logged set for an exercise, oldest first, each tagged with its session date.
 * This is the input to the progression engine and every chart.
 */
export function historyFor(exerciseId, variant = null) {
  const out = [];
  for (const s of [...state.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
    // A slot can hold two different exercises across time — swap Barbell Bench for Dumbbell Bench
    // and both land here. Comparing reps across them is meaningless, so once a variant is asked
    // for, entries tagged as a DIFFERENT one are dropped.
    //
    // Untagged entries are kept deliberately. Only genuinely mixed slots were tagged by the v2
    // migration; everywhere else the absence of a tag means the slot has always held one exercise,
    // and excluding those would throw away every session logged before tagging existed.
    if (variant && entry.performedAs && entry.performedAs !== variant) continue;
    // A set counts as performed when it has reps. The ✓ tick is a convenience that starts
    // the rest timer — it was never meant to gate whether the set happened, and treating it
    // that way silently discarded 16 of 19 logged sets.
    const done = entry.sets.filter((set) => set.reps > 0);
    if (done.length) out.push({ sessionId: s.id, date: s.date, week: s.week, sets: done });
  }
  return out;
}

/** The most recent completed session for this exercise — "last week's numbers to beat". */
export function lastPerformance(exerciseId, excludeSessionId = null) {
  const h = historyFor(exerciseId).filter((x) => x.sessionId !== excludeSessionId);
  return h.length ? h[h.length - 1] : null;
}

export function getDailyLog(iso) {
  return state.dailyLogs[iso] || null;
}

export function getDailyLogs() {
  return state.dailyLogs;
}

export function getSubstitution(exerciseId) {
  return state.substitutions[exerciseId] || null;
}

/** The session pinned to a date, if any. */
export function getScheduledDay(iso) {
  return state.schedule[iso] || null;
}

export function setScheduledDay(iso, dayKey) {
  if (dayKey) state.schedule[iso] = dayKey;
  else delete state.schedule[iso];
  commit();
}

/** null = follow the global default. */
/**
 * How a given machine's numbers should be read — the fix for ambiguous plate markings.
 *
 * `perSide: true`  → you log one side (or one plate of a pair); the app stores the true total.
 * `addKg: <n>`     → a fixed bar or sled weight added to whatever you type.
 *
 * Kept out of `exerciseUnits` because it answers a different question: that one is "which unit is
 * printed on this machine", this one is "what does the printed number leave out".
 */
/**
 * Superset pairs the athlete's gym can't actually support.
 *
 * A superset assumes two stations within a few steps of each other. Real gyms are laid out by
 * equipment type, sometimes across floors — this one has the hanging-leg-raise frame and the cable
 * stack on different levels, which makes a 20-second transition physically impossible. Rather than
 * guess a layout I can't see, the pairing is breakable per day+group and the rest periods adjust.
 *
 * Keyed `dayKey:GROUP`, e.g. `arms:E`.
 */
export function isSupersetBroken(dayKey, group) {
  return Boolean(state.brokenSupersets[`${dayKey}:${group}`]);
}

export function setSupersetBroken(dayKey, group, broken) {
  const k = `${dayKey}:${group}`;
  if (broken) state.brokenSupersets[k] = true;
  else delete state.brokenSupersets[k];
  commit();
}

export function getExerciseConfig(exerciseId) {
  return state.exerciseConfig[exerciseId] || null;
}

export function setExerciseConfig(exerciseId, patch) {
  const next = { ...(state.exerciseConfig[exerciseId] || {}), ...patch };
  for (const k of Object.keys(next)) if (next[k] == null || next[k] === false) delete next[k];
  if (Object.keys(next).length) state.exerciseConfig[exerciseId] = next;
  else delete state.exerciseConfig[exerciseId];
  commit();
}

export function getExerciseUnit(exerciseId) {
  return state.exerciseUnits[exerciseId] || null;
}

export function setExerciseUnit(exerciseId, u) {
  if (u === 'kg' || u === 'lb') state.exerciseUnits[exerciseId] = u;
  else delete state.exerciseUnits[exerciseId];
  commit();
}

/** 1-based program week, derived from profile.programStart. */
export function currentWeek(iso = todayISO()) {
  const start = state.profile.programStart || iso;
  return Math.floor(daysBetween(start, iso) / 7) + 1;
}

// ---------------------------------------------------------------- writes

export function updateProfile(patch) {
  state.profile = { ...state.profile, ...patch };
  commit();
}

export function upsertSession(session) {
  const i = state.sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) state.sessions[i] = session;
  else state.sessions.push(session);
  commit();
  return session;
}

export function deleteSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  commit();
}

export function saveDailyLog(iso, patch) {
  state.dailyLogs[iso] = { ...(state.dailyLogs[iso] || {}), ...patch };
  commit();
}

export function setSubstitution(exerciseId, name) {
  if (name) state.substitutions[exerciseId] = name;
  else delete state.substitutions[exerciseId];
  commit();
}

export function newId() {
  // crypto.randomUUID needs a secure context; localhost and https both qualify, but keep a
  // fallback so the app still runs when opened straight off the filesystem.
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

// ---------------------------------------------------------------- backup

export function exportJSON() {
  return JSON.stringify(state, null, 2);
}

export function downloadBackup() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `workout-backup-${todayISO()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  state.meta.lastBackupAt = todayISO();
  commit();
}

/** Replaces all data. Throws on anything that doesn't look like our export. */
export function importJSON(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.sessions)) {
    throw new Error('That file doesn’t look like a workout backup.');
  }
  state = migrate(parsed);
  commit();
  return state;
}

export function resetAll() {
  state = emptyState();
  commit();
}

/** Days since the last export. Drives the "back up your data" nudge. */
export function daysSinceBackup() {
  if (!state.meta.lastBackupAt) {
    return state.sessions.length ? daysBetween(state.sessions[0].date, todayISO()) : 0;
  }
  return daysBetween(state.meta.lastBackupAt, todayISO());
}
