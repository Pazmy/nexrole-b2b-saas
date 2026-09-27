# Feature 8.4 verification

## Local demo setup

1. Start PostgreSQL and the web app. Use an active, email-verified SuperAdmin account.
2. For a demo without an email domain, set `EMAIL_MODE=preview` and set `NEXT_PUBLIC_APP_URL` to the local web address. Restart the web app after changing environment variables.
3. Prepare two separate browser sessions: browser A for the administrator and browser B/incognito for the invited user.
4. Local emails are stored in `apps/web/.email-previews/` when the server runs from `apps/web`. Open only previews addressed to your test email. These files contain secret links and must not be published.

## Main journey: invite → join → change role → deactivate

1. In browser A, open **Settings → Team Members**. `/settings/members` also redirects to this tab.
2. Open **Invite Workspace Member**, enter a new email address, select **Developer**, then click **Send invitation**.
   - The existing success card remains visible. Pending invitations shows the email, Developer role, and expiration time in UTC.
3. Open the invitation link from the email preview in browser B. Enter a password with at least 12 characters and complete enrollment.
   - The page shows a success message. Sign in with the new account; it must belong to the inviting administrator's workspace.
4. Refresh the Team tab in browser A.
   - The invitation disappears from the pending list, and the new account appears as an active member.
5. Keep browser B open. In browser A, change the new member's role to **Member**, then click **Save role**.
   - The role changes. When browser B next opens a protected page, the old session is redirected to login.
   - Signing in again succeeds with the Member role. Member and Developer currently share read-only access; neither has member or invitation management controls.
6. In browser A, select **Deactivate** for the new account, then **Confirm deactivation**.
   - The member row remains with an Inactive status; transaction history is retained.
   - The next protected request in browser B redirects to login. The inactive account can no longer sign in.

Session changes take effect on the next protected request; an idle page does not close automatically. Reactivation, account deletion, and custom roles are outside the scope of 8.4.

## Additional scenarios

| Scenario | Expected result |
| --- | --- |
| Invite an email belonging to an existing account, including an inactive account | Rejected; accounts are not moved between workspaces |
| Invite an email with an outstanding pending or expired invitation | Rejected with instructions to resend or revoke |
| Resend an invitation | The role stays the same, the token rotates, and validity renews to 24 hours; the old link stops working |
| Revoke → Cancel | The invitation remains |
| Revoke → Confirm revoke | The invitation disappears; its link cannot be used |
| Open an expired, used, or revoked link | The page explains that the invitation is unavailable |
| Email delivery fails | A clear error appears; the new token is inactive. A failed create can be retried; a failed resend can be resent again |
| Change the role of or deactivate the last active, verified SuperAdmin | Controls are blocked; the server also rejects requests from stale pages |
| Change your own administrator role when another eligible administrator exists | The change succeeds and redirects you to login |
| Member/Developer opens Team | Members are visible; pending invitations and management controls are hidden |
| Open **View role permissions** | The fixed permission matrix appears; **Back to Team Members** returns to the roster |

Create and resend share a limit of 10 attempts per workspace per 15 minutes, in addition to the network limit. Revoke remains available when the email limit is exhausted. To change the role of an unaccepted invitation, revoke it and invite again.

## Automated checks

From the repository root:

```powershell
node --test tests/access-control.test.cjs tests/accounts.test.cjs tests/membership-rules.test.cjs tests/transaction-rules.test.cjs tests/accounts-db.test.cjs tests/membership-db.test.cjs tests/invitations-db.test.cjs tests/transactions-db.test.cjs
npm.cmd run lint -w apps/web
npm.cmd run build -w packages/database
npm.cmd run build -w apps/api
```

Database tests use temporary schemas and clean them up afterward. With the development web server running and email previews enabled, run the five browser journeys from the repository root:

```powershell
$env:PLAYWRIGHT_BASE_URL='http://localhost:3100' # Match the web server port
$env:PLAYWRIGHT_CHANNEL='msedge'
npm.cmd run test:e2e
```

The invitation journey follows the same account through a role change and deactivation, including browser sessions that are already open. Test workspace fixtures and their preview files are cleaned up afterward.

Local production testing uses the test-only transport helper described in the [README](../README.md#invitation-ui-step-845). This helper is not used for deployment and does not verify real Resend delivery.

## After the Resend domain is ready

Follow the [live email configuration and verification checklist](ACCOUNT_SETUP.md#final-action-after-resend-is-ready-configure-and-verify-live-delivery), then repeat the main journey and resend/revoke scenarios with a real inbox. This verifies external delivery, which previews and simulated transport do not cover.
