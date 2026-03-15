/**
 * @module ui/status
 * Connection status indicators, presence display,
 * space expiry handling, title visibility, and
 * editor content ↔ cursor management.
 */
import ctx, { t, now } from '../core/context.js';
import { sanitizeEditorHtml } from '../services/sanitizer.js';
import { storedContentToHtml } from '../services/sanitizer.js';
import { htmlToPlainText } from '../core/dom-utils.js';
import {
  getEditorStoredContent,
  getEditorPlainText,
  getEditorSelectionOffsets,
  restoreEditorSelection,
  isEditorFocused,
  setEditorEditable,
} from '../services/selection.js';

// ── Status dot ──────────────────────────────────────────────────

/** Set the visual state of the connection status dot. */
export function setStatusDot(state) {
  if (!ctx.status) return;
  ctx.status.classList.remove('status-dot--ok', 'status-dot--warn', 'status-dot--err');
  if (state === 'ok') ctx.status.classList.add('status-dot--ok');
  else if (state === 'warn') ctx.status.classList.add('status-dot--warn');
  else if (state === 'err') ctx.status.classList.add('status-dot--err');
  const label = state === 'ok' ? t('status.connected') : state === 'warn' ? t('status.reconnecting') : t('status.disconnected');
  ctx.status.setAttribute('title', label);
  ctx.status.setAttribute('aria-label', label);
}

/** Set the status text and visual tone (default/warning/danger). */
export function setStatusText(text, tone = 'default') {
  if (!ctx.status) return;
  if (tone === 'danger') setStatusDot('err');
  else if (tone === 'warning') setStatusDot('warn');
  else setStatusDot('ok');
}

/** Show a sync warning (non-fatal, yellow dot). */
export function setSyncWarning(text) {
  if (ctx.expiredShown) return;
  setStatusText(text, 'warning');
}

/** Clear the sync warning if no longer active. */
export function clearSyncWarning() {
  if (!ctx.status || ctx.expiredShown) return;
  const activeSyncStates = new Set([
    t('status.syncing'),
    t('status.connecting'),
    t('status.reconnecting')
  ]);
  if (!activeSyncStates.has(ctx.status.textContent || '')) return;
  setStatusText(t('status.connected'));
}

// ── Presence ────────────────────────────────────────────────────

/** @returns {string} Human-readable presence text for a count. */
export function presenceText(count) {
  return count === 1 ? t('presence.one') : t('presence.many', { count });
}

// ── Title ───────────────────────────────────────────────────────

/** Show or hide the title row depending on whether a title exists. */
export function updateTitleVisibility() {
  const label = document.getElementById('titleLabel');
  const hasTitle = ctx.titleView && ctx.titleView.textContent.trim();
  if (ctx.titleView) ctx.titleView.hidden = !hasTitle;
  if (label) label.hidden = !hasTitle;
}

// ── Expired ─────────────────────────────────────────────────────

/** Display the expired-space UI: disable editor, show banner. */
export function showExpired() {
  if (ctx.expiredShown) return;
  ctx.expiredShown = true;
  try { window.__MZ_EXPIRED__ = true; } catch (e) {}
  const banner = document.getElementById('expiredNotice');
  if (banner) banner.hidden = false;
  if (ctx.status) {
    setStatusText(t('status.expired'), 'danger');
  }
  try { if (ctx.titleView) ctx.titleView.textContent = ''; updateTitleVisibility(); } catch (e) {}
  try {
    setEditorEditable(false);
    setEditorWithCursor('');
  } catch (e) {}
  try { if (ctx.pollTimer) clearInterval(ctx.pollTimer); } catch (e) {}
  try { if (ctx.pullTimer) clearInterval(ctx.pullTimer); } catch (e) {}
  try { if (ctx.fullTimer) clearInterval(ctx.fullTimer); } catch (e) {}
  try { if (ctx.awarenessPruneTimer) clearInterval(ctx.awarenessPruneTimer); } catch (e) {}
  try { if (ctx.persistTimer) clearTimeout(ctx.persistTimer); } catch (e) {}
  try { if (ctx.awarenessTimer) clearTimeout(ctx.awarenessTimer); } catch (e) {}
  ctx.closeQrModal();
}

// ── Editor ↔ cursor ─────────────────────────────────────────────

/** @returns {number} Current cursor position as a text offset. */
export function editorCursorIndex() {
  return getEditorSelectionOffsets().start || 0;
}

/**
 * Set the editor content from stored HTML and restore the cursor.
 * Called when receiving remote updates or loading initial content.
 */
export function setEditorWithCursor(stored) {
  const html = storedContentToHtml(stored || '');
  const current = sanitizeEditorHtml(ctx.editor.innerHTML || '');
  if (html === current) {
    ctx.renderLineNumbers();
    ctx.updateToolbarState();
    return;
  }

  const wasFocused = isEditorFocused();
  const { start, end } = wasFocused ? getEditorSelectionOffsets() : { start: 0, end: 0 };
  const scrollTop = ctx.editor.scrollTop || 0;
  ctx.editor.innerHTML = html;
  if (!getEditorPlainText().trim()) ctx.editor.innerHTML = '';
  if (wasFocused) {
    ctx.editor.focus();
    restoreEditorSelection(start, end);
  }
  try {
    const maxScrollTop = Math.max(0, (ctx.editor.scrollHeight || 0) - (ctx.editor.clientHeight || 0));
    const safeScrollTop = Math.max(0, Math.min(scrollTop || 0, maxScrollTop));
    ctx.editor.scrollTop = safeScrollTop;
  } catch (e) {}
  if (!ctx.applyingCommandHistory) {
    ctx.lastKnownStoredForHistory = getEditorStoredContent();
  }
  ctx.renderLineNumbers();
  ctx.updateToolbarState();
}

// ── Registration ────────────────────────────────────────────────

/** Register status functions on ctx for cross-module access. */
export function initStatus() {
  ctx.setStatusDot = setStatusDot;
  ctx.setStatusText = setStatusText;
  ctx.setSyncWarning = setSyncWarning;
  ctx.clearSyncWarning = clearSyncWarning;
  ctx.showExpired = showExpired;
  ctx.updateTitleVisibility = updateTitleVisibility;
  ctx.setEditorWithCursor = setEditorWithCursor;
  ctx.markCollabReady = (state = 'ready') => {
    try {
      window.__MZ_COLLAB_READY__ = state === 'ready';
      window.__MZ_COLLAB_READY_STATE__ = state;
    } catch (e) {}
  };
  try {
    window.__MZ_COLLAB_READY__ = false;
    window.__MZ_COLLAB_READY_STATE__ = 'pending';
    window.__MZ_onExpired__ = showExpired;
  } catch (e) {}
}
