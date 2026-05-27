/**
 * @module editor/protect-guard
 * Append-only protection enforcement at the editor level. Two responsibilities:
 *  1. Owner mode: wrap newly-typed text in `.mz-owner-text` so it is visually
 *     marked and persisted into the CRDT as owner-authored content. Merges
 *     aggressively with adjacent owner spans so the highlight stays seamless.
 *  2. Participant mode: block edits that would modify, delete, or displace
 *     owner-marked content. Uses `beforeinput` + `getTargetRanges()` so it
 *     correctly catches Backspace/Delete at element boundaries and works on
 *     mobile (iOS/Android software keyboards) where keydown is unreliable.
 *
 * Protection is gated on `ctx.appendOnly` (set by ui/protect). When the
 * toggle is off, this module is a no-op.
 */
import ctx from '../core/context.js';

const OWNER_TEXT_CLASS = 'mz-owner-text';
const OWNER_SELECTOR = '.' + OWNER_TEXT_CLASS;

// ── Helpers ─────────────────────────────────────────────────────

function isOwnerNode(node) {
  if (!node) return false;
  const el = node.nodeType === 1 ? node : node.parentElement;
  return !!(el && el.closest && el.closest(OWNER_SELECTOR));
}

/** True if the given Range overlaps any owner-marked content. */
function rangeTouchesOwner(range) {
  if (!range || !ctx.editor) return false;
  // Quick check: an ancestor of either endpoint is owner-marked.
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  if (startEl && startEl.closest && startEl.closest(OWNER_SELECTOR)) return true;
  // Walk every owner span and check intersection.
  const owners = ctx.editor.querySelectorAll(OWNER_SELECTOR);
  for (const o of owners) {
    if (range.intersectsNode && range.intersectsNode(o)) return true;
  }
  return false;
}

const BLOCK_TAGS = /^(P|DIV|LI|H[1-6]|BLOCKQUOTE)$/i;

function getContainingBlock(node) {
  let n = node && node.nodeType === 3 ? node.parentElement : node;
  while (n && n !== ctx.editor && !BLOCK_TAGS.test(n.tagName || '')) n = n.parentElement;
  return (n && n !== ctx.editor) ? n : null;
}

/**
 * True if owner-marked content lives in the SAME block as the cursor and
 * comes after the cursor — i.e. typing here would shove that owner content
 * to the right within the same line. Used to gate `insertText`.
 *
 * Allows typing in empty paragraphs that sit between owner-marked blocks,
 * because filling a blank line doesn't displace anything.
 */
/**
 * True if the cursor is inside an owner span AND owner content remains after
 * the cursor within that same span. Used to keep `insertParagraph` from
 * splitting trainer text mid-word, while still allowing Enter at the very
 * end of an owner span (where it creates a new paragraph cleanly).
 */
function cursorInsideOwnerWithContentAfter(range) {
  if (!range || !range.collapsed) return false;
  const node = range.startContainer;
  const el = node && node.nodeType === 3 ? node.parentElement : node;
  const span = el && el.closest ? el.closest(OWNER_SELECTOR) : null;
  if (!span) return false;
  // Build a range from the cursor to the very end of the span.
  let lastDescendant = span;
  while (lastDescendant.lastChild) lastDescendant = lastDescendant.lastChild;
  const tail = document.createRange();
  try {
    tail.setStart(range.startContainer, range.startOffset);
    if (lastDescendant.nodeType === 3) {
      tail.setEnd(lastDescendant, (lastDescendant.textContent || '').length);
    } else {
      tail.setEndAfter(lastDescendant);
    }
  } catch (err) { return false; }
  return (tail.toString() || '').length > 0;
}

function ownerInSameBlockAfterCursor(range) {
  if (!range || !range.collapsed) return false;
  const block = getContainingBlock(range.startContainer);
  if (!block) return false;
  const owners = block.querySelectorAll(OWNER_SELECTOR);
  if (!owners.length) return false;
  for (const o of owners) {
    const cmp = range.compareBoundaryPoints(Range.START_TO_START, (() => {
      const r = document.createRange();
      r.selectNode(o);
      return r;
    })());
    // cursor is BEFORE the owner span's start
    if (cmp <= 0) return true;
  }
  return false;
}

/**
 * True if the first significant content AFTER the collapsed cursor (across
 * block boundaries) is owner-marked. Used to gate paragraph-creating events
 * like Enter, which push everything below down a line.
 */
function nextContentIsOwner(range) {
  if (!range || !range.collapsed) return false;
  const node = range.startContainer;
  const offset = range.startOffset;

  let next = null;
  if (node.nodeType === 3) {
    if (offset < (node.textContent || '').length) return false;
    next = node.nextSibling;
    if (!next) {
      let p = node.parentElement;
      while (p && p !== ctx.editor && !p.nextSibling) p = p.parentElement;
      next = p && p !== ctx.editor ? p.nextSibling : null;
    }
  } else if (node.nodeType === 1) {
    next = node.childNodes[offset] || null;
    if (!next) {
      let p = node;
      while (p && p !== ctx.editor && !p.nextSibling) p = p.parentElement;
      next = p && p !== ctx.editor ? p.nextSibling : null;
    }
  }

  while (next) {
    if (next.classList && next.classList.contains(OWNER_TEXT_CLASS)) return true;
    if (next.nodeType === 3) {
      if ((next.textContent || '').trim()) return false;
    } else if (next.nodeType === 1) {
      const ownerInside = next.querySelector && next.querySelector(OWNER_SELECTOR);
      if (ownerInside) {
        const r = document.createRange();
        r.setStart(next, 0);
        r.setEndBefore(ownerInside);
        if (!r.toString().trim()) return true;
        return false;
      }
      if ((next.textContent || '').trim()) return false;
    }
    next = next.nextSibling;
  }
  return false;
}

function currentRange() {
  const sel = window.getSelection && window.getSelection();
  return sel && sel.rangeCount ? sel.getRangeAt(0) : null;
}

function toast(messageKey) {
  if (typeof ctx.showProtectToast === 'function') ctx.showProtectToast(messageKey);
}

// ── Owner-mode: wrap typed text in `.mz-owner-text` ─────────────

function wrapOwnerInsert(e) {
  if (!ctx.appendOnly || !ctx.isOwner) return false;
  if (e.inputType !== 'insertText' || !e.data) return false;

  const range = currentRange();
  if (!range) return false;

  const node = range.startContainer;
  const parent = node.nodeType === 1 ? node : node.parentElement;
  // Already inside an owner span → let the browser insert normally so the
  // text becomes part of the existing span.
  if (parent && parent.closest && parent.closest(OWNER_SELECTOR)) return false;

  // Find an adjacent owner span to merge into.
  let mergeTarget = null;
  let mergeAt = null;
  if (node.nodeType === 3) {
    if (range.startOffset === (node.textContent || '').length) {
      const next = node.nextSibling;
      if (next && next.classList && next.classList.contains(OWNER_TEXT_CLASS)) {
        mergeTarget = next; mergeAt = 'start';
      }
    }
    if (!mergeTarget && range.startOffset === 0) {
      const prev = node.previousSibling;
      if (prev && prev.classList && prev.classList.contains(OWNER_TEXT_CLASS)) {
        mergeTarget = prev; mergeAt = 'end';
      }
    }
  } else if (node.nodeType === 1) {
    const before = node.childNodes[range.startOffset - 1];
    const after = node.childNodes[range.startOffset];
    if (before && before.classList && before.classList.contains(OWNER_TEXT_CLASS)) {
      mergeTarget = before; mergeAt = 'end';
    } else if (after && after.classList && after.classList.contains(OWNER_TEXT_CLASS)) {
      mergeTarget = after; mergeAt = 'start';
    }
  }

  e.preventDefault();
  range.deleteContents();
  const sel = window.getSelection();

  if (mergeTarget) {
    const newRange = document.createRange();
    if (mergeAt === 'end') {
      mergeTarget.appendChild(document.createTextNode(e.data));
      const last = mergeTarget.lastChild;
      newRange.setStart(last, (last.textContent || '').length);
    } else {
      mergeTarget.insertBefore(document.createTextNode(e.data), mergeTarget.firstChild);
      newRange.setStart(mergeTarget.firstChild, e.data.length);
    }
    newRange.collapse(true);
    sel.removeAllRanges(); sel.addRange(newRange);
  } else {
    const span = document.createElement('span');
    span.className = OWNER_TEXT_CLASS;
    span.textContent = e.data;
    range.insertNode(span);
    // After insertion, fuse with an adjacent owner sibling if one became neighboring.
    if (span.previousSibling && span.previousSibling.classList
        && span.previousSibling.classList.contains(OWNER_TEXT_CLASS)) {
      const prev = span.previousSibling;
      while (span.firstChild) prev.appendChild(span.firstChild);
      span.remove();
      const last = prev.lastChild;
      const newRange = document.createRange();
      newRange.setStart(last, (last.textContent || '').length);
      newRange.collapse(true);
      sel.removeAllRanges(); sel.addRange(newRange);
    } else {
      const newRange = document.createRange();
      newRange.setStartAfter(span);
      newRange.collapse(true);
      sel.removeAllRanges(); sel.addRange(newRange);
    }
  }
  // Manually fire an input event so the existing autosave/CRDT-sync pipeline runs.
  ctx.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: e.data }));
  return true;
}

// ── Participant-mode: block edits that touch or displace owner content ──

function blockIfProtected(e) {
  if (!ctx.appendOnly || ctx.isOwner) return false;
  const it = e.inputType || '';
  const range = currentRange();
  if (!range) return false;

  const isParaCreating = it === 'insertParagraph' || it === 'insertLineBreak';
  const isTextInsert = it === 'insertText' || it === 'insertFromPaste'
    || it === 'insertFromDrop' || it === 'insertReplacementText';
  const isFormat = it.startsWith('format');
  const isDelete = it.startsWith('delete');

  // 1) Deletion / format: block when target ranges (what the browser is about
  // to modify) overlap owner content, or when the cursor itself sits on it.
  if (isDelete || isFormat) {
    const targets = e.getTargetRanges ? e.getTargetRanges() : [];
    for (const sr of targets) {
      const r = document.createRange();
      try {
        r.setStart(sr.startContainer, sr.startOffset);
        r.setEnd(sr.endContainer, sr.endOffset);
      } catch (err) { continue; }
      if (rangeTouchesOwner(r)) {
        e.preventDefault();
        toast('space.protect.toast.modify');
        return true;
      }
    }
    if (rangeTouchesOwner(range)) {
      e.preventDefault();
      toast('space.protect.toast.modify');
      return true;
    }
  }

  // 2) Text insertion. Block when typing would extend the owner span itself
  // (cursor inside or at boundary) or shove same-line owner content right.
  if (isTextInsert) {
    if (rangeTouchesOwner(range)) {
      e.preventDefault();
      toast('space.protect.toast.modify');
      return true;
    }
    if (ownerInSameBlockAfterCursor(range)) {
      e.preventDefault();
      toast('space.protect.toast.displace');
      return true;
    }
  }

  // 3) Paragraph creation. Three failure modes:
  //   a) Cursor mid-span with owner content still ahead → Enter would split
  //      trainer text into two paragraphs. Block.
  //   b) Owner content lives later in the document → Enter pushes it down.
  //      Block (handled by nextContentIsOwner).
  //   c) Owner content is in the same block to the right of the cursor → Enter
  //      would still split the line. Block (handled by ownerInSameBlockAfterCursor).
  // Enter at the end of an owner span — where no owner content follows — is
  // explicitly allowed so participants can drop a fresh line below.
  if (isParaCreating) {
    if (cursorInsideOwnerWithContentAfter(range)) {
      e.preventDefault();
      toast('space.protect.toast.modify');
      return true;
    }
    if (nextContentIsOwner(range) || ownerInSameBlockAfterCursor(range)) {
      e.preventDefault();
      toast('space.protect.toast.displace');
      return true;
    }
  }
  return false;
}

// ── Cut/Paste/Drag explicit handlers ────────────────────────────

function blockClipboardOrDrag(e) {
  if (!ctx.appendOnly || ctx.isOwner) return;
  const range = currentRange();
  if (!range) return;
  if (rangeTouchesOwner(range)) {
    e.preventDefault();
    toast('space.protect.toast.modify');
  }
}

// ── Wire-up ─────────────────────────────────────────────────────

/**
 * Install the protection guard on the editor. Idempotent — safe to call
 * once during app init.
 */
export function initProtectGuard() {
  if (!ctx.editor) return;

  ctx.editor.addEventListener('beforeinput', (e) => {
    // Owner inserting plain text → wrap as owner content.
    if (wrapOwnerInsert(e)) return;
    // Participant attempting to modify protected content → block.
    blockIfProtected(e);
  });

  // Cut/paste/drag don't fire `beforeinput` for the deletion side reliably
  // across browsers — handle them explicitly.
  ['cut', 'paste', 'drop', 'dragstart'].forEach((evt) => {
    ctx.editor.addEventListener(evt, blockClipboardOrDrag);
  });
}
