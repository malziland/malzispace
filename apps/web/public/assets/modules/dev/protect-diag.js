/**
 * @module dev/protect-diag
 * Live diagnostic overlay for the Schutz / Sperre mode. Activated via the
 * `?diag=1` URL query. Shows:
 *   - ctx.isOwner / ctx.appendOnly / ctx.readOnly
 *   - count of `.mz-owner-text` spans currently in the editor
 *   - last beforeinput inputType + the guard decision (wrapped / blocked /
 *     passed / redirected)
 *
 * Pure read-only — never mutates editor state. Safe to keep in production
 * because it requires an explicit query string to render.
 */
import ctx from '../core/context.js';

const OWNER_SELECTOR = '.mz-owner-text';

let panel = null;
let lines = null;
let lastEvent = '—';

function fmtBool(v) {
  if (v === true) return '✓ true';
  if (v === false) return '✗ false';
  return String(v);
}

function refresh() {
  if (!panel || !ctx.editor) return;
  const ownerCount = ctx.editor.querySelectorAll(OWNER_SELECTOR).length;
  const editable = ctx.editor.getAttribute('contenteditable') === 'true';
  lines.innerHTML = [
    `<div>isOwner:    <b>${fmtBool(ctx.isOwner)}</b></div>`,
    `<div>appendOnly: <b>${fmtBool(ctx.appendOnly)}</b></div>`,
    `<div>readOnly:   <b>${fmtBool(ctx.readOnly)}</b></div>`,
    `<div>editable:   <b>${fmtBool(editable)}</b></div>`,
    `<div>owner spans: <b>${ownerCount}</b></div>`,
    `<div style="margin-top:6px;border-top:1px solid #444;padding-top:6px">last input:<br><code>${lastEvent}</code></div>`
  ].join('');
}

/**
 * Logger that protect-guard / clipboard can call to record the guard's
 * latest decision. Falls back to a no-op when the diagnostic panel is not
 * mounted (i.e. when ?diag=1 is not in the URL).
 */
export function logGuardEvent(label) {
  lastEvent = `${new Date().toLocaleTimeString()} — ${label}`;
  refresh();
}

export function initProtectDiag() {
  const params = new URLSearchParams(window.location.search || '');
  if (params.get('diag') !== '1') return;

  panel = document.createElement('div');
  panel.id = 'protect-diag-panel';
  panel.style.cssText = [
    'position:fixed', 'top:8px', 'right:8px', 'z-index:99999',
    'background:rgba(20,20,20,.92)', 'color:#f5f5f5',
    'font:12px/1.45 -apple-system,Menlo,monospace',
    'padding:10px 12px', 'border-radius:8px',
    'border:1px solid #333', 'min-width:200px',
    'box-shadow:0 4px 18px rgba(0,0,0,.4)'
  ].join(';');
  const header = document.createElement('div');
  header.textContent = 'Schutz-Diag';
  header.style.cssText = 'font-weight:700;margin-bottom:6px;color:#f5a623';
  panel.appendChild(header);
  lines = document.createElement('div');
  panel.appendChild(lines);
  document.body.appendChild(panel);
  ctx.logGuardEvent = logGuardEvent;
  refresh();
  // Refresh every 500ms to catch state changes from network events.
  setInterval(refresh, 500);
  // Also refresh on editor input.
  if (ctx.editor) ctx.editor.addEventListener('input', refresh);
}
