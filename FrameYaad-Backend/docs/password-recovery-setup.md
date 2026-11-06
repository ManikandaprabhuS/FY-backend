# Portal-specific password recovery

## Screens and fixed-role endpoints

| Portal | Screen | Endpoint prefix | Allowed database role |
| --- | --- | --- | --- |
| Customer | /forgot-password | /api/v1/auth/customer | CUSTOMER |
| Admin | /fyadminlogin/forgot-password | /api/v1/auth/admin | ADMIN |

EMPLOYEE is intentionally not accepted by the admin recovery portal. The role comes from the
server router, never from request JSON or a query parameter. Email is trimmed and lowercased
on the backend. An unknown email, an inactive account, or a different role returns the same
404 message: `No account found for this email.` No OTP is generated or emailed in those cases.

## Resend configuration

Password-recovery mail uses the shared Resend utility, not Supabase SMTP or its email templates.
Set RESEND_API_KEY and EMAIL_FROM in the backend environment. EMAIL_FROM must be a real email
address on a verified Resend domain, for example `FrameYaad <noreply@frameyaad.in>`.
The local sender is set to that address. The live check returned 403 because frameyaad.in is not
yet verified for the configured API key. Verify its required DNS records in Resend Domains.
Apply the same configuration in Render when deploying.

Signup confirmation still uses Supabase Auth email configuration; that separate SMTP setup
is not changed by password recovery. Do not disable email verification to work around it.

## Recovery sequence

1. POST {prefix}/forgot-password with `{ "email": "registered@example.com" }`.
2. POST {prefix}/verify-reset-otp with email and a six-digit string otp.
3. Verification returns only `{ "resetToken": "..." }`. Keep this in memory.
4. POST {prefix}/reset-password with resetToken and newPassword.
5. Return to /profile or /fyadminlogin and sign in with the new password.

The retired generic /auth/forgot-password, /auth/verify-reset-otp and /auth/reset-password
endpoints return 410. A normal login access token cannot authorize a reset.

## Security and database changes

Only two new tables are used: password_recoveries and password_recovery_rates. The migration
is prisma/migrations/20261106090000_portal_password_recovery/migration.sql. It has been applied
to the connected test database; it does not modify existing user or business records.
Both tables have RLS enabled and no anon/authenticated access.

- Codes are uniform six-digit values generated with crypto.randomInt and expire after 10 minutes.
- Only a domain-separated HMAC-SHA256 of the OTP is stored. The existing server-only Supabase
  service-role secret is used as the HMAC key; rotating it invalidates outstanding OTPs.
- A replacement request overwrites the user's previous code and any previous reset token.
- Five wrong guesses lock the code. Verification uses row locking and constant-time comparison.
- Requests have a persistent 60-second resend cooldown, 3 requests per email per 15 minutes,
  and 20 requests per IP per 15 minutes, including unknown-email requests in the IP limit.
- Successful verification consumes the OTP and issues a random 256-bit reset token. Only its
  SHA256 hash is stored. It expires after 10 minutes and is bound to the same user and portal.
- Reset tokens are claimed atomically before updating the password. Concurrent requests cannot
  reuse them. If the auth provider fails after claiming, request a new code rather than reusing it.
- No OTP, password, or raw reset token is logged or saved in browser storage or URLs.

The IP limiter uses Express request.ip. The deployment must configure its trusted proxy chain
correctly before relying on individual client-IP attribution behind a reverse proxy.

## Verification

Automated service and endpoint tests cover matching/mismatching roles, unknown email, normalization,
hash-only storage, request limits, expiry, five guesses, OTP reuse, reset-token reuse/expiry, and
rejection of ordinary login tokens. Real-database temporary-account checks exercise concurrent
verification/reset and post-reset login. These use an isolated email transport stub while DNS
verification blocks live Resend sending. Temporary accounts are removed after the checks.
Email delivery must be retested with the real Resend transport once its domain is verified.
