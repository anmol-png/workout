/**
 * timer.js — rest timer.
 *
 * The one non-obvious requirement: this must stay accurate when the phone screen locks or you
 * switch apps mid-rest. Browsers throttle setInterval in background tabs to once a minute or
 * stop it entirely, so counting ticks would drift badly — a 3-minute rest could report 90
 * seconds. Instead we store the absolute target timestamp and recompute remaining time from
 * Date.now() on every tick. The interval becomes a repaint trigger, not the source of truth.
 */

const el = {};
let endsAt = 0;
let totalMs = 0;
let ticker = null;
let wakeLock = null;
let audioCtx = null;

export function initTimer() {
  el.bar = document.getElementById('rest-bar');
  el.time = document.getElementById('rest-time');
  el.label = document.getElementById('rest-label');
  el.fill = document.getElementById('rest-progress-fill');

  document.getElementById('rest-dismiss').addEventListener('click', stopTimer);
  document.getElementById('rest-minus').addEventListener('click', () => adjust(-15));
  document.getElementById('rest-plus').addEventListener('click', () => adjust(15));

  // Recompute immediately on return from background rather than waiting for the next tick.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && endsAt) {
      render();
      requestWakeLock();
    }
  });
}

export function startTimer(seconds, label = 'Rest') {
  if (!seconds || seconds <= 0) return;
  totalMs = seconds * 1000;
  endsAt = Date.now() + totalMs;

  el.label.textContent = label;
  el.bar.hidden = false;
  el.bar.classList.remove('done');

  clearInterval(ticker);
  ticker = setInterval(render, 250);
  render();
  requestWakeLock();
}

export function stopTimer() {
  clearInterval(ticker);
  ticker = null;
  endsAt = 0;
  el.bar.hidden = true;
  el.bar.classList.remove('done');
  releaseWakeLock();
}

export function isRunning() {
  return endsAt > Date.now();
}

function adjust(deltaSec) {
  if (!endsAt) return;
  endsAt += deltaSec * 1000;
  totalMs = Math.max(totalMs + deltaSec * 1000, 1000);
  if (endsAt <= Date.now()) return stopTimer();
  el.bar.classList.remove('done');
  render();
}

function render() {
  const remaining = endsAt - Date.now();

  if (remaining <= 0) {
    // Keep counting up past zero — knowing you've been resting 4:20 is useful information.
    const over = Math.abs(Math.floor(remaining / 1000));
    el.time.textContent = `+${format(over)}`;
    el.fill.style.width = '0%';
    if (!el.bar.classList.contains('done')) {
      el.bar.classList.add('done');
      alert_();
    }
    return;
  }

  el.time.textContent = format(Math.ceil(remaining / 1000));
  el.fill.style.width = `${Math.max(0, (remaining / totalMs) * 100)}%`;
}

function format(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Fires when rest is up. Vibration is the primary signal — the phone is usually in a pocket or
 * face-down on a bench, so a visual cue alone is useless. The tone is a fallback for iOS, where
 * the Vibration API is unavailable in Safari.
 */
function alert_() {
  if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
  beep();
}

function beep() {
  try {
    // Lazily constructed: creating an AudioContext before a user gesture gets it suspended.
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();

    const now = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, now);
    // Ramp rather than a hard stop — an abrupt cut produces an audible click.
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.45);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.5);
  } catch {
    /* Audio is a nice-to-have; the vibration and visual state already fired. */
  }
}

/** Keeps the screen awake during rest so you're not unlocking the phone between every set. */
async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || !isRunning()) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch {
    /* Denied or unsupported — not worth surfacing. */
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
}
