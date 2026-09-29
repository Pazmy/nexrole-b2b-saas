# Nexrole B2B SaaS Monorepo

Nexrole is a modern, multi-tenant B2B SaaS application boilerplate configured as an npm workspaces monorepo. It features a Next.js web application, an Express.js API server, and a shared Prisma database access package.

For MVP scope, implementation priorities, and release acceptance criteria, see [BUILD_PLAN.md](BUILD_PLAN.md#phase-8-mvp-workflow-completion--release-acceptance). Phase 8 tracks remaining work; earlier phases describe the existing foundation.

For onboarding, local email previews, existing-account verification, and the final Resend setup checklist, see [Account setup and verification](docs/ACCOUNT_SETUP.md).

---

## 🚀 Architecture Overview

The repository is structured as a monorepo under `apps/` and `packages/`:

```
nexrole-monorepo/
├── apps/
│   ├── web/          # Next.js 16 Web Application (Frontend)
│   └── api/          # Express.js API Server (Backend)
└── packages/
    └── database/     # Prisma & PostgreSQL shared database client
```

### Components

#### 1. Web Application (`apps/web`)

- **Framework:** [Next.js 16](file://nexrole-b2b-saas/apps/web) (App Router)
- **Styling:** Tailwind CSS & Shadcn UI
- **Authentication:** NextAuth.js (v5) with custom credentials-based sign-in and middleware guards ([auth.ts](file://nexrole-b2b-saas/apps/web/src/auth.ts))
- **Views & Routes:**
  - Login & Registration ([login/page.tsx](<file://nexrole-b2b-saas/apps/web/src/app/(auth)/login/page.tsx>))
  - Workspace invitations registration page
  - Dashboard Layout & Subroutes ([dashboard/layout.tsx](<file://nexrole-b2b-saas/apps/web/src/app/(dashboard)/layout.tsx>))
  - Multi-Tenant Transactions list
  - Advanced Settings ([settings/page.tsx](<file://nexrole-b2b-saas/apps/web/src/app/(dashboard)/settings/page.tsx>)):
    - **Profile/Organization Settings**: Update tenant name.
    - **Stripe Subscription/Billing Management**: Upgrade subscription to Pro, redirect to Stripe Billing Portal to resolve delinquent/past_due states.
    - **Workspace Members & Roles**: Generate secure member invitation links with expiry times.
    - **Developer API Keys**: Manage/revoke SHA-256 hashed API keys for programmatic access.
- **Billing / Guard Limits** ([billing-guard.ts](file://nexrole-b2b-saas/apps/web/src/lib/billing-guard.ts)):
  - **Free Tier limit**: Capped at a maximum of 10 transactions.
  - **Pro Tier limit**: Unlimited transaction logging.
  - **Delinquency Gate**: Instantly locks account mutations if the subscription is flagged as `past_due` or `unpaid`.

#### 2. API Server (`apps/api`)

- **Framework:** [Express.js (TypeScript)](file://nexrole-b2b-saas/apps/api)
- **Entry Point:** [server.ts](file://nexrole-b2b-saas/apps/api/server.ts)
- **API Endpoints:**
  - `/health`: System heartbeat.
  - `/api/v1/transactions` (requires API key auth via header): Machine-to-machine transaction history export.
  - `/api/webhooks/stripe` (requires raw body parsing): Webhook endpoint listening for cryptographically signed Stripe transactions.
  - Routes are defined in `apps/api/app.ts`; `server.ts` starts the listener and handles shutdown.
  - The unused `/api/users` and `/api/transactions` routes have been removed and return 404. Auth.js browser sessions are not Express Bearer tokens. Web reads and actions use Prisma on the Next.js server; integrations use `X-API-Key`.

#### 3. Database Package (`packages/database`)

- **ORM:** Prisma 7 with PostgreSQL
- **Source:** [packages/database](file://nexrole-b2b-saas/packages/database)
- **Database Driver:** `@prisma/adapter-pg` using a pooled connection configuration (`pg` driver).
- **Schema Models** ([schema.prisma](file://nexrole-b2b-saas/packages/database/prisma/schema.prisma)):
  - **Tenant**: Multi-tenant database boundary context (stores Stripe Customer mappings and subscription statuses).
  - **Role**: RBAC access definitions (e.g., `SuperAdmin`, `Manager`, `Viewer`).
  - **User**: Customer accounts linked to Tenants and Roles.
  - **Transaction**: Tenant-bound transaction data.
  - **Invitation**: Temporary registration tokens for joining specific organizations.
  - **ApiKey**: Secure SHA-256 hashes of developer credentials.

### Access control (MVP Step 8.1)

Web operations use `requirePermission` in `apps/web/src/lib/authorization.ts`. Each protected page/action checks the authenticated user ID and tenant against current active database membership. Auth.js also refreshes the database role and invalidates sessions for inactive/deleted users or a changed tenant. Client-provided roles and tenant IDs do not authorize operations.

| Operation | SuperAdmin | Member | Developer |
| --- | --- | --- | --- |
| Read workspace, member directory, and transactions | Yes | Yes | Yes |
| Create transactions or change their status | Yes | No | No |
| Update organization or invite members | Yes | No | No |
| View API-key metadata, create/revoke keys | Yes | No | No |
| Open Stripe checkout or billing portal | Yes | No | No |

`SuperAdmin` is a workspace administrator, not a cross-tenant administrator. Unknown roles are denied. `permissions.ts` is the fixed MVP permission matrix; the database `Role.permissions` JSON is not used for custom grants. Invitation role assignments are restricted to these three roles.

API keys are separate workspace credentials with read-only transaction export access. They are not tied to an individual user's session or activity status; revoke the key to remove integration access. Key hashes remain server-side, and only administrators receive key metadata in the settings UI.

Run `npm run test:access` from the repository root for the access-control regressions. They execute the real guards, Auth.js callbacks, server actions, and Express HTTP routes with mocked database/session/Stripe boundaries; no database credentials are required. Browser and live-database acceptance remains part of the MVP release checks.

### Transaction rules (Step 8.3.1)

The shared contract lives in `apps/web/src/lib/transaction-rules.ts` and `transaction-entitlements.ts`. Step 8.3.1 defines the rules; creation is implemented in 8.3.2/8.3.3, details/status updates in 8.3.4, and list/dashboard integration in 8.3.5 below. Step 8.3 acceptance passed on 2026-09-26; see 8.3.6 below.

- Amounts use USD, from `0.01` to `99999999.99`, supplied as decimal text with at most two fractional digits. Accepted values normalize to two decimal places without floating-point rounding. Currency symbols, grouping separators, exponent notation, zero, negative values, and excess precision are rejected.
- Descriptions are trimmed and must contain 1–500 characters. Creation accepts only description and amount; tenant, actor, currency, and initial status cannot be supplied by the client. New records will start `pending`.
- The only status transitions are `pending → completed` and `pending → failed`. Terminal states cannot reopen or change to another terminal state; repeated transitions are rejected.
- Only SuperAdmin has `transactions:create` and `transactions:update-status`. All three known roles retain tenant-scoped read access.
- `free` and `canceled` allow up to 10 stored transactions. The limit blocks creation only; an administrator can still update an existing transaction's status at or above the limit. `active` and `trialing` explicitly qualify for Pro without a transaction-count limit. `past_due`, `unpaid`, `incomplete`, `incomplete_expired`, `paused`, missing and unknown statuses deny transaction writes.

Run `npm run test:transactions:rules` for the contract and query tests. These are pure rules, not authorization or concurrency enforcement by themselves: The creation/status services read current state inside the atomic write boundary. The dashboard billing summary uses the same entitlement policy as of Step 8.3.5. Stripe lifecycle/webhook changes remain in Step 8.5.

### Transaction creation backend (Step 8.3.2)

The server action is `apps/web/src/app/(dashboard)/transactions/create-action.ts`. It accepts FormData with `description` and `amount`, and returns a typed success result containing `transactionId` or a safe error code/message. React's internal action metadata is ignored; duplicate fields and extra application fields are rejected. The form added in 8.3.3 calls this action.

The server-only service `apps/web/src/lib/create-transaction.ts` authenticates the caller itself. It takes a PostgreSQL tenant-row lock, rechecks current membership/session/role under shared locks, then checks billing and counts all stored transaction statuses before insertion. This serializes concurrent creators per workspace. The Free limit blocks the eleventh stored record even when different administrators submit simultaneously; eligible Pro workspaces are not count-limited. Direct SQL/seed scripts are outside this application guard; all application creation paths must call this service.

Run `npm run test:transactions:db` with PostgreSQL available. Like the account database suite, it uses `TEST_DATABASE_URL` or `packages/database/.env`, creates and migrates a random `transaction_test_*` schema, tests real concurrent writes, and removes only that schema afterward. Its user session transport is mocked; database permissions, locks and transactions are real. No changes to the application schema or existing records are required for this checkpoint.

### Transaction creation UI (Step 8.3.3)

1. Start the application and sign in as a verified SuperAdmin. Local email previews from Step 8.2 are sufficient; a Resend domain is not required.
2. Open `/transactions`, choose **New transaction**, enter a description and an amount such as `12.50`, then choose **Create transaction**. Controls disable while saving; success refreshes the list and usage count. The new row starts as **pending**.
3. With search/status filters or pagination active, the new row may be hidden. Choose **View latest transactions** to open the unfiltered first page. Choose **Create another transaction** for a blank form.
4. Try `0` or `12.345`: an error appears and the description stays entered. Cancel closes the form without a write.
5. On Free, creation disables at 10 stored transactions across all statuses. If another administrator fills the quota while a form is open, submission returns a server error and refreshes the usage hint. Eligible Pro permits more than 10; restricted subscriptions show a billing link and disable creation.
6. Sign in as Member or Developer: the existing ledger remains readable and the creation form is absent. Detail/status behavior is documented in 8.3.4 below.

Automated browser coverage: with the local web server running and `DATABASE_URL` in `apps/web/.env`, run `npx playwright test e2e/transaction-creation.spec.ts` from `apps/web`. Set `PLAYWRIGHT_BASE_URL` if the server uses another port and `PLAYWRIGHT_CHANNEL=msedge` to use installed Edge. This test uses the application's local database, creates a unique test workspace and verified users, and deletes its fixture workspace/transactions afterward. It also checks stale quota, pending controls under a real database lock, billing restrictions, Pro creation, and Member visibility. Use a local test database.


---

### Transaction details and status (Step 8.3.4)

1. Sign in as SuperAdmin, open `/transactions`, and click a transaction description. Details show the exact USD amount, status, timestamps, and transaction ID.
2. For a Pending transaction, choose **Completed** or **Failed**, then **Save status**. Controls disable during saving. After success, the final status is displayed and further edits are unavailable. Return to the list to see the updated status.
3. Open the same Pending transaction in two tabs. Save Completed in the first, then submit Failed from the second. The second receives a conflict and refreshes to the committed status; it cannot overwrite the first update.
4. At or above the Free limit of 10 stored transactions, existing Pending transactions can still change status. Restricted billing blocks status changes but leaves details readable.
5. As Member/Developer, open a transaction: details remain readable, with no status form. An invalid, missing, or other workspace's ID shows the same not-found view.

The server rechecks verified membership, role and billing inside the write transaction and uses a conditional Pending-only update. Terminal statuses cannot reopen or switch. Run `npm run test:transactions:db` for creation/detail/status isolation and concurrency coverage. The browser command in 8.3.3 also covers this detail/status journey, including stale tabs and pending controls. No migration or Resend setup is needed for the local preview journey. Final build/regression evidence is recorded in 8.3.6.

### List and dashboard integration (Step 8.3.5)

1. Search by description and select a status, then Apply. Pagination preserves both filters. Clear resets the list; browser Back restores the earlier filter values.
2. Try `?page=-1&status=unknown`: invalid page/status values fall back to page 1/all statuses. Repeated parameters fall back to defaults, and searches are trimmed to 500 characters. A page beyond the result count displays the last available page. Pagination links use the effective page; the original manually entered URL is not rewritten.
3. Search for a description with no matches to see filtered-empty guidance. An empty workspace shows a separate first-transaction message. Route loading and filter submission provide progress feedback; unexpected page errors retain the existing retry/home card.
4. Create a Pending transaction, then visit Overview: total and Pending counts increase. Mark it Completed and return: Pending decreases, Completed and Total Revenue increase. Marking Failed reduces Pending without adding revenue. Revenue is the sum of completed transactions; the old fixed growth percentage is removed because monthly analytics are deferred.
5. At the Free quota, the banner explains that only creation is blocked. Restricted subscription states show a write-restriction banner while reads remain available. Review Billing Settings opens settings; Member/Developer see guidance to contact an administrator.

The existing browser test covers list/filter/dashboard integration as well as the earlier transaction journey. The original card/table/filter design is retained. The timestamp heading now correctly describes creation time. Error text uses a reference instead of showing raw exception details.

### Final transaction acceptance (Step 8.3.6)

Step 8.3 passed on 2026-09-26: 64 reported regression tests, all three development browser scenarios, production transaction checks repeated twice, production tenant isolation, lint, TypeScript and database/web/API builds. Detailed evidence and scope limits are in `BUILD_PLAN.md`.

Transaction submissions now reload the page after a successful write or a quota/billing/status conflict. This avoids an observed production-only React/Next transition hang after complete action responses (similar symptoms are reported in [Next issue #97990](https://github.com/vercel/next.js/issues/97990)). The existing feedback card and rejected input are retained in tab-local session storage for up to five minutes, scoped by workspace/transaction; Close or Create another clears creation feedback. Validation errors retain the current form without a reload. If session storage is disabled, the data still reloads but feedback cannot survive the reload. No writes are automatically retried.

To repeat acceptance from the repository root, run `npm run test:access`, `npm run test:accounts`, `npm run test:transactions:rules`, `npm run test:accounts:db`, `npm run test:transactions:db`, `npm run lint`, `npm run build`, and **`npm run build -w apps/api`** (the root build omits API). With the development web server running in email preview mode, run `npm run test:e2e`; `PLAYWRIGHT_BASE_URL` and `PLAYWRIGHT_CHANNEL=msedge` select the local server and installed Edge. Browser tests use disposable local workspaces, not the seeded demo accounts.

For production, supply the real HTTPS `NEXT_PUBLIC_APP_URL` **before building** as well as at startup. Configure Auth.js to trust the known deployment host/proxy (`AUTH_TRUST_HOST=true` was used only for the local smoke server). Email preview mode is rejected in production; configure real Resend credentials and sender before deployment. The production smoke used dummy process-only email configuration with already-verified fixture accounts and sent no emails. Real Resend delivery remains unverified; follow the [live email checklist](docs/ACCOUNT_SETUP.md#final-action-after-resend-is-ready-configure-and-verify-live-delivery) once the domain is ready. Step 8.4 and later MVP work remain separate.

---

### Membership rules (Step 8.4.1)

Step 8.4 is complete, including final application acceptance. Shared rules/permissions, member management, invitation backend/UI and members/roles routes are ready. Run `npm run test:membership:rules` for the contract tests. Live Resend delivery still requires domain setup and the separate inbox verification checklist.

- SuperAdmin manages members and invitations. Fixed roles remain SuperAdmin, Member and Developer; other roles cannot grant themselves management rights. Member/Developer can read the roster and role matrix, but pending invitations are admin-only.
- The last active, email-verified administrator cannot be demoted/deactivated. Self-changes require another eligible admin. Services must count other admins and perform the write under the same tenant lock; the pure rule helper is not concurrency enforcement.
- Role changes and deactivation will invalidate existing sessions. Deactivation preserves the account and transaction history. Reactivation, deletion and workspace transfers are outside this step.
- Invitation emails normalize to lowercase. Existing accounts cannot be invited into another workspace. Existing outstanding invitations, including expired ones, use Resend rather than duplicate creation. Resend rotates the token and extends expiry to 24 hours; old/revoked/used tokens cannot be accepted. Create/resend share the existing email rate limit.
- No member schema change is needed. Invitation uniqueness is enforced by migration `20260927000000_unique_invitations`, applied locally in 8.4.4. Real email delivery can remain on local preview during development.

### Member management backend (Step 8.4.2)

`apps/web/src/lib/manage-member.ts` exposes authenticated server-only role-change and deactivation services. `settings/member-actions.ts` accepts FormData: role changes require `id` and `role`; deactivation requires only `id`. Extra ownership/state fields and duplicate fields are rejected. The backend returns a safe error or success with `memberId`, `selfChanged`, and a message. The Team table now exposes these controls to SuperAdmin.

Each mutation locks the tenant before membership rows, rechecks the current actor and counts other active verified administrators. Self-demotion/deactivation requires another eligible administrator. Both changes invalidate the target's old sessions through sessionVersion; deactivation also disables the account without deleting transaction history. Changes take effect at the next protected request, including submissions from already-open tabs. The UI sends a self-changed actor to login. Billing restrictions do not prevent member management.

Run `npm run test:membership:db` with `TEST_DATABASE_URL` or `packages/database/.env`. The suite creates/migrates a random `membership_test_*` schema, exercises real database locks and concurrency with mocked session transport, then removes its schema. No application migration or seed reset is needed.

### Member management UI (Step 8.4.3)

Open **Settings → Team Members** (`/settings?tab=team`) as SuperAdmin. The existing table retains its email, role badge and enrollment date and adds account status and management controls. Choose a role and press **Save role**, or choose **Deactivate** and confirm/cancel. Inactive accounts remain visible. Member/Developer see the roster without management controls.

The last active, verified admin cannot be changed until another member is promoted to SuperAdmin. Self-changes sign you out; deactivation prevents login. Other affected users lose access on their next protected request. Successful changes reload the roster and show temporary per-tab feedback; errors offer a refresh link. The existing invitation form remains intact.

Browser verification: with the local web server and PostgreSQL running, execute `npm run test:e2e -w apps/web -- e2e/member-management.spec.ts` (set `PLAYWRIGHT_BASE_URL` for a non-default port and `PLAYWRIGHT_CHANNEL=msedge` for installed Edge). The test creates and removes dedicated fixture accounts. This journey passed against both development and production; TypeScript, targeted lint and the production build also passed.

### Invitation backend (Step 8.4.4)

`apps/web/src/lib/manage-invitation.ts` provides SuperAdmin-only create/list/resend/revoke services. `settings/invite-action.ts` exposes structured FormData actions (`email` + fixed `role` for create; `id` for resend/revoke). The original invite form now uses the structured create action while retaining its design. Pending-list and resend/revoke UI are connected in 8.4.5.

Only one outstanding invitation may exist per normalized email/workspace, including expired invitations. Use resend to rotate its token and renew its 24-hour lifetime, or revoke and create again to change its assigned role. Existing accounts cannot be reinvited or moved. Create/resend share ten attempts per workspace per 15 minutes; revoke has no email-budget dependency.

New tokens stay expired while email delivery is pending. Successful delivery activates only the still-current token. Failed creates can be retried; failed resends retain an expired row for another resend and never restore the old link. If sending finishes after another resend/revoke, the service reports that the invitation changed. If a process stops before activation, refresh the list and resend the expired invitation. Acceptance and management serialize on the tenant lock, so revoked/replaced/used links cannot create an account.

For another environment, review outstanding invitation duplicates and back up the database before `npx prisma migrate deploy` from `packages/database`. The migration keeps the newest row per workspace/email (createdAt, then id for ties); older links become invalid. Local preflight found no outstanding invitations, so local application deleted none. Regenerate the database package with `npm run build -w packages/database` after schema changes.

Run `npm run test:invitations:db` with `TEST_DATABASE_URL` or `packages/database/.env`. It uses a disposable migrated schema, real PostgreSQL locks, and a controlled mail transport; all **14 tests** passed. Account/membership/access regressions, TypeScript, targeted lint, database package build and production web build also passed. Live Resend delivery still requires the domain setup and email checklist described earlier.

### Invitation UI (Step 8.4.5)

As SuperAdmin, open **Settings → Team Members** and use the existing **Invite Workspace Member** form. Choose Member (default), Developer or SuperAdmin, then send. The existing success card remains, and the new Pending invitations table shows email, assigned role and UTC expiry. Member/Developer cannot see or manage pending invitations.

Use **Resend** to replace the previous link and renew its 24-hour expiry. Use **Revoke → Confirm revoke** to invalidate an invitation, or Cancel to keep it. To change an invitation's role, revoke and create again. Delivery failures show explicit feedback; failed resends leave no active link and can be retried. The member table and invitation acceptance design are unchanged.

For development testing, start the web server with `EMAIL_MODE=preview` and the matching `NEXT_PUBLIC_APP_URL`. Run `npm run test:e2e -w apps/web -- e2e/invitation-management.spec.ts`, setting `PLAYWRIGHT_BASE_URL` for another port and `PLAYWRIGHT_CHANNEL=msedge` for installed Edge. The journey reads only its own private preview emails, joins a fixture account, checks role/access, resends/revokes, and cleans up fixtures/previews. It requires no domain or Resend account.

Production verification passed with the same journey plus delivery failures and the existing member-management journey. The local test server used `EMAIL_MODE=resend`, `RESEND_API_KEY=re_e2e_preview`, a fixture sender, and `node --require ./e2e/helpers/resend-preview.cjs ../../node_modules/next/dist/bin/next start --port 3100` from `apps/web`, with the existing production build/host settings. Set `E2E_RESEND_STUB=true` only in the test runner to include failure cases. This explicit preload accepts fixture recipients only and captures the Resend HTTP boundary into private previews; it is never imported by the application or used for deployment. Live Resend delivery still requires the separate domain/email verification checklist. TypeScript, targeted lint and production build also passed.

### Members and roles routes (Step 8.4.6)

`/settings/members` redirects to the existing Team Members tab. In Settings, **View role permissions** opens `/settings/roles`, showing the fixed permission matrix for SuperAdmin, Member and Developer. All active verified workspace roles can read it; anonymous/invalid sessions go to login. **Back to Team Members** returns to the existing roster.

The matrix reads the same permission rules used by the backend. Member and Developer currently share read-only access; API-key, membership and billing management are SuperAdmin-only. This page does not edit or create custom roles. Only the previous one-heading route placeholders were replaced; the existing settings design and controls remain.

The extended `e2e/member-management.spec.ts` passed in Edge development, covering both route guards, redirect, navigation and matrix access for all roles alongside the existing membership journey. Web TypeScript and targeted lint also passed.

### Final membership acceptance (Step 8.4.7)

Step 8.4 completed on 2026-09-27. **99 Node tests passed**, including real PostgreSQL concurrency/isolation coverage. All **five Edge journeys passed in both development and production**: accounts, invitations, members/routes, tenant isolation and transactions. The invitation journey follows the same account from invitation and joining through a role change and deactivation, checking already-open sessions after both changes. Production transport is simulated locally; no live Resend delivery is claimed.

Full web lint, database package build, production web build/TypeScript and API TypeScript build passed. All three database migrations are applied locally. Existing designs remain intact; only the two original heading-only route placeholders were replaced during 8.4.6.

Use the [membership demo and testing guide](docs/MEMBERSHIP_TESTING.md) for step-by-step local verification without a domain and the final checks after Resend is ready. The next implementation step is **8.5: billing and audit consistency**, requiring its own sequential plan. Whole-MVP release acceptance remains 8.6. See `BUILD_PLAN.md` for detailed evidence and boundaries.

## 🛠️ Getting Started & Setup

Follow these steps to set up the project locally:

### 1. Prerequisites

Ensure you have the following installed on your system:

- **Node.js** >= `22.15.0` (as specified in `package.json`)
- **PostgreSQL** database running locally or hosted online
- **Stripe CLI** (for testing webhook integration and mock billing status changes)

### 2. Environment Configuration

Create a `.env` file in the **root** directory of the project:

```env
DATABASE_URL="postgresql://<username>:<password>@localhost:5432/<db_name>?schema=public"
AUTH_SECRET="f6c8d20387b3a4f6be4e3f898e0e84b8d789060ab725c4ef6a72b89d5a71df5c" # Generate with `openssl rand -base64 32`

NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
EXPRESS_API_URL=http://localhost:5000

# Stripe Setup
STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."
STRIPE_PRO_PRICE_ID="price_..."
```

### 3. Install Dependencies

Run `npm install` at the root folder to download and symlink all dependencies across the workspaces:

```bash
npm install
```

### 4. Database Setup

Once your PostgreSQL instance is running and configuration is complete, execute the database setup commands:

```bash
# Generate the Prisma client code
npm run db:generate

# Sync schema and push to database (creates tables, indexes, and constraints)
npm run db:push

# Seed the database with default metadata, tenant, and superadmin credentials
npm run seed -w packages/database
```

#### Seeding Credentials

Seeding generates:

- **Role:** `SuperAdmin`
- **Tenant (Company):** `Sensei Corp` (configured as standard `active` subscription)
- **Admin Account:**
  - **Email:** `admin@sensei.com`
  - **Password:** `admin123`
  - **Transactions:** 15 pre-configured mock transaction logs (meaning this tenant defaults to usage-limit locked if subscription status is set to `free` or `canceled`).

### 5. Stripe Webhook Local Routing Setup

To handle upgrades, renewals, and payment failures locally:

1. Log in to the Stripe CLI:
   ```bash
   stripe login
   ```
2. Start forwarding events to your local API server:
   ```bash
   stripe listen --forward-to localhost:5000/api/webhooks/stripe
   ```
3. Copy the outputted webhook signature secret (starts with `whsec_`) and insert it in the `.env` file as `STRIPE_WEBHOOK_SECRET`.

### 6. Build Shared Packages

Compile the database client TypeScript code so that the Express and Next.js applications can import the `@nexrole/database` module properly:

```bash
npm run build
```

### 7. Launch Development Servers

Start all applications concurrently in development mode:

```bash
npm run dev
```

- **Web UI (Next.js):** [http://localhost:3000](http://localhost:3000)
- **API Endpoint (Express):** [http://localhost:5000](http://localhost:5000)

---

## 💻 Available CLI Scripts

Execute these scripts from the monorepo root:

| Command                                     | Action                                                                 |
| :------------------------------------------ | :--------------------------------------------------------------------- |
| `npm run dev`                               | Runs development servers for both API and Web workspaces concurrently. |
| `npm run build`                             | Compiles typescript code and builds all workspaces for production.     |
| `npm run lint`                              | Lints the workspaces to ensure code style consistency.                 |
| `npm run db:generate`                       | Generates the Prisma client library locally.                           |
| `npm run db:push`                           | Synchronizes the database schema with the PostgreSQL state directly.   |
| `npm run seed -w packages/database`         | Seeds the database using the seed configuration script.                |
| `npm install <package-name> -w apps/web`    | Installs a node module safely in the Next.js workspace.                |
| `npm install -D <package-name> -w apps/api` | Installs a development library inside the Express workspace.           |

## Local Docker demo

With the root `.env` configured, run:

```sh
docker compose up --build -d
```

Compose waits for PostgreSQL, runs pending Prisma migrations in the one-off
`db_init` service, and seeds demo data if there are no tenants, users, or roles.
The API and web app start only after initialization succeeds. `db_init` showing
`Exited (0)` is expected. Inspect initialization with `docker compose logs db_init`.

Open http://localhost:3000 and sign in as `admin@sensei.com` or
`admin@glowstone.io`, using password `admin123` for either newly created account.
The PostgreSQL volume preserves data across rebuilds; automatic seeding skips
populated databases. Set `SEED_DEMO_DATA=false` in the root `.env` for deployments
that should not create demo accounts. Migrations still run with seeding disabled.

The initializer uses the web image, so rebuild after changing migrations or seed
code. For normal starts with current images, use `docker compose up -d`.
Running the seed manually without `--if-empty` replaces the demo tenants'
transactions; it is not part of normal startup.

### Billing and audit backend (Steps 8.5.1-8.5.5)

The sequential 8.5 plan is recorded in BUILD_PLAN.md; checkpoint 8.5.5 is complete. See [Billing and audit contract](docs/BILLING_AUDIT_CONTRACT.md) for entitlement, ownership, recovery and audit rules, plus the implemented persistence foundation. The additive migration preserves existing billing states and records; it does not contact Stripe or attach subscriptions automatically.

Run `npm run build -w packages/database` before `npm run test:billing:db` to generate the matching Prisma client and shared audit module. Database tests use disposable schemas in TEST_DATABASE_URL (or the configured database fallback). Run `npm run test:billing:rules` for pure contract tests. Deploy migrations using `npx prisma migrate deploy` from packages/database; do not substitute schema push, because the migration includes partial indexes and check constraints.

Checkout and portal actions now use verified tenant customer bindings, durable attempts, mandatory billing audit and guarded recovery. Run `npm run test:billing:provider` for the Stripe adapter tests; `npm run test:billing:db` covers both persistence and backend behavior against disposable PostgreSQL schemas. These tests replace Stripe calls with a controlled provider and do not contact your Stripe account.

The webhook now reconciles current provider state and binds subscriptions only through verified customer/checkout ownership. Run `npm run test:billing:webhook` after building the database package for signed HTTP tests against disposable PostgreSQL schemas. Stripe response data is controlled in these tests; no Stripe account is contacted. See the [recovery and checkpoint notes](docs/BILLING_AUDIT_CONTRACT.md#checkpoint-854-webhook-lifecycle-and-reconciliation).

Both web and API need the same Stripe account/mode and Pro price. The API additionally requires its matching webhook signing secret. Docker Compose passes the price to both services, and the API image compiles shared database services from source. Restart/rebuild the API when applying these changes.

Checkout retries run authenticated reconciliation first. Legacy mappings without trusted checkout evidence and permanent ownership conflicts still require review; they are never adopted by email or tenant metadata alone. Portal recovery remains available for a verified customer. Required audit now covers transactions, membership/invitations, profile edits and API-key mutations. Local changes roll back when audit fails; invitation delivery retains durable intent and requires a new token generation after an unconfirmed activation. Run `npm run test:audit:db` after building the database package. See the [audit integration and recovery notes](docs/BILLING_AUDIT_CONTRACT.md#checkpoint-855-mutation-audit-coverage). The existing billing profile UI now includes lifecycle/quota status, pending checkout, cancellation and recovery feedback. See the [billing UI journey and local test setup](docs/BILLING_UI_TESTING.md). Automated acceptance (8.5.7) passed: 180 Node tests and six browser journeys in both development and production, plus lint, types, builds and migration checks. See the [acceptance handoff](docs/BILLING_ACCEPTANCE.md). Real Stripe test-mode acceptance (8.5.8) also passed with user-assisted hosted Checkout/Portal: upgrade, payment failure, recovery, scheduled cancellation and effective cancellation. Webhook/database/audit checks and final Free quota were verified. See the handoff for manual event-replay and forced-cancellation boundaries. Step 8.5 is complete; Step 8.6 remains separate.
