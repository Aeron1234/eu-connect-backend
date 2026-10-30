# Account invitations and EmailJS setup

New accounts are provisioned by an administrator with a name, required email,
username, role and the existing role-specific fields. No password is entered by
the administrator. A cryptographically random bcrypt placeholder and
`password_setup_required = 1` prevent sign-in until setup finishes.

## Deployment order

1. Back up the database. Apply `scripts/2026-10-29-account-invitations.sql` to
   MariaDB before deploying either application's matching code. It adds four
   nullable/defaulted fields and a unique token-digest index; existing accounts
   keep `password_setup_required = 0`. Do not mark existing accounts pending
   based on a missing historical `password_changed_at`.
2. Connect a sending mailbox in EmailJS and create the template described below.
3. Configure the backend environment below. Do not put EmailJS keys in the
   frontend or any `NEXT_PUBLIC_*` setting.
4. Deploy/restart the backend and deploy/rebuild the frontend together. No new
   npm dependency is required: the backend uses EmailJS's documented REST API
   with Node's native fetch. Code deployment does not apply the schema migration
   or configure your EmailJS account automatically; verify both separately.
5. Create one test account with an email inbox you control. Check delivery,
   setup, normal login, a second attempt with the same link, expired/replaced
   links, resend, and Forgot Password. Do not use actual user inboxes for tests
   without their authorization.

## Backend environment

```dotenv
CLIENT_URL=https://your-frontend.example
EMAILJS_SERVICE_ID=your_service_id
EMAILJS_TEMPLATE_ID=your_account_setup_template_id
EMAILJS_PUBLIC_KEY=your_public_key
EMAILJS_PRIVATE_KEY=your_private_key
```

`CLIENT_URL` already controls CORS and now supplies the trusted origin for setup
links. Use your current deployed frontend URL, localhost during local tests, and
the school's HTTPS URL after VPS migration. It must not be supplied by a request
header or client form. Changing hosting requires updating it accordingly.

In EmailJS Account → Security, enable API calls from non-browser applications
and require private-key authorization. Use a connected service/mailbox that can
send to the intended recipients. Both EmailJS and the mailbox provider impose
quotas; personal-mailbox delivery is appropriate for low-volume thesis testing.

Official references:
- https://www.emailjs.com/docs/rest-api/send/
- https://www.emailjs.com/docs/user-guide/connecting-email-services/
- https://github.com/emailjs-com/emailjs-nodejs (non-browser API security setting)

No Resend domain verification is needed for this EmailJS flow when the connected
mail service does not require it. Active account invitations and recovery use
`services/accountSetupMail.js`. The obsolete Resend helpers, React Email
template, email-only logo asset and legacy mailer tests have been removed,
along with backend `resend`, `react-email` and email-only `react` dependencies.
The EmailJS template is managed in its dashboard; the frontend's React and PDF
assets are unaffected. Run `npm ci` after pulling the updated package files.
The updated active routes do not need
`RESEND_API_KEY` or `MAIL_FROM`, so those two variables can be removed from an
environment after it is upgraded to the EmailJS backend. Keep them on any older
deployment until its matching backend code is deployed. Restart local backends
after editing environment variables.

Do not remove `TEMP_PASSWORD_SECRET`: legacy temporary codes remain supported,
and startup validation still requires the secret even after old codes expire.
Removing it requires a separate change to legacy-token handling and validation.
Keep all `EMAILJS_*` variables and `CLIENT_URL`; for deployment, `CLIENT_URL`
must point to the public HTTPS frontend rather than localhost.

## EmailJS template

Use a single template for invitations and recovery:

- To Email: `{{to_email}}`
- Subject: `{{subject}}`
- From Email: the connected service's authenticated/default sender; do not set
  an unrelated address from application input.

The maintained HTML body is [emailjs-account-template.html](emailjs-account-template.html). Open the Code Editor under Edit Content, replace the HTML with that file, choose Apply Changes, then Save the template. Keep the To Email and Subject variables above and the authenticated default sender. The same HTML supports invitations and recovery without backend or environment changes.

The design uses an EU monogram, restrained maroon accents, a letter-style heading, account details, a password action and a visible copyable URL. It uses inline email-compatible tables and system fonts without remote images, scripts, tracking pixels or external font requests. Keep normal double-brace variables: heading, username, instructions, expiry_text and setup_url. Never paste a real token into the maintained file or preview examples.

An EmailJS dashboard save updates future emails; a Git change alone does not update EmailJS. Previously delivered messages keep their old content. Inspect Desktop and Mobile previews before saving. Preview variables are not real account tokens. Do not send test mail to other users without authorization.

### Spam placement

A more specific design does not guarantee inbox delivery. Gmail's similarity warning does not establish that the HTML layout alone caused classification. Sender reputation, authentication, links and recipient feedback also matter. Preserve the connected mailbox's authenticated/default From Email rather than impersonating a school-domain address. For a message known to be legitimate, the recipient can use Report not spam. Check Gmail's message details/authentication and provider delivery history if classification continues.

References: [Gmail spam guidance](https://support.google.com/mail/answer/1366858) and [message authentication](https://support.google.com/mail/answer/180707).

The backend supplies every parameter. The password itself is never emailed.
Do not add passwords, raw template HTML supplied by clients, or credentials to
template logs or API responses. Only the intended email contains the plaintext
link token; MySQL stores its SHA-256 digest.

## Behavior and failure handling

- Invitation: 24-hour expiry. Existing-account password recovery: 30 minutes.
- Every new invitation/recovery request replaces the previous link for that
  account. A database-enforced 60-second cooldown and API limits restrict resend.
- Setup links open public `/set-password?token=...`; GET never changes state.
  The page uses no-referrer metadata and is excluded from indexing.
- Submission goes to `POST /auth/account-setup` with token and confirmed password.
  Database-time expiry, active-account checks and a row lock protect completion.
  Password, consumed token, setup flag, refresh-session revocation and readable
  audit entry commit together. Concurrent/replayed completions cannot both win.
- A completed setup directs the user to normal sign-in. No application access
  or refresh session is issued merely for opening or using an invitation.
- Admin account lists expose pending/completed setup, not token hashes. Pending
  active accounts offer Resend invitation through the admin-only
  `POST /accounts/:accountId/invitation` endpoint. The creation confirmation also
  offers resend when delivery is unconfirmed.
- Commit the account/token before requesting email, and release the database
  connection first. Email failure does not roll back the account or mean that
  creation should be repeated. Refresh Accounts before retrying an uncertain
  creation request. Resend replaces old links even if a previous email arrived
  late after a timeout.
- Email delivery is serialized to roughly one request per second within this
  backend process, capped at 20 queued jobs and 20 seconds total wait per call.
  No automatic provider retries. Multiple backend processes would need a shared
  rate coordinator; the process-local queue is not distributed.
- Provider acceptance does not prove inbox delivery. Check spam and EmailJS
  delivery history during live verification. Never expose provider response
  bodies, secret request options, or setup URLs in user errors/logs.
- Delivery failures now report a safe category and provider HTTP status to the
  backend console and normal request error tracking. `EMAIL_PROVIDER_REJECTED`
  means checking EmailJS Account > Security for non-browser API/private-key
  access, the service/template IDs and quota; `EMAIL_CONFIGURATION_REQUIRED`
  means checking the five backend variables above; `EMAIL_NETWORK_ERROR` and
  `EMAIL_DELIVERY_TIMEOUT` identify transport failures. Raw provider bodies and
  exception details are discarded. A recovery schema failure reports its safe
  database error code, with migration guidance for `ER_BAD_FIELD_ERROR`.
  Missing/inactive/cooldown accounts still send no email and produce the same
  public recovery response; this response does not prove delivery.
- Forgot Password keeps a generic response for missing, inactive, throttled or
  delivery-failed accounts. For a pending new user, it sends another invitation;
  for an existing user, it sends a reset link without first disabling their
  current password. Generic messages do not promise uniform response timing.
- Legacy temporary recovery codes exchange for a setup-only access token with
  no refresh token. General API middleware denies these sessions; only the
  dedicated password-setup endpoint accepts them. Frontend session helpers and
  page routing also isolate them. Normal session authorization is unchanged.
- Completion revokes persisted refresh sessions; already issued ordinary access
  JWTs retain the application's existing short-expiry behavior.

Tests use database and HTTP/email mocks. They do not send real email, modify a
live database, or prove the external EmailJS service/template is configured.
