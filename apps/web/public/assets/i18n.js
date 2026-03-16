/* malzispace i18n (space app foundation) */
(function () {
  'use strict';

  const builtinDictionaries = {
    de: {
      'site.backHome': '← Zurück zur Startseite',
      'site.footer.privacy': 'Datenschutz',
      'site.footer.terms': 'AGB',
      'site.footer.imprint': 'Impressum',
      'site.footer.coffee': 'Buy me a coffee',
      'support.headline': 'Keine Paywall. Kein Bullshit.',
      'support.text': 'Und du hältst es am Laufen.',
      'support.button': 'Jetzt Projekt unterstützen',
      'landing.opensource.button': 'Open Source auf GitHub',
      'space.title.label': 'Titel',
      'space.title.placeholder': 'Ohne Titel',
      'space.button.share': 'Teilen',
      'space.button.copyAll': 'Kopieren',
      'space.button.copyQrLink': 'Link kopieren',
      'space.button.close': 'Schließen',
      'space.expired.notice': 'Dieser Space ist abgelaufen und wurde nach 24 Stunden automatisch gelöscht.',
      'space.expired.back': 'Zur Startseite',
      'space.editor.placeholder': 'Text hier einfügen …',
      'toolbar.aria': 'Textformatierung',
      'toolbar.group.textStyle': 'Textstil',
      'toolbar.group.alignment': 'Ausrichtung',
      'toolbar.group.colors': 'Farben',
      'toolbar.group.lists': 'Listen',
      'toolbar.heading': 'Überschrift',
      'toolbar.bold': 'Fett',
      'toolbar.italic': 'Kursiv',
      'toolbar.underline': 'Unterstrichen',
      'toolbar.strike': 'Durchgestrichen',
      'toolbar.unordered': 'Aufzählung',
      'toolbar.ordered': 'Nummerierte Liste',
      'toolbar.createLink': 'Link einfügen',
      'toolbar.linkShort': 'Link',
      'toolbar.alignLeft': 'Linksbündig',
      'toolbar.alignCenter': 'Zentriert',
      'toolbar.alignRight': 'Rechtsbündig',
      'toolbar.alignJustify': 'Blocksatz',
      'toolbar.horizontalRule': 'Horizontale Linie',
      'toolbar.textColor': 'Schriftfarbe',
      'toolbar.backgroundColor': 'Hintergrundfarbe',
      'toolbar.clearColors': 'Farben löschen',
      'modal.close': 'Schließen',
      'qr.title': 'Space per QR teilen',
      'qr.subtitle': 'Scanne den QR-Code oder kopiere den Link.',
      'qr.label': 'QR-Code',
      'linkModal.title': 'Link einfügen',
      'linkModal.subtitle': 'Füge eine Adresse ein. Bei Bedarf wird automatisch https:// ergänzt.',
      'linkModal.label': 'Adresse',
      'linkModal.placeholder': 'https://example.com',
      'linkModal.confirm': 'Link übernehmen',
      'linkModal.cancel': 'Abbrechen',
      'footer.countdown': 'Automatische Löschung in',
      'sim.pageTitle': 'malziSPACE Editor Simulator',
      'sim.heading': 'Editor Simulator',
      'sim.note': 'Automatischer Test für Toolbar-Befehle gegen den modularen Editor.',
      'sim.results.running': 'Tests laufen …',
      'status.connected': 'Verbunden',
      'status.disconnected': 'Getrennt',
      'status.expired': 'Abgelaufen',
      'status.simulator': 'Simulator',
      'status.invalidLink': 'Ungültiger Link',
      'status.localMode': 'Lokaler Modus',
      'status.offline': 'Offline',
      'status.noKey': 'Kein Schlüssel – nicht gespeichert',
      'status.saving': 'Speichern…',
      'status.saved': 'Gespeichert',
      'status.error': 'Fehler',
      'status.connecting': 'Verbinden…',
      'status.reconnecting': 'Verbinden… erneuter Versuch',
      'status.syncing': 'Synchronisieren…',
      'presence.one': '1 Person',
      'presence.many': '{count} Personen',
      'copy.copied': 'Kopiert ✔',
      'copy.linkCopied': 'Link kopiert ✔',
      'copy.linkPrompt': 'Link kopieren:',
      'copy.textPrompt': 'Text kopieren:',
      'dialog.enterLink': 'Link eingeben (https://...)',
      'dialog.missingKeyAlert': 'Dieser Space ist Ende-zu-Ende-verschlüsselt. Der Link muss den geheimen Teil nach dem # enthalten.',
      'qr.loadFailed': 'QR-Code konnte nicht geladen werden.',
      'space.simulator.title': 'Simulator',
      'error.cryptoUnavailable': 'Dein Browser unterstützt die Web Crypto API nicht. Bitte verwende einen aktuellen Browser (Chrome, Firefox, Safari oder Edge).'
    },
    en: {
      'site.backHome': '← Back to homepage',
      'site.footer.privacy': 'Privacy',
      'site.footer.terms': 'Terms',
      'site.footer.imprint': 'Imprint',
      'site.footer.coffee': 'Buy me a coffee',
      'support.headline': 'No paywall. No bullshit.',
      'support.text': 'And you keep it running.',
      'support.button': 'Support the project',
      'landing.opensource.button': 'Open source on GitHub',
      'space.title.label': 'Title',
      'space.title.placeholder': 'Untitled',
      'space.button.share': 'Share',
      'space.button.copyAll': 'Copy',
      'space.button.copyQrLink': 'Copy link',
      'space.button.close': 'Close',
      'space.expired.notice': 'This space has expired and was deleted automatically after 24 hours.',
      'space.expired.back': 'Back to homepage',
      'space.editor.placeholder': 'Paste text here …',
      'toolbar.aria': 'Text formatting',
      'toolbar.group.textStyle': 'Text style',
      'toolbar.group.alignment': 'Alignment',
      'toolbar.group.colors': 'Colors',
      'toolbar.group.lists': 'Lists',
      'toolbar.heading': 'Heading',
      'toolbar.bold': 'Bold',
      'toolbar.italic': 'Italic',
      'toolbar.underline': 'Underline',
      'toolbar.strike': 'Strikethrough',
      'toolbar.unordered': 'Bulleted list',
      'toolbar.ordered': 'Numbered list',
      'toolbar.createLink': 'Insert link',
      'toolbar.linkShort': 'Link',
      'toolbar.alignLeft': 'Align left',
      'toolbar.alignCenter': 'Align center',
      'toolbar.alignRight': 'Align right',
      'toolbar.alignJustify': 'Justify',
      'toolbar.horizontalRule': 'Horizontal line',
      'toolbar.textColor': 'Text color',
      'toolbar.backgroundColor': 'Background color',
      'toolbar.clearColors': 'Clear colors',
      'modal.close': 'Close',
      'qr.title': 'Share space via QR',
      'qr.subtitle': 'Scan the QR code or copy the link.',
      'qr.label': 'QR code',
      'linkModal.title': 'Insert link',
      'linkModal.subtitle': 'Paste an address. https:// will be added automatically if needed.',
      'linkModal.label': 'Address',
      'linkModal.placeholder': 'https://example.com',
      'linkModal.confirm': 'Insert link',
      'linkModal.cancel': 'Cancel',
      'footer.countdown': 'Automatic deletion in',
      'sim.pageTitle': 'malziSPACE Editor Simulator',
      'sim.heading': 'Editor Simulator',
      'sim.note': 'Automated test for toolbar commands against the modular editor.',
      'sim.results.running': 'Tests running …',
      'status.connected': 'Connected',
      'status.disconnected': 'Disconnected',
      'status.expired': 'Expired',
      'status.simulator': 'Simulator',
      'status.invalidLink': 'Invalid link',
      'status.localMode': 'Local mode',
      'status.offline': 'Offline',
      'status.noKey': 'No key – not saved',
      'status.saving': 'Saving…',
      'status.saved': 'Saved',
      'status.error': 'Error',
      'status.connecting': 'Connecting…',
      'status.reconnecting': 'Connecting… retrying',
      'status.syncing': 'Syncing…',
      'presence.one': '1 person',
      'presence.many': '{count} people',
      'copy.copied': 'Copied ✔',
      'copy.linkCopied': 'Link copied ✔',
      'copy.linkPrompt': 'Copy link:',
      'copy.textPrompt': 'Copy text:',
      'dialog.enterLink': 'Enter link (https://...)',
      'dialog.missingKeyAlert': 'This space is end-to-end encrypted. The link must include the secret part after the #.',
      'qr.loadFailed': 'QR code could not be loaded.',
      'space.simulator.title': 'Simulator',
      'error.cryptoUnavailable': 'Your browser does not support the Web Crypto API. Please use a modern browser (Chrome, Firefox, Safari, or Edge).'
    }
  };

  function mergeDictionaries(base, extra) {
    const out = {};
    const locales = new Set([
      ...Object.keys(base || {}),
      ...Object.keys(extra || {})
    ]);
    locales.forEach((localeKey) => {
      out[localeKey] = Object.assign({}, (base && base[localeKey]) || {}, (extra && extra[localeKey]) || {});
    });
    return out;
  }

  const dictionaries = mergeDictionaries(
    builtinDictionaries,
    (window.MZ_I18N_DICTIONARIES && typeof window.MZ_I18N_DICTIONARIES === 'object')
      ? window.MZ_I18N_DICTIONARIES
      : {}
  );

  function getLocale() {
    try {
      const fromQuery = new URLSearchParams(window.location.search).get('lang');
      if (fromQuery && dictionaries[fromQuery]) return fromQuery;
    } catch (e) {}
    const docLang = String(document.documentElement.lang || '').trim().slice(0, 2).toLowerCase();
    if (dictionaries[docLang]) return docLang;
    const navLang = String((navigator.language || 'de')).trim().slice(0, 2).toLowerCase();
    if (dictionaries[navLang]) return navLang;
    return 'de';
  }

  function interpolate(value, vars) {
    let out = String(value || '');
    const entries = Object.entries(vars || {});
    for (const [key, next] of entries) {
      out = out.replaceAll(`{${key}}`, String(next));
    }
    return out;
  }

  const locale = getLocale();
  document.documentElement.lang = locale;

  function t(key, vars) {
    const local = dictionaries[locale] || dictionaries.de;
    const fallback = dictionaries.de;
    const value = Object.prototype.hasOwnProperty.call(local, key) ? local[key] : fallback[key];
    return interpolate(value || key, vars);
  }

  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = t(el.getAttribute('data-i18n'));
    });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
    });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder')));
      el.setAttribute('data-placeholder', t(el.getAttribute('data-i18n-placeholder')));
    });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => {
      el.setAttribute('title', t(el.getAttribute('data-i18n-title')));
    });
    root.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', t(el.getAttribute('data-i18n-aria-label')));
    });
    root.querySelectorAll('[data-i18n-data-label]').forEach((el) => {
      el.setAttribute('data-label', t(el.getAttribute('data-i18n-data-label')));
    });
  }

  window.MZ_I18N = { locale, t, apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    apply();
  }
})();
