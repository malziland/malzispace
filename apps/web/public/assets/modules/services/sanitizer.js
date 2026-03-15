/**
 * @module services/sanitizer
 * HTML sanitization: tag normalization, attribute cleanup,
 * structure validation, and stored-content conversion.
 */
import {
  allowedTags, blockTags, pendingCaretAttr,
  selectionMarkerStartAttr, selectionMarkerEndAttr, selectionMarkerCaretAttr,
} from '../core/constants.js';
import {
  normalizeCssColor, normalizeCssBackground,
  extractManagedFormattingFromElement, applyFormattingToElement,
  mergeFormatting, extractFormattingFromStyle, copyManagedFormatting,
} from '../core/formatting.js';
import {
  hasMeaningfulSanitizedContent, ensureNodeHasEditableContent,
  plainTextToHtml, looksLikeStoredHtml,
} from '../core/dom-utils.js';

/**
 * Normalize the structure of a sanitized document fragment.
 * Splits nested blocks out of container elements, ensures empty block
 * elements contain a <br>, cleans up list items, and wraps stray
 * top-level inline nodes into <p> blocks.
 * @param {DocumentFragment} fragment - The fragment to normalize in place.
 * @returns {void}
 */
export function normalizeSanitizedStructure(fragment) {
  if (!fragment) return;
  const nestedBlockTags = new Set(['p','div','blockquote','ul','ol','hr']);
  let changed = true;
  while (changed) {
    changed = false;
    const containers = Array.from(fragment.querySelectorAll('p,div,blockquote'));
    for (const container of containers) {
      if (!container || !container.parentNode) continue;
      const nestedBlock = Array.from(container.childNodes || []).find((child) =>
        child instanceof Element && nestedBlockTags.has((child.tagName || '').toLowerCase())
      );
      if (!nestedBlock) continue;
      const parent = container.parentNode;
      const cloneTag = (container.tagName || 'div').toLowerCase();
      const before = document.createElement(cloneTag);
      copyManagedFormatting(container, before);
      while (container.firstChild && container.firstChild !== nestedBlock) {
        before.appendChild(container.firstChild);
      }
      if (hasMeaningfulSanitizedContent(before)) {
        parent.insertBefore(before, container);
      }
      parent.insertBefore(nestedBlock, container);
      if (!hasMeaningfulSanitizedContent(container)) {
        container.remove();
      }
      changed = true;
      break;
    }
  }

  Array.from(fragment.querySelectorAll('p,div,h1,h2,h3,blockquote,li')).forEach((node) => {
    if (!hasMeaningfulSanitizedContent(node)) node.innerHTML = '<br>';
  });

  Array.from(fragment.querySelectorAll('ul,ol')).forEach((list) => {
    Array.from(list.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!(child.nodeValue || '').trim()) { child.remove(); return; }
        // Wrap bare text inside list into <li>.
        const li = document.createElement('li');
        child.replaceWith(li);
        li.appendChild(document.createTextNode(child.nodeValue));
        return;
      }
      if (child instanceof Element && (child.tagName || '').toLowerCase() !== 'li') {
        child.remove();
      }
    });
    const items = Array.from(list.children || []).filter((child) => ((child.tagName || '').toLowerCase() === 'li'));
    if (!items.length) {
      list.remove();
      return;
    }
    items.forEach((item) => {
      const unwrapTags = new Set(['p','div','blockquote']);
      let pass = true;
      while (pass) {
        pass = false;
        Array.from(item.children || []).forEach((child) => {
          if (child instanceof Element && unwrapTags.has((child.tagName || '').toLowerCase())) {
            const parent = child.parentNode;
            while (child.firstChild) parent.insertBefore(child.firstChild, child);
            child.remove();
            pass = true;
          }
        });
      }
      if (!hasMeaningfulSanitizedContent(item)) item.innerHTML = '<br>';
    });
  });

  const topLevelNodes = Array.from(fragment.childNodes || []);
  const buffered = [];
  const flushBuffered = (beforeNode) => {
    if (!buffered.length) return;
    const block = document.createElement('p');
    buffered.forEach((node) => block.appendChild(node));
    ensureNodeHasEditableContent(block);
    fragment.insertBefore(block, beforeNode || null);
    buffered.length = 0;
  };

  topLevelNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      if ((node.nodeValue || '').trim()) buffered.push(node);
      else node.remove();
      return;
    }
    if (!(node instanceof Element)) return;
    const tag = (node.tagName || '').toLowerCase();
    if (nestedBlockTags.has(tag)) {
      flushBuffered(node);
      return;
    }
    buffered.push(node);
  });
  flushBuffered(null);
}

/**
 * Sanitize an HTML string for safe use in the editor.
 * Removes dangerous elements, normalizes tags (font->span, b->strong, i->em),
 * strips disallowed attributes, preserves managed formatting, sanitizes links,
 * removes empty inline wrappers, and normalizes document structure.
 * @param {string} input - The raw HTML string to sanitize.
 * @returns {string} The sanitized HTML, or empty string if no meaningful content.
 */
export function sanitizeEditorHtml(input) {
  const tpl = document.createElement('template');
  tpl.innerHTML = input || '';
  tpl.content.querySelectorAll('script,style,iframe,object,embed,link,meta,form,input,button,textarea,select').forEach((el) => el.remove());
  const textWalker = document.createTreeWalker(tpl.content, NodeFilter.SHOW_TEXT, null);
  let textNode = textWalker.nextNode();
  while (textNode) {
    const cleaned = String(textNode.nodeValue || '').replace(/\u200b/g, '');
    if (cleaned !== textNode.nodeValue) textNode.nodeValue = cleaned;
    textNode = textWalker.nextNode();
  }

  const all = Array.from(tpl.content.querySelectorAll('*'));
  all.forEach((el) => {
    const sourceTag = el.tagName.toLowerCase();
    let tag = el.tagName.toLowerCase();
    if (tag === 'font') tag = 'span';
    if (tag === 'b') tag = 'strong';
    if (tag === 'i') tag = 'em';

    let target = el;
    if (tag !== el.tagName.toLowerCase()) {
      const renamed = document.createElement(tag);
      Array.from(el.attributes).forEach((attr) => renamed.setAttribute(attr.name, attr.value));
      while (el.firstChild) renamed.appendChild(el.firstChild);
      el.replaceWith(renamed);
      target = renamed;
    }

    if (!allowedTags.has(tag)) {
      const parent = target.parentNode;
      if (!parent) return;
      while (target.firstChild) parent.insertBefore(target.firstChild, target);
      parent.removeChild(target);
      return;
    }

    const format = extractManagedFormattingFromElement(target);
    if (sourceTag === 'font') {
      mergeFormatting(format, {
        fg: normalizeCssColor(target.getAttribute('color') || ''),
        bg: normalizeCssBackground(target.getAttribute('bgcolor') || '')
      });
    }
    const alignAttr = (target.getAttribute('align') || '').trim().toLowerCase();
    if (alignAttr && blockTags.has(tag) && ['left','right','center','justify','start','end'].includes(alignAttr)) {
      format.align = alignAttr;
    }
    mergeFormatting(format, extractFormattingFromStyle(target.getAttribute('style') || '', tag));

    Array.from(target.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name === pendingCaretAttr || name === 'data-mz-placeholder') {
        target.removeAttribute(attr.name);
        return;
      }
      if (name === selectionMarkerStartAttr || name === selectionMarkerEndAttr || name === selectionMarkerCaretAttr) {
        return;
      }
      if (tag === 'a' && name === 'href') {
        let href = (target.getAttribute('href') || '').trim();
        if (!href) {
          target.removeAttribute('href');
          return;
        }
        if (!/^(https?:|mailto:|tel:|#)/i.test(href)) {
          href = 'https://' + href.replace(/^\/+/, '');
        }
        try {
          if (!href.startsWith('#')) {
            const parsed = new URL(href, window.location.origin);
            if (!['http:', 'https:', 'mailto:', 'tel:'].includes(parsed.protocol)) {
              target.removeAttribute('href');
              return;
            }
            href = parsed.toString();
          }
        } catch (e) {
          target.removeAttribute('href');
          return;
        }
        target.setAttribute('href', href);
        target.setAttribute('target', '_blank');
        target.setAttribute('rel', 'noopener noreferrer');
        return;
      }
      if (name === 'class' || name.startsWith('data-mz-')) {
        return;
      }
      target.removeAttribute(attr.name);
    });
    applyFormattingToElement(target, format);
  });

  tpl.content.querySelectorAll('span,strong,em,u,s').forEach((el) => {
    if (!(el instanceof Element)) return;
    if (
      el.hasAttribute(selectionMarkerStartAttr)
      || el.hasAttribute(selectionMarkerEndAttr)
      || el.hasAttribute(selectionMarkerCaretAttr)
    ) {
      return;
    }
    const text = ((el.textContent || '') + '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
    const hasStructuredChild = !!el.querySelector('img,hr,video,audio,canvas,svg,object,embed,input,textarea,select,button,ul,ol,a,br');
    if (!text && !hasStructuredChild) { el.remove(); return; }
    // Unwrap plain <span> elements that carry no formatting attributes
    if ((el.tagName || '').toLowerCase() === 'span'
        && !el.className
        && !Array.from(el.attributes).some((a) => a.name.startsWith('data-mz-'))) {
      const parent = el.parentNode;
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el);
        parent.removeChild(el);
      }
    }
  });

  normalizeSanitizedStructure(tpl.content);

  const html = tpl.innerHTML.trim();
  if (!html) return '';
  return hasMeaningfulSanitizedContent(tpl.content) ? html : '';
}

/**
 * Convert raw stored content (plain text or HTML) to sanitized HTML.
 * Detects whether the input looks like HTML and sanitizes it, or converts
 * plain text to paragraph-wrapped HTML.
 * @param {string} raw - The raw stored content string.
 * @returns {string} Sanitized HTML suitable for the editor.
 */
export function storedContentToHtml(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  if (looksLikeStoredHtml(raw)) return sanitizeEditorHtml(raw);
  return plainTextToHtml(raw);
}
