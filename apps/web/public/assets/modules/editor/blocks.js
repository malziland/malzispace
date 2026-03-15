/**
 * @module editor/blocks
 * Block-level operations: lists, alignment, horizontal rules,
 * caret helpers, and DOM structure manipulation.
 */
import ctx from '../core/context.js';
import { blockTags, pendingCaretAttr } from '../core/constants.js';
import {
  applyFormattingToElement,
  extractManagedFormattingFromElement,
  copyManagedFormatting,
} from '../core/formatting.js';
import { ensureNodeHasEditableContent } from '../core/dom-utils.js';
import {
  getCurrentSelectionRange,
  getSelectionBlocks,
  getSelectionBlockElement,
  saveEditorRange,
} from '../services/selection.js';

// ── Caret movement ──────────────────────────────────────────────

/** Move caret to the first text position inside `node`. */
export function moveCaretToNodeStart(node) {
  if (!node) return;
  const range = document.createRange();
  if (node instanceof Element) {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    const textNode = walker.nextNode();
    if (textNode) {
      range.setStart(textNode, 0);
      range.collapse(true);
    } else {
      range.selectNodeContents(node);
      range.collapse(true);
    }
  } else {
    range.setStart(node, 0);
    range.collapse(true);
  }
  const sel = window.getSelection && window.getSelection();
  if (sel) { sel.removeAllRanges(); sel.addRange(range); }
}

/** Move caret to the last text position inside `node`. */
export function moveCaretToNodeEnd(node) {
  if (!node) return;
  const range = document.createRange();
  if (node instanceof Element) {
    const children = Array.from(node.childNodes || []);
    const onlyChild = children.length === 1 ? children[0] : null;
    if (onlyChild && onlyChild.nodeType === Node.TEXT_NODE) {
      const len = (onlyChild.nodeValue || '').length;
      range.setStart(onlyChild, len);
      range.setEnd(onlyChild, len);
    } else if (onlyChild && onlyChild.nodeType === Node.ELEMENT_NODE && (onlyChild.nodeName || '').toLowerCase() === 'br') {
      range.setStart(node, 0);
      range.setEnd(node, 0);
    } else {
      range.selectNodeContents(node);
      range.collapse(false);
    }
  } else {
    range.selectNodeContents(node);
    range.collapse(false);
  }
  const sel = window.getSelection && window.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Place caret at the end of text inside `node` (placeholder-aware). */
export function selectEditablePlaceholder(node) {
  if (!(node instanceof Element)) {
    moveCaretToNodeEnd(node);
    return;
  }
  let textNode = null;
  if (node.firstChild && node.firstChild.nodeType === Node.TEXT_NODE && (node.firstChild.nodeValue || '').length > 0) {
    textNode = node.firstChild;
  } else {
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null);
    let next = walker.nextNode();
    while (next) {
      if ((next.nodeValue || '').length > 0) {
        textNode = next;
        break;
      }
      next = walker.nextNode();
    }
  }
  if (textNode && (textNode.nodeValue || '').length > 0) {
    const range = document.createRange();
    const len = (textNode.nodeValue || '').length;
    range.setStart(textNode, len);
    range.setEnd(textNode, len);
    const sel = window.getSelection && window.getSelection();
    if (!sel) return;
    sel.removeAllRanges();
    sel.addRange(range);
    return;
  }
  moveCaretToNodeEnd(node);
}

/** Clear placeholder content from an empty block node. */
export function clearEditablePlaceholder(node) {
  if (!(node instanceof Element)) return;
  const tag = (node.tagName || '').toLowerCase();
  if (!['p', 'div', 'blockquote', 'li'].includes(tag)) return;
  const text = ((node.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
  const onlyBreak = node.childNodes.length === 1 && node.firstChild && node.firstChild.nodeType === Node.ELEMENT_NODE
    && ((node.firstChild.nodeName || '').toLowerCase() === 'br');
  const onlyPlaceholder = node.childNodes.length === 1 && node.firstChild instanceof Element
    && node.firstChild.getAttribute('data-mz-placeholder') === '1';
  if (!text && (onlyBreak || onlyPlaceholder || !node.firstChild)) {
    node.innerHTML = '';
  }
  node.removeAttribute(pendingCaretAttr);
}

// ── Pending post-command caret ──────────────────────────────────

/** @returns {Element|null} The element marked as pending caret target. */
export function getPendingPostCommandCaretNode() {
  if (ctx.pendingPostCommandCaretNode && ctx.editor.contains(ctx.pendingPostCommandCaretNode)) return ctx.pendingPostCommandCaretNode;
  const marked = ctx.editor.querySelector(`[${pendingCaretAttr}="1"]`);
  if (marked) {
    ctx.pendingPostCommandCaretNode = marked;
    return marked;
  }
  return null;
}

/** Flush pending caret: move caret to target and clear marker. */
export function flushPendingPostCommandCaret() {
  const target = getPendingPostCommandCaretNode();
  if (!target) return false;
  selectEditablePlaceholder(target);
  saveEditorRange();
  ctx.pendingPostCommandCaretNode = null;
  return true;
}

/** Move caret to pending target (without clearing the marker). */
export function syncPendingPostCommandCaret() {
  const target = getPendingPostCommandCaretNode();
  if (!target) return false;
  selectEditablePlaceholder(target);
  saveEditorRange();
  return true;
}

// ── Text insertion ──────────────────────────────────────────────

/** Insert plain text at the current cursor position. */
export function insertTextAtCurrentSelection(text) {
  const value = String(text || '');
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const node = document.createTextNode(value);
  range.insertNode(node);
  const next = document.createRange();
  next.setStart(node, value.length);
  next.setEnd(node, value.length);
  sel.removeAllRanges();
  sel.addRange(next);
  return true;
}

// ── DOM traversal ───────────────────────────────────────────────

/** Walk up from `node` to find the top-level child of the editor. */
export function topLevelEditorNode(node) {
  let cur = node || null;
  while (cur && cur !== ctx.editor && cur.parentNode !== ctx.editor) cur = cur.parentNode;
  if (!cur || cur === ctx.editor) return null;
  return cur;
}

/** Resolve a range boundary to the corresponding top-level editor child. */
export function getTopLevelAnchorFromRange(range) {
  if (!range) return null;
  const resolveBoundary = (container, offset) => {
    if (!container) return null;
    if (container === ctx.editor) {
      const childNodes = ctx.editor.childNodes || [];
      if (offset > 0 && childNodes[offset - 1]) return childNodes[offset - 1];
      if (offset < childNodes.length && childNodes[offset]) return childNodes[offset];
      return ctx.editor.lastChild || null;
    }
    return topLevelEditorNode(container);
  };
  return resolveBoundary(range.startContainer, range.startOffset) || resolveBoundary(range.endContainer, range.endOffset);
}

/** Find the nearest ancestor with a given tag name (within the editor). */
export function nearestAncestorTag(node, tagName) {
  if (!node) return null;
  let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const target = (tagName || '').toLowerCase();
  while (el && el !== ctx.editor) {
    if ((el.tagName || '').toLowerCase() === target) return el;
    el = el.parentElement;
  }
  return null;
}

/** Collapse the current selection to its end point. */
export function collapseCurrentSelectionToEnd() {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  try {
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
  } catch (e) {}
  saveEditorRange();
}

// ── List detection ──────────────────────────────────────────────

/** @returns {boolean} Whether the selection is inside the given list tag (ul/ol). */
export function isSelectionInsideListTag(tagName) {
  const range = getCurrentSelectionRange();
  if (!range) return false;
  if (nearestAncestorTag(range.startContainer, tagName)) return true;
  if (nearestAncestorTag(range.endContainer, tagName)) return true;
  if (range.collapsed) return false;
  const listNodes = ctx.editor.querySelectorAll(tagName);
  for (const list of listNodes) {
    try {
      if (range.intersectsNode(list)) return true;
    } catch (e) {}
  }
  return false;
}

/** @returns {Element|null} The list element (ul/ol) containing the selection. */
export function getSelectionListElement() {
  const range = getCurrentSelectionRange();
  if (!range) return null;
  const direct =
    nearestAncestorTag(range.startContainer, 'ul')
    || nearestAncestorTag(range.startContainer, 'ol')
    || nearestAncestorTag(range.endContainer, 'ul')
    || nearestAncestorTag(range.endContainer, 'ol');
  if (direct) return direct;
  const lists = ctx.editor.querySelectorAll('ul,ol');
  for (const list of lists) {
    try {
      if (range.intersectsNode(list)) return list;
    } catch (e) {}
  }
  return null;
}

// ── List manipulation ───────────────────────────────────────────

/** Replace a list's tag (ul↔ol) while preserving items and formatting. */
export function replaceListType(list, tagName) {
  if (!list || !list.parentNode) return null;
  const tag = (tagName || '').toLowerCase();
  if (tag !== 'ul' && tag !== 'ol') return null;
  if ((list.tagName || '').toLowerCase() === tag) return list;
  const next = document.createElement(tag);
  while (list.firstChild) next.appendChild(list.firstChild);
  list.parentNode.replaceChild(next, list);
  return next;
}

/** Clone a list's shell (tag + formatting) without items. */
function cloneListShell(list) {
  if (!list) return null;
  const tag = (list.tagName || '').toLowerCase();
  if (!tag) return null;
  const next = document.createElement(tag);
  copyManagedFormatting(list, next);
  return next;
}

/** Unwrap all items from a list into <p> blocks. */
export function unwrapListElementDetailed(list) {
  if (!list || !list.parentNode) return null;
  const parent = list.parentNode;
  const items = Array.from(list.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
  if (!items.length) {
    list.remove();
    return { blocks: [], lastBlock: null };
  }
  const blocks = [];
  let lastBlock = null;
  items.forEach((li) => {
    const block = document.createElement('p');
    copyManagedFormatting(li, block);
    while (li.firstChild) block.appendChild(li.firstChild);
    ensureNodeHasEditableContent(block);
    parent.insertBefore(block, list);
    blocks.push(block);
    lastBlock = block;
  });
  list.remove();
  return { blocks, lastBlock };
}

export function unwrapListElement(list) {
  const result = unwrapListElementDetailed(list);
  return result ? result.lastBlock : null;
}

/** Determine which <li> items fall within the given selection range. */
export function getSelectedListItems(list, range) {
  if (!list || !range) return [];
  const items = Array.from(list.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
  if (!items.length) return [];
  if (range.collapsed) {
    const direct = nearestAncestorTag(range.startContainer, 'li') || nearestAncestorTag(range.endContainer, 'li');
    if (direct && list.contains(direct)) return [direct];
  }
  return items.filter((item) => {
    try {
      const itemRange = document.createRange();
      itemRange.selectNodeContents(item);
      const s2e = range.compareBoundaryPoints(Range.START_TO_END, itemRange);
      const e2s = range.compareBoundaryPoints(Range.END_TO_START, itemRange);
      return s2e > 0 && e2s < 0;
    } catch (e) {
      return false;
    }
  });
}

/** Unwrap only the selected items from a list, splitting as needed. */
export function unwrapSelectedListItemsDetailed(list, selectedItems) {
  if (!list || !list.parentNode) return null;
  const items = Array.from(list.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
  const selectedSet = new Set((selectedItems || []).filter(Boolean));
  if (!items.length || !selectedSet.size) return null;
  if (selectedSet.size >= items.length) return unwrapListElementDetailed(list);

  const parent = list.parentNode;
  const beforeItems = [];
  const unwrappedItems = [];
  const afterItems = [];
  let crossedSelection = false;

  items.forEach((item) => {
    if (selectedSet.has(item)) {
      crossedSelection = true;
      unwrappedItems.push(item);
      return;
    }
    if (!crossedSelection) beforeItems.push(item);
    else afterItems.push(item);
  });

  if (beforeItems.length) {
    const beforeList = cloneListShell(list);
    if (beforeList) {
      beforeItems.forEach((item) => beforeList.appendChild(item));
      parent.insertBefore(beforeList, list);
    }
  }

  const blocks = [];
  let lastBlock = null;
  unwrappedItems.forEach((item) => {
    const block = document.createElement('p');
    copyManagedFormatting(item, block);
    while (item.firstChild) block.appendChild(item.firstChild);
    ensureNodeHasEditableContent(block);
    parent.insertBefore(block, list);
    blocks.push(block);
    lastBlock = block;
  });

  if (afterItems.length) {
    const afterList = cloneListShell(list);
    if (afterList) {
      afterItems.forEach((item) => afterList.appendChild(item));
      parent.insertBefore(afterList, list);
    }
  }

  list.remove();
  return { blocks, lastBlock };
}

export function unwrapSelectedListItems(list, selectedItems) {
  const result = unwrapSelectedListItemsDetailed(list, selectedItems);
  return result ? result.lastBlock : null;
}

/**
 * Expand heading targets by unwrapping list items into <p> blocks
 * before heading conversion.
 */
export function expandHeadingTargets(targets) {
  const prepared = [];
  const listSelections = new Map();

  (targets || []).forEach((target) => {
    if (!target || target === ctx.editor) return;
    const tag = (target.tagName || '').toLowerCase();
    if (tag === 'li') {
      const list = target.parentElement;
      const listTag = (list && list.tagName || '').toLowerCase();
      if (list && (listTag === 'ul' || listTag === 'ol')) {
        if (!listSelections.has(list)) listSelections.set(list, []);
        listSelections.get(list).push(target);
        return;
      }
    }
    prepared.push(target);
  });

  listSelections.forEach((items, list) => {
    const allItems = Array.from(list.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
    const result = items.length >= allItems.length
      ? unwrapListElementDetailed(list)
      : unwrapSelectedListItemsDetailed(list, items);
    if (result && Array.isArray(result.blocks)) {
      prepared.push(...result.blocks);
    }
  });

  return prepared.filter((node) => node && node !== ctx.editor && node.parentNode);
}

// ── Alignment ───────────────────────────────────────────────────

/** Wrap a node in a <p> with the given alignment. */
function wrapNodeAsAlignedParagraph(node, align) {
  if (!node || !node.parentNode) return null;
  const wrapper = document.createElement('p');
  applyFormattingToElement(wrapper, { align });
  node.parentNode.insertBefore(wrapper, node);
  wrapper.appendChild(node);
  return wrapper;
}

/** Apply text alignment to the blocks covered by the current selection. */
export function applyAlignValue(align) {
  const range = getCurrentSelectionRange();
  if (!range) {
    if (ctx.editor.firstChild) {
      const wrapper = document.createElement('p');
      applyFormattingToElement(wrapper, { align });
      while (ctx.editor.firstChild) wrapper.appendChild(ctx.editor.firstChild);
      ctx.editor.appendChild(wrapper);
    }
    return;
  }

  const blocks = getSelectionBlocks(range);
  if (blocks.length) {
    blocks.forEach((b) => {
      const next = extractManagedFormattingFromElement(b);
      next.align = align;
      applyFormattingToElement(b, next);
    });
    return;
  }

  const block = getSelectionBlockElement();
  if (block) {
    const next = extractManagedFormattingFromElement(block);
    next.align = align;
    applyFormattingToElement(block, next);
    return;
  }

  const top = topLevelEditorNode(range.startContainer);
  if (top) {
    if (top.nodeType === Node.ELEMENT_NODE && blockTags.has(top.tagName.toLowerCase())) {
      const next = extractManagedFormattingFromElement(top);
      next.align = align;
      applyFormattingToElement(top, next);
      return;
    }
    wrapNodeAsAlignedParagraph(top, align);
    return;
  }

  if (ctx.editor.childNodes.length) {
    const wrapper = document.createElement('p');
    applyFormattingToElement(wrapper, { align });
    while (ctx.editor.firstChild) wrapper.appendChild(ctx.editor.firstChild);
    ctx.editor.appendChild(wrapper);
    return;
  }

  const wrapper = document.createElement('p');
  applyFormattingToElement(wrapper, { align });
  wrapper.innerHTML = '<br>';
  range.insertNode(wrapper);
  const next = document.createRange();
  next.selectNodeContents(wrapper);
  next.collapse(true);
  const sel = window.getSelection && window.getSelection();
  if (sel) {
    sel.removeAllRanges();
    sel.addRange(next);
  }
}

/** Map execCommand names to alignment values. */
export function applyAlignFallback(cmd) {
  const map = {
    justifyLeft: 'left',
    justifyCenter: 'center',
    justifyRight: 'right',
    justifyFull: 'justify'
  };
  const align = map[cmd];
  if (!align) return;
  applyAlignValue(align);
}

// ── List commands ───────────────────────────────────────────────

/**
 * Toggle or convert a list (ul/ol) at the current selection.
 * Creates a new list, converts between types, or unwraps to paragraphs.
 */
export function applyListFallback(tagName) {
  const tag = (tagName || '').toLowerCase();
  if (tag !== 'ul' && tag !== 'ol') return;
  const range = getCurrentSelectionRange();
  if (!range) return;

  const currentList = getSelectionListElement();
  if (currentList) {
    const currentTag = (currentList.tagName || '').toLowerCase();
    const selectedItems = getSelectedListItems(currentList, range);
    if (currentTag === tag) {
      const lastBlock = selectedItems.length
        ? unwrapSelectedListItems(currentList, selectedItems)
        : unwrapListElement(currentList);
      if (lastBlock) moveCaretToNodeEnd(lastBlock);
      return;
    }
    const nextList = replaceListType(currentList, tag);
    if (nextList) moveCaretToNodeEnd(nextList.lastElementChild || nextList);
    return;
  }

  const list = document.createElement(tag);
  const blocks = getSelectionBlocks(range).filter((block) => block && block !== ctx.editor);
  const targets = expandHeadingTargets(blocks.length ? blocks : [getSelectionBlockElement()].filter(Boolean));

  if (targets.length) {
    const first = targets[0];
    const parent = first && first.parentNode ? first.parentNode : ctx.editor;
    parent.insertBefore(list, first);
    targets.forEach((block) => {
      const li = document.createElement('li');
      while (block.firstChild) li.appendChild(block.firstChild);
      ensureNodeHasEditableContent(li);
      list.appendChild(li);
      block.remove();
    });
  } else {
    const li = document.createElement('li');
    li.innerHTML = '<br>';
    list.appendChild(li);
    const anchor = topLevelEditorNode(range.startContainer);
    if (anchor && anchor.parentNode === ctx.editor) {
      ctx.editor.insertBefore(list, anchor);
    } else {
      ctx.editor.appendChild(list);
    }
  }
  moveCaretToNodeEnd(list.lastElementChild || list);
}

// ── Horizontal rule ─────────────────────────────────────────────

/** Insert an <hr> at the current cursor position. Only creates an empty block
 *  below if there is no existing content after the HR. */
export function applyHorizontalRuleFallback() {
  const range = getCurrentSelectionRange();
  if (!range) return;
  const hr = document.createElement('hr');
  const insertAt = range.cloneRange();
  try {
    if (!insertAt.collapsed) insertAt.deleteContents();
  } catch (e) {}
  insertAt.collapse(false);

  const anchor = getTopLevelAnchorFromRange(insertAt);
  if (anchor && anchor.parentNode === ctx.editor) {
    const anchorTag = (anchor.tagName || '').toLowerCase();
    const anchorText = ((anchor.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const anchorIsEmpty = !anchorText && blockTags.has(anchorTag)
      && !anchor.querySelector('img,hr,video,audio,canvas,svg,object,embed');
    ctx.editor.insertBefore(hr, anchor.nextSibling);
    if (anchorIsEmpty) anchor.remove();

    // Only add an empty paragraph if there is no block after the HR
    const nextBlock = hr.nextElementSibling;
    if (!nextBlock) {
      const p = document.createElement('p');
      p.setAttribute(pendingCaretAttr, '1');
      const placeholder = document.createElement('span');
      placeholder.setAttribute('data-mz-placeholder', '1');
      placeholder.textContent = '\u200B';
      p.appendChild(placeholder);
      ctx.editor.insertBefore(p, hr.nextSibling);
      ctx.pendingPostCommandCaretNode = p;
      selectEditablePlaceholder(p);
    } else {
      ctx.pendingPostCommandCaretNode = nextBlock;
      moveCaretToNodeStart(nextBlock);
    }
    return;
  }

  try {
    insertAt.insertNode(hr);
  } catch (e) {
    ctx.editor.appendChild(hr);
  }
  const nextBlock = hr.nextElementSibling;
  if (!nextBlock) {
    const p = document.createElement('p');
    p.setAttribute(pendingCaretAttr, '1');
    const placeholder = document.createElement('span');
    placeholder.setAttribute('data-mz-placeholder', '1');
    placeholder.textContent = '\u200B';
    if (hr.parentNode) hr.parentNode.insertBefore(p, hr.nextSibling);
    else ctx.editor.appendChild(p);
    ctx.pendingPostCommandCaretNode = p;
    selectEditablePlaceholder(p);
  } else {
    ctx.pendingPostCommandCaretNode = nextBlock;
    moveCaretToNodeStart(nextBlock);
  }
}

/** Replace a block element's tag (e.g. <p> → <h1>) preserving content. */
export function replaceBlockWithTag(block, tagName) {
  if (!block || !block.parentNode) return null;
  const tag = (tagName || '').toLowerCase();
  if (!tag) return null;
  if ((block.tagName || '').toLowerCase() === tag) return block;
  const next = document.createElement(tag);
  copyManagedFormatting(block, next);
  while (block.firstChild) next.appendChild(block.firstChild);
  block.parentNode.replaceChild(next, block);
  return next;
}
