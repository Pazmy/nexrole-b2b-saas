# Billing and audit contract — 8.5.1

This document records the 8.5 contract and sequential checkpoint evidence. Checkpoints 8.5.1-8.5.8 are complete: persistence, billing backend, webhook reconciliation, scoped mutation audit coverage and billing UI recovery are implemented. Automated acceptance and real Stripe sandbox acceptance passed. See [the acceptance handoff](BILLING_ACCEPTANCE.md) for evidence, commands and explicit test boundaries. Earlier checkpoint notes describe the state at that checkpoint.

## Integration findings

- Installed Stripe SDK: **22.3.0**. Both clients and the installed SDK use **2026-06-24.dahlia**. Keep this version pinned.
- Installed `stripe/esm/resources/Invoices.d.ts` defines `parent.subscription_details.subscription` as a string or expanded Subscription, with `parent.type === subscription_details`. The current webhook's top-level `subscription_details` cast is incompatible. Replace it in 8.5.4; invoice metadata does not establish ownership.
- Root/web environment values match for the secret key, price and webhook secret; the API key has a test prefix. No remote validity, recurring price, destination API version or portal configuration has been verified. No secrets are recorded here.
- No additional Stripe access is needed yet. Real test-mode verification requires a usable recurring Pro price, portal configuration, and forwarding/delivery to `/api/webhooks/stripe` with the matching signing secret. Tell the user when remote verification or missing configuration is needed; do not switch to live mode.

Stripe documents unordered/duplicate delivery, equal event timestamps and independently versioned event payloads. See [webhook delivery/versioning](https://docs.stripe.com/webhooks#event-delivery-behaviors). The installed SDK types are the concrete payload contract for this pinned integration; use the [invoice reference](https://docs.stripe.com/api/invoices/object) alongside them.

## Entitlement policy

These are application decisions preserving 8.3:

| Status | Transaction creation | Status updates | Billing route |
| --- | --- | --- | --- |
| free | Up to 10 stored transactions | Allowed | New checkout after reconciliation |
| active, trialing | Unlimited | Allowed | Manage existing subscription |
| canceled | Free quota; retain history | Allowed | New checkout after confirming terminal state |
| incomplete_expired | Denied | Denied | New checkout after confirming terminal state |
| incomplete, past_due, unpaid, paused | Denied | Denied | Recover existing subscription; no second checkout |
| Missing, unknown or conflicting state | Denied | Denied | Reconcile; never infer Pro |

Normal role permissions still apply. Reads, account recovery, membership/invitation management and billing recovery stay available to eligible users. Quota is stored count, not monthly usage. At the Free limit, existing pending transactions may still be completed/failed.

Period-end cancellation follows authoritative subscription status until canceled; its schedule is separate presentation data. `pause_collection` is not the same as `paused` status. Retain card-only checkout; no new payment methods or tiers. Provider semantics: [subscription lifecycle](https://docs.stripe.com/billing/subscriptions/overview).

## Customer and checkout ownership

1. Derive tenant/actor from fresh verified membership; only SuperAdmin manages billing. Recheck after lock waits. Never accept ownership identifiers from forms.
2. Reuse the unique persisted customer binding. Never adopt customers by email alone. Metadata corroborates ownership but cannot replace stored bindings. Legacy subscribed tenants missing mappings, multiple subscriptions or mode/account conflicts require reconciliation rather than choosing the first match.
3. Reserve customer/checkout operations under the tenant lock using stable operation/idempotency keys; call Stripe outside database transactions. Compare-and-set the reserved operation before committing results and audit. Recover interrupted attempts before starting another.
4. Track one canonical subscription per tenant. Nonterminal subscriptions block new checkout even if overdue/incomplete. Offer supported portal/payment recovery, or an explicit recovery error if the portal cannot perform the required action.
5. Only one unresolved checkout per tenant. Resume an open session only after verifying its customer, subscription mode, configured price, status and expiry. A completed checkout must be reconciled. A browser cancellation redirect does not prove expiry. Unknown/time-out outcomes stay unresolved.
6. Retry a stable key with identical parameters. Stripe can prune idempotency keys after at least 24 hours; inspect provider resources before recreating an old ambiguous attempt. See [idempotent requests](https://docs.stripe.com/api/idempotent_requests).
7. Before new checkout, reconcile current customer subscriptions and outstanding attempts. Bind a new subscription only through a verified stored checkout/customer relationship with the expected recurring price. Old subscription events cannot replace a newer canonical subscription. Success URL parameters never grant Pro.

`packages/database/billing-rules.ts` provides pure checkout decisions, invoice-reference extraction and exact customer/current-subscription matching. Inputs must already be reconciled and trusted. These helpers do not authorize, lock or call Stripe; export/integrate them in later persistence/backend checkpoints.

## Webhooks and reconciliation

Handle these triggers:

- `checkout.session.completed`, `checkout.session.expired`: resolve tracked checkout and resulting subscription.
- `customer.subscription.created`, `.updated`, `.deleted`, `.paused`, `.resumed`: reconcile canonical status and cancellation schedule.
- `invoice.paid`, `invoice.payment_failed`, `invoice.payment_action_required`: resolve subscription/customer and retrieve current subscription status. A historical failed invoice cannot overwrite recovery; an old paid invoice cannot reactivate a canceled subscription.

Preserve raw-body signature verification. Check event mode against configuration. For supported events with a different payload version, retrieve the referenced resource with the pinned API before version-specific extraction. Do not fall back to legacy tenant metadata. Unrelated invoices and unsupported events can be acknowledged as ignored with a reason.

Use a durable per-tenant billing lease with a monotonically increasing fencing version: acquire under the tenant lock, fetch authoritative Stripe state outside the transaction, then reacquire the tenant lock and verify lease owner/version and customer/subscription bindings before committing. Expired/replaced lease holders cannot commit stale fetches. Competing deliveries remain retryable. Event timestamps are diagnostic, not an ordering gate.

Event ID uniqueness, local billing updates, mandatory system audit and completed receipt commit atomically. Duplicate applied IDs return success without repeating effects. Different IDs reporting unchanged canonical state can have separate receipts but no duplicate business state-change audit. Legitimate later transitions remain auditable.

Invalid signatures return 400. Transient provider/database errors, busy leases and expected checkout events racing their local binding return retryable non-2xx responses and are not marked completed. Permanent ownership conflicts never mutate a tenant; record a quarantined/ignored disposition and operational reason. Known unrelated accounts can be ignored. Bound synchronous work; until a durable worker exists, do not acknowledge unapplied work merely to meet a timeout. Provide authenticated/manual reconciliation for interrupted operations/exhausted retries; no in-memory-only background work.

## Audit contract

Capture verified actors before session invalidation. User actions record actor ID and optional email snapshot. Webhooks explicitly use a system source/provider event ID rather than impersonating a user. Invitation acceptance records the newly created user in the same transaction. Tenant attribution comes from verified ownership.

| Family | Required semantic records | Allowed detail |
| --- | --- | --- |
| Transactions | Created; status changed | Target ID, amount/currency, old/new status |
| Members | Role changed; deactivated | Member ID, old/new role or active state |
| Invitations | Created; resent/replaced; revoked; accepted; delivery outcome | Invitation/member ID, role, expiry, outcome code |
| Profile | Updated | Tenant ID, old/new company name |
| API keys | Created; revoked | Key record ID/name only |
| Billing interaction | Customer binding; checkout and portal requested/resolved | Operation/provider object IDs |
| Billing reconciliation | Status/schedule changed | Event/operation ID, customer/subscription ID, before/after status/schedule |

Use typed allowlisted metadata, not request/provider payload dumps. Exclude passwords, raw tokens and hashes, API keys, authorization headers, signing secrets, payment details and checkout/portal bearer URLs. IP/user-agent are optional bounded context; trust only the deployment-configured proxy header. Sanitize failure codes instead of persisting raw exceptions.

Critical local changes and mandatory audit insert share a transaction. Audit failure rolls back the change, including sessionVersion increments and invitation consumption. Existing best-effort logging does not satisfy this. Denied operations must not appear as successful mutations.

For external effects, persist intent before calling the provider; record outcome using a stable operation ID and unique phase. Failure to persist the final outcome cannot undo an email or Stripe resource: leave a durable unresolved attempt, return an unconfirmed outcome and reconcile without blindly repeating the call. Distinguish requested, confirmed, failed and unknown. Invitation replacement tokens remain inactive until activation and audit commit together; after interrupted delivery an explicit resend rotates again, never reactivating an old token. No raw email token needs to be retained for recovery.

## Minimal persistence requirements for 8.5.2

- **Tenant:** nullable unique canonical subscription ID, cancellation schedule needed by the card, sync state, lease owner/expiry and fencing version. Retain existing customer/status.
- **Durable operations:** tenant/actor, kind, stable operation/idempotency key, provider object ID, state, safe outcome code, timestamps and parameter fingerprint. Enforce one unresolved customer/checkout operation per tenant per kind. Invitation delivery is tied to an invitation generation without bearer material.
- **Event receipts:** extend the existing event-ID table with type/mode, resource/customer/subscription/tenant references where known, disposition and processing timestamps. Pending differs from completed. Preserve legacy completed receipts; do not store entire provider payloads.
- **AuditLog:** retain existing rows/nullable actors; add explicit actor source and optional unique operation/phase attribution for retry deduplication. Do not invent actors for legacy records.
- Defaults preserve existing tenants, roles, transactions and billing states. Migrations never contact Stripe or silently attach subscriptions. Missing legacy mappings are reconciled afterward. Validate migrations against populated fixtures and uniqueness under real concurrency. Final column names are decided in 8.5.2; these invariants are fixed.

## Checkpoint 8.5.1 verification and boundary

Seven new pure contract tests plus existing transaction rules and access regressions passed: **35 tests total**. Standalone TypeScript checking of the new module passed. No application flow is switched yet; no migration, database mutation, UI change or remote Stripe account request occurred. Next: **8.5.2 only**.

## Checkpoint 8.5.2: implemented foundation

Migration `20260928000000_billing_audit_foundation` adds:

- Tenant canonical subscription ID, cancellation schedule, sync status, lease owner/expiry and a monotonically increasing billing version. Legacy customer/status values remain intact; subscription mappings start null and sync status starts unverified.
- ExternalOperation with a stable unique idempotency key, SHA-256 parameter fingerprint, safe outcome code, provider reference and explicit pending/unknown/open/succeeded/failed/expired states. Terminal states require a resolved timestamp. Invitation delivery references a unique invitation/generation pair without retaining bearer tokens.
- Partial unique indexes allowing at most one unresolved customer operation and one unresolved checkout operation per tenant. These SQL-only indexes and check constraints must be preserved by subsequent migrations; schema push is not a replacement for migration deployment.
- Event receipt references, disposition and timestamps. Existing receipts remain processed with their original creation time as processing time. New handlers must explicitly insert pending receipts before completing them; the legacy processed default keeps existing callers compatible.
- Explicit audit sources and optional operation/phase deduplication. Existing audit rows retain their metadata and receive the legacy source. A composite foreign key prevents an audit from referencing another tenant's operation.

### Shared audit writer

`writeRequiredAudit(tx, input)` is exported by @nexrole/database. The service must authorize the action and capture its actor before mutation, then invoke this writer inside the same Prisma transaction as the business update. It validates tenant-scoped user attribution or an explicit system source and action-specific metadata. It intentionally accepts an actor deactivated by that transaction. Authorization and target ownership still belong to the service.

Do not catch AuditPersistenceError inside the transaction and then commit. The error contains no raw database diagnostic. An audit failure must escape the transaction to roll back business changes, including session invalidation. Unknown metadata fields are rejected; secrets, provider payloads and bearer URLs have no allowed fields.

An operation and phase identify a retryable audit record. Concurrent identical retries return the existing record; conflicting contents fail. External calls still require a committed intent before the call and a separately committed outcome afterward. This checkpoint supplies storage and audit primitives; it does not implement provider calls or claim that external effects can be rolled back.

### Verification and next boundary

All 13 PostgreSQL foundation checks and 106 existing/pure-rule regression tests passed (119 total). Tests cover populated legacy migration, concurrent reservations, operation ownership, stale fencing updates, audit deduplication, real database audit failure and rollback, and tenant deletion with linked operations/audits. Database/API builds, web type checking and the production web build passed. The local migration was applied successfully; migration status is current and tenant/audit/receipt counts remain unchanged.

No UI or production service flow was switched. Existing best-effort application audit logging remains until 8.5.5. Next continuation starts 8.5.3 only. No remote Stripe account request has been made.

## Checkpoint 8.5.3: customer, checkout and portal backend

The existing billing Server Actions now delegate to the shared BillingService through a server-only Stripe adapter. They accept no tenant/customer/subscription identifiers from forms. The authenticated actor is rechecked against active, verified SuperAdmin membership and session version after acquiring each tenant lock. A two-minute durable lease with an incrementing version serializes provider work; finalization verifies the lease, its expiry and the original customer/subscription binding. Provider calls happen outside database transactions.

Customer creation reserves a durable operation and required audit before calling Stripe. It uses operation metadata and a stable idempotency key, without email matching or mutable profile parameters. Existing customer bindings must retrieve a non-deleted resource in the configured mode; conflicting ownership metadata fails closed. A subscribed legacy tenant missing a verified customer binding requires reconciliation. No email-based adoption remains.

Before checkout, the service scans all customer subscriptions and outstanding checkout sessions. A nonterminal canonical subscription routes to the portal; ambiguous/multiple/unmapped subscriptions block a new purchase. Canceled or incomplete-expired subscriptions permit a new checkout only after provider verification. This backend never grants entitlement from redirect parameters or updates canonical subscription status itself.

Open attempts resume only after checking customer, mode, tenant/operation reference, configured price, quantity, provider status and expiry. Completed sessions require the next checkpoint's reconciliation. Provider-confirmed expired sessions close the old operation before another is reserved. A browser cancellation or locally elapsed timestamp alone never releases the slot. Untracked open sessions block creation.

Stable idempotency keys and fingerprints preserve parameters across retries and different administrators. Changing the key/account, app URL or price while an applicable operation is unresolved requires reconciliation. A lost checkout response can be recovered through the customer's session list and durable operation reference. The service stops blind key replay at 23 hours, leaving a margin before Stripe's documented minimum retention: [idempotent requests](https://docs.stripe.com/api/idempotent_requests). Old customer attempts can recover only from exactly one provider resource matching their durable tenant/operation reference; absent or ambiguous search results remain unresolved. Old ambiguous portal attempts also require reconciliation because the adapter cannot retrieve the original session.

The adapter follows SDK pagination for subscription/session scans, bounded to 500 resources; reaching the bound fails closed instead of trusting an incomplete result. See [list checkout sessions](https://docs.stripe.com/api/checkout/sessions/list) for customer-scoped recovery. The existing card-only recurring price, profile return URLs and pinned 2026-06-24.dahlia API version are retained.

### Failure and audit behavior

Every external creation has committed intent/requested audit first. Binding customer and recording operation outcome/required audit commit together. Audit or database failure after a provider call leaves a pending/unknown durable attempt; retry inspects/reuses that attempt rather than assuming Stripe rolled back. Raw provider exceptions, secrets and bearer URLs are not written to operations or audit. URLs are returned only after successful finalization and are restricted to HTTPS checkout.stripe.com or billing.stripe.com.

Permission changes during provider work prevent returning a redirect; another current administrator can recover the durable attempt. Busy, reconciliation-required, configuration and unavailable errors carry safe messages/codes. Existing buttons still use their Server Actions; structured UI error feedback is deferred to 8.5.6. Checkout/portal do not depend on transaction write entitlement; portal recovery does not require a Pro price value.

### Verification and next boundary

All **142 tests passed**: 19 backend PostgreSQL checks, 4 Stripe adapter checks, and 119 foundation/regression checks. Coverage includes concurrent administrators/customer creation, lock-wait role changes, stale sessions, cross-tenant actors/resources, timeout recovery, old-key recovery, expiration, completed checkout blocking, subscription states, stale lease responses, required-audit rollback, redaction and action transport. Web lint, database/API builds, web type checking and a production web build passed.

No additional migration, UI redesign, remote Stripe API call or webhook lifecycle change was made. The current webhook still awaits 8.5.4; the overall billing feature is not ready for end-to-end acceptance yet. Next continuation starts **8.5.4 only**, including canonical subscription binding, fenced webhook reconciliation and recovery for completed/ambiguous operations. Wider mutation audit wiring remains 8.5.5. Real Stripe test-mode acceptance remains 8.5.8; account access was not needed for this checkpoint.

## Checkpoint 8.5.4: webhook lifecycle and reconciliation

The Express route now verifies the original raw request body and Stripe signature, then delegates to BillingReconciler. Invalid signatures/tampering return 400 without a receipt or provider lookup. Signed supported events create a pending receipt before external reads. Unsupported events and unrelated invoices/customers receive ignored dispositions; wrong mode/connected-account events and permanent ownership conflicts are quarantined with safe reason codes. Duplicate completed receipts return success without repeating work. Existing legacy completed receipts retain their original meaning.

The reconciler retrieves referenced resources through the SDK pinned to 2026-06-24.dahlia, regardless of event payload version. Invoice subscription references come from parent.subscription_details.subscription (string or expanded object). Invoice failure/paid/action-required events trigger a current subscription read, rather than setting status from the event name. Subscription create/update/delete/pause/resume and checkout completed/expired events use the same path. This follows the documented versioning and ordering behavior: [Stripe webhooks](https://docs.stripe.com/webhooks), [invoice reference](https://docs.stripe.com/api/invoices/object).

### Ownership, ordering and atomicity

Tenant selection uses the unique stored customer binding. Metadata corroborates ownership but never chooses/adopts a tenant. A new canonical subscription requires a complete checkout tied to that tenant's durable operation, the same customer/mode, subscription checkout mode, the configured recurring price and quantity one. A nonterminal canonical subscription cannot be replaced. Events for superseded subscriptions are ignored; legitimate replacement checkout can bind after the previous canonical subscription is provider-confirmed terminal. Multiple competing or untracked subscriptions require review.

Provider reads run outside database transactions while a two-minute tenant lease is held. Commit takes the tenant lock and verifies lease owner/version/expiry and both original billing bindings. Lost/replaced leases return a retryable result rather than committing an old read. Manual recovery also rechecks membership/session version. Event timestamps do not order writes. Reconciliation shares lease fields with checkout/portal, so a busy workspace remains retryable.

Billing status, canonical ID, cancellation schedule, checkout resolution, mandatory audit and completed receipt commit together. Required-audit failure rolls all local effects back; the pending receipt remains eligible for retry. A different event reporting unchanged state gets its own receipt but no duplicate state-change audit. Scheduled cancellation retains the provider status until actual cancellation; canceled status restores the existing Free quota. Audit includes old/new subscription/status/schedule and explicit Stripe event attribution, or the verified administrator for manual recovery. Malformed legacy status text is represented as unknown in allowlisted audit metadata.

Reads are bounded: 30 provider operations with a 45-second admission budget per reconciliation; SDK requests use a ten-second timeout with at most one network retry. Paginated provider scans stop at 500 resources or a twenty-second scan budget (checked between returned items); up to one in-flight SDK request can overrun that budget. No unfinished billing work is acknowledged as processed or dispatched to an in-memory background worker. Exhausted scan/work budgets leave a retryable event and require operational review if they recur.

### Recovery without a new purchase

1. For pending receipts after timeouts, database errors, busy leases or a customer-binding race, redeliver the same event. The route returns 503 until authoritative work can commit. Never manually mark a pending receipt processed merely to stop retries.
2. An administrator retrying the existing checkout action first runs authenticated reconciliation. Completed tracked checkout can now bind its subscription and route subsequent checkout requests to the existing subscription's portal. Verified expired attempts release their slot; open attempts remain resumable. Unknown attempts with no provider evidence stay unresolved.
3. The backend also exposes reconcileBillingAction for authenticated recovery; it accepts no ownership IDs from a form. Its dedicated UI control/feedback is scheduled for 8.5.6. This action only reconciles provider reads; it does not create charges or subscriptions. A successful manual sync does not erase historical quarantined receipts.
4. Quarantined ownership/mode/price conflicts and legacy subscriptions lacking trusted checkout evidence require operator review. Neither automatic nor manual reconciliation adopts the first subscription or a customer matched by email. Restore verified mappings/configuration before retrying recovery. Old customer/portal ambiguity retains the conservative 8.5.3 behavior; absence from a provider response is not proof an external creation failed.

The API must receive STRIPE_PRO_PRICE_ID from the same account/mode as the web app, in addition to its signing secret. Compose now forwards that price. Its image builds the shared database package before the API so fresh checkouts do not depend on locally generated artifacts. No migration was added.

### Verification and next boundary

All **162 tests passed**, including 20 signed HTTP/PostgreSQL reconciliation checks and the previous 142 regressions. New checks cover real Stripe SDK signature validation, body/timestamp tampering, both checkout/subscription orders, duplicate/concurrent/equal-timestamp delivery, invoice version shape, payment recovery, cancellation/pause/resume, superseded subscriptions, binding races, provider/audit failures, foreign ownership, expired lease fencing, manual membership changes and resulting transaction entitlement decisions. SDK transport data is controlled; these tests do not contact a Stripe account.

Web lint, database/API builds, web type checking, the production web build and migration status passed. Existing UI layouts/components were preserved. Next continuation starts **8.5.5 only**; 8.5 overall is not complete. Real Stripe test-mode acceptance remains 8.5.8, and no Stripe account access was required here.

## Checkpoint 8.5.5: mutation audit coverage

All mutation families in the agreed audit matrix now use writeRequiredAudit inside their business transaction:

| Mutation | Audit record and atomic effects |
| --- | --- |
| Transaction creation/status | Target ID, normalized USD amount/initial status, or pending-to-terminal transition; failed audit rolls back the row/change. |
| Member role/deactivation | Target ID and before/after role or active state; sessionVersion changes roll back with audit failure. The verified initiating actor remains attributable after self-deactivation/demotion. |
| Invitation creation/resend | Durable generation-specific delivery intent first; MEMBER_INVITED or INVITATION_RESENT is recorded only when token activation commits. |
| Invitation revoke/acceptance | Deletion/consumption and audit commit together. Acceptance records the newly created verified member as actor; audit failure restores the invitation and rolls back that member. |
| Company profile | Locked before/after name; unchanged-name retries do not create another audit. |
| API keys | Record ID/name only; generation/revocation roll back if audit fails. Repeated revocation of a missing key does not create another audit. |

Profile and API-key actions now recheck active verified membership, role and session version after tenant lock waits, retaining locks until commit. Names supplied for new profile/key mutations are bounded to 256 characters to match the audit allowlist. Historical names exceeding that bound are clipped in audit snapshots so administrators can still repair a profile or revoke an old key; an empty legacy name uses the explicit (unnamed) marker.

The web audit helper was repurposed: it exports the required shared writer and a transaction helper for freshly authorized actors. The old session-reloading, best-effort logger was removed because it swallowed audit failures and ran outside business transactions. Existing UI components/layouts and action return contracts were preserved. No audit-history UI or new migration was added.

### Invitation delivery and recovery

Reservation commits the expired replacement token, an ExternalOperation tied to a random invitation generation, and an INVITATION_DELIVERY/requested audit. The operation fingerprint contains approved request attributes and generation, never the raw token or token hash. Resends invalidate the previous token in that transaction; if intent audit fails, the previous invitation remains unchanged and the provider is not called.

After the provider accepts the email (or local preview is written), activation, the semantic create/resend audit, confirmed delivery audit and operation outcome commit together. The two completion phases are unique per operation. A late older send cannot activate a newer generation. Provider acceptance is not proof of inbox delivery; live delivery verification remains separate.

If sending throws, its external outcome is unknown. Outcome audit and cleanup commit together when possible: failed creates may be deleted using the exact token compare-and-set, while failed resends stay expired. If that cleanup audit also fails, durable pending intent and the expired row remain. No usable replacement link is left behind.

If sending succeeded but activation failed, the service records delivered_inactive as an explicit system outcome when possible. A succeeded external operation with that outcome means provider acceptance was recorded, not that the invitation activated. If outcome persistence also fails, the operation stays pending. The UI receives a safe unconfirmed-activation error; refresh and explicitly resend to rotate again. Never reactivate an old token or blindly repeat the old send after a crash. Actor revocation or invitation replacement/revocation during delivery cannot be bypassed by system outcome recording.

A successful delivery path records a requested phase attributed to the initiating administrator, an activated phase for the semantic invitation mutation, and a confirmed phase from email_delivery. No passwords, raw tokens, token hashes, API credentials, provider payloads or bearer URLs are copied into audit. Cross-tenant/denied mutations emit no successful business-change audit. Existing tests now exercise the real audit writer instead of stubbing it out.

### Verification and next boundary

Run `npm run build -w packages/database` followed by `npm run test:audit:db`. The new suite has **15 passing checks**, using migrated disposable PostgreSQL schemas and real database triggers to force audit failures. It covers each mutation family, rollback of session/data/token consumption, self-actor attribution, stale permissions after lock waits, repeat/no-op behavior, redaction, invitation generation races and email acceptance followed by failed activation. All **177 tests passed**, including 162 earlier regression checks. Web lint, web type checking and database/API/production-web builds passed.

No live Stripe or Resend request was made. Account registration/password recovery audit is outside the agreed mutation matrix for this checkpoint; existing account security behavior remains covered by regressions. Browser acceptance is scheduled for 8.5.7. Next continuation starts **8.5.6 only** (billing UI and recovery journey).

## Checkpoint 8.5.6: billing UI and recovery

The existing profile and banner now present shared transaction policy alongside persisted billing state. Admin-only checkout/portal controls use structured safe results; synchronization reloads authoritative data with optional workspace/actor-scoped feedback. A checkout return parameter is an unconfirmed notice only. Missing/ambiguous legacy mappings require review; portal access still depends on fresh server authorization and verified customer ownership. Provider identifiers, credentials and persisted operation payloads are not passed to client components. See [BILLING_UI_TESTING.md](BILLING_UI_TESTING.md) for the journey, preserved design and explicit local-test limitations. No new schema change or real provider call in this checkpoint.
