# Local demo data

The demo seed creates **Nexrole Studio ? Showcase**, a separate workspace for exploring the application locally. It includes fictional transactions, team members, invitation states and API-key entries.

## Setup

With dependencies installed, migrations applied and the database package built, run from the repository root:

```sh
npm run db:showcase
```

The command prints the administrator email and a randomly generated password after successful creation. Sign in at the local application's login page. Demo accounts are explicitly marked verified; seeding sends no email.

The script reads `DATABASE_URL` from the process environment, then `apps/web/.env.local`, `apps/web/.env` and `packages/database/.env`, preserving the first value found. It accepts only loopback PostgreSQL hosts and refuses production mode.

## Included data

| Area | Initial state |
| --- | --- |
| Dashboard | USD 8,841.50 completed revenue, 9 transactions, 6 completed operations and 2 pending actions. |
| Transactions | Service descriptions, amounts and dates spanning the preceding 28 days; 6 Completed, 2 Pending and 1 Failed. |
| Workspace | Free plan with 9/10 stored transactions and no Stripe customer or subscription binding. |
| Team | Two SuperAdmins, two active Members, one Developer and one inactive Member. |
| Invitations | One current Member invitation and one expired Developer invitation. |
| API keys | Two labeled entries for reporting and ledger synchronization. Raw credentials are discarded. |

Creating another transaction reaches the Free limit of ten. Completing a Pending transaction changes the dashboard totals according to its amount.

## Demo accounts

All demo accounts share the password generated during initial setup.

| Email | Role | Status |
| --- | --- | --- |
| owner@nexrole-showcase.example.test | SuperAdmin | Active |
| operations@nexrole-showcase.example.test | SuperAdmin | Active |
| finance@nexrole-showcase.example.test | Member | Active |
| support@nexrole-showcase.example.test | Member | Active |
| integrations@nexrole-showcase.example.test | Developer | Active |
| alumni@nexrole-showcase.example.test | Member | Inactive; sign-in denied |

Use a SuperAdmin account to explore management controls, or a Member/Developer account to explore read-only access. The example.test addresses are fictional and cannot receive verification, recovery or invitation email.

## Repeat runs and isolation

Creation runs in one database transaction. The script uses a reserved workspace identity and aborts on conflicting account identities rather than reassigning existing users. Existing roles are reused without modification, and other workspaces are preserved.

Rerunning detects the seed marker and preserves the workspace, its changes and its credentials. It does not reset data or print a replacement password. Store the initial password locally.

This seed is an explicit development command and is never run by migrations or automatic container initialization. It performs no migration, Docker startup or provider request.

## External service boundaries

Invitation and API-key entries contain random hashes with no retained raw credentials. Create a new API key through the application for functional integration testing. Email testing requires an authorized, deliverable recipient and email configuration; billing testing requires a separately configured Stripe sandbox flow. The seed itself creates no external email or payment resources.

The audit marker uses the schema's legacy actor source and the action `SHOWCASE_DATA_SEEDED` to identify imported demo data. Seed records do not represent historical user actions or Stripe events.
