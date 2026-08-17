/**
 * progression.js — the double-progression engine.
 *
 * This is the module that makes the app more than a notebook. It reads your history for an
 * exercise and answers one question: "what should I be lifting today?"
 *
 * The rule, from program/00-Program-Overview.md:
 *
 *   Hit the TOP of the rep range on all working sets at or below the target RPE
 *   → add the smallest increment and restart at the bottom of the range.
 *   Add reps first, load second, always.
 *
 * Everything else in here is bookkeeping around that one idea.
 */

import { getExercise } from './program.js';

/**
 * How weights get rendered inside the hint strings below.
 *
 * Injected rather than imported so this module stays pure and unit-agnostic — it computes in kg
 * and knows nothing about the user's display preference. app.js swaps in the units-aware
 * formatter at boot; the kg default keeps the module testable in isolation.
 */
let fmtW = (kg) => `${Number.isInteger(kg) ? kg : Number(kg).toFixed(1)} kg`;

export function setWeightFormatter(fn) {
  fmtW = fn;
}

/**
 * How big a load jump is, in kg, for a given exercise.
 *
 * Injected for the same reason as the formatter: on a lb-denominated machine the real jump is
 * 5 lb (~2.27 kg), not the 2.5 kg the program specifies — and suggesting 2.5 kg would produce a
 * target you physically cannot select on the stack. The default uses the program's own figure.
 */
let incrementFor = (ex) => ex.increment;

export function setIncrementResolver(fn) {
  incrementFor = fn;
}

/** Result codes returned as `action`, so the UI can pick wording and colour. */
export const ACTION = {
  CALIBRATE: 'calibrate',   // no history — Week 1, find your load
  ADD_LOAD: 'addLoad',      // earned an increment
  ADD_REPS: 'addReps',      // stay at this load, add a rep
  REPEAT: 'repeat',         // didn't clear the bottom of the range — repeat
  STALL: 'stall',           // no progress in 3 sessions — back off or rotate
};

const STALL_SESSIONS = 3;
const STALL_BACKOFF = 0.9; // 10% off when a lift stalls

/**
 * Did a single logged set clear the top of the rep range at or below the RPE ceiling?
 *
 * The RPE check matters as much as the rep count: 8 reps at RPE 10 is a set you barely survived,
 * not a set you're ready to add weight to. Requiring rpe <= ceiling means the increment only
 * fires when the reps came with something left in the tank.
 * A missing RPE is treated as acceptable — plenty of sets get logged without one.
 */
function setClearsTop(set, exercise) {
  const [, topReps] = exercise.repRange;
  const rpeCeiling = exercise.rpe[1];
  const repsOk = set.reps >= topReps;
  const rpeOk = set.rpe == null || set.rpe <= rpeCeiling;
  return repsOk && rpeOk;
}

function setClearsBottom(set, exercise) {
  return set.reps >= exercise.repRange[0];
}

/** The load a session was performed at — the modal (most common) weight across its sets. */
function sessionLoad(perf) {
  const weights = perf.sets.map((s) => Number(s.weight) || 0);
  if (!weights.length) return 0;
  const counts = new Map();
  for (const w of weights) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/**
 * The WORKING sets of a session — the ones performed at its working load.
 *
 * Real sessions aren't flat. You ramp into a lift (55, 60, then 70×2), or you try a jump, find
 * it too heavy and drop back down. Judging progression across all of those compares rep counts
 * taken at different loads, which is meaningless: 8 reps at 55 kg says nothing about whether
 * you're ready to add reps at 70 kg. Worse, it flatters you — the light ramp set posts the
 * highest rep count in the session and becomes the number the next target is built on.
 *
 * The modal weight is the right anchor rather than the heaviest. It reads a ramp (55/60/70/70 →
 * 70) and a failed jump (60/70/60 → 60) correctly, where "heaviest" gets the second one backwards
 * and would prescribe the load you just bailed out of.
 */
function workingSets(perf) {
  const load = sessionLoad(perf);
  return perf.sets.filter((s) => (Number(s.weight) || 0) === load && (Number(s.reps) || 0) > 0);
}

/** Total reps completed in a session — the tiebreaker for "did anything improve?". */
function sessionReps(perf) {
  return perf.sets.reduce((n, s) => n + (Number(s.reps) || 0), 0);
}

/**
 * ── DECISION POINT ────────────────────────────────────────────────────────────
 * How strict is "all sets hit the top of the range"?
 *
 * This single function decides how fast the entire program moves, so it belongs to the athlete,
 * not to the app author.
 *
 *   STRICT   — every working set must clear the top of the range.
 *              Slower, but every increment is genuinely earned and set 4 never collapses.
 *   LENIENT  — the majority of sets clearing is enough.
 *              Faster load progression, at the cost of some sloppy final sets.
 *   FIRST_SET— only the first (freshest, heaviest-quality) set has to clear.
 *              Fastest. Realistic for someone whose later sets always drop off from fatigue.
 *
 * @param {Array<{weight:number, reps:number, rpe:number|null}>} sets  completed sets, in order
 * @param {object} exercise  the program.js exercise (repRange, rpe, sets)
 * @returns {boolean} true → the athlete earned a load increase
 */
export function earnedIncrement(sets, exercise) {
  const clearing = sets.filter((s) => setClearsTop(s, exercise));

  // CHOSEN: STRICT. Every working set must clear the top of the range at or below the RPE
  // ceiling. Slower than the alternatives, but no increment is ever taken on a set that was
  // already grinding — which is the right call starting from estimated Week-1 loads.
  //
  // To change: LENIENT   → return clearing.length >= Math.ceil(sets.length / 2);
  //            FIRST_SET → return sets.length > 0 && setClearsTop(sets[0], exercise);
  return clearing.length === sets.length && sets.length >= exercise.sets;
}

/**
 * What should today's target be for this exercise?
 *
 * @param {Array} history  from store.historyFor() — oldest first, each { date, sets }
 * @param {string} exerciseId
 * @returns {{action:string, weight:number|null, reps:number, note:string, lastWeight:number|null}}
 */
export function computeNextTarget(history, exerciseOrId) {
  // Accepts a resolved exercise object so a SUBSTITUTED slot uses the substitute's equipment
  // and starting load, not the original's.
  const ex = typeof exerciseOrId === 'string' ? getExercise(exerciseOrId) : exerciseOrId;
  if (!ex) return { action: ACTION.CALIBRATE, weight: null, reps: 0, note: '', lastWeight: null };

  const [lo, hi] = ex.repRange;

  // ── No history: Week 1 calibration.
  if (!history.length) {
    return {
      action: ACTION.CALIBRATE,
      weight: ex.startLoad,
      reps: lo,
      lastWeight: null,
      note: ex.unit === 'bodyweight'
        ? 'Bodyweight to start — leave the weight blank. Add a belt once you hit the top of the range on all sets.'
        : ex.startLoad == null
          ? 'Calibration set — find a load that lands at the target RPE.'
          : 'Starting estimate. Week 1 is calibration — chase the RPE, not the number.',
    };
  }

  const last = history[history.length - 1];
  const lastWeight = sessionLoad(last);
  const working = workingSets(last);

  // The WORST working set, not the best. Double progression asks for the top of the range on
  // EVERY set, so the weakest set is the one holding the load back — it's the only one whose
  // improvement actually moves you forward.
  const lastWorstReps = working.length
    ? Math.min(...working.map((s) => Number(s.reps) || 0))
    : 0;

  // ── Earned the increment?
  if (earnedIncrement(working, ex)) {
    const inc = incrementFor(ex);
    const next = inc ? round(lastWeight + inc) : lastWeight;
    return {
      action: ACTION.ADD_LOAD,
      weight: next,
      reps: lo,
      lastWeight,
      note: inc
        ? (ex.unit === 'bodyweight'
          ? `You hit ${hi}s last time — add ${fmtW(inc, ex)} on a belt, back to ${lo} reps.`
          : `You hit ${hi}s last time — up ${fmtW(inc, ex)}, back to ${lo} reps.`)
        : `You hit ${hi}s last time — add load or a notch.`,
    };
  }

  // ── Stalled? Three sessions with no added reps and no added load.
  if (isStalled(history)) {
    return {
      action: ACTION.STALL,
      weight: round(lastWeight * STALL_BACKOFF),
      reps: lo,
      lastWeight,
      note: `Stalled ${STALL_SESSIONS} sessions. Take ~10% off for one session, or rotate to a substitute.`,
    };
  }

  // ── Cleared the bottom of the range: same load, one more rep.
  const clearedBottom = working.length > 0 && working.every((s) => setClearsBottom(s, ex));
  if (clearedBottom) {
    const target = Math.min(lastWorstReps + 1, hi);
    const short = working.length < ex.sets;
    return {
      action: ACTION.ADD_REPS,
      weight: lastWeight,
      reps: target,
      lastWeight,
      note: short
        ? `Same weight — get ${target} on every set. Only ${working.length} of ${ex.sets} sets were at ${fmtW(lastWeight, ex)} last time; the lighter ones count as warm-ups.`
        : `Same weight — get ${target} on every set.`,
    };
  }

  // ── Didn't clear the bottom: repeat it.
  return {
    action: ACTION.REPEAT,
    weight: lastWeight,
    reps: lo,
    lastWeight,
    note: `Repeat ${fmtW(lastWeight, ex)} until all sets reach ${lo}.`,
  };
}

/** No improvement in weight or total reps across the last STALL_SESSIONS sessions. */
export function isStalled(history) {
  if (history.length < STALL_SESSIONS) return false;
  const recent = history.slice(-STALL_SESSIONS);
  const first = recent[0];
  const firstW = sessionLoad(first);
  const firstR = sessionReps(first);
  return recent.slice(1).every((p) => sessionLoad(p) <= firstW && sessionReps(p) <= firstR);
}

/** Round to the nearest 0.5 kg — nothing finer exists in a real gym. */
function round(w) {
  return Math.round(w * 2) / 2;
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Human-readable summary of the last performance, e.g. "60 kg × 8, 8, 7".
 * This is the "beat this" line shown above every exercise.
 */
export function describePerformance(perf, exercise = null) {
  if (!perf || !perf.sets.length) return null;
  const w = sessionLoad(perf);
  const reps = perf.sets.map((s) => s.reps).join(', ');
  const allSame = perf.sets.every((s) => Number(s.weight) === w);
  // A bodyweight lift stores ADDED weight, so 0 means "just bodyweight" — never "0 kg".
  const label = exercise?.unit === 'bodyweight'
    ? (kg) => (kg > 0 ? `BW+${fmtW(kg, exercise)}` : 'BW')
    : (kg) => fmtW(kg, exercise);
  if (allSame) return `${label(w)} × ${reps}`;
  return perf.sets.map((s) => `${label(Number(s.weight) || 0)}×${s.reps}`).join(', ');
}

// ---------------------------------------------------------------- per-set projection

/**
 * Default rep drop-off per set, by how long you rest.
 *
 * Reps fall across sets because fatigue accumulates faster than it clears. Longer rest recovers
 * more of it, so heavy compounds hold their reps far better than a 20-second superset does.
 */
function defaultDecay(restSec) {
  const rest = Math.max(Number(restSec) || 0, 60);
  if (rest >= 150) return 0.94;   // ~6% per set — heavy compounds, near-full recovery
  if (rest >= 90) return 0.90;    // ~10% — accessories
  return 0.85;                    // ~15% — supersets and short rest
}

/**
 * The athlete's OWN observed drop-off, when there's enough history to see it.
 *
 * Only sessions where the weight stayed constant are usable — if the load changed between sets,
 * the rep change says nothing about fatigue. Ratios are clamped at 1.0 because sets that went UP
 * mean the weight was too light and you warmed into it, not that fatigue improves performance.
 */
function observedDecay(history, nSets) {
  const samples = Array.from({ length: nSets }, () => []);

  for (const h of history) {
    const sets = h.sets;
    if (sets.length < 2) continue;
    const w0 = Number(sets[0].weight) || 0;
    if (!sets.every((x) => (Number(x.weight) || 0) === w0)) continue;
    const first = Number(sets[0].reps) || 0;
    if (!first) continue;
    sets.forEach((x, i) => {
      if (i < nSets && x.reps) samples[i].push(Math.min(1, (Number(x.reps) || 0) / first));
    });
  }

  return samples.map((arr) => (arr.length >= 2
    ? arr.reduce((a, b) => a + b, 0) / arr.length
    : null));
}

/**
 * What you can realistically expect on EACH set — not the same number repeated.
 *
 * The prescription is one weight and one rep goal; reality is that set 4 gives you fewer reps
 * than set 1. This projects the drop-off so the numbers in front of you are honest, using your
 * own history where it exists and a rest-based model where it doesn't.
 *
 * @returns {Array<{weight:number|null, reps:number, note:string}>} one entry per working set
 */
export function projectSets(history, exercise, target) {
  const n = exercise.sets;
  const [lo, hi] = exercise.repRange;
  const observed = observedDecay(history, n);
  const decay = defaultDecay(exercise.restSec);

  // Shape of the drop-off across sets — your own observed ratios where they exist, a rest-based
  // model where they don't.
  const shape = Array.from({ length: n }, (_, i) => observed[i] ?? decay ** i);
  const floorShape = Math.min(...shape);
  const avgShape = shape.reduce((a, b) => a + b, 0) / n;

  /*
   * WHERE THE CURVE GETS PINNED — the difference between a useful projection and a flat one.
   *
   * A progression target ("get 5 on all four sets") is a FLOOR: it's what the WORST set has to
   * clear. Scaling the curve so its *average* lands there puts half the sets underneath the
   * floor, and since reps can't be shown below `lo` they all clamp to the same number — the
   * projection collapses to "5 / 5 / 5 / 5" and tells you nothing. Pinning the LAST set to the
   * target instead keeps the whole curve at or above it, which is what the target actually asks.
   *
   * Calibration is the one case that inverts: there is no earned target, so the mid-range figure
   * is a best guess to bracket rather than a floor to clear — average-pinning is right there.
   */
  const scale = target.action === ACTION.CALIBRATE
    ? (avgShape > 0 ? ((lo + hi) / 2) / avgShape : 1)
    : (floorShape > 0 ? (target.reps || lo) / floorShape : 1);

  return shape.map((r, i) => ({
    weight: target.weight,
    reps: Math.min(hi, Math.max(lo, Math.round(r * scale))),
    note: observed[i] != null ? 'from your history' : 'estimated',
  }));
}

/** "8 / 8 / 7 / 7" — the projection as a single readable line. */
export function describeProjection(projection) {
  return projection.map((p) => p.reps).join(' / ');
}
