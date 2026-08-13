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
const SCHEMA_VERSION = 1;

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
    meta: {
      lastBackupAt: null,
      createdAt: new Date().toISOString(),
    },
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw);
    return migrate(parsed);
  } catch (err) {
    console.error('Failed to read saved data, starting fresh:', err);
    return emptyState();
  }
}

/**
 * Forward-migrate older saved data. Currently a no-op beyond filling gaps, but the shape is here
 * so a v2 never silently drops a user's training history.
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
    sessions: dedupeSessions(Array.isArray(data.sessions) ? data.sessions : []),
  };
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
export function historyFor(exerciseId) {
  const out = [];
  for (const s of [...state.sessions].sort((a, b) => a.date.localeCompare(b.date))) {
    const entry = s.entries.find((e) => e.exerciseId === exerciseId);
    if (!entry) continue;
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

/** null = follow the global default. */
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
