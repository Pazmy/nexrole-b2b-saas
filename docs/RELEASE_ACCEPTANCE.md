# Release candidate verification matrix (8.6)

## Scope and baseline

Checkpoint 8.6.1 completed on 2026-09-29 against candidate base `15a0b84` (`feat(billing): implement subscription lifecycle, recovery, and mandatory audit logging`). At inspection, the only working-tree change was the sequential 8.6 plan in BUILD_PLAN.md. That initial checkpoint added documentation only. Current progress: 8.6.4 is complete for local acceptance; 8.6.5 is next. Real verification/reset email delivery was subsequently confirmed by the user on 2026-10-05; invitation delivery to another recipient and deployed webhook operations remain unverified. See the dated checkpoint log below.

Existing evidence, not newly rerun results:

- 8.5.7: 180 Node tests, six Edge browser journeys in development and production, lint, TypeScript, database/web/API builds and four applied migrations. The current local Playwright last-run record also reports passed; that file alone is not a complete release report.
- 8.5.8: user-assisted real Stripe sandbox upgrade, failure, recovery, scheduled cancellation and API-driven effective cancellation, independently checked against database/receipts/audit. See [BILLING_ACCEPTANCE.md](BILLING_ACCEPTANCE.md).
- PostgreSQL suites use real persistence and locks with framework session/email/provider boundaries replaced as documented in their harnesses. The access-control HTTP suite runs Express with a fake database; it is not evidence of production API-key lookup/revocation against PostgreSQL.
- Browser account and invitation journeys use local email previews or a fixture-only Resend preload. Real inbox delivery remains unverified. Do not relabel those tests as live email acceptance.

The release target for independent work is a reproducible local production-mode candidate with isolated Docker/database smoke testing. Public production readiness additionally requires working external email, deployed URL/secrets and webhook delivery configuration. No public deployment is authorized by this plan.

## Requirement-to-evidence matrix

The new-company journey, authorization and local recovery/billing coverage are verified at 8.6.2-4. External email, deployed webhook verification, deployment and final regression gates remain open. Final-candidate regression remains 8.6.6. Existing coverage limits additional work; it does not automatically close a gate on a future candidate.

| Gate | Existing evidence and concrete test files | Remaining work / pass condition | Checkpoint |
| --- | --- | --- | --- |
| One complete new-company journey | `apps/web/e2e/account-lifecycle.spec.ts` registers, verifies, creates/completes a transaction, recovers passwords and accepts an invite. `invitation-management.spec.ts` checks role changes/deactivation, starting from SQL-created fixtures. | Verified in 8.6.2: the registered-workspace journey now includes joined-member restrictions, deactivation, old-session and fresh-login rejection, persisted state and actor/target audit assertions before exact fixture cleanup. Development and production passed; retain in final regression. | 8.6.2 |
| Cross-tenant and role enforcement | `tenant-isolation.spec.ts`, `transaction-creation.spec.ts`, `member-management.spec.ts`; `tests/access-control.test.cjs`, `transactions-db.test.cjs`, `membership-db.test.cjs`, `invitations-db.test.cjs`. Cover foreign IDs, forged fields, fresh membership under locks, stale sessions and last-admin races. | Verified in 8.6.3: added `tests/api-key-db.test.cjs` connecting actual key-management actions, Express authentication/router and migrated PostgreSQL. Concurrent tenant filtering, forged ownership, revoked-key denial and fresh management authorization passed. Related regressions: 101 tests passed. Existing browser tests retained; rerun on the final candidate in 8.6.6. | 8.6.3 |
| Password and invitation recovery | `accounts.test.cjs`, `accounts-db.test.cjs`, `invitations-db.test.cjs`, account/invitation browser journeys. Include consumed/revoked tokens, expiry, inactive users, password/session invalidation, delivery races and failure recovery. | Local checks passed in 8.6.4; see exact coverage below and retained 8.6.2-3 evidence. Real Resend delivery remains unconfigured/unverified and blocks public email acceptance. | 8.6.4 |
| Quota, billing and audit integrity | Transaction rule/DB suites; billing rule/provider/foundation/service/webhook suites; `mutation-audit-db.test.cjs`; billing browser journey and real sandbox evidence. | Local checks passed in 8.6.4 with retained 8.6.3 concurrency/audit and 8.5.8 sandbox evidence. Added distinct-event HTTP retry coverage and WEBHOOK_RECOVERY.md. Registered-destination recovery is documented, not executed; automatic CLI retry and a scheduled recovery worker are not claimed. | 8.6.4 |
| Clean migration and Docker startup without demo seed | Disposable-schema migration tests and four applied local migrations; existing Dockerfiles and Compose. | Rehearse `migrate deploy` on an empty disposable database; prove no demo tenant/user creation and no dependency on pre-seeded roles. Build/start isolated database, API and web containers, verify reachability and restart behavior, record commands/results. Existing local tests are not a substitute for this smoke. | 8.6.5 |
| Correct build/runtime configuration | Database/web/API builds passed independently in 8.5. Root `build` currently omits API. Compose supplies app URL only at runtime; web Dockerfile has no explicit URL build argument and excludes env files via `.dockerignore`. | Include all three packages in the documented release build. Verify/provide build-time app URL propagation and generated return/email URLs in the Docker candidate. Check runtime validation, secret handling, origin settings and startup ordering. Treat these as identified verification gaps, not a claimed reproduced Docker failure. | 8.6.5, 8.6.6 |
| Final regression on the candidate | 180 Node checks and six browser journeys are the prior baseline. Billing browser test is opt-in; production email uses a test preload. | Run required lint/types/builds, sequential Node/PostgreSQL suites and all browser journeys on the final candidate. Record actual counts/skips, revision plus dirty diff and environment. Do not silently skip billing or count simulated delivery as inbox verification. Fix failures and rerun affected checks. | 8.6.6 |
| Evidence and release decision | BUILD_PLAN.md, README.md and account/membership/billing guides. | Publish dated results, executable setup/deployment/recovery instructions, exact cleanup boundaries and unresolved external limitations. Close the original six-item checklist only when supported by evidence. Distinguish local candidate acceptance from public production readiness. | 8.6.7 |

## Environment prerequisites and fixture isolation

- Node is available: read-only probe reported `v24.11.1`; package engines require at least 22.15. Build the database package before tests importing compiled shared services.
- Database tests need `TEST_DATABASE_URL` or the configured fallback plus permission to create/drop their disposable schemas. Browser tests need a migrated local database and separate unique workspaces. Never drop/reset the user's database or delete PT Demo Ns and its retained billing evidence.
- Browser regression can use the existing Playwright runner and installed Edge (`PLAYWRIGHT_CHANNEL=msedge`). In-app Browser availability is separate; the prior real Stripe run needed user assistance. Probe the required browser surface when its checkpoint starts.
- Use explicit local server ports and fresh Next build directories; do not terminate user-owned processes or the user's Stripe listener. Remove only temporary TypeScript includes added by our build runs.
- Billing UI tests require `E2E_BILLING_UI_DISABLED=true` in the runner **and** `STRIPE_SECRET_KEY=disabled-for-ui-test` in the target server. Ordinary real sandbox settings must not accidentally receive those fixture actions.
- Development email tests use preview mode. Production-mode browser tests use the explicit fixture-only `resend-preview.cjs` preload and sentinel credential, with `E2E_RESEND_STUB=true` in the runner. Scope captures/cleanup to unique fixture recipients; do not send test messages to unrelated users.
- Docker smoke requires an available engine, image/dependency network access, and an isolated Compose configuration with distinct container names, host ports and volumes. A different project name alone does not isolate the existing fixed `container_name` values. Set `SEED_DEMO_DATA=false` explicitly; its current default is true. Cleanup must name only resources created by that smoke.
- The 8.6.1 Docker probe could not connect to the Docker engine named pipe and also reported Docker config-file access denied in this execution context. Engine readiness is **not established**. Recheck access/engine availability in 8.6.5; this is not proof that the Dockerfiles fail.
- Public email verification needs a usable Resend key, verified sender/domain where required, an authorized test inbox and correct public link origin. No credentials are printed or stored in this matrix. Missing external setup blocks a claim of public production readiness, not independent local verification work.

## Bounded follow-up work

1. Completed **8.6.2**: extended the account browser journey through same-workspace member restrictions, deactivation and persisted audit checks.
2. Completed **8.6.3**: added real-database API-key HTTP coverage and passed the related service/race regressions.
3. Completed **8.6.4**: local recovery/billing evidence and webhook operator runbook. External email/deployed recovery remain unverified. Next continuation: **8.6.5 only**.
4. 8.6.5: establish Docker availability, isolate resources, and resolve URL/seed/startup configuration based on smoke evidence.
5. 8.6.6-7: run final checks and publish the release decision. No new product features, audit-history UI, public deployment or live payments are included.

## Checkpoint log

### 8.6.1 - Complete

Inspected the candidate revision/diff, all suite entry points and targeted test assertions/harnesses, existing acceptance documents, root scripts, Dockerfiles, Compose, Docker ignore rules and Playwright configuration. Confirmed the concrete gaps above. Read-only Node/Docker probes recorded; no test suite, migration, container startup or Stripe request was performed. Only this matrix and BUILD_PLAN.md changed. No application design or code was removed. No newly discovered authorization/tenant-isolation failure is asserted by this review; final acceptance gates remain open pending execution.

### 8.6.2 - Complete (2026-09-29)

Extended apps/web/e2e/account-lifecycle.spec.ts rather than creating a duplicate journey. Registration, verification, transaction creation/completion, reset/change password and invitation acceptance remain intact. Added checks that the joined Member can read the same transaction but lacks transaction creation, profile/billing management, invitation and member-management controls. The original administrator deactivates that joined member; the already-open session is redirected to login on its next protected request, and a fresh credential login is denied. The administrator can still read the retained transaction. Direct forged-action/API boundary coverage remains 8.6.3; visibility checks alone are not claimed as full authorization coverage.

Before cleanup, PostgreSQL assertions verify one Free workspace, its active verified SuperAdmin, the verified inactive Member with incremented sessionVersion, the original completed USD 19.95 transaction owned by that administrator, and no remaining invitation. Transaction creation/status, invitation creation/acceptance and member deactivation each have one user-sourced audit with the expected actor and target; invitation audit IDs match across consumption. No direct SQL mutations were added to set up this journey.

Validation: one Edge journey passed in development (57.9 seconds; preview email) and production (19.7 seconds; fixture-only Resend transport). Targeted ESLint, web TypeScript and fresh production web build passed. Existing unique-tenant/recipient cleanup completed; temporary ports 3100/3101 servers stopped and only this checkpoint's generated tsconfig includes removed. No application layout, server implementation or migration changed. No Stripe or real Resend request; full regression is deferred to 8.6.6 because this checkpoint changes only the browser test and docs.

The user confirmed Resend has not been set up and Docker Desktop has been started. Real inbox delivery remains unverified; Docker startup/isolation will be probed in 8.6.5. Neither is needed for the preview/simulated-mail journey just verified.

### 8.6.3 - Complete (2026-09-29)

Added `tests/api-key-db.test.cjs` and the `test:api:db` script. The test applies all migrations to a uniquely named disposable PostgreSQL schema, generates credentials through the actual server action, then calls the actual Express app on an ephemeral loopback port. Prisma, authorization guards, key hashing, tenant filtering, revocation and required audit persistence are real. Framework session/cache, API configuration and logging are replaced by the harness; this does not simulate a full Auth.js browser login or test external providers.

Seven scenarios (eight Node test records including the parent) verify raw-key authentication and stored-hash rejection; simultaneous requests with forged tenant/actor headers and query parameters; missing/invalid credentials and absent legacy/detail/write routes; foreign-key revocation denial; fresh role, active, verified, tenant and session checks on management; immediate HTTP denial after committed revocation with another tenant's key preserved; and denial after tenant deletion. Key generation/revocation audits retain actor/target attribution without raw credentials or hashes, and repeated revocation adds no duplicate audit.

Validation: database package build passed; the new suite passed independently. The following sequential regression passed **101 tests, zero failures and zero skips**:

```powershell
npm.cmd run build -w packages/database
node --test --test-concurrency=1 tests/access-control.test.cjs tests/api-key-db.test.cjs tests/transactions-db.test.cjs tests/membership-db.test.cjs tests/invitations-db.test.cjs tests/mutation-audit-db.test.cjs tests/billing-service-db.test.cjs
```

Those existing suites cover foreign-resource reads/writes, forged ownership, fresh authorization after lock waits, deactivated/stale sessions, insufficient roles, last-admin concurrency and atomic audit rollback. The billing suite uses its provider fixture; invitation email uses its existing fixture transport. All disposable-schema cleanup completed. No application/UI/schema change, real Resend/Stripe request, Docker startup or user-owned process interruption. Existing browser isolation coverage is retained with prior passing evidence; it was not rerun for this test-only checkpoint. Full browser/build regression remains 8.6.6. Stop here; 8.6.4 is next.


### 8.6.4 - Complete for local acceptance (2026-09-29)

Reviewed recovery, invitation, quota and billing implementation against existing tests. Reused 8.6.3 passing invitation/transaction/service/audit suites rather than rerunning completed checks. Seven additional suites passed **77 tests, zero failures/skips**:

```powershell
node --test --test-concurrency=1 tests/accounts.test.cjs tests/accounts-db.test.cjs tests/transaction-rules.test.cjs tests/billing-rules.test.cjs tests/billing-foundation-db.test.cjs tests/billing-provider.test.cjs tests/billing-webhook-db.test.cjs
```

Added one missing signed HTTP scenario: two different events for one tenant compete for a lease; the second remains pending after 503 and authenticated status checking, then original-event redelivery processes it without an extra transition audit. Reran the affected complete suite with `npm.cmd run test:billing:webhook`: **21 tests passed, zero failures/skips**. This overlaps the earlier 77 checks and is not 21 additional unique scenarios. Disposable schemas were cleaned up. No application code changed; final browser/build regression remains 8.6.6.

| Requirement | Exact evidence |
| --- | --- |
| Password recovery | Account DB tests cover expired/wrong-purpose links, concurrent single-use reset, invalidated sibling links and old JWTs, old-password rejection, current-password validation, inactive users and atomic rate limits. Unit tests cover generic responses and delivery errors. |
| Expired/reused invitations | Retained 8.6.3 tests explicitly expire an invitation and reject acceptance; resend rotates tokens, revoked/consumed links fail, and acceptance races cannot create duplicate users. Account DB tests verify concurrent one-time consumption and preserved tenant/role. |
| Quota and restricted billing | Retained transaction DB tests prove tenth/eleventh Free boundaries, competing creators for the final slot, tenant isolation, active/trialing entitlement and restrictions after lock waits. Newly run rules and webhook entitlement checks match these states. |
| Audit and billing recovery | Retained mutation-audit/service tests cover rollback and durable uncertain attempts. Foundation/provider/webhook checks cover bindings, current-state retrieval, failure/retry, delayed/duplicate events, fencing and audit idempotence. 8.5.8 real sandbox evidence remains applicable; no payment was repeated. |
| Operator webhook recovery | [WEBHOOK_RECOVERY.md](WEBHOOK_RECOVERY.md) supplies diagnosis, dispositions, original-event resend, read-only queries, audit verification and backlog handling. Provider resend guidance was checked against official Stripe documentation; deployed execution remains unverified. |
| External email | Resend is not configured. Previews, fixture transport and failure recovery pass; inbox delivery is unverified. Follow the final real-delivery checklist in [ACCOUNT_SETUP.md](ACCOUNT_SETUP.md) after configuration, including verification/reset and teammate invitations to authorized inboxes. |

Public production readiness remains blocked on real email acceptance and deployment-specific configuration/operational verification. This local checkpoint can close because those prerequisites are explicit and no required local check failed. Production rejects ordinary preview mode; any fixture email transport used for isolated Docker smoke must be identified and cannot establish real delivery. No secret/env changes, real Stripe/Resend request, migration, Docker startup or interruption of user-owned servers/listener. Stop before 8.6.5.


### Manual account verification update (2026-10-05)

The user configured Resend for local testing and reported successful real verification-email delivery and account verification, password-reset email delivery and reset, and Change password. The user also confirmed rejection of expired/invalidated reset links on submission. This is user-reported manual evidence; no new provider request was made while recording it.

The earlier 2026-09-29 statements about missing Resend configuration describe the environment at those checkpoints. Current verification/reset delivery is confirmed for the authorized Resend test recipient. Invitation delivery to another recipient/domain, deployed email configuration and deployed webhook recovery remain unverified. Checkpoints 8.6.5-8.6.7 remain pending; this update does not close release acceptance.

Public project documentation now includes implementation flow diagrams, 18 reviewed UI captures and a local demo-data guide. The explicit db:showcase seed was run successfully and its initial counts/revenue checked; repeating it preserved the existing fixture instead of duplicating or resetting it. These fixtures and screenshots demonstrate the UI and do not substitute for deployment or external-service acceptance.
