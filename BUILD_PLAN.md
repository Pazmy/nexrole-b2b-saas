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

**Sequential plan (2026-09-27):** One checkpoint per user continuation, with tests/evidence recorded before moving on. Preserve the existing Team tab, member table, invite form and invitation acceptance design. Explain any necessary replacement. No membership UI or database mutation is introduced by 8.4.1.

- [x] **8.4.1 — Rules and permissions.** Define management permissions, strict role/member/invitation validation, last-admin policy, duplicate-email/invitation behavior, and schema requirements. Verify pure rules and existing authorization regressions.
- [x] **8.4.2 — Member management backend.** Implement tenant-scoped role changes and deactivation with fresh actor checks, atomic last-admin protection, session invalidation, and PostgreSQL concurrency/isolation tests.
- [x] **8.4.3 — Member management UI.** Extend the existing table with active/inactive status, role selection and confirmed deactivation, preserving read-only access for other roles. Test feedback and session effects.
- [x] **8.4.4 — Invitation backend.** Add scoped list/resend/revoke, duplicate protection, token rotation/expiry and explicit delivery failure behavior. Serialize acceptance/resend/revoke races and test with PostgreSQL.
- [x] **8.4.5 — Invitation UI.** Extend the original invite form with role selection and add invitation expiry/resend/revoke controls. Verify with local previews and retain the acceptance-page design.
- [x] **8.4.6 — Members/roles routes.** Redirect `/settings/members` to the existing Team tab and replace `/settings/roles` placeholder with the fixed permission matrix. No custom-role editor.
- [x] **8.4.7 — Acceptance and handoff.** Run regression, database concurrency, browser development/production, lint, TypeScript and web/API builds. Document invite → join → role change → deactivation with already-open sessions. Only then complete the original checklist below.

**Current checkpoint:** 8.4.7 and Step 8.4 complete (2026-09-27). Stop here; Step 8.5 requires its own sequential plan. Live Resend delivery remains a separate domain-dependent verification; whole-MVP release acceptance is still Step 8.6.

**8.4.7 final acceptance evidence (2026-09-27):**

- Inspected the staged implementation and earlier test evidence; no application redesign or rewrite was needed. Extended the invitation browser journey to follow the same invited Developer through successful join, role change to Member, fresh login, and deactivation. Already-open sessions are rejected on the next protected request after both changes. Recovery browser tests now resolve preview URL paths against the local test server for production verification as well as development.
- **99/99 Node tests passed**: access 16, accounts 6, account PostgreSQL 13, membership rules 10, membership PostgreSQL 11, invitation PostgreSQL 14, transaction rules 12 and transaction PostgreSQL 17. Database suites use disposable migrated schemas and real PostgreSQL locks, including last-admin races, token acceptance/resend/revoke ordering, stale actors and tenant boundaries.
- **5/5 Edge browser journeys passed in development (1.6 minutes)** and **5/5 passed in production (50.1 seconds)**: account lifecycle, invitation management, member management/routes, tenant isolation and transaction workflow. Production additionally exercises invitation delivery failures via the fixture-only Resend transport preload. Development used private email previews; no live email was sent.
- Full web ESLint passed; the two amended browser files also passed targeted lint afterward. Database package build, production web build (including TypeScript) and API TypeScript build passed. `prisma migrate status` reports all three migrations applied. No new migration was introduced in this checkpoint.
- Added [manual demo/testing handoff](docs/MEMBERSHIP_TESTING.md), including no-domain setup, the complete membership journey, expected error/permission cases, automated commands and the final live Resend checklist. Browser fixtures/previews and database test schemas were cleaned by the suites; verification servers stopped and temporary tsconfig cache entries removed. User-staged changes were preserved.
- All original 8.4 implementation acceptance items below are complete. Domain verification and real Resend inbox delivery remain unverified, explicitly deferred under the existing email setup plan. Audit/billing consolidation remains 8.5; whole-MVP deployment/release acceptance remains 8.6. Earlier checkpoint notes describe evidence at those checkpoints; this section is the final 8.4 status.

**8.4.6 evidence (2026-09-27):**

- `/settings/members` redirects to `/settings?tab=team`, preserving the existing roster and invitation experience. `/settings/roles` now displays the fixed SuperAdmin/Member/Developer permission matrix, generated from the backend `hasPermission` checks with exhaustive labels for the Permission type. The page checks current workspace access and redirects denied sessions to login.
- Added View role permissions beside the existing Change password link, plus Back to Team Members from the matrix. Explained the current identical read-only permissions for Member/Developer, admin-only key management, last-admin policy and session effects. No custom-role editing or permission changes were introduced.
- Extended the existing member browser journey to verify anonymous protection for both routes, members redirect, role-page navigation and return for all three roles, shared transaction read access and admin-only member management. The complete extended Edge development journey passed, including the previous member mutations/session regression. Web TypeScript, targeted ESLint and diff whitespace checks passed. Production build/full acceptance remain the next checkpoint, 8.4.7.
- The only replaced content was the one-heading Members/Roles placeholders: they had no functional design or controls. Existing Team table, invite form, tabs and security link remain. Temporary verification server stopped and tsconfig additions removed.

**8.4.5 evidence (2026-09-27):**

- Extended the original invite-member-form with fixed-role selection (Member default), SuperAdmin privilege explanation, duplicate-submit protection, and specific server feedback for duplicate invitations/existing accounts/delivery failures. Preserved the original trigger, expandable card, email input, icons, success card, Cancel and Invite Another User. Switched its submission to the structured action from 8.4.4 so errors can be shown safely in production.
- Added a SuperAdmin-only Pending invitations section below the unchanged member table: email, assigned role, UTC expiry, pending/expired status, empty state, Resend and confirmed Revoke/Cancel. Invitation data is fetched only for the authorized Team tab, using the authenticated backend list; Member/Developer receive no pending invitation data. Failed resend refreshes to show the inactive link and specific failure, while revoke removes the row.
- Direct event submission, ref guards, pending controls and document reload follow the working 8.3/8.4.3 production pattern. Optional five-minute per-tab feedback is scoped to workspace and actor; reload keeps the old form's success presentation and refreshes authoritative invitation state. No token or acceptance URL is exposed in management UI. Acceptance-page code/design remains untouched.
- Added invitation-management browser journey: selected-role invitation, actual private development preview, pending-button lock, duplicates/existing accounts, expired invitation resend, rotated/used/revoked link rejection, successful join as Developer, Member/Developer visibility restrictions, foreign-workspace invisibility, SuperAdmin warning, revoke cancellation/confirmation, and empty state. Production additionally tests provider failure during create/resend and invalidation of the previous link. Fixtures and their preview files are removed afterward.
- Edge journey passed in development; production invitation journey and existing member-management journey both passed. Production email delivery uses the explicit test-only `e2e/helpers/resend-preview.cjs` Node preload with fixture-only recipients and a sentinel credential; it captures outbound Resend calls locally and never sends real email. This is not evidence of live Resend delivery. Initial expiry fixture was corrected to a fixed past timestamp to avoid PostgreSQL/application timezone differences.
- Web TypeScript, targeted ESLint and production web build passed. Captured UI screenshots inspected. Temporary verification tsconfig additions removed. No previous design was deleted; route work remains 8.4.6 and final acceptance remains 8.4.7.

**8.4.4 evidence (2026-09-27):**

- Added authenticated invitation create/list/resend/revoke services and structured server actions. Ownership comes from the verified actor; writes and listing lock the tenant and recheck actor state/version/permission under membership/role locks. Lists omit token hashes. Foreign and absent IDs return the same error. Fixed-role validation, normalized emails, existing accounts (including inactive/foreign), duplicate/expired outstanding invitations, repeated form fields and forged ownership are enforced server-side. Existing invite form still uses its original call contract, routed through the new service.
- Resend preserves the assigned role, rotates the token hash, and invalidates the previous link immediately. Create/resend share ten attempts per workspace per 15 minutes plus the existing network limit. Revoke remains available when this budget is exhausted. No transaction billing gate is added.
- Delivery occurs outside database locks. New tokens are stored expired until delivery succeeds; activation checks the same tenant/id/token after rechecking the actor. Failure or process interruption leaves no usable replacement link. Failed creates conditionally remove only their own token row so the old form can retry; failed resends retain an expired row for another resend. A late send/failure cannot restore/delete a newer resend or revoked record. No raw token is returned to the caller.
- Acceptance now discovers the token's tenant, locks it, then re-reads/consumes the current unexpired token and creates the verified user atomically. Tests exercise both management-first and acceptance-first ordering. User uniqueness also prevents silently moving an existing account between workspaces.
- Migration `20260927000000_unique_invitations` normalizes invitation emails, keeps the newest outstanding row per workspace/email (createdAt then id tie-break), invalidates older links and creates the unique constraint. Migration tested in disposable schemas, including deduplication and cross-workspace preservation. Local preflight found **0 outstanding / 0 duplicate groups / 0 unnormalized**; migration applied successfully with no invitation deletion. Prisma client regenerated and database package built.
- Validation: **14 invitation PostgreSQL tests** (13 subtests plus parent), **13 account PostgreSQL**, **11 membership PostgreSQL**, **16 access**, **6 account**, and **10 membership-rule** tests passed. Updated legacy test doubles/call sites for the new authenticated service. Targeted ESLint, web TypeScript and production web build passed. Disposable schemas removed. No UI design changed; invitation browser journeys and UI controls remain 8.4.5, final regression 8.4.7. Live Resend delivery remains unverified; tests use a controlled mail boundary and existing preview/transport tests.

**8.4.3 evidence (2026-09-27):**

- Extended the existing Team table with active/inactive and email-verification status, fixed-role selection, explicit Save role, and inline deactivation confirmation/cancel. All previous columns, role badges, tabs and the original invite form remain. Renamed “Active Membership Log” to “Membership Log” because inactive accounts are also listed; no previous design was removed.
- Only SuperAdmin receives controls. Inactive members cannot be changed; the last eligible administrator is disabled with an explanation, while the server remains authoritative for stale pages. Self-change warnings explain sign-out and loss of login after deactivation.
- Mutations use explicit event submission with duplicate-submit protection and document navigation, matching the production-safe pattern established in 8.3. Successful non-self changes reload the roster with optional, five-minute, per-tab feedback scoped to tenant/member. Self-changes navigate to login. Errors display inline with a refresh link.
- Added `apps/web/e2e/member-management.spec.ts`: Member/Developer read-only roster, last-admin controls, role changes and fresh-role login, old-session rejection, confirmation cancellation, disabled pending controls under a real PostgreSQL tenant lock, deactivation/inactive status, self-demotion/sign-out, and last-admin rejection from a stale admin page. Temporary fixtures are removed in finally cleanup.
- Edge browser journey passed in development and production (one run each after correcting a test assertion to the existing backend error wording). Web TypeScript, targeted ESLint, and production web build passed. No migration or live email delivery is involved. Broader regression and release acceptance remain in 8.4.7; invitation backend remains next.

**8.4.1 contract and evidence:**

- Added `membership-rules.ts` with fixed-role schemas, strict UUID mutation payloads, normalized invitation email, 24-hour invitation expiry, existing-account/duplicate-invitation decisions and last-admin policy. Added SuperAdmin-only `members:manage` and `invitations:manage`; retained `members:invite`. Member/Developer keep workspace read access. Pending invitation lists/actions are admin-only; the member roster and fixed role matrix remain readable to workspace members.
- The future service derives tenant/actor from verified membership; forms never supply ownership, active state, token or admin count. Last-admin decisions count OTHER active, email-verified SuperAdmins in the same tenant. Self-demotion/deactivation is permitted only with another eligible admin. Inactive targets, unchanged roles and invalid policy state are rejected. Promotion does not make an unverified account count as an eligible replacement admin.
- Member writes will lock the tenant first, then recheck actor/target and count admins under the lock, following the lock order used by transaction writes. Change role/deactivate will increment the target's sessionVersion; deactivation also sets isActive=false. Old sessions must fail at the next protected request, including a write from an already-open tab. No hard deletion, reactivation, multi-workspace membership or custom roles in 8.4. Management is independent of transaction quota/billing; audit/lifecycle consolidation remains in 8.5.
- Existing-account email (including inactive/same-workspace accounts) blocks invitations without exposing the other workspace. At most one outstanding invitation per normalized email/workspace; an existing row, even expired, requires Resend. Resend keeps the assigned role, rotates the token hash and resets the 24-hour lifetime; role changes to an unaccepted invite require revoke/new invite. Revoke and acceptance invalidate/remove the outstanding row. Create/resend share the existing 10-per-workspace/15-minute email limit. The backend must recheck membership and serialize invite operations; these pure helpers alone do not enforce any race boundary.
- Schema assessment: User already has roleId, isActive and sessionVersion, so 8.4.2 needs no new member fields. Invitation already holds hashed token and expiry. Plan a unique `(tenantId, email)` constraint for 8.4.4, with normalized existing emails and duplicate-row review/cleanup before applying it; keep only the newest outstanding record per pair and invalidate older links. No delivery/status-history fields are required for MVP: failed resend must leave no usable new token and no restore of the old token, with retry through the same outstanding row. Exact migration and failure cleanup must be tested in 8.4.4, not applied here. External email is sent outside long-held DB locks; failure cleanup must match the token/version so it cannot invalidate a newer concurrent resend.
- Validation: **10 membership-rule tests** and **16 existing access tests passed**; web TypeScript and targeted ESLint passed. Added `npm run test:membership:rules`. No schema migration, application data write, member action or UI change. Existing invitation entry points are not yet switched to the new rules; atomic backend enforcement is intentionally pending 8.4.2/8.4.4.

**8.4.2 evidence (2026-09-27):**

- Added `manage-member.ts` and `settings/member-actions.ts` for role changes/deactivation. The server service authenticates independently, validates strict input and scopes target lookup to the verified actor's workspace. Missing and foreign IDs return the same error. Actions reject duplicate/extra form fields and return sanitized results with memberId/selfChanged; no UI is connected yet.
- Writes acquire the tenant lock first, then lock current membership rows in stable ID order and shared role rows. Actor verification, active state, sessionVersion and permission are checked again after waiting. Other active verified SuperAdmins are counted under those locks; competing self/cross-admin mutations cannot eliminate every administrator. A missing fixed-role row is provisioned safely when first assigned. Membership writes do not depend on transaction quota or subscription status.
- Role changes and deactivation increment target sessionVersion atomically; deactivation preserves user/history and sets isActive=false. Old sessions fail protected reads/writes; self-changes return selfChanged=true for the future UI to navigate to login. Non-self successes invalidate settings/member paths, with cache failure unable to misreport a committed mutation. There is no session polling or forced browser close: invalidation is enforced on the next protected request.
- Added `npm run test:membership:db`: **11 passing** (10 PostgreSQL subtests plus parent), using migrated disposable schemas and real locks/writes with mocked session transport. Covers missing-role provisioning, current/fresh-session permissions, preserved history, last-admin eligibility, concurrent admin removals, foreign/forged input, unauthorized actors, inactive/no-op targets, restricted billing, actor changes during lock waits, a queued transaction denied after deactivation, and rollback/error sanitization.
- Regression evidence: **10 membership rules**, **16 access-control**, and **17 transaction PostgreSQL** tests passed; web TypeScript and targeted ESLint passed. Test schemas were removed. No application migration, existing-user change, or design/UI change. Browser member controls are intentionally deferred to 8.4.3; invitation backend to 8.4.4; audit consolidation to 8.5.

- [x] Extend the existing settings member list with fixed-role changes and deactivation; prevent removing or demoting the last active administrator.
- [x] List pending invitations and support revocation/resending with token rotation and expiry. Validate invite email and allowed role on the server.
- [x] Handle duplicate invitations and existing-account emails explicitly. MVP retains one workspace per user; do not silently move existing accounts between tenants.
- [x] Deliver invitation email, consume acceptance tokens atomically, and ensure revoked/expired/used tokens cannot create accounts. Verified through local preview and controlled production transport; live Resend inbox delivery remains domain-dependent.
- [x] Implement or remove the placeholder `/settings/members` and `/settings/roles` pages so navigation does not lead to unfinished screens.

**Acceptance:** An admin invites a teammate, the teammate joins the correct workspace with the assigned permissions, and later deactivation blocks access even with an existing session.

#### Step 8.5: Make billing and audit behavior consistent

**Sequential plan:** One checkpoint per user continuation. Implement and verify that checkpoint, record evidence, then stop. Preserve the existing Company Profile, billing banner, Team, invite and transaction designs. Explain any necessary replacement. This plan introduces no application, schema or external Stripe changes.

**Current checkpoint:** 8.5.8 and Step 8.5 complete (2026-09-29). Real Stripe sandbox upgrade, failed payment, recovery and cancellation verified with user-assisted hosted UI and independent provider/database/audit checks. Stop here; Step 8.6 requires its own sequential plan. Natural month-end expiry and automatic CLI redelivery were not observed; see docs/BILLING_ACCEPTANCE.md for explicit verification boundaries.

**Repository findings:** Checkout currently passes customer_email instead of consistently reusing the workspace customer, and the portal can look up customers by email. Tenant stores customer identity and subscription status but no subscription identity. Webhook handling covers subscription created/updated and invoice payment failure, using a pre-transaction duplicate check; cancellation, recovery, competing subscriptions and stale event ordering need explicit handling. The shared transaction entitlement policy already exists and must remain the baseline. AuditLog and an event receipt table exist, but transaction/member services lack complete audit coverage and the current web audit helper swallows failures.

- [x] **8.5.1 — Billing and audit contracts.** Inspect installed Stripe SDK types, official documentation for the configured API version, existing environment configuration (without exposing secrets), and current tests. Define entitlement behavior for every state; immediate versus period-end cancellation; customer/subscription ownership; supported invoice/subscription events; retry/reconciliation policy; and checkout concurrency rules. Define the audit event matrix, actor attribution for users versus webhooks, allowed metadata, and failure behavior. Keep the current Free/Pro rules unless an explicit product change is needed. Document the minimal schema/migration requirements and write applicable pure contract tests. No external Stripe resource creation in this checkpoint.
- [x] **8.5.2 — Persistence and audit foundation.** Add only the schema fields/constraints required by the agreed contracts for subscription identity, checkout coordination and webhook processing/reconciliation. Provide a shared audit writer that accepts a verified actor or explicit system source and can participate in the same transaction as local changes. Local critical mutations must not silently commit without required audit records; external Stripe/email effects require durable attempt/outcome handling rather than pretending they can be rolled back. Test migration compatibility with existing tenants, ownership constraints and audit-write rollback behavior in disposable PostgreSQL schemas.
- [x] **8.5.3 — Customer, checkout and portal backend.** Resolve customers from verified tenant ownership; remove email-only customer adoption. Reuse/create customers safely, serialize competing checkout requests with durable idempotency, and define recovery for interrupted/expired checkout attempts. Prevent checkout from creating another subscription when an eligible/in-progress subscription already exists. Portal access remains SuperAdmin-only and available for billing recovery. Test double-clicks, concurrent admins, external failures, retries and cross-tenant attempts with a controlled Stripe boundary and real database locks.
- [x] **8.5.4 — Webhook lifecycle and ordering.** Keep raw-body signature verification. Resolve customer/subscription/invoice events against verified ownership and the configured API shape; handle upgrade, payment failure, recovery and deletion/cancellation. Apply entitlement changes, event receipts and system audit consistently. Use the agreed authoritative-state reconciliation/serialization strategy so duplicate, concurrent, delayed or equal-timestamp events and events from superseded subscriptions cannot restore stale access. Test actual signed HTTP payloads, transient failure/retry, both event orders and PostgreSQL races; do not rely only on event.created as an ordering guarantee.
- [x] **8.5.5 — Mutation audit coverage.** Wire audit records into transaction creation/status changes, member role changes/deactivation, invitation creation/resend/revoke/acceptance, and existing profile/API-key mutations. Record tenant, verified actor/system source, target, action, timestamp and approved before/after fields; exclude passwords, raw tokens, API keys and checkout/portal bearer URLs. Capture actors before self-session invalidation. Avoid duplicate audit records on retry and test mandatory-audit failure behavior, tenant isolation and redaction. Do not add an audit-history UI.
- [x] **8.5.6 — Billing UI and recovery journey.** Adapt the existing profile card and billing banner to the shared policy and synchronized billing state. Show the actual subscription/quota reason, pending checkout/synchronization, safe error feedback, and the appropriate upgrade/portal action. A checkout success URL alone must not grant Pro access. Keep reads, account recovery, membership management and billing recovery accessible while transaction writes are restricted. Verify admin/read-only roles and the existing design in development and production browser journeys.
- [x] **8.5.7 — Automated acceptance and handoff.** Run relevant rules, authorization, account/member/invitation/transaction regressions, real PostgreSQL concurrency, signed webhook integration and development/production browser suites. Run full web lint, TypeScript and database/web/API builds; verify migrations and document billing/audit setup, recovery, test fixtures and limitations. Controlled Stripe transport tests are explicit simulations, not evidence of real Stripe test-mode integration.
- [x] **8.5.8 — Real Stripe test-mode verification.** With usable test credentials, price, portal configuration and webhook forwarding, verify upgrade, payment failure, recovery and cancellation end to end, including resulting transaction permissions and correctly attributed audit records. Record actual evidence and cleanup only task-created test resources. No live charges or production billing changes. If configuration/access is unavailable, finish independent work and report this checkpoint as pending; do not mark all of 8.5 complete based solely on mocked events.

**8.5.1 evidence:** Added [billing/audit contract](docs/BILLING_AUDIT_CONTRACT.md), reviewed installed Stripe 22.3.0 types and pinned 2026-06-24.dahlia API against official documentation, and checked environment consistency without exposing secrets. Identified the existing invoice mapping mismatch (parent.subscription_details is required by the installed types); actual webhook fix remains 8.5.4. Defined entitlement, ownership, checkout recovery, fenced reconciliation, audit attribution/failure behavior and minimal migration requirements. Added pure billing helpers and `npm run test:billing:rules`: 7 new tests plus 12 transaction-rule and 16 access tests passed (35 total); standalone TypeScript passed. Helpers are not wired into application services yet. No migration, application mutation, UI change or Stripe account API call.

**8.5.2 evidence:** Added migration `20260928000000_billing_audit_foundation` for subscription identity, cancellation/sync/lease fields, durable external operations, event dispositions and explicit audit sources. Database constraints enforce unresolved customer/checkout uniqueness and tenant-scoped operation audit phases. Shared `writeRequiredAudit` validates allowlisted metadata and actor attribution, and fails the transaction when mandatory audit cannot persist. Disposable PostgreSQL migration/concurrency/rollback tests passed (13), along with account, invitation, membership, transaction and pure-rule regressions (106): **119 tests passed**. Database, API and production web builds passed. Local migration deployment/status passed; existing tenant/audit/receipt counts were preserved. No Stripe API call or UI change; service audit wiring remains 8.5.5.

**8.5.3 evidence:** Replaced email-based customer adoption and unconditional checkout creation with a shared billing service and narrow Stripe adapter. Server actions pass only freshly verified actors. Real tenant locks recheck membership/session version; durable leases fence late responses. Intent/outcome audit, stable idempotency keys, parameter fingerprints, owned-customer checks, subscription scans and verified checkout resume/expiry prevent competing purchases. Ambiguous attempts remain recoverable; old keys are not blindly replayed. Portal recovery remains administrator-only, independent of transaction entitlement and price configuration. Added 19 billing backend database checks and 4 adapter tests; updated action authorization coverage. All **142 tests**, web lint, database/API builds, web type checking and production web build passed. Existing UI is preserved; no new migration or remote Stripe account call. Completed-checkout/subscription binding and webhook lifecycle reconciliation remain 8.5.4; structured billing UI feedback remains 8.5.6.

**8.5.4 evidence:** Replaced the metadata-driven webhook with signed raw-body transport and shared authoritative reconciliation. Tenant customer bindings and verified durable checkout evidence govern canonical subscription changes. Pending event receipts remain retryable on provider/database errors, busy/stale leases and customer-binding races; status, cancellation schedule, operation outcomes, completed receipts and required audit commit atomically. Handles checkout completion/expiry, subscription create/update/delete/pause/resume and invoice paid/payment-failed/action-required using the pinned invoice parent shape. Equal/delayed events fetch current state; superseded subscriptions cannot overwrite the current binding. Added authenticated recovery and pre-checkout reconciliation, preserving existing UI. API Compose now receives the configured price and the API image builds shared services. All **162 tests passed**, including 20 signed HTTP/PostgreSQL reconciliation checks; web lint, database/API builds, web type checking, production web build and migration status passed. No new migration or remote Stripe account request. Broader mutation audit remains 8.5.5, billing feedback UI 8.5.6 and real Stripe test-mode acceptance 8.5.8.

**8.5.5 evidence:** Wired required audit into transaction creation/status changes, member role changes/deactivation, invitation create/resend/revoke/acceptance, profile edits and API-key generation/revocation. Critical local writes and audit commit together; fresh profile/key membership is rechecked after tenant lock waits. Self-session invalidation retains actor attribution. Invitation delivery now persists generation-specific intent before sending, activates only with required audit, and records provider acceptance/unknown outcomes without assuming email rollback. The former best-effort web audit helper now exposes the required writer and locked authorization helper. No UI layout or schema changes. All **177 tests passed** (15 new mutation audit PostgreSQL checks plus 162 regressions), web lint, web type checking and database/API/production-web builds passed. New test command: `npm run test:audit:db`; build the database package first. No real Stripe or Resend request; browser acceptance remains 8.5.7. Next: 8.5.6 only.

**8.5.6 evidence:** Preserved the Company Profile card, legal-name form, status badge, upgrade section, read-only notice and dashboard banner. Extracted billing controls into BillingPanel inside the original form; added lifecycle/quota reasons, pending checkout/synchronization, cancellation schedule, authenticated checkout/portal/reconciliation controls and safe inline failure feedback. A checkout return URL never changes entitlement. Only primitive presentation data crosses the client boundary. Added UI-policy tests and expanded structured-action authorization/error checks. Passed 9 billing-rule, 17 access and 17 transaction PostgreSQL tests (43 targeted checks), full web lint, TypeScript and production web build. Edge billing journey passed in development and production, including quota, all known statuses, admin/member boundaries, preserved profile save and recovery routes. Initial production fixture startup was corrected to supply EMAIL_FROM; no application change was required. Screenshots inspected after waiting for the profile panel. Browser tests explicitly use disabled Stripe configuration; successful provider operations remain covered by existing controlled backend tests, and hosted payment/portal/webhook integration remains 8.5.8. No live Stripe/Resend call or migration. See docs/BILLING_UI_TESTING.md. Next: 8.5.7 only.

**8.5.7 evidence (2026-09-29):** Inspected the staged diff and prior passed browser result; preserved all staged implementation and UI. All **180 Node tests passed** with sequential test-file execution, including account/membership/invitation/transaction regressions, real PostgreSQL concurrency and audit rollback, billing provider/service tests and signed webhook reconciliation. **6/6 Edge browser journeys passed in development (2.2 minutes)** and **6/6 in production (53.5 seconds)**, with billing explicitly enabled in the runner and disabled at the Stripe boundary. Production email used the fixture-only Resend preload, including failure recovery; no external email or Stripe request. Full web lint, web TypeScript, database/API builds and fresh production web build passed. Four migrations are applied; no new migration. No application fixes were needed. Corrected the missed 8.5.6 checkbox, completed the implementation checkboxes based on automated evidence, and added docs/BILLING_ACCEPTANCE.md with reproducible commands, recovery boundaries and the configuration required for 8.5.8. These results do not establish real Stripe acceptance; the overall 8.5 acceptance remains pending until 8.5.8. Temporary build includes were removed and the verification servers stopped.

**8.5.8 evidence (2026-09-29):** Read-only Stripe checks verified the active recurring Pro price and default test portal configuration. User-assisted Checkout/Portal on PT Demo Ns and independent Stripe/database queries verified Free -> Active (paid invoice), Active -> Past Due (forced USD 5 test invoice declined by card 0341), Past Due -> Active (hosted payment with card 4242), scheduled cancellation retaining Active, and Active -> Canceled after explicit API cancellation without invoicing/proration. The user confirmed restricted writes during Past Due, successful audited transaction creation after recovery, and final Canceled / 1-of-10 Free quota with history retained and creation available. Real signed webhooks applied transitions with Stripe-attributed audit; checkout intent and transaction audit retained user attribution. Concurrent 503/lease_busy receipts were recovered by retrieving original Stripe events and sequentially invoking the shared reconciler; no pending receipts remained, no duplicate subscription audit was added, and a delayed update could not restore Active after cancellation. This is not automatic CLI redelivery. Portal scheduling used cancel_at with cancel_at_period_end=false and was rendered correctly; natural month-end execution was not waited for. The subscription is canceled, both test invoices paid, and the inline one-time price inactive. Existing workspace/users, configured product/price and audit/test history are retained. No live-mode charge, application-code change or migration. Full evidence and limitations: docs/BILLING_ACCEPTANCE.md.

**Policy baseline:** active/trialing retain Pro transaction entitlement; free/canceled use the existing Free quota of ten stored transactions; incomplete/incomplete_expired/paused/past_due/unpaid/unknown states deny transaction writes. Cancellation scheduled for period end must follow authoritative subscription state rather than being treated as immediately canceled. Existing account, membership and billing recovery boundaries remain intact. Detailed provider mapping and edge cases are confirmed in 8.5.1.

**Out of scope:** New pricing tiers, monthly quota resets, custom roles, audit-history/filter/export UI, subscription-provider replacement, live payment collection, and whole-MVP deployment acceptance (8.6). Preserve completed 8.2–8.4 behavior and user-staged work. Do not advance to the next checkpoint automatically.

- [x] Reuse the tenant's Stripe customer and track its subscription identity; prevent repeated checkout from creating unintended duplicate subscriptions.
- [x] Define explicit entitlement handling for all subscription states, including trialing, incomplete, paused, canceled, past_due, and unpaid. Unknown states must not automatically grant Pro access.
- [x] Handle subscription deletion/cancellation and verify invoice-to-tenant resolution against the configured Stripe API version.
- [x] Verify duplicate, concurrent, and out-of-order webhook delivery cannot leave stale entitlements or duplicate effects.
- [x] Keep reads, account recovery, and billing recovery available when writes are restricted; show the actual quota or payment reason in the UI.
- [x] Wire authenticated actor IDs into audit records and cover transaction/member changes. Record tenant, actor, action, and timestamp without passwords or raw tokens; define behavior when audit persistence fails.

**Automated implementation checks and real Stripe test-mode acceptance are complete. Step 8.6 release-candidate acceptance remains separate.**

**Acceptance:** Stripe test-mode upgrade, payment failure, recovery, and cancellation produce the intended write permissions. Audit records identify the correct workspace and actor. Existing webhook signature verification remains covered.

#### Step 8.6: Verify and document the release candidate

**Current checkpoint:** 8.6.4 complete (2026-09-29) for local acceptance. Verification matrix: docs/RELEASE_ACCEPTANCE.md. Next continuation starts 8.6.5 only; Docker work is deferred while bandwidth is limited. Update 2026-10-05: the user confirmed real Resend verification/reset email delivery and Change password. Invitation delivery to another recipient and deployed email/webhook operations remain external prerequisites. Preserve existing UI and completed 8.2-8.5 implementation; fix only acceptance gaps or demonstrated defects.

**Baseline:** 8.5 passed 180 Node checks, six browser journeys in development and production, and user-assisted real Stripe sandbox verification. Reuse this evidence when applicable; do not repeat remote billing mutations without a concrete verification need. The root build currently omits the API. Compose currently defaults demo seeding to true and has fixed container names/host ports, so release smoke tests require explicit seed disabling and isolated resources. Real Resend inbox delivery remains unverified.

- [x] **8.6.1 - Release verification matrix.** Inspect the candidate commit/diff, existing tests and acceptance evidence. Map every original 8.6 requirement to an existing check or an explicit gap. Record environment prerequisites, fixture isolation and release blockers; distinguish local/simulated coverage from real service verification. Output a bounded acceptance matrix and identify only necessary follow-up work.
- [x] **8.6.2 - Complete new-company journey.** Verify one newly registered workspace through verification, login, transaction creation, invitation, acceptance, role restrictions and deactivation, including an already-open member session. Reuse existing browser helpers and add only missing assertions/journey coverage. Validate authoritative persisted results and relevant audit attribution, preserve existing design, and remove only task-created fixtures.
- [x] **8.6.3 - Authorization and tenant isolation.** Check server actions and API boundaries in addition to UI visibility: foreign-resource access, forged tenant/actor input, stale/deactivated sessions, role restrictions, last-admin protection and API-key revocation. Reuse existing PostgreSQL and access suites; fill meaningful uncovered cases and fix any failures before completing the checkpoint.
- [x] **8.6.4 - Recovery, quota and billing acceptance gaps.** Verify password recovery, expired/reused invitations, quota concurrency and billing recovery against the matrix. Reuse 8.5 real-provider evidence; explicitly assess concurrent webhook receipts and the documented manual replay limitation. Determine/document the deployed retry or operator recovery path without claiming automatic CLI redelivery was tested. If real email delivery is required for the selected release target, verify it with available Resend configuration or record that target as blocked, not passed. Preserve the distinction between automated acceptance and live inbox delivery.
- [ ] **8.6.5 - Clean deployment smoke.** Verify all migrations on a disposable empty database and Docker startup with SEED_DEMO_DATA=false, no seeded users/tenants and no dependency on seeded roles. Use separate container names, ports and volumes; never reset or delete the user's database/Stripe listener. Check web/API reachability, environment propagation, build-time versus runtime public URL, required secrets, and documented startup/restart behavior. Make only necessary orchestration/configuration fixes. No public deployment or live-mode billing changes.
- [ ] **8.6.6 - Final candidate regression.** Ensure the release build covers database, web and API explicitly, updating root orchestration if appropriate. Run required lint, TypeScript, applicable Node/PostgreSQL tests and development/production browser suites against the final candidate. Include opt-in billing tests with the correct disabled-provider server and fixture-only email transport. Repeat only checks affected by subsequent fixes, and record counts, failures/skips, migration status and candidate revision.
- [ ] **8.6.7 - Release documentation and exit gate.** Consolidate English setup, environment, migration, email, Stripe, Docker and recovery instructions with dated evidence and limitations. Reconcile the original checklist below with actual results. Mark MVP/release-candidate acceptance complete only when every required gate passes; explicitly distinguish production readiness from local/sandbox acceptance. Preserve open external prerequisites as blockers for the relevant target. Stop before deferred features or deployment.

**8.6.1 evidence:** Inspected candidate base 15a0b84 and existing coverage without rerunning completed suites. Added docs/RELEASE_ACCEPTANCE.md mapping every release requirement to tests, limitations and bounded follow-ups. Identified the combined registered-workspace/deactivation journey gap, real-PostgreSQL API-key HTTP integration gap, pending-webhook recovery runbook, root API-build omission, Docker build-time URL propagation and isolated seed-disabled deployment smoke. Node v24.11.1 is available; the read-only Docker probe could not establish engine access. Real Resend inbox delivery remains unverified. Documentation only; no application/UI change, database mutation, container startup or Stripe request.

**8.6.2 evidence:** Extended the existing account-lifecycle browser test on candidate base 15a0b84. The same UI-registered workspace now covers transaction creation/completion, password recovery/change, invite acceptance, Member read-only controls, admin deactivation, rejection of an already-open member session and rejection of a fresh login. Before cleanup, real PostgreSQL assertions verify the preserved transaction/owner, verified owner and inactive joined member, session-version increment, consumed invitation and exactly one correctly attributed audit for each core mutation. Edge journey passed in development (57.9 seconds) and production (19.7 seconds); web TypeScript, targeted ESLint and fresh production web build passed. Email used previews / the fixture-only Resend preload, with Stripe disabled. No application/UI/schema changes or real external provider requests; existing cleanup removed only the unique test fixtures. Temporary servers stopped and build includes removed. User reports Docker Desktop started; Docker smoke remains 8.6.5, and real Resend inbox delivery remains unconfigured/unverified.

**8.6.3 evidence:** Added real Express HTTP + migrated PostgreSQL API-key integration coverage and the test:api:db command. Actual key-management actions generate/revoke credentials; requests verify tenant filtering under concurrency, forged ownership rejection, stored-hash rejection, missing/invalid credentials, foreign revocation denial, fresh management authorization, immediate post-revocation denial and tenant-deletion invalidation. Audit assertions exclude credentials and verify attribution/idempotence. Database build and all 101 sequential related regression tests passed with zero failures/skips, covering transaction/member/invitation/billing authorization, last-admin races and audit rollback. Framework session/config/logging and existing email/provider fixtures remain explicit test boundaries. Disposable schemas cleaned up; no application/UI/migration changes or real provider calls. Existing browser isolation test retained; final browser regression remains 8.6.6.

**8.6.4 evidence:** 77 additional account, quota-policy and billing checks passed. Added a distinct-event lease-contention scenario and reran the complete signed webhook suite: 21/21 passed, zero failures/skips. Original-event redelivery completes the pending receipt without duplicate transition audit; authenticated status checking alone does not drain it. Reused unchanged 8.6.3 invitation/transaction/service/audit results and 8.5.8 sandbox evidence. Added docs/WEBHOOK_RECOVERY.md with diagnosis, registered-destination resend, read-only queries and success criteria. No application/UI/schema change or external provider mutation. Real Resend delivery and deployed webhook recovery remain unverified prerequisites for public readiness. Docker smoke and final regression remain open.

The original acceptance checklist below is closed only when supported by corresponding checkpoint evidence:

- [x] Run the full new-company journey: register → verify → sign in → create transaction → invite teammate → accept → verify role restrictions → deactivate teammate.
- [x] Cover password recovery, expired/reused invitations, last-admin protection, cross-tenant reads/writes, API-key revocation, quota concurrency, and billing lifecycle behavior.
- [x] Retain the existing tenant-isolation browser test and expand beyond UI visibility to server actions and API authorization boundaries.
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
