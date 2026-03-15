/**
 * @module core/dom-utils
 * Shared DOM utility functions: HTML escaping, text conversion,
 * content detection, node helpers, and hashing.
 */
import { selectionMarkerStartAttr, selectionMarkerEndAttr, selectionMarkerCaretAttr, htmlLikeTagRe } from './constants.js';

/**
 * Escape HTML special characters in a string.
 * @param {string} text - Raw text to escape.
 * @returns {string} HTML-safe string.
 */
export function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Convert plain text to semantic HTML with <p> and <br> tags.
 * @param {string} text - Plain text input.
 * @returns {string} HTML string.
 */
export function plainTextToHtml(text) {
  const normalized = (text || '').replace(/\r\n/g, '\n');
  if (!normalized.trim()) return '';
  const paragraphs = normalized.split(/\n{2,}/);
  return paragraphs
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/**
 * Check whether a string looks like stored HTML content.
 * @param {string} text - The string to check.
 * @returns {boolean}
 */
export function looksLikeStoredHtml(text) {
  return typeof text === 'string' && htmlLikeTagRe.test(text);
}

/**
 * Convert HTML to plain text by parsing it and extracting textContent.
 * @param {string} html - HTML string.
 * @returns {string} Plain text.
 */
export function htmlToPlainText(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.innerText || tmp.textContent || '').replace(/\u00a0/g, ' ');
}

/**
 * Check whether a node or fragment has meaningful content
 * (non-whitespace text or structural child elements).
 * @param {Node} node - The node to check.
 * @returns {boolean}
 */
export function hasMeaningfulSanitizedContent(node) {
  if (!node) return false;
  const text = String(node.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
  if (text) return true;
  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return false;
  return !!node.querySelector?.(`br,img,hr,video,audio,canvas,svg,object,embed,ul,ol,[${selectionMarkerStartAttr}],[${selectionMarkerEndAttr}],[${selectionMarkerCaretAttr}]`);
}

/**
 * Ensure a block-level node contains at least a <br> for editability.
 * @param {Element} node - The block element to check.
 */
export function ensureNodeHasEditableContent(node) {
  if (!node) return;
  const hasText = ((node.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim().length > 0;
  const hasStructuralChild = !!node.querySelector?.(`br,img,hr,video,audio,canvas,svg,object,embed,input,textarea,select,button,ul,ol,[${selectionMarkerStartAttr}],[${selectionMarkerEndAttr}],[${selectionMarkerCaretAttr}]`);
  if (!hasText && !hasStructuralChild) node.innerHTML = '<br>';
}

/**
 * Find the closest ancestor matching a selector, starting from an event target
 * which may be a text node.
 * @param {EventTarget|Node} target - The starting node.
 * @param {string} selector - CSS selector to match.
 * @returns {Element|null}
 */
export function closestFromEventTarget(target, selector) {
  if (!target) return null;
  if (target instanceof Element) return target.closest(selector);
  const parent = target.parentElement || null;
  return parent ? parent.closest(selector) : null;
}

/**
 * FNV-1a 32-bit hash of a string (unsigned).
 * @param {string} input - The string to hash.
 * @returns {number} Unsigned 32-bit hash.
 */
export function hash32(input) {
  const str = String(input || '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0);
}
