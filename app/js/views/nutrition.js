/**
 * views/nutrition.js — the targets from program/06-Nutrition.md, plus the feedback loop that
 * makes the calorie number self-correcting.
 *
 * Deliberately NOT a food diary. Logging every meal is the fastest way to stop using an app, and
 * the program doesn't need it — the bodyweight trend already tells you whether calories are right.
 * What this screen does is show the targets and turn the scale data into an instruction.
 */

import { NUTRITION } from '../program.js';
import { bodyweightTrend } from '../stats.js';

const FOODS = [
  ['Soya chunks (dry)', '50 g', '~26 g'],
  ['Whey protein', '1 scoop (30 g)', '~24 g'],
  ['Chicken breast', '100 g cooked', '~31 g'],
  ['Paneer', '100 g', '~18 g'],
  ['Fish (rohu, surmai)', '100 g', '~20 g'],
  ['Eggs', '2 whole', '~12 g'],
  ['Egg whites', '4', '~14 g'],
  ['Greek yogurt / hung curd', '150 g', '~15 g'],
  ['Milk (full fat)', '250 ml', '~8 g'],
  ['Toor / moong dal', '1 katori', '~9 g'],
  ['Rajma / chana', '1 katori', '~9 g'],
  ['Tofu', '100 g', '~11 g'],
  ['Curd', '150 g', '~5 g'],
  ['Roti', '1 medium', '~3 g'],
  ['Rice', '1 katori', '~3 g'],
];

export function title() { return 'Nutrition'; }
export function subtitle() { return 'Targets and the feedback loop'; }

export function render(root) {
  const trend = bodyweightTrend();

  root.innerHTML = `
    ${adviceBanner(trend)}

    <div class="card">
      <div class="chart-title mb">Daily targets</div>
      ${macro('Calories', NUTRITION.calories, 'kcal', 'Maintenance ≈ 2,700 + a 250 kcal surplus')}
      ${macro('Protein', NUTRITION.protein, 'g', '2.0 g/kg · split across ~4 meals of ~40 g')}
      ${macro('Carbs', NUTRITION.carbs, 'g', 'Fuels five sessions a week')}
      ${macro('Fat', NUTRITION.fat, 'g', '0.9 g/kg · hormonal floor')}
      ${macro('Water', NUTRITION.waterL, 'L', 'Performance drops when mildly dehydrated')}
    </div>

    <div class="card">
      <div class="chart-title">Why a small surplus</div>
      <p class="small muted mt">Muscle gain has a hard speed limit. Eating +250 kcal and +800 kcal build
        muscle at roughly the same rate — the difference is almost entirely fat. A small surplus means
        you can run this for six months without needing a cut afterwards.</p>
      <div class="divider"></div>
      <div class="chart-title">The self-correcting loop</div>
      <p class="small muted mt">Weigh yourself every morning, after the bathroom, before eating.
        Only look at the <b>7-day average</b>. Then, every two weeks:</p>
      <table class="food-tbl mt">
        <tr><td>Gaining 0.2–0.4 kg/wk</td><td>Change nothing</td></tr>
        <tr><td>Flat</td><td>+250 kcal/day</td></tr>
        <tr><td>Gaining &gt; 0.5 kg/wk</td><td>−200 kcal/day</td></tr>
        <tr><td>Losing</td><td>+350 kcal/day</td></tr>
      </table>
    </div>

    <div class="card">
      <div class="chart-title">Hitting ${NUTRITION.protein} g of protein</div>
      <div class="chart-sub">The part that actually fails. A normal Indian diet is carb-dense and
        protein-light by default — this needs planning, not willpower.</div>
      <table class="food-tbl">
        <thead><tr><th>Food</th><th>Serving</th><th style="text-align:right">Protein</th></tr></thead>
        <tbody>${FOODS.map(([f, s, g]) => `<tr><td>${f}</td><td class="muted">${s}</td><td>${g}</td></tr>`).join('')}</tbody>
      </table>
      <p class="xs muted mt">A katori of dal is ~9 g. Reaching 165 g on dal alone would take eighteen.
        Treat pulses as a contribution, not a strategy — soya, whey, eggs, chicken/fish, curd and paneer
        are the strategy. Dal + rice together form a complete amino acid profile.</p>
    </div>

    <div class="card">
      <div class="chart-title">Supplements worth taking</div>
      <table class="food-tbl mt">
        <tr><td><b>Creatine monohydrate</b><div class="xs muted">Any time, every day including rest days.
          Most evidenced legal supplement there is. No loading phase. Monohydrate only.</div></td><td>${NUTRITION.creatineG} g</td></tr>
        <tr><td><b>Whey protein</b><div class="xs muted">A convenience food, not a magic one.</div></td><td>as needed</td></tr>
        <tr><td><b>Vitamin D3</b><div class="xs muted">Deficiency is common in India despite the sunshine.</div></td><td>1–2k IU</td></tr>
        <tr><td><b>Caffeine</b><div class="xs muted">3–6 mg/kg pre-workout. Nothing after 2pm — you can't
          afford worse sleep.</div></td><td>250–450 mg</td></tr>
      </table>
      <p class="xs muted mt">BCAAs, glutamine, test boosters, mass gainers: skip them. Money better spent on food.</p>
    </div>

    <div class="banner accent">
      <b>Sleep is your actual limiting factor.</b> Adding 45 minutes is a bigger lever than any
      supplement, any training tweak, and probably any nutrition adjustment. Everything in this
      program is scaled down to accommodate 6–7 h.
    </div>
  `;
}

function adviceBanner(trend) {
  if (!trend.ready) {
    return `<div class="banner accent">
      <b>Log your morning weight daily.</b> After ~2 weeks the app reads the trend and tells you
      whether to add or cut calories. Until then, eat to the targets below.
    </div>`;
  }
  const rate = `${trend.ratePerWeek >= 0 ? '+' : ''}${trend.ratePerWeek.toFixed(2)} kg/week`;
  const map = {
    'on-target': ['good', `<b>${rate} — on target.</b> This is exactly the rate you want. Change nothing.`],
    flat: ['warn', `<b>${rate} — you're flat.</b> Add ~250 kcal/day and re-check in two weeks.`],
    losing: ['warn', `<b>${rate} — you're losing weight.</b> Add ~350 kcal/day. You can't build much in a deficit.`],
    fast: ['warn', `<b>${rate} — faster than the 0.45 ceiling.</b> Cut ~200 kcal/day; the excess is mostly fat.`],
  };
  const [variant, text] = map[trend.verdict] || ['accent', rate];
  return `<div class="banner ${variant}">${text}
    <div class="xs mt" style="opacity:.8">Based on your 7-day average over the last ${trend.days} days.</div></div>`;
}

function macro(label, value, unit, note) {
  return `<div class="macro">
    <div class="grow">
      <div class="macro-v">${value.toLocaleString()} <span class="muted" style="font-size:13px;font-weight:600">${unit}</span></div>
      <div class="macro-l">${label} — ${note}</div>
    </div>
  </div>`;
}
