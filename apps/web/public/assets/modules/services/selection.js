import ctx from '../core/context.js';
import {
  allowedTags,
  blockTags,
  selectionMarkerStartAttr,
  selectionMarkerEndAttr,
  selectionMarkerCaretAttr,
} from '../core/constants.js';
import { sanitizeEditorHtml } from './sanitizer.js';
import { htmlToPlainText } from '../core/dom-utils.js';

export function getEditorStoredContent() {
  return sanitizeEditorHtml(ctx.editor.innerHTML || '');
}

export function getEditorPlainText() {
  return htmlToPlainText(getEditorStoredContent());
}

export function isNodeWithinEditor(node) {
  return !!node && (node === ctx.editor || ctx.editor.contains(node));
}

export function isEditorFocused() {
  const active = document.activeElement;
  if (active === ctx.editor || ctx.editor.contains(active)) return true;
  try {
    const sel = window.getSelection && window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    return ctx.editor.contains(range.startContainer) || ctx.editor.contains(range.endContainer);
  } catch (e) {
    return false;
  }
}

export function setEditorEditable(enabled) {
  try {
    ctx.editor?.setAttribute('contenteditable', enabled ? 'true' : 'false');
    if ('disabled' in ctx.editor) ctx.editor.disabled = !enabled;
  } catch (e) {}
}

export function getTextNodeLength(root) {
  if (!root) return 0;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let total = 0;
  let node = walker.nextNode();
  while (node) {
    total += (node.nodeValue || '').length;
    node = walker.nextNode();
  }
  return total;
}

export function getTextNodeOffset(root, container, offset) {
  if (!root) return 0;
  try {
    const pre = document.createRange();
    pre.selectNodeContents(root);
    pre.setEnd(container, offset);
    return getTextNodeLength(pre.cloneContents());
  } catch (e) {
    return 0;
  }
}

export function getEditorSelectionOffsets() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0 || !isEditorFocused()) {
    return {
      start: Number.isFinite(ctx.lastEditorSelection.start) ? ctx.lastEditorSelection.start : 0,
      end: Number.isFinite(ctx.lastEditorSelection.end) ? ctx.lastEditorSelection.end : 0
    };
  }
  const range = sel.getRangeAt(0);
  if (!isNodeWithinEditor(range.startContainer) || !isNodeWithinEditor(range.endContainer)) {
    return {
      start: Number.isFinite(ctx.lastEditorSelection.start) ? ctx.lastEditorSelection.start : 0,
      end: Number.isFinite(ctx.lastEditorSelection.end) ? ctx.lastEditorSelection.end : 0
    };
  }
  const start = getTextNodeOffset(ctx.editor, range.startContainer, range.startOffset);
  const end = getTextNodeOffset(ctx.editor, range.endContainer, range.endOffset);
  return { start, end };
}

export function fixEditorLevelCaret() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const r = sel.getRangeAt(0);
  if (r.startContainer !== ctx.editor && r.endContainer !== ctx.editor) return false;
  const child = ctx.editor.querySelector('p,div,h1,h2,h3,blockquote,li');
  if (!child) return false;
  const fix = document.createRange();
  const walker = document.createTreeWalker(child, NodeFilter.SHOW_TEXT, null);
  const textNode = walker.nextNode();
  if (textNode) {
    fix.setStart(textNode, 0);
    fix.collapse(true);
  } else {
    fix.selectNodeContents(child);
    fix.collapse(true);
  }
  sel.removeAllRanges();
  sel.addRange(fix);
  return true;
}

export function saveEditorRange() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!isNodeWithinEditor(range.startContainer) || !isNodeWithinEditor(range.endContainer)) return;
  const start = getTextNodeOffset(ctx.editor, range.startContainer, range.startOffset);
  const end = getTextNodeOffset(ctx.editor, range.endContainer, range.endOffset);
  ctx.lastEditorSelection = { start, end };
  ctx.lastEditorRange = range.cloneRange();
}

export function resolveTextPosition(root, index) {
  if (!root) return { node: ctx.editor, offset: 0 };
  const totalLen = getTextNodeLength(root);
  const numericIndex = Number.isFinite(index) ? index : 0;
  const safeIndex = Math.max(0, Math.min(numericIndex, totalLen));
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  let node = walker.nextNode();
  let remaining = safeIndex;
  let last = null;
  while (node) {
    const len = node.nodeValue ? node.nodeValue.length : 0;
    if (remaining <= len) return { node, offset: remaining };
    remaining -= len;
    last = node;
    node = walker.nextNode();
  }
  if (last) return { node: last, offset: (last.nodeValue || '').length };
  return { node: root, offset: 0 };
}

export function restoreEditorSelection(start, end) {
  const sel = window.getSelection && window.getSelection();
  if (!sel) return;
  const s = resolveTextPosition(ctx.editor, start);
  const e = resolveTextPosition(ctx.editor, end);
  const range = document.createRange();
  try {
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (err) {}
}

export function restoreEditorRange() {
  const sel = window.getSelection && window.getSelection();
  if (!sel) return false;
  try {
    if (ctx.lastEditorRange && isNodeWithinEditor(ctx.lastEditorRange.startContainer) && isNodeWithinEditor(ctx.lastEditorRange.endContainer)) {
      sel.removeAllRanges();
      sel.addRange(ctx.lastEditorRange);
      return true;
    }
  } catch (e) {
    // fallback below
  }
  if (Number.isFinite(ctx.lastEditorSelection.start) && Number.isFinite(ctx.lastEditorSelection.end)) {
    restoreEditorSelection(ctx.lastEditorSelection.start, ctx.lastEditorSelection.end);
    return true;
  }
  return false;
}

export function createSelectionMarker(attrName) {
  const span = document.createElement('span');
  span.setAttribute(attrName, '');
  return span;
}

export function findSelectionMarker(attrName) {
  return ctx.editor.querySelector(`[${attrName}]`);
}

export function removeSelectionMarkers(root) {
  if (!root) return;
  const sel = `[${selectionMarkerStartAttr}],[${selectionMarkerEndAttr}],[${selectionMarkerCaretAttr}]`;
  root.querySelectorAll(sel).forEach((el) => el.remove());
}

export function getCurrentSelectionRange() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!isNodeWithinEditor(range.startContainer) || !isNodeWithinEditor(range.endContainer)) return null;
  return range;
}

export function placeSelectionMarkers(fallbackSelection) {
  removeSelectionMarkers(ctx.editor);
  let range;
  if (fallbackSelection && Number.isFinite(fallbackSelection.start) && Number.isFinite(fallbackSelection.end)) {
    restoreEditorSelection(fallbackSelection.start, fallbackSelection.end);
    range = getCurrentSelectionRange();
  } else {
    range = getCurrentSelectionRange();
  }
  if (!range) return false;

  const sel = window.getSelection && window.getSelection();
  if (range.collapsed) {
    const caretMarker = createSelectionMarker(selectionMarkerCaretAttr);
    const caretRange = range.cloneRange();
    caretRange.insertNode(caretMarker);
    try {
      const next = document.createRange();
      next.setStartAfter(caretMarker);
      next.collapse(true);
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(next);
      }
    } catch (e) {}
    return true;
  }

  const endMarker = createSelectionMarker(selectionMarkerEndAttr);
  const endRange = range.cloneRange();
  endRange.collapse(false);
  endRange.insertNode(endMarker);

  const startMarker = createSelectionMarker(selectionMarkerStartAttr);
  const startRange = range.cloneRange();
  startRange.collapse(true);
  startRange.insertNode(startMarker);

  try {
    const next = document.createRange();
    next.setStartAfter(startMarker);
    next.setEndBefore(endMarker);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(next);
    }
  } catch (e) {}
  return true;
}

export function restoreSelectionFromMarkers() {
  const sel = window.getSelection && window.getSelection();
  if (!sel) {
    removeSelectionMarkers(ctx.editor);
    return false;
  }
  const caretMarker = findSelectionMarker(selectionMarkerCaretAttr);
  const startMarker = findSelectionMarker(selectionMarkerStartAttr);
  const endMarker = findSelectionMarker(selectionMarkerEndAttr);
  if (!caretMarker && !startMarker && !endMarker) return false;

  try {
    const range = document.createRange();
    if (caretMarker && caretMarker.parentNode) {
      range.setStartAfter(caretMarker);
      range.collapse(true);
    } else if (startMarker && endMarker && startMarker.parentNode && endMarker.parentNode) {
      range.setStartAfter(startMarker);
      range.setEndBefore(endMarker);
    } else if (startMarker && startMarker.parentNode) {
      range.setStartAfter(startMarker);
      range.collapse(true);
    } else if (endMarker && endMarker.parentNode) {
      range.setStartBefore(endMarker);
      range.collapse(true);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {
    return false;
  } finally {
    removeSelectionMarkers(ctx.editor);
  }
  return true;
}

export function editorNeedsInputNormalization() {
  const topLevelNodes = Array.from(ctx.editor.childNodes || []);
  for (const node of topLevelNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.nodeValue || '').trim()) return true;
      continue;
    }
    if (!(node instanceof Element)) continue;
    const tag = (node.tagName || '').toLowerCase();
    if (!tag) continue;
    if (!allowedTags.has(tag)) return true;
    if (tag === 'br') return true;
    if (!blockTags.has(tag) && tag !== 'ul' && tag !== 'ol' && tag !== 'hr') {
      return true;
    }
  }
  if (ctx.editor.querySelector('[style]')) return true;
  if (ctx.editor.querySelector(':scope > p p, :scope > p div, :scope > p h1, :scope > p h2, :scope > p h3, :scope > p blockquote, :scope > p ul, :scope > p ol, :scope > p hr, :scope > div p, :scope > div div, :scope > div h1, :scope > div h2, :scope > div h3, :scope > div blockquote, :scope > div ul, :scope > div ol, :scope > div hr, :scope > h1 p, :scope > h1 div, :scope > h1 ul, :scope > h1 ol, :scope > h1 hr, :scope > h2 p, :scope > h2 div, :scope > h2 ul, :scope > h2 ol, :scope > h2 hr, :scope > h3 p, :scope > h3 div, :scope > h3 ul, :scope > h3 ol, :scope > h3 hr, :scope > blockquote p, :scope > blockquote div, :scope > blockquote ul, :scope > blockquote ol, :scope > blockquote hr')) {
    return true;
  }
  return Array.from(ctx.editor.querySelectorAll('strong,em,u,s,span,a')).some((el) => {
    if (el.hasAttribute(selectionMarkerStartAttr) || el.hasAttribute(selectionMarkerEndAttr) || el.hasAttribute(selectionMarkerCaretAttr)) return false;
    if (el.hasAttribute('data-mz-caret-format')) return false;
    const text = ((el.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const hasStructuredChild = !!el.querySelector('img,hr,video,audio,canvas,svg,object,embed,input,textarea,select,button,ul,ol,a,br');
    return !text && !hasStructuredChild;
  });
}

export function getSelectionBlockElement() {
  const range = getCurrentSelectionRange();
  if (!range) return null;
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || node === ctx.editor) {
    const fallback = ctx.editor.querySelector('p,div,h1,h2,h3,blockquote,li');
    return fallback || null;
  }
  const block = node.closest ? node.closest('p,div,h1,h2,h3,blockquote,li') : null;
  return block && ctx.editor.contains(block) ? block : null;
}

export function getSelectionHostElement() {
  const range = getCurrentSelectionRange();
  if (!range) return null;
  let node = range.startContainer;
  if (node.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!node || node === ctx.editor) {
    const fallback = ctx.editor.querySelector('span,strong,em,u,s,a,p,div,h1,h2,h3,blockquote,li');
    return fallback || ctx.editor;
  }
  return (node instanceof Element && ctx.editor.contains(node)) ? node : ctx.editor;
}

export function getSelectionBlocks(range) {
  if (!range) return [];
  const blocks = [];
  const seen = new Set();
  const all = ctx.editor.querySelectorAll('p,div,h1,h2,h3,blockquote,li');
  all.forEach((el) => {
    try {
      if (!range.intersectsNode(el)) return;
    } catch (e) {
      return;
    }
    if (seen.has(el)) return;
    seen.add(el);
    blocks.push(el);
  });
  return blocks;
}

// Register functions on ctx for cross-module access
export function initSelection() {
  ctx.saveEditorRange = saveEditorRange;
  ctx.restoreEditorRange = restoreEditorRange;
  ctx.getEditorStoredContent = getEditorStoredContent;
  ctx.getEditorPlainText = getEditorPlainText;
  ctx.getEditorSelectionOffsets = getEditorSelectionOffsets;
  ctx.restoreEditorSelection = restoreEditorSelection;
  ctx.isEditorFocused = isEditorFocused;
  ctx.isNodeWithinEditor = isNodeWithinEditor;
  ctx.editorNeedsInputNormalization = editorNeedsInputNormalization;
  ctx.sanitizeEditorHtml = sanitizeEditorHtml;
}
