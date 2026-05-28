/**
 * @module ui/protect
 * Append-only protection: owner-marked text is locked against participant
 * edits/displacement; the owner can still edit anything. Toggle is owner-only,
 * state is broadcast via the `append_only_state` relay frame. Mirrors the
 * lock.js architecture (load -> applyProtectState -> relay broadcast).
 */
import ctx, { t } from '../core/context.js';
import { getOwnerKeyProof } from '../services/crypto.js';

const OWNER_TEXT_CLASS = 'mz-owner-text';

let protectButton = null;
let protectBanner = null;
let protectBannerText = null;
let protectToast = null;
let protectToastText = null;
let toastTimer = null;
let inFlightToggle = false;

function setBodyClasses() {
  try {
    document.body.classList.toggle('has-append-only', !!ctx.appendOnly);
  } catch (e) {}
}

function updateProtectButtonUi() {
  if (!protectButton) return;
  // Visibility: same model as the existing copy-owner button — owner only.
  if (!ctx.isOwner) {
    // Participant indicator: visible only while protect is active, passive
    // (no clicks). Mirrors the readonly lock-toggle indicator pattern so the
    // toolbar surfaces lock + protect state consistently across roles.
    protectButton.hidden = !ctx.appendOnly;
    protectButton.setAttribute('data-state', ctx.appendOnly ? 'readonly' : 'off');
    const label = t('space.protect.readOnly');
    protectButton.setAttribute('aria-label', label);
    protectButton.setAttribute('title', label);
    protectButton.disabled = true;
    return;
  }
  protectButton.hidden = false;
  protectButton.disabled = false;
  const on = !!ctx.appendOnly;
  protectButton.setAttribute('data-state', on ? 'on' : 'off');
  const labelKey = on ? 'space.protect.toggleOn' : 'space.protect.toggleOff';
  const label = t(labelKey);
  protectButton.setAttribute('aria-label', label);
  protectButton.setAttribute('title', label);
}

function updateBannerUi() {
  if (!protectBanner) return;
  if (!ctx.appendOnly) {
    protectBanner.hidden = true;
    return;
  }
  protectBanner.hidden = false;
  if (protectBannerText) {
    const key = ctx.isOwner ? 'space.protect.banner.trainer' : 'space.protect.banner.participant';
    protectBannerText.textContent = t(key);
    protectBannerText.setAttribute('data-i18n', key);
  }
}

/** Show the protection toast briefly. */
export function showProtectToast(messageKey) {
  if (!protectToast || !protectToastText) return;
  protectToastText.textContent = t(messageKey || 'space.protect.toast.modify');
  protectToast.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    protectToast.classList.remove('is-visible');
  }, 2200);
}

/**
 * Apply an append-only state update from any source (load response, /api/
 * append-only reply, or relay control frame). Idempotent.
 */
export function applyProtectState({ appendOnly } = {}) {
  if (typeof appendOnly === 'boolean') ctx.appendOnly = appendOnly;
  setBodyClasses();
  updateProtectButtonUi();
  updateBannerUi();
  if (typeof ctx.refreshMode === 'function') ctx.refreshMode();
  // Re-establish the owner-content baseline the reconciliation guard reverts
  // to, now that protection state (and possibly retro-marking) has settled.
  if (typeof ctx.recomputeOwnerBaseline === 'function') ctx.recomputeOwnerBaseline();
}

/**
 * Mark every direct child of the editor as owner-authored. Called on the
 * initial activation of protection so that everything written so far is
 * retroactively protected. Owner-only; safe to call repeatedly (idempotent).
 */
function markAllExistingAsOwner() {
  if (!ctx.editor) return;
  // Walk top-level block elements and wrap their inline content in an owner
  // span — but skip blocks whose content is already wholly owner-marked.
  const blocks = Array.from(ctx.editor.children);
  for (const block of blocks) {
    if (!(block instanceof Element)) continue;
    if (block.tagName === 'HR') continue;
    // Already entirely an owner span? Nothing to do.
    if (block.childNodes.length === 1
        && block.firstChild instanceof Element
        && block.firstChild.classList
        && block.firstChild.classList.contains(OWNER_TEXT_CLASS)) {
      continue;
    }
    const span = document.createElement('span');
    span.className = OWNER_TEXT_CLASS;
    while (block.firstChild) span.appendChild(block.firstChild);
    block.appendChild(span);
  }
}

async function postAppendOnly(desired) {
  const { api } = await import('../network/collaboration.js');
  const ownerKeyProof = await getOwnerKeyProof();
  if (!ownerKeyProof) return null;
  return api('append-only', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: ctx.SPACE_ID,
      owner_key_proof: ownerKeyProof,
      append_only: !!desired
    })
  });
}

async function onProtectToggleClick() {
  if (inFlightToggle) return;
  if (!ctx.isOwner) return;
  inFlightToggle = true;
  const desired = !ctx.appendOnly;
  const wasOff = !ctx.appendOnly;
  try {
    // First activation in this space: retroactively mark current content.
    // We do this BEFORE the network round-trip so the wrap is part of the
    // next save/CRDT push. If the server rejects, we revert below.
    let didRetroMark = false;
    if (desired && wasOff && ctx.isOwner) {
      const hasAny = !!ctx.editor && !!ctx.editor.querySelector('.' + OWNER_TEXT_CLASS);
      if (!hasAny) {
        markAllExistingAsOwner();
        didRetroMark = true;
        // Propagate the new markup into Y.Text / persist
        try {
          const { syncYTextFromEditorHtml } = await import('../network/collaboration.js');
          const { getEditorStoredContent } = await import('../services/selection.js');
          syncYTextFromEditorHtml(getEditorStoredContent());
          if (typeof ctx.queueSave === 'function') ctx.queueSave();
        } catch (e) {}
      }
    }

    const res = await postAppendOnly(desired);
    if (!res || res.error) {
      // Revert retroactive marking if the server rejected the toggle.
      if (didRetroMark) {
        try {
          ctx.editor.querySelectorAll('.' + OWNER_TEXT_CLASS).forEach((span) => {
            const parent = span.parentNode;
            while (span.firstChild) parent.insertBefore(span.firstChild, span);
            parent.removeChild(span);
          });
          const { syncYTextFromEditorHtml } = await import('../network/collaboration.js');
          const { getEditorStoredContent } = await import('../services/selection.js');
          syncYTextFromEditorHtml(getEditorStoredContent());
        } catch (e) {}
      }
      try { ctx.setStatusText(t('space.protect.error'), 'danger'); } catch (e) {}
      return;
    }
    applyProtectState({ appendOnly: !!res.append_only });
  } catch (e) {
    try { ctx.setStatusText(t('space.protect.error'), 'danger'); } catch (err) {}
  } finally {
    inFlightToggle = false;
  }
}

/** Wire up the protect toggle button. Call once during app init. */
export function initProtect() {
  ctx.appendOnly = false;
  ctx.applyProtectState = applyProtectState;
  ctx.showProtectToast = showProtectToast;

  protectButton = document.getElementById('protectToggle');
  protectBanner = document.getElementById('protectBanner');
  protectBannerText = document.getElementById('protectBannerText');
  protectToast = document.getElementById('protectToast');
  protectToastText = document.getElementById('protectToastText');

  if (protectButton) protectButton.addEventListener('click', onProtectToggleClick);

  setBodyClasses();
  updateProtectButtonUi();
  updateBannerUi();
}
