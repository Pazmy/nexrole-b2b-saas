# NexRole B2B SaaS: Core Engineering Specifications

This serves as detailed engineering manual, blueprint, and interactive checkpoint tracking sheet during development phase.

## Current document version: `V.1.0.0`

## Last updated: `2026-07-01`

---

## 1. Phase-by-Phase Execution Checklist

### Phase 1: The Multi-Tenant Transaction Ledger (`/transactions`)

**Objective:** Create a secure, performant database-driven transaction log scoped strictly to the current user's authenticated company context. This implements server-side pagination, searching, and filtering controlled cleanly via browser URL search parameters.

- [ ] **Step 1.1: URL-Driven Server Component Entry Point**
  - Create the file `apps/web/src/app/(dashboard)/transactions/page.tsx` as an asynchronous Next.js Server Component.
  - Accept the incoming `searchParams` prop to derive current layout filtering parameters dynamically:
    ```typescript
    export default async function TransactionsPage({
      searchParams,
    }: {
      searchParams: Promise<{
        page?: string;
        status?: string;
        search?: string;
      }>;
    });
    ```
- [ ] **Step 1.2: Server-Side Query Engineering**
  - Extract the session state inside the component using the `auth()` handler to parse out `tenantId`.
  - Parse the string value of `page` safely into an integer (defaulting to `1`) and establish a rigid limit size of `pageSize = 5`.
  - Execute a non-blocking parallel execution model using `Promise.all` to query your database schema variables directly:
    1.  `prisma.transaction.findMany`: Match strictly on `{ where: { tenantId, status, description: { contains: search, mode: 'insensitive' } } }`, applying database constraints `{ skip: (page - 1) * pageSize, take: pageSize, orderBy: { createdAt: 'desc' } }`.
    2.  `prisma.transaction.count`: Count records using an identical scoping filter to figure out the total pagination range dynamically.
- [ ] **Step 1.3: Interactive Filtering Client Subpanel**
  - Build `apps/web/src/components/transaction-filters.tsx` as a Client Component (`"use client"`).
  - Implement an entry layout using interactive elements (e.g., shadcn inputs and dropdown fields) to allow users to toggle filtering constraints like statuses (`pending`, `completed`, `failed`) and text terms.
  - Bind search alterations to URL modifications. When a criteria state transitions, mutate the URL query variables and trigger structural routing pushes using Next.js navigation primitives:
    ```typescript
    const params = new URLSearchParams(searchParams);
    params.set("status", newStatus);
    params.set("page", "1"); // Reset window context
    router.push(`?${params.toString()}`);
    ```
- [ ] **Step 1.4: Render Data Rows & Pagination Control Bars**
  - Render individual data points within structured table blocks, mapping formatting transformations across timestamps and money definitions (`new Intl.NumberFormat`).
  - Construct standard pagination action nodes below the log grid, locking or unlocking interaction tags based on calculated page metrics.

---

### Phase 2: Enterprise Settings Panels & Access Isolation Controls (`/settings`)

**Objective:** Build out the workspace configurations workspace, creating layout sections containing multi-tenant company parameter inputs alongside functional user directories protected via Role-Based Access Control (RBAC).

- [ ] **Step 2.1: Establish Tab Views Layout**
  - Create `apps/web/src/app/(dashboard)/settings/page.tsx` as an asynchronous Server Component.
  - Render a tab-driven menu wrapper separating the view into two clean, self-contained sub-panels: **Company Profile** and **Team Members**.
- [ ] **Step 2.2: Build Company Profile Management Sub-Form**
  - Inside the Company Profile view tab, render input forms to allow changing organizational titles. Populate initial defaults with text returned by the user session object.
  - Deploy an enterprise Next.js Server Action (`"use server"`) targeting database mutations directly within your database sub-package to update target records in the `Tenant` table matching `where: { id: tenantId }`.
- [ ] **Step 2.3: Build Scoped Team Directory Components**
  - Query the user tables through your local Prisma interface:
    ```typescript
    const members = await prisma.user.findMany({
      where: { tenantId },
      include: { role: true },
    });
    ```
  - Loop across records to present active enterprise workspace accounts within a list grid, displaying user emails, creation timestamps, and active permission levels.
- [ ] **Step 2.4: Enforce RBAC Layout Elements**
  - Evaluate the active session role identifier directly inside the layout wrapper.
  - Wrap administration panels (such as the "Invite Member" button) in conditional expressions. Hide or lock them out completely if the user's role does not match `SuperAdmin`:
    ```tsx
    {
      userRole === "SuperAdmin" ? (
        <Button>Invite New Member</Button>
      ) : (
        <p className="text-xs text-zinc-500">
          View-only mode. Admin access required.
        </p>
      );
    }
    ```

---

### Phase 3: Transitioning Express API Backend to TypeScript (`apps/api`)

**Objective:** Port the Express.js microservice architecture from standard JavaScript to fully typed TypeScript, implementing multi-tenant authorization middleware to authenticate external webhook calls or asynchronous services.

- [ ] **Step 3.1: Initialize TypeScript Environment inside Backend Workspace**
  - Add a local `tsconfig.json` layout file inside the `apps/api/` folder.
  - Add TypeScript compilation packages directly inside your API project workspace manifest:
    ```bash
    npm install -D typescript @types/express @types/cors @types/node tsx -w apps/api
    ```
- [ ] **Step 3.2: Refactor API Codebase to TypeScript Syntax**
  - Rename the main file `apps/api/server.js` to `apps/api/server.ts`.
  - Convert syntax allocations to modern ES Module imports. Swap out old development running systems inside `apps/api/package.json` to execute using `tsx` or `ts-node-dev` watchers.
- [ ] **Step 3.3: Write Custom Multi-Tenant JWT Interceptor Middleware**
  - Create the file `apps/api/src/middleware/authTenant.ts`.
  - Extend Express definitions to attach tenant metadata properties directly onto request contexts:
    ```typescript
    export interface AuthenticatedRequest extends Request {
      tenantId?: string;
      userRole?: string;
    }
    ```
  - Extract authentication tokens from headers (`req.headers.authorization`), verify the inner signature using your private application keys, extract the `tenantId` payload data, and write them onto the request context container.
- [ ] **Step 3.4: Construct Scoped API Routes**
  - Update all database routes to process transactions behind your verification middleware handlers.
  - Refactor user queries to operate within strict multi-tenancy limits:
    ```typescript
    app.get(
      "/api/transactions",
      authTenant,
      async (req: AuthenticatedRequest, res) => {
        const transactions = await prisma.transaction.findMany({
          where: { tenantId: req.tenantId },
        });
        res.json(transactions);
      },
    );
    ```

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

- **Primary Page Headlines:** `text-3xl font-bold tracking-tight text-zinc-100`
- **Context Descriptions:** `text-sm text-zinc-400`
- **Data Logs & Metrics:** `font-mono text-sm tracking-wide text-zinc-300`

### 3. Application State Separation Philosophy

- **Client Interface Layout State:** Manage quick interface transitions (like dropdown behaviors or modal visibility toggles) locally within components using simple React `useState` hooks.
- **Global Business Data State:** Maintain all shared application parameters (such as pagination adjustments, table filters, or search variables) inside the **browser URL search address bar**.
  - _Why:_ This design pattern ensures page layouts are deep-linkable and easy to bookmark. It allows your Next.js Server Components to read current parameters instantly during server-side compilation, removing the need for loading spinner placeholders.

---

## 3. Development Progress Checklist

Use this checklist to track your progress as you build out your application components:

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

- [ ] Bind Server Component rendering loops directly to incoming URL parameter states.
- [ ] Optimize concurrent data fetching using non-blocking parallel `Promise.all` logic layers.
- [ ] Build client data filtering search components that synchronize with the browser address bar.
- [ ] Render numerical data points using structured data sheets and page pagination controls.

### Phase 2: Configuration Panels & RBAC Controls (`/settings`)

- [ ] Create tab views separating system variables from operational resources.
- [ ] Hook up profile forms to execute server mutation requests via Server Actions.
- [ ] Implement secure member roster components using local workspace queries.
- [ ] Hide or disable high-privilege operations from non-admin accounts by evaluating session permissions.

### Phase 3: Transitioning Express API to TypeScript (`apps/api`)

- [ ] Configure full TypeScript compilation setups within your API workspace.
- [ ] Refactor raw JavaScript server components into fully typed ES modules.
- [ ] Deploy custom middleware components to decode incoming user sessions from request authorization headers.
- [ ] Secure all Express data endpoints behind multi-tenant query constraint parameters.
