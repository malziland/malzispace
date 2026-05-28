/**
 * @module editor/clipboard
 * Copy and paste handlers for the contenteditable editor.
 * Ensures pasted HTML is sanitized and copied text carries
 * explicit color for compatibility with external applications.
 */
import ctx from '../core/context.js';
import { sanitizeEditorHtml } from '../services/sanitizer.js';
import { plainTextToHtml, htmlToPlainText } from '../core/dom-utils.js';
import {
  getEditorStoredContent,
  getEditorSelectionOffsets,
  saveEditorRange,
  editorNeedsInputNormalization,
} from '../services/selection.js';
import { pushUndoSnapshot } from '../services/history.js';
import { normalizeEditorMarkupPreserveSelection } from './inline-format.js';
import { participantInsertBlocked } from './protect-guard.js';

const OWNER_TEXT_CLASS = 'mz-owner-text';
const OWNER_SELECTOR = '.' + OWNER_TEXT_CLASS;

// ── Text copying ────────────────────────────────────────────────

/** Copy plain text to the clipboard (with fallback). */
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (_) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.className = 'mz-copy-buffer';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return true;
  } catch (_) {}
  return false;
}

/**
 * Wrap sanitized HTML in a container with explicit black text color
 * so that external apps (Word, Google Docs) render it correctly.
 */
export function prepareHtmlForClipboard(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html || '';
  tpl.content.querySelectorAll('[data-mz-fg]').forEach((el) => {
    el.removeAttribute('data-mz-fg');
    Array.from(el.classList).forEach((cls) => {
      if (/^mz-fg-/.test(cls)) el.classList.remove(cls);
    });
  });
  return '<div style="color:#000">' + tpl.innerHTML + '</div>';
}

/**
 * Wrap unmarked text in a sanitized paste fragment with `.mz-owner-text` so
 * that owner-pasted content is protected immediately (no off→on retoggle
 * required). Idempotent: text already inside an owner span is left alone.
 */
function wrapPasteAsOwner(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const BLOCK_SEL = 'p,div,li,blockquote,h1,h2,h3,h4,h5,h6';
  const blocks = tpl.content.querySelectorAll(BLOCK_SEL);
  if (blocks.length === 0) {
    if ((tpl.content.textContent || '').trim()) {
      const span = document.createElement('span');
      span.className = OWNER_TEXT_CLASS;
      while (tpl.content.firstChild) span.appendChild(tpl.content.firstChild);
      tpl.content.appendChild(span);
    }
    return tpl.innerHTML;
  }
  for (const block of blocks) {
    if (!(block.textContent || '').trim()) continue;
    const hasOwner = !!block.querySelector(OWNER_SELECTOR);
    if (hasOwner) {
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const textNodes = [];
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const tn of textNodes) {
        if (!(tn.textContent || '').trim()) continue;
        const parent = tn.parentElement;
        if (!parent || parent.closest(OWNER_SELECTOR)) continue;
        const wrap = document.createElement('span');
        wrap.className = OWNER_TEXT_CLASS;
        parent.insertBefore(wrap, tn);
        wrap.appendChild(tn);
      }
    } else {
      const span = document.createElement('span');
      span.className = OWNER_TEXT_CLASS;
      while (block.firstChild) span.appendChild(block.firstChild);
      block.appendChild(span);
    }
  }
  return tpl.innerHTML;
}

/** Copy rich text (HTML + plain text) to the clipboard. */
export async function copyRichText(html, plainText) {
  const safeHtml = sanitizeEditorHtml(html || '');
  const safeText = typeof plainText === 'string' ? plainText : htmlToPlainText(safeHtml);
  if (!safeHtml) return copyText(safeText);
  const exportHtml = prepareHtmlForClipboard(safeHtml);

  try {
    if (navigator.clipboard && typeof navigator.clipboard.write === 'function' && window.ClipboardItem) {
      const item = new window.ClipboardItem({
        'text/html': new Blob([exportHtml], { type: 'text/html' }),
        'text/plain': new Blob([safeText], { type: 'text/plain' })
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch (_) {}

  let host = null;
  try {
    host = document.createElement('div');
    host.setAttribute('contenteditable', 'true');
    host.setAttribute('aria-hidden', 'true');
    host.className = 'mz-copy-rich-buffer';
    host.innerHTML = exportHtml;
    document.body.appendChild(host);

    const sel = window.getSelection && window.getSelection();
    const saved = [];
    if (sel) {
      for (let i = 0; i < sel.rangeCount; i++) {
        saved.push(sel.getRangeAt(i).cloneRange());
      }
      const range = document.createRange();
      range.selectNodeContents(host);
      sel.removeAllRanges();
      sel.addRange(range);
    }

    const ok = document.execCommand('copy');

    if (sel) {
      sel.removeAllRanges();
      saved.forEach((r) => sel.addRange(r));
    }

    if (ok) return true;
  } catch (_) {}
  finally {
    if (host && host.parentNode) host.parentNode.removeChild(host);
  }

  return copyText(safeText);
}

/** Temporarily show "Copied" text on a button. */
export function setButtonCopiedState(btn, defaultText) {
  if (!btn) return;
  const { t } = await_t();
  btn.textContent = t('copy.copied');
  setTimeout(() => { btn.textContent = defaultText; }, 1600);
}

// Lazy t() import
function await_t() {
  return { t: (key, vars) => {
    if (window.MZ_I18N && typeof window.MZ_I18N.t === 'function') {
      return window.MZ_I18N.t(key, vars);
    }
    return key;
  }};
}

// ── Event handlers ──────────────────────────────────────────────

/** Handle native copy event: intercept and apply black text color. */
function handleCopy(evt) {
  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  evt.preventDefault();
  const range = sel.getRangeAt(0);
  const frag = range.cloneContents();
  const wrap = document.createElement('div');
  wrap.appendChild(frag);
  const rawHtml = wrap.innerHTML || '';
  const safeHtml = sanitizeEditorHtml(rawHtml);
  const exportHtml = prepareHtmlForClipboard(safeHtml);
  const plainText = htmlToPlainText(safeHtml);
  const clip = evt.clipboardData;
  if (clip) {
    clip.setData('text/html', exportHtml);
    clip.setData('text/plain', plainText);
  }
}

/** Handle native paste event: sanitize pasted HTML. */
function handlePaste(evt) {
  if (ctx.expiredShown) { evt.preventDefault(); return; }
  const clip = evt.clipboardData || (window.clipboardData);
  if (!clip) return;
  evt.preventDefault();

  // Append-only protection: a participant must not paste over, into, or
  // ahead of owner-marked content. This handler performs its own manual
  // delete+insert, so it bypasses the beforeinput guard and needs its own
  // check. The owner may paste freely (their paste is wrapped as owner text).
  if (ctx.appendOnly && !ctx.isOwner) {
    const protSel = window.getSelection && window.getSelection();
    const protRange = protSel && protSel.rangeCount ? protSel.getRangeAt(0) : null;
    if (!protRange || participantInsertBlocked(protRange)) {
      if (typeof ctx.showProtectToast === 'function') ctx.showProtectToast('space.protect.toast.modify');
      return;
    }
  }

  let html = '';
  let plain = '';
  try { html = clip.getData('text/html') || ''; } catch (e) {}
  try { plain = clip.getData('text/plain') || ''; } catch (e) {}

  pushUndoSnapshot(getEditorStoredContent());

  let sanitized = '';
  if (html) {
    sanitized = sanitizeEditorHtml(html);
    if (sanitized) {
      const pasteTpl = document.createElement('template');
      pasteTpl.innerHTML = sanitized;
      // Strip foreground colors so pasted text uses the editor's default color.
      pasteTpl.content.querySelectorAll('[data-mz-fg]').forEach((el) => {
        el.removeAttribute('data-mz-fg');
        Array.from(el.classList).forEach((cls) => {
          if (/^mz-fg-/.test(cls)) el.classList.remove(cls);
        });
      });
      // Remove empty blocks that are paste artifacts (only <br> or whitespace).
      pasteTpl.content.querySelectorAll('p,div').forEach((el) => {
        const txt = (el.textContent || '').replace(/\u200b/g, '').replace(/\u00a0/g, ' ').trim();
        if (!txt) el.remove();
      });
      sanitized = pasteTpl.innerHTML;
    }
  }
  if (!sanitized && plain) {
    sanitized = plainTextToHtml(plain);
  }
  if (!sanitized) return;

  // Owner pasting while protect is on must produce owner-marked content;
  // otherwise the paste lands unprotected until the next retro-mark.
  if (ctx.appendOnly && ctx.isOwner) {
    sanitized = wrapPasteAsOwner(sanitized);
  }

  const sel = window.getSelection && window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  range.deleteContents();
  const tpl = document.createElement('template');
  tpl.innerHTML = sanitized;
  const frag = tpl.content;
  const lastChild = frag.lastChild;
  range.insertNode(frag);
  if (lastChild) {
    const next = document.createRange();
    next.setStartAfter(lastChild);
    next.collapse(true);
    sel.removeAllRanges();
    sel.addRange(next);
  }
  saveEditorRange();
  if (editorNeedsInputNormalization()) {
    normalizeEditorMarkupPreserveSelection(getEditorSelectionOffsets());
  }
  ctx.editor.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Attach copy/paste event listeners to the editor. */
export function initClipboard() {
  ctx.editor.addEventListener('copy', handleCopy);
  ctx.editor.addEventListener('paste', handlePaste);
}
