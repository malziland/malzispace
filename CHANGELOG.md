# Changelog

Alle relevanten Aenderungen an malziSPACE werden hier dokumentiert.

## [Unreleased]

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
