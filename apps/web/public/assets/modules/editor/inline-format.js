/**
 * @module editor/inline-format
 * Inline formatting: bold, italic, underline toggling and
 * DOM-level format application / removal for selected text.
 */
import ctx from '../core/context.js';
import { blockTags } from '../core/constants.js';
import {
  extractManagedFormattingFromElement,
  applyFormattingToElement,
  mergeFormatting,
  normalizeCssColor,
  normalizeCssBackground,
} from '../core/formatting.js';
import { ensureNodeHasEditableContent } from '../core/dom-utils.js';
import { sanitizeEditorHtml } from '../services/sanitizer.js';
import { storedContentToHtml } from '../services/sanitizer.js';
import {
  getCurrentSelectionRange,
  getEditorSelectionOffsets,
  getSelectionBlockElement,
  getSelectionHostElement,
  saveEditorRange,
  restoreEditorSelection,
  isEditorFocused,
  placeSelectionMarkers,
  restoreSelectionFromMarkers,
  removeSelectionMarkers,
} from '../services/selection.js';

// ── Spec helpers ────────────────────────────────────────────────

/** Return the format spec object for a command name. */
export function getInlineFormatSpec(cmd) {
  if (cmd === 'bold') {
    return { formatKey: 'bold', tagName: 'strong', semanticTags: new Set(['strong', 'b']), className: 'mz-fw-bold' };
  }
  if (cmd === 'italic') {
    return { formatKey: 'italic', tagName: 'em', semanticTags: new Set(['em', 'i']), className: 'mz-fs-italic' };
  }
  if (cmd === 'underline') {
    return { formatKey: 'underline', tagName: 'u', semanticTags: new Set(['u']), className: 'mz-td-underline' };
  }
  return null;
}

/** @returns {boolean} Whether the element itself carries the inline format. */
export function elementHasInlineFormat(element, cmd) {
  const spec = getInlineFormatSpec(cmd);
  if (!spec || !(element instanceof Element)) return false;
  const tag = (element.tagName || '').toLowerCase();
  if (spec.semanticTags.has(tag)) return true;
  return !!(spec.className && element.classList.contains(spec.className));
}

/** Walk up the DOM to check if the node inherits the inline format. */
export function nodeHasInlineFormat(node, cmd, boundaryRoot) {
  let cur = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
  while (cur) {
    if (elementHasInlineFormat(cur, cmd)) return true;
    if (cur === boundaryRoot) break;
    if (boundaryRoot instanceof Element && !boundaryRoot.contains(cur)) break;
    cur = cur.parentElement;
  }
  return false;
}

// ── Text-node collection ────────────────────────────────────────

/** Collect all text nodes within `root`, optionally filtered by a predicate. */
export function collectTextNodes(root, predicate) {
  if (!root) return [];
  const nodes = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  while (node) {
    if ((node.nodeValue || '').length > 0 && (!predicate || predicate(node))) {
      nodes.push(node);
    }
    node = walker.nextNode();
  }
  return nodes;
}

/**
 * Collect text nodes that have actual character overlap with the range.
 * Excludes boundary-only touches.
 */
export function collectCoveredTextNodes(range) {
  const nodes = [];
  const tw = document.createTreeWalker(ctx.editor, NodeFilter.SHOW_TEXT, null);
  for (let tn = tw.nextNode(); tn; tn = tw.nextNode()) {
    const len = (tn.nodeValue || '').length;
    if (len === 0) continue;
    try { if (!range.intersectsNode(tn)) continue; } catch (e) { continue; }
    if (range.startContainer === tn && range.startOffset >= len) continue;
    if (range.endContainer === tn && range.endOffset === 0) continue;
    nodes.push(tn);
  }
  return nodes;
}

// ── Range normalization ─────────────────────────────────────────

/** Split text nodes at range boundaries so they align with selection edges. */
export function normalizeRangeTextBoundaries(range) {
  if (!range) return range;
  let startContainer = range.startContainer;
  let endContainer = range.endContainer;
  let startOffset = range.startOffset;
  let endOffset = range.endOffset;

  if (endContainer && endContainer.nodeType === Node.TEXT_NODE) {
    const len = (endContainer.nodeValue || '').length;
    if (endOffset > 0 && endOffset < len) {
      endContainer.splitText(endOffset);
    }
  }

  if (startContainer && startContainer.nodeType === Node.TEXT_NODE) {
    const len = (startContainer.nodeValue || '').length;
    if (startOffset > 0 && startOffset < len) {
      const afterStart = startContainer.splitText(startOffset);
      if (startContainer === endContainer) {
        endContainer = afterStart;
        endOffset = Math.max(0, endOffset - startOffset);
      }
      startContainer = afterStart;
      startOffset = 0;
      range.setStart(startContainer, startOffset);
    }
  }

  if (endContainer && endContainer.nodeType === Node.TEXT_NODE) {
    const safeEnd = Math.max(0, Math.min(endOffset, (endContainer.nodeValue || '').length));
    range.setEnd(endContainer, safeEnd);
  }
  return range;
}

// ── Element manipulation ────────────────────────────────────────

/** Unwrap an element, moving its children into its parent. */
export function unwrapElement(element) {
  if (!element || !element.parentNode) return;
  const parent = element.parentNode;
  while (element.firstChild) parent.insertBefore(element.firstChild, element);
  parent.removeChild(element);
}

/** Wrap a range's contents in a new element. */
export function wrapSelectionWithElement(range, tagName) {
  const wrapper = document.createElement(tagName || 'span');
  try {
    range.surroundContents(wrapper);
  } catch (e) {
    try {
      const frag = range.extractContents();
      wrapper.appendChild(frag);
      range.insertNode(wrapper);
    } catch (err) {
      return null;
    }
  }
  return wrapper;
}

/** Replace an inline-format element by removing the format and keeping other attrs. */
function replaceInlineFormatElement(element, cmd) {
  const spec = getInlineFormatSpec(cmd);
  if (!spec || !(element instanceof Element)) return;
  const next = extractManagedFormattingFromElement(element);
  delete next[spec.formatKey];
  if (Object.keys(next).length === 0) {
    unwrapElement(element);
    return;
  }
  const replacement = document.createElement('span');
  applyFormattingToElement(replacement, next);
  while (element.firstChild) replacement.appendChild(element.firstChild);
  element.replaceWith(replacement);
}

/** Remove a specific inline format from all elements inside a fragment. */
export function removeInlineFormatFromFragment(fragment, cmd) {
  const spec = getInlineFormatSpec(cmd);
  if (!spec) return;
  Array.from(fragment.querySelectorAll('*')).forEach((element) => {
    if (!(element instanceof Element)) return;
    const tag = (element.tagName || '').toLowerCase();
    if (spec.semanticTags.has(tag)) {
      replaceInlineFormatElement(element, cmd);
      return;
    }
    if (spec.className && element.classList.contains(spec.className)) {
      const next = extractManagedFormattingFromElement(element);
      delete next[spec.formatKey];
      applyFormattingToElement(element, next);
    }
  });
}

/** Apply a specific inline format to all unwrapped text nodes in a fragment. */
export function applyInlineFormatToFragment(fragment, cmd) {
  const spec = getInlineFormatSpec(cmd);
  if (!spec) return;
  collectTextNodes(fragment).forEach((node) => {
    if (nodeHasInlineFormat(node, cmd, fragment)) return;
    if (!node.parentNode) return;
    const wrapper = document.createElement(spec.tagName);
    node.parentNode.insertBefore(wrapper, node);
    wrapper.appendChild(node);
  });
}

// ── Inline style fallback ───────────────────────────────────────

/** Apply inline formatting via style-map when execCommand is not used. */
export function applyInlineStyleFallback(styleMap, options = {}) {
  const format = {};
  if (styleMap.fontWeight) format.bold = true;
  if (styleMap.fontStyle) format.italic = true;
  const textDecoration = String(styleMap.textDecoration || '').toLowerCase();
  if (textDecoration.includes('underline')) format.underline = true;

  const range = getCurrentSelectionRange();
  if (!range) return;
  if (range.collapsed) {
    const selectionOffsets = getEditorSelectionOffsets();
    const host = getSelectionHostElement() || getSelectionBlockElement();
    if (!host) return;
    const next = extractManagedFormattingFromElement(host);
    if (options.shouldRemove) {
      Object.keys(format).forEach((key) => {
        delete next[key];
      });
    } else {
      mergeFormatting(next, format);
    }
    applyFormattingToElement(host, next);
    restoreEditorSelection(selectionOffsets.start, selectionOffsets.end);
    saveEditorRange();
    return;
  }
  let tagName = 'span';
  if (format.bold) tagName = 'strong';
  else if (format.italic) tagName = 'em';
  else if (format.underline) tagName = 'u';
  const wrapper = wrapSelectionWithElement(range, tagName);
  if (!wrapper) return;
  const next = extractManagedFormattingFromElement(wrapper);
  mergeFormatting(next, format);
  if (tagName === 'strong') delete next.bold;
  if (tagName === 'em') delete next.italic;
  if (tagName === 'u') delete next.underline;
  applyFormattingToElement(wrapper, next);
}

// ── Color fallback ──────────────────────────────────────────────

/** Apply foreground or background color to the selection. */
export function applyColorFallback(kind, color, allowCollapsed) {
  const normalized = kind === 'fg' ? normalizeCssColor(color) : normalizeCssBackground(color);
  if (!normalized) return;
  const range = getCurrentSelectionRange();
  if (!range) return;
  if (range.collapsed) {
    if (allowCollapsed === false) return;
    const host = getSelectionHostElement() || getSelectionBlockElement();
    if (host) {
      const next = extractManagedFormattingFromElement(host);
      next[kind] = normalized;
      applyFormattingToElement(host, next);
    }
    return;
  }
  const span = wrapSelectionWithElement(range, 'span');
  if (span) {
    const next = extractManagedFormattingFromElement(span);
    next[kind] = normalized;
    applyFormattingToElement(span, next);
  }
}

// ── Selection state queries ─────────────────────────────────────

/** @returns {boolean} Whether the entire (possibly collapsed) selection has the format. */
export function isInlineSelectionFullyFormatted(cmd) {
  const range = getCurrentSelectionRange();
  if (!range) return false;
  if (range.collapsed) {
    if (nodeHasInlineFormat(range.startContainer, cmd, ctx.editor) || nodeHasInlineFormat(range.endContainer, cmd, ctx.editor)) {
      return true;
    }
    return false;
  }
  const liveTextNodes = collectCoveredTextNodes(range);
  if (!liveTextNodes.length) return false;
  return liveTextNodes.every((node) => nodeHasInlineFormat(node, cmd, ctx.editor));
}

// ── Empty ancestor cleanup ──────────────────────────────────────

/** Remove empty inline ancestors left behind by extractContents(). */
function cleanEmptyInlineAncestors(range) {
  if (!range || !range.collapsed) return;
  const inlineTags = new Set(['strong','em','u','span','b','i','a','font']);
  let node = range.startContainer;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  while (node && node !== ctx.editor && node.parentNode) {
    if (!(node instanceof Element)) break;
    const tag = (node.tagName || '').toLowerCase();
    if (!inlineTags.has(tag)) break;
    const text = (node.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    if (text) break;
    const parent = node.parentNode;
    const idx = Array.from(parent.childNodes).indexOf(node);
    node.remove();
    range.setStart(parent, Math.max(0, idx));
    range.collapse(true);
    node = parent;
  }
  node = range.startContainer;
  if (node && node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (node && node !== ctx.editor && node instanceof Element) {
    const tag = (node.tagName || '').toLowerCase();
    if (blockTags.has(tag)) {
      const text = (node.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
      const hasContent = !!node.querySelector('img,hr,video,audio,canvas,svg,object,embed,ul,ol');
      if (!text && !hasContent) {
        const parent = node.parentNode;
        const idx = Array.from(parent.childNodes).indexOf(node);
        node.remove();
        if (parent) {
          range.setStart(parent, Math.max(0, idx));
          range.collapse(true);
        }
      }
    }
  }
}

// ── Normalize editor markup ─────────────────────────────────────

/**
 * Full-pass normalization: serialize → sanitize → re-render,
 * preserving the user's selection.
 */
export function normalizeEditorMarkupPreserveSelection(selection) {
  const hasExplicitSelection = !!(
    selection
    && Number.isFinite(selection.start)
    && Number.isFinite(selection.end)
  );
  const offsets = hasExplicitSelection ? selection : getEditorSelectionOffsets();
  const focused = isEditorFocused();
  const scrollTop = ctx.editor.scrollTop || 0;
  const markersPlaced = hasExplicitSelection ? false : placeSelectionMarkers();
  const cleaned = sanitizeEditorHtml(ctx.editor.innerHTML || '');
  ctx.editor.innerHTML = storedContentToHtml(cleaned || '');
  if (!cleaned) ctx.editor.innerHTML = '';
  try {
    const maxScrollTop = Math.max(0, (ctx.editor.scrollHeight || 0) - (ctx.editor.clientHeight || 0));
    ctx.editor.scrollTop = Math.max(0, Math.min(scrollTop, maxScrollTop));
  } catch (e) {}
  if (focused) {
    ctx.editor.focus();
    if (!markersPlaced || !restoreSelectionFromMarkers()) {
      restoreEditorSelection(offsets.start, offsets.end);
    }
  } else if (markersPlaced) {
    removeSelectionMarkers(ctx.editor);
  }
  ctx.editor.querySelectorAll('p,div,h1,h2,h3,blockquote,li').forEach((node) => {
    ensureNodeHasEditableContent(node);
  });
  ctx.lastEditorSelection = offsets;
  saveEditorRange();
  ctx.updateToolbarState();
}

// ── Main toggle command ─────────────────────────────────────────

/**
 * Toggle inline format (bold/italic/underline) for the current selection.
 * @returns {boolean} true if finalizeEditorCommand should be called.
 */
export function toggleInlineFormatCommand(cmd, styleMap) {
  const range = restoreSavedSelectionIfNeeded(false) || getCurrentSelectionRange();
  if (!range) return false;
  const caretFormatInlineTags = new Set(['strong','em','u','span','b','i','a','font']);

  // --- COLLAPSED CARET: inline wrapper approach ---
  if (range.collapsed) {
    const spec = getInlineFormatSpec(cmd);
    if (!spec) return false;
    const shouldRemove = isInlineSelectionFullyFormatted(cmd);
    let caretFormatEl = null;
    if (shouldRemove) {
      let node = range.startContainer;
      if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
      let formatNode = null;
      while (node && node !== ctx.editor) {
        if (elementHasInlineFormat(node, cmd)) {
          const tag = (node.tagName || '').toLowerCase();
          if (caretFormatInlineTags.has(tag)) { formatNode = node; break; }
          if (spec.className && node.classList.contains(spec.className)) {
            node.classList.remove(spec.className);
            break;
          }
        }
        node = node.parentElement;
      }
      if (formatNode) {
        const tailRange = document.createRange();
        tailRange.setStart(range.startContainer, range.startOffset);
        if (formatNode.lastChild) {
          tailRange.setEndAfter(formatNode.lastChild);
        } else {
          tailRange.setEnd(formatNode, formatNode.childNodes.length);
        }
        const tailContent = tailRange.extractContents();
        const tailText = (tailContent.textContent || '').replace(/\u200b/g, '').trim();
        const tailHasEls = Array.from(tailContent.querySelectorAll('*')).some(el => (el.tagName || '').toLowerCase() !== 'br');
        if (tailText || tailHasEls) {
          const tailWrapper = formatNode.cloneNode(false);
          tailWrapper.removeAttribute('data-mz-caret-format');
          tailWrapper.appendChild(tailContent);
          formatNode.parentNode.insertBefore(tailWrapper, formatNode.nextSibling);
        }
        const origText = (formatNode.textContent || '').replace(/\u200b/g, '').trim();
        const origHasEls = formatNode.querySelector('img,hr,video,audio,canvas,svg,object,embed');
        const sel = window.getSelection && window.getSelection();
        const barrier = document.createElement('span');
        barrier.textContent = '\u200B';
        barrier.setAttribute('data-mz-caret-format', '1');
        if (!origText && !origHasEls) {
          const nextSib = formatNode.nextSibling;
          const parent = formatNode.parentNode;
          formatNode.remove();
          if (parent) {
            if (nextSib) { parent.insertBefore(barrier, nextSib); }
            else { parent.appendChild(barrier); }
          }
        } else {
          formatNode.parentNode.insertBefore(barrier, formatNode.nextSibling);
        }
        caretFormatEl = barrier;
        if (sel && barrier.firstChild) {
          const r = document.createRange();
          r.setStart(barrier.firstChild, 1);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
      }
    } else {
      const wrapper = document.createElement(spec.tagName);
      wrapper.textContent = '\u200B';
      wrapper.setAttribute('data-mz-caret-format', '1');
      range.insertNode(wrapper);
      caretFormatEl = wrapper;
      const sel = window.getSelection && window.getSelection();
      if (sel) {
        const r = document.createRange();
        r.setStart(wrapper.firstChild, 1);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      }
    }
    if (caretFormatEl && caretFormatEl.parentNode === ctx.editor) {
      const wrapP = document.createElement('p');
      ctx.editor.insertBefore(wrapP, caretFormatEl);
      wrapP.appendChild(caretFormatEl);
    }
    return false; // Skip finalizeEditorCommand
  }

  // --- NON-COLLAPSED SELECTION ---
  const selectionOffsets = getEditorSelectionOffsets();
  const liveTextNodes = collectCoveredTextNodes(range);

  if (!liveTextNodes.length) {
    applyInlineStyleFallback(styleMap);
    normalizeEditorMarkupPreserveSelection(selectionOffsets);
    return true;
  }

  const shouldRemove = liveTextNodes.every((node) => nodeHasInlineFormat(node, cmd, ctx.editor));

  restoreEditorSelection(selectionOffsets.start, selectionOffsets.end);
  const freshRange = getCurrentSelectionRange();
  if (!freshRange || freshRange.collapsed) {
    normalizeEditorMarkupPreserveSelection(selectionOffsets);
    return true;
  }
  normalizeRangeTextBoundaries(freshRange);
  const fragment = freshRange.extractContents();
  if (shouldRemove) {
    removeInlineFormatFromFragment(fragment, cmd);
  } else {
    applyInlineFormatToFragment(fragment, cmd);
  }
  cleanEmptyInlineAncestors(freshRange);

  if (shouldRemove) {
    const spec = getInlineFormatSpec(cmd);
    if (spec) {
      let splitNode = freshRange.startContainer;
      if (splitNode && splitNode.nodeType === Node.TEXT_NODE) splitNode = splitNode.parentElement;
      while (splitNode && splitNode !== ctx.editor) {
        if (elementHasInlineFormat(splitNode, cmd)) {
          const tag = (splitNode.tagName || '').toLowerCase();
          if (!caretFormatInlineTags.has(tag)) break;
          const tailRange = document.createRange();
          tailRange.setStart(freshRange.startContainer, freshRange.startOffset);
          if (splitNode.lastChild) {
            tailRange.setEndAfter(splitNode.lastChild);
          } else {
            tailRange.setEnd(splitNode, splitNode.childNodes.length);
          }
          const tailContent = tailRange.extractContents();
          const tailText = (tailContent.textContent || '').replace(/\u200b/g, '').trim();
          const tailHasEls = Array.from(tailContent.querySelectorAll('*')).some(el => (el.tagName || '').toLowerCase() !== 'br');
          if (tailText || tailHasEls) {
            const tailWrapper = splitNode.cloneNode(false);
            tailWrapper.appendChild(tailContent);
            splitNode.parentNode.insertBefore(tailWrapper, splitNode.nextSibling);
          }
          freshRange.setStartAfter(splitNode);
          freshRange.collapse(true);
          const origText = (splitNode.textContent || '').replace(/\u200b/g, '').trim();
          if (!origText && !splitNode.querySelector('img,hr,video,audio,canvas,svg,object,embed')) {
            splitNode.remove();
          }
          break;
        }
        splitNode = splitNode.parentElement;
      }
    }
  }

  freshRange.insertNode(fragment);

  // Clean up empty block elements left behind by extractContents().
  const emptyBlockTags = new Set(['p','div','blockquote']);
  Array.from(ctx.editor.children).forEach(child => {
    if (!(child instanceof Element)) return;
    const tag = (child.tagName || '').toLowerCase();
    if (tag === 'ol' || tag === 'ul') {
      const listText = (child.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
      if (!listText) child.remove();
      return;
    }
    if (!emptyBlockTags.has(tag)) return;
    const text = (child.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    if (text) return;
    if (child.querySelector('br,img,hr,video,audio,canvas,svg,object,embed')) return;
    child.remove();
  });

  normalizeEditorMarkupPreserveSelection(selectionOffsets);
  return true;
}

// ── Helpers shared with commands.js ─────────────────────────────

/** Restore saved selection if no valid selection exists. */
function restoreSavedSelectionIfNeeded(requireExpanded) {
  let range = getCurrentSelectionRange();
  if (range && (!requireExpanded || !range.collapsed)) return range;
  const start = Number.isFinite(ctx.lastEditorSelection.start) ? ctx.lastEditorSelection.start : 0;
  const end = Number.isFinite(ctx.lastEditorSelection.end) ? ctx.lastEditorSelection.end : start;
  if (end > start || !requireExpanded) {
    restoreEditorSelection(start, end);
    saveEditorRange();
    range = getCurrentSelectionRange();
  }
  return range;
}

export { restoreSavedSelectionIfNeeded };

/** Register on ctx. */
export function initInlineFormat() {
  ctx.normalizeEditorMarkupPreserveSelection = normalizeEditorMarkupPreserveSelection;
}
