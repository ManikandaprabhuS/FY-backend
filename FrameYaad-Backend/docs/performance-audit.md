# FrameYaad performance audit — 6 November 2026

## Scope and constraints

Reviewed frontend routing, layouts, shared stores, request lifecycles, catalog and admin lists, image/crop code, notification polling, backend middleware, authentication, database read patterns, product uploads, orders, appointments and email delivery.

This pass preserves business rules, API response shapes, authentication/RBAC and current UI. No database/schema or environment changes were made for this performance pass. Measurements below are local observations against the configured remote test database, not production load-test results or Core Web Vitals.

## Implemented improvements

| Area | Finding | Change |
| --- | --- | --- |
| Initial JavaScript | Admin and customer layouts were eagerly imported into the entry bundle | Split both layouts with React.lazy under the existing Suspense boundaries |
| Catalog requests | Concurrent identical reads repeated network and database work | In-flight request coalescing, keyed by parameters, endpoint visibility and staff session; settled results are not cached |
| Customer navigation | Nonempty shared product state prevented a fresh public catalog request | Fetch the public catalog on entry, with concurrent duplicates coalesced; do not reuse staff query results as the freshness signal |
| Variant editing | Form reloaded a product after store actions had already refreshed or updated it | Remove the redundant successful-edit reload; preserve the error state/modal on failed saves |
| Homepage module graph | Homepage imported through a barrel that re-exported unused carousel modules | Import the two rendered homepage components directly |
| Order lists | One list query plus six separate count queries per request | One list query plus one grouped count; preserve ownership, search, pagination and original status-summary semantics |
| Product uploads | Up to ten storage writes executed serially | At most three concurrent uploads, ordered results and safe rollback only after running uploads settle |
| Asset caching | New uploads had short default cache lifetimes | One-year cache lifetime for newly uploaded UUID-named assets; replacement uses a different URL, never overwrites an existing asset |
| Public JSON transfer | Catalog JSON was sent uncompressed | Gzip/deflate negotiation for successful public catalog GETs above 1 KiB, compression level 4; account/authentication/error responses excluded |
| Logging | Each API request generated structured method logs, plain console logs and completion logs | Keep normal HTTP completion/error/audit logs; method context is debug-only, without duplicate console output |

## Measurements

### Production frontend build

Entry JavaScript only (not the entire route dependency graph):

- Before: 352,948 bytes raw / 110,105 bytes gzip.
- After: 312,004 bytes raw / 98,961 bytes gzip.
- Reduction: approximately 11.6% raw / 10.1% gzip. Layout code still loads when its route needs it.

### Public catalog transfer

Measured from the running local HTTP endpoint with the same database catalog and query:

- Identity response: 6,604 bytes.
- Gzip response: 1,793 bytes.
- Reduction: approximately 72.9% of JSON response bytes.
- Decoded JSON and successful response status verified.

### Order database reads

- Explicit Prisma operations per list request: seven before, two after. Relation-loading queries may add additional SQL statements internally.
- Before samples: 3,355 / 1,153 / 1,114 ms.
- After samples: 1,097 / 594 / 1,582 ms.
- Samples include connection warm-up and variable remote database/network latency. The query-count reduction is deterministic; these few samples are not evidence of a guaranteed latency percentage.

### Duplicate-read test

- Twenty concurrent requests for one key executed one loader call.
- A later read executed a new loader call (no stale TTL cache).
- Separate session keys stayed isolated; failed requests could be retried.

## Validation

- 140 backend tests passed, including grouped-order summaries, upload ordering/concurrency/failure settlement and compression exclusions.
- Backend TypeScript, lint and production build passed.
- Frontend production build passed; focused lint passed for the request, route and customer-page changes.
- The admin product form retains two pre-existing react-hooks/set-state-in-effect lint violations, confirmed against its original Git version; not rewritten in this pass.
- Read-only database checks confirmed grouped summary equivalence across status filters and customer isolation.
- No test emails, orders or customer accounts were created for this performance audit.

## Findings retained or requiring deployment validation

1. Authentication still verifies Supabase identity and current database role/activity on protected requests. No permission cache was introduced for speed.
2. Existing catalog pagination and client filters remain unchanged. A larger catalog needs server-side faceting/filtering, not silently downloading or truncating more data.
3. Customer list responses include complete order summaries, and newsletter export is unbounded. Changing those contracts needs dedicated paginated/export work before very large datasets are supported.
4. Appointment APIs intentionally wait for delivery status from the email provider. Moving that work off-request needs a durable job queue/outbox; fire-and-forget promises would risk lost messages and change response semantics.
5. Original catalog images can be large, the footer PNG is about 708 KiB, and the error artwork is about 1.1 MiB. Responsive image derivatives should be added through an image pipeline/CDN; avoid assuming paid Supabase transformations are enabled. Existing lazy image loading is retained.
6. Google Fonts and remote Supabase/Resend calls remain external latency dependencies. Consider self-hosted fonts, appropriate backend/database regions and a hosting tier without cold starts, based on production traces.
7. npm currently reports dependency security advisories. No forced major-version audit upgrade was performed as part of performance work; review separately.
8. Test deployed mobile/desktop LCP, INP, CLS and p95 API latency under realistic concurrency. Local build and read-only tests do not establish 60 FPS or fast service for every user/network.

## Deployment

Deploy both frontend and backend. Backend changes include package.json/package-lock.json for compression and its TypeScript types; install locked dependencies before building. No migration is required for these performance changes. Existing service credentials remain private and unchanged.

References: React lazy (https://react.dev/reference/react/lazy), Express performance guidance (https://expressjs.com/en/advanced/best-practice-performance/), Prisma v6 transactions (https://www.prisma.io/docs/orm/v6/prisma-client/queries/transactions).
