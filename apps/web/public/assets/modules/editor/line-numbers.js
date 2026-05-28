/**
 * @module editor/line-numbers
 * Visual line-number rendering alongside the contenteditable editor.
 * Measures actual rendered heights to account for text wrapping.
 */
import ctx from '../core/context.js';
import { blockTags } from '../core/constants.js';

/** Block-level tags that count as individual lines. */
const LINE_BLOCK_TAGS = blockTags;

/** Sync the line-number gutter scroll position to the editor. */
export function syncLineNumberScroll() {
  if (!ctx.lineNumbers) return;
  const maxScrollTop = Math.max(0, (ctx.editor.scrollHeight || 0) - (ctx.editor.clientHeight || 0));
  const safeScrollTop = Math.max(0, Math.min(ctx.editor.scrollTop || 0, maxScrollTop));
  if (ctx.lineNumbers.scrollTop !== safeScrollTop) {
    ctx.lineNumbers.scrollTop = safeScrollTop;
  }
}

/** @returns {boolean} Whether the element has renderable content (text, images, etc.). */
function hasRenderableNodeContent(el) {
  if (!el || !(el instanceof Element)) return false;
  try {
    if (el.querySelector('img,hr,video,audio,canvas,svg,object,embed,input,textarea,select,button')) return true;
  } catch (e) {}
  const txt = ((el.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
  return txt.length > 0;
}

/** @returns {number} Computed line-height in pixels (with fallback). */
function getComputedLineHeightPx(node, fallback) {
  const safeFallback = Math.max(16, Number(fallback) || 16);
  if (!(node instanceof Element)) return safeFallback;
  try {
    const raw = parseFloat(getComputedStyle(node).lineHeight || '');
    if (Number.isFinite(raw) && raw > 0) return raw;
  } catch (e) {}
  return safeFallback;
}

/** @returns {number} Measured visual height of a DOM node in pixels. */
function measureNodeVisualHeight(node) {
  if (!node) return 0;
  if (node instanceof Element) {
    const rect = node.getBoundingClientRect();
    return rect && Number.isFinite(rect.height) ? rect.height : 0;
  }
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.COMMENT_NODE) {
    const parent = node.parentElement;
    if (!parent) return 0;
    try {
      const range = document.createRange();
      range.selectNodeContents(parent);
      const rect = range.getBoundingClientRect();
      return rect && Number.isFinite(rect.height) ? rect.height : 0;
    } catch (e) {}
  }
  return 0;
}

/** @returns {number} Number of visual lines a node occupies. */
function countVisualLines(node, fallbackLineHeight) {
  const lineHeight = Math.max(1, getComputedLineHeightPx(node instanceof Element ? node : node && node.parentElement, fallbackLineHeight));
  const height = measureNodeVisualHeight(node);
  if (height > 0) return Math.max(1, Math.round(height / lineHeight));
  if (node instanceof Element && hasRenderableNodeContent(node)) return 1;
  if (node && node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').trim().length ? 1 : 0;
  return 0;
}

/** Measure visual lines + total pixel height for a buffer of inline/text nodes.
 *  @returns {{lines:number, height:number}} */
function measureInlineBufferVisualLines(nodes, fallbackLineHeight) {
  const filtered = Array.from(nodes || []).filter(Boolean);
  if (!filtered.length) return { lines: 0, height: 0 };
  const first = filtered[0];
  const last = filtered[filtered.length - 1];
  try {
    const range = document.createRange();
    range.setStartBefore(first);
    range.setEndAfter(last);
    const rect = range.getBoundingClientRect();
    if (rect && rect.height > 0) {
      const lines = Math.max(1, Math.round(rect.height / Math.max(1, fallbackLineHeight)));
      return { lines, height: rect.height };
    }
  } catch (e) {}
  const has = filtered.some((node) => {
    if (node.nodeType === Node.TEXT_NODE) return (node.nodeValue || '').trim().length > 0;
    return node instanceof Element && hasRenderableNodeContent(node);
  });
  return has ? { lines: 1, height: fallbackLineHeight } : { lines: 0, height: 0 };
}

/** Push `count` descriptor entries of `tagName` type, each carrying the
 *  measured per-visual-line pixel height so the gutter row can match the
 *  editor's ACTUAL rendered line box (not a fixed `em`, which drifts across
 *  browsers/zoom/font-metrics as the row count grows). */
function appendLineNumberDescriptors(target, count, tagName, perLineHeight) {
  const safeCount = Math.max(1, Number(count) || 0);
  const safeTag = String(tagName || 'base').toLowerCase();
  const h = Number.isFinite(perLineHeight) && perLineHeight > 0 ? perLineHeight : 0;
  for (let idx = 0; idx < safeCount; idx += 1) {
    target.push({ tag: safeTag, height: h });
  }
}

/**
 * Walk the editor DOM and build a descriptor array where each entry
 * represents one visual line and its block type (for CSS styling).
 */
function collectLineNumberDescriptors() {
  const descriptors = [];
  const baseLineHeight = getComputedLineHeightPx(ctx.editor, 25.6);
  const inlineBuffer = [];

  // Emit `count` rows for a block, each sized to the block's MEASURED height
  // divided across its visual lines, so the gutter tracks the real rendered
  // geometry instead of a fixed line-height.
  const emitMeasuredBlock = (node, tag) => {
    const lh = getComputedLineHeightPx(node, baseLineHeight);
    const count = countVisualLines(node, lh);
    const measured = measureNodeVisualHeight(node);
    const perLine = (measured > 0 && count > 0) ? measured / count : lh;
    appendLineNumberDescriptors(descriptors, count, tag, perLine);
  };

  const flushInlineBuffer = () => {
    const { lines, height } = measureInlineBufferVisualLines(inlineBuffer, baseLineHeight);
    if (lines > 0) appendLineNumberDescriptors(descriptors, lines, 'base', height / lines);
    inlineBuffer.length = 0;
  };

  Array.from(ctx.editor.childNodes || []).forEach((node) => {
    if (!node) return;
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.nodeValue || '').trim()) inlineBuffer.push(node);
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'br') {
      flushInlineBuffer();
      appendLineNumberDescriptors(descriptors, 1, 'base', baseLineHeight);
      return;
    }
    if (tag === 'hr') {
      flushInlineBuffer();
      const hrHeight = measureNodeVisualHeight(node);
      appendLineNumberDescriptors(descriptors, 1, 'hr', hrHeight > 0 ? hrHeight : baseLineHeight);
      return;
    }
    if (tag === 'ul' || tag === 'ol') {
      flushInlineBuffer();
      const items = Array.from(node.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
      if (!items.length) {
        appendLineNumberDescriptors(descriptors, 1, 'li', baseLineHeight);
        return;
      }
      items.forEach((li) => emitMeasuredBlock(li, 'li'));
      return;
    }
    if (LINE_BLOCK_TAGS.has(tag)) {
      flushInlineBuffer();
      emitMeasuredBlock(node, tag);
      return;
    }
    if (hasRenderableNodeContent(node)) inlineBuffer.push(node);
  });
  flushInlineBuffer();
  if (!descriptors.length) descriptors.push({ tag: 'base', height: baseLineHeight });
  return descriptors;
}

/**
 * Re-render the line-number gutter to reflect the current editor content.
 * Called after any content or layout change.
 */
export function renderLineNumbers() {
  if (!ctx.lineNumbers || !ctx.lineNumbersInner) return;
  const lineDescriptors = collectLineNumberDescriptors();

  const frag = document.createDocumentFragment();
  for (let idx = 0; idx < lineDescriptors.length; idx += 1) {
    const desc = lineDescriptors[idx] || { tag: 'base', height: 0 };
    const row = document.createElement('div');
    row.className = `line-number line-number--${desc.tag || 'base'}`;
    row.textContent = String(idx + 1);
    // Match the editor's actual rendered line height (measured) so the gutter
    // can't drift away from the text as the document grows. Fractional px is
    // intentional — it keeps cumulative positions exact.
    if (desc.height > 0) {
      row.style.height = `${desc.height}px`;
      row.style.lineHeight = `${desc.height}px`;
    }
    frag.appendChild(row);
  }
  ctx.lineNumbersInner.replaceChildren(frag);
  syncLineNumberScroll();
}

/** Register on ctx for cross-module access. */
export function initLineNumbers() {
  ctx.renderLineNumbers = renderLineNumbers;
}
