/**
 * plates.js — barbell plate calculator.
 *
 * Solves the mid-session arithmetic problem: "52.5 kg total, 20 kg bar — what goes on each side?"
 * Greedy from the heaviest plate down, which is provably optimal for the standard gym plate set
 * (each denomination divides evenly into the ones above it) and also happens to match how you'd
 * actually load a bar — big plates innermost.
 */

/**
 * @param {number} target   total weight including the bar
 * @param {number} barKg
 * @param {number[]} available  plate denominations per side, any order
 * @returns {{ok:boolean, perSide:number[], achieved:number, remainder:number, barOnly:boolean}}
 */
export function computePlates(target, barKg = 20, available = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  const t = Number(target) || 0;

  if (t <= barKg) {
    return { ok: t === barKg, perSide: [], achieved: barKg, remainder: t - barKg, barOnly: true };
  }

  let perSideNeeded = (t - barKg) / 2;
  const plates = [...available].sort((a, b) => b - a);
  const used = [];

  for (const p of plates) {
    // Float tolerance: 1.25 kg plates make exact comparisons unreliable (0.1 + 0.2 problems).
    while (perSideNeeded >= p - 1e-9) {
      used.push(p);
      perSideNeeded -= p;
    }
  }

  const achieved = barKg + used.reduce((n, p) => n + p, 0) * 2;
  return {
    ok: Math.abs(achieved - t) < 1e-6,
    perSide: used,
    achieved,
    remainder: round(t - achieved),
    barOnly: false,
  };
}

/**
 * The nearest weight actually loadable with the plates on hand.
 * Useful because progression increments don't always land on a loadable number — a +2 kg dumbbell
 * increment applied to a barbell lift can ask for 51 kg, which no plate set can make.
 */
export function nearestLoadable(target, barKg = 20, available = [25, 20, 15, 10, 5, 2.5, 1.25]) {
  const smallest = Math.min(...available);
  const step = smallest * 2; // both sides
  if (target <= barKg) return barKg;
  return round(barKg + Math.round((target - barKg) / step) * step);
}

/** CSS class for the plate's colour/size, matching common gym colour coding. */
export function plateClass(kg) {
  if (kg >= 25) return 'p25';
  if (kg >= 20) return 'p20';
  if (kg >= 15) return 'p15';
  if (kg >= 10) return 'p10';
  if (kg >= 5) return 'p5';
  if (kg >= 2.5) return 'p2';
  return 'p1';
}

function round(n) {
  return Math.round(n * 100) / 100;
}
