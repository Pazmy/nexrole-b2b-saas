# Onboarding and recovery (Step 8.2)

All account flows work without a Resend account or domain in development. Email previews are private local text files; they are not served by the app. Switching to Resend requires configuration only.

## Run locally before you have a domain

1. Keep your existing database, Auth.js, and other application settings. Add these settings to `apps/web/.env.local` (Next.js reads environment files from `apps/web`, not the repository root):

   ```dotenv
   EMAIL_MODE=preview
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   Leave `RESEND_API_KEY` empty. `EMAIL_FROM` is not needed in preview mode.

2. From the repository root, generate the database client and apply migrations:

   ```powershell
   npm.cmd run build -w packages/database
   npm.cmd exec -w packages/database -- prisma migrate deploy
   npm.cmd run dev
   ```

   The migration CLI reads `packages/database/.env`. Ensure its `DATABASE_URL` points to the same database as the web app. On macOS/Linux, use `npm` instead of `npm.cmd`.

3. Open `http://localhost:3000/register`. Create a workspace with any valid email address and a password of at least 12 characters (maximum 72 UTF-8 bytes).

4. Open the newest text file in `apps/web/.email-previews`. Copy its verification URL into the browser and click **Verify email**, then sign in. A GET request alone does not consume the token, so email scanners cannot verify an account merely by visiting the link.

5. Use **Forgot password**, **Resend verification**, and **Settings → Change password** to exercise recovery. Invite a teammate from the Team settings tab and use their invitation preview in a separate browser profile. Each preview begins with its recipient and subject.

The preview directory is excluded from Git and Docker build contexts. Preview files contain live links; remove files when you no longer need them. They are never printed in application logs by the email sender, although development HTTP access logs can include URL query strings.

`EMAIL_MODE=preview` is rejected in production. Until you configure real email, use `npm run dev`. The existing Docker Compose application runs in production mode and therefore requires Resend and a public HTTPS application URL.

## Existing accounts and migrations

- Existing accounts are not silently marked verified. After migration, use `/verify-email` to request verification. Previously issued sessions must sign in again.
- Email normalization is enforced by database constraints. The migration checks for collisions before changing data and aborts without merging accounts. Resolve any colliding addresses deliberately, mark the rolled-back migration as rolled back with Prisma's migration tooling, and retry. Do not delete or reset the database to resolve a collision.
- Existing invitation URLs remain valid until their original expiry. The migration replaces stored plaintext invitation tokens with hashes.
- Fresh demo seed accounts are explicitly verified for local demo use. Re-running the seed does not verify existing accounts. Real registrations always require verification.
- Registration creates its role, workspace, and user transactionally. A duplicate/concurrent registration cannot leave an orphan workspace. If email delivery fails after account creation, the account stays pending and the user can resend verification.

## Security and delivery behavior

- Verification and invitation links expire after 24 hours; password-reset links expire after 30 minutes. Tokens are random, stored as SHA-256 hashes, and consumed atomically. Resetting or changing a password increments a session version checked by Auth.js and protected operations.
- Password resets do not implicitly verify an unverified account. After a reset, request a fresh verification link if needed. Old reset and verification links are invalidated by a password change/reset.
- Recovery and resend-verification responses are identical for nonexistent, inactive, ineligible accounts and email-delivery failures. Provider error bodies and tokens are not logged. Operational failures produce generic server log messages.
- The sender uses the [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email) with a 10-second timeout. A provider acceptance is not an inbox-delivery guarantee. Failed invitations can be retried; account verification can be resent. Durable queued delivery is not part of this step.
- Rate limits use atomic PostgreSQL counters shared by all instances. Per 15 minutes: login 10 per email; registration 5 per email; recovery/verification email 3 per email; token verification 10 per token; reset and invitation acceptance 5 per token; password change 5 per user; invitations 10 per workspace. Each action also has a network limit of 30 if a trusted client IP is available, or a shared fallback limit of 200.
- By default, forwarded IP headers are ignored. Set `RATE_LIMIT_IP_HEADER` only to a single-IP header your trusted reverse proxy overwrites, and prevent direct access around that proxy. Without it, the shared fallback is safe but can limit unrelated users together.
- Schedule periodic cleanup of expired rows (for example daily) using your database maintenance tooling:

  ```sql
  DELETE FROM auth_rate_limits WHERE "expiresAt" < NOW();
  DELETE FROM account_tokens WHERE "expiresAt" < NOW();
  DELETE FROM invitations WHERE "expiresAt" < NOW();
  ```

Pending-invitation management, revocation, and member-role controls remain in Step 8.4.

## Automated verification

From the repository root:

```powershell
npm.cmd run test:access
npm.cmd run test:accounts
npm.cmd run test:accounts:db
npm.cmd run lint -w apps/web
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
npm.cmd run build -w apps/web
```

`test:accounts:db` needs PostgreSQL and permission to create a schema. It uses `TEST_DATABASE_URL`, falling back to `packages/database/.env`, creates a randomly named `account_test_*` schema, tests actual migrations and concurrent operations, and drops only that test schema afterward. It does not migrate or clear the application schema. Email delivery is mocked in these tests.

For the browser test, start the app in preview mode first, then run:

```powershell
npm.cmd run test:e2e -w apps/web -- account-lifecycle.spec.ts
```

This test uses unique temporary workspace accounts and removes them and their previews afterward. Its `apps/web/.env` database connection must match the server. Use `PLAYWRIGHT_BASE_URL` for a nondefault port, and `PLAYWRIGHT_CHANNEL=msedge` to use installed Microsoft Edge instead of Playwright Chromium. Run the server and tests under the same OS user so preview cleanup works. For Windows cache ownership conflicts, set `NEXT_BUILD_DIR` to an unused `.next-*` directory before starting a build or server.

## Final action after Resend is ready: configure and verify live delivery

1. Create a [Resend account](https://resend.com/signup). You do not need a paid email inbox. Add a domain you own under [Domains](https://resend.com/domains), preferably a sending subdomain such as `mail.yourdomain.com`.

2. Add the exact DNS records Resend provides at your DNS host. Wait until Resend reports the sending domain as verified. Follow the [domain setup guide](https://resend.com/docs/dashboard/domains/introduction).

3. Under [API Keys](https://resend.com/api-keys), create a key named `nexrole-development` or `nexrole-production`, with **Sending access** restricted to your sending domain. Copy the value immediately and keep it server-side. Use separate keys for development and production.

4. Update `apps/web/.env.local` for local testing:

   ```dotenv
   EMAIL_MODE=resend
   RESEND_API_KEY=re_replace_with_your_real_key
   EMAIL_FROM="NexRole <noreply@mail.yourdomain.com>"
   NEXT_PUBLIC_APP_URL=http://localhost:3000
   ```

   Replace the sender domain with the exact verified domain. Restart the development server. To test before domain verification, use `NexRole <onboarding@resend.dev>` and send only to the email address associated with your Resend account; arbitrary recipients require a verified domain. See [Resend's test-domain restriction](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain).

5. For deployment, put the same settings in your hosting environment (the root `.env` for Docker Compose), set `NEXT_PUBLIC_APP_URL` to your actual **HTTPS application origin**, and set `EMAIL_MODE=resend`. The application URL is where users open links; it does not have to match the sending domain. Do not use a localhost URL for other people's onboarding. Apply migrations, rebuild, and restart/redeploy. Never prefix the API key with `NEXT_PUBLIC_`.

6. Register a new workspace using an inbox you control. Confirm a verification email arrives, the sender is correct, and its link uses your configured application origin. In Resend's Emails dashboard, check the delivery event; if the email is missing, check spam and the provider's rejection/bounce details. Confirm the app has not created a new local preview file in Resend mode.

7. Attempt sign-in before verification: it must fail. Open the email, click **Verify email**, then sign in successfully. Submit the same verification link again: it must fail as already used. Requesting verification again for the verified address must still show the generic response.

8. Sign in with the same account in two browser profiles. Use **Forgot password**, confirm the reset email arrives, and set a new password. Both earlier sessions must lose access when they next visit a protected page. The old password and reused reset link must fail; the new password must work.

9. In Settings, use **Change password**. A wrong current password must fail. A successful change must require a fresh sign-in in every browser profile.

10. Invite a second inbox you control from Team settings. Confirm the invitation arrives, the link joins the intended workspace as a Member, and the same link cannot create another account. This requires a verified sender domain if the recipient differs from your Resend signup email.

11. Request recovery for an unknown address and compare the message with an existing address; both must show the same generic response. After three recovery email requests for one address within 15 minutes, the next request must show the wait/retry message. On a staging account, wait 30 minutes before submitting a reset link to confirm expiry; the automated PostgreSQL suite covers expired links without waiting.

12. Record the successful real-delivery checks in `BUILD_PLAN.md`. Until these checks pass, live Resend delivery remains unverified even though the application and local-preview flows are implemented and tested.
