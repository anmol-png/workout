/**
 * units.js — kg ⇄ lb display, per exercise, snapped to weights that actually exist.
 *
 * TWO RULES THIS MODULE EXISTS TO ENFORCE
 *
 * 1. **Everything is stored in kilograms, always.** The unit is a display concern. Storing
 *    whichever unit happened to be active would make history ambiguous the moment you toggled —
 *    a "110" logged last March would have no defined meaning.
 *
 * 2. **Suggested weights snap to loadable increments.** A raw conversion produces numbers like
 *    77 lb, which no plate or stack can make. Every *target* the app suggests is therefore
 *    rounded to the real increment for that equipment in that unit (5 lb on a lb stack,
 *    2.5 kg on a kg barbell). Weights you actually LOGGED are shown as entered — those are
 *    facts, not suggestions, and must never be silently rounded.
 *
 * Units are per exercise, not global, because real gyms mix equipment: a kg barbell next to a
 * lb-stack pulldown. Each exercise falls back to the global default until overridden.
 */

import { getProfile, getExerciseUnit } from './store.js';

const LB_PER_KG = 2.2046226218;

/**
 * Smallest realistic increment, by equipment and unit.
 *
 * lb gyms work in 5 lb steps (2.5 lb plate pairs; stacks are usually 10–15 lb but most have
 * 2.5/5 lb add-ons). kg gyms work in 2.5 kg on a bar (1.25 kg pairs) and 2 kg on dumbbells.
 */
const INCREMENT = {
  kg: { barbell: 2.5, dumbbell: 2, machine: 2.5, bodyweight: 2.5, none: 2.5 },
  lb: { barbell: 5, dumbbell: 5, machine: 5, bodyweight: 5, none: 5 },
};

/** The global default unit. */
export function unit() {
  return getProfile().units === 'lb' ? 'lb' : 'kg';
}

export function isLb() {
  return unit() === 'lb';
}

/** The unit for one exercise: its override, else the global default. */
export function unitFor(exId) {
  return getExerciseUnit(exId) || unit();
}

function conv(kg, u) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return n;
  return u === 'lb' ? n * LB_PER_KG : n;
}

/** kg (stored) → the number to show, in this exercise's unit. */
export function toDisplay(kg, exId = null) {
  return conv(kg, unitFor(exId));
}

/** What the user typed, in this exercise's unit → kg for storage. */
export function toKg(value, exId = null) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  if (unitFor(exId) !== 'lb') return n;
  return Math.round((n / LB_PER_KG) * 1000) / 1000;
}

function trimNum(n) {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * Display a weight that was actually LOGGED. Rounded to 0.5 only — never snapped, because this
 * is a record of what you did, not a suggestion.
 */
export function num(kg, exId = null) {
  const v = toDisplay(kg, exId);
  if (!Number.isFinite(v)) return '';
  return trimNum(Math.round(v * 2) / 2);
}

export function w(kg, exId = null) {
  return `${num(kg, exId)} ${unitFor(exId)}`;
}

/**
 * Display a SUGGESTED weight (a target, a ramp set, a starting load), snapped to something the
 * equipment can actually produce. This is what turns a raw 77.2 lb into a loadable 75 lb.
 *
 * @param {number} kg  the suggestion, in kg
 * @param {object} ex  program.js exercise — its `unit` field picks the increment
 * @returns {number|null} the snapped value IN DISPLAY UNITS
 */
export function snap(kg, ex) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return null;
  const u = unitFor(ex?.id);
  const stepSize = INCREMENT[u][ex?.unit] ?? INCREMENT[u].machine;
  const disp = conv(n, u);
  if (disp <= 0) return 0;
  // Never snap a positive suggestion down to zero — round up to one increment instead.
  return Math.max(stepSize, Math.round(disp / stepSize) * stepSize);
}

/** A snapped suggestion, formatted with its unit. */
export function snapW(kg, ex) {
  const v = snap(kg, ex);
  return v == null ? '' : `${trimNum(v)} ${unitFor(ex?.id)}`;
}

export function snapNum(kg, ex) {
  const v = snap(kg, ex);
  return v == null ? '' : trimNum(v);
}

/**
 * The load increment for an exercise, expressed in kg but sized in its own unit.
 *
 * On a lb machine the real jump is 5 lb (≈2.27 kg), not the 2.5 kg the program specifies — using
 * the program's kg figure would produce targets you cannot select on the stack.
 */
export function incrementKg(ex) {
  const u = unitFor(ex?.id);
  const stepSize = INCREMENT[u][ex?.unit] ?? INCREMENT[u].machine;
  return u === 'lb' ? stepSize / LB_PER_KG : stepSize;
}

/** Input step for a number field. */
export function step(exId = null) {
  return unitFor(exId) === 'lb' ? '2.5' : '0.5';
}

// ---------------------------------------------------------------- global-unit helpers
// Bodyweight, rates and volume totals aren't tied to any one exercise, so they use the default.

export function bw(kg, withUnit = true) {
  const v = conv(kg, unit());
  if (!Number.isFinite(v)) return '';
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return withUnit ? `${s} ${unit()}` : s;
}

export function bwToKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  return isLb() ? Math.round((n / LB_PER_KG) * 1000) / 1000 : n;
}

export function rate(kgPerWeek) {
  const v = conv(kgPerWeek, unit());
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${unit()}/week`;
}

export function volume(kg) {
  return `${Math.round(conv(kg, unit())).toLocaleString()} ${unit()}`;
}

/** Plate denominations for the plate calculator — always the barbell's own unit. */
export function plateLabel(kg, exId = null) {
  const v = conv(kg, unitFor(exId));
  return trimNum(Math.round(v * 2) / 2);
}
