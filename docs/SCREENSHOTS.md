# Application screenshots

Captured on 2026-10-05. These screenshots show the current Geist typography, dark UI and role-dependent controls. Most captures use the fictional local showcase workspace; they illustrate product behavior rather than replace automated or provider acceptance evidence. See [project flows](PROJECT_FLOW.md), [showcase fixtures](SHOWCASE_DATA.md) and [release verification](RELEASE_ACCEPTANCE.md).

## Create workspace and verify email

The onboarding sequence: enter company and administrator details, receive the email-check prompt, open the verification link and explicitly confirm the email address. The final screen confirms that the account can sign in.

### 1. Create the workspace

The registration form requests a company name, administrator email and password of at least 12 characters.

![Create workspace form](<ss/Screenshot 2026-10-05 at 14-34-08 Create Next App.png>)

### 2. Check email

Workspace creation succeeded. The user is prompted to verify their account and can request another verification email.

![Workspace created and verification email prompt](<ss/Screenshot 2026-10-05 at 14-38-41 Create Next App.png>)

### 3. Confirm email ownership

Opening the verification link displays a confirmation action; visiting the page alone does not consume the token.

![Email verification confirmation](<ss/Screenshot 2026-10-05 at 14-39-50 Create Next App.png>)

### 4. Verification complete

The application confirms successful verification and offers a sign-in link. These captures show the UI sequence; the user's real Resend delivery observations are recorded separately in [project verification status](PROJECT_FLOW.md#showcase-and-verification-status).

![Successful email verification](<ss/Screenshot 2026-10-05 at 14-40-00 Create Next App.png>)

## Dashboard overview

Completed revenue of USD 8,841.50, nine stored transactions, six completed operations and two pending actions.

![Dashboard overview](<ss/Screenshot 2026-10-05 at 14-00-14 Create Next App.png>)

## Transaction ledger

Search, status filtering, Free quota and pagination. This first page displays Pending and Completed records; the Failed fixture is on another page.

![Transaction ledger](<ss/Screenshot 2026-10-05 at 14-03-10 Create Next App.png>)

## Completed transaction details

The completed Orbit Commerce transaction shows its description, USD amount, identifier and readable Created/Last updated timestamps with an explicit UTC timezone. The status section explains that Completed is final and cannot be changed.

![Completed transaction details with readable UTC timestamps](<ss/Screenshot 2026-10-05 at 14-30-49 Create Next App.png>)

## Company profile and Free plan

Administrator view with a Free badge, 9/10 usage, upgrade entry point and editable company profile.

![Company profile and Free plan](<ss/Screenshot 2026-10-05 at 14-03-39 Create Next App.png>)

## Administrator member management

SuperAdmin view with role selectors, deactivation controls and the self-account warning. This capture focuses on the upper member rows; the following invitation capture documents another section of the same administrative Team Members page. Both show the expected SuperAdmin UI.

![Administrator member management](<ss/Screenshot 2026-10-05 at 14-04-15 Create Next App.png>)

## Pending and expired invitations

SuperAdmin invitation management with assigned role, UTC expiry, resend and revoke controls. This detail capture complements the member-management screenshot above. These are fictional seed entries; this image does not demonstrate inbox delivery.

![Pending and expired invitations](<ss/Screenshot 2026-10-05 at 14-04-26 Create Next App.png>)

## Administrator API-key management

Key creation form and two showcase key labels. No raw API credential is visible.

![Administrator API-key management](<ss/Screenshot 2026-10-05 at 14-05-47 Create Next App.png>)

## Member directory without management controls

The Member session can read all six identities, including Developer and inactive Member rows, without administrative controls.

![Member directory without management controls](<ss/Screenshot 2026-10-05 at 14-07-45 Create Next App.png>)

## Read-only company profile

A non-admin sees workspace billing information and a disabled company-name field. Billing and profile management require SuperAdmin.

![Read-only company profile](<ss/Screenshot 2026-10-05 at 14-09-47 Create Next App.png>)

## API-key management restriction

A non-admin is denied key-management controls. The empty-key message reflects the list hidden from this role; the administrator capture above shows that fixture entries exist.

![API-key management restriction](<ss/Screenshot 2026-10-05 at 14-08-20 Create Next App.png>)

## Member directory detail

A closer view of the complete six-member directory and role/status badges. This complements the Member-session capture above.

![Member directory detail](<ss/Screenshot 2026-10-05 at 14-10-00 Create Next App.png>)

## Workspace role permissions

The Developer-session permissions matrix shows the three fixed roles. Member and Developer currently share read-only access; only SuperAdmin manages keys and billing.

![Workspace role permissions](<ss/Screenshot 2026-10-05 at 14-11-50 Create Next App.png>)

## Rejected inactive-account sign-in

The inactive alumni fixture receives a generic sign-in failure. The visible message does not disclose whether the account is inactive, unverified or has incorrect credentials.

![Rejected inactive-account sign-in](<ss/Screenshot 2026-10-05 at 14-12-32 Create Next App.png>)

## Active subscription presentation

The Active badge, unlimited Pro allowance and billing controls. This is a UI capture supplied by the project owner; provider/payment acceptance is documented separately in BILLING_ACCEPTANCE.md.

![Active subscription presentation](<ss/Screenshot 2026-10-05 at 14-15-51 Create Next App.png>)
