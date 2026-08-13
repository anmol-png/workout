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
  sheetEl.innerHTML = `<div class="sheet-grab"></div><div class="sheet">${html}</div>`;
  sheetEl.hidden = false;
  backdropEl.hidden = false;
  document.body.style.overflow = 'hidden';
  if (onMount) onMount(sheetEl);
  // Move focus in so screen readers and keyboards land inside the dialog, not behind it.
  (sheetEl.querySelector('input, button') || sheetEl).focus?.();
}

export function closeSheet() {
  sheetEl.hidden = true;
  backdropEl.hidden = true;
  sheetEl.innerHTML = '';
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
