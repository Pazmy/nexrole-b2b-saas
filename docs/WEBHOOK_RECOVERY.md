# Stripe webhook recovery

Reviewed for checkpoint 8.6.4 on 2026-09-29. This is an operator procedure for the existing implementation, not evidence that a deployed endpoint or automatic retry has been exercised. The application has no scheduled receipt-recovery worker. Local signed HTTP tests use a fixture provider; real sandbox recovery in 8.5.8 used explicit original-event replay through the shared reconciler.

## Establish the destination

Use the intended Stripe account and mode. For a deployed API, register a public HTTPS snapshot-event destination at `/api/webhooks/stripe`. The API must use that destination's signing secret, matching Stripe credentials and the configured Pro price. A local CLI listener's secret is separate from a registered destination's secret. Never copy secrets into incident notes or commands committed to Git.

Subscribe to the events supported by `packages/database/billing-reconciliation.ts`:

```text
checkout.session.completed
checkout.session.expired
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
customer.subscription.paused
customer.subscription.resumed
invoice.paid
invoice.payment_failed
invoice.payment_action_required
```

Record the account/mode, destination ID, application revision and affected event IDs. Verify the destination points to the intended deployment before resending. Stripe documents automatic retries and manual redelivery for registered destinations; those delivery guarantees are not established by a local CLI listener test. See [Stripe delivery behavior](https://docs.stripe.com/webhooks#event-delivery-behaviors).

## Diagnose before retrying

In Stripe Workbench, inspect the destination's Event deliveries and the response for the affected event. Correlate its `evt_...` ID with API logs and the receipt table. Use your authenticated database console against the intended environment; these are read-only queries:

```sql
SELECT id, "eventType", "tenantId", disposition, "reasonCode",
       "createdAt", "updatedAt", "processedAt"
FROM processed_stripe_events
WHERE disposition IN ('pending', 'quarantined')
ORDER BY "createdAt", id
LIMIT 100;

SELECT id, "subscriptionStatus", "billingSyncStatus",
       "stripeCustomerId", "stripeSubscriptionId", "billingLeaseExpiresAt"
FROM tenants
WHERE id = '<affected-tenant-uuid>'::uuid;
```

Do not rely solely on tenant filtering: a failure before ownership resolution can leave a receipt with no tenant ID. Retry reasons for pending events are in API logs; `reasonCode` is generally written when a final disposition is recorded. A failure before receipt insertion can leave no row at all.

| Result | Meaning and next action |
| --- | --- |
| HTTP 400 | Signature/raw-body verification failed. Check routing, the destination secret and raw-body preservation; do not disable verification. |
| HTTP 503 / `lease_busy` or `lease_changed` | Competing work is still running or superseded this fetch. Let it finish, then resend sequentially. Leases are 120 seconds; a crashed owner may require waiting for expiry. Do not clear leases manually. |
| HTTP 503 / other reason | Check database/audit availability, Stripe connectivity, credentials and price configuration. Resolve the logged cause before redelivery. Repeated failures remain an open incident. |
| HTTP 200 / `processed` | Reconciliation completed; verify the current tenant state and audit. |
| HTTP 200 / `ignored` | No supported state change was applicable. Confirm the stored reason is expected, such as an unrelated customer or invoice. |
| HTTP 200 / `quarantined` | Ownership, mode, price or other evidence conflicted. Investigate the bindings. A 200 response is not proof of healthy billing. |

Processed, ignored and quarantined receipts are terminal in the current handler. Resending the same ID returns its existing disposition; it does not reopen it. Do not delete receipts, rewrite tenant status or invent an event ID to bypass this protection. Unexpected terminal dispositions require engineering review and, where ownership permits, authenticated current-state reconciliation.

## Redeliver and verify

1. Fix the cause and confirm the endpoint is available. In Workbench, open the original event's delivery to the intended destination and choose **Resend**. Process affected events sequentially and inspect each result.
2. Alternatively, use the following command after substituting the original event ID and the registered destination ID. This example targets a sandbox; no live-mode flag is included:

   ```powershell
   stripe events resend evt_REPLACE --webhook-endpoint=we_REPLACE
   ```

   Dashboard resend is available for 15 days and CLI resend for 30 days after event creation. A successful manual resend does not cancel already scheduled automatic retries. See [Stripe manual retries](https://docs.stripe.com/webhooks#manual-retries) and [CLI resend reference](https://docs.stripe.com/cli/events/resend). This command with a destination ID targets that registered destination, not an arbitrary localhost URL. Do not use `stripe trigger` as a replay: it creates different fixture events.
3. Inspect the new HTTP response and query the exact receipt:

   ```sql
   SELECT id, disposition, "reasonCode", "processedAt", "tenantId"
   FROM processed_stripe_events WHERE id = 'evt_REPLACE';
   ```

4. For an expected billing update, require a processed receipt and the correct current subscription/customer binding and entitlement. Compare with Stripe's current subscription state, not the historical event snapshot. Check `BILLING_SUBSCRIPTION_CHANGED` audit records for the affected tenant: an unchanged state or duplicate delivery must not add another transition audit. Record the result and remaining pending IDs; an unexpected ignored/quarantined result needs investigation.
5. If redelivery is no longer available, a fresh verified SuperAdmin may use **Check billing status** to reconcile authoritative current state. This does not create a payment or subscription and does not drain pending receipts. Record unrecovered receipt IDs for engineering review; do not report the backlog as resolved merely because the UI shows the correct status.

Assign an operator to inspect delivery failures and aged pending/quarantined receipts before launching publicly. Check after configuration changes and billing incidents, and regularly within the provider's redelivery window. Monitoring/alert automation and a scheduled replay worker are not implemented by this checkpoint. Confirm the deployed recovery procedure in staging before claiming production operational acceptance.

## Verification boundary

`tests/billing-webhook-db.test.cjs` covers signed HTTP redelivery after provider/audit failures, duplicate and different events competing for one tenant, stale lease fencing, terminal dispositions, authoritative current state and audit idempotence against disposable PostgreSQL schemas. The different-event test explicitly proves that authenticated status reconciliation leaves a pending receipt pending, while redelivering that original event completes it without a duplicate transition audit.

These tests do not contact Stripe. Existing real sandbox evidence is in [BILLING_ACCEPTANCE.md](BILLING_ACCEPTANCE.md); automatic Stripe/CLI retry and this registered-destination operator procedure have not been executed against a deployed endpoint.
