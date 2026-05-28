import ctx from '../core/context.js';
import { COMMAND_HISTORY_LIMIT } from '../core/constants.js';
import {
  getEditorStoredContent,
  saveEditorRange,
} from './selection.js';
import { sanitizeEditorHtml } from './sanitizer.js';

export function snapshotEditorState() {
  return sanitizeEditorHtml(ctx.editor.innerHTML || '');
}

/** Concatenated text of all owner-marked spans in a stored-content string. */
function ownerTextOf(storedHtml) {
  const tpl = document.createElement('template');
  tpl.innerHTML = typeof storedHtml === 'string' ? storedHtml : '';
  let out = '';
  tpl.content.querySelectorAll('.mz-owner-text').forEach((sp) => {
    out += (sp.textContent || '').replace(/​/g, '').replace(/ /g, ' ');
  });
  return out;
}

/**
 * In append-only mode a participant must not undo/redo to a state whose
 * owner-marked content differs from the current one — that would let them
 * roll protected text back via the history stack. The owner is unrestricted.
 */
function protectBlocksHistory(currentStored, targetStored) {
  if (!ctx.appendOnly || ctx.isOwner) return false;
  if (ownerTextOf(currentStored) === ownerTextOf(targetStored)) return false;
  if (typeof ctx.showProtectToast === 'function') ctx.showProtectToast('space.protect.toast.modify');
  return true;
}

export function trackHistoryFromInput() {
  if (ctx.applyingCommandHistory) return;
  const current = getEditorStoredContent();
  if (current === ctx.lastKnownStoredForHistory) return;
  if (typeof ctx.lastKnownStoredForHistory === 'string') {
    if (ctx.commandUndoStack[ctx.commandUndoStack.length - 1] !== ctx.lastKnownStoredForHistory) {
      ctx.commandUndoStack.push(ctx.lastKnownStoredForHistory);
      if (ctx.commandUndoStack.length > COMMAND_HISTORY_LIMIT) ctx.commandUndoStack.shift();
    }
    ctx.commandRedoStack.length = 0;
  }
  ctx.lastKnownStoredForHistory = current;
}

export function pushUndoSnapshot(snapshot) {
  const state = typeof snapshot === 'string' ? snapshot : getEditorStoredContent();
  if (ctx.commandUndoStack[ctx.commandUndoStack.length - 1] !== state) {
    ctx.commandUndoStack.push(state);
    if (ctx.commandUndoStack.length > COMMAND_HISTORY_LIMIT) ctx.commandUndoStack.shift();
  }
  ctx.commandRedoStack.length = 0;
}

export function applyCommandHistoryState(stored) {
  ctx.applyingCommandHistory = true;
  ctx.setEditorWithCursor(stored || '');
  if (ctx.crdtEnabled && ctx.ytext) {
    ctx.syncYTextFromEditorHtml(stored || '');
  }
  if (ctx.SPACE_ID_OK && !ctx.crdtEnabled) ctx.queueSave();
  ctx.applyingCommandHistory = false;
  ctx.lastKnownStoredForHistory = getEditorStoredContent();
  saveEditorRange();
  ctx.updateToolbarState();
}

export function commandUndo() {
  if (!ctx.commandUndoStack.length) return;
  const current = getEditorStoredContent();
  let prev = ctx.commandUndoStack.pop();
  while (typeof prev === 'string' && prev === current && ctx.commandUndoStack.length) {
    prev = ctx.commandUndoStack.pop();
  }
  if (typeof prev !== 'string' || prev === current) return;
  if (protectBlocksHistory(current, prev)) { ctx.commandUndoStack.push(prev); return; }
  if (ctx.commandRedoStack[ctx.commandRedoStack.length - 1] !== current) {
    ctx.commandRedoStack.push(current);
    if (ctx.commandRedoStack.length > COMMAND_HISTORY_LIMIT) ctx.commandRedoStack.shift();
  }
  applyCommandHistoryState(prev);
}

export function commandRedo() {
  if (!ctx.commandRedoStack.length) return;
  const current = getEditorStoredContent();
  let next = ctx.commandRedoStack.pop();
  while (typeof next === 'string' && next === current && ctx.commandRedoStack.length) {
    next = ctx.commandRedoStack.pop();
  }
  if (typeof next !== 'string' || next === current) return;
  if (protectBlocksHistory(current, next)) { ctx.commandRedoStack.push(next); return; }
  if (ctx.commandUndoStack[ctx.commandUndoStack.length - 1] !== current) {
    ctx.commandUndoStack.push(current);
    if (ctx.commandUndoStack.length > COMMAND_HISTORY_LIMIT) ctx.commandUndoStack.shift();
  }
  applyCommandHistoryState(next);
}

// Register on ctx
export function initHistory() {
  ctx.trackHistoryFromInput = trackHistoryFromInput;
}
