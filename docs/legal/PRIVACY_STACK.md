# Privacy Stack

This file maps the running malziSPACE stack to the Google/Firebase services that are actually in use, so privacy documentation can be updated from facts instead of assumptions.

## Verified project resources

Verified against the live project:

- Cloud Firestore database: `(default)` in `eur3`
- Realtime Database instance: `malzispace-default-rtdb` in `europe-west1`
- Firebase Functions v2: `api`, `cleanupExpired` in `europe-west3`
- Cloud Run relay: `malzispace-collab` in `europe-west3`

## Web client services in use

- Firebase App
- Firebase App Check
- custom proof-of-work provider for Firebase App Check

## Firebase/Google services not currently used by the web app

- Firebase Authentication
- Google Analytics / GA4
- Firebase Crashlytics
- Firebase Messaging
- Google Tag Manager
- ad / pixel trackers

## Operational implications

- Content remains end-to-end encrypted before it is sent to backend storage.
- The backend still processes technical metadata required for transport, synchronization, expiry, origin checks, rate limits, and abuse protection.
- App Check on the web currently uses a custom proof-of-work flow served from the same backend; no reCAPTCHA script is loaded on the public pages.

## Update rule

Whenever a Google/Firebase product is added, removed, or moved to another region:

1. update this file
2. update `apps/web/public/privacy.html`
3. update the release checklist if the change affects live verification
