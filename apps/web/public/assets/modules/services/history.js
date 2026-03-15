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
