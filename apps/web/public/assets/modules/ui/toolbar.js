/**
 * @module ui/toolbar
 * Toolbar button state management, click/pointer handlers,
 * and color-picker bindings.
 */
import ctx from '../core/context.js';
import { closestFromEventTarget } from '../core/dom-utils.js';
import {
  saveEditorRange,
  restoreEditorSelection,
} from '../services/selection.js';
import {
  isSelectionInsideListTag,
  syncPendingPostCommandCaret,
} from '../editor/blocks.js';
import {
  isInlineSelectionFullyFormatted,
} from '../editor/inline-format.js';
import {
  applyColorCommand,
  clearColorFormatting,
} from '../editor/commands.js';

// ── State ───────────────────────────────────────────────────────

/** Update active/inactive state of all toolbar buttons. */
export function updateToolbarState() {
  if (!ctx.editorToolbar) return;
  const buttons = ctx.editorToolbar.querySelectorAll('[data-cmd]');
  buttons.forEach((btn) => {
    const cmd = btn.getAttribute('data-cmd') || '';
    if (!cmd) return;
    let active = false;
    try {
      if (cmd === 'insertUnorderedList') {
        active = isSelectionInsideListTag('ul');
      } else if (cmd === 'insertOrderedList') {
        active = isSelectionInsideListTag('ol');
      } else if (['bold','italic','underline'].includes(cmd)) {
        active = isInlineSelectionFullyFormatted(cmd);
      }
    } catch (e) {}
    btn.classList.toggle('is-active', active);
  });
}

// ── Button actions ──────────────────────────────────────────────

/** Normalize a raw link input value, prepending https:// if needed. */
function normalizeLinkInput(raw) {
  let value = (raw || '').trim();
  if (!value) return '';
  if (!/^(https?:|mailto:|tel:|#)/i.test(value)) {
    value = 'https://' + value;
  }
  return value;
}

/**
 * Trigger the action for a toolbar button (async for link modal).
 * @param {Element} btn - The toolbar button element.
 */
async function triggerToolbarButton(btn) {
  if (!btn || ctx.expiredShown) return;
  const action = btn.getAttribute('data-action') || '';
  if (action === 'clearColors') {
    clearColorFormatting();
    return;
  }

  const cmd = btn.getAttribute('data-cmd') || '';
  if (!cmd) return;
  if (cmd === 'createLink') {
    const savedSelection = {
      start: Number.isFinite(ctx.lastEditorSelection.start) ? ctx.lastEditorSelection.start : 0,
      end: Number.isFinite(ctx.lastEditorSelection.end) ? ctx.lastEditorSelection.end : 0
    };
    const rawValue = await ctx.openLinkModal('https://');
    const href = normalizeLinkInput(rawValue || '');
    if (!href) {
      try {
        ctx.editor.focus();
        restoreEditorSelection(savedSelection.start, savedSelection.end);
        saveEditorRange();
        updateToolbarState();
      } catch (e) {}
      return;
    }
    try {
      ctx.editor.focus();
      restoreEditorSelection(savedSelection.start, savedSelection.end);
      saveEditorRange();
    } catch (e) {}
    ctx.runEditorCommand('createLink', href);
    return;
  }
  ctx.runEditorCommand(cmd, null);
}

/** Preserve editor selection when interacting with toolbar buttons. */
function preserveToolbarSelection(evt) {
  const btn = closestFromEventTarget(evt.target, 'button[data-cmd],button[data-action]');
  if (!btn) return;
  evt.preventDefault();
  saveEditorRange();
}

// ── Color picker ────────────────────────────────────────────────

/** Bind a color input to its corresponding color command. */
export function bindColorPicker(picker, cmd) {
  if (!picker) return;
  const rememberSelection = () => { saveEditorRange(); };
  const wrapLabel = picker.closest('label');
  wrapLabel?.addEventListener('pointerdown', rememberSelection);
  wrapLabel?.addEventListener('mousedown', rememberSelection);
  wrapLabel?.addEventListener('click', (evt) => {
    if (evt.target === picker) return;
    evt.preventDefault();
    rememberSelection();
    try {
      if (typeof picker.showPicker === 'function') {
        picker.showPicker();
        return;
      }
    } catch (e) {}
    picker.click();
  });
  picker.addEventListener('mousedown', rememberSelection);
  picker.addEventListener('pointerdown', rememberSelection);
  picker.addEventListener('focus', rememberSelection);
  picker.addEventListener('click', rememberSelection);
  const onColorPick = () => {
    applyColorCommand(cmd, picker.value);
  };
  picker.addEventListener('input', onColorPick);
  picker.addEventListener('change', onColorPick);
}

/** Attach toolbar event listeners. */
export function initToolbar() {
  ctx.updateToolbarState = updateToolbarState;

  ctx.editorToolbar?.addEventListener('click', (evt) => {
    const btn = closestFromEventTarget(evt.target, 'button[data-cmd],button[data-action]');
    if (!btn || ctx.expiredShown) return;
    evt.preventDefault();
    syncPendingPostCommandCaret();
    void triggerToolbarButton(btn);
  });

  ctx.editorToolbar?.addEventListener('pointerdown', (evt) => {
    const btn = closestFromEventTarget(evt.target, 'button[data-cmd],button[data-action]');
    if (!btn || ctx.expiredShown) return;
    preserveToolbarSelection(evt);
  });
  ctx.editorToolbar?.addEventListener('mousedown', preserveToolbarSelection);
}
