# NexRole B2B SaaS: Core Engineering Specifications

This serves as a detailed engineering manual, blueprint, and interactive checkpoint tracking sheet during the development phase.

## Current document version: `V.1.3.0`

## Last updated: `2026-09-25`

## MVP target and tracking rules

**Target:** A new company can register, verify its administrator's email, create its first transaction, invite a teammate, and let that teammate access only permitted workspace data. The administrator can recover account access and manage the workspace subscription.

Phase 8 below is the source of truth for remaining MVP work and release acceptance. Phases 0–7 record the foundation already built; checked implementation tasks do not imply production readiness. The September 20 review was a source inspection, not a runtime acceptance test.

Keep scope, dependencies, and acceptance criteria here. Use issues or PRs for individual implementation tasks, referencing the step ID (for example, `8.3`). Check off a Phase 8 item only when implemented and verified, and link its PR/test evidence beside it. Keep setup instructions in `README.md` and Stripe operational details in `STRIPE_GUIDE.md`; avoid maintaining a second roadmap.

---

## 1. Phase-by-Phase Execution Checklist

### Phase 1: The Multi-Tenant Transaction Ledger (`/transactions`)

**Status:** ✅ Complete

- Secured database queries using strict `tenantId` isolation bounds via `Promise.all`.
- Implemented deep-linkable, zero-hydration table filtering utilizing URL search parameters.
- Mounted responsive state status badges and server-side page control limits.

### Phase 2: Enterprise Settings Panels & Access Isolation Controls (`/settings`)

**Status:** ✅ Complete

- Created modular server-side view partitioning using URL tab tracking strings.
- Deployed protected Next.js Server Actions with dual-layer server-side role validation.
- Extracted form status logic into localized client components to support functional callbacks.
- Built a dynamic member directory component with frontend UI RBAC button locks.

### Phase 3: Transitioning Express API Backend to TypeScript (`apps/api`)

**Status:** ✅ Complete

- Initialized specialized TypeScript module compilation environments inside the microservice container.
- Restructured application codebases from standard JavaScript into clean, type-safe ES modules.
- Deployed a signature-decoding JWT bearer token authentication middleware module.
- Added tenant filters to transaction routes. Step 8.1 subsequently removed the unused `/api/users` and legacy Bearer-token transaction routes; integrations use `/api/v1/transactions`.

---

### Phase 4: B2B Multi-Tenant Onboarding & Secure Invite Loops

**Objective:** Replace manual database seeding routines with automated public onboarding workflows and a cryptographic team invitation pipeline.

- [x] **Step 4.1: Public Business Onboarding Gateway**
  - Create a public multi-tenant creation path: `apps/web/src/app/(public)/register/workspace/page.tsx`.
  - Handle submission within a safe database context transaction: Create a unique `Tenant`, assign baseline enterprise permissions, and create the founding user account explicitly flagged as a `SuperAdmin`.
- [x] **Step 4.2: Cryptographic Invitation Tokens Database Model**
  - Append an `Invitation` model tracking relation to `packages/database/prisma/schema.prisma`:

    ```prisma
    model Invitation {
      id        String   @id @default(uuid())
      email     String
      token     String   @unique
      roleId    String
      tenantId  String
      expiresAt DateTime
      createdAt DateTime @default(now())

      @@index([token])
    }
    ```

  - Re-run structural workspace synchronization commands: `npm run db:push && npm run db:generate`.

- [x] **Step 4.3: Secure Registration Form Lifecycle Router**
  - Build the public landing workspace for invitation confirmation codes: `apps/web/src/app/(public)/register/invite/page.tsx`.
  - Parse the cryptographic URL search value string. If verified and within the designated `expiresAt` timeline, reveal password registration input forms and anchor the new account directly onto the pre-assigned `tenantId` scope.

---

### Phase 5: The B2B Developer API Gateway (API Keys Engine)

**Objective:** Transition your decoupled Express microservice into a programmatic platform feature, allowing corporate tenants to securely automate workflows via machine-to-machine integrations.

- [x] **Step 5.1: Database ApiKey Token Relations**
  - Append an identity access tracking model to your Prisma schema:

    ```prisma
    model ApiKey {
      id        String   @id @default(uuid())
      key       String   @unique // Cryptographically hashed token string
      tenantId  String
      name      String   // User-defined label (e.g., "CI/CD Pipeline Sync")
      createdAt DateTime @default(now())

      @@index([key])
    }
    ```

- [x] **Step 5.2: Programmatic Header Verification Middleware**
  - Build a secondary verification middleware layer inside your Express workspace: `apps/api/middleware/apiKeyAuth.ts`.
  - Configure route rules to scan incoming network headers for authentic token entries (`X-API-Key`). Hash the header token, match it against database records, extract the associated company identifier, and inject it into the active request thread (`req.tenantId`).
- [x] **Step 5.3: Core Dashboard Token Developer Console**
  - Construct an API management interface panel inside your Next.js configuration space (`/settings?tab=developer`).
  - Implement form workflows to generate new API tokens (revealing raw key values exactly once using high-security display layers) and display existing tokens in a list view.

---

### Phase 6: Multi-Tenant Stripe Subscription Billing Engine

**Objective:** Establish automated payment gateways to restrict enterprise workspace limits based on the company's active subscription tier.

- [x] **Step 6.1: Define Enterprise Feature Set Scopes & Upgrade Path**
  - Created `apps/web/src/lib/billing-guard.ts` to calculate billing state. The current Free limit counts all stored transactions, not monthly usage. Server-side write enforcement remains open in Phase 8.
  - **Upgrade Action path (`apps/web/src/app/(dashboard)/settings/_components/ProfileForm.tsx`):** Mounted an upgrade form action when `subscriptionStatus === "free"`. The "Upgrade Workspace Account" button invokes the `startCheckoutSession` server action via `formAction` to redirect users to a Stripe hosted Checkout Session.
- [x] **Step 6.2: Set Up Stripe Webhook Listeners inside Express Server**
  - Implement a dedicated webhook routing terminal endpoint within your Express microservice: `apps/api/routes/webhook.ts` (API version pinned to `2026-06-24.dahlia`).
  - Process signature validations from Stripe requests. Parse payment events (`customer.subscription.created`, `customer.subscription.updated`, `invoice.payment_failed`) to update corresponding `subscriptionStatus` entries in the `Tenant` table in real time.
  - **Stripe Customer Mapping Implementation:** Extended the `Tenant` model schema with `stripeCustomerId`. The Stripe webhook automatically updates this mapping, and server billing actions dynamically fall back to looking up or creating Stripe customer IDs based on the user's email for seamless local development support.
- [x] **Step 6.3: Middleware Billing Enforcement Guards & Renewal Path**
  - Integrate tier checks into your Next.js layout structures (`apps/web/src/app/(dashboard)/layout.tsx`) utilizing `checkTenantBillingStatus`.
  - **Delinquency Warning & Renewal Button:** If the workspace is locked (delinquent/past_due or exceeded free limits), `layout.tsx` renders a warning banner (`BillingAlertBanner`). The "Resolve Billing System" action button within this banner invokes `startCustomerPortalSession` to redirect users to Stripe's Customer Portal to renew or fix their subscription.

---

### Phase 7: Production Infrastructure & Compliance Observability

**Objective:** Prepare the stabilized platform for live deployment by adding end-to-end multi-tenant boundary test suites, unified Docker configurations, and structured JSON telemetry.

- [x] **Step 7.1: Multi-Tenant Playwright End-to-End Testing**
  - Configure Playwright suites within your web project directory to validate tenant data isolation boundaries.
  - Write test scenarios where two distinct seeded client accounts session tokens execute concurrent actions, ensuring Tenant A can never view or intercept operational inputs belonging to Tenant B.
- [x] **Step 7.2: Orchestrated Multi-Service Docker Compose Configuration**
  - Build a root-level `docker-compose.yml` to spin up local development environments, including a localized PostgreSQL database instance, your TypeScript Express backend, and the Next.js App Router workspace.
- [x] **Step 7.3: Database-Driven Audit Ledger Foundation**
  - Implement automated audit triggers inside critical data mutation actions. Write security logs tracking changes to organization profiles or team structures into an `AuditLog` table containing the actor's User ID, metadata, and IP addresses.
  - Model and logging utility exist with profile, invitation, API-key, and billing event coverage. Actor ID wiring and coverage for new mutations still require verification in Phase 8.
- [x] **Step 7.4: Structured Telemetry Tracking Engine**
  - Integrate a professional logging tool (e.g., Winston or Pino) inside the Express API container to format exception events and logs into clean, indexable JSON outputs.
  - Pino and request correlation middleware are implemented.

---

### Phase 8: MVP Workflow Completion & Release Acceptance

**Status:** In progress. Step 8.1 implemented with automated boundary regression coverage; remaining steps and full release acceptance are open.

**Scope:** One workspace per user, fixed roles, transaction creation/detail/status updates, team invitations, account recovery, and Free/Pro billing. Retain the existing Next.js server components/actions → shared Prisma flow and Express integration/webhook endpoints. A backend rewrite is not required for MVP.

**Sequence:** 8.1 → 8.2 → 8.3 → 8.4 → 8.5 → 8.6. Build regression coverage alongside each step; 8.6 verifies the complete release candidate.

#### Step 8.1: Close access-control gaps — release blocker

- [x] Remove `/api/users` if unused, or require authorized tenant-scoped access and return an explicit safe field selection. Never return password hashes.
- [x] Centralize server-side checks for current user, active membership, tenant, and allowed action. Define a small fixed-role permission matrix and enforce it in actions and API handlers, not just buttons.
- [x] Reject inactive accounts at login and on protected operations, including existing sessions after deactivation or role changes.
- [x] Restrict billing changes and portal access to workspace administrators.
- [x] Resolve `/api/transactions` authentication: remove the unused route or implement and document a supported token issuance/validation flow. Validate required tenant claims before querying; do not assume Auth.js cookies are Express Bearer tokens.

**Acceptance:** Anonymous requests, inactive accounts, insufficient roles, and cross-tenant resource IDs cannot read or mutate protected data. Regression tests exercise the server boundaries directly.

**Implementation and evidence (2026-09-20):**

- Removed both unused Express routes and the legacy JWT middleware. `apps/api/app.ts` exposes the application for HTTP tests; `server.ts` retains startup/shutdown. `/api/v1/transactions` keeps tenant-scoped API-key authentication.
- Added `current-user.ts`, `authorization.ts`, and a fixed `permissions.ts` matrix. All dashboard data reads and settings mutations check current membership. Auth.js rejects inactive login and refreshes/invalidates existing sessions. Billing actions require SuperAdmin. See the README access-control table for the role policy.
- Settings queries select only needed fields, omit stored API-key hashes from client props, and restrict key metadata to admins. Key deletion includes tenant scope. Invitations cannot assign unknown roles.
- `npm run test:access`: **16 passing tests**, including direct server-action denials, stale sessions, login checks, cross-tenant key revocation, and real HTTP requests for removed routes and tenant-scoped API exports. External database/session/Stripe boundaries are mocked; this is not a live-database or browser acceptance run.
- Web lint, web TypeScript checking, and API TypeScript build passed. Web production build remains **unverified**: the sandbox could not fetch Google Fonts; the network-enabled retry encountered an `EPERM` unlink error in `.next/build/chunks`. Repeat the production build in a working local/CI environment before release.

#### Step 8.2: Complete onboarding and account recovery

- [x] Make `/register` a public entry point that redirects to or renders workspace registration, and link it from login. Reuse the existing `/register/workspace` implementation.
- [x] Apply shared server-side validation to registration, login, and invitation acceptance; normalize email before lookup and storage; handle duplicate accounts and concurrent submissions cleanly.
- [x] Add email verification, forgot/reset password, and authenticated change-password flows with expiring, single-use tokens and appropriate session invalidation.
- [x] Add abuse limits to login, registration, verification, and recovery endpoints. Avoid exposing account existence through recovery responses.
- [x] Configure transactional email and application base URL for verification, recovery, and invitations. Replace hardcoded localhost invitation links.
- [x] Provide pending, success, validation, expired-token, and retry states with plain user-facing language.

**Acceptance:** A new company onboards without seed data, verifies email, signs in, and recovers access. Invalid/expired/reused tokens fail safely; failed registration leaves no orphan tenant.

**Implementation and evidence (2026-09-21):**

- Added shared Zod validation, normalized-email database constraints, verification/reset token hashes, atomic token consumption, password-change session versions, and PostgreSQL-backed abuse limits. Existing accounts require verification; old sessions must sign in again. The migration aborts on normalized-email collisions rather than merging accounts and preserves existing invitation URLs by hashing their stored tokens.
- Added local `.email-previews` delivery and a server-side Resend API sender. Production rejects preview mode and requires configured credentials, a sender, and an HTTPS application origin. Invites now use the same sender and origin configuration. Account creation survives delivery failures with a verification retry path.
- `npm run test:access`: **16 passing**; `npm run test:accounts`: **6 passing**; `npm run test:accounts:db`: **13 passing** (12 lifecycle/migration subtests plus the parent suite), using actual PostgreSQL in an isolated schema. Covers seedless registration, duplicate races, expired/reused tokens, concurrent consumption, rate-limit atomicity, session invalidation, invitation scope, and failed delivery.
- Local-preview Playwright lifecycle test: **1 passing** in Microsoft Edge, covering registration, verification, recovery, a second browser's session invalidation, password changes, invitations, and used-link rejection. The test deletes its temporary workspace and previews. Existing seeded tenant-isolation browser test was not run; migrated demo accounts require verification before that older suite can sign in.
- Web lint, web TypeScript, database/API builds, and web production build passed. Windows verification used a separate `NEXT_BUILD_DIR` to avoid the existing cache ownership issue; the production build required network access for Google Fonts.
- Applied the migration to the local development database after confirming its two existing accounts had no normalized-email collisions.
- [ ] **External acceptance still pending:** configure a verified Resend domain and run the [final real-email setup and verification checklist](docs/ACCOUNT_SETUP.md#final-action-after-resend-is-ready-configure-and-verify-live-delivery). No real Resend email has been sent or verified in this implementation session.

#### Step 8.3: Deliver the first useful transaction workflow

**Sequential execution plan (2026-09-25):** Execute one checkpoint per user continuation. After each checkpoint, record changed files, checks and results, remaining issues, and the next checkpoint here. Do not mark an item complete until its implementation and relevant checks pass. Preserve existing page layouts, cards, tables, filters, icons, and styling; explain any UI element that must be replaced for functional reasons. This plan is recorded before implementation begins.

**Prerequisite evidence:** On 2026-09-25, the user reported that manual testing of Step 8.2 was overall successful. Real Resend delivery remains pending and does not block local-preview development of Step 8.3.

- [x] **8.3.1 — Transaction rules and permissions.** Define shared amount/description validation, initial status, allowed status transitions, write permissions, and explicit billing eligibility. Implemented MVP rules: USD with positive amounts and at most two decimal places within the existing Decimal(10,2) range; new transactions start pending; pending can become completed or failed; terminal states cannot be reopened. SuperAdmin writes, Member/Developer retain read access. Specify which subscription states permit writes; unknown states must not gain Pro access. Distinguish the creation quota from permission to update existing transactions. Check these rules with focused tests before exposing mutations.
- [x] **8.3.2 — Safe transaction creation on the server.** Implement creation using verified tenant/actor context, role and billing checks, and atomic per-workspace quota enforcement. Free allows 10 stored transactions; eligible Pro is unlimited. Test invalid input, unauthorized/cross-tenant requests, and concurrent attempts to create the tenth/eleventh transaction. No creation UI until this boundary passes.
- [x] **8.3.3 — Transaction creation UI.** Add the creation entry point and form using the existing visual style. Connect the checked server action, validation, pending/success/error states, quota feedback, and list refresh. Verify the normal creation journey and rejected submissions.
- [x] **8.3.4 — Transaction details and status updates.** Add tenant-scoped detail reads and a matching detail page. Implement authorized status changes with billing checks, permitted transitions, and protection against conflicting concurrent updates. Link to details from the existing list. Verify foreign IDs, invalid transitions, insufficient roles, and updates at the Free creation limit.
- [x] **8.3.5 — List and dashboard integration.** Preserve search/filter/pagination while validating query parameters and handling empty/loading/error states. Refresh list/detail/dashboard data after mutations. Replace the hardcoded growth percentage with truthful supporting text while preserving the card design; new period analytics are deferred.
- [x] **8.3.6 — Final acceptance and handoff.** Run applicable regression tests, PostgreSQL concurrency tests, the complete browser transaction journey, lint, type checks, and web/API builds. Document manual test steps, evidence, and any remaining external limitations. Only then mark the original Step 8.3 acceptance checklist complete.

**Current checkpoint:** 8.3.6 and Step 8.3 complete (2026-09-26). Stop here; Step 8.4 requires its own sequential plan. Deletion, monthly quota resets, membership administration, and Stripe webhook/billing lifecycle redesign are outside this step; only billing checks required by transaction writes are included.

**8.3.1 evidence (2026-09-25):**

- Added `transaction-rules.ts`: exact decimal-text USD validation (0.01?99999999.99), trimmed 1?500-character descriptions, strict input schemas, pending initial state, and pending-to-completed/failed transitions only. Client-supplied tenant/actor/status/currency fields are rejected by the creation schema.
- Added `transaction-entitlements.ts`: free/canceled use the 10-stored-record creation limit; active/trialing explicitly qualify for unlimited Pro counts; all other/missing statuses deny writes. Status updates are independent of the creation quota. Invalid counts and unsupported operations fail closed.
- Updated `permissions.ts` with SuperAdmin-only transaction creation/status permissions; Member/Developer retain read-only access. Updated the README contract and added `npm run test:transactions:rules`.
- Validation: **11 transaction-rule tests passed**, **16 existing access-control tests passed**, web TypeScript checking and targeted ESLint passed. No schema migration, database mutation, new action, or UI change in this checkpoint.
- Remaining boundary: the new entitlement helper is a pure policy. It does not yet enforce concurrent writes; implement that in 8.3.2. The legacy dashboard billing summary still uses its existing guard until UI integration in 8.3.5. Do not use that legacy summary to authorize new writes.

**8.3.2 evidence (2026-09-25):**

- Added server-only `create-transaction.ts` and `transactions/create-action.ts`. Both the tenant and actor derive from verified session/membership; extra ownership/status/currency fields and repeated form fields are rejected. The action returns only a success message and transaction ID, or a safe validation/access/billing/quota/error result.
- Creation locks the tenant row before reading billing and counting stored transactions, using a READ COMMITTED database transaction. Membership, verification, session version and role are rechecked after obtaining that lock; shared membership/role locks protect the decision until commit. Every future creation path must use this boundary rather than counting separately.
- Added `npm run test:transactions:db`: **11 passing** (10 PostgreSQL subtests plus the parent suite), run against a disposable schema with real migrations, locks and writes. A race of 12 requests from two administrators for one remaining Free slot produced exactly one success and 11 quota denials. Covers tenth/eleventh creation, cross-tenant forgery, inactive/unverified/stale/demoted sessions, restricted billing, eligible Pro, changes while waiting on locks, and database rollback/error sanitization.
- Regression evidence: **11 rule tests** and **16 access-control tests** passed; web TypeScript and targeted ESLint passed. The test schema was removed afterward. No application database migration or UI change was needed.
- Remaining work: creation UI and cache refresh in 8.3.3; detail/status mutation in 8.3.4; legacy billing-summary UI integration in 8.3.5; final browser/build acceptance in 8.3.6. Audit-policy integration remains in 8.5. This checkpoint has no browser creation workflow yet.

**8.3.3 evidence (2026-09-25):**

- Added `create-transaction-form.tsx` and connected it to the existing ledger page for SuperAdmin. Preserved the existing sidebar, header, cards, filters, table, pagination, and visual style; no old UI element was removed.
- Added exact USD validation, retained inputs after errors, disabled controls/spinner while saving, success feedback, a fresh-form action, and a link to the unfiltered first page. Usage counts include all workspace transactions even when the list is filtered. Free quota and restricted billing disable creation; the server remains authoritative when usage or permissions change after rendering.
- The creation action invalidates list/dashboard paths after commit; the client refreshes success and changed-access/billing/quota responses. Cache refresh failure does not misreport a committed transaction as a failed creation.
- Validation: **1 Playwright browser scenario passed** against local Edge and PostgreSQL, covering cancel/reopen, invalid amounts, retained inputs, pending controls under a real database lock, filtered-list success, fresh-form reset, stale quota rejection, restricted billing, Pro creation beyond 10, and Member read-only UI. Test fixtures were cleaned up afterward. **11 PostgreSQL creation tests passed**; web TypeScript and targeted ESLint passed. The form screenshot was visually reviewed.
- Remaining work: detail/status updates in 8.3.4; complete query/dashboard integration in 8.3.5; full regression/build acceptance in 8.3.6. No migration or Resend/domain setup is required for this checkpoint.

**8.3.4 evidence (2026-09-25):**

- Added tenant-scoped `transaction-detail.ts`, `/transactions/[id]` detail/not-found pages, and `transaction-status-form.tsx`. Existing ledger descriptions now link to details; no original layout, table column, card, filter, or icon was removed. Member/Developer can read details without mutation controls. Malformed, missing, and foreign IDs disclose no transaction data.
- Added `update-transaction-status.ts` and `transactions/status-action.ts`. The service derives the actor from the verified session, locks in the same tenant/member order as creation, rechecks current permission and billing after waiting, and atomically updates only a tenant-owned pending row. Only completed/failed are accepted. Terminal/repeated/concurrent losing updates return a conflict. Free quota does not block updates. Detail/list/dashboard caches are invalidated after commit.
- Validation: **16 PostgreSQL tests passed** (15 subtests plus parent), retaining all creation regressions and adding detail isolation, quota-boundary status changes, two competing terminal updates, forged inputs, stale/inactive/unverified/insufficient-role sessions, restricted billing, and membership/billing changes during lock waits.
- **1 expanded Playwright journey passed** in Edge with local PostgreSQL: creation regressions, list-to-detail navigation, Member read-only detail, updates above the Free count limit, pending controls under a real lock, stale-tab conflict, final-state UI, completed/failed list refresh, restricted billing, and invalid/missing routes. Detail screenshot visually reviewed. TypeScript and targeted ESLint passed. Fixture data was cleaned up. No schema migration needed.
- Remaining: query/list/dashboard integration in 8.3.5 and full regression/build acceptance in 8.3.6. Audit integration remains in 8.5; this checkpoint stops before those changes.

**8.3.5 evidence (2026-09-25):**

- Added shared `transaction-query.ts`: positive safe-integer pages, allowlisted statuses, bounded trimmed searches, and deterministic fallback for repeated parameters. The list counts before clamping to the last available page and orders by creation time plus ID. Pagination keeps valid search/status values and boundary links are not keyboard-focusable. Filters remount from normalized URL state, including browser Back and the post-creation latest-list link; Apply/Clear show pending state.
- Preserved all original cards, table columns, filters, icons, and sidebar. Replaced the fictitious +12.2% growth with completed-value context and corrected the stored-count copy. Renamed Settled Timestamp to Created Timestamp because the field is createdAt. Empty results now distinguish no records from no filter matches. Added workspace/transaction loading views. Existing error-card design remains; retry uses the installed Next retry API and displays a diagnostic reference instead of raw exception text.
- Billing summary now reuses the transaction entitlement policy: only active/trialing are Pro, free/canceled use the creation quota, and other/missing states are restricted. The existing banner explains creation-only quota versus write restrictions without claiming the whole account is locked. Its styled billing control now links to settings, where Free workspaces can upgrade without requiring an existing Stripe customer portal.
- Validation: **12 rules/query tests**, **17 PostgreSQL tests** (16 subtests plus parent), web TypeScript and targeted ESLint passed. **1 expanded Playwright journey passed**: prior create/detail/status flow, refreshed completed revenue/counts, truthful dashboard copy, billing banners, oversized/malformed/repeated query parameters, preserved filters during pagination, Clear/Back synchronization, and filtered-empty feedback. Dashboard screenshot visually reviewed; browser fixture data cleaned up.
- No schema migration or old design removal. Full regression/build checks and final acceptance remain in 8.3.6; explicit loading/error recovery fault injection is not covered by the browser scenario above. Stripe lifecycle and audit integration remain in 8.5.

**8.3.6 acceptance evidence (2026-09-26):**

- Regression checks passed: **16 access-control**, **6 account**, **12 transaction rules/query**, **13 account PostgreSQL**, and **17 transaction PostgreSQL** tests (64 reported tests including parent suites). Full workspace lint, web TypeScript, database/web production builds, and the separate API build passed. The root build still does not include the API, which was checked explicitly.
- All **3 browser scenarios passed** in development: accounts, tenant isolation, and transactions. Account coverage now includes actual workspace registration/verification followed by first-transaction creation, completion and dashboard revenue. Tenant isolation uses two disposable verified workspaces, checks lists and foreign detail IDs in both directions, and no longer depends on old seeded credentials/data. Existing seed accounts were not modified.
- Production smoke testing exposed an intermittent client transition failure: writes and HTTP responses completed while transaction forms or refreshed data remained stale. Direct action binding alone did not resolve it. The final `use-transaction-submit.ts` keeps submit state outside React transitions, prevents duplicate submissions, and reloads the document after success or changed-policy/conflict responses. Short-lived tab-local feedback preserves the existing success/error card and rejected input, scoped by workspace/transaction. Server authorization, exact validation, locks, and cache invalidation remain authoritative. No design element was removed.
- The final production transaction journey passed **twice consecutively**, including stale quota, concurrent status conflict, retained inputs, list/filter navigation and dashboard counts. Production tenant isolation had already passed; it was not rerun after changes confined to transaction forms. The affected registration-to-first-transaction/account journey was rerun after the final fix and passed. Final changed-file lint and the rebuilt web TypeScript check passed. Test-owned rows/previews were cleaned up, including exact fixtures from interrupted diagnostic attempts.
- Runtime configuration evidence: production startup requires trusted deployment host configuration and an HTTPS application origin supplied at build time. The local production smoke used process-only host trust and dummy Resend configuration, with verified fixture users and no email requests. This is **not** real email delivery or deployment acceptance. Real Resend/domain verification remains the Step 8.2 external checklist. No dependency upgrade or database migration was required.
- Scope limits: explicit route-loading/error-boundary fault injection was not performed; mutation error/conflict paths were exercised. Broader membership, Stripe lifecycle, audit and release acceptance remain in Steps 8.4–8.6. Step 8.3 completion does not mark the whole MVP production-ready.

- [x] Add transaction creation, a detail view, and permitted status updates. Define amount validation and allowed status transitions; derive tenant and actor from verified server context.
- [x] Enforce permissions and billing entitlements on every transaction write. Make Free quota enforcement safe under concurrent creates.
- [x] MVP quota decision: Free allows at most 10 stored transactions per workspace; eligible Pro subscriptions have no transaction-count limit. Monthly reset semantics and transaction deletion are deferred.
- [x] Preserve search/filter/pagination; validate query parameters and provide useful empty, loading, success, and error states.
- [x] Remove the hardcoded dashboard growth percentage or replace it with a real period comparison.

**Acceptance:** A new workspace creates and updates its own transactions; dashboard totals reflect changes. Unauthorized writes fail. The tenth Free transaction succeeds and the eleventh is rejected, including concurrent submissions.

#### Step 8.4: Complete workspace membership management

- [ ] Extend the existing settings member list with fixed-role changes and deactivation; prevent removing or demoting the last active administrator.
- [ ] List pending invitations and support revocation/resending with token rotation and expiry. Validate invite email and allowed role on the server.
- [ ] Handle duplicate invitations and existing-account emails explicitly. MVP retains one workspace per user; do not silently move existing accounts between tenants.
- [ ] Deliver invitation email, consume acceptance tokens atomically, and ensure revoked/expired/used tokens cannot create accounts.
- [ ] Implement or remove the placeholder `/settings/members` and `/settings/roles` pages so navigation does not lead to unfinished screens.

**Acceptance:** An admin invites a teammate, the teammate joins the correct workspace with the assigned permissions, and later deactivation blocks access even with an existing session.

#### Step 8.5: Make billing and audit behavior consistent

- [ ] Reuse the tenant's Stripe customer and track its subscription identity; prevent repeated checkout from creating unintended duplicate subscriptions.
- [ ] Define explicit entitlement handling for all subscription states, including trialing, incomplete, paused, canceled, past_due, and unpaid. Unknown states must not automatically grant Pro access.
- [ ] Handle subscription deletion/cancellation and verify invoice-to-tenant resolution against the configured Stripe API version.
- [ ] Verify duplicate, concurrent, and out-of-order webhook delivery cannot leave stale entitlements or duplicate effects.
- [ ] Keep reads, account recovery, and billing recovery available when writes are restricted; show the actual quota or payment reason in the UI.
- [ ] Wire authenticated actor IDs into audit records and cover transaction/member changes. Record tenant, actor, action, and timestamp without passwords or raw tokens; define behavior when audit persistence fails.

**Acceptance:** Stripe test-mode upgrade, payment failure, recovery, and cancellation produce the intended write permissions. Audit records identify the correct workspace and actor. Existing webhook signature verification remains covered.

#### Step 8.6: Verify and document the release candidate

- [ ] Run the full new-company journey: register → verify → sign in → create transaction → invite teammate → accept → verify role restrictions → deactivate teammate.
- [ ] Cover password recovery, expired/reused invitations, last-admin protection, cross-tenant reads/writes, API-key revocation, quota concurrency, and billing lifecycle behavior.
- [ ] Retain the existing tenant-isolation browser test and expand beyond UI visibility to server actions and API authorization boundaries.
- [ ] Run web lint/build, API TypeScript build, and applicable automated tests. The current root build omits the API build, so include it explicitly or update build orchestration.
- [ ] Smoke-test clean-database migrations and Docker startup with demo seeding disabled; document required environment variables, email setup, and deployment steps in README.
- [ ] Record release evidence here (PRs, test results, date, and any remaining limitations). Do not mark MVP complete while a required item above is open.

**MVP exit gate:** All six steps pass their acceptance criteria on the release candidate, with no unresolved tenant-isolation or authorization failures.

#### After MVP — explicitly deferred

- Admin audit-history UI with filters/export; audit recording is required for MVP.
- Advanced charts, period analytics, and CSV import/export.
- Multiple workspace memberships and workspace switching.
- Custom role editors, SSO/MFA, and expanded API-key scopes/expiry/usage analytics.
- Transaction deletion, monthly quota resets, and additional subscription tiers.

---

## 2. Design System & Frontend Utility Guide

Follow these styling rules and guidelines to maintain uniform layout rendering across all interface modifications.

### 1. Style Matrix Sheet (Tailwind Utility Tokens)

- **Viewport Canvas Backgrounds:** Use `bg-zinc-950` exclusively for overall app wrappers.
- **Component Elevators (Cards/Sidebars):** Render container layouts using `bg-zinc-900` over structural borders styled with `border border-zinc-800`.
- **Data Inputs & Control Containers:** Apply `bg-zinc-950 border border-zinc-700 text-white focus-visible:ring-1 focus-visible:ring-zinc-500` to form fields.
- **Primary Conversion Nodes:** Apply `bg-blue-600 hover:bg-blue-700 text-white transition-all` to action items.
- **Metric Change Indicators:** Use `text-emerald-500` for positive data markers, `text-amber-500` for pending states, and `text-red-500` for fatal exceptions.

### 2. Micro-Typography Standards

- **Primary Page Headlines:** `text-3xl font-bold tracking-tight text-zinc-100`.
- **Context Descriptions:** `text-sm text-zinc-400`.
- **Data Logs & Metrics:** `font-mono text-sm tracking-wide text-zinc-300`.

### 3. Application State Separation Philosophy

- **Client Interface Layout State:** Manage quick interface transitions (like dropdown behaviors or modal visibility toggles) locally within components using simple React `useState` hooks.
- **Global Business Data State:** Maintain all shared application parameters (such as pagination adjustments, table filters, or search variables) inside the **browser URL search address bar**.
  - _Why:_ This design pattern ensures page layouts are deep-linkable and easy to bookmark. It allows Next.js Server Components to read current parameters instantly during server-side compilation, removing the need for loading spinner placeholders.

---

## 3. Development Progress Checklist

### Phase 0: System Architecture & Monorepo Wiring

- [x] Establish multi-tenant PostgreSQL Prisma data structures.
- [x] Configure monorepo package workspace orchestration links.
- [x] Synchronize database migration schemas directly with PostgreSQL database instances.
- [x] Implement safe database seed scripts loaded with real-world tenant test logs.

### Phase 0.5: Authentication Bridge & Middleware Protection

- [x] Build the central NextAuth v5 configuration system.
- [x] Embed multi-tenant identifier metadata directly into JWT session handling layers.
- [x] Set up edge security route middleware protection.
- [x] Build the unified Login panel utilizing clean validation forms.

### Phase 1: Server-Side Multi-Tenant Ledger (`/transactions`)

- [x] Bind Server Component rendering loops directly to incoming URL parameter states.
- [x] Optimize concurrent data fetching using non-blocking parallel `Promise.all` logic layers.
- [x] Build client data filtering search components that synchronize with the browser address bar.
- [x] Render numerical data points using structured data sheets and page pagination controls.

### Phase 2: Configuration Panels & RBAC Controls (`/settings`)

- [x] Create tab views separating system variables from operational resources.
- [x] Hook up profile forms to execute server mutation requests via Server Actions.
- [x] Implement secure member roster components using local workspace queries.
- [x] Hide or disable high-privilege operations from non-admin accounts by evaluating session permissions.

### Phase 3: Transitioning Express API to TypeScript (`apps/api`)

- [x] Configure full TypeScript compilation setups within your API workspace.
- [x] Refactor raw JavaScript server components into fully typed ES modules.
- [x] Deploy custom middleware components to decode incoming user sessions from request authorization headers.
- [x] Secure the remaining Express data endpoint with tenant-scoped API-key authentication; unused legacy routes were removed in Step 8.1.

### Phase 4: B2B Onboarding & Cryptographic Invite Loops

- [x] Deploy the public business registration workspace route.
- [x] Push the new `Invitation` data schema tables to your database client.
- [x] Build token-verified registration input pages to securely onboard new workspace actors.

### Phase 5: The Developer API Key Gateway

- [x] Push the `ApiKey` data models to your database container.
- [x] Build the Express request interceptor middleware targeting machine token configurations.
- [x] Render the client-facing developer credential management panel within the workspace dashboard.

### Phase 6: Multi-Tenant Stripe Subscription Engine

- [x] Map tier limits against application database queries and layouts.
- [x] Deploy validated Stripe endpoint webhook listener tunnels inside your Express app.
- [ ] Enforce billing entitlements on writes; the existing layout check only displays alerts. See Steps 8.3 and 8.5.

### Phase 7: Production Infrastructure & Compliance Observability

- [ ] Build dynamic analytics visualizations on the dashboard landing page (deferred until after MVP).
- [x] Add initial Playwright login and tenant-isolation UI coverage; broader authorization coverage is tracked in Step 8.6.
- [x] Construct a root Docker Compose file to orchestrate local development databases and services.
- [x] Implement the AuditLog model and logging utility; complete actor wiring and mutation coverage in Step 8.5.
- [x] Add Pino structured API logging with request correlation IDs.

### Phase 8: MVP Workflow Completion & Release Acceptance

Track remaining work and acceptance evidence only in the detailed Phase 8 checklist above to avoid duplicate task statuses.
