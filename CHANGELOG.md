# Changelog

Alle relevanten Aenderungen an malziSPACE werden hier dokumentiert.

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
