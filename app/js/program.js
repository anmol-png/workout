/**
 * program.js — THE PROGRAM AS DATA. Single source of truth.
 *
 * Everything the app does derives from this file: the logger renders from it, the progression
 * engine reads `repRange`/`rpeTarget`/`increment` from it, and the weekly-volume chart sums
 * `muscles.primary` across it. Change the program here and the whole app follows.
 *
 * Set counting for volume: a set counts 1.0 toward each PRIMARY muscle and 0.5 toward each
 * SECONDARY. That's the standard convention for "hard sets per muscle" — a bench press is a
 * chest set and half a triceps set, which is closer to the truth than counting it as neither
 * or as a full set for both.
 */

export const MUSCLES = [
  'quads', 'hamstrings', 'glutes', 'calves',
  'chest', 'back', 'sideDelts', 'rearDelts', 'frontDelts',
  'biceps', 'triceps', 'core',
];

export const MUSCLE_LABELS = {
  quads: 'Quads', hamstrings: 'Hamstrings', glutes: 'Glutes', calves: 'Calves',
  chest: 'Chest', back: 'Back', sideDelts: 'Side Delts', rearDelts: 'Rear Delts',
  frontDelts: 'Front Delts', biceps: 'Biceps', triceps: 'Triceps', core: 'Core',
};

/** Weekly hard-set targets from program/00-Program-Overview.md. Used as the chart's target band. */
export const VOLUME_TARGETS = {
  quads: [10, 20], hamstrings: [10, 20], glutes: [10, 20], calves: [6, 12],
  chest: [10, 20], back: [10, 20], sideDelts: [8, 16], rearDelts: [6, 12],
  // Arms and front delts carry heavy spillover from every press and pull, so their bands sit
  // higher than their direct-set count would suggest — 8 direct sets lands near 16 counted.
  frontDelts: [4, 14], biceps: [8, 18], triceps: [8, 18], core: [3, 10],
};

/** Increment types → how much load to add when double progression fires. */
export const INCREMENT = {
  BARBELL: 2.5,      // smallest pair of plates worth adding
  DUMBBELL: 2,       // per hand — next pair up in most gyms
  MACHINE: 5,        // roughly one notch/plate on a stack
  LEGPRESS: 10,      // a plate per side
  BODYWEIGHT: 2.5,   // added via dip belt
};

export const DAYS = [
  { key: 'push',  name: 'Push',  code: 'PUSH',  subtitle: 'Chest · Delts · Triceps',        weekday: 1, doc: '01-Push.md'  },
  { key: 'pull',  name: 'Pull',  code: 'PULL',  subtitle: 'Back · Rear Delts · Biceps',     weekday: 2, doc: '02-Pull.md'  },
  { key: 'legs',  name: 'Legs',  code: 'LEGS',  subtitle: 'Quad-dominant · Squat anchor',   weekday: 3, doc: '03-Legs.md'  },
  { key: 'upper', name: 'Upper', code: 'UPPER', subtitle: 'Chest · Back · Delts · Arms',    weekday: 5, doc: '04-Upper.md' },
  { key: 'lower', name: 'Lower', code: 'LOWER', subtitle: 'Hinge · Posterior · Unilateral', weekday: 6, doc: '05-Lower.md' },
];

/**
 * Exercises, in session order.
 *
 * supersetGroup: exercises sharing a letter are performed back-to-back. The UI groups them and
 * the rest timer only fires after the LAST exercise in the group.
 * restSec applies after the set (or after the whole superset round).
 */
export const EXERCISES = [
  // ---------------------------------------------------------------- PUSH
  {
    id: 'bench-press', day: 'push', order: 'A', name: 'Barbell Bench Press',
    muscles: { primary: ['chest'], secondary: ['triceps', 'frontDelts'] },
    sets: 4, repRange: [5, 8], rpe: [7, 8], restSec: 165,
    increment: INCREMENT.BARBELL, unit: 'barbell', startLoad: 45,
    cues: [
      'Shoulder blades back and DOWN, pinned to the bench.',
      'Bar to lower chest/sternum, elbows ~45–60° from the torso.',
      '2s down, drive up. Feet planted, slight upper-back arch.',
      'Use safety pins or a spotter. Always.',
    ],
    substitutes: ['Dumbbell Bench Press', 'Machine Chest Press'],
  },
  {
    id: 'incline-db-press', day: 'push', order: 'B', name: 'Incline DB Press (30°)',
    muscles: { primary: ['chest'], secondary: ['frontDelts', 'triceps'] },
    sets: 3, repRange: [8, 12], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.DUMBBELL, unit: 'dumbbell', startLoad: 16,
    cues: [
      '30° incline — steeper turns it into a shoulder press.',
      'Control down to a real chest stretch. Don’t clang at the top.',
    ],
    substitutes: ['Incline Barbell Press', 'Incline Machine Press'],
  },
  {
    id: 'db-shoulder-press', day: 'push', order: 'C', name: 'Seated DB Shoulder Press',
    muscles: { primary: ['frontDelts', 'sideDelts'], secondary: ['triceps'] },
    sets: 3, repRange: [8, 12], rpe: [8, 8], restSec: 90,
    increment: INCREMENT.DUMBBELL, unit: 'dumbbell', startLoad: 12,
    cues: [
      'Press slightly in front of the head, never behind.',
      'Lower to ~shoulder height. Ribs down — don’t arch to finish.',
    ],
    substitutes: ['Machine Shoulder Press', 'Standing Barbell OHP'],
  },
  {
    id: 'cable-lateral-raise', day: 'push', order: 'D1', supersetGroup: 'D', name: 'Cable Lateral Raise',
    muscles: { primary: ['sideDelts'], secondary: [] },
    sets: 3, repRange: [12, 20], rpe: [9, 9], restSec: 20,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Lead with the elbow. Raise to shoulder height, no higher.',
      'Cable keeps tension at the bottom where dumbbells have none.',
      'If you’re swinging, go lighter.',
    ],
    substitutes: ['DB Lateral Raise', 'Machine Lateral Raise'],
  },
  {
    id: 'overhead-triceps-ext', day: 'push', order: 'D2', supersetGroup: 'D', name: 'Overhead Rope Triceps Ext',
    muscles: { primary: ['triceps'], secondary: [] },
    sets: 3, repRange: [10, 15], rpe: [9, 9], restSec: 85,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Overhead = the only position that stretches the long head.',
      'Elbows forward and fixed. Deep stretch, full lockout.',
    ],
    substitutes: ['EZ-Bar Skullcrusher', 'DB Overhead Extension'],
  },
  {
    id: 'triceps-pushdown', day: 'push', order: 'E', name: 'Cable Triceps Pushdown',
    muscles: { primary: ['triceps'], secondary: [] },
    sets: 2, repRange: [12, 15], rpe: [9, 10], restSec: 60,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Upper arms pinned to your sides. Full lockout.',
      'Zero risk here — take the last set to true failure.',
    ],
    substitutes: ['Bench Dips', 'Single-arm Pushdown'],
  },

  // ---------------------------------------------------------------- PULL
  {
    id: 'pull-up', day: 'pull', order: 'A', name: 'Weighted Pull-up',
    muscles: { primary: ['back'], secondary: ['biceps'] },
    sets: 4, repRange: [5, 8], rpe: [8, 8], restSec: 150,
    increment: INCREMENT.BODYWEIGHT, unit: 'bodyweight', startLoad: 0,
    cues: [
      'Full dead hang each rep. Drive elbows down toward the ribs.',
      'No kipping. 2s descent.',
      'Under 6 clean reps? Swap to Lat Pulldown 4×8–12.',
    ],
    substitutes: ['Lat Pulldown', 'Assisted Pull-up'],
  },
  {
    id: 'barbell-row', day: 'pull', order: 'B', name: 'Barbell Row',
    muscles: { primary: ['back'], secondary: ['rearDelts', 'biceps'] },
    sets: 3, repRange: [8, 12], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.BARBELL, unit: 'barbell', startLoad: 40,
    cues: [
      'Hinge ~45°, back FLAT, brace hard.',
      'Bar to lower ribs. Elbows back, squeeze the blades.',
      'If your torso angle changes mid-set, it’s too heavy.',
    ],
    substitutes: ['Chest-Supported Row', 'Pendlay Row', 'Single-arm DB Row'],
  },
  {
    id: 'seated-cable-row', day: 'pull', order: 'C', name: 'Seated Cable Row (neutral)',
    muscles: { primary: ['back'], secondary: ['rearDelts', 'biceps'] },
    sets: 3, repRange: [10, 12], rpe: [8, 9], restSec: 90,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Let the shoulder blades protract fully at the front — real stretch.',
      'Don’t lean back past vertical to finish the rep.',
    ],
    substitutes: ['Chest-Supported Machine Row', 'Single-arm Cable Row'],
  },
  {
    id: 'reverse-pec-deck', day: 'pull', order: 'D1', supersetGroup: 'D', name: 'Reverse Pec Deck',
    muscles: { primary: ['rearDelts'], secondary: [] },
    sets: 3, repRange: [15, 20], rpe: [9, 9], restSec: 20,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Pull with the ELBOWS, not the hands. Slight fixed arm bend.',
      'Feel it in your traps? Go lighter.',
      'Best shoulder insurance against all the pressing.',
    ],
    substitutes: ['Face Pull', 'Bent-over DB Reverse Fly'],
  },
  {
    id: 'incline-db-curl', day: 'pull', order: 'D2', supersetGroup: 'D', name: 'Incline DB Curl',
    muscles: { primary: ['biceps'], secondary: [] },
    sets: 3, repRange: [8, 12], rpe: [9, 9], restSec: 85,
    increment: INCREMENT.DUMBBELL, unit: 'dumbbell', startLoad: 8,
    cues: [
      'Incline puts the upper arm behind the torso = biceps under stretch.',
      'Elbows stay back. Full extension at the bottom — that’s the point.',
    ],
    substitutes: ['DB Curl', 'Cable Curl'],
  },
  {
    id: 'hammer-curl', day: 'pull', order: 'E', name: 'Cable Rope Hammer Curl',
    muscles: { primary: ['biceps'], secondary: [] },
    sets: 2, repRange: [12, 15], rpe: [9, 9], restSec: 60,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Neutral grip hits the brachialis — sits under the biceps and pushes it up.',
      'Elbows fixed at your sides. No swinging.',
    ],
    substitutes: ['DB Hammer Curl'],
  },

  // ---------------------------------------------------------------- LEGS
  {
    id: 'back-squat', day: 'legs', order: 'A', name: 'Barbell Back Squat',
    muscles: { primary: ['quads'], secondary: ['glutes', 'hamstrings', 'core'] },
    sets: 4, repRange: [5, 8], rpe: [7, 8], restSec: 180,
    increment: INCREMENT.BARBELL, unit: 'barbell', startLoad: 45,
    cues: [
      'Brace like you’re about to be punched. Big breath, hold it.',
      'Sit BETWEEN the hips. Knees track over toes.',
      'At least parallel — hip crease level with the knee. Depth is non-negotiable.',
      'Drive the floor away. Hips and shoulders rise together.',
    ],
    substitutes: ['Front Squat', 'Hack Squat', 'Safety Bar Squat'],
  },
  {
    id: 'rdl', day: 'legs', order: 'B', name: 'Romanian Deadlift',
    muscles: { primary: ['hamstrings'], secondary: ['glutes', 'back'] },
    sets: 3, repRange: [8, 10], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.BARBELL, unit: 'barbell', startLoad: 50,
    cues: [
      'SOFT knees, not bent. This is a hinge, not a squat.',
      'Push the HIPS back — the bar lowering is a consequence.',
      'Bar stays close to the legs. Back flat — NEVER rounded.',
      'Lower to a strong hamstring stretch. Don’t chase depth by rounding.',
    ],
    substitutes: ['Dumbbell RDL', 'Good Morning', '45° Back Extension'],
  },
  {
    id: 'leg-press', day: 'legs', order: 'C', name: 'Leg Press',
    muscles: { primary: ['quads'], secondary: ['glutes'] },
    sets: 3, repRange: [10, 15], rpe: [8, 9], restSec: 90,
    increment: INCREMENT.LEGPRESS, unit: 'machine', startLoad: 100,
    cues: [
      'Feet shoulder-width, mid-platform.',
      'Lower to ~90° — or stop before the lower back rounds off the pad.',
      'FULL range. Quarter reps with more plates is how this exercise gets wasted.',
      'Machines vary wildly — chase the RPE, not the number.',
    ],
    substitutes: ['Hack Squat', 'Pendulum Squat', 'Walking Lunges'],
  },
  {
    id: 'seated-leg-curl', day: 'legs', order: 'D1', supersetGroup: 'D', name: 'Seated Leg Curl',
    muscles: { primary: ['hamstrings'], secondary: [] },
    sets: 3, repRange: [10, 15], rpe: [9, 9], restSec: 20,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Seated (hip flexed) = more hamstring stretch than lying. Evidence favours it.',
      'Squeeze hard, SLOW 2–3s release. Hips stay down.',
    ],
    substitutes: ['Lying Leg Curl', 'Nordic Curl'],
  },
  {
    id: 'standing-calf-raise', day: 'legs', order: 'D2', supersetGroup: 'D', name: 'Standing Calf Raise',
    muscles: { primary: ['calves'], secondary: [] },
    sets: 3, repRange: [10, 15], rpe: [9, 9], restSec: 75,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Tempo IS the exercise: 2s stretch at the bottom, 1s pause at the top.',
      'Straight knee = gastrocnemius. Full range. No bouncing.',
    ],
    substitutes: ['Smith Machine Calf Raise', 'Leg Press Calf Raise'],
  },
  {
    id: 'legs-finisher', day: 'legs', order: 'F', name: 'Finisher: Sled / Bike', isFinisher: true,
    muscles: { primary: [], secondary: [] },
    sets: 1, repRange: [1, 1], rpe: [6, 7], restSec: 0,
    increment: 0, unit: 'none', startLoad: null,
    cues: [
      'Sled: 6 lengths, push down / drag back, walk back as rest.',
      'No sled: bike 6 × 20s hard / 40s easy.',
      'Concentric-only = near-zero recovery cost. 5 minutes, not more.',
    ],
    substitutes: ['Bike Intervals', 'Incline Treadmill'],
  },

  // ---------------------------------------------------------------- UPPER
  {
    id: 'weighted-dip', day: 'upper', order: 'A', name: 'Weighted Dip',
    muscles: { primary: ['chest', 'triceps'], secondary: ['frontDelts'] },
    sets: 3, repRange: [6, 10], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.BODYWEIGHT, unit: 'bodyweight', startLoad: 0,
    cues: [
      'Lean forward 15–30° to bias the chest.',
      'Elbows track back, not flared. Stop at upper-arm-parallel.',
      'Shoulders unhappy? Swap to Incline Barbell Press 3×6–10.',
    ],
    substitutes: ['Incline Barbell Press', 'Assisted Dip'],
  },
  {
    id: 'lat-pulldown', day: 'upper', order: 'B', name: 'Lat Pulldown (wide pronated)',
    muscles: { primary: ['back'], secondary: ['biceps'] },
    sets: 3, repRange: [8, 12], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Slight backward lean ~15°, held CONSTANT — don’t row it.',
      'Drive the elbows down. Full stretch at the top.',
    ],
    substitutes: ['Neutral-grip Pulldown', 'Pull-up'],
  },
  {
    id: 'machine-chest-press', day: 'upper', order: 'C1', supersetGroup: 'C', name: 'Machine Chest Press',
    muscles: { primary: ['chest'], secondary: ['triceps', 'frontDelts'] },
    sets: 3, repRange: [10, 15], rpe: [9, 9], restSec: 20,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Stabilized = all the effort goes to the chest, and RPE 9 is safe with no spotter.',
      'Full range, squeeze at peak. Don’t shrug the shoulders forward.',
    ],
    substitutes: ['Pec Deck Fly', 'Cable Fly'],
  },
  {
    id: 'chest-supported-row', day: 'upper', order: 'C2', supersetGroup: 'C', name: 'Chest-Supported Row',
    muscles: { primary: ['back'], secondary: ['rearDelts', 'biceps'] },
    sets: 3, repRange: [10, 12], rpe: [8, 9], restSec: 90,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Chest pad removes the lower back entirely — no spinal fatigue two days before Lower.',
      'Peeling off the pad? Too heavy.',
    ],
    substitutes: ['T-Bar Row', 'Seal Row', 'Machine Row'],
  },
  {
    id: 'db-lateral-raise', day: 'upper', order: 'D1', supersetGroup: 'D', name: 'DB Lateral Raise',
    muscles: { primary: ['sideDelts'], secondary: [] },
    sets: 3, repRange: [12, 20], rpe: [9, 9], restSec: 15,
    increment: INCREMENT.DUMBBELL, unit: 'dumbbell', startLoad: 6,
    cues: [
      'Lead with the elbow, stop at shoulder height. Slow negative.',
      'Go lighter than your ego wants — most over-loaded exercise in any gym.',
    ],
    substitutes: ['Cable Lateral Raise', 'Machine Lateral Raise'],
  },
  {
    id: 'ez-bar-curl', day: 'upper', order: 'D2', supersetGroup: 'D', name: 'EZ-Bar Curl',
    muscles: { primary: ['biceps'], secondary: [] },
    // 2 sets, not 3: the biceps already take ~10 sets/week between Pull's direct work and the
    // spillover from every row and pulldown. Arms don't need a third set here more than legs
    // need the recovery.
    sets: 2, repRange: [10, 12], rpe: [9, 9], restSec: 15,
    increment: INCREMENT.BARBELL, unit: 'barbell', startLoad: 20,
    cues: [
      'Angled grip spares the wrists and lets you load heavier than DB curls.',
      'Elbows pinned. No leaning back. Full extension.',
    ],
    substitutes: ['Barbell Curl', 'Cable Curl'],
  },
  {
    id: 'cable-overhead-ext', day: 'upper', order: 'D3', supersetGroup: 'D', name: 'Cable Overhead Triceps Ext',
    muscles: { primary: ['triceps'], secondary: [] },
    // 2 sets — same reasoning as the curl. The dip above is already a primary triceps movement.
    sets: 2, repRange: [10, 15], rpe: [9, 9], restSec: 90,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Long head is the largest of the three — worth hitting twice a week.',
      'Elbows forward and fixed. Deep stretch, full lockout.',
    ],
    substitutes: ['EZ-Bar Skullcrusher', 'DB Overhead Extension'],
  },

  // ---------------------------------------------------------------- LOWER
  {
    id: 'hip-thrust', day: 'lower', order: 'A', name: 'Barbell Hip Thrust',
    muscles: { primary: ['glutes'], secondary: ['hamstrings'] },
    sets: 4, repRange: [8, 12], rpe: [8, 8], restSec: 120,
    increment: INCREMENT.BARBELL * 2, unit: 'barbell', startLoad: 60,
    cues: [
      'Bench at the bottom of the shoulder blades. Use a bar pad.',
      'Chin tucked, RIBS DOWN — do not arch the lower back to finish.',
      'Drive through the heels, squeeze hard at lockout for a beat.',
      'Chosen over deadlift: near-max glute load, almost no spinal cost.',
    ],
    substitutes: ['Trap-Bar Deadlift', 'Glute Bridge Machine', 'Single-leg Hip Thrust'],
  },
  {
    id: 'bulgarian-split-squat', day: 'lower', order: 'B', name: 'Bulgarian Split Squat',
    muscles: { primary: ['quads', 'glutes'], secondary: ['core'] },
    sets: 3, repRange: [8, 12], rpe: [8, 8], restSec: 90,
    increment: INCREMENT.DUMBBELL, unit: 'dumbbell', startLoad: 10,
    perSide: true,
    cues: [
      'Front shin roughly VERTICAL at the bottom — set your foot far enough forward.',
      'Rear leg is a kickstand, not a contributor. Torso leaned slightly forward.',
      'Control the wobble rather than avoiding it — that’s the stabilizer training.',
      'Log L and R. If one side fails 2+ reps earlier, do it first and match the strong side.',
    ],
    substitutes: ['Walking Lunges', 'Step-ups', 'Reverse Lunges'],
  },
  {
    id: 'lying-leg-curl', day: 'lower', order: 'C', name: 'Lying Leg Curl',
    muscles: { primary: ['hamstrings'], secondary: [] },
    sets: 3, repRange: [8, 12], rpe: [9, 9], restSec: 90,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Lying (hip extended) emphasizes a different part than Wednesday’s seated curl.',
      'Hips stay DOWN on the pad. Slow 2–3s negative — that’s the injury-proofing part.',
    ],
    substitutes: ['Seated Leg Curl', 'Nordic Curl'],
  },
  {
    id: 'leg-extension', day: 'lower', order: 'D', name: 'Leg Extension',
    muscles: { primary: ['quads'], secondary: [] },
    sets: 3, repRange: [12, 15], rpe: [9, 9], restSec: 75,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'The only exercise here that targets rectus femoris — squats leave it partly shortened.',
      'Hard 1s squeeze at full extension. Controlled negative, no slamming.',
      'Knees complaining? Lighter and slower, don’t drop it.',
    ],
    substitutes: ['Hack Squat', 'Sissy Squat'],
  },
  {
    id: 'seated-calf-raise', day: 'lower', order: 'E1', supersetGroup: 'E', name: 'Seated Calf Raise',
    muscles: { primary: ['calves'], secondary: [] },
    sets: 3, repRange: [12, 20], rpe: [9, 9], restSec: 20,
    increment: INCREMENT.MACHINE, unit: 'machine', startLoad: null,
    cues: [
      'Bent knee = SOLEUS, the muscle under the gastroc. Only way to load it.',
      'Overwhelmingly slow-twitch — needs the higher reps. Full stretch, no bouncing.',
    ],
    substitutes: ['Leg Press Calf Raise (bent knee)'],
  },
  {
    id: 'hanging-leg-raise', day: 'lower', order: 'E2', supersetGroup: 'E', name: 'Hanging Leg Raise',
    muscles: { primary: ['core'], secondary: [] },
    sets: 3, repRange: [10, 15], rpe: [8, 9], restSec: 75,
    increment: INCREMENT.BODYWEIGHT, unit: 'bodyweight', startLoad: 0,
    cues: [
      'CURL THE PELVIS toward the ribs — hip flexors lift legs, abs tilt the pelvis.',
      'Swinging? Do knee raises until you’re stronger.',
      'Compounds train the core isometrically; this is the only spinal flexion in the program.',
    ],
    substitutes: ['Cable Crunch', 'Hanging Knee Raise'],
  },
  {
    id: 'lower-finisher', day: 'lower', order: 'F', name: 'Finisher: Sled / Bike', isFinisher: true,
    muscles: { primary: [], secondary: [] },
    sets: 1, repRange: [1, 1], rpe: [6, 7], restSec: 0,
    increment: 0, unit: 'none', startLoad: null,
    cues: [
      'Backward sled drag biases quads and is easy on the knees.',
      'No sled: bike 6 × 20s hard / 40s easy.',
      '5 minutes. The lifting is the priority.',
    ],
    substitutes: ['Bike Intervals', 'Incline Treadmill'],
  },
];

// ---------------------------------------------------------------- lookups

const BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

export function getExercise(id) {
  return BY_ID.get(id) || null;
}

export function exercisesForDay(dayKey) {
  return EXERCISES.filter((e) => e.day === dayKey);
}

export function getDay(dayKey) {
  return DAYS.find((d) => d.key === dayKey) || null;
}

/** Maps a JS weekday (0=Sun..6=Sat) to the scheduled session, or null on a rest day. */
export function dayForWeekday(weekday) {
  return DAYS.find((d) => d.weekday === weekday) || null;
}

/** Formats the prescription line, e.g. "4 × 5–8 @ RPE 7–8". */
export function prescription(ex) {
  if (ex.isFinisher) return '~5 min · easy';
  const [lo, hi] = ex.repRange;
  const [rlo, rhi] = ex.rpe;
  const reps = lo === hi ? `${lo}` : `${lo}–${hi}`;
  const rpe = rlo === rhi ? `${rlo}` : `${rlo}–${rhi}`;
  return `${ex.sets} × ${reps}${ex.perSide ? '/leg' : ''} @ RPE ${rpe}`;
}

/** Nutrition targets from program/06-Nutrition.md — shown on the Nutrition view. */
export const NUTRITION = {
  calories: 2900,
  protein: 165,
  fat: 75,
  carbs: 390,
  waterL: 3.25,
  gainRatePerWeek: [0.2, 0.4], // kg/week target corridor
  creatineG: 5,
};

/** Mesocycle shape — 5 accumulation weeks then a deload, from 00-Program-Overview.md. */
export const BLOCK_WEEKS = 6;
export const DELOAD_WEEK = 6;
