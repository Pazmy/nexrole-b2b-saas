# NexRole B2B SaaS: Core Engineering Specifications

This serves as a detailed engineering manual, blueprint, and interactive checkpoint tracking sheet during the development phase.

## Current document version: `V.1.1.0`

## Last updated: `2026-07-02`

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
- Enforced tenant multi-tenancy limits across all remote data routes.

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

- [ ] **Step 6.1: Define Enterprise Feature Set Scopes**
  - Create a core resource allocation map. Restrict core behaviors based on active subscription status definitions (e.g., limit accounts on the Free tier to 10 logged operations per month, while unlocking unmetered records for Pro accounts).
- [ ] **Step 6.2: Set Up Stripe Webhook Listeners inside Express Server**
  - Implement a dedicated webhook routing terminal endpoint within your Express microservice: `apps/api/routes/webhooks/stripe.ts`.
  - Process signature validations from Stripe requests. Parse payment events (`customer.subscription.updated`, `invoice.payment_failed`) to update corresponding `subscriptionStatus` entries in the `Tenant` table in real time.
- [ ] **Step 6.3: Middleware Billing Enforcement Guards**
  - Integrate tier checks into your Next.js layout structures and edge navigation middleware.
  - Block access and redirect corporate users straight to account billing modification views if a tenant's subscription falls into an unpaid or suspended state.

---

### Phase 7: Production Infrastructure & Compliance Observability

**Objective:** Prepare the stabilized platform for live deployment by adding end-to-end multi-tenant boundary test suites, unified Docker configurations, and structured JSON telemetry.

- [ ] **Step 7.1: Multi-Tenant Playwright End-to-End Testing**
  - Configure Playwright suites within your web project directory to validate tenant data isolation boundaries.
  - Write test scenarios where two distinct seeded client accounts session tokens execute concurrent actions, ensuring Tenant A can never view or intercept operational inputs belonging to Tenant B.
- [ ] **Step 7.2: Orchestrated Multi-Service Docker Compose Configuration**
  - Build a root-level `docker-compose.yml` to spin up local development environments, including a localized PostgreSQL database instance, your TypeScript Express backend, and the Next.js App Router workspace.
- [ ] **Step 7.3: Database-Driven Compliance Audit Ledger**
  - Implement automated audit triggers inside critical data mutation actions. Write security logs tracking changes to organization profiles or team structures into an `AuditLog` table containing the actor's User ID, metadata, and IP addresses.
- [ ] **Step 7.4: Structured Telemetry Tracking Engine**
  - Integrate a professional logging tool (e.g., Winston or Pino) inside the Express API container to format exception events and logs into clean, indexable JSON outputs.

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
- [x] Secure all Express data endpoints behind multi-tenant query constraint parameters.

### Phase 4: B2B Onboarding & Cryptographic Invite Loops

- [x] Deploy the public business registration workspace route.
- [x] Push the new `Invitation` data schema tables to your database client.
- [x] Build token-verified registration input pages to securely onboard new workspace actors.

### Phase 5: The Developer API Key Gateway

- [x] Push the `ApiKey` data models to your database container.
- [x] Build the Express request interceptor middleware targeting machine token configurations.
- [x] Render the client-facing developer credential management panel within the workspace dashboard.

### Phase 6: Multi-Tenant Stripe Subscription Engine

- [ ] Map tier limits against application database queries and layouts.
- [ ] Deploy validated Stripe endpoint webhook listener tunnels inside your Express app.
- [ ] Implement system-wide middleware access guards to check corporate payment statuses.

### Phase 7: Production Infrastructure & Compliance Observability

- [ ] Build dynamic analytics visualizations (Recharts) on the dashboard landing page.
- [ ] Implement Playwright E2E tests checking authentication, tenant isolation, and RBAC visibility rules.
- [ ] Construct a root Docker Compose file to orchestrate local development databases and services.
- [ ] Implement database-driven Audit Log logging utilities for security compliance tracking.
- [ ] Refactor API logs to use structured loggers (Winston/Pino) with correlation IDs.
