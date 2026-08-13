/**
 * stats.js — derived numbers. e1RM, PRs, weekly volume, bodyweight trend.
 *
 * Nothing here is persisted; it's all computed from store.js on demand. That keeps a single
 * source of truth (the logged sets) and means changing a formula never requires a migration.
 */

import { EXERCISES, getExercise, VOLUME_TARGETS, MUSCLES, DAYS } from './program.js';
import { getSessions, getDailyLogs, todayISO, parseISO, daysBetween } from './store.js';

// ---------------------------------------------------------------- estimated 1RM

/**
 * Epley: 1RM ≈ w × (1 + reps/30).
 *
 * RPE adjustment: a set of 8 at RPE 8 had 2 reps left, so it represents a set of 10 for
 * strength-estimation purposes. Folding RPE in makes e1RM comparable across sessions where
 * you pushed harder or backed off — without it, an easy day looks like a regression.
 *
 * Accuracy degrades badly above ~12 reps, so anything higher is capped for the estimate.
 */
export function e1RM(weight, reps, rpe = null) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (w <= 0 || r <= 0) return 0;
  const rir = rpe == null ? 0 : Math.max(0, 10 - Number(rpe));
  const effective = Math.min(r + rir, 12);
  return w * (1 + effective / 30);
}

export function bestE1RM(sets) {
  return sets.reduce((best, s) => Math.max(best, e1RM(s.weight, s.reps, s.rpe)), 0);
}

/** Volume load for a set: weight × reps. The simplest honest measure of work done. */
export function setVolume(s) {
  return (Number(s.weight) || 0) * (Number(s.reps) || 0);
}

// ---------------------------------------------------------------- PRs

/**
 * ── DECISION POINT ────────────────────────────────────────────────────────────
 * What counts as a personal record?
 *
 * This is purely a motivation question — it changes what the app celebrates, and therefore what
 * you unconsciously start chasing. All three are defensible:
 *
 *   E1RM    — best estimated 1-rep max. Rewards genuine strength gain, and correctly fires when
 *             you get more reps at the same weight. Fires often enough to stay motivating.
 *   WEIGHT  — heaviest load ever moved for at least the bottom of the rep range. Simple and
 *             unambiguous, but fires rarely and ignores rep progress entirely.
 *   VOLUME  — best weight × reps in a single set. Rewards work capacity and high-rep sets, which
 *             suits a hypertrophy program — but a light 20-rep set can beat a heavy 5.
 *
 * @param {{weight:number, reps:number, rpe:number|null}} set  the set just logged
 * @param {Array} history  prior sessions for this exercise (excluding the current one)
 * @param {object} exercise
 * @returns {{isPR:boolean, kind:string|null, prev:number, value:number}}
 */
export function isPersonalRecord(set, history, exercise) {
  const priorSets = history.flatMap((h) => h.sets);
  if (!priorSets.length || !set.reps) return { isPR: false, kind: null, prev: 0, value: 0 };

  // CHOSEN: E1RM. Fires on more reps at the same weight OR more weight at the same reps, so it
  // tracks genuine strength gain and triggers often enough to stay motivating.
  //
  // To change: WEIGHT → const value = (set.reps >= exercise.repRange[0]) ? Number(set.weight) || 0 : 0;
  //                     const prev  = Math.max(...priorSets.filter(s => s.reps >= exercise.repRange[0])
  //                                                       .map(s => Number(s.weight) || 0), 0);
  //                     return { isPR: value > prev && value > 0, kind: 'weight', prev, value };
  //            VOLUME → const value = setVolume(set);
  //                     const prev  = Math.max(...priorSets.map(setVolume), 0);
  //                     return { isPR: value > prev, kind: 'volume', prev, value };

  const value = e1RM(set.weight, set.reps, set.rpe);
  const prev = Math.max(...priorSets.map((s) => e1RM(s.weight, s.reps, s.rpe)), 0);
  return { isPR: value > prev && value > 0, kind: 'e1rm', prev, value };
}

// ---------------------------------------------------------------- weekly volume

/**
 * Hard sets per muscle for a given ISO week-start.
 *
 * Counting convention: a completed set counts 1.0 toward each PRIMARY muscle and 0.5 toward each
 * SECONDARY. A bench press is a chest set and half a triceps set — closer to the truth than
 * counting it fully for both (which would inflate arms enormously) or not at all.
 */
export function weeklyVolume(weekStartISO) {
  const totals = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  const end = addDays(weekStartISO, 7);

  for (const s of getSessions()) {
    if (s.date < weekStartISO || s.date >= end) continue;
    for (const entry of s.entries) {
      const ex = getExercise(entry.exerciseId);
      if (!ex || ex.isFinisher) continue;
      const done = entry.sets.filter((set) => set.reps > 0).length;
      if (!done) continue;
      for (const m of ex.muscles.primary) totals[m] += done;
      for (const m of ex.muscles.secondary) totals[m] += done * 0.5;
    }
  }
  return totals;
}

/** What the program prescribes, if every set is completed. The baseline the chart compares against. */
export function plannedWeeklyVolume() {
  const totals = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  // Optional sessions (Arms) are extras you may or may not run, so they don't belong in the
  // program's baseline — counting them would overstate what the plan actually prescribes.
  const optional = new Set(DAYS.filter((d) => d.optional).map((d) => d.key));
  for (const ex of EXERCISES) {
    if (ex.isFinisher || optional.has(ex.day)) continue;
    for (const m of ex.muscles.primary) totals[m] += ex.sets;
    for (const m of ex.muscles.secondary) totals[m] += ex.sets * 0.5;
  }
  return totals;
}

/**
 * Actual completed working sets in a week, and how many were leg work.
 *
 * Deliberately NOT the sum of weeklyVolume(): that double-counts, because one bench press set
 * contributes to chest AND (at 0.5) to triceps and front delts. Summing it gives a number far
 * larger than the sets you actually performed, which is fine per-muscle and misleading as a total.
 */
export function weeklySetCounts(weekStartISO) {
  const LEG = new Set(['quads', 'hamstrings', 'glutes', 'calves']);
  const end = addDays(weekStartISO, 7);
  let total = 0;
  let legs = 0;

  for (const s of getSessions()) {
    if (s.date < weekStartISO || s.date >= end) continue;
    for (const entry of s.entries) {
      const ex = getExercise(entry.exerciseId);
      if (!ex || ex.isFinisher) continue;
      const done = entry.sets.filter((set) => set.reps > 0).length;
      total += done;
      if (ex.muscles.primary.some((m) => LEG.has(m))) legs += done;
    }
  }
  return { total, legs, legShare: total ? legs / total : 0 };
}

export function volumeStatus(muscle, sets) {
  const band = VOLUME_TARGETS[muscle];
  if (!band) return 'in';
  if (sets < band[0]) return 'under';
  if (sets > band[1]) return 'over';
  return 'in';
}

/** Monday-anchored week start for any ISO date. */
export function weekStart(iso = todayISO()) {
  const d = parseISO(iso);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  return addDays(iso, -dow);
}

export function addDays(iso, n) {
  const d = parseISO(iso);
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- bodyweight

/**
 * Bodyweight series with a 7-day rolling average.
 *
 * The rolling average is the only number worth acting on: daily weight swings 1–2 kg on water,
 * salt and food volume. Reacting to a single day's reading is how people cut calories during a
 * perfectly normal week of muscle gain.
 */
export function bodyweightSeries() {
  const logs = getDailyLogs();
  const points = Object.entries(logs)
    .filter(([, v]) => v && Number(v.bodyweightKg) > 0)
    .map(([date, v]) => ({ date, kg: Number(v.bodyweightKg) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return points.map((p, i) => {
    const window = points.filter((q) => {
      const gap = daysBetween(q.date, p.date);
      return gap >= 0 && gap < 7;
    });
    const avg = window.reduce((n, q) => n + q.kg, 0) / (window.length || 1);
    return { ...p, avg, index: i };
  });
}

/**
 * Weekly rate of change from the rolling averages, and whether it's on target.
 * Needs ~14 days before it says anything — a shorter window is mostly noise.
 */
export function bodyweightTrend() {
  const series = bodyweightSeries();
  if (series.length < 5) {
    return { ready: false, ratePerWeek: 0, verdict: 'need-data', days: series.length };
  }
  const last = series[series.length - 1];
  const window = series.filter((p) => daysBetween(p.date, last.date) <= 21);
  const first = window[0];
  const days = daysBetween(first.date, last.date);
  if (days < 10) return { ready: false, ratePerWeek: 0, verdict: 'need-data', days };

  const ratePerWeek = ((last.avg - first.avg) / days) * 7;

  let verdict;
  if (ratePerWeek < 0) verdict = 'losing';
  else if (ratePerWeek < 0.15) verdict = 'flat';
  else if (ratePerWeek <= 0.45) verdict = 'on-target';
  else verdict = 'fast';

  return { ready: true, ratePerWeek, verdict, days, current: last.avg };
}

// ---------------------------------------------------------------- session stats

export function sessionVolume(session) {
  return session.entries.reduce(
    (n, e) => n + e.sets.filter((s) => s.reps > 0).reduce((m, s) => m + setVolume(s), 0),
    0,
  );
}

export function sessionSetCount(session) {
  return session.entries.reduce((n, e) => n + e.sets.filter((s) => s.reps > 0).length, 0);
}

/** Consecutive weeks (Monday-anchored) with at least one logged session, counting back from now. */
export function currentStreak() {
  const sessions = getSessions();
  if (!sessions.length) return 0;
  const weeks = new Set(sessions.map((s) => weekStart(s.date)));
  let streak = 0;
  let w = weekStart();
  // Don't punish the current week for not having started yet.
  if (!weeks.has(w)) w = addDays(w, -7);
  while (weeks.has(w)) {
    streak += 1;
    w = addDays(w, -7);
  }
  return streak;
}

/** e1RM over time for one exercise — the strength-progression chart series. */
export function e1RMSeries(history) {
  return history
    .map((h) => ({ date: h.date, value: bestE1RM(h.sets) }))
    .filter((p) => p.value > 0);
}
