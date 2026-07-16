# Accessibility Smoketest

Two layers (UI-profile requirement, see `docs/adr/ADR-0001-baseline-stack-and-profiles.md`):

1. **Automated** — `npm run test:e2e:a11y` (axe-core + keyboard-path assertions
   for landing page and editor; step 9/11 of `ops/verify_local.sh`). Gates on
   serious/critical axe violations; moderate/minor findings are logged as
   advisories. Automated checks catch only part of real accessibility issues,
   hence the manual checklist below.

2. **Manual keyboard smoketest** — run before releases that touch UI:

   - [ ] Landing page: `Tab` walks logo → create form → lock checkbox →
         info icon → footer links; focus is visible on every stop.
   - [ ] `Enter` in the create form creates a space without using the mouse.
   - [ ] Editor: `Tab` reaches toolbar buttons and the editor; formatting via
         toolbar works keyboard-only (focus button, `Enter`).
   - [ ] Mode switch (owner): segments reachable and switchable via keyboard.
   - [ ] Modals (QR/share): `Esc` closes, focus returns to the trigger.
   - [ ] Zoom 200%: no horizontal scrolling, no clipped controls.
   - [ ] Optional (before major releases): one pass with VoiceOver (macOS,
         `Cmd+F5`) over landing + editor: status announcements audible,
         no unlabeled buttons.

## Runs

| Date | Scope | Result |
|---|---|---|
| 2026-07-16 | Automated layer (axe + keyboard paths, Chromium) | green — 0 serious/critical; advisories: landmarks/region structure, no `<h1>` on editor page (logged, non-gating). Fixed on this date: 2× `aria-prohibited-attr` (`role="status"` on #status, `role="img"` on info icon), 1× `color-contrast` (hero-lock label opacity .55 → .8) |
| 2026-07-16 | Full checklist, scripted execution (Playwright/Chromium against the local emulator stack) | green 9/9: tab order + visible focus on every landing stop, keyboard-only space creation, keyboard toolbar formatting, mode-switch segments keyboard-operable, QR modal Esc-close with focus return, 200%-zoom reflow (landing + editor, 0px overflow). Findings fixed same day: `outline:none` without focus replacement on `input[type=text]` and `.hero-lock-info` (now `:focus-visible` outlines, also `.title`), and toolbar selection preservation was mouse-only (`mousedown`) — a `focusin` hook now saves the editor range for keyboard activation |
| open | VoiceOver pass (macOS, `Cmd+F5`) over landing + editor | **optional, genuinely manual — maintainer** (cannot be scripted) |
