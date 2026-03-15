/**
 * @module editor/commands
 * Central command dispatcher: routes toolbar actions to the correct
 * formatting / block / list / alignment handlers and manages
 * editor state before and after each command.
 */
import ctx, { now } from '../core/context.js';
import { pendingCaretAttr } from '../core/constants.js';
import {
  extractManagedFormattingFromElement,
  applyFormattingToElement,
} from '../core/formatting.js';
import { ensureNodeHasEditableContent } from '../core/dom-utils.js';
import { sanitizeEditorHtml } from '../services/sanitizer.js';
import {
  getCurrentSelectionRange,
  getEditorStoredContent,
  getEditorSelectionOffsets,
  getSelectionBlockElement,
  getSelectionHostElement,
  saveEditorRange,
  restoreEditorRange,
  fixEditorLevelCaret,
  editorNeedsInputNormalization,
} from '../services/selection.js';
import {
  pushUndoSnapshot,
  commandUndo,
  commandRedo,
  trackHistoryFromInput,
} from '../services/history.js';
import {
  syncPendingPostCommandCaret,
  getPendingPostCommandCaretNode,
  collapseCurrentSelectionToEnd,
  applyAlignFallback,
  applyListFallback,
  applyHorizontalRuleFallback,
} from './blocks.js';
import {
  toggleInlineFormatCommand,
  applyColorFallback,
  normalizeEditorMarkupPreserveSelection,
  restoreSavedSelectionIfNeeded,
} from './inline-format.js';

// ── In-place cleanup ────────────────────────────────────────────

/** Remove empty inline wrappers and ensure blocks have editable content. */
export function cleanupEditorMarkupInPlace(options = {}) {
  const preservePendingCaret = !!options.preservePendingCaret;
  const pendingTarget = preservePendingCaret ? getPendingPostCommandCaretNode() : null;

  ctx.editor.querySelectorAll('strong,em,u,s,span,a').forEach((el) => {
    if (!(el instanceof Element)) return;
    if (preservePendingCaret && el.getAttribute('data-mz-placeholder') === '1') return;
    if (el.hasAttribute('data-mz-caret-format')) return;
    const text = ((el.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const hasMeaningfulChild = Array.from(el.children || []).some((child) => {
      const tag = ((child.tagName || '') + '').toLowerCase();
      if (!tag || tag === 'br') return false;
      if (preservePendingCaret && child.getAttribute && child.getAttribute('data-mz-placeholder') === '1') return true;
      return true;
    });
    if (!text && !hasMeaningfulChild) el.remove();
  });

  ctx.editor.querySelectorAll('p,div,h1,h2,h3,blockquote,li').forEach((node) => {
    if (!(node instanceof Element)) return;
    if (preservePendingCaret && node === pendingTarget) {
      node.setAttribute(pendingCaretAttr, '1');
      const placeholder = node.querySelector('[data-mz-placeholder="1"]');
      if (!placeholder) {
        node.innerHTML = '';
        const nextPlaceholder = document.createElement('span');
        nextPlaceholder.setAttribute('data-mz-placeholder', '1');
        nextPlaceholder.textContent = '\u200B';
        node.appendChild(nextPlaceholder);
      }
      return;
    }
    ensureNodeHasEditableContent(node);
  });
}

// ── Commit / finalize ───────────────────────────────────────────

/**
 * Commit editor DOM changes without triggering a synthetic input event.
 * Used for commands like insertHorizontalRule that need special caret handling.
 */
export function commitEditorMutationWithoutSyntheticInput(options = {}) {
  const preservePendingCaret = !!options.preservePendingCaret;
  const normalized = sanitizeEditorHtml(ctx.editor.innerHTML || '');
  if (!normalized) ctx.editor.innerHTML = '';

  try {
    ctx.editor.focus();
    if (preservePendingCaret) {
      syncPendingPostCommandCaret();
    } else {
      restoreEditorRange();
    }
  } catch (e) {}

  cleanupEditorMarkupInPlace({ preservePendingCaret });

  if (!preservePendingCaret && editorNeedsInputNormalization()) {
    normalizeEditorMarkupPreserveSelection(getEditorSelectionOffsets());
  }

  trackHistoryFromInput();
  ctx.renderLineNumbers();

  ctx.lastInputTs = now();
  const current = getEditorStoredContent();
  if (!current) ctx.editor.innerHTML = '';

  if (ctx.crdtEnabled && ctx.ytext) {
    ctx.syncYTextFromEditorHtml(current);
    ctx.scheduleAwarenessSend();
  } else if (ctx.SPACE_ID_OK && !ctx.crdtEnabled) {
    ctx.queueSave();
    ctx.renderAwareness();
  } else {
    ctx.updateToolbarState();
  }

  stabilizeEditorSelectionAfterCommand({ preservePendingCaret });
}

/** Stabilize selection and toolbar state after a command completes. */
export function stabilizeEditorSelectionAfterCommand(options = {}) {
  const preservePendingCaret = !!options.preservePendingCaret;
  try {
    if (preservePendingCaret && syncPendingPostCommandCaret()) {
      ctx.editor.focus();
      saveEditorRange();
      ctx.updateToolbarState();
      return;
    }
    if (document.activeElement !== ctx.editor) {
      ctx.editor.focus();
    }
    restoreEditorRange();
    saveEditorRange();
    ctx.updateToolbarState();
  } catch (e) {}
}

/**
 * Standard finalize after a formatting command:
 * sanitize, restore selection, optionally emit input event.
 */
export function finalizeEditorCommand(emitInputEvent = true) {
  const normalized = sanitizeEditorHtml(ctx.editor.innerHTML || '');
  if (!normalized) ctx.editor.innerHTML = '';
  saveEditorRange();
  try {
    ctx.editor.focus();
    restoreEditorRange();
  } catch (e) {}
  if (emitInputEvent) {
    ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
  stabilizeEditorSelectionAfterCommand();
}

/** Prepare the editor for a command: focus, restore selection, normalize. */
export function focusEditorForCommand() {
  ctx.editor.focus();
  if (!restoreEditorRange()) {
    const range = document.createRange();
    range.selectNodeContents(ctx.editor);
    range.collapse(false);
    const sel = window.getSelection && window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }
  const curSel = window.getSelection && window.getSelection();
  const curNode = curSel && curSel.rangeCount ? curSel.getRangeAt(0).startContainer : null;
  ctx.editor.querySelectorAll('[data-mz-caret-format]').forEach((el) => {
    if (curNode && (el === curNode || el.contains(curNode))) return;
    el.remove();
  });
  fixEditorLevelCaret();
  if (editorNeedsInputNormalization()) {
    normalizeEditorMarkupPreserveSelection();
  }
}

// ── Main command dispatcher ─────────────────────────────────────

/**
 * Execute an editor command by name.
 * @param {string} cmd - Command name (bold, italic, underline, insertUnorderedList, etc.)
 * @param {string|null} value - Optional value (e.g. URL for createLink)
 */
export function runEditorCommand(cmd, value) {
  if (ctx.expiredShown) return;
  focusEditorForCommand();
  if (cmd === 'undo') {
    commandUndo();
    return;
  }
  if (cmd === 'redo') {
    commandRedo();
    return;
  }
  pushUndoSnapshot(getEditorStoredContent());
  if (cmd === 'bold') {
    const fallbackUsed = toggleInlineFormatCommand('bold', { fontWeight: '800' });
    if (fallbackUsed) { finalizeEditorCommand(true); }
    else { saveEditorRange(); ctx.updateToolbarState(); }
    return;
  }
  if (cmd === 'italic') {
    const fallbackUsed = toggleInlineFormatCommand('italic', { fontStyle: 'italic' });
    if (fallbackUsed) { finalizeEditorCommand(true); }
    else { saveEditorRange(); ctx.updateToolbarState(); }
    return;
  }
  if (cmd === 'underline') {
    const fallbackUsed = toggleInlineFormatCommand('underline', { textDecoration: 'underline' });
    if (fallbackUsed) { finalizeEditorCommand(true); }
    else { saveEditorRange(); ctx.updateToolbarState(); }
    return;
  }
  if (cmd === 'insertUnorderedList') {
    applyListFallback('ul');
    collapseCurrentSelectionToEnd();
    finalizeEditorCommand(true);
    return;
  }
  if (cmd === 'insertOrderedList') {
    applyListFallback('ol');
    collapseCurrentSelectionToEnd();
    finalizeEditorCommand(true);
    return;
  }
  if (cmd === 'insertHorizontalRule') {
    applyHorizontalRuleFallback();
    commitEditorMutationWithoutSyntheticInput({ preservePendingCaret: true });
    return;
  }
  if (['justifyLeft','justifyCenter','justifyRight','justifyFull'].includes(cmd)) {
    applyAlignFallback(cmd);
    finalizeEditorCommand(true);
    return;
  }
  if (cmd === 'createLink' && value) {
    try { document.execCommand('createLink', false, value); } catch (e) {}
    finalizeEditorCommand();
    return;
  }
  finalizeEditorCommand();
}

/** Apply a foreground/background color command. */
export function applyColorCommand(cmd, color) {
  if (!color || ctx.expiredShown) return;
  const kind = (cmd === 'hiliteColor' || cmd === 'backColor') ? 'bg' : 'fg';
  pushUndoSnapshot(getEditorStoredContent());
  focusEditorForCommand();
  restoreSavedSelectionIfNeeded(false);
  applyColorFallback(kind, color, true);
  try {
    const sel = window.getSelection && window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const collapsed = sel.getRangeAt(0).cloneRange();
      collapsed.collapse(false);
      sel.removeAllRanges();
      sel.addRange(collapsed);
    }
  } catch (e) {}
  finalizeEditorCommand();
}

/** Clear all color formatting from the selection. */
export function clearColorFormatting() {
  pushUndoSnapshot(getEditorStoredContent());
  focusEditorForCommand();
  const range = restoreSavedSelectionIfNeeded(false) || getCurrentSelectionRange();
  const touched = new Set();
  const host = getSelectionHostElement() || getSelectionBlockElement();
  if (host) touched.add(host);
  if (!range || range.collapsed) {
    const block = getSelectionBlockElement();
    if (block && block.querySelectorAll) {
      block.querySelectorAll('[data-mz-fg],[data-mz-bg]').forEach((el) => touched.add(el));
    }
    let cur = host;
    while (cur && cur !== ctx.editor) {
      if (cur instanceof Element) touched.add(cur);
      cur = cur.parentElement;
    }
  } else {
    ctx.editor.querySelectorAll('[data-mz-fg],[data-mz-bg]').forEach((el) => {
      try {
        if (!range.intersectsNode(el)) return;
      } catch (e) {
        return;
      }
      touched.add(el);
    });
  }
  touched.forEach((el) => {
    const next = extractManagedFormattingFromElement(el);
    delete next.fg;
    delete next.bg;
    applyFormattingToElement(el, next);
  });
  finalizeEditorCommand();
}

/** Register on ctx for cross-module access. */
export function initCommands() {
  ctx.runEditorCommand = runEditorCommand;
}
