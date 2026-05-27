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
  // Endpoint(s) inside an owner span — always counts as "touching".
  const startEl = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
  if (startEl && startEl.closest && startEl.closest(OWNER_SELECTOR)) return true;
  // A collapsed caret that is NOT inside an owner span cannot overlap one,
  // even if it sits at a boundary point adjacent to a span. The earlier
  // `intersectsNode` walk was too eager: some browser implementations flag
  // adjacent boundary points as intersecting, which blocked legitimate
  // participant typing right after protected content.
  if (range.collapsed) return false;
  const endEl = range.endContainer.nodeType === 1 ? range.endContainer : range.endContainer.parentElement;
  if (endEl && endEl.closest && endEl.closest(OWNER_SELECTOR)) return true;
  // Non-collapsed selection: walk owner spans and test for real overlap.
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

function isInsideOwnerSpan(node) {
  const el = node && node.nodeType === 3 ? node.parentElement : node;
  return !!(el && el.closest && el.closest(OWNER_SELECTOR));
}

function blockIsEmpty(block) {
  if (!block) return false;
  const text = (block.textContent || '').replace(/​/g, '').replace(/ /g, ' ').trim();
  if (text) return false;
  return !block.querySelector('img,hr,video,audio,canvas,svg,object,embed');
}

/**
 * Replace the browser's default paragraph-creation with a clean new block.
 * Used when the caret sits inside an owner span and Enter would otherwise
 * be allowed — the browser tends to clone the span into the new block,
 * trapping the participant inside an empty owner span where every further
 * input is treated as an owner-content edit and blocked.
 */
function insertCleanParagraphAfterCaret(range) {
  const block = getContainingBlock(range.startContainer);
  if (!block || !block.parentNode) return false;
  const tag = (block.tagName || 'DIV').toLowerCase();
  const fresh = document.createElement(tag);
  fresh.appendChild(document.createElement('br'));
  block.parentNode.insertBefore(fresh, block.nextSibling);
  const sel = window.getSelection();
  const newRange = document.createRange();
  newRange.setStart(fresh, 0);
  newRange.collapse(true);
  sel.removeAllRanges();
  sel.addRange(newRange);
  ctx.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertParagraph' }));
  return true;
}

/**
 * Remove an empty participant-created block on Backspace/Delete without
 * touching adjacent owner content. The owner span next to it is unaffected
 * (we only delete the empty sibling block and reposition the caret outside
 * any owner marker on the surviving neighbour).
 */
function deleteEmptyParticipantBlock(range, inputType) {
  const block = getContainingBlock(range.startContainer);
  if (!block || !block.parentNode) return false;
  if (block.querySelector(OWNER_SELECTOR)) return false;
  if (!blockIsEmpty(block)) return false;

  const isBackward = inputType === 'deleteContentBackward'
    || inputType === 'deleteWordBackward'
    || inputType === 'deleteHardLineBackward'
    || inputType === 'deleteSoftLineBackward';
  const isForward = inputType === 'deleteContentForward'
    || inputType === 'deleteWordForward'
    || inputType === 'deleteHardLineForward'
    || inputType === 'deleteSoftLineForward';

  if (isBackward) {
    const prev = block.previousElementSibling;
    if (!prev || !BLOCK_TAGS.test(prev.tagName || '')) return false;
    block.remove();
    placeCaretAtBlockEndOutsideOwner(prev);
    ctx.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    return true;
  }
  if (isForward) {
    const next = block.nextElementSibling;
    if (!next || !BLOCK_TAGS.test(next.tagName || '')) return false;
    block.remove();
    placeCaretAtBlockStartOutsideOwner(next);
    ctx.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }));
    return true;
  }
  return false;
}

function placeCaretAtBlockEndOutsideOwner(block) {
  const sel = window.getSelection();
  const r = document.createRange();
  const last = block.lastChild;
  if (last && last.nodeType === 1 && last.classList && last.classList.contains(OWNER_TEXT_CLASS)) {
    r.setStartAfter(last);
  } else {
    r.selectNodeContents(block);
    r.collapse(false);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

function placeCaretAtBlockStartOutsideOwner(block) {
  const sel = window.getSelection();
  const r = document.createRange();
  const first = block.firstChild;
  if (first && first.nodeType === 1 && first.classList && first.classList.contains(OWNER_TEXT_CLASS)) {
    r.setStartBefore(first);
  } else {
    r.setStart(block, 0);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
}

/**
 * Detect whether the caret sits exactly at a boundary of an owner span
 * (right before its first leaf, or right after its last leaf). Inside the
 * span text itself returns null — that's the "split owner content" case
 * and stays blocked. Returns `{ span, position: 'before' | 'after' }` or
 * null.
 */
function findOwnerBoundary(range) {
  if (!range || !range.collapsed) return null;
  const node = range.startContainer;
  const offset = range.startOffset;
  const el = node.nodeType === 3 ? node.parentElement : node;
  const span = el && el.closest ? el.closest(OWNER_SELECTOR) : null;
  if (!span) return null;
  if (node.nodeType === 3) {
    if (offset === 0) {
      let n = node;
      while (n && n !== span) {
        if (n.previousSibling) return null;
        n = n.parentNode;
      }
      return { span, position: 'before' };
    }
    if (offset === (node.textContent || '').length) {
      let n = node;
      while (n && n !== span) {
        if (n.nextSibling) return null;
        n = n.parentNode;
      }
      return { span, position: 'after' };
    }
    return null;
  }
  // Element container
  if (node === span) {
    if (offset === 0) return { span, position: 'before' };
    if (offset === node.childNodes.length) return { span, position: 'after' };
    return null;
  }
  if (offset === 0) {
    let n = node;
    while (n && n !== span) {
      if (n.previousSibling) return null;
      n = n.parentNode;
    }
    return { span, position: 'before' };
  }
  if (offset === node.childNodes.length) {
    let n = node;
    while (n && n !== span) {
      if (n.nextSibling) return null;
      n = n.parentNode;
    }
    return { span, position: 'after' };
  }
  return null;
}

/**
 * Insert participant text right outside an owner span. Used when the caret
 * sits at the span's start or end boundary — the typed text becomes a
 * sibling text node next to the span, never modifying its contents.
 */
function insertTextAtOwnerBoundary(boundary, text) {
  const span = boundary.span;
  const parent = span.parentNode;
  if (!parent) return false;
  const ref = boundary.position === 'after' ? span.nextSibling : span;
  // Reuse an adjacent participant text node when possible so we don't grow
  // a chain of single-character siblings on each keystroke.
  let target = null;
  if (boundary.position === 'after') {
    const candidate = span.nextSibling;
    if (candidate && candidate.nodeType === 3) target = candidate;
  } else {
    const candidate = span.previousSibling;
    if (candidate && candidate.nodeType === 3) target = candidate;
  }
  const sel = window.getSelection();
  const r = document.createRange();
  if (target) {
    const at = boundary.position === 'after' ? 0 : (target.textContent || '').length;
    target.insertData(at, text);
    r.setStart(target, at + text.length);
  } else {
    const fresh = document.createTextNode(text);
    parent.insertBefore(fresh, ref);
    r.setStart(fresh, text.length);
  }
  r.collapse(true);
  sel.removeAllRanges();
  sel.addRange(r);
  ctx.editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
  return true;
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
    // Empty participant-created block: allow removal so the participant can
    // clean up their own newly-added empty lines without merging into the
    // surrounding owner content.
    if (isDelete && range.collapsed && deleteEmptyParticipantBlock(range, it)) {
      e.preventDefault();
      return true;
    }
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
  // Exception: caret AT the boundary of an owner span — redirect the insert
  // outside the span so the participant can append after / prepend before
  // protected content without modifying it. The same-block displacement
  // check below still catches "owner content to the right of the caret".
  if (isTextInsert) {
    if (rangeTouchesOwner(range)) {
      // Caret at the *end* boundary of an owner span and nothing else owner-
      // marked sits after it in the same block: redirect the insert to a
      // sibling text node outside the span. This is the common case when a
      // participant clicks at the bottom of protected content and starts
      // typing — without this, the caret naturally lands inside the last
      // owner span and every keystroke gets blocked.
      if (it === 'insertText' && typeof e.data === 'string' && e.data.length) {
        const boundary = findOwnerBoundary(range);
        if (boundary && boundary.position === 'after' && !ownerInSameBlockAfterCursor(range)) {
          e.preventDefault();
          insertTextAtOwnerBoundary(boundary, e.data);
          return true;
        }
      }
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
    // Enter is allowed. Whenever the containing block carries any owner
    // content (whether the caret sits inside the span, right at a boundary,
    // or just outside in the same block) we take over: the browser would
    // otherwise clone the inline structure — including `.mz-owner-text` —
    // into the new block, trapping the caret inside an empty owner span
    // where every subsequent input is treated as an owner-edit and blocked.
    const containingBlock = getContainingBlock(range.startContainer);
    if (containingBlock && containingBlock.querySelector(OWNER_SELECTOR)) {
      if (insertCleanParagraphAfterCaret(range)) {
        e.preventDefault();
        return true;
      }
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
