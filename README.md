# Nexrole B2B SaaS Monorepo

Nexrole is a modern, multi-tenant B2B SaaS application boilerplate configured as an npm workspaces monorepo. It features a Next.js web application, an Express.js API server, and a shared Prisma database access package.

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

- **Framework:** [Next.js 16](file:///d:/dev/nexrole-b2b-saas/apps/web) (App Router)
- **Styling:** Tailwind CSS & Shadcn UI
- **Authentication:** NextAuth.js (v5) with custom credentials-based sign-in and middleware guards ([auth.ts](file:///d:/dev/nexrole-b2b-saas/apps/web/src/auth.ts))
- **Views & Routes:**
  - Login & Registration ([login/page.tsx](<file:///d:/dev/nexrole-b2b-saas/apps/web/src/app/(auth)/login/page.tsx>))
  - Dashboard Layout & Subroutes ([dashboard/layout.tsx](<file:///d:/dev/nexrole-b2b-saas/apps/web/src/app/(dashboard)/layout.tsx>))
  - Multi-Tenant Transactions list
  - Settings view

#### 2. API Server (`apps/api`)

- **Framework:** [Express.js API](file:///d:/dev/nexrole-b2b-saas/apps/api) (Node ESM)
- **Entry Point:** [server.js](file:///d:/dev/nexrole-b2b-saas/apps/api/server.js)
- **Features:** Exposes REST endpoints (e.g. `/health`, `/api/users`), using the shared `@nexrole/database` client to fetch and manage data.

#### 3. Database Package (`packages/database`)

- **ORM:** Prisma 7 with PostgreSQL
- **Source:** [packages/database](file:///d:/dev/nexrole-b2b-saas/packages/database)
- **Database Driver:** `@prisma/adapter-pg` using a pooled connection configuration (`pg` driver).
- **Schema Models** ([schema.prisma](file:///d:/dev/nexrole-b2b-saas/packages/database/prisma/schema.prisma)):
  - **Tenant**: Represents individual B2B client organizations.
  - **Role**: Defines RBAC levels (e.g., `SuperAdmin`, `Manager`, `Viewer`).
  - **User**: Belongs to a single Tenant and has a designated Role.
  - **Transaction**: Store for mock tenant-specific transaction data.

---

## 🛠️ Getting Started & Setup

Follow these steps to set up the project locally:

### 1. Prerequisites

Ensure you have the following installed on your system:

- **Node.js** >= `22.15.0` (as specified in `package.json`)
- **PostgreSQL** database running locally or hosted online

### 2. Environment Configuration

Create a `.env` file in the **root** directory of the project:

```env
DATABASE_URL="postgresql://<username>:<password>@localhost:5432/<db_name>?schema=public"
AUTH_SECRET="your-next-auth-secret-key" # NextAuth session secret (e.g., generate with `openssl rand -base64 32`)
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
- **Tenant (Company):** `Sensei Corp`
- **Admin Account:**
  - **Email:** `admin@sensei.com`
  - **Password:** `admin123`

### 5. Build Shared Packages

Compile the database client TypeScript code so that the Express and Next.js applications can import the `@nexrole/database` module properly:

```bash
npm run build
```

### 6. Launch Development Servers

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
