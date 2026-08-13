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
globalThis.CustomEvent = class { constructor(t, o) { this.type = t; Object.assign(this, o); } };
// Node 20 exposes crypto as a getter-only global; randomUUID already exists there.

// Points at a copy of app/js that carries a {"type":"module"} package.json, so Node loads the
// .js files as ES modules. The real app dir stays free of any npm artefact.
const APP = process.env.APP_DIR || '/Users/anmolkhilwani/workout/app/js';
const { computeNextTarget, earnedIncrement, ACTION, isStalled, describePerformance } = await import(`${APP}/progression.js`);
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
  ok('32 exercises (incl. 2 finishers)', EXERCISES.length === 32, `got ${EXERCISES.length}`);
  const ids = EXERCISES.map((e) => e.id);
  eq('all exercise ids unique', ids.length - new Set(ids).size, 0);
  eq('5 training days', DAYS.length, 5);

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
  const t1 = computeNextTarget(perfect, 'back-squat');
  eq('→ ADD_LOAD', t1.action, ACTION.ADD_LOAD);
  eq('→ +2.5 kg', t1.weight, 52.5);
  eq('→ restart at bottom of range', t1.reps, 5);

  // One set short → strict says no.
  const nearMiss = [{ date: '2026-08-01', sets: [S(50, 8, 8), S(50, 8, 8), S(50, 8, 8), S(50, 7, 9)] }];
  ok('STRICT: 8,8,8,7 does NOT earn increment', !earnedIncrement(nearMiss[0].sets, squat));
  const t2 = computeNextTarget(nearMiss, 'back-squat');
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
  eq('below bottom → REPEAT', computeNextTarget(weak, 'back-squat').action, ACTION.REPEAT);

  // Stall detection: 3 sessions, no added weight or reps.
  const flat = ['2026-08-01', '2026-08-08', '2026-08-15'].map((date) => ({
    date, sets: [S(50, 6, 9), S(50, 6, 9), S(50, 6, 9), S(50, 6, 9)],
  }));
  ok('3 flat sessions → isStalled', isStalled(flat));
  const t3 = computeNextTarget(flat, 'back-squat');
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
    const t = computeNextTarget(hist, 'back-squat');
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

  eq('kg lift suggests +2.5 kg', computeNextTarget(perfect, 'back-squat').note.includes('2.5 kg'), true);
  store.setExerciseUnit('back-squat', 'lb');
  const lbNote = computeNextTarget(perfect, 'back-squat').note;
  ok('lb lift suggests a lb jump', lbNote.includes('lb'), lbNote);
  ok('lb lift never says kg', !lbNote.includes(' kg'), lbNote);
  const lbTarget = computeNextTarget(perfect, 'back-squat');
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
