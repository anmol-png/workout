/**
 * ui.js — shared chrome: bottom sheets and toasts.
 *
 * Kept separate from the views so every view opens a sheet the same way and there's exactly one
 * place that manages focus, scroll-locking and dismissal.
 */

let sheetEl, backdropEl, toastEl, toastTimer, lastFocus;

export function initUI() {
  sheetEl = document.getElementById('sheet');
  backdropEl = document.getElementById('sheet-backdrop');
  toastEl = document.getElementById('toast');

  backdropEl.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheetEl.hidden) closeSheet();
  });

  // today.js closes the sheet from inside a click handler it defined itself.
  window.__closeSheet = closeSheet;
}

/**
 * @param {string} html      sheet body
 * @param {(el:HTMLElement)=>void} [onMount]  wire up controls after insertion
 */
export function openSheet(html, onMount) {
  lastFocus = document.activeElement;
  // The grab handle used to be decoration only, which promised a swipe gesture that did nothing
  // and left no visible way out. Now: an explicit ×, a tappable handle, and drag-to-dismiss.
  sheetEl.innerHTML = `
    <div class="sheet-chrome">
      <button class="sheet-grab" aria-label="Close"></button>
      <button class="sheet-close" aria-label="Close">&times;</button>
    </div>
    <div class="sheet">${html}</div>`;
  sheetEl.hidden = false;
  sheetEl.style.transform = '';
  backdropEl.hidden = false;
  document.body.style.overflow = 'hidden';

  sheetEl.querySelector('.sheet-close').addEventListener('click', closeSheet);
  sheetEl.querySelector('.sheet-grab').addEventListener('click', closeSheet);
  attachDragToDismiss(sheetEl.querySelector('.sheet-chrome'));

  if (onMount) onMount(sheetEl);
  // Move focus in so screen readers and keyboards land inside the dialog, not behind it.
  (sheetEl.querySelector('.sheet input, .sheet button') || sheetEl).focus?.();
}

/**
 * Drag down from the handle to dismiss.
 *
 * Bound to the chrome strip only, never the body — the sheet scrolls, and a drag handler on the
 * whole surface would fight with scrolling on every session that's taller than the screen.
 */
function attachDragToDismiss(handle) {
  let startY = null;

  const onMove = (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    sheetEl.style.transition = 'none';
    sheetEl.style.transform = `translateY(${dy}px)`;
    backdropEl.style.opacity = String(Math.max(0.2, 1 - dy / 400));
  };

  const onUp = (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    startY = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    sheetEl.style.transition = 'transform .18s ease';
    backdropEl.style.opacity = '';
    if (dy > 90) closeSheet();
    else sheetEl.style.transform = '';
  };

  handle.addEventListener('pointerdown', (e) => {
    startY = e.clientY;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

export function closeSheet() {
  sheetEl.hidden = true;
  sheetEl.innerHTML = '';
  sheetEl.style.transform = '';
  sheetEl.style.transition = '';
  backdropEl.hidden = true;
  backdropEl.style.opacity = '';
  document.body.style.overflow = '';
  lastFocus?.focus?.();
}

export function toast(message, variant = '') {
  clearTimeout(toastTimer);
  toastEl.textContent = message;
  toastEl.className = variant;
  toastEl.hidden = false;
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, variant === 'pr' ? 3200 : 1900);
}

/** Single escaping helper for every view — all of them build HTML strings. */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function confirmSheet(title, body, confirmLabel, onConfirm) {
  openSheet(`
    <h2>${title}</h2>
    <p class="sheet-sub">${body}</p>
    <button class="btn full danger mb" data-confirm>${confirmLabel}</button>
    <button class="btn full ghost" data-cancel>Cancel</button>
  `, (el) => {
    el.querySelector('[data-confirm]').addEventListener('click', () => { closeSheet(); onConfirm(); });
    el.querySelector('[data-cancel]').addEventListener('click', closeSheet);
  });
}
