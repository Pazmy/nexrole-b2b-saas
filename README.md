# Nexrole B2B SaaS Monorepo

Nexrole is a modern, multi-tenant B2B SaaS application boilerplate configured as an npm workspaces monorepo. It features a Next.js web application, an Express.js API server, and a shared Prisma database access package.

For MVP scope, implementation priorities, and release acceptance criteria, see [BUILD_PLAN.md](BUILD_PLAN.md#phase-8-mvp-workflow-completion--release-acceptance). Phase 8 tracks remaining work; earlier phases describe the existing foundation.

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
| Update organization or invite members | Yes | No | No |
| View API-key metadata, create/revoke keys | Yes | No | No |
| Open Stripe checkout or billing portal | Yes | No | No |

`SuperAdmin` is a workspace administrator, not a cross-tenant administrator. Unknown roles are denied. `permissions.ts` is the fixed MVP permission matrix; the database `Role.permissions` JSON is not used for custom grants. Invitation role assignments are restricted to these three roles.

API keys are separate workspace credentials with read-only transaction export access. They are not tied to an individual user's session or activity status; revoke the key to remove integration access. Key hashes remain server-side, and only administrators receive key metadata in the settings UI.

Run `npm run test:access` from the repository root for the access-control regressions. They execute the real guards, Auth.js callbacks, server actions, and Express HTTP routes with mocked database/session/Stripe boundaries; no database credentials are required. Browser and live-database acceptance remains part of the MVP release checks.

---

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
