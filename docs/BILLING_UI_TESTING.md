# Billing UI and recovery (8.5.6)

The existing Company Profile card, status badge, upgrade section, legal-name form, read-only notice and dashboard banner are preserved. Billing rendering and event handlers now live in `BillingPanel.tsx` inside the original profile form. Buttons use `type="button"` so billing recovery never submits a profile edit. The upgrade description now describes the implemented transaction allowance rather than promising unlimited audit-log access.

## Manual journey

1. Sign in as a verified SuperAdmin and open Settings → Company Profile. Check the stored subscription status, transaction count and allowance.
2. A Free workspace can upgrade. At ten stored transactions it cannot create another transaction, but existing Pending transactions can still be updated. Active and trialing subscriptions have the Pro allowance. Canceled subscriptions return to Free limits.
3. Incomplete, incomplete-expired, past-due, unpaid, paused and unknown statuses restrict transaction writes. Workspace reads, account recovery and authorized membership/billing management remain accessible.
4. Use **Upgrade Workspace Account** to request checkout. An unresolved checkout shows **Continue checkout** and a pending notice. The backend reconciles first and decides whether to resume, create, route to the portal or require review. UI visibility is not authorization.
5. Returning with `billing_success=true` shows an unconfirmed-return notice. The URL never changes entitlement. Use **Check billing status** to retrieve authoritative provider state. A successful check reloads the page; optional five-minute feedback is scoped to the workspace and actor. The resulting status can still be Free or restricted.
6. For a bound customer, **Manage billing** opens a verified portal session. It remains available during payment restrictions or a reconciliation conflict. Configuration, busy, ambiguous and unexpected failures are shown inline; retry or refresh instead of assuming payment succeeded.
7. Scheduled cancellation displays its UTC date, when known, or the end-of-period notice. The stored current status governs access until authoritative reconciliation changes it.
8. Sign in as a Member or Developer. Billing status is readable, but management buttons are absent and the original profile read-only controls remain. Server authorization also rejects forged billing actions.

## Automated local UI verification without Stripe

Use an already migrated local test database and build `packages/database` first. Start a development web server with `EMAIL_MODE=preview`, the matching `NEXT_PUBLIC_APP_URL`, and **process-only** `STRIPE_SECRET_KEY=disabled-for-ui-test`. Do not replace your saved credentials. This deliberately invalid sentinel makes billing actions fail before any Stripe request.

From the repository root, in a separate PowerShell session:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3100'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:E2E_BILLING_UI_DISABLED='true'
npm.cmd run test:e2e -w apps/web -- e2e/billing-management.spec.ts
```

The journey creates isolated verified admin/member fixtures, checks all known lifecycle states, Free quota, pending checkout, cancellation, conflict, inline configuration errors, the preserved profile-save action, account/membership recovery routes and a forged success URL. It removes its own tenant fixtures afterward. Screenshots are written under `apps/web/test-results`.

Production verification uses a fresh `NEXT_BUILD_DIR`, an HTTPS `NEXT_PUBLIC_APP_URL` at build time, and the same directory at startup. Local HTTP browser testing additionally uses `AUTH_TRUST_HOST=true`. Production startup requires `EMAIL_MODE=resend`, `RESEND_API_KEY` and `EMAIL_FROM`; this journey uses dummy process-only email settings and sends no mail. Set the disabled Stripe sentinel at startup as well. These fixture settings are for local verification only.

Also run `test:billing:rules`, `test:access` and `test:transactions:db`. Shared backend suites cover successful reconciliation and provider operations with controlled responses. This UI checkpoint verifies rendering and unavailable-configuration recovery; it does **not** verify hosted Checkout/Portal navigation, real payments or webhook delivery. Full automated acceptance remains 8.5.7; real Stripe test-mode verification remains 8.5.8.
