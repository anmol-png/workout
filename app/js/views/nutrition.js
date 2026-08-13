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
import * as U from '../units.js';

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

/**
 * Pre-workout timeline for a 5:30pm session. The 4pm meal is the whole point: brunch → training
 * is a ~5 h fasting gap, and that hole is what a stimulant was being used to paper over.
 */
const PRE_TIMELINE = [
  ['12–1pm', 'Brunch + coffee', 'Caffeine goes HERE. ≤200 mg, never after 1pm.'],
  ['4:00pm', '<b>Pre-workout meal</b> + 8 g citrulline', '40–60 g carbs, 20–25 g protein. Low fat, low fibre.'],
  ['5:15pm', 'Optional: banana or 4 dates', 'Only if you feel flat. ~25 g fast carbs.'],
  ['5:30pm', 'Train', 'Water throughout. Sip carbs on Legs + Lower days.'],
  ['7:15pm', 'Dinner', 'Protein + carbs.'],
];

const PRE_MEALS = [
  ['Banana + 4–5 dates + 1 scoop whey', '~55 g C · 25 g P'],
  ['Poha + 150 g curd', '~50 g C · 20 g P'],
  ['White toast + honey + 1 scoop whey', '~45 g C · 26 g P'],
  ['White rice + dal (small katori) + curd', '~50 g C · 16 g P'],
  ['Sweet potato 200 g + whey', '~45 g C · 25 g P'],
];

export function title() { return 'Nutrition'; }
export function subtitle() { return 'Targets, fuelling and the feedback loop'; }

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
        <tr><td>Gaining ${U.isLb() ? '0.45–0.9 lb' : '0.2–0.4 kg'}/wk</td><td>Change nothing</td></tr>
        <tr><td>Flat</td><td>+250 kcal/day</td></tr>
        <tr><td>Gaining &gt; ${U.isLb() ? '1.1 lb' : '0.5 kg'}/wk</td><td>−200 kcal/day</td></tr>
        <tr><td>Losing</td><td>+350 kcal/day</td></tr>
      </table>
    </div>

    <div class="card">
      <div class="chart-title">Training day timeline</div>
      <div class="chart-sub">You train at 5:30pm. Brunch is ~5 h earlier — that gap is why sessions
        feel flat, and it's what a pre-workout was covering up.</div>
      <table class="food-tbl mt">
        ${PRE_TIMELINE.map(([t, what, why]) => `<tr>
          <td style="white-space:nowrap;vertical-align:top;color:var(--muted)">${t}</td>
          <td>${what}<div class="xs muted">${why}</div></td></tr>`).join('')}
      </table>
      <div class="divider"></div>
      <div class="chart-title">Pick one for the 4pm meal</div>
      <table class="food-tbl mt">
        ${PRE_MEALS.map(([f, m]) => `<tr><td>${f}</td><td>${m}</td></tr>`).join('')}
      </table>
      <p class="xs muted mt">White rice and white bread are <b>correct</b> here — this is the one
        meal where fast digestion beats slow. Fat and fibre slow gastric emptying and leave the
        meal sitting in your stomach during squats.</p>
    </div>

    <div class="banner warn">
      <b>Caffeine: 1pm cutoff, ≤200 mg.</b> A 1pm coffee still puts ~113 mg in your blood at 5:30pm
      — a real ergogenic dose — but leaves only ~47 mg at bedtime. The same dose at 5pm leaves
      ~78–104 mg, which is a full coffee's worth as you get into bed. That's what was wrecking
      your sleep, not the training.
      <div class="xs mt" style="opacity:.85">Caffeine doesn't create energy — it blocks the
        receptor telling you you're tired. The fatigue accrues anyway.</div>
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
        <tr><td><b>Citrulline malate</b><div class="xs muted">60 min pre — with the 4pm meal. This is
          your pre-workout replacement: the pump and a rep or two late in a set, no stimulation.
          Effect is real but modest.</div></td><td>8 g</td></tr>
        <tr><td><b>Whey protein</b><div class="xs muted">A convenience food, not a magic one.</div></td><td>as needed</td></tr>
        <tr><td><b>Beta-alanine</b><div class="xs muted">Daily, NOT pre-workout — it loads over weeks.
          Helps 12–20 rep sets, does nothing for a 5-rep squat. Tingling is harmless.</div></td><td>3.2 g</td></tr>
        <tr><td><b>Vitamin D3</b><div class="xs muted">Deficiency is common in India despite the sunshine.</div></td><td>1–2k IU</td></tr>
        <tr><td><b>Caffeine</b><div class="xs muted">With brunch, <b>never after 1pm</b>. Consider using it
          only on Legs and Lower days — daily use builds tolerance in 1–2 weeks.</div></td><td>≤200 mg</td></tr>
      </table>
      <p class="xs muted mt">BCAAs (redundant at 165 g protein), arginine (poorly absorbed — citrulline
        is strictly better), glutamine, test boosters, mass gainers, proprietary blends: skip them.
        Buy single-ingredient powders and control the dose yourself.</p>
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
  const rate = U.rate(trend.ratePerWeek);
  const map = {
    'on-target': ['good', `<b>${rate} — on target.</b> This is exactly the rate you want. Change nothing.`],
    flat: ['warn', `<b>${rate} — you're flat.</b> Add ~250 kcal/day and re-check in two weeks.`],
    losing: ['warn', `<b>${rate} — you're losing weight.</b> Add ~350 kcal/day. You can't build much in a deficit.`],
    fast: ['warn', `<b>${rate} — above the target range.</b> Cut ~200 kcal/day; the excess is mostly fat.`],
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
