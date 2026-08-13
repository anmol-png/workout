/**
 * warmup.js — the general warm-up, and ramp sets computed from today's working weight.
 *
 * Two distinct things people conflate:
 *
 *   GENERAL WARM-UP — raise core temperature and move the joints you're about to load.
 *                     ~5 minutes, same every time, not exercise-specific.
 *
 *   RAMP SETS       — progressively heavier singles/triples on the FIRST exercise of a movement
 *                     pattern, to rehearse the groove and wake up the nervous system.
 *                     These are NOT working sets. They must not be logged and must not fatigue
 *                     you — that's the whole point, and the most common way people get it wrong.
 *
 * Static stretching is deliberately absent from the pre-workout list: holding a stretch >60s
 * before lifting transiently reduces force output. Dynamic movement does the same job without
 * the cost. Save static stretching for after, or a separate session.
 */

/** Per-session general warm-up. ~5–8 minutes, before the first ramp set. */
export const WARMUP = {
  push: [
    ['3 min easy bike or rower', 'Raise core temperature — cold joints press badly'],
    ['Band pull-aparts × 20', 'Wakes the upper back so your shoulders sit in a safe position'],
    ['Shoulder dislocates / pass-throughs × 10', 'Opens the shoulder girdle for pressing'],
    ['Scap push-ups × 10', 'Teaches the shoulder blades to set properly'],
  ],
  pull: [
    ['3 min easy bike or rower', 'Core temperature and blood flow'],
    ['Band pull-aparts × 20', 'Primes rear delts and mid-back — the muscles that should drive your rows'],
    ['Dead hang × 20–30 s', 'Decompresses the spine, opens the lats, wakes up your grip'],
    ['Scap pull-ups × 8', 'Teaches you to pull from the shoulder blades, not the arms'],
  ],
  legs: [
    ['4 min easy bike or incline walk', 'Cold hips and knees squat badly'],
    ['Leg swings × 10/leg, front-back and side-side', 'Opens the hips for depth'],
    ['Bodyweight squats × 12, slow, full depth', 'Grooves the pattern, mobilises ankles and hips'],
    ['Glute bridges × 15', 'CRITICAL — activates glutes so they fire during the squat instead of letting quads and lower back take over'],
  ],
  upper: [
    ['3 min easy bike or rower', 'Core temperature and blood flow'],
    ['Band pull-aparts × 20 + shoulder circles', 'Shoulders are doing their second session this week — warm them properly'],
    ['Scap push-ups × 10, scap pull-ups × 8', 'Sets the shoulder blades for both pressing and pulling'],
  ],
  lower: [
    ['3–4 min easy bike', 'Core temperature'],
    ['Glute bridges × 15, then single-leg × 8/side', 'Wakes the glutes before they are the day’s prime mover — the most important item here'],
    ['Leg swings × 10/leg', 'Hip mobility for the hinge and split squat'],
    ['Bodyweight split squats × 8/leg', 'Rehearses balance and the single-leg pattern'],
  ],
};

/** Round to something you can actually load. */
function roundTo(n, step) {
  return Math.round(n / step) * step;
}

/**
 * Ramp sets for one exercise, derived from today's working weight.
 *
 * Fewer steps when the gap between the bar and the working weight is small — a 45 kg bench
 * doesn't need four warm-up sets, and doing them would just make you tired for the real work.
 *
 * @param {object} ex        program.js exercise
 * @param {number|null} workingKg  today's target working weight
 * @param {number} barKg
 * @returns {Array<{weight:number|null, reps:number, note:string}>}
 */
export function rampSets(ex, workingKg, barKg = 20) {
  if (!ex || ex.isFinisher) return [];

  // Bodyweight lifts: rehearse the movement, don't load it.
  if (ex.unit === 'bodyweight') {
    return [{ weight: null, reps: 5, note: 'easy / assisted reps, well short of failure' }];
  }

  const w = Number(workingKg);
  if (!Number.isFinite(w) || w <= 0) {
    return [{ weight: null, reps: 8, note: 'a light set to find your load' }];
  }

  const isBar = ex.unit === 'barbell';
  const step = isBar ? 2.5 : ex.unit === 'dumbbell' ? 2 : 2.5;
  const out = [];

  if (isBar) out.push({ weight: barKg, reps: 10, note: 'empty bar' });

  const floor = isBar ? barKg : 0;
  const spread = w - floor;

  // Scale the number of ramp steps to how far there is to climb.
  let pcts;
  if (spread <= 12) pcts = [];
  else if (spread <= 30) pcts = [0.6];
  else if (spread <= 60) pcts = [0.55, 0.8];
  else pcts = [0.45, 0.65, 0.85];

  const reps = [5, 3, 2];
  pcts.forEach((p, i) => {
    const target = roundTo(w * p, step);
    // Skip anything that isn't meaningfully between the floor and the working weight.
    if (target <= floor + step || target >= w - step) return;
    out.push({ weight: target, reps: reps[i] ?? 2, note: '' });
  });

  return out;
}

/**
 * Which exercises get ramp sets.
 *
 * Only the FIRST exercise of each movement pattern needs a real ramp — by the time you reach the
 * accessories you're already warm, and extra warm-up sets there are pure fatigue. In practice
 * that means the session's first one or two compounds.
 */
export function needsRamp(ex, index, list = []) {
  if (!ex || ex.isFinisher) return false;
  if (index === 0) return true;
  if (index !== 1) return false;

  // The second exercise gets a ramp if it's another heavy barbell lift...
  if (ex.unit === 'barbell') return true;

  // ...or if the first exercise was bodyweight, in which case nothing has been LOADED yet and
  // this is really the first weighted movement of the session (e.g. Upper: dip → lat pulldown).
  return list[0]?.unit === 'bodyweight';
}
