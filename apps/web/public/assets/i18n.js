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
      'landing.lock.label': 'Mit Sperre erstellen',
      'landing.lock.info': 'Nur du als Ersteller kannst schreiben oder die Sperre wieder öffnen. Du bekommst dazu einen Owner-Link, den du wie ein Passwort behandeln solltest – ohne ihn bleibt der Space dauerhaft gesperrt.',
      'landing.lock.infoAria': 'Was bedeutet „Mit Sperre erstellen"?',
      'landing.lock.hint': 'Du bekommst zusätzlich einen Owner-Link. Bewahre ihn wie ein Passwort auf – ohne ihn bleibt der Space dauerhaft gesperrt.',
      'space.lock.locked': 'Gesperrt – nur Owner darf schreiben',
      'space.lock.unlocked': 'Offen – jeder mit Link darf schreiben',
      'space.lock.readOnly': 'Nur Lesen – Space ist gesperrt',
      'space.lock.toggleLocked': 'Space entsperren',
      'space.lock.toggleUnlocked': 'Space sperren',
      'space.lock.error': 'Sperre konnte nicht geändert werden',
      'space.protect.toggleOff': 'Trainer-Inhalt schützen – Teilnehmer können dazuschreiben, deinen Text aber nicht ändern',
      'space.protect.toggleOn': 'Schutz deaktivieren – Teilnehmer können wieder alles bearbeiten',
      'space.protect.banner.trainer': 'Inhalt geschützt – Teilnehmer können dazuschreiben, aber deinen markierten Text nicht ändern.',
      'space.protect.banner.participant': 'Trainer-Inhalt geschützt – du kannst frei dazuschreiben und Eigenes ändern. Der gelb markierte Text bleibt unverändert.',
      'space.protect.toast.modify': 'Trainer-Inhalt kann nicht verändert werden.',
      'space.protect.toast.displace': 'Trainer-Inhalt darf nicht verschoben werden.',
      'space.protect.readOnly': 'Trainer-Inhalt geschützt — du kannst dazuschreiben, aber den markierten Text nicht ändern',
      'space.protect.error': 'Schutz konnte nicht geändert werden',
      'space.mode.label': 'Schreibmodus für diesen Space',
      'space.mode.open.label': 'Frei',
      'space.mode.open.hint': 'Frei — alle dürfen alles bearbeiten',
      'space.mode.protect.label': 'Schutz',
      'space.mode.protect.hint': 'Schutz — dein Trainer-Inhalt bleibt unverändert, Teilnehmer dürfen dazuschreiben',
      'space.mode.locked.label': 'Sperre',
      'space.mode.locked.hint': 'Sperre — nur du als Trainer kannst bearbeiten, Teilnehmer können nur lesen',
      'space.lock.banner.trainer': 'Space gesperrt — Teilnehmer können nur lesen. Klick auf „Frei" oder „Schutz" um die Sperre wieder aufzuheben.',
      'space.lock.banner.participant': 'Space gesperrt — du kannst den Inhalt nur lesen. Der Trainer hat die Bearbeitung gestoppt.',
      'owner.welcome.text': 'Du bist Owner. Sichere dir jetzt den Owner-Link – die Adresszeile zeigt ihn gleich nicht mehr.',
      'owner.welcome.copy': 'Owner-Link kopieren',
      'owner.welcome.copied': 'Kopiert ✔',
      'space.owner.copyLink': 'Owner-Link kopieren',
      'space.owner.linkLabel': 'Owner-Link',
      'space.share.aria': 'Lese-Link teilen',
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
      'landing.lock.label': 'Create with lock',
      'landing.lock.info': 'Only you as the creator can write or unlock the space. You also get an owner link – treat it like a password, because without it the space stays locked forever.',
      'landing.lock.infoAria': 'What does "Create with lock" mean?',
      'landing.lock.hint': 'You also get an owner link. Keep it like a password — without it, the space stays locked forever.',
      'space.lock.locked': 'Locked — only the owner can write',
      'space.lock.unlocked': 'Open — anyone with the link can write',
      'space.lock.readOnly': 'Read-only — space is locked',
      'space.lock.toggleLocked': 'Unlock space',
      'space.lock.toggleUnlocked': 'Lock space',
      'space.lock.error': 'Could not change lock state',
      'space.protect.toggleOff': 'Protect trainer content — participants can add text but cannot change yours',
      'space.protect.toggleOn': 'Disable protection — participants can edit everything again',
      'space.protect.banner.trainer': 'Content protected — participants can add text, but cannot change your highlighted content.',
      'space.protect.banner.participant': 'Trainer content protected — you can freely add and edit your own text. The highlighted text stays unchanged.',
      'space.protect.toast.modify': 'Trainer content cannot be changed.',
      'space.protect.toast.displace': 'Trainer content must not be moved.',
      'space.protect.readOnly': 'Trainer content protected — you can add text, but cannot change the highlighted parts',
      'space.protect.error': 'Could not change protection state',
      'space.mode.label': 'Writing mode for this space',
      'space.mode.open.label': 'Open',
      'space.mode.open.hint': 'Open — anyone can edit everything',
      'space.mode.protect.label': 'Protect',
      'space.mode.protect.hint': 'Protect — your trainer content stays, participants can still add their own',
      'space.mode.locked.label': 'Locked',
      'space.mode.locked.hint': 'Locked — only you as the trainer can edit, participants are read-only',
      'space.lock.banner.trainer': 'Space locked — participants are read-only. Click "Open" or "Protect" to release the lock.',
      'space.lock.banner.participant': 'Space locked — you can only read the content. The trainer paused editing.',
      'owner.welcome.text': 'You are the owner. Save the owner link now – the address bar will hide it shortly.',
      'owner.welcome.copy': 'Copy owner link',
      'owner.welcome.copied': 'Copied ✔',
      'space.owner.copyLink': 'Copy owner link',
      'space.owner.linkLabel': 'Owner link',
      'space.share.aria': 'Share read-only link',
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
    root.querySelectorAll('[data-i18n-tip]').forEach((el) => {
      el.setAttribute('data-tip', t(el.getAttribute('data-i18n-tip')));
    });
  }

  window.MZ_I18N = { locale, t, apply };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => apply());
  } else {
    apply();
  }
})();
