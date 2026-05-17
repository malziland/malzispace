/**
 * @module ui/lock
 * Owner / read-only lock state: button visibility, editor disable for readers,
 * toggle handler that calls /api/lock. Live lock_state control frames from the
 * collab relay flow through applyLockState().
 */
import ctx, { t } from '../core/context.js';
import { setEditorEditable } from '../services/selection.js';
import {
  getOwnerKeyProof,
  isOwnerFromHash,
  getOwnerLinkUrl,
  stripHashFromUrl,
} from '../services/crypto.js';

let lockButton = null;
let inFlightToggle = false;
let welcomeShown = false;

function setBodyReadOnly(readOnly) {
  try {
    document.body.classList.toggle('is-readonly', !!readOnly);
  } catch (e) {}
}

function setBodyUiClasses() {
  // The space.css selectors `body:not(.has-lock-ui) #lockToggle` and
  // `body:not(.has-owner-ui) #copyOwnerLink` default both controls to
  // display:none. JS adds the matching class only when the conditions
  // for showing each control are met. This eliminates any reliance on
  // the HTML `hidden` attribute interacting cleanly with our CSS rules.
  try {
    const body = document.body;
    const showLock = !!ctx.hasOwner && (!!ctx.isOwner || !!ctx.readOnly);
    body.classList.toggle('has-lock-ui', showLock);
    body.classList.toggle('has-owner-ui', !!ctx.isOwner);
  } catch (e) {}
}

function updateLockButtonUi() {
  if (!lockButton) return;
  const readOnly = !!ctx.readOnly;
  const hasOwner = !!ctx.hasOwner;
  const isOwner = !!ctx.isOwner;

  // Visibility:
  //  - Owner: always shown (toggle).
  //  - Reader: shown only when the space is currently locked (read-only).
  //  - No owner concept at all: hidden.
  if (!hasOwner) {
    lockButton.hidden = true;
    return;
  }
  if (!isOwner && !readOnly) {
    lockButton.hidden = true;
    return;
  }
  lockButton.hidden = false;

  if (isOwner) {
    const labelKey = readOnly ? 'space.lock.toggleLocked' : 'space.lock.toggleUnlocked';
    const label = t(labelKey);
    lockButton.setAttribute('data-state', readOnly ? 'locked' : 'open');
    lockButton.setAttribute('aria-label', label);
    lockButton.setAttribute('title', label);
    lockButton.disabled = false;
  } else {
    const label = t('space.lock.readOnly');
    // Readers only ever see the closed-lock icon; data-state controls SVG via CSS.
    lockButton.setAttribute('data-state', 'readonly');
    lockButton.setAttribute('aria-label', label);
    lockButton.setAttribute('title', label);
    lockButton.disabled = true;
  }
}

function updateEditorAccess() {
  // Only readers of a locked space are blocked from editing. Owners and
  // unlocked spaces keep their normal editing behavior. Do nothing if the
  // space is already in the expired state — showExpired already disabled
  // editing and we must not re-enable it here.
  if (ctx.expiredShown) return;
  const shouldBlock = !!ctx.readOnly && !ctx.isOwner;
  setEditorEditable(!shouldBlock);
  setBodyReadOnly(shouldBlock);
}

async function copyOwnerUrl(buttonForFeedback) {
  const url = getOwnerLinkUrl();
  if (!url) return false;
  try {
    const { copyText, setButtonCopiedState } = await import('../editor/clipboard.js');
    if (await copyText(url)) {
      if (buttonForFeedback) {
        setButtonCopiedState(buttonForFeedback, buttonForFeedback.textContent || t('owner.welcome.copy'));
      }
      return true;
    }
  } catch (e) {}
  try {
    window.prompt(t('owner.welcome.copy'), url);
    return true;
  } catch (e) {}
  return false;
}

function maybeShowOwnerWelcome() {
  if (welcomeShown) return;
  if (!ctx.isOwner || !ctx.hasOwner) return;
  let consume = false;
  try {
    consume = sessionStorage.getItem('mz_fresh_owner_' + String(ctx.SPACE_ID || '')) === '1';
  } catch (e) {}
  if (!consume) return;
  welcomeShown = true;
  try { sessionStorage.removeItem('mz_fresh_owner_' + String(ctx.SPACE_ID || '')); } catch (e) {}

  const banner = document.getElementById('ownerWelcome');
  if (!banner) return;
  banner.hidden = false;
  const copyBtn = document.getElementById('ownerWelcomeCopy');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => { copyOwnerUrl(copyBtn); });
  }
  const dismissBtn = document.getElementById('ownerWelcomeDismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => { banner.hidden = true; });
  }
}

/**
 * Apply a lock state update from any source (load response, /api/lock reply,
 * or relay control frame). Idempotent.
 */
export function applyLockState({ readOnly, hasOwner } = {}) {
  if (typeof readOnly === 'boolean') ctx.readOnly = readOnly;
  if (typeof hasOwner === 'boolean') ctx.hasOwner = hasOwner;
  setBodyUiClasses();
  updateLockButtonUi();
  updateEditorAccess();
  maybeShowOwnerWelcome();
}

async function postLock(desiredReadOnly) {
  const { api } = await import('../network/collaboration.js');
  const ownerKeyProof = await getOwnerKeyProof();
  if (!ownerKeyProof) return null;
  return api('lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: ctx.SPACE_ID,
      owner_key_proof: ownerKeyProof,
      read_only: !!desiredReadOnly
    })
  });
}

async function onLockToggleClick() {
  if (inFlightToggle) return;
  if (!ctx.isOwner) return;
  inFlightToggle = true;
  const desired = !ctx.readOnly;
  try {
    const res = await postLock(desired);
    if (!res || res.error) {
      try { ctx.setStatusText(t('space.lock.error'), 'danger'); } catch (e) {}
      return;
    }
    // Optimistic local update; the relay broadcast will confirm shortly.
    applyLockState({ readOnly: !!res.read_only });
  } catch (e) {
    try { ctx.setStatusText(t('space.lock.error'), 'danger'); } catch (err) {}
  } finally {
    inFlightToggle = false;
  }
}

/** Wire up the lock button. Call once during app init. */
export function initLock() {
  ctx.isOwner = isOwnerFromHash();
  ctx.hasOwner = false;
  ctx.readOnly = false;
  ctx.applyLockState = applyLockState;

  lockButton = document.getElementById('lockToggle');
  if (lockButton) lockButton.addEventListener('click', onLockToggleClick);

  const ownerCopyBtn = document.getElementById('copyOwnerLink');
  if (ownerCopyBtn) {
    // Persistent copy-owner-link icon: visible only for owners, mirrors the
    // welcome-banner copy button so the URL can always be re-copied after
    // the address bar has been stripped.
    ownerCopyBtn.hidden = !ctx.isOwner;
    ownerCopyBtn.addEventListener('click', () => { copyOwnerUrl(null); });
  }

  // Remove the owner secret from the address bar. Cached secrets live in
  // crypto.js + sessionStorage so reload-in-tab and decryption keep working.
  if (ctx.isOwner) stripHashFromUrl();

  setBodyUiClasses();
  updateLockButtonUi();
  updateEditorAccess();
}
