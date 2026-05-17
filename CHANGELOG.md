# Changelog

Alle relevanten Aenderungen an malziSPACE werden hier dokumentiert.

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
