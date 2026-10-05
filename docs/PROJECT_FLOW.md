# Nexrole project flow

Nexrole is a multi-tenant B2B SaaS starter with workspace onboarding, role-based access, transaction management, Stripe subscriptions, developer API keys and required mutation audits. These diagrams describe the implemented MVP flows. Updated 2026-10-05.

## Workspace journey

```mermaid
flowchart TD
    Register[Register company and administrator] --> Workspace[Create workspace and SuperAdmin account]
    Workspace --> Email[Send verification email]
    Email --> Verify[Open link and submit verification]
    Verify --> Login[Sign in with verified active account]
    Login --> Dashboard[Workspace dashboard]
    Dashboard --> Transactions[Read workspace transactions]
    Transactions --> Create[SuperAdmin creates Pending transaction]
    Create --> Entitlement{Billing and quota allow creation?}
    Entitlement -->|Yes| Save[Save transaction and required audit atomically]
    Entitlement -->|No| Explain[Show quota or billing restriction]
    Save --> Finish[Complete or fail Pending transaction]
    Finish --> StatusAudit[Save permitted status change and audit]
    Dashboard --> Invite[SuperAdmin invites teammate]
    Invite --> InviteEmail[Send invitation email]
    InviteEmail --> Join[Accept valid invitation and choose password]
    Join --> Member[Join the same workspace with assigned role]
    Member --> Read[Member or Developer reads workspace data]
    Dashboard --> Manage[SuperAdmin changes role or deactivates member]
    Manage --> Invalidate[Invalidate old sessions and record audit]
    Manage --> LastAdmin[Preserve at least one active verified SuperAdmin]
```

Management actions derive the actor and workspace from fresh server-side membership. Client-supplied tenant or actor fields cannot select another workspace. Member and Developer roles retain read access; administrative mutations require SuperAdmin permissions. Transaction status changes also require permitted billing state and a Pending transaction.

## Account recovery

```mermaid
flowchart LR
    Request[Request password reset] --> Limit[Maximum 3 requests per address per 15-minute window]
    Limit --> Generic[Show generic response for eligible and ineligible addresses]
    Limit --> Email[Eligible account receives reset link]
    Email --> Token[Link valid for 30 minutes]
    Token --> Submit[Submit new password]
    Submit --> Validate{Token valid and account active?}
    Validate -->|Yes| Reset[Change password and invalidate all sibling links and old sessions]
    Validate -->|No| Reject[Reject reset and offer a new request]
```

Requesting another email does not invalidate an earlier reset link. Using any valid reset link invalidates the others. Verification links last 24 hours. Opening a link alone does not consume it; submission performs validation.

## Billing and recovery

```mermaid
flowchart TD
    Free[Free workspace: 10 stored transactions] --> Checkout[SuperAdmin requests Stripe Checkout]
    Checkout --> Durable[Persist audited operation and reuse uncertain attempts]
    Durable --> Stripe[Hosted Stripe Checkout]
    Stripe --> Event[Stripe event]
    Event --> Signature[Verify raw-body webhook signature]
    Signature --> Current[Retrieve current provider state and verify ownership]
    Current --> Commit[Commit billing state, receipt and required audit]
    Commit --> Active[Active or Trialing: Pro transaction allowance]
    Commit --> Restricted[Past due, Unpaid, Paused or Incomplete: restrict transaction writes]
    Commit --> Canceled[Canceled: return to Free quota and retain history]
    Restricted --> Portal[SuperAdmin opens Customer Portal for recovery]
    Portal --> Event
    Active --> Schedule[Schedule cancellation: retain current entitlement until effective]
    Schedule --> Event
    Current --> Retry[Transient failure: pending receipt and HTTP 503]
    Retry --> Redelivery[Original-event redelivery after correction]
    Redelivery --> Signature
    Review[Check billing status] --> Current
```

Webhook snapshots and checkout return URLs do not grant Pro access. Reconciliation uses current Stripe state, tenant/customer/subscription ownership and configured price. Duplicate and delayed events must not duplicate transition audits or restore stale entitlements. Unknown billing states deny transaction writes. Account recovery, workspace reads and authorized membership/billing recovery remain available during restrictions.

**Check billing status** reconciles current state; it does not drain pending webhook receipts. Follow [Webhook recovery](WEBHOOK_RECOVERY.md) for diagnosis and original-event redelivery. No scheduled receipt-replay worker is implemented.

## Application and integration boundaries

```mermaid
flowchart LR
    Browser[Browser] --> Web[Next.js web: session authentication and fresh permissions]
    Web --> Shared[Shared Prisma, billing and required-audit services]
    Shared --> DB[(PostgreSQL: tenant-scoped data)]
    Web --> Resend[Resend: account and invitation email]
    Web --> Stripe[Stripe: Checkout and Customer Portal]
    Stripe --> Hook[Express: signed webhook endpoint]
    Hook --> Shared
    Integration[External integration with X-API-Key] --> API[Express: SHA-256 key lookup and tenant-scoped transaction reads]
    API --> DB
```

Web reads and server actions access shared database services directly. The Express transaction API provides authenticated reads; it is not the transport for web mutations. API keys are stored as hashes, bind requests to a workspace, and cease authorizing new requests after revocation. Critical local mutations roll back if their required audit cannot be persisted. External email/payment outcomes have explicit recovery boundaries.

## Showcase and verification status

| Area                            | Evidence and remaining boundary                                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Core features 8.2-8.5           | Implemented with automated account, transaction, membership, authorization, billing and audit coverage.                                                                                                                                                |
| Release checkpoints 8.6.1-8.6.4 | Local acceptance checks complete; [release matrix](RELEASE_ACCEPTANCE.md) records tests and limits.                                                                                                                                                    |
| Real Stripe sandbox             | Upgrade, failure, recovery, scheduled and effective cancellation verified with user-assisted hosted UI and independent checks. Natural renewal/expiry and automatic CLI redelivery were not observed. See [billing acceptance](BILLING_ACCEPTANCE.md). |
| Real Resend email               | User reported successful verification and password-reset delivery on 2026-10-05, followed by successful Change password. This is user-reported manual evidence. Invitation delivery to another recipient/domain is not yet verified.                   |
| Deployment and final acceptance | 8.6.5 Docker/clean-deployment smoke, 8.6.6 final regression and 8.6.7 release documentation/exit gate remain pending. The project is not yet claimed publicly production-ready.                                                                        |

## UI screenshots and export

The [application screenshot gallery](SCREENSHOTS.md) pairs these diagrams with current dashboard, transaction, Company Profile/billing, Team Members and integration views. Use a demo workspace and redact email addresses, provider IDs, keys and token-bearing URLs. Historical screenshots may show older typography or badge styles; capture the current UI after refreshing it.
