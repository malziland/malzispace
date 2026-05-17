# Release-Checkliste (stabil, ohne "Überraschungen")

Diese Schritte helfen, dass keine fehlerhafte Version live geht.

## Vor jedem Release

1. **Restore-Point erstellen**

   ```bash
   ./ops/restore_point.sh pre-deploy
   ```

2. **Lokale Checks laufen lassen**

   ```bash
   ./ops/verify_local.sh
   ```

3. **Smoke-Test gegen die Live-API (empfohlen)**

   Du brauchst einen gültigen `APP_CHECK_TOKEN`.

   ```bash
   APP_CHECK_TOKEN="..." ./ops/verify_local.sh
   ```

   Wenn der Smoke-Test fehlschlägt: **nicht deployen**, sondern erst fixen.

## Nach dem Release

1. **Live-Gate gegen die Custom-Domain** (Standard):

   ```bash
   ./ops/verify_live.sh
   ```

   Schickt Smoke + Multiplayer gegen `https://malzi.space` mit
   temporärem Debug-Token.

2. **Live-Gate auch gegen das Firebase-Hosting-Default**:

   ```bash
   BASE_URL=https://malzispace.web.app ./ops/verify_live.sh
   ```

   So fällt auf, wenn die Custom-Domain TLS/CSP/Caching-spezifische
   Probleme hat, die unter `*.web.app` nicht auftreten.

3. **Manuelle Sichtkontrolle**: Startseite öffnen, Space erstellen,
   Text tippen, „Gespeichert“ prüfen, Link in 2. Tab teilen, Text +
   Presence prüfen.
