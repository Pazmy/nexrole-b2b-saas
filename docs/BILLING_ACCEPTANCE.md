# Billing and audit acceptance handoff

Step 8.5 is complete: checkpoint 8.5.7 passed automated local acceptance, and 8.5.8 passed real Stripe sandbox acceptance with user-assisted hosted UI. No live-mode payment was made. The automated run did not create Stripe resources; the later sandbox run did, as documented below.

## Recorded result: 2026-09-29

- 180/180 Node tests passed, including disposable PostgreSQL concurrency and signed HTTP webhook integration.
- 6/6 Edge browser journeys passed in development (2.2 minutes) and 6/6 in production (53.5 seconds), with no skipped journeys.
- Full web ESLint, web TypeScript, database build, API build and production web build passed.
- All four migrations are applied. No new migration or application-code fix was required in this checkpoint.
- Stripe was disabled in browser tests. Production email used the explicit local Resend preload. No real Stripe or Resend delivery was tested.

## Reproduce automated checks

Run from the repository root with the local PostgreSQL database available:

```powershell
npm.cmd run build -w packages/database
node --test --test-concurrency=1 tests/*.test.cjs
npm.cmd run lint -w apps/web
npm.cmd run build -w apps/api
npx.cmd tsc --noEmit -p apps/web/tsconfig.json
```

From `packages/database`, run `npx.cmd prisma migrate status`. All four migrations must be applied, including `20260928000000_billing_audit_foundation`. For an unapplied deployment use `prisma migrate deploy`; schema push does not replace the migration's partial indexes and check constraints. Rebuild the shared database package and both services after deployment.

Database suites create disposable schemas and test real PostgreSQL constraints, transactions and races. Provider responses are controlled test inputs. Signed webhook tests exercise raw HTTP signature verification, current-state retrieval, receipt dispositions, duplicate delivery, delayed events, ownership conflicts, lease fencing, audit failure and retry. These tests do not contact Stripe.

## Browser acceptance

Use the process-only disabled Stripe sentinel described in [BILLING_UI_TESTING.md](BILLING_UI_TESTING.md). In a development server terminal, from the repository root:

```powershell
$env:NEXT_BUILD_DIR='.next-billing-acceptance-dev'
$env:NEXT_PUBLIC_APP_URL='http://localhost:3100'
$env:AUTH_TRUST_HOST='true'
$env:EMAIL_MODE='preview'
$env:STRIPE_SECRET_KEY='disabled-for-ui-test'
npm.cmd run dev -w apps/web -- --port 3100
```

In a separate test-runner terminal:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3100'
$env:PLAYWRIGHT_CHANNEL='msedge'
$env:E2E_BILLING_UI_DISABLED='true'
npm.cmd run test:e2e -w apps/web
```

The billing journey is opt-in: set `E2E_BILLING_UI_DISABLED` only when the target server actually has the disabled Stripe sentinel. Six journeys cover onboarding/recovery, billing, invitations, member management, tenant isolation and transactions. Tests create unique fixtures and remove their own tenants and email previews.

For production, stop the development server. Build from the root with `NEXT_BUILD_DIR=.next-billing-acceptance` and `NEXT_PUBLIC_APP_URL=https://localhost:3100`. Then start from `apps/web` with the same build directory and URL, plus:

```powershell
$env:AUTH_TRUST_HOST='true'
$env:EMAIL_MODE='resend'
$env:RESEND_API_KEY='re_e2e_preview'
$env:EMAIL_FROM='Nexrole <noreply@example.test>'
$env:STRIPE_SECRET_KEY='disabled-for-ui-test'
node --require ./e2e/helpers/resend-preview.cjs ../../node_modules/next/dist/bin/next start --port 3100
```

Run the same browser command with `E2E_RESEND_STUB=true` added in the runner terminal. The explicit preload captures fixture-only Resend requests locally, including simulated delivery failures. No email is delivered externally. These process settings and the preload are local test fixtures, not deployment configuration. Browser tests use local HTTP; generated HTTPS email links are resolved against the runner's local origin.

## Recovery and operational boundaries

- **Pending or uncertain checkout:** use Check billing status, then Continue checkout. The server reconciles and reuses durable attempts; a retry is not an instruction to create another subscription. Do not delete pending operations or manually change subscription status to unblock a purchase.
- **Overdue, unpaid, paused or incomplete subscription:** use Manage billing for the verified customer, then check status. Transaction writes remain restricted according to stored authoritative status; authorized membership and account recovery remain available.
- **Ownership/configuration conflict:** verify the configured account/mode, price and customer/subscription bindings. Legacy customers without trusted checkout evidence need operator review. Never adopt by email or select an arbitrary subscription.
- **Webhook retry:** transient failures leave pending receipts and return 503 so delivery can retry. A durable quarantine/ignored disposition returns 200 and requires investigation when unexpected. Redelivery after correction can retry pending receipts; a completed/quarantined receipt is not automatically reopened. Authenticated reconciliation retrieves current state independently.
- **Audit persistence failure:** critical local mutations roll back. Fix the database issue and retry through the application. A delivered but inactive invitation requires a new resend/token generation; external email cannot be rolled back.

See [the billing/audit contract](BILLING_AUDIT_CONTRACT.md) for event coverage, audit metadata and ownership rules, and [the UI journey](BILLING_UI_TESTING.md) for expected user-visible states.

## Checkpoint 8.5.8: real Stripe test-mode evidence

### Verification sequence (2026-09-29)

The following entries record intermediate states. The final result below supersedes earlier pending notes.

Read-only requests using the configured project test key succeeded: the configured Pro price is active, non-live, recurring monthly in USD. The default non-live Customer Portal configuration is active, permits payment-method updates, and allows cancellation at period end. This verifies account access and configuration, not payment or webhook delivery.

Started local web/API servers on ports 3000/5000 for interactive testing; the user's existing Stripe listener is left untouched. The user confirmed its signing secret matches the API configuration. Browser runtime discovery returned no available browser, so hosted Checkout/Portal actions require user assistance. No Stripe resource has been created by this checkpoint yet. Upgrade, failed payment, recovery, cancellation, delivery receipts and resulting audit/entitlement verification are still pending.

The user selected existing workspace **PT Demo Ns** for interactive verification. Read-only baseline: Free status, unverified billing sync, no Stripe customer/subscription binding, no previous billing operations, zero transactions and one active verified SuperAdmin. This is a user-owned workspace; preserve it and its user accounts during cleanup. Hosted checkout is the next step.

Upgrade verified: the user completed hosted test Checkout and reported ACTIVE without manual reconciliation. Direct Stripe reads confirmed one nonterminal subscription, active/non-live status, the configured Pro price with quantity one, and a paid invoice with zero remaining balance. The local workspace is active/synced; customer and checkout operations succeeded. A processed `invoice.paid` webhook applied the Free → Active change with one Stripe-sourced subscription audit; operation intent retained user attribution.

Two concurrent events (`customer.subscription.created`, `checkout.session.completed`) returned 503/lease_busy and remained pending while invoice reconciliation ran. Retrieved those original events from the Stripe API and passed them sequentially through the shared reconciler: both processed as state_unchanged, pending count became zero, and the subscription audit count remained one. This confirms application-level retry against real provider state, **not automatic CLI redelivery**. Payment failure, recovery, cancellation and interactive transaction permissions remain pending.

Payment failure was then exercised on the same test subscription. The user set card 0341 as default in the hosted portal; API verification confirmed a directly attached card rather than the previously selected Link method. The subscription uses flexible billing: resetting its anchor with proration disabled generated no new invoice. A recurring price was rejected as an additional invoice item (HTTP 400). The successful test used an idempotent subscription update with `always_invoice`, `allow_incomplete`, and a one-time inline USD 5 test item on the existing product. It produced an open invoice with USD 5 remaining, one attempted payment, and Stripe status `past_due`. This is a forced test invoice, not evidence of a naturally scheduled monthly renewal. The temporary inline price/test billing resources must be considered during final cleanup; preserve the existing product, configured recurring price, workspace and users.

Before 8.5.8, confirm usable test-mode credentials, the recurring Pro price, Customer Portal configuration, a running API/web application, and webhook delivery to `/api/webhooks/stripe` with the matching signing secret. Web and API must use the same account/mode and price. Never paste secret values into test evidence.

| Setting | Required location / purpose |
| --- | --- |
| `STRIPE_SECRET_KEY` | Web and API; usable test-mode account credential |
| `STRIPE_PRO_PRICE_ID` | Web and API; the same recurring Pro price in that account |
| `STRIPE_WEBHOOK_SECRET` | API; signing secret for the actual forwarding session or configured endpoint |
| `NEXT_PUBLIC_APP_URL` | Web build and runtime; application return URL |
| Customer Portal configuration | Stripe test account; enable the intended payment-method and subscription recovery/cancellation actions |

That checkpoint must verify hosted checkout and portal navigation, upgrade, payment failure, recovery, cancellation, resulting transaction permissions, webhook receipts and attributed audit records. Local mocked-provider success and a checkout return URL are not evidence of a successful real payment. Clean up only resources created for that test. This verification is now recorded below; whole-MVP release acceptance remains Step 8.6.

Payment-failure webhook verification: local status is past_due/synced. customer.subscription.updated processed state_updated; invoice.payment_failed processed state_unchanged. Stripe-sourced audit records Active -> Past Due exactly once. User-visible restriction and subsequent recovery remain to be checked.

The user confirmed the Past Due UI checks: Company Profile shows PAST DUE, transaction creation/changes are restricted, and Manage billing remains accessible. This is user-observed browser evidence; the agent independently verified the matching Stripe/database state and webhook audit. Next: hosted portal recovery using the successful test card and payment of the existing open test invoice.

Hosted recovery verified: the user made card 4242 default, paid the existing open test invoice through the portal, returned to the application and reported ACTIVE without manual status checking. Stripe confirms that subscription_update invoice is paid (USD 5, zero remaining), the same subscription is active, and only one nonterminal subscription exists. Local state is active/synced. invoice.paid processed state_updated; Stripe-sourced audit records Past Due -> Active once. Two concurrent subscription update receipts remained pending and were selected for sequential original-event replay through the reconciler, distinct from CLI redelivery. Transaction write restoration and cancellation remain to be checked interactively.

Cancellation verification: user created the pending USD 1 transaction named 8.5.8 recovery test, proving writes recovered; TRANSACTION_CREATED has user attribution. Hosted portal scheduled cancellation and the user observed ACTIVE with a schedule notice. Stripe/local cancel_at matched 2026-10-28T11:22:06Z, while cancel_at_period_end was false (explicit-date schedule); the UI correctly recognizes cancel_at independently. Schedule change has a Stripe audit without prematurely revoking Active access.

To verify effective cancellation without waiting a month, the agent canceled only this test-created subscription through Stripe with invoice_now=false and prorate=false after checking its durable Checkout binding. This is immediate API cancellation after testing the portal schedule, not observation of natural period-end expiry. customer.subscription.deleted processed state_updated, local state became canceled/synced, and audit records Active -> Canceled. Both test invoices are paid; the inline USD 5 one-time price is already inactive. Workspace, user accounts, configured recurring price/product, billing history and the single user-created recovery transaction are retained. Final canceled/Free-quota browser confirmation remains pending.

## Final result: 8.5.8 complete

The user confirmed final CANCELED status, Free usage of 1/10, retained recovery transaction and available transaction creation below quota. Independent checks confirmed canceled/synced local state and the processed customer.subscription.deleted webhook. Replaying the last delayed original subscription update returned state_unchanged: status stayed canceled, pending receipts became zero, and subscription audit count stayed five (upgrade, failure, recovery, schedule and cancellation).

The test subscription is canceled and will not renew. Both test invoices are paid, and the inline one-time USD 5 price is inactive. Retain the customer/subscription bindings, receipts, audit history, configured recurring price/product, workspace/users and recovery transaction as verification evidence. No existing user resource was deleted.

Limitations: payment failure used a forced subscription invoice, effective cancellation used the API after validating the hosted cancellation schedule, and concurrent pending receipts needed explicit original-event replay through the shared reconciler. Natural monthly renewal/expiry and automatic CLI retry were not observed. Hosted UI observations came from the user because no agent browser was available. No new application code or schema was changed during real-provider verification; automated 8.5.7 results remain the regression baseline. Step 8.6 is not started.
