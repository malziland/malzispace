/**
 * @module core/formatting
 * Managed CSS formatting system: class manipulation, dynamic color rules,
 * formatting extraction, and element-level formatting application.
 */
import { managedStaticClasses, managedDataAttrs, namedColorAllowlist, blockTags, DYNAMIC_COLOR_CACHE_LIMIT } from './constants.js';
import { hash32 } from './dom-utils.js';

/** @type {CSSStyleSheet|null} Cached reference to the active stylesheet. */
let dynamicStyleSheet = null;

/** @type {Map<string,boolean>} Cache of already-inserted dynamic color rules. */
const dynamicColorRuleCache = new Map();

/**
 * Check whether a CSS class name is a managed format class.
 * @param {string} name - The class name.
 * @returns {boolean}
 */
export function isManagedFormatClass(name) {
  return managedStaticClasses.has(name) || /^mz-(fg|bg)-[a-z0-9]+$/i.test(String(name || ''));
}

/**
 * Get or discover the dynamic stylesheet for injecting color rules.
 * @returns {CSSStyleSheet|null}
 */
export function getDynamicStyleSheet() {
  if (dynamicStyleSheet) return dynamicStyleSheet;
  const sheets = Array.from(document.styleSheets || []);
  for (const sheet of sheets) {
    try {
      if (!sheet || sheet.disabled || !sheet.href) continue;
      const href = new URL(sheet.href, window.location.href);
      if (href.origin !== window.location.origin) continue;
      if (/\/assets\/space\.css$/i.test(href.pathname)) {
        dynamicStyleSheet = sheet;
        return sheet;
      }
    } catch (e) {}
  }
  for (const sheet of sheets) {
    try {
      if (!sheet || sheet.disabled || !sheet.href) continue;
      const href = new URL(sheet.href, window.location.href);
      if (href.origin === window.location.origin) {
        dynamicStyleSheet = sheet;
        return sheet;
      }
    } catch (e) {}
  }
  return null;
}

/**
 * Normalize a CSS color value (hex, rgb, hsl, or named color).
 * @param {string} v - Raw color string.
 * @returns {string} Normalized color or empty string if invalid.
 */
export function normalizeCssColor(v) {
  const value = (v || '').trim();
  if (!value) return '';
  if (/^#[0-9a-f]{3,8}$/i.test(value)) return value.toLowerCase();
  if (/^rgba?\(\s*[-\d.%\s,]+\)$/i.test(value)) return value.replace(/\s+/g, ' ');
  if (/^hsla?\(\s*[-\d.%\s,]+\)$/i.test(value)) return value.replace(/\s+/g, ' ');
  const lower = value.toLowerCase();
  if (namedColorAllowlist.has(lower)) return lower;
  return '';
}

/**
 * Normalize a CSS background value (delegates to normalizeCssColor).
 * @param {string} v - Raw background string.
 * @returns {string}
 */
export function normalizeCssBackground(v) {
  return normalizeCssColor(v);
}

/**
 * Ensure a dynamic color class exists and return its name.
 * Inserts a CSS rule into the stylesheet if needed.
 * @param {'fg'|'bg'} kind - Color kind (foreground or background).
 * @param {string} value - The color value.
 * @returns {string} The generated class name, or '' on failure.
 */
export function ensureDynamicColorClass(kind, value) {
  const normalized = kind === 'fg' ? normalizeCssColor(value) : normalizeCssBackground(value);
  if (!normalized) return '';
  const className = `mz-${kind}-${hash32(`${kind}:${normalized}`).toString(36)}`;
  if (dynamicColorRuleCache.has(className)) return className;
  if (dynamicColorRuleCache.size >= DYNAMIC_COLOR_CACHE_LIMIT) return '';
  const sheet = getDynamicStyleSheet();
  if (sheet) {
    try {
      const property = kind === 'fg' ? 'color' : 'background-color';
      sheet.insertRule(`.${className}{${property}:${normalized};}`, sheet.cssRules.length);
      dynamicColorRuleCache.set(className, true);
      return className;
    } catch (e) {}
  }
  return '';
}

/**
 * Merge formatting objects, skipping empty/null values.
 * @param {object} into - Target formatting object (mutated).
 * @param {object} next - Source formatting object.
 * @returns {object} The merged target.
 */
export function mergeFormatting(into, next) {
  if (!next) return into;
  const target = into || {};
  Object.keys(next).forEach((key) => {
    if (next[key] === '' || next[key] == null) return;
    target[key] = next[key];
  });
  return target;
}

/**
 * Extract managed formatting data from an element's classes and attributes.
 * @param {Element} node - The element to inspect.
 * @returns {object} Formatting descriptor.
 */
export function extractManagedFormattingFromElement(node) {
  const format = {};
  if (!node || !(node instanceof Element)) return format;
  const fg = normalizeCssColor(node.getAttribute('data-mz-fg') || '');
  const bg = normalizeCssBackground(node.getAttribute('data-mz-bg') || '');
  const align = String(node.getAttribute('data-mz-align') || '').trim().toLowerCase();
  const listStyle = String(node.getAttribute('data-mz-list-style') || '').trim().toLowerCase();
  if (fg) format.fg = fg;
  if (bg) format.bg = bg;
  if (['left','right','center','justify','start','end'].includes(align)) format.align = align;
  if (listStyle) format.listStyle = listStyle;
  if (node.classList.contains('mz-fw-bold')) format.bold = true;
  if (node.classList.contains('mz-fs-italic')) format.italic = true;
  if (node.classList.contains('mz-td-underline')) format.underline = true;
  return format;
}

/**
 * Remove all managed formatting classes and data attributes from an element.
 * @param {Element} node - The element to reset.
 */
export function resetManagedFormatting(node) {
  if (!node || !(node instanceof Element)) return;
  Array.from(node.classList).forEach((className) => {
    if (isManagedFormatClass(className)) node.classList.remove(className);
  });
  managedDataAttrs.forEach((attr) => node.removeAttribute(attr));
}

/**
 * Apply a formatting descriptor to an element, replacing any existing formatting.
 * @param {Element} node - The target element.
 * @param {object} format - Formatting descriptor (bold, italic, underline, fg, bg, align, listStyle).
 */
export function applyFormattingToElement(node, format) {
  if (!node || !(node instanceof Element)) return;
  resetManagedFormatting(node);
  const next = format || {};
  const tag = (node.tagName || '').toLowerCase();
  if (next.bold) node.classList.add('mz-fw-bold');
  if (next.italic) node.classList.add('mz-fs-italic');
  if (next.underline) node.classList.add('mz-td-underline');
  if (next.align && blockTags.has(tag)) node.setAttribute('data-mz-align', next.align);
  if (next.listStyle && ['ul','ol','li'].includes(tag)) node.setAttribute('data-mz-list-style', next.listStyle);
  if (next.fg) {
    const normalized = normalizeCssColor(next.fg);
    const className = ensureDynamicColorClass('fg', normalized);
    if (normalized && className) {
      node.setAttribute('data-mz-fg', normalized);
      node.classList.add(className);
    }
  }
  if (next.bg) {
    const normalized = normalizeCssBackground(next.bg);
    const className = ensureDynamicColorClass('bg', normalized);
    if (normalized && className) {
      node.setAttribute('data-mz-bg', normalized);
      node.classList.add(className);
    }
  }
}

/**
 * Copy managed formatting from one element to another.
 * @param {Element} from - Source element.
 * @param {Element} to - Target element.
 */
export function copyManagedFormatting(from, to) {
  if (!from || !to || !(from instanceof Element) || !(to instanceof Element)) return;
  applyFormattingToElement(to, extractManagedFormattingFromElement(from));
}

/**
 * Extract formatting from an inline style string.
 * @param {string} raw - The raw style attribute value.
 * @param {string} tag - The element's tag name (for text-align/list-style).
 * @returns {object} Formatting descriptor.
 */
export function extractFormattingFromStyle(raw, tag) {
  const format = {};
  const styleText = String(raw || '');
  styleText.split(';').forEach((decl) => {
    const idx = decl.indexOf(':');
    if (idx < 0) return;
    const prop = decl.slice(0, idx).trim().toLowerCase();
    const val = decl.slice(idx + 1).trim();
    if (!prop || !val) return;

    if (prop === 'color') {
      const normalized = normalizeCssColor(val);
      if (normalized) format.fg = normalized;
      return;
    }
    if (prop === 'background-color') {
      const normalized = normalizeCssColor(val);
      if (normalized) format.bg = normalized;
      return;
    }
    if (prop === 'background') {
      const normalized = normalizeCssBackground(val);
      if (normalized) format.bg = normalized;
      return;
    }
    if (prop === 'font-weight') {
      const weight = val.toLowerCase();
      if (/^(bold|bolder|[5-9]00)$/.test(weight)) format.bold = true;
      return;
    }
    if (prop === 'font-style') {
      const style = val.toLowerCase();
      if (/^(italic|oblique)$/.test(style)) format.italic = true;
      return;
    }
    if (prop === 'text-decoration' || prop === 'text-decoration-line') {
      const bits = val.toLowerCase().split(/\s+/).filter(Boolean);
      if (bits.includes('underline')) format.underline = true;
      return;
    }
    if (prop === 'text-align' && blockTags.has(tag)) {
      const align = val.toLowerCase();
      if (['left','right','center','justify','start','end'].includes(align)) {
        format.align = align;
      }
      return;
    }
    if (prop === 'list-style-type') {
      const listType = val.toLowerCase();
      if (['disc','circle','square','decimal','decimal-leading-zero','lower-alpha','upper-alpha','lower-roman','upper-roman'].includes(listType)) {
        format.listStyle = listType;
      }
    }
  });
  return format;
}
