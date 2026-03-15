/**
 * @module core/constants
 * Shared constants: tag sets, timing values, attribute names.
 */

export const allowedTags = new Set(['p','br','strong','em','u','ul','ol','li','a','blockquote','div','span','hr']);
export const blockTags = new Set(['p','div','blockquote','li']);
export const htmlLikeTagRe = /<\/?(p|br|strong|b|em|i|u|font|ul|ol|li|a|blockquote|div|span|hr)(\s|\/?>)/i;
export const managedStaticClasses = new Set(['mz-fw-bold','mz-fs-italic','mz-td-underline']);
export const managedDataAttrs = ['data-mz-fg','data-mz-bg','data-mz-align','data-mz-list-style'];
export const namedColorAllowlist = new Set(['black','white','red','green','blue','yellow','magenta','cyan','gray','grey','orange','purple','pink','brown','transparent','currentcolor']);
export const pendingCaretAttr = 'data-mz-post-command-caret';
export const selectionMarkerStartAttr = 'data-mz-selection-start';
export const selectionMarkerEndAttr = 'data-mz-selection-end';
export const selectionMarkerCaretAttr = 'data-mz-selection-caret';
export const IDLE_MS = 1200;
export const PRESENCE_TTL_MS = 30000;
export const WS_AUTH_TTL_MS = 60000;
export const LOAD_RETRY_DELAYS_MS = [400, 1200, 2500, 5000, 8000];
export const PERSIST_RETRY_BASE_MS = 1000;
export const PERSIST_RETRY_MAX_MS = 10000;
export const COMMAND_HISTORY_LIMIT = 120;
export const DYNAMIC_COLOR_CACHE_LIMIT = 500;
