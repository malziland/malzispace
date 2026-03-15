/**
 * @module editor/keyboard
 * Keyboard event handlers: formatting shortcuts (Ctrl+B/I/U/Z/Y),
 * Backspace/Delete near horizontal rules, pending-caret interaction,
 * and caret-format placeholder cleanup.
 */
import ctx, { now } from '../core/context.js';
import { blockTags } from '../core/constants.js';
import {
  saveEditorRange,
  editorNeedsInputNormalization,
} from '../services/selection.js';
import { trackHistoryFromInput } from '../services/history.js';
import {
  topLevelEditorNode,
  moveCaretToNodeStart,
  moveCaretToNodeEnd,
  clearEditablePlaceholder,
  selectEditablePlaceholder,
  getPendingPostCommandCaretNode,
  flushPendingPostCommandCaret,
  insertTextAtCurrentSelection,
} from './blocks.js';
import { normalizeEditorMarkupPreserveSelection } from './inline-format.js';
import { renderLineNumbers } from './line-numbers.js';

// ── Backspace/Delete near <hr> ──────────────────────────────────

function handleBackspaceDeleteNearHr(evt) {
  if (ctx.expiredShown) return;
  if (evt.metaKey || evt.ctrlKey || evt.altKey || evt.shiftKey) return;
  const isBackspace = evt.key === 'Backspace';
  const isDelete = evt.key === 'Delete';
  if (!isBackspace && !isDelete) return;

  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!range.collapsed) return;

  const block = topLevelEditorNode(range.startContainer);
  if (!block || block.parentNode !== ctx.editor) return;

  const isBlockEmpty = (node) => {
    if (!node || !(node instanceof Element)) return false;
    const tag = (node.tagName || '').toLowerCase();
    if (!blockTags.has(tag)) return false;
    const text = ((node.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    return !text && !node.querySelector('img,hr,video,audio,canvas,svg,object,embed');
  };

  const blockEmpty = isBlockEmpty(block);

  const caretAtBlockStart = () => {
    if (blockEmpty) return true;
    if (range.startOffset !== 0) return false;
    if (range.startContainer === block) return true;
    let cur = range.startContainer;
    while (cur && cur !== block) {
      if (cur.previousSibling) return false;
      cur = cur.parentNode;
    }
    return true;
  };

  const caretAtBlockEnd = () => {
    if (blockEmpty) return true;
    const c = range.startContainer;
    if (c.nodeType === Node.TEXT_NODE) {
      if (range.startOffset < (c.nodeValue || '').length) return false;
      let cur = c;
      while (cur && cur !== block) {
        if (cur.nextSibling) return false;
        cur = cur.parentNode;
      }
      return true;
    }
    if (c === block) return range.startOffset >= block.childNodes.length;
    return false;
  };

  if (isBackspace) {
    const prev = block.previousElementSibling;
    if (!prev || (prev.tagName || '').toLowerCase() !== 'hr') return;
    if (!caretAtBlockStart()) return;
    evt.preventDefault();

    if (blockEmpty) {
      const target = prev.previousElementSibling;
      block.remove();
      if (target && blockTags.has((target.tagName || '').toLowerCase())) {
        moveCaretToNodeEnd(target);
      } else {
        const after = prev.nextElementSibling;
        prev.remove();
        if (after) moveCaretToNodeStart(after);
      }
    } else {
      const target = prev.previousElementSibling;
      prev.remove();
      if (target && blockTags.has((target.tagName || '').toLowerCase())) {
        while (block.firstChild) target.appendChild(block.firstChild);
        block.remove();
        moveCaretToNodeEnd(target);
      }
    }
    saveEditorRange();
    ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  if (isDelete) {
    const next = block.nextElementSibling;
    if (!next || (next.tagName || '').toLowerCase() !== 'hr') return;
    if (!caretAtBlockEnd()) return;
    evt.preventDefault();

    const afterHr = next.nextElementSibling;
    if (blockEmpty) {
      block.remove();
      if (afterHr && blockTags.has((afterHr.tagName || '').toLowerCase())) {
        moveCaretToNodeStart(afterHr);
      } else {
        const before = next.previousElementSibling;
        next.remove();
        if (before) moveCaretToNodeEnd(before);
      }
    } else {
      next.remove();
      if (afterHr && blockTags.has((afterHr.tagName || '').toLowerCase())) {
        while (afterHr.firstChild) block.appendChild(afterHr.firstChild);
        afterHr.remove();
      }
    }
    saveEditorRange();
    ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

// ── Keyboard shortcuts ──────────────────────────────────────────

function handleKeyboardShortcuts(evt) {
  if (ctx.expiredShown) return;
  const mod = evt.metaKey || evt.ctrlKey;
  if (!mod) return;
  const key = (evt.key || '').toLowerCase();
  if (key === 'b') {
    evt.preventDefault();
    ctx.runEditorCommand('bold');
    return;
  }
  if (key === 'i') {
    evt.preventDefault();
    ctx.runEditorCommand('italic');
    return;
  }
  if (key === 'u') {
    evt.preventDefault();
    ctx.runEditorCommand('underline');
    return;
  }
  if (key === 'z' && !evt.shiftKey) {
    evt.preventDefault();
    ctx.runEditorCommand('undo');
    return;
  }
  if ((key === 'y') || (key === 'z' && evt.shiftKey)) {
    evt.preventDefault();
    ctx.runEditorCommand('redo');
  }
}

// ── Pending caret keydown ───────────────────────────────────────

function handlePendingCaretKeydown(evt) {
  const pendingTarget = getPendingPostCommandCaretNode();
  if (pendingTarget) {
    if (!(evt.metaKey || evt.ctrlKey || evt.altKey)) {
      if (evt.key === 'Enter') {
        evt.preventDefault();
        selectEditablePlaceholder(pendingTarget);
        pendingTarget.removeAttribute('data-mz-post-command-caret');
        ctx.pendingPostCommandCaretNode = null;
        try {
          document.execCommand('insertParagraph', false, null);
        } catch (e) {}
        saveEditorRange();
        return;
      }
      if (typeof evt.key === 'string' && evt.key.length === 1) {
        evt.preventDefault();
        clearEditablePlaceholder(pendingTarget);
        selectEditablePlaceholder(pendingTarget);
        ctx.pendingPostCommandCaretNode = null;
        if (insertTextAtCurrentSelection(evt.key)) {
          saveEditorRange();
          ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
        }
        return;
      }
    }
  }
  flushPendingPostCommandCaret();
}

// ── beforeinput handler ─────────────────────────────────────────

function handleBeforeInput(evt) {
  const pendingTarget = getPendingPostCommandCaretNode();
  if (pendingTarget) {
    const inputType = String(evt.inputType || '');
    if ((inputType === 'insertText' || inputType === 'insertCompositionText') && typeof evt.data === 'string') {
      evt.preventDefault();
      clearEditablePlaceholder(pendingTarget);
      selectEditablePlaceholder(pendingTarget);
      ctx.pendingPostCommandCaretNode = null;
      if (insertTextAtCurrentSelection(evt.data)) {
        saveEditorRange();
        ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
      }
      return;
    }
  }
  flushPendingPostCommandCaret();
}

// ── Input handler (caret-format cleanup) ────────────────────────

function handleEditorInput() {
  let caretFormatNeedsNorm = false;
  ctx.editor.querySelectorAll('[data-mz-caret-format]').forEach((el) => {
    const text = (el.textContent || '').replace(/\u200B/g, '');
    if (text) {
      el.removeAttribute('data-mz-caret-format');
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'span') {
        const parent = el.parentNode;
        if (parent) {
          Array.from(el.childNodes).forEach((child) => {
            if (child.nodeType === Node.TEXT_NODE) {
              child.nodeValue = (child.nodeValue || '').replace(/\u200B/g, '');
            }
          });
          while (el.firstChild) parent.insertBefore(el.firstChild, el);
          el.remove();
        }
      }
      caretFormatNeedsNorm = true;
    }
  });
  if (caretFormatNeedsNorm || editorNeedsInputNormalization()) {
    normalizeEditorMarkupPreserveSelection();
  }
}

/** Attach all keyboard-related event listeners. */
export function initKeyboard() {
  ctx.editor.addEventListener('keydown', handleBackspaceDeleteNearHr);
  ctx.editor.addEventListener('keydown', handleKeyboardShortcuts);
  document.addEventListener('keydown', handlePendingCaretKeydown, true);
  document.addEventListener('beforeinput', handleBeforeInput, true);
  ctx.editor.addEventListener('input', handleEditorInput);
  ctx.editor.addEventListener('input', trackHistoryFromInput);
  ctx.editor.addEventListener('input', renderLineNumbers);
}
