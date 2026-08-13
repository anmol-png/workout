/**
 * units.js — kg ⇄ lb display conversion.
 *
 * ARCHITECTURE RULE: **everything is stored in kilograms, always.** The unit preference is a
 * display concern and nothing else. Storing whichever unit the user happened to be on would make
 * historical data ambiguous the moment they toggled — you'd have no way to know whether a "110"
 * logged last March meant kg or lb. So conversion happens only at the display and input
 * boundaries, and the stored number never changes meaning.
 */

import { getProfile } from './store.js';

const LB_PER_KG = 2.2046226218;

/** Current display unit. */
export function unit() {
  return getProfile().units === 'lb' ? 'lb' : 'kg';
}

export function isLb() {
  return unit() === 'lb';
}

/** kg (stored) → the number to show the user. */
export function toDisplay(kg) {
  const n = Number(kg);
  if (!Number.isFinite(n)) return n;
  return isLb() ? n * LB_PER_KG : n;
}

/** What the user typed → kg for storage. */
export function toKg(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return n;
  // Round to 3dp so a lb round-trip doesn't accumulate float noise in stored data.
  return isLb() ? Math.round((n / LB_PER_KG) * 1000) / 1000 : n;
}

/** Nearest 0.5 in the display unit — finer than that doesn't exist on a real gym floor. */
function half(n) {
  return Math.round(n * 2) / 2;
}

function trim(n) {
  return Number.isInteger(n) ? String(n) : String(n);
}

/** Bare display number for lifting weights, e.g. "110" — no unit suffix. */
export function num(kg) {
  const v = toDisplay(kg);
  if (!Number.isFinite(v)) return '';
  return trim(half(v));
}

/** Lifting weight with its unit, e.g. "110 lb". */
export function w(kg) {
  return `${num(kg)} ${unit()}`;
}

/** Bodyweight — kept to 0.1 because the 7-day trend depends on that precision. */
export function bw(kg, withUnit = true) {
  const v = toDisplay(kg);
  if (!Number.isFinite(v)) return '';
  const s = (Math.round(v * 10) / 10).toFixed(1);
  return withUnit ? `${s} ${unit()}` : s;
}

/** A rate of change, e.g. "+0.66 lb/week". Signed. */
export function rate(kgPerWeek) {
  const v = toDisplay(kgPerWeek);
  return `${v >= 0 ? '+' : ''}${v.toFixed(2)} ${unit()}/week`;
}

/** Total volume load — big numbers, so no decimals and thousands separators. */
export function volume(kg) {
  return `${Math.round(toDisplay(kg)).toLocaleString()} ${unit()}`;
}

/** Sensible input step for a number field in the current unit. */
export function step() {
  return isLb() ? '1' : '0.5';
}

/** Plate denominations for the plate calculator, in the display unit. */
export function plateLabel(kg) {
  return trim(half(toDisplay(kg)));
}
