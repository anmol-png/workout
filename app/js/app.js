/**
 * app.js — router and boot.
 *
 * Hash routing, not the History API, deliberately: this is served from a GitHub Pages subpath
 * with no server-side rewrite, so a real path like /stats would 404 on refresh. Hash routes
 * always resolve to index.html.
 */

import { initUI, toast } from './ui.js';
import { setWeightFormatter, setIncrementResolver } from './progression.js';
import * as U from './units.js';
import { initTimer } from './timer.js';
import * as today from './views/today.js';
import * as history from './views/history.js';
import * as stats from './views/stats.js';
import * as nutrition from './views/nutrition.js';
import * as settings from './views/settings.js';

const VIEWS = { today, history, stats, nutrition, settings };
const DEFAULT = 'today';

let current = DEFAULT;

function routeName() {
  const raw = location.hash.replace(/^#\/?/, '').split('/')[0];
  return VIEWS[raw] ? raw : DEFAULT;
}

function render() {
  current = routeName();
  const view = VIEWS[current];
  const root = document.getElementById('view');

  document.getElementById('view-title').textContent = view.title();
  document.getElementById('view-sub').textContent = view.subtitle();

  for (const tab of document.querySelectorAll('#tabbar a')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === current));
  }

  try {
    view.render(root);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="empty">
      <p>Something went wrong rendering this screen.</p>
      <p class="small mt">Your data is safe — it's stored separately. Try another tab, or export a
      backup from <b>Me</b>.</p>
      <pre class="xs dim" style="text-align:left;white-space:pre-wrap;margin-top:16px">${String(err.message || err)}</pre>
    </div>`;
  }
}

function boot() {
  initUI();
  initTimer();

  // progression.js stays unit-agnostic and computes in kg; give it the display formatter so its
  // hint strings ("up 5.5 lb, back to 5 reps") read in whatever unit the user has selected.
  setWeightFormatter((kg, ex) => U.w(kg, ex?.id));
  setIncrementResolver((ex) => U.incrementKg(ex));

  window.addEventListener('hashchange', () => {
    render();
    document.getElementById('view').scrollIntoView({ block: 'start' });
    window.scrollTo(0, 0);
  });

  // Views ask for a re-render after mutating state rather than doing it themselves, so there's
  // one render path and no chance of two views fighting over the DOM.
  window.addEventListener('view:rerender', render);

  window.addEventListener('store:error', () => {
    toast('Could not save — device storage may be full');
  });

  document.getElementById('boot').remove();
  document.getElementById('app').hidden = false;
  render();

  registerServiceWorker();
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  // file:// has no SW support and would throw a confusing error.
  if (location.protocol === 'file:') return;
  try {
    // Relative path: registers with a scope of this directory, which is what a project Pages
    // site needs. An absolute '/sw.js' would 404 under /workout/app/.
    const reg = await navigator.serviceWorker.register('sw.js');

    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      sw?.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          // Tappable rather than auto-reloading: a reload mid-set is jarring, and every keystroke
          // is already persisted, so there is nothing to rescue by forcing it.
          toast('New version ready — tap to update', '', () => location.reload());
        }
      });
    });

    // A phone keeps the app alive for days. Without this, an update is only ever noticed on a
    // cold start — check whenever it comes back to the foreground.
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) reg.update().catch(() => {});
    });
  } catch (err) {
    console.warn('Service worker registration failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
