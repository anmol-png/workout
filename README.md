# Training Program — 5-Day PPLUL + Progress Tracker

A hypertrophy-led 5-day program (size first, blended with strength, athleticism and conditioning),
built around: **26M · 82 kg · fully equipped gym · intermediate upper body, lagging legs · 6–7 h
sleep.** Legs are the declared priority and get 35 of the 90 weekly working sets — 39 % of
everything you do.

---

## The week

| Day | Session | Emphasis |
|---|---|---|
| **Mon** | [Push](program/01-Push.md) | Chest, delts, triceps |
| **Tue** | [Pull](program/02-Pull.md) | Back, rear delts, biceps |
| **Wed** | [Legs](program/03-Legs.md) | Quad-dominant, squat anchor · + finisher |
| **Thu** | Rest | Walk |
| **Fri** | [Upper](program/04-Upper.md) | Second chest/back/delt/arm dose |
| **Sat** | [Lower](program/05-Lower.md) | Hinge/posterior + unilateral · + finisher |
| **Sun** | Rest | Walk |

Every muscle is trained **2×/week**. Legs land Wed and Sat so neither session runs on the other's
fatigue.

---

## Documents

| File | What's in it |
|---|---|
| **[00-Program-Overview.md](program/00-Program-Overview.md)** | Split rationale, weekly volume table, double progression, RPE, the 6-week mesocycle, autoregulation. **Read this first.** |
| [01-Push.md](program/01-Push.md) · [02-Pull.md](program/02-Pull.md) · [03-Legs.md](program/03-Legs.md) · [04-Upper.md](program/04-Upper.md) · [05-Lower.md](program/05-Lower.md) | The five sessions, with the reasoning behind every set, rep, RPE and load, plus cues and substitutes. |
| **[06-Nutrition.md](program/06-Nutrition.md)** | Calorie and protein targets, the self-correcting bodyweight feedback loop, an India-friendly protein guide, supplements, sleep. |
| [`app/`](app/) | The progress tracker. |

---

## The tracker

### → **[anmol-png.github.io/workout/app](https://anmol-png.github.io/workout/app/)**

An **offline-first PWA**. Open that link on your phone, then **Share → Add to Home Screen**.
After that it launches like a native app and works with no signal at all — the whole app shell is
cached on-device by a service worker, and your training data never leaves your phone.

**What it does:** drives today's session · shows last week's numbers inline as the target to beat ·
logs weight/reps/RPE per set · computes double progression and tells you when to add weight ·
rest timer · plate calculator · strength and estimated-1RM charts · PR detection ·
weekly hard-sets-per-muscle chart · bodyweight trend against the target gain corridor ·
sleep and readiness log with automatic autoregulation prompts · JSON export/import.

**Run it locally:**
```bash
cd app && python3 -m http.server 8080   # then open http://localhost:8080
```

---

## Core principles

- **Progressive overload is the whole game.** Double progression: add reps to the top of the range,
  then add load. Every exercise, every week.
- **RPE 7–9.** Barbell compounds stay 2–3 reps shy of failure; machines and isolation go close.
- **Log every working set.** No log → no precise overload → plateau. That's what the app is for.
- **Autoregulate on bad sleep.** Under 6 h: drop the last set of everything, RPE −1, skip the
  finisher. Consistency over months beats heroics on a tired Tuesday.
- **Week 1 is calibration, week 6 is a deload.** Both are load-bearing parts of the plan.
- **Nutrition and sleep are the bottleneck**, not the training. 165 g protein, ~2,900 kcal,
  and more sleep if you can get it.

## Verifying the logic

The progression engine, plate calculator, volume maths and service-worker precache list have a
test suite — **233 assertions, no dependencies**:

```bash
tmp=$(mktemp -d) && cp -R app/. "$tmp/" && printf '{"type":"module"}' > "$tmp/package.json"
APP_DIR="$tmp/js" node tests/run.mjs; rm -rf "$tmp"
```

The copy step exists because Node needs a `{"type":"module"}` marker to load `.js` files as ES
modules, and `app/` is deliberately kept free of npm artefacts — there is no build step.

It checks, among other things, that the double-progression rule reproduces the worked example in
[00-Program-Overview.md](program/00-Program-Overview.md), that every shipped asset is in the
service worker's precache list, and that no path is root-absolute (which would silently break
offline support on a GitHub Pages subpath).

---

## Archive

[`archive/`](archive/) holds the superseded 4-day upper/lower plan (June 2026) — kept for
reference. The Leg Day A session there has been folded into the current
[Legs](program/03-Legs.md) and [Lower](program/05-Lower.md) days.
