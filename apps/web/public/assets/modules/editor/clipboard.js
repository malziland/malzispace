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
