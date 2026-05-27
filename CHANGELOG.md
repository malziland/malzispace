# Changelog

Alle relevanten Aenderungen an malziSPACE werden hier dokumentiert.

## [1.3.3] - 2026-05-27

Notfall-Fix zu v1.3.2: Teilnehmer konnten weiterhin nicht in den
geschuetzten Spaces schreiben, weil mein Enter-Intercept einen zu
engen Bedingungs-Check hatte und `rangeTouchesOwner` fuer kollabierte
Carets an Span-Grenzen in einigen Browsern faelschlich `true` lieferte.

### Fixed
- PROTECT-BUG-09: Mein Enter-Intercept aus 1.3.2 feuerte nur, wenn der
  Caret laut DOM **in** einem `.mz-owner-text` steckte
  (`isInsideOwnerSpan(range.startContainer)`). In der Praxis landet
  der Caret beim Klick ans Ende einer geschuetzten Zeile aber oft
  **knapp dahinter** (z.B. `(p, 1)` direkt nach der Span, nicht im
  Textknoten der Span). Dort schlug der Check fehl, der Browser
  uebernahm Enter selbst und klonte die `mz-owner-text` Span in den
  neuen Block — Caret im leeren Owner-Span, jeder weitere Input
  blockiert. Der Intercept feuert jetzt sobald der **umgebende
  Block** Owner-Inhalt enthaelt, egal wo genau der Caret innerhalb
  des Blocks sitzt.
- PROTECT-BUG-10: `rangeTouchesOwner` rief fuer **kollabierte** Carets
  zusaetzlich `range.intersectsNode(span)` ueber alle Owner-Spans auf.
  Die WHATWG-Spec macht diesen Check fuer Carets an angrenzenden
  Boundary-Points uneindeutig — manche Browser-Implementierungen
  liefern `true` fuer einen Caret direkt nach einer Span. Folge:
  Tippen in der frisch erzeugten Teilnehmer-Zeile darunter wurde
  faelschlich blockiert. Fuer kollabierte Carets wird jetzt
  ausschliesslich `startEl.closest(.mz-owner-text)` genutzt — ein
  Punkt ausserhalb einer Span beruehrt sie definitionsgemaess nicht.
  Fuer echte Selektionen bleibt der Walk-Check erhalten.

## [1.3.2] - 2026-05-27

Folge-Bugfixes am Schutzmodus aus 1.3.1. Zwei Symptome aus dem
Live-Test wurden behoben: Teilnehmer landeten nach Enter in einer
leeren Owner-Span und konnten weder tippen noch loeschen; und vom
Owner per Strg+V eingefuegter Text war nicht als Owner-Inhalt
markiert, sodass der Schutz fuer Pasted-Content bis zum naechsten
Frei→Schutz-Toggle nicht griff.

### Fixed
- PROTECT-BUG-05: Wenn der Teilnehmer am Ende einer Owner-Span Enter
  drueckt, klont der Browser die Inline-Struktur in den neuen Block.
  Der Cursor saass in einer leeren `.mz-owner-text` Span und jeder
  weitere `insertText` / `deleteContent*` wurde als Edit am
  Trainer-Text gewertet und blockiert. Der `protect-guard` uebernimmt
  jetzt die Erzeugung des neuen Blocks selbst, wenn der Cursor in
  einer Owner-Span steht, und positioniert den Caret im frischen
  Block ausserhalb jeder Owner-Markierung
  (`insertCleanParagraphAfterCaret`). Damit funktioniert das Tippen
  in der neuen Zeile sofort.
- PROTECT-BUG-06: Backspace/Delete auf einer leeren, vom Teilnehmer
  gerade angelegten Zeile war pauschal blockiert, weil die zugehoerige
  Target-Range die benachbarte Owner-Span beruehrt. Der Guard
  erkennt jetzt rein-leere Teilnehmer-Bloecke
  (`deleteEmptyParticipantBlock`) und entfernt nur den leeren Block
  ohne den Owner-Inhalt anzufassen. Der Caret wird auf dem
  Nachbarblock ausserhalb der Owner-Span platziert.
- PROTECT-BUG-07: Owner pasted Inhalt waehrend Schutz an war kam als
  unmarkierter HTML-Fragment in den Editor; Teilnehmer konnten den
  frisch eingefuegten Text frei editieren bis der Owner einmal
  Frei→Schutz toggelte (was `markAllExistingAsOwner` ausloeste).
  `editor/clipboard.js` umhuellt jetzt jeden Pasted-Block in eine
  Owner-Span (oder bei reinem Inline-Fragment einen einzigen Wrap),
  sobald `ctx.appendOnly && ctx.isOwner` gilt
  (`wrapPasteAsOwner`). Pasted-Content ist damit ab dem ersten
  Render Teil des Schutzes.
- PROTECT-BUG-08: Teilnehmer klickte unten in den Editor um zu
  schreiben; der Caret landete automatisch im letzten Textknoten
  der letzten Owner-Span (= "innerhalb von Owner-Inhalt") und jeder
  Tastenanschlag wurde mit "Trainer-Inhalt kann nicht veraendert
  werden" geblockt. `findOwnerBoundary` erkennt jetzt, ob der Caret
  exakt auf der End-Grenze einer Owner-Span sitzt (also direkt nach
  dem letzten Zeichen, kein weiterer Owner-Inhalt im selben Block
  dahinter), und `insertTextAtOwnerBoundary` schreibt den Text in
  einen Geschwister-Textknoten ausserhalb der Span. Der Teilnehmer
  kann jetzt direkt am Ende der geschuetzten Bloecke lostippen,
  ohne erst Enter druecken zu muessen.

## [1.3.1] - 2026-05-27

UX-Iteration und Bugfixes am Append-Only-Schutz aus v1.3.0. Die zwei
einzelnen Icon-Buttons (Schloss + Schild) wurden zu einem segmentierten
Schalter mit drei Stufen zusammengefasst. Ein eigener Build-Pre-Check
verhindert ab jetzt, dass JavaScript-Syntaxfehler je wieder live gehen.

### Added
- MODE-SWITCH-01: Neuer 3-Stufen-Schalter `Frei | Schutz | Sperre`
  ersetzt die einzelnen Schild- und Schloss-Buttons fuer den Owner.
  Klar erkennbarer Aktiv-Zustand (gruen / orange / rot), gegenseitig
  ausschliessend, ein Klick reicht. `apps/web/public/assets/modules/ui/mode.js`
  orchestriert die zwei darunterliegenden Endpoints `/api/lock` und
  `/api/append-only` und reagiert auf beide Relay-Frames.
- MODE-SWITCH-02: Lock-Banner fuer Teilnehmer (rote Variante des
  Schutz-Banners). Wenn der Trainer den Space sperrt, sehen Teilnehmer
  jetzt nicht nur das rote Schloss-Icon sondern auch eine Erklaerung
  unter der Toolbar — konsistent mit dem Schutz-Banner.
- MODE-SWITCH-03: Passiver Schild-Indikator fuer Teilnehmer bei
  aktivem Schutz. Spiegelt das Verhalten des read-only Schloss-Icons
  und macht den Zustand auch in der Toolbar sichtbar (Banner allein
  war je nach Scroll-Position weg).
- AUTO-MARK-01: One-shot Auto-Markierung beim Oeffnen bestehender
  Spaces. Wenn der Owner einen Space oeffnet wo Schutz aktiv ist aber
  der Inhalt nicht markiert ist (z.B. weil er vor dem Fix aktiviert
  wurde), wird der vorhandene Text rueckwirkend in `.mz-owner-text`
  eingewickelt und ueber CRDT + saveNow synchronisiert.
- BUILD-CHECK-01: `tools/bin/build_hosting.mjs` ruft `node --check`
  ueber alle JS-Quellen auf, bevor der Build den Asset-Tree faengt.
  Ein Syntaxfehler bricht den Build sofort ab, das fehlerhafte File
  wird benannt — keine Chance, defektes JavaScript zu deployen.

### Changed
- MOBILE-01: Toolbar-Layout fuer schmale Viewports neu aufgebaut.
  Mode-Switch belegt jetzt eine eigene volle Breite-Zeile mit gleich
  grossen Segmenten. Owner-Link und Lese-Link Buttons sind kompakt
  aber **mit Label** dargestellt — vorher nur Icons, was zu
  Verwechslungsgefahr gefuehrt hat.
- I18N-PROTECT-01: Drei neue String-Bloecke hinzugefuegt:
  - `space.mode.*` fuer den Schalter selbst (Tooltip + Label je Segment)
  - `space.lock.banner.*` fuer die Sperre-Banner-Texte (Trainer/Teilnehmer)
  - `space.protect.readOnly` fuer den Hover-Text des passiven Schild-Indikators

### Fixed
- PROTECT-BUG-01: Wenn protect aktiviert wurde, lief `markAllExistingAsOwner`
  nur ueber die obersten Editor-Bloecke und nur beim allerersten Toggle.
  Spaces mit gemischtem oder bereits einmal getoggelten Inhalt
  blieben unmarkiert. Logik wurde umgestellt: bei jeder Aktivierung
  wird jeder Block geprueft und entweder vollstaendig oder
  Text-Knoten-weise nachmarkiert. Nach dem Markieren wird ein
  `saveNow()` (kein debouncted `queueSave`) erzwungen, damit das
  naechste `/api/load` den korrekten Stand liefert.
- PROTECT-BUG-02: Optimistic UI-Update setzte `ctx.appendOnly` vor
  der Server-Anfrage, wodurch die anschliessende Vergleichspruefung
  `Boolean(ctx.appendOnly) !== wantProtected` immer `false` ergab
  und `postAppendOnly` nie aufgerufen wurde. Der originale Zustand
  wird jetzt vor dem optimistischen Apply als `wasProtected` /
  `wasLocked` festgehalten und die API-Aufrufe vergleichen gegen
  diesen Snapshot.
- PROTECT-BUG-03: Verschiebung-Sperre des Editor-Guards war zu
  aggressiv und blockierte auch Tippen in leeren Zeilen zwischen
  Trainer-Bloecken. `insertText` und `insertParagraph` werden jetzt
  getrennt behandelt: `insertText` blockiert nur wenn Owner-Text in
  derselben Zeile rechts vom Cursor liegt, `insertParagraph` nur wenn
  spaeter im Dokument noch Owner-Inhalt folgt.
- PROTECT-BUG-04: Enter direkt am Ende eines Owner-Spans war pauschal
  blockiert obwohl es keinen Trainer-Text verschiebt. Eigene Bedingung
  `cursorInsideOwnerWithContentAfter` unterscheidet jetzt zwischen
  Cursor mittendrin (Split-Gefahr → blockiert) und Cursor am Ende
  (saubere neue Zeile darunter → erlaubt).

### Defensive
- CSS-SAFETY-01: Zusaetzliche CSS-Regel
  `body.has-append-only:not(.has-owner-ui) #protectToggle`
  erzwingt die Sichtbarkeit des Teilnehmer-Schild-Indikators per
  Specificity, falls JavaScript aus irgendeinem Grund das `hidden`-
  Attribut nicht aktualisiert haben sollte. Belt-and-suspenders fuer
  Zustaende die das Banner zeigen aber das Toolbar-Icon nicht.

## [1.3.0] - 2026-05-27

Neuer „Inhalt schuetzen"-Modus (Append-Only): Trainer kann seinen eigenen
Text gegen Veraenderung durch Teilnehmer schuetzen, waehrend Teilnehmer
weiterhin frei dazuschreiben und Eigenes editieren koennen. Schalt-,
Sicht- und Edit-Logik sind unabhaengig von der bestehenden Read-Only-
Sperre und koennen mit ihr kombiniert werden.

### Added
- PROTECT-01: Neues Schild-Icon in der Toolbar (nur Owner sichtbar)
  schaltet den Schutzmodus an/aus. Bei der ersten Aktivierung wird der
  vorhandene Inhalt rueckwirkend als Trainer-Inhalt markiert
  (`<span class="mz-owner-text">…</span>`). Jeder weitere Owner-Insert
  wird automatisch in einen Owner-Span eingewickelt; angrenzende
  Spans verschmelzen, so dass die Markierung als ein zusammenhaengender
  gelber Bereich gerendert wird.
- PROTECT-02: Backend-Endpoint `POST /api/append-only` setzt
  `append_only` auf dem `spaces`-Dokument (owner-authentifiziert).
  `/api/load` liefert das Feld an Clients aus. Der collab-relay
  broadcastet neue Werte via `{type: "append_only_state", append_only: bool}`
  analog zum bestehenden `lock_state`-Frame.
- PROTECT-03: Banner unter der Toolbar erklaert den aktiven Modus
  fuer beide Rollen — rollenabhaengiger Text via i18n.
- PROTECT-04: Toast-Hinweis unten erscheint kurz, wenn ein Teilnehmer
  versucht, Trainer-Inhalt zu veraendern. Zwei Texte: „kann nicht
  veraendert werden" beim Editier-/Loeschversuch innerhalb des
  Owner-Texts, „darf nicht verschoben werden" beim Verschiebe-Versuch
  (Enter/Tippen direkt vor einem Owner-Block).
- PROTECT-05: Neuer E2E-Test `tests/e2e/run_space_protect_e2e.mjs`
  („npm run test:e2e:protect") deckt initial-state, retroaktive
  Markierung, Live-Propagation via Relay, Reader-Blockade und
  Owner-Toggle-off ab.

### Changed
- LOAD-API-01: `/api/load`-Response enthaelt jetzt das Feld
  `append_only` (bool). Existing Clients ignorieren unbekannte
  Felder; aeltere Versionen sehen den Modus daher als „aus".

### Implementation Notes
- Die Schutzmarkierung lebt als HTML-Klasse `mz-owner-text` direkt im
  Editor-DOM. Der bestehende `getEditorStoredContent`-Sanitizer
  behaelt `class`-Attribute bei und entfernt Spans mit Klassen
  *nicht*, womit die Markierung automatisch durch Y.Text/CRDT-Sync
  transportiert wird — kein neues Yjs-Attribut noetig.
- Editor-Interception sitzt in `editor/protect-guard.js` und nutzt
  `beforeinput` + `getTargetRanges()` als zentralen Hook. Damit
  werden Backspace/Delete an Span-Grenzen korrekt abgefangen
  (Standard-Selection allein reicht dafuer nicht) und Mobile
  iOS/Android-Software-Tastaturen abgedeckt, weil sie ueber
  `beforeinput` statt `keydown` operieren.
- Lock + Protect: Lock gewinnt visuell (Editor read-only fuer Reader),
  Protect bleibt im Hintergrund aktiv und reaktiviert sich beim
  Entsperren — keine Sonderlogik noetig, weil der Guard nur greift
  wenn der Editor editierbar ist.

## [1.2.1] - 2026-05-17

Owner-Lock-Iteration nach Initial-1.2.0: UX-Politur, Owner-Link aus der
Adresszeile heraus, Live-Race im Relay-Connect, robuste Cache-Hygiene
gegen bf-cache und Browser-Tab-Restore.

### Changed
- LOCK-UI-01: Landingpage — die „Mit Sperre erstellen"-Checkbox sitzt
  nicht mehr zwischen Titel-Input und Submit-Button. Eigene Zeile unter
  dem Primary-Flow, dezenter, mit kleinem Info-Icon (ⓘ) das per
  Hover/Fokus erklaert was die Sperre macht. Label gekuerzt.
- LOCK-UI-02: Lock-Icon in der Space-Toolbar ist jetzt flach, 24px,
  ohne Button-Rahmen. Body ist gefuellt — Rot fuer „gesperrt"
  (sowohl fuer Owner als auch als Read-Only-Indikator fuer Reader),
  Gruen fuer „offen" (nur Owner). Stil bleibt im Einklang mit den
  uebrigen Toolbar-Icons (Stroke `currentColor`, kein Fill bei der
  Schackel-Linie).
- LOCK-UI-03: Owner-Link-Kopier-Button bekam eine sichtbare „Owner-Link"-
  Beschriftung neben dem Clipboard-Icon plus rot getoenten Rand, damit
  er sich klar vom Teilen-Button unterscheidet. Teilen-Button bekam
  ein Share-Icon und ein eindeutiges `aria-label`/`title` „Lese-Link
  teilen". User-Report war: bare Clipboard-Icon war zu generisch,
  Teilen-Button schien dasselbe zu kopieren.
- LOCK-UI-04: Owner-Welcome-Banner radikal abgespeckt — eine Zeile
  mit Hinweis + „Owner-Link kopieren"-Button + dezenter `×`-Schliesser,
  kein eingebettetes Read-only-Inputfeld mehr.

### Added
- PRIVACY-01: Owner-URL wird nicht mehr in der Adresszeile angezeigt.
  `crypto.js` cached den Hash beim Module-Load in eine modul-lokale
  Variable und in `sessionStorage["mz_keys_<id>"]`. Anschliessend
  raeumt `history.replaceState` die `#<key>.<ownerSecret>`-Komponente
  weg, ohne Decryption oder Reload-im-Tab zu brechen. Reader-URLs
  bleiben unveraendert, weil sie shareable sein muessen.
- PRIVACY-02: Persistenter „Owner-Link"-Button in der Toolbar ist
  nur fuer Owner sichtbar und rekonstruiert die volle Owner-URL aus
  den gecachten Schluesseln, wenn der Owner den Link erneut kopieren
  will. Welcome-Banner spiegelt diesen Button fuer den Erst-Kontakt.
- CACHE-01: HTML-Antworten kommen jetzt mit `Cache-Control: no-store,
  no-cache, must-revalidate, max-age=0` — Browser cachen sie nicht
  mehr zwischen Tab-Wechseln.
- CACHE-02: Neue Datei `assets/version-check.js`. Pollt alle 60 s
  (plus bei `visibilitychange`) die eigene Seite, vergleicht den
  `app.<hash>.js`-Dateinamen mit dem geladenen Bundle und blendet bei
  Mismatch unten mittig ein „Neue Version verfuegbar — Neu laden"-
  Banner ein. So sehen Nutzer mit aelterem Tab den naechsten Deploy
  ohne harten Refresh.
- CACHE-03: `pageshow`-Listener in `space-bootstrap.js` und
  `version-check.js`. Wird die Seite aus dem bf-cache restauriert
  (`event.persisted === true`), erzwingt der Listener einen
  `location.reload()`. `Cache-Control: no-store` allein verhindert
  bf-cache-Speicherung auf modernen Chromium/WebKit-Browsern nicht.
- CACHE-04: Neue Notfall-URL `https://malzi.space/reset-cache.html`.
  Die Antwort traegt `Clear-Site-Data: "cache", "storage"` — der
  Browser ist verpflichtet, Cache + lokalen Storage fuer die Origin
  zu loeschen. Eine kleine Bestaetigungsseite plus „Zur Startseite"-
  Link helfen Nutzern aus festgefahrenen Tab-Zustaenden raus, ohne
  dass sie ihren globalen Browser-Cache opfern muessen.

### Fixed
- LOCK-FIX-01: `[hidden] { display: none !important }` global in
  `space.css`. Vorher hatte die Klasse `.btn-with-icon` mit
  `display: inline-flex` dieselbe Spezifitaet wie der Browser-Default
  `[hidden] { display: none }` und gewann durch Quelltextreihenfolge.
  Folge: `ownerCopyBtn.hidden = true` blieb visuell wirkungslos und
  Reader sahen den Owner-Link-Button. Live verifiziert per Playwright
  gegen Production.
- LOCK-FIX-02: Hash-only-Navigation (Owner-Tab → Reader-URL in die
  Adressleiste tippen, Enter) loest in Browsern keinen Reload aus.
  Ohne Reload bleiben `cachedOwnerSecretB64` und `ctx.isOwner` im
  Owner-Zustand. Neuer `hashchange`-Listener in space-bootstrap.js
  ruft `window.location.reload()` — `history.replaceState` (unser
  Owner-URL-Strip) loest kein hashchange aus, also keine
  Reload-Schleife.
- LOCK-FIX-03: Relay-`attachRoomState` initialisierte den raum-
  internen `readOnly`-State auf `false` und ueberliess das Update
  dem asynchronen Firestore-onSnapshot-Listener. Verbindet sich ein
  Client, bevor das erste Snapshot eintrifft, schickt der Relay
  `{type:"lock_state", read_only:false}` und der Client ueberschreibt
  damit den korrekten `read_only:true` aus `/api/load`. Folge: frisch
  gepasteter Owner-Link zeigte ein gruenes/offenes Schloss statt
  rot/gesperrt. `getRoomAuthEntry` liest `read_only` jetzt synchron
  mit, und `attachRoomState` seedet damit den State sofort korrekt.
- LOCK-FIX-04: Owner-Copy-Button-Sichtbarkeit wurde frueher nur in
  `initLock` einmal anhand `ctx.isOwner` gesetzt. Brave-bf-cache hat
  in seltenen Faellen einen Zwischenstand restauriert, in dem das
  Lock-Toggle bereits in 'locked'-Zustand war, der Owner-Copy-Button
  aber noch das alte `hidden=true` trug. Die Aktualisierung des
  Buttons ist jetzt Teil von `updateLockButtonUi` und laeuft bei
  jedem `applyLockState`-Call mit — der State heilt sich beim
  naechsten Update von selber.
- LOCK-FIX-05: Eine kurzlebige `body-class`-CSS-Defense
  (`body:not(.has-lock-ui) #lockToggle ...`) wurde wieder entfernt.
  Sie versteckte Buttons by-default und brauchte JS um sie sichtbar
  zu machen — bei Tab-Restore mit Mismatch zwischen JS-Lauf und
  CSS-Stand fielen beide Buttons unsichtbar aus. `[hidden]`-Rule
  ist robust genug.

### Tests
- `tests/e2e/run_space_lock_e2e.mjs` erweitert auf jetzt 13 Schritte:
  Owner-URL-Strip-Check, Welcome-Banner-Form, Owner-Link-Button-
  Hidden-Check fuer Reader (computed display, nicht nur Attribut),
  Live-Toggle, fresh-tab Owner, Owner-Tab navigiert zu Reader-URL,
  parallel Owner+Reader im selben Browser-Context.

### Out-of-Scope (bewusst)
- Brave Shields koennen `Clear-Site-Data` Header oder
  `version-check.js`-Fetches blockieren. In dem Fall hilft der
  Workaround `brave://settings/clearBrowserData` selektiv.

## [1.2.0] - 2026-05-17

Owner-Link und Read-Only-Sperre fuer Spaces. Der Ersteller kann beim
Anlegen eine Sperre aktivieren und bekommt zusaetzlich einen Owner-Link
ins URL-Fragment. Nur mit Owner-Link laesst sich die Sperre ein- und
ausschalten und im gesperrten Zustand schreiben. Zero-Knowledge bleibt
vollstaendig erhalten: Server sieht weiter nur Hashes und Signaturen,
keinen Klartext.

### Added
- OWNER-01: Neues optionales `owner_key_proof`-Feld auf `spaces`. Wird
  beim `/api/create` mitgegeben, setzt das den Space auf
  `read_only: true` und legt das zweite Geheimnis (SHA-256 vom 32-Byte
  Owner-Secret) ab. Spaces ohne Feld verhalten sich exakt wie bisher.
- OWNER-02: Neuer Endpunkt `POST /api/lock` zum Umschalten von
  `read_only`. Nur per `owner_key_proof` autorisiert; mismatch → 403
  `read_only_not_owner`, kein Owner hinterlegt → 404 `no_owner`.
- OWNER-03: `/api/save`, `/api/title` und `/api/yjs/push` setzen eine
  zentrale `checkWriteAuth`-Regel um — bei gesperrtem Owner-Space
  reicht `key_proof` nicht mehr, der Aufruf muss `owner_key_proof`
  mitsenden. Bei normalen Spaces ist der Pfad unveraendert.
- OWNER-04: `/api/load` liefert zusaetzlich `read_only` und
  `has_owner`, damit der Client den UI-Zustand direkt nach dem ersten
  Load korrekt setzt.
- OWNER-05: Collab-Relay unterscheidet Owner- und Reader-Connections.
  Owner-Clients senden `is_owner=1` plus `owner_sig` (HMAC ueber
  `room.exp.nonce` mit `owner_key_proof`); Reader benutzen weiter die
  bestehenden Signaturen. Bei gesperrtem Space werden Yjs-Updates von
  Nicht-Ownern verworfen, statt sie zu broadcasten.
- OWNER-06: Per-Raum-Firestore-Listener im Relay halt den Lock-Status
  live nach. Wechselt `read_only`, broadcastet das Relay einen
  Control-Frame `{type:"lock_state", read_only:bool}` an alle
  verbundenen Clients. Neue Connections bekommen sofort den
  aktuellen Status.
- OWNER-07: Frontend: Checkbox „Beim Erstellen sperren" auf der
  Landingpage, neue Owner-URL-Form `#<key>.<ownerSecret>` (Dot
  trennt zwei base64url-Segmente), Schloss-Icon in der Space-Toolbar
  zum Sperren/Entsperren fuer Owner, sichtbarer Read-Only-Status fuer
  Reader. `setEditorEditable(false)` und disabled Toolbar bei
  Reader-auf-gesperrt; Live-Update via `lock_state`-Frame ohne
  Reload.
- OWNER-08: Share-Button (QR + Link kopieren) entfernt das
  Owner-Secret aus der URL, bevor sie an den QR-Renderer oder die
  Clipboard geht. Damit kann der Owner nicht versehentlich seinen
  eigenen Schreibzugang teilen, wenn er „Teilen" klickt.
- OWNER-09: Lokaler Test-Stack (`firebase.json` emulators + neuer
  `tests/support/dev_stack.mjs`) startet Firestore-, Database-,
  Functions- und Hosting-Emulator plus den Relay-Service in einem
  Rutsch. Der API-Service bekommt einen `MZ_DISABLE_APPCHECK=1`-
  Bypass, der nur dann greift, wenn die Env-Var explizit gesetzt
  ist — in Produktion ohne Wirkung. Neuer E2E-Test
  `tests/e2e/run_space_lock_e2e.mjs` (`npm run test:e2e:lock`)
  deckt das Owner-/Reader-Verhalten und den Live-Toggle ueber den
  echten Stack ab.
- OWNER-10: API-Service migriert von der `admin.firestore.Timestamp`-
  Namespace-Form auf modulare Imports
  (`firebase-admin/firestore`, `firebase-admin/database`), weil die
  Namespace-Form unter dem Functions-Emulator nicht zuverlaessig
  aufgeloest wurde. Verhalten unveraendert.
- OWNER-11: Owner-Welcome-Banner: nach einem `lock-on-create`-Flow
  zeigt der Space dem frischen Owner einmal einen Hinweis mit dem
  bereinigten Teilen-Link und einem Copy-Button. Markierung via
  `sessionStorage.mz_fresh_owner_<id>`, automatisch konsumiert beim
  ersten Anzeigen.
- OWNER-12: `ops/verify_local.sh` zieht den neuen Lock-E2E (Schritt
  10/10) ein, stoppt vorher den statischen Server, damit der
  Firebase-Emulator den Port uebernehmen kann.

### Out-of-Scope (bewusst)
- Kein Owner-Recovery; verlorener Owner-Link → Space bleibt im
  aktuellen Sperrzustand bis Ablauf.

## [1.1.1] - 2026-05-17

Externe Audit-Befunde umgesetzt: Release-Gate-Reparatur, Privacy-Versprechen
und Lifecycle haerten, Token-Mint absichern, Doku ehrlich machen.

### Fixed
- REL-01: Dependency-Audit-Gate war rot wegen Critical-/High-Advisories im
  Lockfile-Drift. Alle drei Workspaces (Root, `services/api`,
  `services/collab-relay`) gegen `engines.node=24` neu installiert; die
  uebrigen Low-Advisories bleiben unter dem `--audit-level=high`-Schwellwert.
- REL-02: `/api/delete` und der TTL-Cleanup loeschten Firestore-Metadaten,
  bevor RTDB/Yjs/Presence-Daten weg waren — bei RTDB-Fehler blieben
  verschluesselte Yjs-Updates verwaist. Reihenfolge umgedreht: RTDB zuerst,
  Firestore danach. Schlaegt RTDB fehl, bleibt der Firestore-Eintrag fuer
  den naechsten Cleanup-Lauf stehen; `cleanupExpired` bricht bei einem
  RTDB-Ausfall sauber ab, statt im Kreis zu laufen.
- REL-03: `services/collab-relay`-Lockfile pinnte noch Node 22 und
  `ws 8.17.1` gegenueber `^8.19.0`/Node 24 im Manifest. Service-Lockfiles
  neu erzeugt, Relay-Dockerfile auf `npm ci` umgestellt, CI installiert und
  auditiert jetzt jeden Service-Lockfile einzeln, damit der Docker-Build
  exakt das auditierte Dependency-Set deployt.
- REL-04: `ops/verify_live.sh` defaultete auf `malzispace.web.app`,
  beworbene Custom-Domain ist aber `malzi.space`. Default auf die
  Custom-Domain umgestellt; Release-Checklist nennt jetzt explizit beide
  Domains.
- STATE-01: Der Legacy-Save-Pfad meldete dem Client „gespeichert", auch
  wenn `/api/save` einen Versionskonflikt erkannte — zwei parallel
  arbeitende Tabs konnten sich gegenseitig stillschweigend ueberschreiben.
  `/api/save` antwortet bei Versionskonflikt jetzt mit HTTP 409
  `version_conflict` (inkl. `server_version`); der Frontend-Saver behandelt
  Konflikte als Fehler. Der URL-Parameter `?ff_enableCrdt=0` wurde
  entfernt — Produktion nutzt immer den Yjs/CRDT-Pfad.

### Security
- PRIV-01: `/api/create`, `/api/save` und `/api/title` nahmen einen
  Klartext-`title`-Feld an und speicherten ihn in Firestore, wenn
  `title_enc` fehlte — Widerspruch zur Zero-Knowledge-Zusage. Klartext
  wird jetzt mit `400 plaintext_title_not_allowed` abgelehnt, das alte
  `title`-Feld komplett aus Speicher und Antwort-Body entfernt. Frontend
  + Live-Smoke + Load-Tests senden den Klartext nicht mehr.
- SEC-01: `POST /api/appcheck/token` war auch ohne `Origin`-Header
  erreichbar — ein Skript-Client konnte Custom-App-Check-Tokens minten,
  ohne je die Website zu laden. Endpunkt fordert jetzt strikt einen
  `Origin`-Header und antwortet sonst mit `403 origin_required`. Die
  uebrigen Endpunkte bleiben tolerant, weil sie ueber `key_proof` zusaetzlich
  abgesichert sind.

### Changed
- PRIV-02: README hatte „Keine externen Scripts" stehen, obwohl Firebase
  App Check sein SDK von `https://www.gstatic.com/firebasejs/...` laedt.
  Privacy-Abschnitt umformuliert, sodass die einzige Drittanbieter-
  Skriptquelle namentlich genannt wird; der Datenschutz-Abschnitt
  praezisiert, dass kein Analytics-/Auth-/Datenbank-SDK eingebunden ist.

## [1.1.0] - 2026-03-16

### Added
- Meta-Description fuer SEO (`<meta name="description">`)
- `<main>` Landmark und `<h2>` Heading-Hierarchie fuer Accessibility
- `.sr-only` CSS-Klasse fuer Screen-Reader-Only-Elemente
- `<link rel="preconnect">` fuer Firebase-Domains (Performance)
- Logo `width`/`height` Attribute auf allen Seiten (CLS-Vermeidung)
- CHANGELOG.md fuer transparente Entwicklungsdokumentation
- `POST /api/delete` Endpoint fuer GDPR Art. 17 Recht auf Loeschung (SEC-007)
- Graceful Degradation bei fehlender Web Crypto API (ARCH-003)

### Changed
- Datenschutzseite: Zero-Knowledge-Klarstellung zu Inhalten vs. HTTP-Metadaten
- i18n: Neue Schluessel `privacy.s1.meta` (DE/EN) und `error.cryptoUnavailable` (DE/EN)

### Fixed
- BUG-001: Dockerfile Node-Version 22 → 24 (Collab-Relay)
- BUG-002: AppCheck Race Condition — explizites Warten auf Initialisierung
- BUG-006: Selection-Marker-Cleanup mit `finally`-Block statt dupliziertem Code
- BUG-007: Dynamic Color Cache evicted aelteste Eintraege statt still zu versagen
- SEC-002: AppCheck App-ID-Validierung im API-Backend
- SEC-003: Room-ID-Regex Collab-Relay `{3,48}` → `{6,24}`
- SEC-004: Rate-Limiter Fail-Closed (503 statt Pass-Through)
- SEC-005: Redundante CSP-Meta-Tag auf index.html (Defense-in-Depth)
- SEC-006: SRI-Integritaetsattribut fuer qrcode.min.js
- SEC-008: WS-Auth-Cache-TTL 30s → 5s (Collab-Relay)

### Security
- API Error-Logging sanitized: nur `err.code`/`err.message` statt voller Stacktrace
- Alle `console.error` Aufrufe im API-Backend gegen Informationsleck abgesichert

## [1.0.0] - 2026-03-15

### Added
- Ende-zu-Ende-verschluesselter Paste-Service mit 24h Auto-Loeschung
- Echtzeit-Zusammenarbeit via WebSocket (Yjs CRDT)
- Modularer Editor mit Rich-Text-Formatierung (Bold, Italic, Underline, Listen, Links, Farben)
- Proof-of-Work Spam-Schutz (Custom AppCheck Provider)
- Vollstaendige i18n-Unterstuetzung (Deutsch/Englisch)
- Responsive Design (Desktop + Mobile)
- QR-Code-Sharing fuer Spaces
- Firebase Hosting, Cloud Functions v2, Firestore, RTDB
- Collab-Relay WebSocket-Server (Cloud Run)
- Umfassende E2E-Testsuite (92 Toolbar + 21 I18N + 13 Multiplayer + 48 Unit)
- CI/CD via GitHub Actions
- Open-Source unter MIT-Lizenz
