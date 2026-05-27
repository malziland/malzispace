/**
 * @module ui/mode
 * Three-state segmented switch (Frei · Schutz · Sperre) that replaces the
 * stand-alone lock and protect icon buttons for owners. The underlying state
 * still lives in two booleans on the spaces doc (read_only + append_only);
 * this module makes them feel mutually exclusive to the user while reusing
 * the existing /api/lock and /api/append-only endpoints.
 *
 * Mode mapping:
 *   open    → read_only=false, append_only=false
 *   protect → read_only=false, append_only=true
 *   locked  → read_only=true,  append_only=false
 *
 * Lock + protect both true is treated as `locked` (lock dominates visually).
 */
import ctx, { t } from '../core/context.js';
import { getOwnerKeyProof } from '../services/crypto.js';

let modeSwitch = null;
let segments = null;
let lockBanner = null;
let lockBannerText = null;
let inFlightToggle = false;
let autoMarkAttempted = false;
let autoMarkScheduled = false;

function currentMode() {
  if (ctx.readOnly) return 'locked';
  if (ctx.appendOnly) return 'protect';
  return 'open';
}

function updateSegmentsUi() {
  if (!modeSwitch) return;
  modeSwitch.hidden = !ctx.isOwner;
  const mode = currentMode();
  for (const seg of segments) {
    const active = seg.dataset.mode === mode;
    seg.setAttribute('aria-checked', active ? 'true' : 'false');
    seg.disabled = inFlightToggle;
  }
}

function updateLockBannerUi() {
  if (!lockBanner) return;
  if (!ctx.readOnly) { lockBanner.hidden = true; return; }
  lockBanner.hidden = false;
  if (lockBannerText) {
    const key = ctx.isOwner ? 'space.lock.banner.trainer' : 'space.lock.banner.participant';
    lockBannerText.textContent = t(key);
    lockBannerText.setAttribute('data-i18n', key);
  }
}

/** Refresh the switch + lock banner. Called from applyLockState and applyProtectState. */
export function refreshMode() {
  updateSegmentsUi();
  updateLockBannerUi();
  maybeScheduleAutoMark();
}

/**
 * One-shot rescue for spaces where protect was activated earlier but the
 * content arrived without owner-text markup (e.g. spaces saved before the
 * markAllExistingAsOwner fix). When the owner opens such a space, we wait
 * for the editor content to settle, then retroactively wrap whatever
 * unmarked text is there and push it through the CRDT + saveNow.
 *
 * Only runs once per session, only for the owner, only if append_only is
 * already active. Participants never auto-mark.
 */
function maybeScheduleAutoMark() {
  if (autoMarkScheduled || autoMarkAttempted) return;
  if (!ctx.isOwner || !ctx.appendOnly || !ctx.editor) return;
  autoMarkScheduled = true;
  setTimeout(runAutoMark, 800);
}

async function runAutoMark() {
  autoMarkScheduled = false;
  autoMarkAttempted = true;
  if (!ctx.isOwner || !ctx.appendOnly || !ctx.editor) return;
  if (ctx.editor.querySelector(OWNER_SELECTOR)) return;
  if (!(ctx.editor.textContent || '').trim()) return;
  if (!markAllExistingAsOwner()) return;
  try {
    const collab = await import('../network/collaboration.js');
    const { getEditorStoredContent } = await import('../services/selection.js');
    collab.syncYTextFromEditorHtml(getEditorStoredContent());
    if (typeof collab.saveNow === 'function') await collab.saveNow();
  } catch (e) {}
}

async function postLock(desired) {
  const { api } = await import('../network/collaboration.js');
  const keyProof = await getOwnerKeyProof();
  if (!keyProof) return { error: 'no_owner_key' };
  return api('lock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: ctx.SPACE_ID, owner_key_proof: keyProof, read_only: !!desired
    })
  });
}

async function postAppendOnly(desired) {
  const { api } = await import('../network/collaboration.js');
  const keyProof = await getOwnerKeyProof();
  if (!keyProof) return { error: 'no_owner_key' };
  return api('append-only', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: ctx.SPACE_ID, owner_key_proof: keyProof, append_only: !!desired
    })
  });
}

const OWNER_TEXT_CLASS = 'mz-owner-text';
const OWNER_SELECTOR = '.' + OWNER_TEXT_CLASS;

/**
 * Wrap every text node in the editor that is not already inside an owner-text
 * span. Runs on every protect activation so that content typed in between
 * sessions (or while protect was off) gets retroactively marked. Idempotent.
 */
function markAllExistingAsOwner() {
  if (!ctx.editor) return false;
  let marked = false;
  for (const block of Array.from(ctx.editor.children)) {
    if (!(block instanceof Element)) continue;
    if (block.tagName === 'HR') continue;
    if (!(block.textContent || '').trim()) continue;
    // If the block already contains owner-marked content, only wrap the
    // remaining unmarked text nodes inside it. Otherwise wrap the entire
    // block content in one fresh span.
    const hasOwner = !!block.querySelector(OWNER_SELECTOR);
    if (hasOwner) {
      const textNodes = [];
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) textNodes.push(walker.currentNode);
      for (const node of textNodes) {
        if (!(node.textContent || '').trim()) continue;
        const parent = node.parentElement;
        if (!parent || parent.closest(OWNER_SELECTOR)) continue;
        const span = document.createElement('span');
        span.className = OWNER_TEXT_CLASS;
        parent.insertBefore(span, node);
        span.appendChild(node);
        marked = true;
      }
    } else {
      const span = document.createElement('span');
      span.className = OWNER_TEXT_CLASS;
      while (block.firstChild) span.appendChild(block.firstChild);
      block.appendChild(span);
      marked = true;
    }
  }
  return marked;
}

async function onSegmentClick(targetMode) {
  if (inFlightToggle || !ctx.isOwner) return;
  if (targetMode === currentMode()) return;
  inFlightToggle = true;
  updateSegmentsUi();

  const wantLocked = targetMode === 'locked';
  const wantProtected = targetMode === 'protect';
  // Capture the ORIGINAL state before any optimistic UI updates touch ctx.
  // The API gating below must compare against this snapshot — otherwise the
  // optimistic apply just below makes "did the state change?" silently false
  // and the network call gets skipped (regression I introduced).
  const wasProtected = !!ctx.appendOnly;
  const wasLocked = !!ctx.readOnly;

  try {
    // Step 1: unlock first if transitioning away from locked, so the editor
    // is editable when we apply the retroactive marking next.
    if (wasLocked && !wantLocked) await postLock(false);

    // Step 2: optimistic UI — banner / highlight / segment color flip instantly.
    if (typeof ctx.applyProtectState === 'function') {
      ctx.applyProtectState({ appendOnly: wantProtected });
    }
    if (typeof ctx.applyLockState === 'function') {
      ctx.applyLockState({ readOnly: wantLocked });
    }

    // Step 3: retroactively mark unmarked content when activating protect.
    if (wantProtected) {
      const didMark = markAllExistingAsOwner();
      if (didMark) {
        try {
          const collab = await import('../network/collaboration.js');
          const { getEditorStoredContent } = await import('../services/selection.js');
          collab.syncYTextFromEditorHtml(getEditorStoredContent());
          if (typeof collab.saveNow === 'function') {
            await collab.saveNow();
          }
        } catch (e) {}
      }
    }

    // Step 4: API calls. Compare against the ORIGINAL state, not the
    // already-mutated ctx values.
    if (wasProtected !== wantProtected) await postAppendOnly(wantProtected);
    if (!wasLocked && wantLocked) await postLock(true);
  } catch (err) {
    try { ctx.setStatusText(t('space.protect.error'), 'danger'); } catch (e) {}
  } finally {
    inFlightToggle = false;
    refreshMode();
  }
}

/** Wire up the segmented mode switch. Call once during app init. */
export function initMode() {
  modeSwitch = document.getElementById('modeSwitch');
  lockBanner = document.getElementById('lockBanner');
  lockBannerText = document.getElementById('lockBannerText');
  if (!modeSwitch) return;

  segments = Array.from(modeSwitch.querySelectorAll('.mode-segment'));
  for (const seg of segments) {
    seg.addEventListener('click', () => onSegmentClick(seg.dataset.mode));
  }
  ctx.refreshMode = refreshMode;
  refreshMode();
}
