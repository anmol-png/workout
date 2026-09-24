/**
 * Logic tests for the workout app. Stubs the browser APIs store.js touches at import time,
 * then exercises the pure modules: progression, plates, stats.
 */

// ---- browser stubs (must exist before importing store.js) ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
globalThis.window = { dispatchEvent: () => {}, addEventListener: () => {} };
globalThis.document = { addEventListener: () => {}, hidden: false };
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
// Node 20 exposes crypto as a getter-only global; randomUUID already exists there.

// Points at a copy of app/js that carries a {"type":"module"} package.json, so Node loads the
// .js files as ES modules. The real app dir stays free of any npm artefact.
const APP = process.env.APP_DIR || '/Users/anmolkhilwani/workout/app/js';
const { computeNextTarget, earnedIncrement, ACTION, isStalled, describePerformance, projectSets: projectSetsFn } = await import(`${APP}/progression.js`);
const { computePlates, nearestLoadable } = await import(`${APP}/plates.js`);
const { getExercise, EXERCISES, DAYS, exercisesForDay } = await import(`${APP}/program.js`);
const statsMod = await import(`${APP}/stats.js`);
const store = await import(`${APP}/store.js`);

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; } else { fail++; console.log(`  ❌ ${name}\n     got  ${JSON.stringify(got)}\n     want ${JSON.stringify(want)}`); }
};
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; } else { fail++; console.log(`  ❌ ${name} ${detail}`); }
};
const near = (name, got, want, tol = 0.05) => ok(name, Math.abs(got - want) < tol, `got ${got}, want ~${want}`);

const section = (s) => console.log(`\n${s}`);

// ============================================================ program integrity
section('Program data');
{
  ok('42 exercises (incl. 2 finishers + optional Arms & Core)', EXERCISES.length === 42, `got ${EXERCISES.length}`);
  const ids = EXERCISES.map((e) => e.id);
  eq('all exercise ids unique', ids.length - new Set(ids).size, 0);
  eq('6 sessions available', DAYS.length, 6);
  eq('5 of them are programmed weekdays', DAYS.filter((d) => d.weekday).length, 5);
  eq('Arms is the optional extra', DAYS.filter((d) => d.optional).map((d) => d.key), ['arms']);

  for (const d of DAYS) {
    const list = exercisesForDay(d.key);
    ok(`${d.key} has exercises`, list.length > 0);
    for (const ex of list) {
      ok(`${ex.id}: repRange lo<=hi`, ex.repRange[0] <= ex.repRange[1]);
      ok(`${ex.id}: rpe lo<=hi`, ex.rpe[0] <= ex.rpe[1]);
      ok(`${ex.id}: has cues`, ex.cues.length > 0);
      ok(`${ex.id}: sets > 0`, ex.sets > 0);
    }
  }

  // ── The week. Legs moved to Monday so the priority session is trained freshest, which then
  // sets everything else. The property that has to survive any reshuffle is SPACING: the two
  // sessions that hit a muscle must never sit closer than 3 days, or the second one runs on the
  // first one's fatigue and the extra frequency buys nothing.
  const weekdayOf = (k) => DAYS.find((d) => d.key === k).weekday;
  eq('Legs is Monday', weekdayOf('legs'), 1);
  eq('Thursday is a rest day', DAYS.some((d) => d.weekday === 4), false);
  eq('Sunday is a rest day', DAYS.some((d) => d.weekday === 0), false);
  for (const [a, b] of [['legs', 'lower'], ['push', 'upper'], ['pull', 'upper']]) {
    const raw = Math.abs(weekdayOf(a) - weekdayOf(b));
    const apart = Math.min(raw, 7 - raw);
    ok(`${a} and ${b} sit >=3 days apart`, apart >= 3, `got ${apart}`);
  }

  // Double progression needs ROOM. With a 2-rep band you must add a rep on every set at once to
  // earn an increment, which on a bad week means the load never moves at all — the lift reads as
  // stalled when the programming, not the athlete, is the constraint.
  for (const ex of EXERCISES) {
    if (ex.isFinisher || ex.repRange[0] === ex.repRange[1]) continue;   // fixed-rep power lifts opt out
    const band = ex.repRange[1] - ex.repRange[0];
    ok(`${ex.id}: rep band >= 3`, band >= 3, `${ex.repRange.join('-')} is a band of ${band}`);
  }

  // The program's central claim: legs get the biggest allocation.
  const planned = statsMod.plannedWeeklyVolume();
  const legs = planned.quads + planned.hamstrings + planned.glutes;
  const upper = planned.chest + planned.back;
  console.log(`  planned/wk → quads ${planned.quads} hams ${planned.hamstrings} glutes ${planned.glutes} `
    + `chest ${planned.chest} back ${planned.back} calves ${planned.calves}`);
  ok('quads in 10-20 band', planned.quads >= 10 && planned.quads <= 20, `got ${planned.quads}`);
  ok('hamstrings in 10-20 band', planned.hamstrings >= 10 && planned.hamstrings <= 20, `got ${planned.hamstrings}`);
  ok('glutes in 10-20 band', planned.glutes >= 10 && planned.glutes <= 20, `got ${planned.glutes}`);
  ok('chest in 10-20 band', planned.chest >= 10 && planned.chest <= 20, `got ${planned.chest}`);
  ok('back in 10-20 band', planned.back >= 10 && planned.back <= 20, `got ${planned.back}`);
  ok('legs allocation exceeds chest+back', legs > upper, `legs ${legs} vs upper ${upper}`);
}

// ============================================================ progression
section('Progression — STRICT double progression');
{
  const squat = getExercise('back-squat'); // 4 × 5–8 @ RPE 7–8, +2.5 kg
  const S = (w, r, rpe) => ({ weight: w, reps: r, rpe });

  // No history → calibration at the start load.
  const t0 = computeNextTarget([], 'back-squat');
  eq('no history → CALIBRATE', t0.action, ACTION.CALIBRATE);
  eq('calibrate weight = startLoad', t0.weight, 45);
  eq('calibrate reps = bottom of range', t0.reps, 5);

  // All 4 sets at the top of the range, RPE within ceiling → add load.
  const perfect = [{ date: '2026-08-01', sets: [S(50, 8, 8), S(50, 8, 8), S(50, 8, 8), S(50, 8, 8)] }];
  ok('STRICT: 8,8,8,8 @RPE8 earns increment', earnedIncrement(perfect[0].sets, squat));
  const t1 = computeNextTarget(perfect, 'back-squat', '2026-08-04');
  eq('→ ADD_LOAD', t1.action, ACTION.ADD_LOAD);
  eq('→ +2.5 kg', t1.weight, 52.5);
  eq('→ restart at bottom of range', t1.reps, 5);

  // One set short → strict says no.
  const nearMiss = [{ date: '2026-08-01', sets: [S(50, 8, 8), S(50, 8, 8), S(50, 8, 8), S(50, 7, 9)] }];
  ok('STRICT: 8,8,8,7 does NOT earn increment', !earnedIncrement(nearMiss[0].sets, squat));
  const t2 = computeNextTarget(nearMiss, 'back-squat', '2026-08-04');
  eq('→ ADD_REPS instead', t2.action, ACTION.ADD_REPS);
  eq('→ same weight', t2.weight, 50);

  // Top reps but ground out at RPE 10 → not earned. This is the RPE guard.
  const grind = [{ date: '2026-08-01', sets: [S(50, 8, 10), S(50, 8, 10), S(50, 8, 10), S(50, 8, 10)] }];
  ok('RPE guard: 8s at RPE 10 does NOT earn increment', !earnedIncrement(grind[0].sets, squat));

  // Missing RPE is tolerated — plenty of sets get logged without one.
  const noRpe = [{ date: '2026-08-01', sets: [S(50, 8, null), S(50, 8, null), S(50, 8, null), S(50, 8, null)] }];
  ok('missing RPE still earns increment', earnedIncrement(noRpe[0].sets, squat));

  // Only 3 of 4 sets logged, all at top → strict requires the full set count.
  const short = [{ date: '2026-08-01', sets: [S(50, 8, 8), S(50, 8, 8), S(50, 8, 8)] }];
  ok('STRICT: only 3 of 4 sets does NOT earn increment', !earnedIncrement(short[0].sets, squat));

  // Below the bottom of the range → repeat.
  const weak = [{ date: '2026-08-01', sets: [S(60, 4, 9), S(60, 4, 9), S(60, 3, 10), S(60, 3, 10)] }];
  eq('below bottom → REPEAT', computeNextTarget(weak, 'back-squat', '2026-08-04').action, ACTION.REPEAT);

  // Stall detection: 3 sessions, no added weight or reps.
  const flat = ['2026-08-01', '2026-08-08', '2026-08-15'].map((date) => ({
    date, sets: [S(50, 6, 9), S(50, 6, 9), S(50, 6, 9), S(50, 6, 9)],
  }));
  ok('3 flat sessions → isStalled', isStalled(flat));
  const t3 = computeNextTarget(flat, 'back-squat', '2026-08-18');
  eq('→ STALL', t3.action, ACTION.STALL);
  eq('→ 10% back-off', t3.weight, 45);

  // Two flat sessions is not yet a stall.
  ok('2 flat sessions is not a stall', !isStalled(flat.slice(0, 2)));

  // Progress breaks the stall.
  const improving = [
    { date: '2026-08-01', sets: [S(50, 6, 8), S(50, 6, 8)] },
    { date: '2026-08-08', sets: [S(50, 7, 8), S(50, 7, 8)] },
    { date: '2026-08-15', sets: [S(50, 8, 8), S(50, 8, 8)] },
  ];
  ok('added reps breaks the stall', !isStalled(improving));

  eq('describePerformance', describePerformance(perfect[0]), '50 kg × 8, 8, 8, 8');

  // Walk a full 4-week block and confirm the documented progression.
  let hist = [];
  const track = [];
  let w = 50, reps = 5;
  for (let week = 1; week <= 5; week++) {
    hist = [...hist, { date: `2026-09-0${week}`, sets: Array(4).fill(S(w, reps, 8)) }];
    const t = computeNextTarget(hist, 'back-squat', `2026-09-0${week}`);
    track.push(`wk${week}: ${w}kg×${reps} → ${t.action} ${t.weight}kg×${t.reps}`);
    w = t.weight; reps = t.reps;
  }
  console.log('  block walk:'); track.forEach((l) => console.log(`    ${l}`));
  eq('after 4 rep-climb weeks the load is 52.5', w, 52.5);
}

// ============================================================ plates
section('Plate calculator');
{
  const P = [25, 20, 15, 10, 5, 2.5, 1.25];
  eq('60 kg on a 20 kg bar', computePlates(60, 20, P).perSide, [20]);
  eq('100 kg', computePlates(100, 20, P).perSide, [25, 15]);
  eq('52.5 kg', computePlates(52.5, 20, P).perSide, [15, 1.25]);
  eq('22.5 kg', computePlates(22.5, 20, P).perSide, [1.25]);
  ok('empty bar flagged barOnly', computePlates(20, 20, P).barOnly);
  ok('20 kg on a 20 kg bar is ok', computePlates(20, 20, P).ok);

  // Float safety: 1.25 kg plates are where naive float math breaks. 62.5 kg needs
  // 21.25/side = 20 + 1.25, which only resolves correctly with an epsilon comparison.
  const r = computePlates(62.5, 20, P);
  ok('62.5 kg is exactly loadable', r.ok, JSON.stringify(r));
  eq('62.5 kg per side', r.perSide, [20, 1.25]);

  // 63.75 kg genuinely cannot be loaded: (63.75-20)/2 = 21.875, and per-side totals can only
  // be multiples of 1.25. The calculator must say so rather than silently rounding.
  const impossible = computePlates(63.75, 20, P);
  ok('63.75 kg is NOT loadable', !impossible.ok);
  eq('63.75 kg → closest below', impossible.achieved, 62.5);

  // Unreachable target reports the closest. 51 kg needs 15.5/side; 15 is as close as it gets.
  const odd = computePlates(51, 20, P);
  ok('51 kg is not exactly loadable', !odd.ok);
  eq('51 kg → closest achieved', odd.achieved, 50);

  // 50 is 1.0 kg away, 52.5 is 1.5 kg away — 50 wins.
  eq('nearestLoadable(51) → 50', nearestLoadable(51, 20, P), 50);
  eq('nearestLoadable(52) → 52.5', nearestLoadable(52, 20, P), 52.5);
  eq('nearestLoadable below bar', nearestLoadable(15, 20, P), 20);
}

// ============================================================ stats
section('Stats — e1RM, PRs, volume');
{
  const { e1RM, isPersonalRecord, weeklyVolume, weekStart, addDays, setVolume } = statsMod;

  near('e1RM 100×1 @RPE10', e1RM(100, 1, 10), 103.33);
  near('e1RM 100×10 no RPE', e1RM(100, 10), 133.33);
  // RPE folds reps-in-reserve into the estimate.
  near('e1RM 50×8 @RPE8 (2 in reserve → treated as 10)', e1RM(50, 8, 8), 66.67);
  near('e1RM 50×8 @RPE10 (0 in reserve)', e1RM(50, 8, 10), 63.33);
  ok('e1RM caps runaway high reps', e1RM(40, 30, 10) === e1RM(40, 12, 10));
  eq('e1RM of a zero set', e1RM(0, 0), 0);

  const squat = getExercise('back-squat');
  const hist = [{ date: '2026-08-01', sets: [{ weight: 50, reps: 6, rpe: 8 }] }];

  // More reps at the same weight is a PR under the e1RM rule.
  const morereps = isPersonalRecord({ weight: 50, reps: 7, rpe: 8 }, hist, squat);
  ok('more reps at same weight → PR', morereps.isPR, JSON.stringify(morereps));
  eq('PR kind', morereps.kind, 'e1rm');

  // 52.5×5 (e1RM 64.75) beats 50×6 (63.33) — more weight for one fewer rep is real progress.
  ok('52.5×5 IS a PR vs 50×6', isPersonalRecord({ weight: 52.5, reps: 5, rpe: 8 }, hist, squat).isPR);
  ok('52.5×6 IS a PR vs 50×6', isPersonalRecord({ weight: 52.5, reps: 6, rpe: 8 }, hist, squat).isPR);

  // …but the same set does NOT beat 50×7 (e1RM 65.00). This is the case that makes e1RM the
  // right rule: it knows a small load jump can be a step backwards if you lose two reps for it.
  const hist7 = [{ date: '2026-08-01', sets: [{ weight: 50, reps: 7, rpe: 8 }] }];
  ok('52.5×5 is NOT a PR vs 50×7', !isPersonalRecord({ weight: 52.5, reps: 5, rpe: 8 }, hist7, squat).isPR);
  ok('no history → not a PR', !isPersonalRecord({ weight: 50, reps: 6, rpe: 8 }, [], squat).isPR);

  eq('setVolume', setVolume({ weight: 50, reps: 8 }), 400);

  // weekStart is Monday-anchored.
  eq('weekStart(Thu 2026-08-13)', weekStart('2026-08-13'), '2026-08-10');
  eq('weekStart(Mon 2026-08-10)', weekStart('2026-08-10'), '2026-08-10');
  eq('weekStart(Sun 2026-08-16)', weekStart('2026-08-16'), '2026-08-10');
  eq('addDays crosses a month', addDays('2026-08-31', 1), '2026-09-01');

  // End-to-end: log a real Legs session and check the volume attribution.
  store.resetAll();
  store.upsertSession({
    id: 'test-legs', date: '2026-08-12', dayKey: 'legs', week: 1, entries: [
      { exerciseId: 'back-squat', sets: Array(4).fill({ weight: 50, reps: 6, rpe: 8, done: true }) },
      { exerciseId: 'rdl', sets: Array(3).fill({ weight: 50, reps: 8, rpe: 8, done: true }) },
      { exerciseId: 'leg-press', sets: Array(3).fill({ weight: 100, reps: 12, rpe: 8, done: true }) },
    ], notes: '',
  });
  const v = weeklyVolume('2026-08-10');
  // squat 4 primary quads + leg press 3 primary quads = 7
  eq('quads = 7 (squat 4 + leg press 3)', v.quads, 7);
  // rdl 3 primary hams; squat 4 secondary hams ×0.5 = 2 → 5
  eq('hamstrings = 5 (rdl 3 + squat secondary 2)', v.hamstrings, 5);
  // squat sec 2 + rdl sec 1.5 + leg press sec 1.5 = 5
  eq('glutes = 5 (all secondary)', v.glutes, 5);
  eq('chest untouched on leg day', v.chest, 0);

  // Sets not marked done must not count.
  store.upsertSession({
    id: 'test-partial', date: '2026-08-13', dayKey: 'push', week: 1, entries: [
      { exerciseId: 'bench-press', sets: [
        { weight: 45, reps: 6, rpe: 8, done: true },
        { weight: 45, reps: 6, rpe: 8, done: false },
      ] },
    ], notes: '',
  });
  // Both sets count: a set with reps was performed, tick or no tick. Only blank rows are skipped.
  eq('unticked sets still count', weeklyVolume('2026-08-10').chest, 2);

  // A session outside the week window must not leak in.
  eq('previous week is empty', weeklyVolume('2026-08-03').quads, 0);
}

// ============================================================ store round-trip
section('Store — persistence and backup');
{
  store.resetAll();
  store.updateProfile({ heightCm: 175, barWeightKg: 20 });
  store.upsertSession({ id: 's1', date: '2026-08-12', dayKey: 'legs', week: 1, notes: 'hi', entries: [
    { exerciseId: 'back-squat', sets: [{ weight: 50, reps: 6, rpe: 8, done: true }] }] });
  store.saveDailyLog('2026-08-12', { bodyweightKg: 82.4, sleepHours: 6.5, readiness: 3 });

  const json = store.exportJSON();
  store.resetAll();
  eq('reset clears sessions', store.getSessions().length, 0);

  store.importJSON(json);
  eq('import restores sessions', store.getSessions().length, 1);
  eq('import restores profile', store.getProfile().heightCm, 175);
  eq('import restores daily log', store.getDailyLog('2026-08-12').bodyweightKg, 82.4);

  let threw = false;
  try { store.importJSON('{"nonsense":true}'); } catch { threw = true; }
  ok('import rejects a non-backup file', threw);
  eq('data survives the rejected import', store.getSessions().length, 1);

  // currentWeek derives from programStart.
  store.updateProfile({ programStart: '2026-08-03' });
  eq('week 2 on 2026-08-13', store.currentWeek('2026-08-13'), 2);
  eq('week 1 on 2026-08-03', store.currentWeek('2026-08-03'), 1);
  eq('week 3 on 2026-08-17', store.currentWeek('2026-08-17'), 3);
}

// ============================================================ autoregulation
section('Autoregulation');
{
  const { shouldAutoregulate, applyAutoregulation, autoregulationPlan } = await import(`${APP}/readiness.js`);

  ok('5 h sleep triggers', shouldAutoregulate({ sleepHours: 5 }).triggered);
  ok('7 h sleep does not', !shouldAutoregulate({ sleepHours: 7 }).triggered);
  ok('readiness 2 triggers', shouldAutoregulate({ sleepHours: 7, readiness: 2 }).triggered);
  ok('readiness 4 does not', !shouldAutoregulate({ sleepHours: 7, readiness: 4 }).triggered);
  ok('no log does not trigger', !shouldAutoregulate(null).triggered);

  eq('plan is STANDARD', autoregulationPlan().label, 'Standard');

  const legs = exercisesForDay('legs');
  const cut = applyAutoregulation(legs);
  ok('finisher dropped', !cut.some((e) => e.isFinisher));
  eq('squat 4 sets → 3', cut.find((e) => e.id === 'back-squat').sets, 3);
  eq('squat RPE 7-8 → 6-7', cut.find((e) => e.id === 'back-squat').rpe, [6, 7]);
  eq('rdl 3 sets → 2', cut.find((e) => e.id === 'rdl').sets, 2);

  const before = legs.filter((e) => !e.isFinisher).reduce((n, e) => n + e.sets, 0);
  const after = cut.reduce((n, e) => n + e.sets, 0);
  console.log(`  legs volume: ${before} sets → ${after} sets (${Math.round((after / before) * 100)}%)`);
  ok('cut keeps 60-80% of volume', after / before > 0.6 && after / before < 0.85);
  ok('nothing falls below 2 sets', cut.every((e) => e.sets >= 2));
}

// ============================================================ units
section('Units — per-exercise kg/lb with realistic snapping');
{
  const U = await import(`${APP}/units.js`);
  const { getExercise } = await import(`${APP}/program.js`);
  store.resetAll();

  const squat = getExercise('back-squat');        // barbell
  const pulldown = getExercise('lat-pulldown');   // machine
  const db = getExercise('db-lateral-raise');     // dumbbell

  // Default: kg, pass-through.
  eq('default unit is kg', U.unit(), 'kg');
  eq('exercise follows the default', U.unitFor('back-squat'), 'kg');
  eq('kg is identity', U.toKg(50, 'back-squat'), 50);
  eq('logged weight formats', U.w(52.5, 'back-squat'), '52.5 kg');

  // ---- THE BUG THAT PROMPTED THIS: raw conversion produces unloadable numbers.
  store.setExerciseUnit('machine-chest-press', 'lb');
  const mcp = getExercise('machine-chest-press');
  near('35 kg raw → 77.2 lb', U.toDisplay(35, 'machine-chest-press'), 77.16, 0.01);
  eq('…but the SUGGESTION snaps to 75 lb', U.snap(35, mcp), 75);
  eq('snapped and formatted', U.snapW(35, mcp), '75 lb');
  ok('every lb suggestion is a multiple of 5',
    [20, 35, 45, 60, 100].every((kg) => U.snap(kg, mcp) % 5 === 0),
    JSON.stringify([20, 35, 45, 60, 100].map((kg) => U.snap(kg, mcp))));

  // Real starting loads must land on selectable numbers.
  store.setExerciseUnit('lat-pulldown', 'lb');
  eq('45 kg pulldown → 100 lb', U.snap(45, pulldown), 100);
  store.setExerciseUnit('db-lateral-raise', 'lb');
  eq('6 kg dumbbell → 15 lb', U.snap(6, db), 15);
  store.setExerciseUnit('back-squat', 'lb');
  eq('45 kg squat → 100 lb', U.snap(45, squat), 100);
  eq('lb barbell suggestions step by 5', U.snap(52.5, squat), 115);

  // kg suggestions snap to kg increments.
  store.setExerciseUnit('back-squat', 'kg');
  eq('kg barbell snaps to 2.5', U.snap(51, squat), 50);
  eq('kg barbell snaps up', U.snap(51.9, squat), 52.5);
  store.setExerciseUnit('db-lateral-raise', 'kg');
  eq('kg dumbbell snaps to 2', U.snap(7, db), 8);

  // A positive suggestion must never snap away to zero.
  store.setExerciseUnit('db-lateral-raise', 'lb');
  ok('tiny suggestion snaps up, not to 0', U.snap(0.4, db) > 0, String(U.snap(0.4, db)));

  // ---- MIXED GYM: exercises are independent of each other.
  store.setExerciseUnit('back-squat', 'kg');
  store.setExerciseUnit('lat-pulldown', 'lb');
  eq('squat stays kg', U.unitFor('back-squat'), 'kg');
  eq('pulldown is lb', U.unitFor('lat-pulldown'), 'lb');
  eq('squat formats in kg', U.w(50, 'back-squat'), '50 kg');
  eq('pulldown formats in lb', U.w(45, 'lat-pulldown'), '99 lb');

  // Clearing an override falls back to the global default.
  store.setExerciseUnit('lat-pulldown', null);
  eq('cleared override follows default', U.unitFor('lat-pulldown'), 'kg');
  store.updateProfile({ units: 'lb' });
  eq('…and tracks the default when it changes', U.unitFor('lat-pulldown'), 'lb');
  eq('an override still wins over the default', U.unitFor('back-squat'), 'kg');
  store.updateProfile({ units: 'kg' });

  // ---- ROUND-TRIP: what protects logged history from any unit change.
  store.setExerciseUnit('back-squat', 'lb');
  near('225 lb typed → 102.06 kg', U.toKg(225, 'back-squat'), 102.058, 0.01);
  for (const kg of [20, 45, 52.5, 60, 100, 142.5]) {
    const back = U.toKg(U.toDisplay(kg, 'back-squat'), 'back-squat');
    ok(`round-trip ${kg} kg survives`, Math.abs(back - kg) < 0.002, `got ${back}`);
  }

  // ---- INCREMENTS follow the equipment's own unit.
  near('lb barbell increment is 5 lb', U.incrementKg(squat), 2.268, 0.01);
  store.setExerciseUnit('back-squat', 'kg');
  eq('kg barbell increment is 2.5 kg', U.incrementKg(squat), 2.5);

  // ---- progression hints use the exercise's unit and increment.
  const { setWeightFormatter, setIncrementResolver, computeNextTarget } = await import(`${APP}/progression.js`);
  setWeightFormatter((kg, ex) => U.w(kg, ex?.id));
  setIncrementResolver((ex) => U.incrementKg(ex));
  const perfect = [{ date: '2026-08-01', sets: Array(4).fill({ weight: 50, reps: 8, rpe: 8 }) }];

  eq('kg lift suggests +2.5 kg', computeNextTarget(perfect, 'back-squat', '2026-08-04').note.includes('2.5 kg'), true);
  store.setExerciseUnit('back-squat', 'lb');
  const lbNote = computeNextTarget(perfect, 'back-squat', '2026-08-04').note;
  ok('lb lift suggests a lb jump', lbNote.includes('lb'), lbNote);
  ok('lb lift never says kg', !lbNote.includes(' kg'), lbNote);
  const lbTarget = computeNextTarget(perfect, 'back-squat', '2026-08-04');
  eq('and the snapped target is loadable in lb', U.snap(lbTarget.weight, squat) % 5, 0);

  // Bodyweight lifts still read as BW.
  const { describePerformance } = await import(`${APP}/progression.js`);
  const dip = getExercise('weighted-dip');
  const bwPerf = { sets: [{ weight: 0, reps: 8 }, { weight: 0, reps: 8 }] };
  eq('0 added weight shows as BW', describePerformance(bwPerf, dip), 'BW × 8, 8');
  const loaded = { sets: [{ weight: 5, reps: 6 }, { weight: 5, reps: 6 }] };
  ok('added weight shows as BW+', describePerformance(loaded, dip).startsWith('BW+'),
    describePerformance(loaded, dip));

  // Global-unit helpers stay on the default, not any exercise override.
  store.updateProfile({ units: 'kg' });
  eq('bodyweight uses the default unit', U.bw(82.44), '82.4 kg');
  eq('rate uses the default unit', U.rate(0.3), '+0.30 kg/week');

  setWeightFormatter((kg) => `${Number.isInteger(kg) ? kg : Number(kg).toFixed(1)} kg`);
  setIncrementResolver((ex) => ex.increment);
  store.resetAll();
}

// ============================================================ warm-up
section('Warm-up — ramp sets');
{
  const { rampSets, needsRamp, WARMUP } = await import(`${APP}/warmup.js`);
  const { getExercise, exercisesForDay, DAYS } = await import(`${APP}/program.js`);

  for (const d of DAYS) {
    ok(`${d.key} has a general warm-up`, (WARMUP[d.key] || []).length >= 3);
  }

  // An optional session must not inflate the program's prescribed baseline.
  const planned = statsMod.plannedWeeklyVolume();
  ok('optional Arms excluded from planned volume', planned.chest === 13, `chest ${planned.chest}`);
  ok('…biceps too', planned.biceps === 15, `biceps ${planned.biceps}`);

  const squat = getExercise('back-squat');
  // Ramp count scales with how far there is to climb — a light bar needs fewer steps.
  eq('40 kg squat → 2 ramp sets', rampSets(squat, 40, 20).length, 2);
  eq('100 kg squat → 4 ramp sets', rampSets(squat, 100, 20).length, 4);
  eq('first ramp is the empty bar', rampSets(squat, 100, 20)[0].weight, 20);

  const ramps = rampSets(squat, 100, 20);
  ok('ramps ascend', ramps.every((r, i) => i === 0 || r.weight > ramps[i - 1].weight));
  ok('no ramp reaches the working weight', ramps.every((r) => r.weight < 100));
  ok('ramp reps descend as weight climbs', ramps[1].reps > ramps[ramps.length - 1].reps);

  // Bodyweight lifts rehearse rather than load.
  eq('bodyweight lift gets an unloaded rehearsal', rampSets(getExercise('weighted-dip'), 0, 20)[0].weight, null);

  // Only the opening lifts get ramped; accessories are already warm.
  const upper = exercisesForDay('upper');
  eq('Upper ramps exactly 2 exercises', upper.filter((e, i) => needsRamp(e, i, upper)).length, 2);
  ok('…and the 2nd is the first LOADED lift after the bodyweight opener',
    needsRamp(upper[1], 1, upper) && upper[0].unit === 'bodyweight');
  const push = exercisesForDay('push');
  ok('a late accessory never gets a ramp', !needsRamp(push[4], 4, push));
}

// ============================================================ substitutions
section('Substitutions — swapping changes the equipment, not just the name');
{
  const { resolveExercise, getExercise } = await import(`${APP}/program.js`);
  const { computeNextTarget, ACTION } = await import(`${APP}/progression.js`);

  const dip = getExercise('weighted-dip');
  eq('dip is bodyweight', dip.unit, 'bodyweight');
  eq('dip starts at 0 added', dip.startLoad, 0);

  // THE BUG: swapping to a barbell lift used to keep unit:'bodyweight', so the slot still
  // showed "BW" and offered no starting weight.
  const swapped = resolveExercise(dip, 'Incline Barbell Press');
  eq('swapped name', swapped.name, 'Incline Barbell Press');
  eq('swapped unit becomes barbell', swapped.unit, 'barbell');
  eq('swapped gets a real starting weight', swapped.startLoad, 35);
  eq('swapped gets the barbell increment', swapped.increment, 2.5);
  eq('id is preserved so history stays attached', swapped.id, dip.id);

  // …and the progression engine now sees the substitute's equipment.
  const t = computeNextTarget([], swapped);
  eq('calibration uses the substitute start load', t.weight, 35);
  eq('and is a normal calibration, not a bodyweight one', t.action, ACTION.CALIBRATE);
  ok('hint no longer says "leave the weight blank"', !t.note.includes('blank'), t.note);
  const bwT = computeNextTarget([], dip);
  ok('un-swapped dip still says bodyweight', bwT.note.includes('Bodyweight'), bwT.note);

  // Bodyweight in the other direction.
  const pullup = getExercise('pull-up');
  const pulldown = resolveExercise(pullup, 'Lat Pulldown');
  eq('pull-up → pulldown becomes a machine', pulldown.unit, 'machine');
  eq('…with a usable starting load', pulldown.startLoad, 45);

  const legcurl = getExercise('seated-leg-curl');
  const nordic = resolveExercise(legcurl, 'Nordic Curl');
  eq('machine → bodyweight swap', nordic.unit, 'bodyweight');
  eq('…starts at 0 added', nordic.startLoad, 0);

  // Like-for-like swaps inherit the parent's equipment.
  const lying = resolveExercise(legcurl, 'Lying Leg Curl');
  eq('like-for-like keeps the unit', lying.unit, legcurl.unit);
  eq('like-for-like keeps the start load', lying.startLoad, legcurl.startLoad);

  // No substitution is a no-op.
  eq('null substitution returns the original', resolveExercise(dip, null), dip);
  eq('same-name substitution returns the original', resolveExercise(dip, dip.name), dip);

  // Every listed substitute across the whole program must resolve to valid equipment.
  const VALID = ['barbell', 'dumbbell', 'machine', 'bodyweight', 'none'];
  let checked = 0;
  for (const ex of EXERCISES) {
    for (const name of ex.substitutes || []) {
      const r = resolveExercise(ex, name);
      ok(`${name}: valid unit`, VALID.includes(r.unit), r.unit);
      ok(`${name}: has an increment`, typeof r.increment === 'number');
      // A loadable substitute must offer a starting weight, or the slot renders blank.
      if (r.unit !== 'bodyweight' && r.unit !== 'none') {
        ok(`${name}: has a start load`, r.startLoad === null || typeof r.startLoad === 'number');
      }
      checked += 1;
    }
  }
  console.log(`  ${checked} substitutes across ${EXERCISES.length} exercises all resolve`);
}

// ============================================================ session integrity
section('Sessions — set counting and duplicate repair');
{
  store.resetAll();
  const S = statsMod;

  // A set counts when it has REPS. The tick only starts the rest timer; gating on it silently
  // discarded 16 of 19 real sets in the field.
  store.upsertSession({ id: 'x', date: '2026-08-13', dayKey: 'upper', week: 1, notes: '', entries: [
    { exerciseId: 'lat-pulldown', sets: [
      { weight: 25, reps: 12, rpe: null, done: true },
      { weight: 30, reps: 8, rpe: null, done: false },
      { weight: 25, reps: 8, rpe: null, done: false },
      { weight: null, reps: null, rpe: null, done: false },
    ] },
  ] });
  eq('unticked sets still count', S.sessionSetCount(store.getSession('x')), 3);
  eq('blank rows do not count', S.weeklySetCounts(S.weekStart('2026-08-13')).total, 3);
  eq('volume includes unticked sets', Math.round(S.sessionVolume(store.getSession('x'))), 25 * 12 + 30 * 8 + 25 * 8);
  eq('history includes unticked sets', store.historyFor('lat-pulldown')[0].sets.length, 3);

  // Duplicate repair: one workout split across records, some filed under the wrong day.
  store.resetAll();
  const many = (id, n) => ({ exerciseId: id, sets: Array.from({ length: n }, () => ({ weight: 30, reps: 10, rpe: null, done: false })) });
  store.importJSON(JSON.stringify({
    schemaVersion: 1, profile: {}, dailyLogs: {}, substitutions: {}, exerciseUnits: {}, meta: {},
    sessions: [
      { id: 'a', date: '2026-08-13', dayKey: 'push', week: 1, notes: 'the real one', entries: [
        many('lat-pulldown', 3), many('weighted-dip', 3), many('ez-bar-curl', 2)] },
      { id: 'b', date: '2026-08-13', dayKey: 'upper', week: 1, notes: '', entries: [
        { exerciseId: 'lat-pulldown', sets: [{ weight: null, reps: null, done: false }] }] },
      { id: 'c', date: '2026-08-13', dayKey: 'push', week: 1, notes: '', entries: [many('lat-pulldown', 3)] },
      { id: 'd', date: '2026-08-14', dayKey: 'legs', week: 1, notes: '', entries: [many('back-squat', 4)] },
    ],
  }));

  const sessions = store.getSessions();
  eq('4 records collapse to 2 real workouts', sessions.length, 2);
  const aug13 = sessions.find((x) => x.date === '2026-08-13');
  eq('dayKey inferred from contents, not the label', aug13.dayKey, 'upper');
  eq('deterministic id', aug13.id, '2026-08-13:upper');
  eq('all 8 sets survive the merge', S.sessionSetCount(aug13), 8);
  eq('richest copy of each exercise kept', aug13.entries.length, 3);
  eq('notes preserved', aug13.notes, 'the real one');
  eq('a different day is left alone', sessions.find((x) => x.date === '2026-08-14').dayKey, 'legs');

  const once = store.exportJSON();
  store.importJSON(once);
  eq('migration is idempotent', store.getSessions().length, 2);

  store.resetAll();
}

// ============================================================ per-set projection
section('Per-set projection — reps fall as fatigue builds');
{
  const { projectSets, describeProjection } = await import(`${APP}/progression.js`);

  const squat = getExercise('back-squat');       // 4×5–8, 180 s rest
  const lateral = getExercise('db-lateral-raise'); // 3×12–20, 15 s (superset)

  // No history: modelled from rest period, distributed around the middle of the range.
  const p1 = projectSets([], squat, computeNextTarget([], squat));
  eq('one entry per working set', p1.length, squat.sets);
  ok('reps never ascend', p1.every((x, i) => i === 0 || x.reps <= p1[i - 1].reps), describeProjection(p1));
  ok('stays inside the rep range', p1.every((x) => x.reps >= 5 && x.reps <= 8), describeProjection(p1));
  ok('not the same number repeated', new Set(p1.map((x) => x.reps)).size > 1, describeProjection(p1));
  eq('weight is constant across sets', new Set(p1.map((x) => x.weight)).size, 1);

  // Short rest should decay harder than long rest.
  const pl = projectSets([], lateral, computeNextTarget([], lateral));
  const spread = (a) => a[0].reps - a[a.length - 1].reps;
  ok('20 s rest drops off more than 180 s', spread(pl) > spread(p1), `${describeProjection(pl)} vs ${describeProjection(p1)}`);

  // With history it learns the athlete's OWN curve.
  const hist = [
    { sets: [{ weight: 9, reps: 15 }, { weight: 9, reps: 12 }, { weight: 9, reps: 12 }] },
    { sets: [{ weight: 9, reps: 15 }, { weight: 9, reps: 12 }, { weight: 9, reps: 12 }] },
  ];
  const p2 = projectSets(hist, lateral, computeNextTarget(hist, lateral));
  eq('flagged as learned, not modelled', p2[0].note, 'from your history');
  ok('mirrors his 15/12/12 shape', p2[1].reps === p2[2].reps && p2[0].reps > p2[1].reps, describeProjection(p2));

  // Ascending reps mean the weight was too light — never project upward from that.
  const rising = [
    { sets: [{ weight: 30, reps: 10 }, { weight: 30, reps: 12 }, { weight: 30, reps: 14 }] },
    { sets: [{ weight: 30, reps: 10 }, { weight: 30, reps: 12 }, { weight: 30, reps: 14 }] },
  ];
  const p3 = projectSets(rising, lateral, computeNextTarget(rising, lateral));
  ok('ascending history never projects upward', p3.every((x, i) => i === 0 || x.reps <= p3[i - 1].reps), describeProjection(p3));

  // Sessions where the weight changed say nothing about fatigue and must be ignored.
  const mixed = [
    { sets: [{ weight: 25, reps: 12 }, { weight: 30, reps: 8 }, { weight: 25, reps: 8 }] },
    { sets: [{ weight: 25, reps: 12 }, { weight: 30, reps: 8 }, { weight: 25, reps: 8 }] },
  ];
  eq('varying-weight history is not used as a curve', projectSets(mixed, lateral, computeNextTarget(mixed, lateral))[0].note, 'estimated');

  eq('describeProjection formats', describeProjection([{ reps: 8 }, { reps: 7 }, { reps: 6 }]), '8 / 7 / 6');

  // A progression target is a FLOOR ("get 5 on every set"), so pinning the curve's AVERAGE there
  // pushed half the sets below the rep range, where they clamped to `lo` and came out identical.
  // This is the common case — every lift sits at the bottom of its range after a load increase.
  const atFloor = projectSets([], squat, { action: 'repeat', weight: 60, reps: 5 });
  ok('a bottom-of-range target still varies per set',
    new Set(atFloor.map((x) => x.reps)).size > 1, describeProjection(atFloor));
  ok('no set is projected below the target floor',
    atFloor.every((x) => x.reps >= 5), describeProjection(atFloor));
}

// ============================================================ ramping
section('Ramp sets are not working sets');
{
  const bench = getExercise('bench-press');   // 4×5–8 @ RPE 7–8

  // A real logged session: ramped 55 → 60, then two working sets at 70.
  const ramped = [{ sets: [
    { weight: 55, reps: 8, rpe: 8 }, { weight: 60, reps: 8, rpe: 8 },
    { weight: 70, reps: 6, rpe: 8 }, { weight: 70, reps: 6, rpe: 10 },
  ] }];
  const t = computeNextTarget(ramped, bench);

  eq('working load is the modal weight, not the lightest', t.weight, 70);
  // The old bug: 8 reps at 55 kg became the number to beat at 70 kg, demanding a 2-rep jump.
  eq('target builds on the WORST working set, not the best', t.reps, 7);
  ok('says which sets were treated as warm-ups', /2 of 4 sets/.test(t.note), t.note);

  // A failed jump that was abandoned must not become the prescribed load.
  const bailed = [{ sets: [
    { weight: 27.2, reps: 11, rpe: 8 }, { weight: 31.8, reps: 10, rpe: 10 }, { weight: 27.2, reps: 10, rpe: 10 },
  ] }];
  eq('a bailed-out jump is not prescribed', computeNextTarget(bailed, getExercise('incline-db-press')).weight, 27.2);

  // An increment must be earned on full working sets — 2 of 4 can never qualify.
  const twoGood = [{ sets: [
    { weight: 50, reps: 6, rpe: 7 }, { weight: 60, reps: 6, rpe: 7 },
    { weight: 70, reps: 8, rpe: 7 }, { weight: 70, reps: 8, rpe: 7 },
  ] }];
  eq('2 of 4 top-range sets does not earn the load', computeNextTarget(twoGood, bench).action, 'addReps');

  // …but four flat sets at the top of the range still do.
  const fourGood = [{ sets: Array.from({ length: 4 }, () => ({ weight: 70, reps: 8, rpe: 7 })) }];
  eq('four flat top-range sets earn the load', computeNextTarget(fourGood, bench).action, 'addLoad');
}

// ============================================================ layoff
section('Coming back after time off');
{
  const squat = getExercise('back-squat');           // 4×5–8
  // Left off having EARNED an increment — four clean sets at the top of the range.
  const earned = [{ date: '2026-08-03', sets: Array.from({ length: 4 }, () => ({ weight: 60, reps: 8, rpe: 7 })) }];

  eq('same week, the increment is taken', computeNextTarget(earned, squat, '2026-08-06').action, ACTION.ADD_LOAD);
  eq('13 days is not a layoff', computeNextTarget(earned, squat, '2026-08-16').action, ACTION.ADD_LOAD);

  // The whole point: an earned increment must NOT be collected cold two weeks later.
  const back = computeNextTarget(earned, squat, '2026-08-17');
  eq('14 days triggers the return protocol', back.action, ACTION.RETURN);
  eq('10% off the last working load', back.weight, 54);
  eq('back to the bottom of the range', back.reps, 5);
  eq('reports the gap', back.layoffDays, 14);
  ok('names the layoff in the note', /2 weeks/.test(back.note), back.note);

  // Past a month, deeper cut and reframed as recalibration.
  const long = computeNextTarget(earned, squat, '2026-09-05');
  eq('33 days cuts 20%', long.weight, 48);
  ok('reads as recalibration', /recalibration/.test(long.note), long.note);

  // The projection still has to vary — a RETURN target sits at the bottom of the range, which is
  // exactly the case that used to collapse to a flat line.
  const proj = projectSetsFn([], squat, back);
  ok('return projection still varies per set', new Set(proj.map((x) => x.reps)).size > 1,
    proj.map((x) => x.reps).join('/'));
  ok('never below the backed-off floor', proj.every((x) => x.reps >= 5));
}

// ============================================================ swap, end to end
section('Swap — everything that must change, and everything that must not');
{
  const { resolveExercise, isTimed } = await import(`${APP}/program.js`);
  const U = await import(`${APP}/units.js`);
  store.resetAll();

  const bench = getExercise('bench-press');          // barbell, 50 kg start, +2.5

  // 1. EQUIPMENT changes, not just the label. This was the original bug: the name changed and
  //    the weights stayed on barbell increments.
  const db = resolveExercise(bench, 'Dumbbell Bench Press');
  eq('name changes', db.name, 'Dumbbell Bench Press');
  eq('unit follows the new equipment', db.unit, 'dumbbell');
  eq('start load follows too', db.startLoad, 18);
  ok('increment follows the equipment', db.increment !== bench.increment, `${db.increment} vs ${bench.increment}`);
  eq('the slot id is preserved so history stays attached', db.id, bench.id);

  // 2. Programming that belongs to the SLOT must survive the swap.
  eq('sets are unchanged', db.sets, bench.sets);
  eq('rep range unchanged for a like-for-like swap', db.repRange, bench.repRange);
  eq('rpe unchanged', db.rpe, bench.rpe);
  eq('muscles unchanged', db.muscles, bench.muscles);

  // 3. A swap that changes the UNIT OF WORK may override the range (ab wheel → plank).
  const plank = resolveExercise(getExercise('arms-ab-wheel'), 'Plank');
  ok('a timed substitute overrides the range', isTimed(plank) && plank.repRange[1] === 60);

  // 4. HISTORY separates, so a barbell load is never carried onto a dumbbell.
  store.upsertSession({ id: 'w1', date: '2026-09-01', dayKey: 'push', week: 1, notes: '', entries: [
    { exerciseId: 'bench-press', performedAs: 'Barbell Bench Press',
      sets: Array.from({ length: 4 }, () => ({ weight: 70, reps: 8, rpe: 7 })) }] });
  store.upsertSession({ id: 'w2', date: '2026-09-08', dayKey: 'push', week: 2, notes: '', entries: [
    { exerciseId: 'bench-press', performedAs: 'Dumbbell Bench Press',
      sets: Array.from({ length: 4 }, () => ({ weight: 25, reps: 8, rpe: 7 })) }] });

  const barbellTarget = computeNextTarget(store.historyFor('bench-press', 'Barbell Bench Press'), bench, '2026-09-10');
  const dbTarget = computeNextTarget(store.historyFor('bench-press', 'Dumbbell Bench Press'), db, '2026-09-10');
  ok('barbell target builds on 70 kg', barbellTarget.weight > 70 && barbellTarget.weight < 75, `${barbellTarget.weight}`);
  ok('dumbbell target builds on 25 kg, not 70', dbTarget.weight > 25 && dbTarget.weight < 30, `${dbTarget.weight}`);

  // 5. PERSONAL BESTS follow the variant in the slot rather than blending the two.
  store.setSubstitution('bench-press', 'Dumbbell Bench Press');
  const pb = statsMod.personalBests().find((b) => b.id === 'bench-press');
  eq('the best set is the dumbbell one', pb.set.weight, 25);
  store.setSubstitution('bench-press', null);
  eq('…and the barbell one once swapped back', statsMod.personalBests().find((b) => b.id === 'bench-press').set.weight, 70);

  // 6. The per-exercise UNIT override belongs to the slot and must survive a swap.
  store.setExerciseUnit('bench-press', 'lb');
  eq('unit override persists across the swap', U.unitFor('bench-press'), 'lb');
  store.setExerciseUnit('bench-press', null);

  // 7. Swapping back to the programmed exercise restores it exactly.
  eq('swapping back restores the original', resolveExercise(bench, null).name, 'Barbell Bench Press');
  ok('and is not marked substituted', !resolveExercise(bench, null)._substituted);

  // 8. EVERY substitute in the whole program resolves to usable equipment.
  let checked = 0;
  for (const ex of EXERCISES) {
    for (const name of ex.substitutes || []) {
      const r = resolveExercise(ex, name);
      checked += 1;
      ok(`${ex.id} → ${name} keeps its sets`, r.sets === ex.sets);
      ok(`${ex.id} → ${name} has a valid rep range`, r.repRange[0] <= r.repRange[1] && r.repRange[0] > 0);
      ok(`${ex.id} → ${name} is marked substituted`, r._substituted === true);
    }
  }
  ok(`all ${checked} substitutes resolve cleanly`, checked > 100, `only ${checked}`);
  store.resetAll();
}

// ============================================================ mixed units
section('Mixed kg/lb gym — per-set units');
{
  const U = await import(`${APP}/units.js`);
  store.resetAll();
  store.updateProfile({ units: 'kg' });
  store.setExerciseUnit('incline-db-press', 'lb');

  eq('the exercise is in lb', U.unitFor('incline-db-press'), 'lb');
  eq('a set with no unit follows the exercise', U.unitForSet({}, 'incline-db-press'), 'lb');
  eq('a set can override it', U.unitForSet({ unit: 'kg' }, 'incline-db-press'), 'kg');

  // THE case: the 30 lb pair was in use, so set three was done with 14 kg dumbbells.
  // Typing 14 must store 14 kg, not 14 lb converted to 6.35 kg.
  eq('typing in the overridden unit stores kilograms', U.toKg(14, 'incline-db-press', 'kg'), 14);
  eq('…and without the override it converts', U.toKg(30, 'incline-db-press', null), 13.608);

  // It must read back in the unit it was PERFORMED in, or the number is meaningless later.
  eq('reads back as 14 kg', U.num(14, 'incline-db-press', 'kg'), '14');
  eq('and an lb set reads back in lb', U.num(13.608, 'incline-db-press', null), '30');

  // Both are stored in kg, so they stay directly comparable.
  ok('the kg set is genuinely heavier', 14 > 13.608);
  store.setExerciseUnit('incline-db-press', null);
  store.resetAll();
}

// ============================================================ single arm
section('Single-arm work is a property of the gym, not the movement');
{
  const { prescription } = await import(`${APP}/program.js`);
  store.resetAll();

  ok('off by default', !store.getExerciseConfig('chest-supported-row')?.singleArm);
  store.setExerciseConfig('chest-supported-row', { singleArm: true });
  ok('settable per exercise', store.getExerciseConfig('chest-supported-row').singleArm === true);
  ok('and scoped to that exercise', !store.getExerciseConfig('lat-pulldown')?.singleArm);

  // It coexists with the labelling note rather than replacing it.
  store.setExerciseConfig('chest-supported-row', { reading: 'single side' });
  const cfg = store.getExerciseConfig('chest-supported-row');
  ok('both settings survive together', cfg.singleArm === true && cfg.reading === 'single side');

  store.setExerciseConfig('chest-supported-row', { singleArm: null });
  ok('can be turned off', !store.getExerciseConfig('chest-supported-row').singleArm);

  // "/side" on an upper-body lift, "/leg" on a leg one — the old code said "/leg" for everything.
  const row = { ...getExercise('chest-supported-row'), perSide: true };
  ok('upper body reads /side', /\/side/.test(prescription(row)), prescription(row));
  ok('legs still read /leg', /\/leg/.test(prescription(getExercise('bulgarian-split-squat'))));
  store.resetAll();
}

// ============================================================ the bar
section('The bar and the plates this gym actually has');
{
  const LB = 2.2046226218;
  const plates = [45, 35, 25, 10, 5, 2.5].map((x) => x / LB);
  const bar = 40 / LB;

  // Every barbell load in the real six-week log must decompose into plates that exist.
  for (const [total, expect] of [[130, [45]], [150, [45, 10]], [200, [45, 35]], [225, [45, 45, 2.5]]]) {
    const r = computePlates(total / LB, bar, plates);
    eq(`${total} lb loads as ${expect.join('+')} a side`,
      r.perSide.map((x) => Math.round(x * LB * 10) / 10), expect);
    ok(`${total} lb leaves nothing over`, r.remainder < 0.02, `short ${r.remainder}`);
  }

  // The rounding bug this replaced: a 10 lb plate written as 4.54 kg is very slightly HEAVIER
  // than the 4.5359 kg actually remaining, so the greedy fill skips it and closes the gap with a
  // fistful of small plates instead. It still adds up — it is just a loading no one would use.
  const rounded = [20.41, 15.88, 11.34, 4.54, 2.27, 1.13];
  const sloppy = computePlates(150 / LB, bar, rounded);
  const clean = computePlates(150 / LB, bar, plates);
  ok('rounded values need more plates for the same weight',
    sloppy.perSide.length > clean.perSide.length, `${sloppy.perSide.length} vs ${clean.perSide.length}`);
  eq('full precision gives the loading you would actually use',
    clean.perSide.map((x) => Math.round(x * LB)), [45, 10]);

  // Mixing denominations is worse still: a 25 kg plate (55.1 lb) tops the list, gets grabbed
  // first, and leaves a remainder no lb plate can close.
  const mixed = [...plates, 25, 20, 15, 10, 5, 2.5, 1.25].sort((a, b) => b - a);
  ok('a mixed kg/lb rack cannot close 225 lb', computePlates(225 / LB, bar, mixed).remainder > 0.05);
  ok('the lb rack alone closes it', computePlates(225 / LB, bar, plates).remainder < 0.02);
}

// ============================================================ drop sets
section('Drop sets — finishing the work without lying about the load');
{
  const squat = getExercise('back-squat');   // 4×5–8 @ RPE 7–8
  const S = (w, r, rpe, extra = {}) => ({ weight: w, reps: r, rpe, ...extra });

  // The session this exists for: the target was 8 at 70, four sets got 8/8/8/5, and the last set
  // was finished at 55 kg. Logging 8 across the board would earn an increment on a set that was
  // never completed at 70.
  const withDrop = [{ date: '2026-09-20', sets: [
    S(70, 8, 8), S(70, 8, 8), S(70, 8, 8), S(70, 5, 10), S(55, 3, 9, { isDrop: true })] }];

  const t = computeNextTarget(withDrop, squat, '2026-09-22');
  ok('the drop does NOT earn the increment', t.action !== ACTION.ADD_LOAD, t.action);
  eq('the load stays where it was', t.weight, 70);

  // Remove the failure and it should bank — proving the drop is what held it back, not the shape.
  const clean = [{ date: '2026-09-20', sets: [S(70, 8, 8), S(70, 8, 8), S(70, 8, 8), S(70, 8, 8)] }];
  eq('a genuinely complete session still banks it', computeNextTarget(clean, squat, '2026-09-22').action, ACTION.ADD_LOAD);

  // A drop must not drag the working load down either — 55 kg is not the new working weight.
  const dropHeavy = [{ date: '2026-09-20', sets: [
    S(70, 5, 9), S(70, 5, 9), S(55, 6, 9, { isDrop: true }), S(55, 5, 9, { isDrop: true })] }];
  eq('working load ignores the dropped weight', computeNextTarget(dropHeavy, squat, '2026-09-22').weight, 70);

  // Counting: one set finished with a drop is ONE hard set, and the drop is never a record.
  const session = { id: 'd1', date: '2026-09-20', dayKey: 'legs', week: 1, notes: '', entries: [
    { exerciseId: 'back-squat', sets: [S(70, 8, 8), S(70, 5, 10), S(55, 4, 9, { isDrop: true })] }] };
  store.resetAll();
  store.upsertSession(session);
  eq('a drop is not an extra hard set', statsMod.sessionSetCount(session), 2);
  ok('but the work still counts as volume', statsMod.sessionVolume(session) > 70 * 13);
  eq('a drop can never be a personal best', statsMod.scoreSet(S(55, 20, 9, { isDrop: true }), squat), 0);
  store.resetAll();
}

// ============================================================ timed holds
section('Timed holds — a plank is seconds, not reps');
{
  const { resolveExercise, prescription, isTimed, formatReps } = await import(`${APP}/program.js`);
  const wheel = getExercise('arms-ab-wheel');

  ok('the programmed exercise is rep-based', !isTimed(wheel));
  const plank = resolveExercise(wheel, 'Plank');
  ok('the substitute is timed', isTimed(plank));

  // THE bug: a substitute inherited the parent's rep range, so a plank asked for "8-12 reps".
  eq('the substitute overrides the range', plank.repRange, [30, 60]);
  ok('prescription reads in seconds', /30–60 s/.test(prescription(plank)), prescription(plank));
  ok('the rep-based one does NOT', !/ s/.test(prescription(wheel)), prescription(wheel));
  eq('formatReps follows the metric', formatReps(45, plank), '45 s');
  eq('…and stays reps otherwise', formatReps(10, wheel), '10 reps');

  // Progression wording must follow too, or a timed hold is told to "get 45 reps".
  const hist = [{ date: '2026-09-20', sets: [{ weight: 0, reps: 35, rpe: 8 }, { weight: 0, reps: 32, rpe: 8 }] }];
  const t = computeNextTarget(hist, plank, '2026-09-22');
  ok('notes say seconds, never reps', / s\b/.test(t.note) && !/reps/.test(t.note), t.note);

  // Epley on an isometric hold manufactures PRs out of nothing.
  eq('a timed set scores zero', statsMod.scoreSet({ weight: 10, reps: 60, rpe: 8 }, plank), 0);
  ok('a normal set still scores', statsMod.scoreSet({ weight: 10, reps: 8, rpe: 8 }, wheel) > 0);
}

// ============================================================ supersets
section('Supersets the gym layout cannot support');
{
  store.resetAll();
  ok('paired by default', !store.isSupersetBroken('arms', 'C'));
  store.setSupersetBroken('arms', 'C', true);
  ok('can be split', store.isSupersetBroken('arms', 'C'));
  ok('splitting one group leaves the others paired', !store.isSupersetBroken('arms', 'D'));
  ok('and is scoped per day', !store.isSupersetBroken('push', 'C'));
  store.setSupersetBroken('arms', 'C', false);
  ok('can be paired again', !store.isSupersetBroken('arms', 'C'));
  store.resetAll();
}

// ============================================================ inverted lifts
section('Assisted lifts — the stack is counterweight, so less is harder');
{
  const { resolveExercise } = await import(`${APP}/program.js`);
  const { scoreSet, bestSet: bs, isPersonalRecord: isPR } = statsMod;
  const assisted = resolveExercise(getExercise('pull-up'), 'Assisted Pull-up');
  ok('the substitute carries the inverted flag', assisted.inverted === true);
  ok('a normal lift does not', !getExercise('bench-press').inverted);

  // Progress means taking assistance OFF.
  const earned = [{ date: '2026-09-01', sets: Array.from({ length: 4 }, () => ({ weight: 32.5, reps: 8, rpe: 8 })) }];
  const t = computeNextTarget(earned, assisted, '2026-09-03');
  eq('earning the increment REDUCES the assist', t.action, ACTION.ADD_LOAD);
  ok('next target is lighter, not heavier', t.weight < 32.5, `got ${t.weight}`);
  ok('the note says drop the assist', /drop the assist/.test(t.note), t.note);

  // It must never go negative — below zero is an unassisted rep, not a target.
  const almost = [{ date: '2026-09-01', sets: Array.from({ length: 4 }, () => ({ weight: 2, reps: 8, rpe: 8 })) }];
  const t2 = computeNextTarget(almost, assisted, '2026-09-03');
  ok('assist floors at zero', t2.weight === 0, `got ${t2.weight}`);
  ok('and says to try it unassisted', /unassisted/.test(t2.note), t2.note);

  // Backing off an assisted lift means MORE help, not less.
  const stalled = ['2026-09-01', '2026-09-08', '2026-09-15'].map((date) => ({
    date, sets: Array.from({ length: 4 }, () => ({ weight: 30, reps: 6, rpe: 9 })) }));
  const t3 = computeNextTarget(stalled, assisted, '2026-09-17');
  eq('stall on an assisted lift', t3.action, ACTION.STALL);
  ok('the back-off ADDS assistance', t3.weight > 30, `got ${t3.weight}`);

  // Scoring: the set with the LEAST assistance is the best one.
  const sets = [{ weight: 45, reps: 8, rpe: 9 }, { weight: 27.5, reps: 8, rpe: 9 }];
  eq('best assisted set is the least-assisted one', bs(sets, assisted).set.weight, 27.5);
  eq('…and the opposite for a normal lift', bs(sets, getExercise('bench-press')).set.weight, 45);
  ok('less assist scores higher', scoreSet(sets[1], assisted) > scoreSet(sets[0], assisted));

  // A PR is dropping the assist, not adding it.
  const hist = [{ date: '2026-09-01', sets: [{ weight: 40, reps: 8, rpe: 9 }] }];
  ok('less assist at equal reps is a PR', isPR({ weight: 32.5, reps: 8, rpe: 9 }, hist, assisted).isPR);
  ok('more assist is NOT a PR', !isPR({ weight: 50, reps: 8, rpe: 9 }, hist, assisted).isPR);
}

// ============================================================ rpe-blocked
section('Saying why the weight is stuck');
{
  const squat = getExercise('back-squat');   // 4×5–8 @ RPE 7–8

  // Every rep there, but ground out above the ceiling — the increment cannot bank.
  const ground = [{ date: '2026-09-01', sets: Array.from({ length: 4 }, () => ({ weight: 60, reps: 8, rpe: 10 })) }];
  const t = computeNextTarget(ground, squat, '2026-09-03');
  ok('flagged as RPE-blocked', t.rpeBlocked === true);
  eq('load does not move', t.weight, 60);
  ok('names the RPE as the blocker', /RPE 10/.test(t.note) && /RPE 8 or under/.test(t.note), t.note);

  // The same session at the ceiling banks the increment instead.
  const clean = [{ date: '2026-09-01', sets: Array.from({ length: 4 }, () => ({ weight: 60, reps: 8, rpe: 8 })) }];
  eq('at the ceiling it earns the load', computeNextTarget(clean, squat, '2026-09-03').action, ACTION.ADD_LOAD);

  // Short of the reps is an ordinary rep target, not an RPE lecture.
  const shortReps = [{ date: '2026-09-01', sets: [
    { weight: 60, reps: 8, rpe: 10 }, { weight: 60, reps: 6, rpe: 10 },
    { weight: 60, reps: 6, rpe: 10 }, { weight: 60, reps: 5, rpe: 10 }] }];
  ok('missing reps is not reported as RPE-blocked', !computeNextTarget(shortReps, squat, '2026-09-03').rpeBlocked);
}

// ============================================================ variant identity
section('Variant identity — one slot, two exercises');
{
  store.resetAll();
  // The shape the v2 migration produces: the same slot holding a barbell session and a dumbbell
  // session, each tagged with what was actually performed.
  store.upsertSession({ id: 'a', date: '2026-08-17', dayKey: 'push', week: 1, notes: '', entries: [
    { exerciseId: 'bench-press', performedAs: 'Barbell Bench Press',
      sets: [{ weight: 70, reps: 6, rpe: 8 }, { weight: 70, reps: 6, rpe: 8 }] }] });
  store.upsertSession({ id: 'b', date: '2026-08-25', dayKey: 'push', week: 2, notes: '', entries: [
    { exerciseId: 'bench-press', performedAs: 'Dumbbell Bench Press',
      sets: [{ weight: 25, reps: 9, rpe: 8 }, { weight: 25, reps: 8, rpe: 8 }] }] });

  eq('unfiltered history still returns both', store.historyFor('bench-press').length, 2);
  eq('barbell history excludes the dumbbell session',
    store.historyFor('bench-press', 'Barbell Bench Press').map((h) => h.sets[0].weight), [70]);
  eq('dumbbell history excludes the barbell session',
    store.historyFor('bench-press', 'Dumbbell Bench Press').map((h) => h.sets[0].weight), [25]);

  // THE bug this fixes: without filtering, the dumbbell target is computed from a 70 kg barbell.
  const dbEx = { ...getExercise('bench-press'), name: 'Dumbbell Bench Press', unit: 'dumbbell' };
  const t = computeNextTarget(store.historyFor('bench-press', 'Dumbbell Bench Press'), dbEx, '2026-08-27');
  ok('dumbbell target comes off the dumbbell load, not the barbell', t.weight === 25, `got ${t.weight}`);

  // Untagged history must stay INCLUDED — most slots were never mixed, and dropping their
  // pre-tagging sessions would silently reset every lift in the program.
  store.upsertSession({ id: 'c', date: '2026-08-30', dayKey: 'pull', week: 3, notes: '', entries: [
    { exerciseId: 'lat-pulldown', sets: [{ weight: 40, reps: 10, rpe: 8 }] }] });
  eq('untagged history is kept when a variant is requested',
    store.historyFor('lat-pulldown', 'Lat Pulldown').length, 1);
  store.resetAll();
}

// ============================================================ cloud backup
section('Cloud backup — the token must never reach a shared file');
{
  const cloud = await import(`${APP}/cloud.js`);
  store.resetAll();

  ok('disconnected until a token and gist both exist', !cloud.isConnected());

  // Simulate a connected device by writing the config the way connect() would.
  const SECRET = 'ghp_thisMustNeverLeakIntoAnExport';
  mem.set('workout.cloud', JSON.stringify({ token: SECRET, gistId: 'abc123' }));
  const fresh = await import(`${APP}/cloud.js?reload=1`);
  ok('connected once token + gist are present', fresh.isConnected());
  eq('status exposes the gist, never the token', Object.keys(fresh.status()).includes('token'), false);

  store.upsertSession({ id: 's1', date: '2026-08-17', dayKey: 'push', week: 1, notes: '', entries: [
    { exerciseId: 'bench-press', sets: [{ weight: 70, reps: 6, rpe: 8, done: true }] },
  ] });

  // THE invariant. exportJSON serialises the whole state object and that file gets emailed
  // around — a credential inside it leaks on the first backup someone shares.
  const backup = store.exportJSON();
  ok('token is absent from the export', !backup.includes(SECRET));
  ok('token is absent from the state object', !JSON.stringify(store.getState()).includes(SECRET));
  ok('the export still carries the training data', backup.includes('bench-press'));

  // Disconnect must actually destroy it, not just hide the UI.
  fresh.disconnect();
  ok('disconnect clears the stored token', !(mem.get('workout.cloud') || '').includes(SECRET));
  ok('disconnected again', !fresh.isConnected());
  store.resetAll();
}

// ============================================================ personal bests
section('Personal bests');
{
  const { personalBests, bestSet } = statsMod;
  store.resetAll();

  // bestSet breaks e1RM ties on actual reps — the formula caps effective reps at 12, so 22 and
  // 15 reps at one weight score identically and "best" would otherwise be arbitrary.
  const tie = bestSet([{ weight: 12.5, reps: 15 }, { weight: 12.5, reps: 22 }]);
  eq('tie broken on reps', tie.set.reps, 22);
  eq('empty list', bestSet([{ weight: 10, reps: 0 }]), null);

  // Visible from the FIRST session — a baseline is worth seeing.
  store.upsertSession({ id: 'a', date: '2026-08-13', dayKey: 'upper', week: 1, notes: '', entries: [
    { exerciseId: 'lat-pulldown', sets: [
      { weight: 25, reps: 12, done: true }, { weight: 30, reps: 8, done: true }] },
  ] });
  let pb = personalBests();
  eq('one lift has a best', pb.length, 1);
  eq('picks the highest e1RM set', pb[0].set.weight, 30);
  ok('not flagged NEW on the first session', !pb[0].isNew);

  // A later session that beats it IS new.
  store.upsertSession({ id: 'b', date: '2026-08-20', dayKey: 'upper', week: 2, notes: '', entries: [
    { exerciseId: 'lat-pulldown', sets: [{ weight: 35, reps: 9, done: true }] },
  ] });
  pb = personalBests();
  eq('best updates to the heavier set', pb[0].set.weight, 35);
  ok('flagged NEW after beating a prior session', pb[0].isNew);
  eq('dated to the session that set it', pb[0].date, '2026-08-20');

  // A later session that does NOT beat it leaves the record where it was.
  store.upsertSession({ id: 'c', date: '2026-08-27', dayKey: 'upper', week: 3, notes: '', entries: [
    { exerciseId: 'lat-pulldown', sets: [{ weight: 20, reps: 6, done: true }] },
  ] });
  pb = personalBests();
  eq('weaker session does not overwrite the best', pb[0].set.weight, 35);
  eq('best keeps its original date', pb[0].date, '2026-08-20');

  // Unticked sets count here too.
  store.resetAll();
  store.upsertSession({ id: 'd', date: '2026-08-13', dayKey: 'push', week: 1, notes: '', entries: [
    { exerciseId: 'bench-press', sets: [{ weight: 60, reps: 5, done: false }] },
  ] });
  eq('unticked set can be a personal best', personalBests()[0].set.weight, 60);

  store.resetAll();
}

// ============================================================ service worker precache
section('Service worker — precache list matches the file tree');
{
  const fs = await import('node:fs');
  const path = await import('node:path');
  const APP_ROOT = path.resolve(APP, '..');

  const swSrc = fs.readFileSync(path.join(APP_ROOT, 'sw.js'), 'utf8');
  const block = swSrc.match(/const SHELL = \[([\s\S]*?)\];/);
  ok('SHELL list found in sw.js', !!block);

  const listed = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).filter((p) => p !== './');

  // Every precached path must exist, or install silently drops it and offline breaks.
  const missing = listed.filter((p) => !fs.existsSync(path.join(APP_ROOT, p)));
  eq('every precached path exists on disk', missing, []);

  // And every shipped asset must be precached, or it 404s in the gym.
  const shipped = [];
  const walk = (dir, prefix) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('__') || e.name.startsWith('.')) continue; // dev-only harnesses
      const rel = `${prefix}${e.name}`;
      if (e.isDirectory()) walk(path.join(dir, e.name), `${rel}/`);
      else if (/\.(js|css|html|png|webmanifest)$/.test(e.name)) shipped.push(`./${rel}`);
    }
  };
  walk(APP_ROOT, '');

  const notCached = shipped.filter((p) => p !== './sw.js' && !listed.includes(p));
  eq('every shipped asset is precached', notCached, []);
  console.log(`  ${listed.length} paths precached, ${shipped.length} assets shipped`);

  // Absolute paths would resolve against the domain root and 404 on a Pages subpath.
  const absolute = listed.filter((p) => p.startsWith('/'));
  eq('no absolute paths in the precache list', absolute, []);

  // Same rule for the manifest and the HTML shell.
  const mf = JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'manifest.webmanifest'), 'utf8'));
  ok('manifest start_url is relative', !mf.start_url.startsWith('/'), mf.start_url);
  ok('manifest scope is relative', !mf.scope.startsWith('/'), mf.scope);
  ok('manifest icon paths are relative', mf.icons.every((i) => !i.src.startsWith('/')));
  ok('manifest has a maskable icon', mf.icons.some((i) => i.purpose === 'maskable'));

  const htmlSrc = fs.readFileSync(path.join(APP_ROOT, 'index.html'), 'utf8');
  const rootRefs = [...htmlSrc.matchAll(/(?:href|src)="(\/[^"]*)"/g)].map((m) => m[1]);
  eq('no root-absolute refs in index.html', rootRefs, []);

  const swReg = htmlSrc.includes('js/app.js');
  ok('index.html loads app.js', swReg);
  ok('app.js registers sw.js relatively',
    fs.readFileSync(path.join(APP, 'app.js'), 'utf8').includes("register('sw.js')"));
}

console.log(`\n${'='.repeat(46)}`);
console.log(fail === 0 ? `✅ ${pass} assertions passed` : `❌ ${fail} FAILED, ${pass} passed`);
process.exit(fail === 0 ? 0 : 1);
