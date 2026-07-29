# malzispace Public API — Gesamtkonzept v1

**Stand:** 2026-03-17
**Status:** Entwurf — Entscheidungsgrundlage

> **Hinweis:** Dieses Dokument ist rein konzeptionell und darf nicht nach GitHub.
> malzi.link wird hier nur als Beispiel-Integrator erwähnt — die API ist allgemeingültig.

## Vision

malzispace wird um eine **öffentliche API** erweitert. Jeder Entwickler kann verschlüsselte, temporäre Editoren in eigene Dienste einbauen. Nutzer können Texte teilen — wahlweise zum gemeinsamen Bearbeiten oder nur zum Lesen.

---

## Kernentscheidungen

| Thema | Entscheidung |
|-------|-------------|
| Zielgruppe | Öffentliche API — jeder Entwickler |
| Lebensdauer | Konfigurierbar: 1 Min. bis 7 Tage (Web-UI bleibt 24h) |
| Branding | Logo immer versteckt wenn eingebettet |
| Lese-/Schreibrechte | Zwei Link-Typen: Bearbeiten-Link und Nur-Lesen-Link |
| Read-Only | Nur über API — Web-UI bleibt unverändert |
| Datenschutz | Maximaler Datenschutz: E2E-Verschlüsselung, Zero-Knowledge |
| REST API (Klartext) | Gestrichen — bricht E2E |
| REST API (pre-encrypted) | Ersetzt durch JS-SDK mit automatischer Crypto |
| Weitere Dienste | Öffentlich — jeder Integrator willkommen |

---

## Datenschutz-Architektur

### Grundprinzip: Der Schlüssel verlässt nie einen Browser

malzispace ist Zero-Knowledge — der Server sieht nie Klartext. Jede API-Variante muss dieses Versprechen einhalten.

### Bewertung aller Varianten

| | Wer hat den Schlüssel? | Zero-Knowledge (malzispace) | Zero-Knowledge (Integrator) | Bewertung |
|--|----------------------|:--:|:--:|--|
| **A: Embed** | Nur Browser des Nutzers | Ja | Ja | Perfekt |
| **B: JS-SDK (Browser)** | Nur Browser des Nutzers | Ja | Ja | Perfekt |
| **B: JS-SDK (Node.js)** | Server-RAM des Integrators | Ja | Nein | Sehr gut |
| **D: Webhooks** | Niemand (nur Metadaten) | Ja | Ja | Gut |
| ~~C1: REST (Klartext)~~ | ~~malzispace-Server~~ | ~~Nein~~ | ~~Nein~~ | ~~Gestrichen~~ |
| ~~C2: REST (pre-encrypted)~~ | ~~Integrator-Server~~ | ~~Ja~~ | ~~Nein~~ | ~~Ersetzt durch SDK~~ |

### Warum keine separate REST API?

- **C1 (Klartext):** Bricht E2E komplett. Inkompatibel mit Zero-Knowledge.
- **C2 (pre-encrypted):** Entwickler müssten AES-256-GCM selbst implementieren — fehleranfällig. Das JS-SDK macht dasselbe, aber sicher und automatisch.
- **Das JS-SDK läuft auch in Node.js** (Web Crypto API seit Node 15+) — deckt Server-to-Server ab, ohne neue Angriffsfläche.

---

## Read-Only: Wie funktioniert das?

**Problem:** Die Verschlüsselung basiert auf einem Key im URL-Fragment. Wer den Key hat, kann entschlüsseln. Bisher kann auch jeder mit dem Key schreiben.

**Lösung: Zwei getrennte Geheimnisse**

| | Lese-Link | Bearbeiten-Link |
|--|-----------|-----------------|
| **URL** | `malzi.space/space/abc#KEY` | `malzi.space/space/abc#KEY.WRITE` |
| **Kann lesen** | Ja | Ja |
| **Kann schreiben** | Nein — Server lehnt ab | Ja |
| **Verschlüsselung** | Intakt — Key entschlüsselt | Intakt |
| **Echtzeit-Collab** | Sieht Änderungen live | Kann mitarbeiten |

**So funktioniert es technisch:**
- Beim Erstellen generiert der Client zwei Geheimnisse: `ENCRYPTION_KEY` + `WRITE_TOKEN`
- Server speichert `write_proof = SHA-256(WRITE_TOKEN)` — kann den Token selbst nicht rekonstruieren
- Lese-Anfragen brauchen nur `key_proof = SHA-256(ENCRYPTION_KEY)`
- Schreib-Anfragen brauchen zusätzlich `write_proof`
- **Der Server sieht nie den Klartext** — er prüft nur, ob der richtige Beweis vorliegt

**Für den Ersteller:** Bekommt automatisch den Bearbeiten-Link. Kann den Lese-Link an andere weitergeben.

**Verfügbarkeit:** Nur über API (Embed, SDK). Die Web-UI auf malzi.space bleibt unverändert.

---

## Die 3 Integrations-Varianten

### Variante A: Einbettung (Embed-API)

**Was ist das?**
Wie ein YouTube-Video einbetten — eine Zeile HTML, und der Editor erscheint auf der eigenen Seite.

```html
<iframe src="https://malzi.space/embed/abc123#KEY"></iframe>
```

**Funktionen:**

| Funktion | Verfügbar |
|----------|-----------|
| Editor in eigener Seite anzeigen | Ja |
| Space erstellen | Ja (per postMessage) |
| Echtzeit-Zusammenarbeit | Ja |
| Nur-Lesen-Modus | Ja (`#KEY` statt `#KEY.WRITE`) |
| Eigene Lebensdauer (bis 7 Tage) | Ja (per Parameter) |
| Kein Logo (immer versteckt) | Ja (automatisch) |
| Inhalte programmatisch setzen/lesen | Nein (isoliert — by design) |
| Ohne Browser nutzbar | Nein |
| API-Key nötig | Nein |

**postMessage-Protokoll:**

| Event (Host → Embed) | Beschreibung |
|-----------------------|-------------|
| `mz:create` | Space erstellen mit Optionen (TTL, readOnly) |
| `mz:destroy` | Space löschen |

| Event (Embed → Host) | Beschreibung |
|-----------------------|-------------|
| `mz:ready` | Editor ist geladen und bereit |
| `mz:resize` | Editor-Höhe hat sich geändert (für auto-resize) |
| `mz:error` | Fehler aufgetreten (Code + Beschreibung) |
| `mz:expired` | Space ist abgelaufen |
| `mz:peer_count` | Anzahl aktiver Teilnehmer hat sich geändert |

**Vorteile:**
- Schnellste Umsetzung
- Verschlüsselung bleibt 100% intakt
- Kein API-Key nötig — funktioniert sofort
- Vollwertiger Editor mit allen Funktionen

**Nachteile:**
- Aussehen nur begrenzt anpassbar (iframe-Rahmen)
- Host-Seite kann Inhalte nicht lesen oder vorausfüllen
- Funktioniert nur in Webseiten

**Datenschutz:** Perfekt — Schlüssel verlässt nie den Browser.

**Ideal für:** Schnelle Einbettung in Webseiten, CMS-Plugins, Lernplattformen

---

### Variante B: Baukasten (JavaScript SDK)

**Was ist das?**
Ein Werkzeugkasten (npm-Paket) für Entwickler. Steuert Spaces programmatisch — eigenes Design, eigene Logik. Läuft im Browser und in Node.js.

```js
// Browser — Zero-Knowledge für alle
const space = await MalziSpace.create({ ttl: "7d" })
space.readOnlyUrl  // → Nur-Lesen-Link
space.editorUrl    // → Bearbeiten-Link

// Node.js — Zero-Knowledge für malzispace
const space = await MalziSpace.create({ ttl: "7d" })
await space.setContent("Workshop-Notizen...")
// Key existiert nur im RAM dieses Servers
```

**Funktionen:**

| Funktion | Browser | Node.js |
|----------|:-------:|:-------:|
| Space erstellen/löschen | Ja | Ja |
| Inhalte lesen und schreiben | Ja | Ja |
| Echtzeit-Zusammenarbeit | Ja | Nein |
| Nur-Lesen-Modus | Ja | Ja |
| Eigene Lebensdauer (bis 7 Tage) | Ja | Ja |
| Logo versteckt | Ja | — |
| API-Key nötig | Optional | Ja |

**SDK-Methoden (vollständig):**

```ts
// Lifecycle
MalziSpace.create(options: CreateOptions): Promise<Space>
MalziSpace.open(spaceId: string, key: string): Promise<Space>
space.destroy(): Promise<void>

// Inhalte
space.setContent(html: string): Promise<void>
space.getContent(): Promise<string>

// Links
space.readOnlyUrl: string
space.editorUrl: string
space.spaceId: string

// Metadaten
space.expiresAt: Date
space.peerCount: number
space.isReadOnly: boolean
space.ttl: number
```

**SDK-Events:**

| Event | Daten | Beschreibung |
|-------|-------|-------------|
| `content_changed` | `{ html: string }` | Inhalt wurde geändert (lokal oder remote) |
| `peer_joined` | `{ count: number }` | Teilnehmer beigetreten |
| `peer_left` | `{ count: number }` | Teilnehmer hat verlassen |
| `expired` | `{ spaceId: string }` | Space ist abgelaufen |
| `error` | `{ code: string, message: string }` | Fehler aufgetreten |
| `disconnected` | `{}` | Verbindung unterbrochen |
| `reconnecting` | `{ attempt: number, maxAttempts: number }` | Wiederverbindung läuft |
| `reconnected` | `{}` | Verbindung wiederhergestellt, Offline-Änderungen synchronisiert |

```js
space.on('content_changed', (data) => { ... })
space.on('peer_joined', (data) => { ... })
space.on('expired', () => { ... })
```

**CreateOptions:**

```ts
interface CreateOptions {
  ttl?: string          // "1m" bis "7d", Standard: "24h"
  readOnly?: boolean    // Standard: false
  content?: string      // HTML-Inhalt zum Vorausfüllen
  apiKey?: string       // Pflicht in Node.js, optional im Browser (oder global via init())
  metadata?: Record<string, string>  // Custom Metadata (max. 20 Keys, je max. 512 Zeichen)
  idempotencyKey?: string             // Idempotenz-Key (auto-generiert wenn nicht gesetzt)
  reconnect?: {                       // Reconnection-Konfiguration
    enabled?: boolean                 // Standard: true
    maxAttempts?: number              // Standard: 10
    maxDelay?: number                 // Max. Wartezeit in ms (Standard: 30000)
  }
}
```

**Vorteile:**
- Volle Kontrolle über Aussehen und Verhalten
- Verschlüsselung wird automatisch vom SDK übernommen
- Wiederverwendbar in verschiedenen Projekten
- Ersetzt REST API — auch für Server-to-Server (Node.js)

**Nachteile:**
- JavaScript nötig (Browser oder Node.js)
- Entwickler muss eigenes UI bauen
- SDK muss gepflegt und aktualisiert werden

**Datenschutz (Browser):** Perfekt — Schlüssel verlässt nie den Browser.
**Datenschutz (Node.js):** Sehr gut — malzispace bleibt Zero-Knowledge. Schlüssel liegt im RAM des Integrator-Servers.

**Ideal für:** Tiefe Integration, Server-Automationen, eigene UIs

---

### Variante D: Benachrichtigungen (Webhooks)

**Was ist das?**
malzispace schickt automatisch Nachrichten an andere Dienste, wenn etwas passiert.

```json
{
  "event": "space.expired",
  "spaceId": "abc123",
  "expiredAt": "2026-03-24T10:00:00Z",
  "signature": "hmac-sha256:..."
}
```

**Events (Opt-in pro Typ):**

| Event | Daten | Datenschutz-Risiko |
|-------|-------|-------------------|
| `space.created` | spaceId, expiresAt | Gering |
| `space.expired` | spaceId | Gering |
| `space.deleted` | spaceId | Gering |
| `peer.count_changed` | spaceId, count | Mittel (Nutzungsmuster) |

**Webhook-Konfiguration (per API-Key):**

```js
await MalziSpace.webhooks.register({
  url: "https://example.com/hooks/malzispace",
  events: ["space.expired", "peer.count_changed"],
  secret: "webhook-signing-secret"
})
```

**Zustellung und Retry:**

| Aspekt | Verhalten |
|--------|-----------|
| Timeout | 10 Sekunden |
| Retry | 3 Versuche (nach 1min, 5min, 30min) |
| Signatur | HMAC-SHA256 im `X-MZ-Signature` Header |
| Verifizierung | Integrator prüft Signatur mit eigenem Secret |

**Datenschutz-Maßnahmen:**
- Payload enthält **nie** Inhalte, Keys oder IPs
- SpaceID optional als Hash (nicht im Klartext)
- HMAC-Signatur auf jedem Webhook (Echtheitsprüfung)
- Opt-in pro Event-Typ

**Vorteile:**
- Lose Kopplung, asynchron
- Verschlüsselung bleibt intakt (nur Metadaten)
- Ermöglicht Automatisierung (z.B. Aufräumen abgelaufener Ressourcen)

**Nachteile:**
- Keine Inhalte — nur Statusmeldungen
- Zustellung muss zuverlässig sein (Retry-Logik)
- Nur sinnvoll in Kombination mit A oder B

**Datenschutz:** Gut — nur Metadaten, nie Inhalte. Nutzungsmuster bei `peer.count_changed` erkennbar.

**Ideal für:** Automatisierung, Status-Synchronisation, Aufräum-Jobs

---

## Gesamtvergleich

| | A: Embed | B: SDK (Browser) | B: SDK (Node.js) | D: Webhooks |
|--|:--:|:--:|:--:|:--:|
| **Datenschutz** | Perfekt | Perfekt | Sehr gut | Gut |
| **Zero-Knowledge (malzispace)** | Ja | Ja | Ja | Ja |
| **Zero-Knowledge (Integrator)** | Ja | Ja | Nein | Ja |
| **Key verlässt Browser** | Nie | Nie | Liegt in Server-RAM | — |
| | | | | |
| **Editor anzeigen** | Ja | Selbst bauen | — | Nein |
| **Space erstellen** | Ja | Ja | Ja | Nein |
| **Inhalte lesen/schreiben** | Nein | Ja | Ja | Nein |
| **Echtzeit-Collab** | Ja | Ja | Nein | Nein |
| **Nur-Lesen-Modus** | Ja | Ja | Ja | — |
| **TTL bis 7 Tage** | Ja | Ja | Ja | — |
| **Logo versteckt** | Ja | Ja | — | — |
| **Ohne Browser** | Nein | Nein | Ja | Ja |
| | | | | |
| **API-Key nötig** | Nein | Optional | Ja | Ja |
| **Aufwand** | Gering | Mittel | Mittel | Mittel |
| **Alleine nutzbar** | Ja | Ja | Ja | Nein |

---

## API-Key-Management

### Registrierung

| Aspekt | Lösung |
|--------|--------|
| **Wo registrieren?** | `malzi.space/api/keys/` — selbst verwalten, kein manueller Antrag |
| **Authentifizierung** | Anonym: kein Account nötig. Key wird generiert + einmalig angezeigt. |
| **Speicherung** | Server speichert nur `SHA-256(API-Key)` — Zero-Knowledge auch hier |
| **Rotation** | Alter Key bleibt 24h gültig nach Rotation |
| **Löschung** | Sofort wirksam, alle Webhooks werden deaktiviert |

### Wann ist ein API-Key nötig?

| Variante | Ohne Key | Mit Key |
|----------|----------|---------|
| **Embed** | Ja — funktioniert immer | Nicht nötig |
| **SDK (Browser)** | Ja — mit Einschränkungen | Höhere Rate-Limits |
| **SDK (Node.js)** | Nein | Pflicht |
| **Webhooks** | Nein | Pflicht |

---

## Rate-Limits

| Aktion | Ohne API-Key | Mit API-Key |
|--------|:------------:|:-----------:|
| Space erstellen | 10/Stunde | 100/Stunde |
| Space lesen | 60/Minute | 600/Minute |
| Space schreiben | 30/Minute | 300/Minute |
| Webhook registrieren | — | 10 URLs |
| Embed laden | Unbegrenzt | Unbegrenzt |

**Bei Überschreitung:** HTTP 429 mit `Retry-After` Header und erklärender Fehlermeldung.

---

## Fehlerbehandlung

### Error-Codes

| Code | HTTP | Bedeutung | Lösung |
|------|------|-----------|--------|
| `SPACE_NOT_FOUND` | 404 | Space existiert nicht oder ist abgelaufen | Neuen Space erstellen |
| `SPACE_EXPIRED` | 410 | Space war vorhanden, ist aber abgelaufen | Neuen Space erstellen |
| `WRITE_PROOF_MISSING` | 403 | Schreibversuch ohne write_proof | Bearbeiten-Link verwenden |
| `WRITE_PROOF_INVALID` | 403 | write_proof stimmt nicht | write_proof prüfen |
| `KEY_PROOF_INVALID` | 403 | key_proof stimmt nicht | ENCRYPTION_KEY prüfen |
| `TTL_OUT_OF_RANGE` | 400 | TTL < 1min oder > 7 Tage | Gültigen TTL-Wert senden |
| `RATE_LIMITED` | 429 | Zu viele Anfragen | `Retry-After` Header beachten |
| `API_KEY_INVALID` | 401 | API-Key ungültig oder gelöscht | Neuen Key generieren |
| `API_KEY_REQUIRED` | 401 | Endpoint braucht API-Key | API-Key registrieren |
| `WEBHOOK_URL_INVALID` | 400 | Webhook-URL nicht erreichbar | URL prüfen, HTTPS nötig |
| `WEBHOOK_SIGNATURE_FAILED` | — | Signaturprüfung fehlgeschlagen (clientseitig) | Secret prüfen |
| `CONTENT_TOO_LARGE` | 413 | Inhalt überschreitet Maximum (1 MB) | Inhalt kürzen |
| `INVALID_CONTENT_TYPE` | 400 | Ungültiger Content-Type Header | `application/json` verwenden |

### Error-Response-Format

```json
{
  "error": {
    "code": "WRITE_PROOF_MISSING",
    "message": "Schreibzugriff benötigt einen gültigen write_proof.",
    "hint": "Der write_proof wird aus SHA-256(WRITE_TOKEN) berechnet. Verwende den Bearbeiten-Link statt des Lese-Links.",
    "docs": "https://malzi.space/api/docs/errors#WRITE_PROOF_MISSING"
  }
}
```

Jede Fehlermeldung enthält:
- `code` — maschinenlesbar
- `message` — menschenlesbar
- `hint` — konkreter Lösungsvorschlag
- `docs` — Direktlink zur Dokumentation

---

## CORS & Security Headers

| Header | Wert | Zweck |
|--------|------|-------|
| `Access-Control-Allow-Origin` | `*` | Embed/SDK funktioniert von jeder Domain |
| `X-Content-Type-Options` | `nosniff` | Verhindert MIME-Type-Sniffing |
| `X-Frame-Options` | `ALLOWALL` (nur `/embed/`) | Embed erlaubt iframes von überall |
| `Content-Security-Policy` | Strikt für `/api/`, locker für `/embed/` | Schutz gegen XSS |
| `Strict-Transport-Security` | `max-age=31536000` | HTTPS erzwungen |

**Embed-spezifisch:**
- `/embed/*` Pfade erlauben iframe-Einbettung von jeder Domain
- Alle anderen Pfade blockieren iframe-Einbettung (`X-Frame-Options: DENY`)

---

## API-Versionierung

| Aspekt | Lösung |
|--------|--------|
| **Schema** | URL-Prefix: `/api/v1/`, `/api/v2/` |
| **SDK** | Major-Version = API-Version (`@malzispace/sdk@1.x` → API v1) |
| **Embed** | Versioniert: `/embed/v1/ID#KEY` |
| **Abwärtskompatibilität** | Alte Version bleibt 12 Monate aktiv nach Deprecation |
| **Breaking Changes** | Nur in neuer Major-Version, nie in Minor/Patch |
| **Deprecation-Warnung** | `X-MZ-Deprecated: true` Header + SDK-Konsolenwarnung |

**Changelog:** Öffentlich unter `malzi.space/api/docs/changelog` — jede Änderung mit Datum und Versionsnummer.

---

## Developer Experience

Eine öffentliche API steht und fällt mit der Erfahrung, die Entwickler beim Integrieren machen. Drei Säulen sind dafür nötig: ein API-Simulator, umfassende Tests und eine perfekte Dokumentation.

### API-Simulator (Developer Playground)

**Was ist das?**
Eine interaktive Webseite auf `malzi.space/api/playground/`, auf der Entwickler die API live ausprobieren können — ohne eigenen Code zu schreiben, ohne API-Key, ohne Registrierung. Gleiche Firebase-Hosting-Instanz, kein Subdomain-Setup nötig.

**Aufbau:**

| Bereich | Funktion |
|---------|----------|
| **Embed-Playground** | Live-Vorschau eines eingebetteten Editors. Regler für Parameter (TTL, Read-Only). Generiert Copy-Paste-fertigen HTML/JS-Code. |
| **SDK-Konsole** | Interaktive JavaScript-Konsole im Browser. Vorgefertigte Snippets zum Klicken: "Space erstellen", "Inhalt setzen", "Read-Only-Link generieren". Ergebnis sofort sichtbar. |
| **Webhook-Tester** | Simuliert Webhook-Events. Entwickler gibt eigene URL ein → malzispace sendet Test-Events. Zeigt Request/Response live an. |
| **Inspect-Modus** | Zeigt für jede Aktion, was tatsächlich an den Server gesendet wird (verschlüsselt) und was der Server zurückgibt. Beweist Zero-Knowledge live. |

**Prinzipien:**
- Kein Login nötig — sofort nutzbar
- Echte API-Calls — kein Mock, sondern reale Spaces (kurze TTL: 10 Min.)
- Code-Generierung: Jede Aktion im Simulator erzeugt kopierbaren Code (HTML, JS, Node.js)
- Fehler werden erklärt, nicht nur angezeigt ("403 — write_proof fehlt. So generierst du ihn: ...")
- Responsive — auch auf Mobilgeräten nutzbar

**URL-Struktur:**

| Seite | Pfad |
|-------|------|
| Playground (Simulator) | `malzi.space/api/playground/` |
| Dokumentation | `malzi.space/api/docs/` |
| SDK-Konsole | `malzi.space/api/playground/sdk/` |
| Webhook-Tester | `malzi.space/api/playground/webhooks/` |
| API-Key-Verwaltung | `malzi.space/api/keys/` |

Alles unter `/api/` — gleiche Firebase-Hosting-Instanz, kein Subdomain-Setup, kein Extra-DNS.

**Abgrenzung zum normalen malzi.space:**
- Kein Zugriff auf produktive Spaces
- Simulator-Spaces haben eigene kurze TTL (10 Min.) und sind als Test markiert

### Dokumentation

**Plattform:** Statische Seite auf `malzi.space/api/docs/`

**Aufbau:**

| Kapitel | Inhalt |
|---------|--------|
| **Schnellstart** | In 5 Minuten den ersten Space einbetten. Minimales Beispiel, Copy-Paste-fertig. |
| **Konzepte** | E2E-Verschlüsselung erklärt, Zero-Knowledge erklärt, Read-Only erklärt, TTL erklärt — jeweils mit Diagramm. Kein Fachjargon ohne Erklärung. |
| **Embed-API** | Alle Parameter, alle postMessage-Events, Beispiele für React/Vue/Vanilla/WordPress. |
| **JS-SDK** | Installation, alle Methoden, alle Events, Beispiele für Browser + Node.js, TypeScript-Typen. |
| **Webhooks** | Alle Events, Payload-Formate, Signatur-Verifizierung, Retry-Verhalten. |
| **API-Keys** | Registrierung, Rotation, Löschung, wann nötig. |
| **Sicherheit** | Threat-Model für Integratoren: Was malzispace garantiert, was der Integrator sicherstellen muss. |
| **Rate-Limits** | Tabelle aller Limits pro Variante und Endpoint. |
| **Fehler-Referenz** | Alle Fehlercodes mit Erklärung, Lösungsvorschlag und Codebeispiel. |
| **CORS & Headers** | Was erlaubt ist, was blockiert wird, wie man Probleme löst. |
| **Versionierung** | Wie Versionen funktionieren, Deprecation-Policy, Migration-Guides. |
| **FAQ** | Häufige Fragen: "Kann malzispace meine Inhalte lesen?" → Nein, hier ist warum. |
| **Changelog** | Alle API-Änderungen mit Versionsnummer und Datum. |

**Prinzipien:**
- Jedes Code-Beispiel ist lauffähig (kopieren → funktioniert)
- Zweisprachig: Deutsch + Englisch
- Versioniert: Jede API-Version hat eigene Doku
- Durchsuchbar
- Direkte Links vom Simulator zur passenden Doku-Seite

### Test-Strategie

**Ziel:** Jede API-Funktion ist automatisiert getestet. Entwickler können sich darauf verlassen, dass die API stabil ist.

| Ebene | Was wird getestet | Werkzeug | Anzahl (Ziel) |
|-------|-------------------|----------|---------------|
| **Unit** | Crypto-Funktionen (Key-Generierung, Encrypt/Decrypt, write_proof, key_proof) | Vitest | ~50 Tests |
| **Unit** | SDK-Methoden (create, open, setContent, getContent, destroy) | Vitest | ~40 Tests |
| **Unit** | SDK-Events (content_changed, peer_joined, expired, error) | Vitest | ~20 Tests |
| **Integration** | Embed postMessage-Protokoll (alle Events, Fehlerfälle) | Vitest + jsdom | ~30 Tests |
| **Integration** | API-Endpoints (create, load, save, delete mit TTL + Read-Only) | Vitest + Firebase Emulator | ~60 Tests |
| **Integration** | Webhook-Delivery (Signatur, Retry, Opt-in) | Vitest + Firebase Emulator | ~20 Tests |
| **Integration** | API-Key-Management (Registrierung, Rotation, Rate-Limits) | Vitest + Firebase Emulator | ~15 Tests |
| **E2E** | Simulator-Flows (Embed-Playground, SDK-Konsole, Webhook-Tester) | Playwright | ~30 Tests |
| **E2E** | Reale Integration: Embed in Fremd-Seite, SDK in Node.js-Script | Playwright + Node.js | ~20 Tests |
| **Security** | Rate-Limits, ungültige Keys, Replay-Angriffe, fehlender write_proof | Vitest + Firebase Emulator | ~30 Tests |
| **Security** | CORS-Prüfung, Header-Validierung, API-Key-Brute-Force | Vitest | ~15 Tests |
| **Contract** | SDK ↔ API-Kompatibilität (Breaking Changes erkennen) | Contract-Tests | ~20 Tests |
| | | **Gesamt (Ziel)** | **~350 Tests** |

**Prinzipien:**
- Alle Tests laufen in CI (GitHub Actions)
- Kein Test braucht Internet — Firebase Emulator für alles
- Crypto-Tests prüfen Interoperabilität: SDK-verschlüsselt ↔ Web-UI-entschlüsselt (und umgekehrt)
- Security-Tests sind Pflicht bei jedem Release
- Coverage-Ziel: 90%+ für SDK und API-Endpoints

---

## SDK-Distribution & Initialisierung

### Paket & CDN

| Kanal | Pfad | Beschreibung |
|-------|------|-------------|
| **npm** | `@malzispace/sdk` | Offizielle npm-Registry, Semver-versioniert |
| **CDN (Script-Tag)** | `https://malzi.space/sdk/v1/malzispace.min.js` | Für Projekte ohne Build-Tool — einzelne Datei, kein Bundler nötig |
| **CDN (ESM)** | `https://malzi.space/sdk/v1/malzispace.esm.js` | ES-Module-Import direkt im Browser |

```html
<!-- Script-Tag (einfachste Variante) -->
<script src="https://malzi.space/sdk/v1/malzispace.min.js"></script>
<script>
  MalziSpace.init({ apiKey: "mz_live_..." })
  const space = await MalziSpace.create({ ttl: "7d" })
</script>

<!-- ES-Module -->
<script type="module">
  import { MalziSpace } from "https://malzi.space/sdk/v1/malzispace.esm.js"
  MalziSpace.init({ apiKey: "mz_live_..." })
</script>
```

```js
// Node.js
import { MalziSpace } from "@malzispace/sdk"
MalziSpace.init({ apiKey: "mz_live_..." })
```

### Globale Initialisierung

`MalziSpace.init()` setzt den API-Key einmalig. Alle nachfolgenden Aufrufe verwenden ihn automatisch — kein Key bei jedem Call nötig.

```ts
MalziSpace.init(config: InitConfig): void

interface InitConfig {
  apiKey?: string       // API-Key (Pflicht in Node.js, optional im Browser)
  baseUrl?: string      // Standard: "https://malzi.space" — für Self-Hosting
  timeout?: number      // Request-Timeout in ms (Standard: 10000)
  retries?: number      // Auto-Retry bei Netzwerkfehlern (Standard: 2)
}
```

### Bundle-Details

| Eigenschaft | Wert |
|-------------|------|
| **Bundle-Größe (min+gzip)** | Ziel: < 15 KB |
| **Tree-Shaking** | Ja — ESM-Export, nur genutzte Funktionen landen im Bundle |
| **TypeScript** | Typen inklusive (`.d.ts` im Paket, kein `@types/` nötig) |
| **Abhängigkeiten** | Keine — Web Crypto API (nativ in Browser + Node.js 15+) |
| **Browser-Support** | Alle modernen Browser (Chrome 90+, Firefox 90+, Safari 15+, Edge 90+) |
| **Node.js-Support** | Node.js 18+ (LTS) |

---

## Embed-Parameter

### Query-Parameter für `/embed/v1/ID#KEY`

| Parameter | Typ | Standard | Beschreibung |
|-----------|-----|----------|-------------|
| `theme` | `"dark"` \| `"light"` | `"dark"` | Farbschema des Editors |
| `lang` | `"de"` \| `"en"` | `"de"` | Sprache der UI-Texte |
| `toolbar` | `"true"` \| `"false"` | `"true"` | Toolbar anzeigen/verstecken |
| `linenumbers` | `"true"` \| `"false"` | `"true"` | Zeilennummern anzeigen/verstecken |
| `autofocus` | `"true"` \| `"false"` | `"false"` | Editor automatisch fokussieren |

```html
<iframe src="https://malzi.space/embed/v1/abc123?theme=light&lang=en&toolbar=false#KEY"></iframe>
```

### Auto-Resize

Der eingebettete Editor meldet seine aktuelle Höhe per `mz:resize` postMessage an die Host-Seite. So kann der iframe automatisch mitwachsen.

```js
// Host-Seite
window.addEventListener("message", (e) => {
  if (e.origin !== "https://malzi.space") return
  if (e.data?.type === "mz:resize") {
    document.getElementById("myIframe").style.height = e.data.height + "px"
  }
})
```

**`mz:resize` Payload:**

```json
{
  "type": "mz:resize",
  "height": 420,
  "width": 800
}
```

Das Event wird ausgelöst bei: Inhalt ändert sich, Toolbar ein-/ausgeblendet, Fenster resized.

---

## Idempotenz

### Problem

Netzwerkfehler können dazu führen, dass ein `create`-Request ankommt, aber die Antwort verloren geht. Der Client wiederholt den Request → doppelter Space.

### Lösung: Idempotency-Key

Jeder schreibende Request kann einen `X-MZ-Idempotency-Key` Header mitschicken. Der Server speichert das Ergebnis 24 Stunden lang — bei Retry mit gleichem Key wird das gespeicherte Ergebnis zurückgegeben statt eine neue Aktion auszuführen.

```js
const space = await MalziSpace.create({
  ttl: "7d",
  idempotencyKey: "usr_abc_workshop_2026-03-17"
})
// Retry mit gleichem Key → gleicher Space, kein Duplikat
```

| Aspekt | Verhalten |
|--------|-----------|
| **Header** | `X-MZ-Idempotency-Key: <string>` (max. 256 Zeichen) |
| **Gültigkeitsdauer** | 24 Stunden nach erstem Request |
| **Betroffene Endpoints** | `create`, `destroy`, Webhook-Registrierung |
| **Ohne Key** | Request wird immer ausgeführt (kein Schutz vor Duplikaten) |
| **SDK** | Generiert automatisch einen UUID-Key wenn keiner angegeben — Retry-sicher per Default |
| **Vorbild** | Stripe, Shopify, PayPal verwenden dasselbe Pattern |

---

## SDK Error-Typen

### Fehler-Hierarchie

```
MalziSpaceError (Basis)
├── NetworkError          — Verbindungsfehler, Timeout
├── AuthError             — API-Key ungültig oder fehlt
├── NotFoundError         — Space existiert nicht
├── ExpiredError          — Space ist abgelaufen
├── WriteProofError       — Schreibzugriff verweigert
├── RateLimitError        — Rate-Limit überschritten (enthält retryAfter)
├── ContentTooLargeError  — Inhalt > 1 MB
└── ValidationError       — Ungültige Parameter (TTL, URL, etc.)
```

### Duale Fehlerbehandlung: Promise + Events

**Promise-basiert (für einzelne Operationen):**

```js
try {
  const space = await MalziSpace.create({ ttl: "7d" })
} catch (err) {
  if (err instanceof MalziSpace.RateLimitError) {
    console.log(`Retry in ${err.retryAfter} Sekunden`)
  }
  if (err instanceof MalziSpace.ExpiredError) {
    // Space neu erstellen
  }
}
```

**Event-basiert (für laufende Verbindungen):**

```js
space.on("error", (err) => {
  // Fehler während aktiver Echtzeit-Verbindung
  console.log(err.code, err.message, err.hint)
})
```

**Jeder Fehler enthält:**

| Feld | Typ | Beschreibung |
|------|-----|-------------|
| `code` | `string` | Maschinenlesbar (z.B. `RATE_LIMITED`) |
| `message` | `string` | Menschenlesbar |
| `hint` | `string` | Konkreter Lösungsvorschlag |
| `docs` | `string` | Link zur Fehler-Dokumentation |
| `statusCode` | `number` | HTTP-Status (wenn zutreffend) |
| `retryAfter` | `number?` | Sekunden bis Retry (nur bei `RateLimitError`) |

---

## SDK Reconnection & Offline

### Verbindungslebenszyklus

```
Connected → Disconnected → Reconnecting → Connected
                                      └→ Failed (nach max. Retries)
```

### Auto-Reconnect

| Aspekt | Verhalten |
|--------|-----------|
| **Trigger** | WebSocket/RTDB-Verbindung bricht ab |
| **Strategie** | Exponential Backoff: 1s → 2s → 4s → 8s → 16s → 30s (max) |
| **Max. Versuche** | 10 (dann `error`-Event mit `NetworkError`) |
| **Offline-Queue** | Lokale Änderungen werden gepuffert und nach Reconnect gesendet |
| **Konflikterkennung** | Firebase RTDB Operational Transform löst Konflikte automatisch |

### Events

```js
space.on("disconnected", () => {
  // UI kann "Verbindung unterbrochen..." anzeigen
})

space.on("reconnecting", (data) => {
  console.log(`Versuch ${data.attempt} von ${data.maxAttempts}...`)
})

space.on("reconnected", () => {
  // Gepufferte Änderungen werden automatisch synchronisiert
})
```

### Konfiguration

```js
const space = await MalziSpace.create({
  ttl: "7d",
  reconnect: {
    enabled: true,        // Standard: true
    maxAttempts: 10,       // Standard: 10
    maxDelay: 30000        // Max. Wartezeit in ms (Standard: 30000)
  }
})
```

---

## Webhook-Idempotenz

### Problem

Netzwerkfehler können dazu führen, dass ein Webhook zugestellt wird, aber die Bestätigung (HTTP 200) den malzispace-Server nicht erreicht. Der Server wiederholt die Zustellung → Integrator bekommt denselben Event doppelt.

### Lösung: Eindeutige Delivery-ID

Jeder Webhook enthält eine `delivery_id` im Payload und im Header. Bei Retry wird dieselbe `delivery_id` gesendet.

```json
{
  "delivery_id": "whd_a1b2c3d4e5f6",
  "event": "space.expired",
  "spaceId": "abc123",
  "timestamp": "2026-03-24T10:00:00Z",
  "signature": "hmac-sha256:..."
}
```

| Header | Wert | Beschreibung |
|--------|------|-------------|
| `X-MZ-Delivery-ID` | `whd_a1b2c3d4e5f6` | Eindeutige ID dieser Zustellung |
| `X-MZ-Event` | `space.expired` | Event-Typ |
| `X-MZ-Signature` | `hmac-sha256:...` | HMAC-Signatur |
| `X-MZ-Retry` | `0`, `1`, `2`, `3` | Retry-Nummer (0 = erster Versuch) |

**Empfohlene Deduplizierung beim Integrator:**

```js
app.post("/hooks/malzispace", (req, res) => {
  const deliveryId = req.headers["x-mz-delivery-id"]
  if (await isAlreadyProcessed(deliveryId)) {
    return res.status(200).send("OK") // Duplikat ignorieren, aber 200 zurückgeben
  }
  await markAsProcessed(deliveryId) // TTL: 7 Tage
  await handleEvent(req.body)
  res.status(200).send("OK")
})
```

---

## Status & Health

### Health-Endpoint

```
GET /api/v1/health
```

```json
{
  "status": "ok",
  "version": "1.0.0",
  "timestamp": "2026-03-17T22:00:00Z",
  "services": {
    "firestore": "ok",
    "rtdb": "ok",
    "functions": "ok"
  }
}
```

| Aspekt | Wert |
|--------|------|
| **URL** | `https://malzi.space/api/v1/health` |
| **Authentifizierung** | Keine — öffentlich zugänglich |
| **Rate-Limit** | 60 Requests/Minute (kein API-Key nötig) |
| **Antwortzeit** | Ziel: < 200ms |

### Status-Seite

| Aspekt | Lösung |
|--------|--------|
| **URL** | `status.malzi.space` |
| **Plattform** | Firebase Hosting (Subdomain) oder externer Dienst (z.B. Instatus, Betterstack) |
| **Inhalt** | Aktueller Status, Incident-History, geplante Wartungen |
| **Benachrichtigungen** | RSS-Feed + E-Mail-Abo für Statusänderungen |

### Uptime-Ziel (informell)

| Ziel | Wert | Bedeutung |
|------|------|-----------|
| **Verfügbarkeit** | 99,5% | Max. ~3,65 Stunden Downtime/Monat |
| **Antwortzeit (API)** | P95 < 500ms | 95% aller Requests unter 500ms |
| **Antwortzeit (Editor)** | P95 < 2s | Editor-Ladezeit inkl. Entschlüsselung |

> **Hinweis:** Dies ist ein Zielwert, kein garantiertes SLA. malzispace ist ein Open-Source-Projekt — kein kommerzieller SLA-Vertrag.

---

## Custom Metadata

### Was ist das?

Integratoren können beliebige Schlüssel-Wert-Paare an einen Space anhängen. Diese Metadaten werden bei Webhooks mitgeliefert — der Integrator braucht keine eigene Datenbank-Zuordnung.

### Nutzung

```js
const space = await MalziSpace.create({
  ttl: "7d",
  metadata: {
    courseId: "kurs-42",
    groupName: "Team Alpha",
    createdBy: "trainer@example.com"
  }
})
```

### Regeln

| Aspekt | Wert |
|--------|------|
| **Max. Schlüssel** | 20 pro Space |
| **Schlüssel-Länge** | Max. 64 Zeichen, nur `a-z`, `A-Z`, `0-9`, `_`, `-` |
| **Wert-Länge** | Max. 512 Zeichen (String) |
| **Gesamtgröße** | Max. 8 KB pro Space |
| **Verschlüsselung** | Nein — Metadaten sind serverseitig lesbar (kein Klartext-Inhalt speichern!) |
| **Änderbar** | Nein — einmal gesetzt, unveränderlich (by design: einfacher, sicherer) |

### In Webhooks

```json
{
  "delivery_id": "whd_a1b2c3d4e5f6",
  "event": "space.expired",
  "spaceId": "abc123",
  "metadata": {
    "courseId": "kurs-42",
    "groupName": "Team Alpha"
  },
  "timestamp": "2026-03-24T10:00:00Z"
}
```

> **Datenschutz-Hinweis:** Metadaten sind NICHT verschlüsselt. Keine personenbezogenen Daten oder sensiblen Informationen in Metadaten speichern. Für vertrauliche Zuordnungen eigene Datenbank verwenden.

---

## OpenAPI & AsyncAPI Spezifikation

### Maschinenlesbare API-Definition

| Spec | Format | Pfad | Beschreibung |
|------|--------|------|-------------|
| **OpenAPI 3.1** | YAML/JSON | `malzi.space/api/v1/openapi.json` | HTTP-Endpoints (create, health, keys) |
| **AsyncAPI 3.0** | YAML/JSON | `malzi.space/api/v1/asyncapi.json` | Webhooks + SDK-Events + postMessage |

### Was ermöglicht das?

| Nutzen | Beschreibung |
|--------|-------------|
| **Postman/Insomnia-Import** | API-Collection mit einem Klick importieren |
| **Code-Generierung** | Client-Libraries für Python, Go, Ruby etc. automatisch generieren |
| **Dokumentation** | API-Docs können aus der Spec generiert werden (Stoplight, Redoc) |
| **Validierung** | Request/Response-Schemas automatisch prüfen |
| **Mock-Server** | Integratoren können gegen einen Mock-Server entwickeln bevor die API live ist |

### Versionierung

Jede API-Version hat eine eigene Spec-Datei. Bei Breaking Changes wird eine neue Spec unter `/api/v2/openapi.json` veröffentlicht.

---

## Fair Use & Nutzungsrichtlinien

### Erlaubt

- Einbettung in eigene Webseiten und Apps
- Kommerzielle Nutzung (z.B. in SaaS-Produkten)
- Automatisierte Space-Erstellung (innerhalb der Rate-Limits)
- White-Label-Einbettung (Logo ist standardmäßig versteckt)

### Nicht erlaubt

- Missbrauch als Daten-Speicher (Spaces sind temporär, nicht für Persistenz)
- Automatisiertes Scraping oder Crawling von Spaces
- Umgehung von Rate-Limits (z.B. durch Key-Rotation)
- Weiterverkauf von API-Zugang
- Speicherung illegaler Inhalte

### Abuse-Prevention

| Maßnahme | Beschreibung |
|----------|-------------|
| **Rate-Limits** | Progressiv: Warnung → Drosselung → temporäre Sperre |
| **Anomalie-Erkennung** | Ungewöhnliche Muster (z.B. 1000 Spaces in 1 Minute) lösen Review aus |
| **Key-Sperre** | API-Key kann sofort deaktiviert werden |
| **IP-basiertes Limit** | Zusätzlich zu API-Key: max. Requests pro IP (gegen Key-Sharing) |
| **Meldung** | `abuse@malzi.space` — Missbrauch melden |

### Support-Kanäle für Entwickler

| Kanal | Beschreibung |
|-------|-------------|
| **GitHub Discussions** | Community-Support, Feature-Requests, Q&A |
| **GitHub Issues** | Bug-Reports (öffentlich) |
| **E-Mail** | `api@malzi.space` — für Sicherheitsprobleme und Account-Fragen |
| **Dokumentation** | Selbstbedienung: FAQ, Troubleshooting, Fehler-Referenz |

> Kein Live-Chat oder Telefon-Support — Open-Source-Projekt mit Community-Modell.

---

## Umsetzung: Full Build (Embed + SDK + Webhooks)

**Entscheidung (2026-03-17):** Alle drei Varianten werden zusammen gebaut — kein Phasenansatz. Das ergibt den vollen Funktionsumfang von Anfang an.

**Was wird gebaut:**

| Komponente | Beschreibung |
|------------|-------------|
| **Embed-API** | iframe-Einbettung, postMessage-Protokoll, Query-Parameter (Theme, Sprache, Toolbar), Auto-Resize, Logo immer versteckt |
| **JS-SDK** | `@malzispace/sdk` (npm + CDN), Browser + Node.js, automatische Crypto, Events, Typed Errors, Auto-Reconnect |
| **Webhooks** | Event-Benachrichtigungen mit HMAC-Signatur, Retry, Delivery-ID-Idempotenz, Custom Metadata |
| **API-Key-Management** | Selbstbedienung, Zero-Knowledge-Speicherung |
| **Idempotenz** | `X-MZ-Idempotency-Key` für alle schreibenden Endpoints |
| **Custom Metadata** | Integrator-Metadaten pro Space, in Webhooks mitgeliefert |
| **API-Simulator** | Developer Playground auf malzi.space/api/playground/ |
| **Dokumentation** | Vollständige Doku auf malzi.space/api/docs/ |
| **OpenAPI / AsyncAPI** | Maschinenlesbare Specs für Code-Generierung, Postman-Import, Mock-Server |
| **Error-Handling** | Einheitliche Error-Codes mit Hints und Doku-Links, Typed SDK-Errors |
| **Rate-Limiting** | Per API-Key + IP, mit erklärendem 429-Response, Abuse-Prevention |
| **Status & Health** | Health-Endpoint, Status-Seite, Uptime-Monitoring |
| **Versionierung** | URL-Prefix v1, Deprecation-Policy, 12 Monate Übergang |
| **Fair Use** | Nutzungsrichtlinien, Abuse-Prevention, Support-Kanäle |
| **Tests** | ~350 Tests (Unit, Integration, E2E, Security, Contract) |

---

## Beispiel-Integrationen (Anwendungsszenarien)

Die API ist allgemeingültig. Hier einige Szenarien, für die sie gedacht ist:

| Szenario | Variante | Beschreibung |
|----------|----------|-------------|
| **Lernplattform** | Embed + Webhooks | Kurs-Seite bettet Editor ein. Teilnehmer arbeiten zusammen. Space läuft nach Kurs-Ende ab. |
| **Support-Tool** | SDK (Node.js) | Server erstellt Space mit vorausgefüllter Fehlerbeschreibung. Kunde bekommt Lese-Link. |
| **CMS-Plugin** | Embed | WordPress/Ghost-Plugin: Editor als Block einfügen. Kein Backend nötig. |
| **Workshop-Tool** | SDK + Webhooks | Tool erstellt Spaces pro Teilnehmergruppe. Webhook meldet wenn fertig. |
| **Dokumentation** | Embed (Read-Only) | Interaktive Code-Beispiele einbetten. Leser können Text kopieren, nicht ändern. |
| **Umfrage-Tool** | SDK (Browser) | Eigene UI, SDK im Hintergrund. Antworten verschlüsselt gespeichert. |

---

## TTL-Konfiguration

| Erstellt über | Standard | Einstellbar | Maximum |
|--------------|----------|-------------|---------|
| Web-UI (malzi.space) | 24h | Nein (bleibt fix) | 24h |
| Embed-API (Variante A) | 24h | Ja | 7 Tage |
| JS-SDK (Variante B) | 24h | Ja | 7 Tage |
| Simulator (Playground) | 10 Min. | Nein | 10 Min. |

---

## Was NICHT zur öffentlichen API gehört

Diese Punkte sind integratorspezifisch und werden nicht von malzispace bereitgestellt:

- UI für Space-Verwaltung (Karten, Listen, Dashboards) — baut jeder Integrator selbst
- Benutzer-Authentifizierung — malzispace hat keine Accounts
- Trainer/Teilnehmer-Rollen — das ist Integrator-Logik
- Bezahlung/Premium-Features — das ist Integrator-Sache
- Benachrichtigungen an Endnutzer — Integrator entscheidet wie

malzispace liefert die **Infrastruktur** (verschlüsselte Editoren, Echtzeit-Sync, TTL, Events). Was darauf gebaut wird, entscheidet der Integrator.
