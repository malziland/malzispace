/**
 * @module ui/modals
 * QR-code share modal and link-insert modal management.
 * Also contains link-click handling inside the editor.
 */
import ctx, { t } from '../core/context.js';
import { closestFromEventTarget } from '../core/dom-utils.js';
import {
  saveEditorRange,
  restoreEditorRange,
  getCurrentSelectionRange,
} from '../services/selection.js';

// ── Link normalization ──────────────────────────────────────────

/** Normalize a raw URL input, prepending https:// if missing. */
export function normalizeLinkInput(raw) {
  let value = (raw || '').trim();
  if (!value) return '';
  if (!/^(https?:|mailto:|tel:|#)/i.test(value)) {
    value = 'https://' + value;
  }
  return value;
}

// ── QR modal ────────────────────────────────────────────────────

/** Close the QR share modal. */
export function closeQrModal() {
  if (!ctx.qrModal || ctx.qrModal.hidden) return;
  ctx.qrModal.hidden = true;
  try { document.body.classList.remove('has-modal-open'); } catch (e) {}
}

/** Render the QR code inside the modal. */
function renderQrCode() {
  if (!ctx.qrCodeEl) return;
  const url = location.href;
  if (ctx.qrLinkText) ctx.qrLinkText.textContent = url;
  ctx.qrCodeEl.innerHTML = '';
  if (window.QRCode) {
    new window.QRCode(ctx.qrCodeEl, {
      text: url,
      width: 256,
      height: 256,
      colorDark: '#0b0f14',
      colorLight: '#ffffff',
      correctLevel: window.QRCode.CorrectLevel ? window.QRCode.CorrectLevel.M : 0
    });
    return;
  }
  ctx.qrCodeEl.textContent = t('qr.loadFailed');
}

/** Open the QR share modal. */
export function openQrModal() {
  if (!ctx.qrModal) return;
  renderQrCode();
  document.body.classList.add('has-modal-open');
  ctx.qrModal.hidden = false;
}

// ── Link modal ──────────────────────────────────────────────────

/** Close the link-insert modal and resolve with the entered value. */
export function closeLinkModal(result = '') {
  if (!ctx.linkModal) return;
  const resolver = ctx.linkModalResolver;
  ctx.linkModalResolver = null;
  ctx.linkModal.hidden = true;
  try {
    if (!ctx.qrModal || ctx.qrModal.hidden) document.body.classList.remove('has-modal-open');
  } catch (e) {}
  if (resolver) resolver(String(result || ''));
}

/**
 * Open the link-insert modal.
 * @returns {Promise<string>} Resolves with the entered URL or ''.
 */
export function openLinkModal(initialValue = 'https://') {
  if (!ctx.linkModal || !ctx.linkUrlInput) return Promise.resolve('');
  if (typeof ctx.linkModalResolver === 'function') {
    try { ctx.linkModalResolver(''); } catch (e) {}
    ctx.linkModalResolver = null;
  }
  saveEditorRange();
  try { document.body.classList.add('has-modal-open'); } catch (e) {}
  ctx.linkModal.hidden = false;
  const nextValue = String(initialValue || '').trim() || 'https://';
  ctx.linkUrlInput.value = nextValue;
  return new Promise((resolve) => {
    ctx.linkModalResolver = resolve;
    setTimeout(() => {
      try {
        ctx.linkUrlInput.focus();
        ctx.linkUrlInput.select();
      } catch (e) {}
    }, 0);
  });
}

// ── Editor link click ───────────────────────────────────────────

/** Open an href from inside the editor in a new tab. */
function openEditorLink(href) {
  const url = normalizeLinkInput(href || '');
  if (!url) return false;
  if (/^(mailto:|tel:)/i.test(url)) {
    window.location.href = url;
    return true;
  }
  if (url.startsWith('#')) {
    try {
      const target = document.querySelector(url);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return true;
      }
    } catch (e) {}
  }
  try { window.open(url, '_blank', 'noopener,noreferrer'); } catch (e) {}
  return true;
}

// ── Event wiring ────────────────────────────────────────────────

/** Attach all modal and link event listeners. */
export function initModals() {
  ctx.closeQrModal = closeQrModal;
  ctx.openLinkModal = openLinkModal;
  ctx.closeLinkModal = closeLinkModal;

  // Editor link click
  ctx.editor.addEventListener('click', (evt) => {
    if (ctx.expiredShown) return;
    const link = closestFromEventTarget(evt.target, 'a[href]');
    if (!link || !ctx.editor.contains(link)) return;
    const range = getCurrentSelectionRange();
    if (range && !range.collapsed) return;
    const href = (link.getAttribute('href') || '').trim();
    if (!href) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (typeof evt.stopImmediatePropagation === 'function') evt.stopImmediatePropagation();
    openEditorLink(href);
  });

  // QR modal
  ctx.showQrBtn?.addEventListener('click', openQrModal);
  ctx.closeQrModalBtn?.addEventListener('click', closeQrModal);
  ctx.qrBackdrop?.addEventListener('click', closeQrModal);

  // Link modal
  ctx.cancelLinkModalBtn?.addEventListener('click', () => {
    closeLinkModal('');
    try {
      ctx.editor.focus();
      restoreEditorRange();
      ctx.updateToolbarState();
    } catch (e) {}
  });
  ctx.linkModalBackdrop?.addEventListener('click', () => {
    closeLinkModal('');
    try {
      ctx.editor.focus();
      restoreEditorRange();
      ctx.updateToolbarState();
    } catch (e) {}
  });
  ctx.saveLinkModalBtn?.addEventListener('click', () => {
    closeLinkModal(ctx.linkUrlInput ? ctx.linkUrlInput.value : '');
  });
  ctx.linkUrlInput?.addEventListener('keydown', (evt) => {
    if (evt.key === 'Enter') {
      evt.preventDefault();
      closeLinkModal(ctx.linkUrlInput ? ctx.linkUrlInput.value : '');
      return;
    }
    if (evt.key === 'Escape') {
      evt.preventDefault();
      closeLinkModal('');
      try {
        ctx.editor.focus();
        restoreEditorRange();
        ctx.updateToolbarState();
      } catch (e) {}
    }
  });
  ctx.copyQrLinkBtn?.addEventListener('click', async () => {
    const { copyText } = await import('../editor/clipboard.js');
    const url = location.href;
    if (await copyText(url)) {
      const { setButtonCopiedState } = await import('../editor/clipboard.js');
      setButtonCopiedState(ctx.copyQrLinkBtn, t('space.button.copyQrLink'));
      return;
    }
    prompt(t('copy.linkPrompt'), url);
  });

  // Escape key for modals
  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape' && ctx.linkModal && !ctx.linkModal.hidden) {
      closeLinkModal('');
      try {
        ctx.editor.focus();
        restoreEditorRange();
        ctx.updateToolbarState();
      } catch (e) {}
      return;
    }
    if (evt.key === 'Escape' && ctx.qrModal && !ctx.qrModal.hidden) {
      closeQrModal();
    }
  });
}
