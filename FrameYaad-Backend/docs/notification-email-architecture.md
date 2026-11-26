# Notification and transactional email audit — 2026-11-26

## Implementation stages

The Realtime/security stage was completed on 26 November; the durable outbox/email implementation followed on 27 November (see final-stage report below). Implementation and dev/mocked integration checks are complete, but actual signup/inbox delivery and public Resend-webhook delivery remain unverified and blocked by sender-domain/webhook configuration. Do not describe the full production/delivery verification as complete or deploy without approval.

## Assessment before changes

| Area | Existing behavior / evidence | Decision |
|---|---|---|
| Notification history | `notifications` has legacy customer records and shared staff records (`userId IS NULL`); `customer_notifications` has order events. Customer history endpoint already merges both sources. | Preserve both tables/history, APIs and shared frontend stores. |
| Authentication | Backend verifies Supabase access token and active DB user/role. Session uses HttpOnly cookies; login also returns access token. | Bootstrap Realtime via an authenticated, no-store endpoint; never send refresh/service-role keys. RLS checks live DB role, not editable JWT metadata. |
| Polling | Admin hook schedules 30-second reads per auto-fetch hook; customer store shares one 45-second polling loop. | Replaced with shared, reference-counted Realtime lifecycle. |
| Live DB security | Read-only catalogs showed RLS false on both tables, zero policies and an empty `supabase_realtime` publication. Direct anon/authenticated ACLs included REFERENCES/TRIGGER/TRUNCATE but not SELECT. | Apply notification-only RLS/SELECT permissions/publication first. |
| Order effects | Order placement/status/refund notifications use in-memory sets/timers and retries after commit. | Durable-event gap remains: crash/restart can lose notification work. Replace with transactionally inserted event intents in next stage, not a second notification system. |
| Appointment emails | Four branded templates and shared Resend transport already exist. Appointment saves before synchronous email send; status CAS prevents concurrent repeated action emails. | Reuse templates/transport; move dispatch into transactional outbox in next stage. |
| Signup | Supabase confirmation redirect/callback already exists. Registration creates in-app welcome notices; no verified-only Resend welcome dispatch exists. | Keep confirmation mail exclusively in Supabase. Add idempotent post-verification welcome job later. |
| Order email | Customer order in-app creation explicitly sends no email; required order transactional email channel is absent. | Add templates/job snapshots for placed/cancelled/shipped/delivered later. |
| Outbox / delivery | No persistent email queue/provider webhook table; appointment SENT means provider acceptance, not delivery. | Next stage needs durable job states/leases/retries, provider idempotency, delivery events and failure reconciliation. |

## Realtime stage implemented

- Added migration `20261126010000_notification_realtime_rls`; applied and recorded **only in the user-confirmed dev/test DB**. No history/business rows migrated or removed. `users` and business schemas are unchanged.
- Customer SELECT policy: own user ID plus active CUSTOMER DB role on both tables. Staff SELECT policy: active ADMIN/EMPLOYEE and shared `notifications.userId IS NULL`. Anonymous notification reads and client writes are denied. A restricted SECURITY DEFINER helper checks only the verified subject against `public.users`; it exposes no user rows or metadata-editable authorization.
- Added GET `/auth/notification-realtime-session` behind existing `authenticate`; returns existing verified access token, user ID/role, public Supabase URL/anon key, `Cache-Control: no-store`. No service key or refresh token. Existing login/session API shapes are unchanged.
- Frontend uses official lazy-loaded `@supabase/supabase-js` SDK (new dependency, rather than inventing a WebSocket protocol). One channel per role/user shared by bell/history; cleanup on last unsubscribe, logout and identity change; token renewal; bounded reconnect backoff; refresh on foreground/online/reconnect. REST remains authoritative for counts, pages, read state and action links.
- Listen to authorized INSERT/UPDATE only. DELETE events are deliberately not subscribed to because Postgres Changes does not apply row RLS to deleted rows; existing authorized delete actions continue unchanged. A deletion by a different staff session is not guaranteed to remove that already-loaded row immediately; reconciliation/navigation will refresh it. No notification history retention changes.
- Real test initially connected but missed an INSERT during startup. A channel join is earlier than CDC readiness. The client now reconciles on both SUBSCRIBED and the PostgreSQL `system:ok` message; disconnected fallback remains enabled until replication is ready.
- Successful routine notification GET debug/completion logs suppressed. Mutations, 4xx/5xx, transport/subscription failures remain observable. Other polling/jobs and request log selection remain unchanged (4xx completion logs use warn).

| Measure/check | Before | After / actual result |
|---|---|---|
| Admin scheduled notification requests | Every 30s = about 2/min per mounted auto-fetch hook (source-derived, not a browser measurement) | 0 scheduled reads while CDC is healthy; event-driven REST refresh |
| Customer scheduled notification requests | Every 45s = about 1.33/min per shared loop (source-derived) | 0 scheduled reads while CDC is healthy |
| Disconnected fallback | Existing scheduled polls | One 60s fallback; skips hidden tabs; reconnect backoff 5–60s |
| Actual private INSERT latency | Not previously measured | **803ms** in live dev Supabase probe (one sample, not an SLA; excludes subsequent REST render time) |
| Customer/other customer/staff/anonymous RLS | No notification RLS | Dev transaction-role fixture test passed; four rows rolled back and absence verified |
| Real JWT isolation / events | Not tested | Three ephemeral dev Auth/profile accounts: own-only INSERT, staff-only INSERT, read UPDATE, other-customer REST denial and staff private-history denial passed |
| Reconnect history | Poll-based | Dev disconnect/insert/reconnect SELECT recovered both own records and read state |
| Cleanup | N/A | All three ephemeral Auth accounts deleted; dev profile/notification remaining count 0; no orders/photos/stock touched |
| Mocked frontend regressions | Existing read/popup tests | 23 passed: listener sharing, no healthy polling, hidden tab, reconnect, cleanup, optimistic reads/rollback and original popup-link behavior |
| Backend regression | Existing notification tests | 18 notification/RBAC/read/log/bootstrap tests passed, then the additional anonymous-bootstrap check passed with the two bootstrap/log tests (19 unique tests total). Typecheck/build and targeted runtime/test lint passed. Standalone dev scripts execute with tsx; they are outside the existing ESLint project-service tsconfig. |

`scripts/verify-notification-rls.ts` uses existing dev users and rolls back all fixture writes. `scripts/verify-notification-realtime.ts` creates its own temporary Auth/profile accounts with reserved `.invalid` addresses and sends no emails, then cleans up. Run only against a dedicated dev/test project. `docs/notification-realtime-dev-rollback.sql` restores the exact observed pre-change dev ACL/RLS/publication state; review grants/policies before using in any other environment. Rollback does not automatically alter Prisma migration history.

## Audit-stage implementation plan (superseded by final-stage results below)

1. Add a minimal Prisma-backed delivery/event outbox with unique event/channel keys, atomic business mutation + intent insertion, SKIP LOCKED/lease claims, attempts/backoff, restart recovery and retained failed rows. Do not rebuild stock/revenue/status rules. Include durable notification intents, not just emails, to close the current post-commit in-memory gap.
2. Reuse appointment template builders; separate customer/admin recipients so one failed admin email does not cause a delivered customer email to be resent. Capture immutable old/new schedule values. Convert welcome and order events to idempotent email jobs only after successful verified/saved transitions.
3. Use Resend Idempotency-Key for ambiguous send retries, store provider message IDs, and explicitly handle its 24-hour dedupe window (never claim unconditional exactly-once external delivery). Add signature-verified delivery webhook/event reconciliation; accepted is not delivered.
4. Verify all requested lifecycle/failure/restart/inbox scenarios in dev, including simulated Resend failures, duplicate events, role changes, browser rendering and before/after request traces. Existing send-domain restriction from the appointment investigation must be rechecked/fixed before real delivery tests; no domain/DNS configuration changed here.

The first stage made no email/business-flow changes. The subsequent stage below intentionally changes email dispatch from synchronous/in-memory work to durable asynchronous jobs, as requested. No production deployment and no unconditional exactly-once external delivery claim.

## 2026-11-27: Durable event intents and transactional email outbox

### What changed

- Added private `DeliveryJob` and `EmailDeliveryEvent` Prisma models plus migration `20261126020000_transactional_delivery_outbox`, applied/recorded to the confirmed **dev DB only**. No business table fields, price rules, stock flow, order status/refund transitions, appointment fields or notification history were changed. The job ID default/index maps match actual PostgreSQL names.
- Small database AFTER triggers insert unique event intents inside the same transaction as order placement/status/refund, appointment creation/status/date, and the first verified CUSTOMER profile state. An aborted business transaction leaves no job. Triggers capture event snapshots, including the previous appointment date. This covers existing Prisma writers without duplicating stock/checkout/status logic or relying on a post-commit process-local timer.
- Reused original order/customer notification upserts and refund formatter; old enqueue entry points now only wake the persistent worker. Retained their handler APIs. Welcome in-app notification history is unchanged. Added operational appointment notifications and existing appointment/customer details links; bell body still goes to Notifications unread, while nested relevant links stop propagation and use existing read logic.
- Reused the shared Resend transport and extracted existing appointment templates into pure message builders. Added professional verified-welcome and order placed/cancelled/shipped/delivered templates, escaped values, saved discounted total/coupon snapshots, real event dates, existing customer order URLs and configured contact support details. No duplicate Supabase verification email. No shipping tracking fields exist in the current order model, so no invented tracking/link was added.
- The confirmation callback now synchronizes its already provider-verified email flag; existing middleware synchronization also wakes the worker. First verified state creates one `welcome:<user-id>` intent. Existing already-verified users are not bulk-emailed/backfilled. A verification completed elsewhere is recognized when the callback/authenticated profile synchronization next runs; no Auth webhook or periodic Auth-user crawl was added.
- Worker uses atomic SKIP LOCKED claims, unique lock tokens, a two-minute lease, six bounded attempts with 5s/30s/2m/10m/1h backoff, and failed-row retention. API writes wake it immediately; a quiet **five-second database recovery scan** catches restarts/missed wakeups (no one-second browser or DB scan, no empty-result logs). Database-outage scan backoff grows to 60s. Customer APIs no longer wait for Resend.
- Customer and optional admin appointment messages are separate child jobs: an admin send failure cannot resend the delivered customer message. Original/new appointment dates and message bodies are immutable job snapshots; sender is frozen before the first send. A newer appointment event prevents an older result overwriting current email status. Found/fixed a real test failure: PostgreSQL `now()` microseconds broke Prisma millisecond optimistic checks; tracking now writes millisecond precision and avoids no-op timestamp changes.
- Resend receives each job's stable Idempotency-Key. Jobs outside the **23-hour safety window from first attempt** are held FAILED for provider reconciliation instead of blindly resending beyond Resend's 24-hour dedupe retention. This is durable at-least-once intent processing with bounded external dedupe, not a mathematical exactly-once email guarantee. Failed jobs/payloads/provider IDs remain inspectable. `scripts/retry-delivery-job.ts <job-id>` requeues FAILED jobs only within this safety policy, preserving the key/window.
- Added POST `/api/v1/webhooks/resend` with raw JSON parsing before express.json, HMAC verification of Svix ID/timestamp/raw body, five-minute replay tolerance, timing-safe comparison, event-ID dedupe, minimal retained provider event records and acceptance/delivery separation. Handles callbacks arriving before provider ID persistence via reconciliation. Delivered/bounced/failed/complained/suppressed events update only the latest matching appointment's email status. Unknown signed event types are acknowledged without processing. Webhook signature headers are redacted.
- New real email sends are opt-in: `EMAIL_OUTBOX_DELIVERY_ENABLED=false` by default. Notification/event jobs still run; email jobs remain PENDING until configuration is ready. Password recovery/Supabase confirmation remain in their existing flows and are not disabled by this flag. No Redis or additional backend dependency.

### Actual verification

| Check | Result |
|---|---|
| Complete backend regression suite | **686 passed / 63 files**, after adding queue/templates/security tests; final validation rerun also performed |
| Focused frontend notifications | **23 passed**, including cleanup, listener dedupe, reconnect, optimistic read rollback and old order-link/body behavior |
| Full frontend suite | **323 passed / 347; 24 failures**. Includes UI/source-contract/fixture mismatches in checkout/header/products/reviews/toast/photo tests. No claim of a clean baseline: comparison baseline was not run. One old mixed checkout/poll assertion fails first on untouched checkout `aria-label`, before its obsolete 45s notification assertion. Do not remove features to satisfy old snapshots. |
| Builds/checks | Backend Prisma validation/typecheck/build and frontend production build passed; targeted new runtime/test lint passed. Standalone dev scripts are outside existing ESLint project-service config. Full unrelated lint debt was not rewritten. |
| Actual Realtime | Private INSERT **803ms** (one sample); private/staff isolation, read update and reconnect history verified with real ephemeral dev JWTs; all three Auth/profile accounts removed |
| Transaction boundary | Dummy order transaction intentionally rolled back: order and delivery intent both absent |
| Welcome verification/idempotency | Unverified dummy profile created no welcome job; verification and repeated verified update produced exactly one job |
| Lease/retry/restart | Concurrent claims yielded one worker; simulated send failure retained saved order/PENDING retry; retry succeeded with mock transport; stale lease recovered; unit tests retain exhausted jobs and block unsafe old-key replay |
| Order emails | Actual dev event/child jobs exercised placed/shipped/delivered, then separate cancellation flow; **mock transport only**, no inbox delivery claim |
| Appointment emails | Actual dev booked/confirmed/rescheduled/cancelled jobs and templates exercised; original date retained, prior/new dates distinct; repeated confirm rejected; mock transport only |
| Refund/in-app dedupe | INITIATED/COMPLETED event jobs processed; repeated customer cancel retained one job and one cancellation notification |
| Provider events | Simulated delivered event reconciled into deliveredAt; signature tamper/expiry tests passed. Actual public webhook/Resend delivery not exercised |
| Cleanup | All new dummy orders/items/appointments/profiles/notifications/jobs/provider events removed; failed first-run cleanup was completed explicitly and verified. No real customer records or photo files touched. The older user-retained appointment from the earlier task was not deleted |
| Baseline restored | Before/after: **16 orders; active-order revenue 16380.2; total variant stock 82**. New test fixtures all zero after cleanup |

Dev scripts: `verify-notification-rls.ts`, `verify-notification-realtime.ts`, `verify-delivery-outbox.ts` (normal and `OUTBOX_VERIFY_CANCEL_ONLY=true` mode). ORM-created dummy order fixtures test event/queue integration, not a browser-driven checkout. Browser signup/checkout-to-inbox tests and actual delivery remain manual/blocked. No actual emails were sent by automated integration tests.

### Configuration and remaining verification

Read-only Resend check on **2026-11-27**: domain status `not_started`, sender uses `resend.dev`, webhook secret absent, outbox dispatch false. Existing test-sender restriction prevents delivery to the supplied test inbox. No DNS/domain/actual .env changes were made.

1. Verify the sending domain in Resend and set existing `EMAIL_FROM` to an address on that verified domain; retain existing server-only `RESEND_API_KEY`.
2. Register `https://<your-backend>/api/v1/webhooks/resend` in Resend for sent/delivered/delivery_delayed/bounced/complained/failed/suppressed. Set server-only `RESEND_WEBHOOK_SECRET` to the dashboard's `whsec_...` secret. Local actual webhook testing needs an approved reachable test endpoint; none was exposed here.
3. Review pending dev jobs/recipients, then set `EMAIL_OUTBOX_DELIVERY_ENABLED=true` and restart. Do not enable production dispatch or deploy this release without approval and applying/reviewing both migrations first.
4. With the controlled inbox, run actual Supabase signup verification/callback, welcome, real customer checkout and four order email events, and the four appointment emails. Verify actual Resend delivery events and inbox/spam, not an accepted response or mocked delivery event. Verify browser UI rendering/latency and two-tab/logout/different-role flows too; current tests cover store/lifecycle logic and actual server-side RLS/JWT feeds, not full browser E2E.
5. Check Supabase URL/confirmation template/SMTP separately; no duplicate confirmation service or Supabase Dashboard change was made.

Rollback aid `docs/transactional-outbox-rollback.sql` removes only the new business-event triggers/function after stopping/reverting the worker/application. It deliberately retains private jobs/events for reconciliation; never discard pending/failed work. The first-stage dev ACL rollback remains separately documented. Production migration history and rollback require explicit review.

### Files for this task

Backend: `prisma/schema.prisma`; the two dated migration folders; `src/modules/auth/auth.routes.ts`, `auth.service.ts`; `src/middleware/auth.middleware.ts`, `method-call-logger.middleware.ts`; `src/modules/notifications/notification-realtime.controller.ts`, `notification-logging.ts`, `notifications.service.ts`; existing order placed/status/refund effect modules; `src/modules/appointment/appointment.service.ts`; existing appointment/email transport modules; new `src/services/delivery/*`; `src/app.ts`, `src/server.ts`, `src/config/env.ts`, `logger.ts`; `.env.example`; verification/retry scripts; affected/new tests and this report/README/rollback aids.

Frontend: `src/services/notification-realtime.ts`; notification hooks/stores; `src/pages/notifications/NotificationsPage.tsx`; `src/layouts/AdminLayout.tsx` (nested non-order destination links only); `public/_headers`; package manifest/lock; notification lifecycle/shared-store tests; README. No new frontend secrets; use existing API URL and the verified bootstrap. New official SDK requires Node >=22; tested on Node 24. npm audit reports 22 total tree findings (9 moderate/12 high/1 critical); no unrelated dependency auto-fixes were run.

Primary references: https://supabase.com/docs/guides/realtime/postgres-changes ; https://supabase.com/docs/guides/database/postgres/row-level-security ; https://resend.com/changelog/idempotency-keys .
