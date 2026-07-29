# Changelog

Alle relevanten Aenderungen an malziSPACE werden hier dokumentiert.

## [1.4.3] - 2026-07-29

Nachpruefung von 1.4.2: die A11y-Pruefung deckte nur 2 von 8 Seiten ab. Auf den
uebrigen Seiten lagen 14 Verstoesse — darunter vier kaputte Links in den
Rechtstexten.

### Fixed
- **Kaputte Links in Datenschutz und AGB (DE + EN).** In
  `assets/site-i18n-dicts.js` standen typografische statt gerader
  Anfuehrungszeichen in HTML-Attributen (`<a href=”impressum.html”>`), wodurch
  der Browser den gesamten Attributwert inklusive Quotes als Ziel nahm. Betroffen
  waren der Impressum-Link im Datenschutztext, `https://malzi.space`, der Link
  zur Datenschutzerklaerung und der **rechtlich vorgeschriebene EU-ODR-Link**
  in den AGB; bei letzterem waren zusaetzlich `target` und `rel` zerschossen.
  12 Attribute in 8 Links korrigiert.
- **Links im Rechtstext waren nur farblich erkennbar** (WCAG 1.4.1, axe
  `link-in-text-block`, serious): `text-decoration` von `none` auf `underline`
  in `.legal-section a`, `.legal-page a` und `.legal-block a`.
- **Impressum, Datenschutz und AGB hatten kein `main`-Landmark** und Inhalte
  ausserhalb jedes Landmarks — gleiche Struktur wie in 1.4.2 fuer `space.html`:
  `main.legal-page` plus ein `footer.page-footer` fuer die nachlaufenden Boxen.
- **editor-simulator.html:** `aria-label` auf einem Element ohne erlaubte Rolle
  (axe `aria-prohibited-attr`, serious) und ein zweites `banner`-Landmark.

### Removed
- `prototype-append-only.html` aus dem ausgelieferten Verzeichnis entfernt. Der
  UI-Entwurf vom Mai lag untracked in `apps/web/public/` und war dadurch
  oeffentlich erreichbar, obwohl das Feature seit 1.3.0 released ist.

### Changed
- **Repo-Hygiene-Check bricht jetzt bei ungetrackten Dateien in
  `apps/web/public/`.** Alles dort wird vom Hosting-Build veroeffentlicht; eine
  ungetrackte Datei geht damit live, existiert aber nur auf einem Rechner und
  ist fuer Review, A11y-Gate und CI unsichtbar.
- **A11y-Gate prueft jetzt alle Seiten** statt nur Landing + Editor. Genau diese
  Luecke hatte die obigen Fehler unbemerkt durchgehen lassen. Alle sieben
  ausgelieferten Seiten melden nun null Verstoesse und null Advisories.

## [1.4.2] - 2026-07-29

Aufloesung des Dependabot-Rueckstaus (15 offene PRs, keiner mergebar),
Beseitigung aller verbleibenden Warnungen und Automatisierung kuenftiger
Dependency-Updates.

### Fixed
- **Dependabot-Deadlock strukturell behoben.** `services/api` und
  `services/collab-relay` waren gleichzeitig npm-Workspace-Mitglieder *und*
  hatten eigene Lockfiles. Jeder Service-Bump musste dadurch zwei Lockfiles
  zugleich aendern — das Root-Lockfile und das des Service. Dependabot kann
  keine zwei Verzeichnisse in einem PR aendern, also war **kein einziger**
  Service-PR je mergebar: Root-PRs liessen das Service-Lockfile veralten
  (`npm ci --no-workspaces` bricht), Service-PRs das Root-Lockfile
  (`npm ci` bricht). Die Services sind jetzt eigenstaendige Pakete; das
  Root-Lockfile enthaelt keine Service-Dependency mehr (358 → 121 Pakete).
- **CI war seit 26.07. bei jedem PR rot.** Ein neues HIGH-Advisory in
  `brace-expansion` (GHSA-mh99-v99m-4gvg, CVE-2026-14257) kaskadierte ueber
  `firebase-admin → google-gax → rimraf → glob → minimatch` in den
  Produktivbaum und riss das `npm audit`-Gate — unabhaengig vom Inhalt des
  jeweiligen PRs.
- **Doppelte CI-Laeufe:** `push` und `pull_request` triggerten die komplette
  Pipeline gleichzeitig fuer jeden PR-Branch. `push` laeuft jetzt nur noch
  auf `main`.

### Security
- `rimraf`-Override (^6.1.3) in beiden Services hebt die Glob-Kette aus dem
  brace-expansion-Advisory. `google-gax` deklariert `rimraf`, importiert es
  aber nirgends — der Override ist ohne Laufzeitwirkung (verifiziert).
- Audit-Gates in allen drei Baeumen wieder gruen.

### Changed
- `firebase-admin` 13.10.0 → 14.2.0 in `services/api` (die Peer-Range von
  `firebase-functions` 7.3.0 laesst `^14` erstmals zu — der lange offene
  Punkt ist damit erledigt), 14.1.0 → 14.2.0 im Relay.
- `firebase-functions` 7.2.5 → 7.3.2, `ws` 8.20.x → 8.21.1,
  `playwright` → 1.62.0, `eslint` → 10.8.0, `c8` → 12.0.0.
- `actions/checkout` v4 → v7.0.1, `actions/setup-node` v4 → v7.0.0 (beide
  SHA-gepinnt); beseitigt zugleich die Node-20-Deprecation-Warnung der Runner.
- `uuid`-Override (^11.1.0) entfernt die `uuid@9`-Deprecation-Warnung beim
  Installieren.

### Accessibility
- **Alle fuenf verbliebenen axe-Advisories beseitigt** — beide geprueften
  Seiten melden jetzt null Verstoesse auf jeder Stufe (vorher als
  dokumentierte Ausnahme toleriert):
  Topbar ist ein `banner`-Landmark statt Inhalt ausserhalb jedes Landmarks;
  der Toolbar-Streifen in `space.html` ist kein zweites `banner` mehr;
  Countdown- und Site-Footer sind nicht laenger zwei konkurrierende
  `contentinfo`-Landmarks; `space.html` hat eine (visuell verborgene) `h1`;
  der Teilnehmerzaehler `#presence` ist als `role="status"` ausgezeichnet.

### Added
- Dependabot-Gruppierung: pro Manifest ein Sammel-PR fuer Patch/Minor und ein
  separater fuer Majors, monatlich statt woechentlich.
- Auto-Merge-Workflow fuer Dependabot-PRs ohne Major-Sprung. Merged nur bei
  gruenem `verify` + `secret-scan` (Branch Protection bleibt massgeblich);
  Majors bleiben mit Kommentar offen.
- `docs/ops/DEPENDENCIES.md` — Lockfile-Topologie, Begruendung der Overrides
  und die eine verbleibende, nicht behebbare Upstream-Warnung
  (`node-domexception`: alle Versionen deprecated, da Node das nativ kann).

## [1.4.1] - 2026-07-16

Nachziehen des Repos auf den Bootstrap-/Audit-Standard (Konzept:
`docs/project/familien-standard-konzept.md`), CI-Reparatur,
Dependency-Updates, Accessibility-Haertung und KURZAUDIT-Remediation.

### Changed (rechtlich)
- **Firmenname aktualisiert** auf „malziland – learning | training |
  consulting e.U." in Impressum, Datenschutz, AGB (DE+EN-Woerterbuecher)
  und README.

### Security
- **App-Check-Bypass abgesichert (Audit SEC-02):** `MZ_DISABLE_APPCHECK=1`
  wirkt nur noch im Functions-Emulator; ausserhalb wird das Flag ignoriert
  (fail closed) und laut gemeldet.
- **Kosten-/Abuse-Deckel (Audit OPS-01):** API-Function auf `maxInstances: 10`
  begrenzt — Rate-Limits und Payload-Budgets gelten pro Instanz, unbegrenztes
  Autoscaling multiplizierte beides und die Kosten.
- Praezisierung im Security-Modell: Die **Sperre** ist serverseitig
  durchgesetzt (Relay verwirft Non-Owner-Updates in gesperrten Raeumen);
  nur die **Schutz-Granularitaet** ist designbedingt clientseitig
  (Zero-Knowledge: der Relay sieht ausschliesslich Ciphertext).

### Fixed
- **CI war seit dem 1.4.0-Push (28.05.) rot**, drei Ursachen, alle behoben:
  (a) Repo-Hygiene-Check kannte keine geprueften Ausnahmen fuer die bewusst
  self-contained gebaute `reset-cache.html` und die CSSOM-Styles von
  Zeilennummern/Version-Banner/Diag-Overlay — jetzt dokumentierte Allowlist;
  (b) eslint 10.4 fand rohe U+200B/U+00A0 in Regex-Literalen (jetzt
  `\uXXXX`-Escapes, verhaltensgleich) und vier tote rc2-Hilfsfunktionen in
  `protect-guard.js` (entfernt); (c) Lock-E2E trieb noch das seit 1.3.1
  versteckte `#lockToggle` — auf den Mode-Switch portiert.
- **Toter Link entfernt:** `javascript:history.back()` auf `reset-cache.html`
  war durch die Site-CSP zur Laufzeit blockiert (Klick ohne Wirkung).
- **Accessibility (axe, serious):** Verbindungs-Status-Punkt ohne gueltige
  ARIA-Semantik (`role="status"` ergaenzt), Info-Icon der Sperr-Checkbox
  (`role="img"`), Kontrast des Sperr-Labels auf der Startseite (AA erfuellt).
- **Tastatur-Bedienbarkeit** (Funde des skriptgesteuerten Smoketests):
  Titel-Eingabe und Info-Icon hatten `outline:none` ohne sichtbaren
  Fokus-Ersatz (jetzt `:focus-visible`-Outlines, auch fuer den Space-Titel);
  Toolbar-Formatierung war faktisch mouse-only, weil die Selection nur bei
  `mousedown` gesichert wurde — ein `focusin`-Hook deckt jetzt den
  Tastatur-Pfad (Tab + Enter formatiert korrekt).
- **NBSP-Signatur-Inkonsistenz im Schutz-Modus:** Die Stored-HTML-Varianten
  der Owner-Signatur normalisierten `&nbsp;` nicht (No-op-Replace, verlorenes
  NBSP im Quelltext), die DOM-Variante schon — Owner-Text mit `&nbsp;`
  erzeugte Dauer-Mismatches und unnoetiges Reconciling. Alle Extraktoren
  normalisieren jetzt identisch.

### Added
- **Accessibility-E2E** `npm run test:e2e:a11y` (axe-core + Tastatur-Pfade)
  als Schritt 9/11 der Verifikationspipeline; manuelle Checkliste in
  `docs/frontend/A11Y_SMOKETEST.md`.
- **Secret-Scanning in CI** (gitleaks, volle Historie, checksummen-verifiziert)
  mit dokumentierten Ausnahmen in `.gitleaks.toml`.
- **Bootstrap-Artefakte:** `AGENTS.md` (+`CLAUDE.md`), `docs/adr/ADR-0001`,
  `docs/VERIFICATION.md`, `docs/SECURITY-MODEL.md`, `docs/RUNBOOK.md` (inkl.
  durchgefuehrter Rollback-Probe auf v1.4.0), `docs/FLAGS.md`.
- **`npm run setup`** installiert Root + beide Service-Lockfiles + Playwright.

### Changed
- **CI gehaertet:** minimale Token-Rechte, alle Actions auf Commit-SHAs gepinnt.
- **Dependencies:** collab-relay auf firebase-admin **14.1** (modulare API;
  Legacy-Namespace entfernt), API bleibt wegen firebase-functions-Peer-Range
  auf admin **13.10**, nutzt aber ebenfalls die modulare API; transitive
  High/Critical-Advisories (grpc-js, form-data, protobufjs, websocket-driver)
  per `npm audit fix` behoben — alle drei Audit-Gates gruen. Tooling: eslint
  10.7, globals 17.7, playwright 1.61, yjs 13.6.31, ws 8.21.
- README: API-Tabelle um `/api/lock`, `/api/append-only`, `/api/delete`
  ergaenzt (fehlten), Quickstart auf `npm run setup`, Pipeline-Doku 9→11
  Schritte korrigiert.

## [1.4.0] - 2026-05-28

Finales Release der Schutz-Haertung (aus 1.3.7 + rc1–rc3 zusammengefasst):
Safari/WebKit-Schutz dicht, korrektes Caching, korrekte Schreib-Regeln und
ausgerichtete Zeilennummern.

### Fixed
- **Safari/WebKit setzte den Schutz nicht durch.** Ein Teilnehmer konnte
  gesperrten Text veraendern; der kaputte Stand wurde via CRDT verteilt und
  vergiftete alle Clients (auch Brave). Ursache: WebKit fuehrt Editier-
  Operationen am Owner-Span trotz `preventDefault` aus. Geloest durch einen
  **harten CRDT-Invariant** (`syncYTextFromEditorHtml` verwirft jeden
  Teilnehmer-Push, der Owner-Text aendert), **Reconcile gegen Y.Text** statt
  DOM-Snapshot und einen **MutationObserver**, der native Mutationen abfaengt.
- **Cache-Korrektheit des Builds.** `tools/bin/build_hosting.mjs` hashte
  Dateien vor dem Import-Rewrite → gleicher Dateiname bei geaenderten Importen
  → wiederkehrende Besucher bekamen bei `immutable`-Cache alten Code. Jetzt
  wird ueber die transitive Abhaengigkeits-Huelle gehasht (zyklus-sicher).
- **Zeilennummern-Ausrichtung driftete.** Fixe `1.6em`-Hoehe pro Nummer wich
  von der real gerenderten Editor-Zeilenhoehe ab (browser-/zoom-/font-bedingt)
  und summierte sich auf. Nummern werden jetzt an die **gemessene** Zeilenhoehe
  gekoppelt (`editor/line-numbers.js`). 0px Drift ueber 30 Zeilen in Chromium
  und WebKit.

### Changed
- **Kein Anhaengen an geschuetzten Text.** Direkt an markiertem (gelbem) Text
  ist weder Tippen noch Enter noch Einfuegen moeglich — auch nicht am
  Zeilenende. Teilnehmer schreiben ausschliesslich in echten **freien Zeilen**
  (leere Zeile zwischen Bloecken oder darunter).
- **Automatische freie Schreibzeile** unter dem letzten geschuetzten Block,
  damit Teilnehmer immer Schreibplatz haben.

### Added
- Cross-Engine-Real-Input-Fuzz-E2E `npm run test:e2e:protect:fuzz` (Chromium +
  WebKit): echte Tastatur, echtes Strg/Cmd+V, Select-All, Mid-Text-Delete,
  140 Zufallsaktionen. Owner-Text bleibt unter allen Angriffen intakt.

### Known limitations
- Durchsetzung bleibt clientseitig (CRDT-Invariant + Reconcile + Guard); eine
  serverseitige Relay-Pruefung gegen *manipulierte* Clients steht weiter aus.

## [1.3.7] - 2026-05-28

Haertung des Schutz-Modus. Ausloeser: ein Schueler konnte gelb
markierten Trainer-Text mittendrin loeschen (markieren + tippen). Der
Review fand mehrere Wege, auf denen Teilnehmer-Eingaben am rein
praeventiven `beforeinput`-Guard vorbei den geschuetzten Inhalt
veraendern konnten.

### Fixed
- **Einfuegen (Paste) war fuer Teilnehmer ungeschuetzt.** `handlePaste`
  fuehrt sein eigenes `deleteContents()` + Insert aus und umging damit
  den `beforeinput`-Guard komplett. Teilnehmer-Paste, das Owner-Inhalt
  beruehrt/verdraengt, wird jetzt blockiert
  (`editor/clipboard.js` + neue Hilfsfunktion `participantInsertBlocked`).
- **Composition-Eingaben (`insertCompositionText`) wurden nicht erfasst.**
  Auf Tablets/Chromebooks/iOS sowie bei Autokorrektur und macOS-
  Akzentmenue laeuft Tippen ueber Composition-Events — diese fielen
  durch alle Pruefungen. Jetzt im Insert-Zweig des Guards behandelt.
- **Rechtschreib-/Autokorrektur (`insertReplacementText`)** wurde gegen
  die Auswahl statt gegen `getTargetRanges()` geprueft und konnte so
  Owner-Text ersetzen. Insert-Zweig prueft jetzt die Target-Ranges.
- **Undo/Redo umging den Schutz.** Strg+Z/Y eines Teilnehmers konnte den
  Owner-Inhalt auf einen frueheren Stand zuruecksetzen. `history.js`
  blockt jetzt History-Schritte, die die Owner-Text-Signatur aendern.
- **`rangeTouchesOwner` ist jetzt fail-closed**, wenn `intersectsNode`
  fehlt.

### Added
- **Reconciliation-Schutznetz** (`editor/protect-guard.js`): Da
  `beforeinput` nicht auf allen Engines abbrechbar ist (insbesondere
  mobile Tastaturen), wird der Owner-markierte Text bei jedem
  Teilnehmer-`input` mit einer bekannten guten Baseline verglichen und
  bei einer Abweichung der letzte gute Stand wiederhergestellt — das
  greift auch fuer jeden bisher nicht abgefangenen Eingabeweg. Die
  Baseline wird ueber `ctx.recomputeOwnerBaseline` bei Schutz-Aktivierung,
  Remote-Updates und initialem Laden aktualisiert
  (`ui/protect.js`, `network/collaboration.js`).
- Protect-E2E (`tests/e2e/run_space_protect_e2e.mjs`) auf den
  3-Stufen-Mode-Switch aktualisiert (der alte `#lockToggle`/
  `#protectToggle`-Owner-Flow aus v1.3.0 war seit v1.3.1 obsolet) und um
  Assertions fuer Paste-Block und Reconciliation-Revert erweitert
  (17 gruene Checks, stabil ueber mehrere Laeufe).

### Fixed (WebKit/Safari — zweite Runde)
- **Safari/WebKit setzte den Schutz nicht durch.** Ein Teilnehmer konnte
  gesperrten Text veraendern; schlimmer noch, der kaputte Stand wurde ueber
  das CRDT verteilt und vergiftete die Baseline aller Clients (auch Brave).
  Ursache: WebKit fuehrt Editier-Operationen (z.B. `insertParagraph` am
  Owner-Span) trotz `preventDefault` aus und klont dabei den Owner-Span.
- **Harter CRDT-Invariant** in `network/collaboration.js`
  (`syncYTextFromEditorHtml`): ein Teilnehmer-Push, der den Owner-Text
  gegenueber Y.Text veraendern wuerde, wird komplett verworfen. Y.Text
  bleibt die unkorrumpierte Wahrheit, ein einzelner versagender Client kann
  das Dokument nicht mehr vergiften.
- **Reconciliation gegen Y.Text statt DOM-Snapshot** + **MutationObserver**
  in `editor/protect-guard.js`: jede DOM-Aenderung (auch native, am
  beforeinput vorbei) wird gegen Y.Text geprueft und der Editor bei
  Abweichung daraus neu aufgebaut. Engine-unabhaengige Garantie.

### Added (Tests)
- Echter Cross-Engine-Fuzz-E2E `tests/e2e/run_space_protect_fuzz_e2e.mjs`
  (`npm run test:e2e:protect:fuzz`): reale Tastatur, echtes Strg/Cmd+V,
  Select-All, Backspace/Delete mitten im Text und 140 Zufallsaktionen — in
  **Chromium UND WebKit (Safari-Engine)**. Mit Positiv-Kontrollen, damit
  kein Check leer durchlaeuft. Owner-Text bleibt in beiden Engines intakt.

### Known limitations
- Durchsetzung bleibt clientseitig (CRDT-Invariant + Reconciliation +
  Guard). Eine serverseitige Relay-Pruefung gegen *manipulierte* Clients
  steht weiterhin aus (analog zum Lock-Defence-in-Depth).
- WebKit/Safari: Tippen *exakt* an der Owner-Grenze haengt nicht an (WebKit
  fuegt ins geschuetzte Span ein → korrekt verworfen). Teilnehmer haengen
  per Paste oder in einer eigenen Zeile an. Folgefix offen.

## [1.3.1] - 2026-05-27

Iterative UX- und Bugfix-Runde am Append-Only-Schutz aus v1.3.0.
Sechs Hotfix-Deploys an einem Tag (Live-Tags v1.3.1 bis v1.3.6) sind
hier zu einem Eintrag zusammengefasst; sie bilden gemeinsam den jetzt
stabilen Zustand des Schutzmodus inklusive klarer Regeln fuer Trainer-
und Teilnehmer-Schreibrechte.

### Added
- 3-Stufen-Mode-Switch `Frei | Schutz | Sperre` ersetzt die einzelnen
  Schild- und Schloss-Buttons. Klar erkennbarer Aktiv-Zustand
  (gruen / orange / rot), gegenseitig ausschliessend, ein Klick.
  `apps/web/public/assets/modules/ui/mode.js` orchestriert die
  Endpoints `/api/lock` + `/api/append-only` und beide Relay-Frames.
- Lock-Banner fuer Teilnehmer (rote Variante des Schutz-Banners) plus
  passiver Schild-Indikator in der Toolbar — beide Modi sind jetzt
  in der Toolbar UND ueber ein Banner sichtbar, unabhaengig von der
  Scroll-Position.
- One-shot Auto-Markierung beim Oeffnen bestehender Spaces mit
  aktivem Schutz aber ohne `.mz-owner-text` Markierung (Legacy-Rescue).
- Live-Diagnose-Panel ueber `?diag=1` Query-Param. Zeigt
  `ctx.isOwner`, `ctx.appendOnly`, `ctx.readOnly`, editable-Status,
  Anzahl Owner-Spans und das Ergebnis des letzten beforeinput-Events.
  Ohne Query-Param inert.
- Build-Pre-Check: `tools/bin/build_hosting.mjs` ruft `node --check`
  ueber alle JS-Quellen auf, bevor der Build den Asset-Tree faengt.
  Verhindert defektes JavaScript live zu gehen.
- Toolbar-Layout fuer schmale Viewports: Mode-Switch in eigener voller
  Breite-Zeile, Owner-Link + Lese-Link mit Label statt nur Icons.
- I18N: neue String-Bloecke `space.mode.*`, `space.lock.banner.*`,
  `space.protect.readOnly`.

### Verhalten im Schutz-Modus (jetzt stabil)

**Trainer (Owner) im Schutz an:**
- Tippen wird sofort in `.mz-owner-text` Span eingewickelt
  (`wrapOwnerInsert`). Auch Strg+V Paste wird umhuellt
  (`wrapPasteAsOwner` in `editor/clipboard.js`).
- Beim ersten Aktivieren von Schutz wird vorhandener Text retroaktiv
  markiert. Bei spaeteren Frei → Schutz Wechseln passiert das nur
  noch dann, wenn aktuell **keine** Owner-Span existiert — die
  Grenze zwischen Trainer- und Teilnehmer-Inhalt bleibt damit
  stabil.

**Teilnehmer im Schutz an:**
- Direkt im Trainer-Text tippen: blockiert mit Toast „Trainer-Inhalt
  kann nicht veraendert werden".
- Am Ende eines Trainer-Blocks tippen wenn darunter noch ein
  Trainer-Block kommt (mit oder ohne Plain-Text dazwischen):
  blockiert. Eingefuegter Text wuerde sonst zwischen zwei
  Trainer-Regionen festkleben.
- In einer vom Trainer gelassenen **Leerzeile** zwischen zwei
  Trainer-Bloecken: tippen + Enter erlaubt — der Trainer hat den
  Raum bewusst angelegt.
- Am Ende des letzten Trainer-Blocks: Enter erzeugt eine saubere
  neue Zeile darunter (`insertCleanParagraphAfterCaret`),
  Direkt-Tippen schreibt in einen Geschwister-Textknoten ausserhalb
  jeder Owner-Span (`insertTextAtOwnerBoundary`).
- Backspace/Delete auf einer leeren, gerade angelegten
  Teilnehmer-Zeile entfernt nur die leere Zeile, ohne den
  benachbarten Trainer-Block anzufassen
  (`deleteEmptyParticipantBlock`).

### Fixed (kumuliert)

Die folgenden Bugs aus dem 1.3.1 Mode-Switch-Refactor wurden in 13
Schritten gefixt — der jetzige Stand ist konsistent:

- **Mode-Switch & State.** `mode.js` rief `markAllExistingAsOwner` bei
  jedem Schutz-Klick auf und wickelte dabei spaeter dazugekommenen
  Teilnehmer-Text ein. Faellt jetzt nur noch beim allerersten
  Aktivieren. Optimistischer State-Update vergleicht gegen einen
  vor-dem-Apply festgehaltenen Snapshot, sodass die API-Calls nicht
  geschluckt werden.
- **Browser-Inline-Cloning bei Enter.** Wenn der Caret in einer
  Owner-Span war und der Teilnehmer Enter drueckte, klonte der
  Browser die Span in den neuen Block — Caret im leeren Owner-Span
  → alle weiteren Eingaben geblockt. `protect-guard` erzeugt den
  neuen Block jetzt selbst und positioniert den Caret ausserhalb
  jeder Owner-Markierung.
- **Caret-Positionierungs-Edge-Cases.** Der Enter-Intercept feuert
  jetzt sobald der umgebende Block Owner-Inhalt enthaelt, egal
  wo der Caret innerhalb des Blocks sitzt — frueher fiel das durch,
  wenn der Caret laut DOM knapp neben der Span stand statt drin.
  `rangeTouchesOwner` benutzt fuer kollabierte Carets nur noch
  `startEl.closest(.mz-owner-text)`, da `range.intersectsNode` an
  Boundary-Points uneindeutig ist und manche Browser fuer benachbarte
  Positionen `true` lieferten.
- **Owner-Paste blieb ungeschuetzt.** Per Strg+V eingefuegter Text
  wurde bis zum naechsten Frei → Schutz Toggle frei editierbar.
  Wird jetzt direkt beim Paste umhuellt.
- **Wedged Plain-Text.** Wenn der Teilnehmer vor einem Fix Muell-Text
  neben einen Trainer-Header geschrieben hatte (Plain-Text-Sibling
  der Owner-Span im selben Block), konnte er den eigenen Text
  weiterhin erweitern. Neue Bedingung: enthaelt der umgebende Block
  Owner-Inhalt **und** folgt spaeter noch ein Trainer-Block, wird
  Tippen blockiert.
- **Boundary-Redirect zu permissiv.** Tippen am Ende einer Owner-Span
  wurde auch dann in den Block der Span hinein-redirected, wenn
  unmittelbar darunter ein weiterer Trainer-Block stand. Prueft jetzt
  zusaetzlich `laterBlockHasOwner(range)`.
- **Leerzeile-Schutz inkonsistent.** Der frueher genutzte
  `nextContentIsOwner` Check fuer Text-Insertion unterband Tippen in
  vom Trainer gelassenen Leerzeilen — je nach `<br>` Platzhalter
  inkonsistent. Entfernt; nur noch
  `ownerInSameBlockAfterCursor` greift fuer Text-Insertion. Enter
  im Leerblock zwischen zwei Trainern wird ueber
  `enterInEmptyBlock`-Bedingung explizit erlaubt.

### Defensive
- CSS-Regel `body.has-append-only:not(.has-owner-ui) #protectToggle`
  erzwingt die Sichtbarkeit des Teilnehmer-Schild-Indikators per
  Specificity als Backup falls JavaScript das `hidden`-Attribut
  nicht aktualisiert haben sollte.

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
