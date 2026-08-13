/**
 * readiness.js — autoregulation.
 *
 * From program/00-Program-Overview.md §6: on 6–7 h sleep, some weeks will be worse, and grinding
 * through a bad day is how you end up injured or stalled. This module decides what a bad day
 * costs you.
 *
 * The prescribed cut is: drop the last set of every exercise, subtract 1 from every RPE target,
 * skip the finisher. That keeps ~80% of the stimulus for ~60% of the fatigue.
 */

const SLEEP_THRESHOLD = 6;     // hours
const READINESS_THRESHOLD = 2; // out of 5

/**
 * Should today's session be cut back?
 * @returns {{triggered:boolean, reason:string|null}}
 */
export function shouldAutoregulate(log) {
  if (!log) return { triggered: false, reason: null };
  const sleep = Number(log.sleepHours);
  const readiness = Number(log.readiness);

  if (sleep && sleep < SLEEP_THRESHOLD) {
    return { triggered: true, reason: `${fmt(sleep)} h of sleep` };
  }
  if (readiness && readiness <= READINESS_THRESHOLD) {
    return { triggered: true, reason: `readiness ${readiness}/5` };
  }
  return { triggered: false, reason: null };
}

/**
 * ── DECISION POINT ────────────────────────────────────────────────────────────
 * How aggressive is the bad-day cut?
 *
 * This is a genuine trade-off with no universally correct answer, and it's the athlete's call:
 *
 *   GENTLE   — skip the finisher only. Keeps almost all training volume.
 *              Risk: on a genuinely bad week you keep digging the recovery hole.
 *   STANDARD — the program's prescription: drop the last set of everything, RPE −1,
 *              skip the finisher. (~80% stimulus, ~60% fatigue.)
 *   AGGRESSIVE — drop the last set, RPE −2, skip the finisher, AND drop the last
 *              accessory exercise entirely. Best recovery, most lost volume.
 *
 * Too soft and bad sleep compounds into a stall. Too harsh and a single rough night costs you a
 * week of progress. Where you land depends on how often you actually sleep badly.
 *
 * @param {Array} exercises  program.js exercises for today's session
 * @returns {{setsDelta:number, rpeDelta:number, dropFinisher:boolean, dropLastAccessory:boolean, label:string}}
 */
export function autoregulationPlan() {
  // CHOSEN: STANDARD — exactly what program/00-Program-Overview.md §6 prescribes.
  // ~80% of the stimulus for ~60% of the fatigue.
  //
  // To change: GENTLE     → { setsDelta: 0,  rpeDelta: 0,  dropFinisher: true, dropLastAccessory: false, label: 'Gentle' }
  //            AGGRESSIVE → { setsDelta: -1, rpeDelta: -2, dropFinisher: true, dropLastAccessory: true,  label: 'Aggressive' }
  return {
    setsDelta: -1,
    rpeDelta: -1,
    dropFinisher: true,
    dropLastAccessory: false,
    label: 'Standard',
  };
}

/**
 * Applies the plan to today's exercise list, returning adjusted prescriptions.
 * Never cuts an exercise below 2 sets — below that it stops being a stimulus at all.
 */
export function applyAutoregulation(exercises) {
  const plan = autoregulationPlan();
  let list = exercises;

  if (plan.dropFinisher) list = list.filter((e) => !e.isFinisher);

  if (plan.dropLastAccessory && list.length > 3) {
    // "Accessory" = anything after the first two exercises; never cut the session's anchors.
    list = list.slice(0, -1);
  }

  return list.map((ex) => ({
    ...ex,
    sets: Math.max(2, ex.sets + plan.setsDelta),
    rpe: ex.rpe.map((r) => Math.max(5, r + plan.rpeDelta)),
    _autoregulated: true,
  }));
}

function fmt(n) {
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}
