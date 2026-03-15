/**
 * @module core/context
 * Shared mutable state object, i18n helper, and timing utilities.
 * All modules import `ctx` and register their public functions on it.
 */
import { PERSIST_RETRY_BASE_MS, IDLE_MS } from './constants.js';

/**
 * Central context object shared across all modules.
 * DOM references are set during initialization in app.js.
 * Cross-module functions are registered by each module's init*.
 * @type {object}
 */
const ctx = {
  // DOM refs (set during init)
  editor: null,
  status: null,
  presence: null,
  titleView: null,
  copyAllBtn: null,
  showQrBtn: null,
  editorToolbar: null,
  qrModal: null,
  qrBackdrop: null,
  qrCodeEl: null,
  qrLinkText: null,
  closeQrModalBtn: null,
  copyQrLinkBtn: null,
  linkModal: null,
  linkModalBackdrop: null,
  linkUrlInput: null,
  saveLinkModalBtn: null,
  cancelLinkModalBtn: null,
  lineNumbers: null,
  lineNumbersInner: null,

  // Config (set during init)
  SPACE_ID: '',
  SPACE_ID_OK: false,
  SIM_MODE: false,
  SELFTEST_MODE: false,
  FF_ENABLE_CRDT: true,
  FF_ENABLE_WS: true,
  FF_ENABLE_PRESENCE: true,

  // Mutable state
  lastInputTs: 0,
  saveTimer: null,
  ws: null,
  wsReady: false,
  simRelay: null,
  doc: null,
  ytext: null,
  dirtySince: 0,
  autosaveTimer: null,
  lastTitle: '',
  pollTimer: null,
  suppress: false,
  expiredShown: false,
  lastEditorRange: null,
  lastEditorSelection: { start: 0, end: 0 },
  localChangeSeq: 0,
  saveInFlightPromise: null,
  saveQueuedAfterFlight: false,
  loadInFlightPromise: null,
  commandUndoStack: [],
  commandRedoStack: [],
  applyingCommandHistory: false,
  lastKnownStoredForHistory: '',
  pendingPostCommandCaretNode: null,
  linkModalResolver: null,

  // Network state
  state: { token: null, version: 0, zk: true, color: null, shortId: null },
  awareness: new Map(),
  awarenessTimer: null,
  awarenessPruneTimer: null,
  YModule: null,
  crdtEnabled: false,
  persistQueue: [],
  persistTimer: null,
  persistInFlight: false,
  persistRetryMs: PERSIST_RETRY_BASE_MS,
  fullTimer: null,
  pullTimer: null,
  lastPullTs: 0,

  // Cross-module function registry (set by each module's init)
  renderLineNumbers: () => {},
  updateToolbarState: () => {},
  syncYTextFromEditorHtml: () => {},
  setStatusDot: () => {},
  setStatusText: () => {},
  setSyncWarning: () => {},
  clearSyncWarning: () => {},
  showExpired: () => {},
  updateTitleVisibility: () => {},
  setEditorWithCursor: () => {},
  closeQrModal: () => {},
  openLinkModal: () => Promise.resolve(''),
  closeLinkModal: () => {},
  markCollabReady: () => {},
  runEditorCommand: () => {},
  scheduleAwarenessSend: () => {},
  renderAwareness: () => {},
  queueSave: () => {},
};

export default ctx;

/**
 * Translate a key using the global i18n system.
 * @param {string} key - The i18n key.
 * @param {object} [vars] - Interpolation variables.
 * @returns {string} The translated string or the key itself.
 */
export function t(key, vars) {
  if (window.MZ_I18N && typeof window.MZ_I18N.t === 'function') {
    return window.MZ_I18N.t(key, vars);
  }
  return key;
}

/** @returns {number} Current timestamp in milliseconds. */
export const now = () => Date.now();

/** @returns {boolean} Whether the editor has been idle for IDLE_MS. */
export const isIdle = () => (now() - ctx.lastInputTs) > IDLE_MS;

/**
 * Wait for a specified number of milliseconds.
 * @param {number} ms - Milliseconds to wait.
 * @returns {Promise<void>}
 */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms || 0)));
