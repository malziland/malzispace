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

## Nach dem Release (kurz prüfen)

1. Startseite öffnen, Space erstellen
2. Text tippen, prüfen ob „Gespeichert“ erscheint
3. Link in 2. Tab öffnen: Text/Presence soll funktionieren
