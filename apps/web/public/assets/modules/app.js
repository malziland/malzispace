/**
 * @module app
 * Application entry point: DOM ref initialization, module wiring,
 * event listener setup, and main init sequence.
 */
import ctx, { t } from './core/context.js';
import {
  saveEditorRange,
  restoreEditorRange,
  fixEditorLevelCaret,
  isNodeWithinEditor,
  isEditorFocused,
  getEditorStoredContent,
} from './services/selection.js';
import { initSelection } from './services/selection.js';
import { initHistory } from './services/history.js';
import { initLineNumbers, syncLineNumberScroll, renderLineNumbers } from './editor/line-numbers.js';
import { initInlineFormat } from './editor/inline-format.js';
import { initCommands } from './editor/commands.js';
import { initClipboard } from './editor/clipboard.js';
import { initKeyboard } from './editor/keyboard.js';
import { initToolbar, bindColorPicker } from './ui/toolbar.js';
import { initModals } from './ui/modals.js';
import { initStatus } from './ui/status.js';
import { initCollaboration, init, saveNow } from './network/collaboration.js';
import { copyRichText, setButtonCopiedState } from './editor/clipboard.js';
import { storedContentToHtml } from './services/sanitizer.js';
import { htmlToPlainText } from './core/dom-utils.js';

// ── DOM ref setup ───────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const editor = $('#editor');
if (!editor) throw new Error('Editor element not found');

ctx.editor = editor;
ctx.status = $('#status');
ctx.presence = $('#presence');
ctx.titleView = $('#titleView');
ctx.copyAllBtn = $('#copyAll');
ctx.showQrBtn = $('#showQr');
ctx.editorToolbar = $('#editorToolbar');
ctx.qrModal = $('#qrModal');
ctx.qrBackdrop = $('#qrModalBackdrop');
ctx.qrCodeEl = $('#qrCode');
ctx.qrLinkText = $('#qrLinkText');
ctx.closeQrModalBtn = $('#closeQrModal');
ctx.copyQrLinkBtn = $('#copyQrLink');
ctx.linkModal = $('#linkModal');
ctx.linkModalBackdrop = $('#linkModalBackdrop');
ctx.linkUrlInput = $('#linkUrlInput');
ctx.saveLinkModalBtn = $('#saveLinkModal');
ctx.cancelLinkModalBtn = $('#cancelLinkModal');
ctx.lineNumbers = $('#lineNumbers');
ctx.lineNumbersInner = $('#lineNumbersInner');

// ── Config ──────────────────────────────────────────────────────

ctx.SPACE_ID = String(window.SPACE_ID || '').trim();
ctx.SPACE_ID_OK = /^[a-z0-9]{6,24}$/.test(ctx.SPACE_ID);

const URL_PARAMS = new URLSearchParams(window.location.search || '');
ctx.SIM_MODE = URL_PARAMS.get('sim') === '1';
ctx.SELFTEST_MODE = URL_PARAMS.get('selftest') === '1';

const FLAGS = (window.MZ_FLAGS && typeof window.MZ_FLAGS === 'object') ? window.MZ_FLAGS : {};
ctx.FF_ENABLE_CRDT = FLAGS.enableCrdt !== false;
ctx.FF_ENABLE_WS = FLAGS.enableWs !== false;
ctx.FF_ENABLE_PRESENCE = FLAGS.enablePresence !== false;

// ── Module init (order matters: dependencies first) ─────────────

initSelection();
initHistory();
initLineNumbers();
initInlineFormat();
initCommands();
initClipboard();
initKeyboard();
initToolbar();
initModals();
initStatus();
initCollaboration();

// ── Color pickers ───────────────────────────────────────────────

bindColorPicker($('#textColorPicker'), 'foreColor');
bindColorPicker($('#bgColorPicker'), 'hiliteColor');

// ── Editor paragraph separator ──────────────────────────────────

try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch (e) {}

// ── Editor focus: ensure valid caret ────────────────────────────

editor.addEventListener('focus', () => {
  const sel = window.getSelection && window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const r = sel.getRangeAt(0);
    if (r.startContainer !== editor && isNodeWithinEditor(r.startContainer)) return;
  }
  if (restoreEditorRange()) {
    const check = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    if (check && check.startContainer !== editor) return;
  }
  fixEditorLevelCaret();
});

// ── Editor range tracking ───────────────────────────────────────

['keyup', 'mouseup', 'input', 'focus', 'touchend'].forEach((evtName) => {
  editor.addEventListener(evtName, saveEditorRange);
});

// ── Scroll sync & resize ────────────────────────────────────────

editor.addEventListener('scroll', syncLineNumberScroll);
window.addEventListener('resize', renderLineNumbers);

// ── Selection change → toolbar state ────────────────────────────

document.addEventListener('selectionchange', () => {
  if (isEditorFocused()) {
    saveEditorRange();
    ctx.updateToolbarState();
  }
});

// ── Visibility / beforeunload ───────────────────────────────────

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && ctx.dirtySince) {
    saveNow().catch(() => {});
  }
});

window.addEventListener('beforeunload', () => {
  if (ctx.dirtySince) saveNow().catch(() => {});
  try {
    if (ctx.simRelay) {
      ctx.simRelay.close();
      ctx.simRelay = null;
    }
  } catch (e) {}
});

// ── Copy All button ─────────────────────────────────────────────

ctx.copyAllBtn?.addEventListener('click', async () => {
  const yStored = ctx.ytext ? String(ctx.ytext.toString() || '') : '';
  const editorStored = getEditorStoredContent();
  const html = storedContentToHtml(yStored || editorStored);
  const text = htmlToPlainText(html);
  if (await copyRichText(html, text)) {
    setButtonCopiedState(ctx.copyAllBtn, t('space.button.copyAll'));
    return;
  }
  prompt(t('copy.textPrompt'), text);
});

// ── Start ───────────────────────────────────────────────────────

init();
