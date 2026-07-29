# malzi.link × malzispace — Integrationskonzept

**Stand:** 2026-03-17
**Status:** Entwurf — internes Konzept

> **Hinweis:** Dieses Dokument ist rein intern und darf NICHT nach GitHub.
> Es beschreibt die konkrete Integration von malzispace in malzi.link.
> Die allgemeingültige API-Spezifikation liegt in `api-concept-v1.md`.

---

## Vision

malzi.link ist eine Link-Verwaltung für Trainer:innen. Teilnehmende erhalten über einen Code (z.B. `X7K9M2`) Zugriff auf kuratierte Links — Folien, Formulare, Quizze.

**Neu:** Trainer:innen können zusätzlich zu normalen Links auch **malzispace Spaces** anlegen — verschlüsselte, temporäre Editoren direkt in malzi.link. Das ist ein **Premium-Feature**.

---

## Warum malzispace in malzi.link?

| Problem | Lösung mit malzispace |
|---------|----------------------|
| Trainer brauchen spontane Notiz-Flächen | Space in 2 Klicks anlegen |
| Teilnehmer sollen gemeinsam schreiben | Echtzeit-Kollaboration im Space |
| Inhalte müssen nach dem Workshop weg | Automatische Löschung (TTL 1 Min – 7 Tage) |
| Datenschutz ist Pflicht (DSGVO) | E2E-Verschlüsselung, Zero-Knowledge |
| Trainer will steuern wer schreibt | Read-Only vs. Bearbeiten-Modus |
| Aufräumen vergessen | Space läuft ab → Karte verschwindet automatisch |

---

## Nutzerrollen

### Trainer:in (malzi.link-Dashboard)

- Erstellt Spaces über das malzi.link-Dashboard
- Sieht alle Spaces als Karten neben normalen Links
- Kann Space-Einstellungen ändern (Titel, TTL, Modus, Prefill)
- Sieht Live-Teilnehmerzahl auf der Karte
- Kann Spaces freigeben/sperren (Toggle)
- Kann Spaces bearbeiten (immer Schreibzugriff)
- Sieht Webhook-Events (space.created, space.expired, peer.count_changed)

### Teilnehmende (Code-Zugang)

- Sehen nur freigegebene Links/Spaces
- Öffnen Space per Klick auf die Karte
- Modus abhängig von Trainer-Einstellung:
  - **Nur Lesen:** Formatierungs-Buttons versteckt, Kopieren sichtbar
  - **Bearbeiten:** Voller Editor (Bold, Italic, Underline, Listen, Alignment, HR)
- Sehen Live-Teilnehmerzahl
- Sehen Countdown bis zur automatischen Löschung

---

## UI-Konzept

### Dashboard-Ansicht (Trainer)

```
┌─────────────────────────────────────────────────────┐
│  malzi.link              [Trainer:in] [Teilnehmende] │
├─────────────────────────────────────────────────────┤
│  Alle Links                                    [+]  │
│  4 Links · 3 freigegeben · 1 gesperrt               │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐          │
│  │ Feedback │  │ Folien   │  │ Workshop │          │
│  │ Form     │  │ Google   │  │ Notizen  │          │
│  │ 🔗 Link  │  │ 🔗 Link  │  │ 📝 Space │          │
│  │          │  │          │  │ Nur Lesen│          │
│  │ ● Frei   │  │ ● Frei   │  │ 3 aktiv  │          │
│  │   ✏️ ⬤  │  │   ✏️ ⬤  │  │ ● Frei   │          │
│  └──────────┘  └──────────┘  │   ✏️ ⬤  │          │
│                               └──────────┘          │
│                                                      │
│  Webhook-Events                                      │
│  ● space.created           vor 2h                    │
│  ● peer.count_changed      count: 3                  │
│  ● space.expired           Link automatisch gelöscht │
└─────────────────────────────────────────────────────┘
```

### Space-Karte vs. Link-Karte

| Eigenschaft | Link-Karte | Space-Karte |
|-------------|-----------|-------------|
| **Banner** | Domain-Initial (z.B. "F") | malzispace-Icon (Editor-SVG) |
| **Border** | Standard | Blau (rgba(56,189,248,.15)) |
| **Badges** | Tags (z.B. "feedback") | "Space" + Modus ("Nur Lesen" / "Bearbeiten") |
| **Live-Anzeige** | — | Pulse + "3 Teilnehmer aktiv" |
| **Klick-Aktion** | Öffnet externen Link | Öffnet Editor-Overlay |
| **Bearbeiten (✏️)** | Link-URL ändern | Space-Einstellungen ändern |
| **Toggle** | Freigeben/Sperren | Freigeben/Sperren |

### Anlegen-Modal

Beim Klick auf [+] wählt der Trainer den Typ:

```
┌─────────────────────────────────┐
│  Neuen Link anlegen         [×] │
├─────────────────────────────────┤
│  Was möchtest du anlegen?       │
│                                 │
│  ┌────────────┐ ┌────────────┐ │
│  │    🔗      │ │    📝      │ │
│  │   Link     │ │   Space    │ │
│  │ Externe URL│ │ Verschl.   │ │
│  │            │ │ Editor     │ │
│  └────────────┘ └────────────┘ │
│                                 │
│  [Titel]                        │
│  [Beschreibung]                 │
│                                 │
│  ── Editor-Einstellungen ──     │
│  Teilnehmer dürfen bearbeiten ⬤│
│  Lebensdauer  ━━━━━━●━  7 Tage │
│                                 │
│  Inhalt vorausfüllen            │
│  [B][I][U][⇐][⇔][⇒][•][1.][—] │
│  ┌─────────────────────────┐    │
│  │ z.B. Willkommen zum ... │    │
│  └─────────────────────────┘    │
│                                 │
│  ⬤ Sofort freischalten         │
│                                 │
│  [        Space anlegen        ]│
└─────────────────────────────────┘
```

**Bearbeiten-Modus:** Wenn ein bestehender Space bearbeitet wird, ist der Typ-Selektor (Link/Space) versteckt. Titel: "Space bearbeiten", Button: "Änderungen speichern".

### Editor-Overlay

Beim Klick auf eine Space-Karte öffnet sich das Editor-Overlay:

```
┌─────────────────────────────────────────┐
│  📝 Workshop-Notizen  Space  Nur Lesen  │
│       ● 3 aktiv                    [×]  │
├─────────────────────────────────────────┤
│  Nur Lesen — du kannst den Text ansehen │
│  und kopieren                           │
├─────────────────────────────────────────┤
│  [B][I][U] [⇐][⇔][⇒] [•][1.][—] [📋]  │
│  (versteckt im Read-Only,               │
│   Kopieren immer sichtbar)              │
├───┬─────────────────────────────────────┤
│ 1 │ Workshop: API-Integration           │
│ 2 │                                     │
│ 3 │ Willkommen! In diesem Workshop...   │
│ 4 │                                     │
│ 5 │ Agenda:                             │
│ 6 │   1. Grundlagen der E2E-Verschl.    │
│ 7 │   2. Embed-API ausprobieren         │
│ 8 │   3. Fragen und Diskussion          │
├───┴─────────────────────────────────────┤
│  Automatische Löschung in 6d 23:42:17   │
└─────────────────────────────────────────┘
```

**Wichtig:**
- Overlay schließt NICHT bei Klick auf den Hintergrund (verhindert versehentliches Schließen beim Text-Markieren)
- Countdown läuft ab Erstellungszeitpunkt, nicht ab Öffnungszeitpunkt
- Zeilennummern synchron mit Inhalt (scrollen mit)
- Enter erzeugt `<br>` (nicht `<div>`), Cursor springt zur neuen Zeile

---

## Technische Integration

### Welche API-Varianten nutzt malzi.link?

| Variante | Einsatz in malzi.link |
|----------|----------------------|
| **Embed (iframe)** | Nein — malzi.link baut eigene UI |
| **JS-SDK (Browser)** | Ja — Space erstellen, Inhalt setzen, Events empfangen |
| **JS-SDK (Node.js)** | Ja — serverseitig Spaces verwalten (optional, für Batch) |
| **Webhooks** | Ja — automatisch aufräumen wenn Space abläuft |

### SDK-Nutzung im malzi.link-Frontend

```js
import { MalziSpace } from "@malzispace/sdk"

// Globale Initialisierung (einmalig beim App-Start)
MalziSpace.init({ apiKey: "mz_live_..." })

// Space erstellen (Trainer klickt "Space anlegen")
const space = await MalziSpace.create({
  ttl: "7d",
  readOnly: false,
  content: "<b>Willkommen zum Workshop!</b>",
  metadata: {
    sessionCode: "X7K9M2",
    trainerId: "trainer_abc",
    cardOrder: "3"
  }
})

// Links für Trainer + Teilnehmer
const trainerUrl = space.editorUrl   // #KEY.WRITE — immer Schreibzugriff
const participantUrl = space.readOnlyUrl  // #KEY — nur Lesen (wenn readOnly)
// ODER
const participantUrl = space.editorUrl    // #KEY.WRITE — Bearbeiten (wenn !readOnly)

// Echtzeit-Events
space.on("peer_joined", ({ count }) => {
  updateCardLiveCount(space.spaceId, count)
})

space.on("expired", () => {
  removeCardFromDashboard(space.spaceId)
  // malzi.link löscht den eigenen Datenbank-Eintrag
})

space.on("disconnected", () => {
  showConnectionWarning()
})

space.on("reconnected", () => {
  hideConnectionWarning()
})
```

### Webhook-Nutzung (Server-seitig)

```js
// malzi.link Cloud Function empfängt Webhooks
export const malzispaceWebhook = onRequest(async (req, res) => {
  // Signatur prüfen
  const signature = req.headers["x-mz-signature"]
  const deliveryId = req.headers["x-mz-delivery-id"]

  if (!verifySignature(req.body, signature, WEBHOOK_SECRET)) {
    return res.status(401).send("Invalid signature")
  }

  // Deduplizierung
  if (await isProcessed(deliveryId)) {
    return res.status(200).send("OK")
  }
  await markProcessed(deliveryId)

  const { event, spaceId, metadata } = req.body

  switch (event) {
    case "space.expired":
      // Karte aus malzi.link-Session entfernen
      await removeSpaceCard(metadata.sessionCode, spaceId)
      break

    case "peer.count_changed":
      // Live-Zahl in Firestore updaten → UI aktualisiert sich automatisch
      await updatePeerCount(metadata.sessionCode, spaceId, req.body.count)
      break
  }

  res.status(200).send("OK")
})
```

### Webhook-Registrierung

```js
// Einmalig bei malzi.link-Setup
await MalziSpace.webhooks.register({
  url: "https://malzi.link/api/webhooks/malzispace",
  events: ["space.created", "space.expired", "peer.count_changed"],
  secret: WEBHOOK_SECRET
})
```

---

## Datenmodell (malzi.link-seitig)

### Firestore-Dokument pro Space-Karte

```
/sessions/{sessionCode}/links/{linkId}
```

```json
{
  "type": "space",
  "title": "Workshop-Notizen",
  "description": "Gemeinsame Notizen für alle Teilnehmer.",
  "order": 3,
  "enabled": true,
  "spaceId": "abc123",
  "editorUrl": "https://malzi.space/space/abc123#KEY.WRITE",
  "readOnlyUrl": "https://malzi.space/space/abc123#KEY",
  "writeMode": false,
  "ttlDays": 7,
  "createdAt": "2026-03-17T14:00:00Z",
  "expiresAt": "2026-03-24T14:00:00Z",
  "peerCount": 3,
  "metadata": {
    "sessionCode": "X7K9M2",
    "trainerId": "trainer_abc"
  }
}
```

**Wichtig:**
- `editorUrl` enthält den WRITE-Schlüssel → nur in Trainer-Dokumenten gespeichert
- Teilnehmer erhalten `readOnlyUrl` über Security Rules
- Firestore Security Rules verhindern, dass Teilnehmer den `editorUrl` lesen

### Sicherheitsregel

```js
// Teilnehmer dürfen editorUrl nie sehen
match /sessions/{code}/links/{linkId} {
  allow read: if request.auth != null
    && (isTrainer(code) || !resource.data.keys().hasAny(['editorUrl']))
}
```

---

## Feature-Matrix: Premium

malzispace-Spaces in malzi.link sind ein **Premium-Feature**.

| Feature | Free | Premium |
|---------|:----:|:-------:|
| Normale Links | ∞ | ∞ |
| Spaces pro Session | 0 | 10 |
| Space-TTL | — | 1 Min – 7 Tage |
| Prefill-Inhalt | — | Ja |
| Read-Only / Bearbeiten | — | Ja |
| Live-Teilnehmerzahl | — | Ja |
| Webhook-Events | — | Ja |
| Automatische Löschung | — | Ja |

### Upsell-Moment

Wenn ein Free-Nutzer auf "Space" klickt im Typ-Selektor, erscheint ein dezenter Hinweis:

```
┌─────────────────────────────────┐
│  ✨ Spaces sind ein Premium-    │
│  Feature. Verschlüsselte        │
│  Editoren für deine Sessions.   │
│                                 │
│  [Premium aktivieren]           │
└─────────────────────────────────┘
```

---

## Automatisches Aufräumen

### Ablauf wenn Space abläuft

```
1. malzispace: Space-TTL läuft ab
2. malzispace: Löschung ausgeführt, Webhook "space.expired" gesendet
3. malzi.link: Webhook empfangen
4. malzi.link: Signatur + Delivery-ID geprüft
5. malzi.link: Karte aus Session entfernt (Firestore-Dokument gelöscht)
6. malzi.link: UI aktualisiert sich automatisch (Firestore-Listener)
7. Teilnehmer sehen die Karte nicht mehr
```

**Kein manuelles Eingreifen nötig.** Der Trainer muss nichts tun.

### Fallback: Polling

Falls der Webhook nicht zugestellt werden kann (3 Retries fehlgeschlagen), prüft malzi.link per Cron-Job (alle 15 Min.) ob Spaces abgelaufen sind:

```js
// Cloud Scheduler: alle 15 Minuten
const expiredSpaces = await db.collection("sessions")
  .collectionGroup("links")
  .where("type", "==", "space")
  .where("expiresAt", "<", new Date())
  .get()

for (const doc of expiredSpaces.docs) {
  await doc.ref.delete()
}
```

---

## Teilnehmer-Ansicht

### Was sieht ein Teilnehmer?

```
┌─────────────────────────────────────┐
│  Teilnehmer-Ansicht — Code: X7K9M2 │
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────┐          │
│  │ Feedback-Formular     │          │
│  │ forms.google.com      │          │
│  └───────────────────────┘          │
│                                     │
│  ┌───────────────────────┐          │
│  │ Präsentations-Folien  │          │
│  │ docs.google.com       │          │
│  └───────────────────────┘          │
│                                     │
│  ┌───────────────────────┐          │
│  │ 📝 Workshop-Notizen   │          │
│  │ Space · Nur Lesen     │          │
│  │ ● 3 Teilnehmer aktiv  │          │
│  └───────────────────────┘          │
│                                     │
│  malzi.link reagiert automatisch    │
│  auf Events. Wenn der Space         │
│  abläuft, verschwindet die Karte.   │
└─────────────────────────────────────┘
```

- Gesperrte Links (z.B. Quiz) werden nicht angezeigt
- Space-Karten zeigen Badge (Space + Modus) + Live-Teilnehmerzahl
- Klick öffnet den Editor im gleichen Overlay wie beim Trainer
- Im Read-Only-Modus: Toolbar-Buttons versteckt, Kopieren-Button sichtbar

---

## Editor-Funktionen im Überblick

### Toolbar-Buttons (1:1 malzispace)

| Gruppe | Buttons | Beschreibung |
|--------|---------|-------------|
| **Text-Stil** | **B**, *I*, U | Fett, Kursiv, Unterstrichen |
| **Alignment** | ⇐, ⇔, ⇒ | Linksbündig, Zentriert, Rechtsbündig |
| **Listen** | •, 1., — | Aufzählung, Nummeriert, Horizontale Linie |
| **Kopieren** | 📋 Kopieren | Inhalt in Zwischenablage (immer sichtbar) |

### Verhalten

| Aspekt | Verhalten |
|--------|-----------|
| **Enter-Taste** | Erzeugt `<br>` + Zero-Width Space (kein `<div>`) |
| **Einfügen (Paste)** | Hintergrundfarben, Schriftarten, Klassen werden entfernt |
| **Zeilennummern** | Live-Update, Scroll-Sync mit Editor |
| **Kopieren** | Custom DOM-Walker: leere Zeilen werden korrekt kopiert |
| **Countdown** | Läuft ab Erstellungszeitpunkt, nicht ab Öffnungszeitpunkt |
| **Overlay schließen** | Nur per ×-Button oder Escape, nicht per Klick außerhalb |

### Prefill-Editor (Anlegen-Modal)

Identische Toolbar wie der Haupt-Editor:
- **B**, **I**, **U**, Linksbündig, Zentriert, Rechtsbündig, Aufzählung, Nummeriert, Horizontale Linie
- contenteditable `<div>` (nicht `<textarea>`)
- Formatierter Inhalt wird als HTML in den Space übertragen

---

## Deployment-Überlegungen

### malzi.link-seitig nötig

| Aufgabe | Beschreibung |
|---------|-------------|
| **SDK einbinden** | `@malzispace/sdk` in malzi.link-Frontend |
| **API-Key generieren** | Auf `malzi.space/api/keys/` — Key sicher in Cloud Functions speichern |
| **Webhook-Endpoint** | Cloud Function die Webhooks empfängt und verarbeitet |
| **Firestore-Schema** | `type: "space"` Felder in bestehende Link-Dokumente |
| **Security Rules** | `editorUrl` vor Teilnehmern schützen |
| **Premium-Gate** | Space-Erstellung nur für Premium-Nutzer |
| **Cron-Job** | Fallback-Cleanup für nicht zugestellte Webhooks |

### malzispace-seitig nötig

Nichts Spezifisches — malzi.link nutzt die allgemeingültige öffentliche API.

---

## Referenz

| Dokument | Pfad | Beschreibung |
|----------|------|-------------|
| **API-Konzept (allgemeingültig)** | `api-concept-v1.md` | Die öffentliche API-Spezifikation |
| **Interaktive Demo** | `api-demo.html` | Simuliert das malzi.link-Dashboard mit Space-Integration |
| **Dieses Dokument** | `malzilink-integration-concept.md` | malzi.link-spezifisches Integrationskonzept |

---

## Offene Fragen

- [ ] Wie wird der API-Key im malzi.link-Backend gespeichert? (Secret Manager vs. Firestore)
- [ ] Sollen Spaces über Session-Boundaries hinweg existieren können?
- [ ] Max. Spaces pro Session: 10 genug oder mehr?
- [ ] Soll der Trainer den Space-Inhalt vor der Freigabe sehen können (Preview)?
- [ ] Soll es eine "Space kopieren"-Funktion geben (Template für wiederkehrende Workshops)?
