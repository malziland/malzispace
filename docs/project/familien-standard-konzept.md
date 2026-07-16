# Konzept: malziSPACE auf den Prompt-Familien-Standard nachziehen

Stand: 2026-07-16 · Basis: PROJEKTSTART 1.1.1 (Lückenplan-Modus), CHANGE DELIVERY 1.1, KURZAUDIT/LANGAUDIT 2026.11
Status: **ENTWURF — wartet auf Freigabe** · Ist-Stand des Repos: v1.4.0, Branch main, Working Tree clean (4 untracked Konzept-/Prototyp-Dateien, bleiben unberührt)

## 1. Auftrag und Interpretation

Die Prompt-Familie (PROJEKTSTART → CHANGE DELIVERY → KURZAUDIT → LANGAUDIT) definiert einen
Familien-Standard für Projekte: Evidenz vor Behauptung, feste Bootstrap-Artefakte
(AGENTS.md, ADRs, docs/VERIFICATION.md, docs/SECURITY-MODEL.md, docs/RUNBOOK.md, docs/FLAGS.md),
geprobter Rollback, gehärtete CI. PROJEKTSTART sieht ausdrücklich vor, ein **bestehendes**
Projekt auf diesen Standard nachzuziehen („Lückenplan": ergänzen, was fehlt — nicht neu
aufsetzen, was existiert).

Dieses Konzept plant genau das für malziSPACE. Danach laufen künftige Änderungen über
CHANGE DELIVERY und die Audits finden je Anforderung ihren Nachweisweg in docs/VERIFICATION.md.

## 2. Einordnung (Phase 0 der Familie)

| Punkt | Einordnung | Begründung |
|---|---|---|
| Projektart | Web/SaaS + Serverless (Firebase Hosting, Functions v2, Firestore, RTDB) | bestehender Stack |
| Ausbaustufe | **STANDARD** | produktiv, öffentlich erreichbar, Open Source; MINIMAL ausgeschlossen (öffentliche Produktivbereitstellung, reale Nutzerdaten). ENTERPRISE wäre Over-Engineering für ein Solo-Projekt |
| Aktive Profile | **UI**, **SERVICE_API**, **MONOREPO** | UI: Editor/Web-App; SERVICE_API: /api/save, /api/lock, /api/append-only, Relay; MONOREPO: npm workspaces (services/api, services/collab-relay, tests) |
| Kritikalität | produktiv (nicht reguliert) | Live-Dienst mit echten Nutzern (Schulen/Workshops) |
| Datenklasse | PII-berührend | E2E-verschlüsselte Inhalte (Klartext serverseitig nicht lesbar), aber IP-Adressen, App-Check-Tokens, Owner-Proofs |
| Versionierung | SemVer für die deployte App (v1.4.0) | bereits gelebte Praxis, wird in ADR-0001 festgeschrieben |
| Umgebungskapselung | Toolchain-Pinning genügt (.nvmrc, engines, Lockfiles) | Solo-Projekt; Devcontainer bewusst nicht |
| Doku-Sprache | Englisch (Repo-Konvention), Konzepte/Chat Deutsch | bestehende Konvention |

## 3. Gap-Analyse: Familien-Standard vs. Ist-Stand

### 3.1 Bereits erfüllt (wird übernommen, nicht ersetzt)

- Git + Conventional Commits + annotierte Tags + CHANGELOG (Keep a Changelog)
- README, LICENSE (MIT), SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, CODEOWNERS
- Lockfiles committet; Toolchain gepinnt (.nvmrc = Node 24, engines-Feld)
- CI `.github/workflows/verify.yml`: npm ci (frozen), dependency-review auf PRs,
  `npm audit --audit-level=high` für Root + beide Services, Playwright-E2E via ops/verify_local.sh
- Dependabot konfiguriert (.github/dependabot.yml)
- Test-Substanz: 136 Tests (Unit + 92 E2E + I18N + Simulator), Coverage-Gates (85/85/75/85)
- Quality-Gate-Doku: docs/ops/QUALITY_GATES.md, RELEASE_CHECKLIST.md, PROFESSIONAL_WORKFLOW.md
- Security-/Privacy-Doku: docs/security/ABUSE_PROTECTION.md, SECURITY_RUNBOOK.md, docs/legal/PRIVACY_STACK.md
- Rollback-Werkzeug: ops/restore_point.sh (Restore-Tags), Rollback-Tag pre-v1.4.0

### 3.2 Lücken (Arbeitspakete)

| AP | Artefakt / Anforderung | Ist | Maßnahme | Aufwand |
|---|---|---|---|---|
| AP1 | **AGENTS.md** | fehlt (auch kein CLAUDE.md) | Handgeschrieben, < 150 Zeilen: exakte Befehle (setup/lint/test/build, E2E-Suiten inkl. Server-Voraussetzung :4173), Modul-Architektur-Verweis, Projektspezifika (ctx-Objekt, Protect-Regeln-Verweis, Test-Portierungsstand lock-E2E). CLAUDE.md nur als 3-Zeilen-Verweis darauf | S |
| AP2 | **docs/adr/ + ADR-0001** | fehlt; Entscheidungen verstreut in CHANGELOG/Konzepten | ADR-0001 retroaktiv: Stack, Profile mit Begründung, SemVer-Strategie, Umgebungskapselung = Pinning, Doku-Sprache. Weitere ADRs nur bei künftigen Entscheidungen | S |
| AP3 | **docs/VERIFICATION.md** (Verifikationsmatrix) | fehlt; QUALITY_GATES.md beschreibt Gates, aber ohne Evidenz-Referenzen | Matrix: Anforderung → Befehl/CI-Job → Ergebnis (Commit-SHA, CI-Run-ID). Mindestens: Build, Tests, Secret-Scan, Dependency-Audit, Rollback-Probe + je Profilpflicht ein Nachweis (SERVICE_API: checkWriteAuth-Tests, Rate Limits; UI: E2E + A11y; MONOREPO: Workspace-Grenzen) | M |
| AP4 | **docs/SECURITY-MODEL.md** | fehlt als Artefakt; Inhalte teilweise in ABUSE_PROTECTION/PRIVACY_STACK | Skizze (~1 Seite): Assets (Owner-Secrets, App-Check-Tokens, verschlüsselte Inhalte), Rollen (Owner/Teilnehmer/anonym), Trust-Boundaries (Client↔API↔Relay↔RTDB/Firestore; Client-seitiger Schutz vs. Server-Enforcement — bekannte Grenze: Relay-Yjs-Prüfung offen), Missbrauchsfälle, Aufbewahrung (24h-Expiry, GDPR-Delete). Verweist auf bestehende Doku statt sie zu duplizieren. Inkl. Privacy-Notiz (Datenklasse PII) | M |
| AP5 | **docs/RUNBOOK.md** + **Rollback-Probe** | fehlt als Einstieg; Teile in SECURITY_RUNBOOK + RELEASE_CHECKLIST; Rollback nie dokumentiert durchgespielt | RUNBOOK als Einstiegsdokument: Deploy-Weg, Rollback-Weg (Tag + Hosting-Rollback), Incident-Verweis auf SECURITY_RUNBOOK. **Rollback-Probe tatsächlich ausführen**: v1.4.0 in temporärem git worktree auschecken, setup + lint + test, Ergebnis in RUNBOOK + VERIFICATION.md, worktree entfernen | M |
| AP6 | **docs/FLAGS.md** | fehlt; Projekt nutzt keine Feature Flags (Modi Frei/Schutz/Sperre sind Produktfeatures, keine Flags) | Minimales Register: „derzeit keine Flags aktiv" + Regeln für künftige Flags (Typ, Owner, Ablaufdatum). Verhindert, dass Audits „FLAGS.md fehlt" melden | S |
| AP7 | **Secret-Scanning + CI-Härtung** | kein gitleaks; verify-Job ohne `permissions:`-Block; Actions per Tag (@v4/@v5) statt Commit-SHA gepinnt | gitleaks-Job in verify.yml; `permissions: contents: read` auf Workflow-Ebene; Actions auf SHA pinnen. Einmaliger Voll-Scan der Historie (read-only, Befund vor Fix melden) | S–M |
| AP8 | **Task-Verben** | Verben verstreut (kein `setup`); ops/verify_local.sh als De-facto-Einstieg | `npm run setup` ergänzen (npm ci + npx playwright install chromium); Verb-Mapping (setup/lint/test/build) in README + AGENTS.md dokumentieren. Prüfen: braucht der frische Clone eine .env? Falls nein → README-Satz „keine env vars nötig" | S |
| AP9 | **UI-Profil: A11y-Check** | 92 E2E-Tests, aber kein automatisierter Accessibility-Check, kein dokumentierter Tastatur-Smoketest | axe-core-Check des kritischsten Flows (Space öffnen → schreiben) in die E2E-Suite; manuellen Tastatur-Smoketest als Checkliste in docs (einmal durchführen, Ergebnis festhalten). Befunde werden gemeldet, nicht stillschweigend „mitgefixt" | M |

### 3.3 Bewusste Auslassungen (kein Over-Engineering)

- **Keine ENTERPRISE-Maschinerie**: kein SBOM, keine Build-Provenance, keine signierten Tags
  (keine Artefakt-Distribution an Dritte; Hosting-Deploy ist kein Paket-Release). Begründung kommt in ADR-0001.
- **Kein Devcontainer**: Pinning genügt für Solo-Betrieb.
- **Keine Pre-commit-Hooks** (optional nachziehbar): verbindliche Grenze ist die CI, Hooks wären nur Ergonomie.
- **Kein externer Flag-Service**: es gibt keine Flags.
- Bestehende Doku wird **nicht umgeschrieben oder verschoben** — neue Artefakte verweisen auf sie.

## 4. Umsetzungsplan

Umsetzung nach Freigabe im **CHANGE-DELIVERY-Modus** (kleinste Schnitte, ein logischer Schritt
je Commit, Beweis-Befehl je Behauptung, CHANGELOG-Pflege, keine fremden untracked Dateien anfassen):

1. **Phase A — Doku-Fundament** (AP1, AP2, AP6): AGENTS.md, ADR-0001, FLAGS.md. Kein Codeanteil, kein Risiko.
2. **Phase B — Sicherheits- und Evidenz-Artefakte** (AP4, AP3): SECURITY-MODEL.md, dann VERIFICATION.md
   (braucht die Artefakte aus A/B als Referenzziele).
3. **Phase C — Betrieb** (AP5): RUNBOOK.md + tatsächliche Rollback-Probe im Worktree.
4. **Phase D — CI/Toolchain** (AP7, AP8): gitleaks, CI-Härtung, setup-Verb. Einziger Teil, der CI-Verhalten ändert → eigener Commit je Schritt, CI-Lauf als Nachweis.
5. **Phase E — UI-Profil** (AP9): axe-Check + Tastatur-Smoketest.
6. **Abnahme**: KURZAUDIT (STANDARD-Tiefe) auf dem neuen Stand; Findings ggf. via
   CHANGE DELIVERY (AUDIT-REMEDIATION). Vor dem nächsten Release-Deploy: LANGAUDIT als Release-Gate.

Geschätzter Gesamtumfang: Phasen A–C reine Doku/Evidenz (~1 Session), D–E klein aber CI-/testrelevant (~1 Session).

## 5. Externe Kontrollen (Checkliste für den Nutzer, außerhalb des Repos)

- [ ] Branch Protection auf main; CI-Check `verify` als Required Check
- [ ] GitHub Secret-Scanning + Push Protection aktivieren
- [ ] 2FA für alle Accounts mit Schreibzugriff (verifizieren)
- [ ] Dependabot-Alerts aktiv (App-seitig prüfen)

## 6. Offene Entscheidungen vor Umsetzung

1. **Freigabe des Konzepts** insgesamt (oder Streichung einzelner APs).
2. Historien-Voll-Scan mit gitleaks in AP7: ja/nein (read-only; ein Befund würde zuerst gemeldet, nicht selbst „bereinigt").
3. Dieses Konzeptdokument nach Umsetzung ins Repo committen (dann ggf. englische Endfassung) oder als Arbeitsdokument löschen.
