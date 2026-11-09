# FrameYaad Backend

## Audit Log — Incremental application audit (6 November 2026)

Work is performed in the requested order. A task is checked only after its code and validation are complete. Previous performance work is documented separately in `docs/performance-audit.md`; its results are not substituted for this audit's before/after tests.

- [x] 1. Pagination — bounded list APIs and customer/admin page controls verified
- [x] 2. Database indexes — live indexes verified valid
- [x] 3. Query optimization — bounded phone lookup and parallel detail reads
- [x] 4. N+1 queries — variant writes and customer-report reads batched
- [x] 5. Query execution time — measured; residual latency risks documented
- [x] 6. Error handling — global status mapping and client messages verified
- [x] 7. Invalid input testing — baseline matrix and regression tests
- [x] 8. Empty field checks — required fields and PATCH omission semantics tested
- [x] 9. Duplicate scan — zero conflicts; no deletion required
- [x] 10. Admin field validation — current forms and approved legacy image requirement verified

### Task 1 — Pagination

Checked: catalog, orders, customers, employees, coupons, product discounts, notifications, wishlist, wishlist analytics, appointments, newsletter, addresses, nested order histories and reference selectors.

Found: primary admin list APIs already have page/limit/total metadata (generally default 20, maximum 100). Customer catalog UI only downloaded the first 50 products and filtered/paginated those locally; wishlist and its analytics were unbounded; notifications UI only exposed the first 100 records. Saved-heart state must not be inferred solely from the first wishlist page. Nested order histories were paginated; reference-selector limitations are recorded below.

Changes so far: true public catalog pages with server-side filtering/sorting and global facet counts; bounded wishlist and analytics pages; wishlist Load more plus a bounded customer-owned heart-state lookup (maximum 100 identifiers); paged notification UI with global read/unread counts. Existing routes and response collection fields are retained; pagination/facet/summary metadata is additive.

Validation: 152 backend tests passed; backend TypeScript/lint and frontend builds passed. The configured four-product test catalog returned two distinct pages at limit=2, total=4, totalPages=2; a nonexistent material returned total=0. Tests simulate 55 products to verify pages beyond the former 50-product cap, reject page=0/negative/fractional and limit=0/negative/101/NaN, and verify wishlist owner scoping and the 100-identifier lookup bound. No database records were modified for these checks.

| List/view | Before | After |
| --- | --- | --- |
| Customer catalog | First 50 only; local filtering/sorting and 12-card slices | Server pages of 12, accurate collection-wide filters/facets/sort and totals; API default 20/max 100 |
| Customer wishlist | Unbounded full collection | 20-item pages, Load more, server total; heart-state lookup separately bounded to 100 visible identifiers |
| Admin wishlist analytics | Unbounded groups | Default 20/max 100 groups with total and Previous/Next controls |
| Admin notifications | UI exposed first 100 only | 20-item server pages with global All/Read/Unread counts and matching filters |
| Customer detail order history | First 100 only | 10-item server pages; total order count/spend/last-order KPI values come from complete server aggregates |
| Address collection | Unbounded | Default 20/max 100 with additive pagination metadata; no existing frontend address-list view consumes this endpoint |
| Products/orders/customers/employees/coupons/discounts/appointments/newsletter admin lists | Existing bounded APIs and page controls | Retained; general API defaults 20/max 100, existing view page sizes retained |

Scope notes: transactional cart aggregates and explicit full CSV exports must preserve their complete contents and are not silently truncated. Customer Orders is currently a placeholder, not an implemented history view. Reference dropdowns retain their existing maximum-100 API reads; making them searchable across larger reference datasets is tracked as a remaining usability risk, not a claim that all records are currently rendered. Legacy customer-list order summaries remain compatible; their query/payload cost is reviewed in Task 3.

Data safety: no audit data deletion has been performed. Task 9 must produce a backup and a documented record list before any cleanup; duplicate-looking names alone are not treated as proof that records should be merged.

### Task 2 — Database indexes

Checked the live public-schema index catalog against observed Prisma/raw query filters, joins and ordering. Several indexes declared in Prisma were absent from this database. Existing primary keys and unique email, phone, employee ID, product identifier (SKU), coupon-code and cart/wishlist membership constraints were retained.

Applied 22 additive indexes using `prisma/compatibility/005_audit_query_indexes.sql`, with `CONCURRENTLY` outside transactions. Reasons are documented next to every statement: role/date staff lists; owner/status/date order queues; order-item/product/material/variant/image joins; owner-scoped addresses and notifications; wishlist paging/analytics; reverse product references; coupon ordering. Three expression unique indexes prevent normalized email, coupon-code and per-product color-image duplicates. Read-only conflict checks found zero conflicting groups for these three keys before creation. Product names are deliberately not unique because multiple legitimate products may share a display name.

Result: all 22 requested indexes exist and are valid (`pg_index.indisvalid=true`); no invalid public indexes were found. No rows were deleted or modified. Ordinary new index definitions are reflected in Prisma; expression/partial indexes remain documented SQL because Prisma cannot fully model them. This was an additive index script, not a generated Prisma migration. Query timing improvements are measured separately in Task 5; index presence alone is not a latency claim.

### Task 3 — Query optimization

Checked list/detail selects, catalog hydration, customer search, order summaries and reference reads. Existing list queries mostly select explicit view fields, and independent count/list queries are already paired. Found customer phone search could fan out to every remaining customer page, download private profiles and order summaries, and still miss formatted numbers on page 1. Replaced it with one staff-authenticated, validated, parameterized phone lookup returning only id/name/phone, at most one customer. Local and country-code suffix matching is retained. Customer detail profile and order aggregates now execute concurrently rather than sequentially.

Measured structural result: phone lookup is exactly one bounded query/request instead of a potentially collection-sized request fan-out; tests verify bound, CUSTOMER role, parameter binding, normalization and 404. Backend lint/typecheck and all 155 tests pass; frontend production build passes. No settled authorization caching was added. Customer-list order summaries are retained because the existing expanded rows and CSV report consume them; removing them would change functionality. This legacy nested-history payload remains a documented scalability risk pending a dedicated paged expansion/export design, not an unmeasured speed claim.

### Task 4 — N+1 queries

Checked query-bearing loops, async maps, relation selects and frontend CSV exports. Found one insert per new variant inside a product transaction and one HTTP/detail lookup per order in the customer report. Variant creation now pre-generates UUIDs and performs one `createMany`, retaining the first input variant as primary and the existing atomic transaction. The customer report uses staff-only order batches of at most 100 IDs, sequentially chunked to avoid connection-pool flooding. Existing CSV columns and record coverage are unchanged. Other service loops only transform already-loaded data; wishlist names and customer order summaries are already batched.

Before/after operation counts: N variant inserts -> 1 (maximum 50 variants); N order-detail requests -> ceil(N/100). No write benchmarks were run against customer data. Regression tests cover batch insertion, primary ordering, staff access, customer denial and oversized batches. Backend lint/typecheck and 158 tests pass; frontend production build passes. No records were created or deleted by these tests.

### Task 5 — Query execution time

Ran `npx tsx prisma/audit-query-timings.ts` against the configured database: one warm-up plus five sequential samples per read path, median reported below. These are service/query wall times from the local machine, not HTTP authentication-inclusive endpoint times or load tests. Before/after here means immediately before/after removing transactions around independent read-only list/count queries. PostgreSQL's default READ COMMITTED transactions did not provide a shared snapshot for these reads; write transactions and serializable checkout remain unchanged. Frontend/endpoints retain the same result fields. The explicit benchmark prints timings only, never parameters, records or credentials; no temporary timing middleware remains enabled.

| Endpoint/query path | Before median ms | After median ms |
| --- | ---: | ---: |
| Public catalog page | 379.63 | 405.72 (unchanged path; network variation) |
| Admin products page | 614.06 | 310.05 |
| Customers page | 310.22 | 140.80 |
| Employees page | 239.67 | 68.22 |
| Orders page + summary | 691.94 | 874.94 (variable relation/network cost; not improved) |
| Coupons page | 238.90 | 76.02 |
| Product discounts page | 516.99 | 116.51 |
| Notifications page + summary | 239.62 | 67.52 |
| Wishlist page | 250.64 | 73.78 |
| Wishlist analytics | 310.57 | 176.13 |
| Appointments page | 246.40 | 70.36 |
| Newsletter page | 352.22 | 134.31 |
| Addresses page | 243.86 | 90.01 |
| Cart read, no upsert | 132.44 | 174.70 (unchanged path) |

Read-only EXPLAIN ANALYZE measured database execution at 0.082 ms for the product date page, 0.052 ms for the order date page, and 0.060 ms for customer role/date lookup. The small test dataset is not representative of production volume. Most simple reads now meet 100–200 ms locally; product/order relation-heavy paths do not. Remaining recommendations: co-locate API and database, benchmark with representative data/concurrency, and evaluate joined relation loading with a dedicated compatibility test before introducing it. No index-before timing was captured, and no index improvement is fabricated. Authentication and email delivery were not benchmarked with real credentials or emails.

### Task 6 — Error handling

Checked admin/customer route validation, Express 5 async handlers, global errors, Prisma errors, uploads and shared frontend API handling. Existing ApiError/Zod/duplicate/not-found/authorization handling was retained. Found development responses leaked stacks, malformed/oversized JSON and Multer errors became generic 500s, unsupported uploads were silently dropped, and database pool failures were indistinguishable from bugs.

Fixed: stacks never reach clients; invalid JSON is 400, large JSON/files 413, unsupported media 415, database connectivity/pool unavailability 503, duplicates 409, missing records 404, auth failures 401/403. Responses retain the existing envelope and request ID; internal errors remain server-side. The shared frontend API handler forwards backend field messages and distinguishes timeout/network failures. Previously silent customer-detail and coupon-assignment failures use existing error toasts. Existing forms continue using their current error components, layouts and routes.

Validation: backend typecheck/lint and all 165 tests pass; frontend production build passes. Seven added tests verify error statuses, malformed/oversized JSON and absence of private details/stacks. Existing suites exercise account, employee, product, coupon, appointment, cart/order, wishlist and notification authorization. Customer incidents and standalone category/color CRUD are not implemented backend modules and are not invented by this audit.

### Task 7 — Invalid input testing

Captured schema acceptance before fixes using offline safeParse probes (no database writes). Added the invalid-input matrix in `tests/input-validation-audit.test.ts`; the complete suite passes 204 tests. Checked wrong types, negative/zero/out-of-range numbers, long strings, malformed emails/dates, HTML labels, unsafe image URLs and disguised/oversized uploads. Existing appointment, auth, coupon and RBAC suites cover their public request paths. Browser form interaction is not substituted by schema tests; client-side checks are completed in Task 10.

| Module/field | Invalid input | Previous behavior observed | Fixed behavior |
| --- | --- | --- | --- |
| Account/employee phone | `abcdefghij` | Accepted by schema | Rejected with phone validation; formatted numeric numbers retained |
| Product/variant price | 0 | Accepted | Rejected; must be positive and fit Decimal(12,2) range |
| Variant stock | -1 | Already rejected | Retained; also capped at PostgreSQL integer maximum |
| Product images | Missing/empty default gallery | Accepted by backend | New product and explicit gallery replacement require a default image; color/variant images remain optional |
| Product name | HTML script tag | Accepted as text | Rejected as plain-text label; React escaping remains in place |
| Product name/email | Too long/malformed | Already rejected by length/email schemas | Retained and regression tested |
| Coupon dates | null or numeric epoch | Coerced to dates and accepted | Only real Date values or valid ISO date/datetime strings accepted; impossible calendar dates rejected |
| Coupon percentage | 101 | Already rejected | Retained; updates validate merged stored/new fields |
| Coupon flat/percentage value | 0 | Accepted | Rejected; NONE uses zero |
| Coupon usage limit | 0/-1 | Already rejected | Retained |
| Upload | Unsupported type | Silently dropped before Task 6 | 415; MIME and header signature checked before any storage write |
| Upload | Larger than 10 MB | Generic failure before Task 6 | 413; maximum 10 files, 10 MB each |
| Coupon empty update | `{}` | Accepted | Tracked and fixed in Task 8 |

Uploads now receive server-chosen extensions rather than user-supplied filename extensions. Header signatures prevent basic MIME spoofing, not a full antivirus/content-decoding guarantee. SQL uses Prisma parameter binding; HTML-like plain labels are rejected rather than silently rewriting legitimate text. No arbitrary stripping of passwords or email case changes beyond existing normalization was introduced.

### Task 8 — Empty field checks

Tested missing/undefined, null, empty and whitespace-only required account, variant, address and coupon fields, plus empty updates for customers, employees, addresses, products, variants, coupons and discounts. Required product names/materials/colors/variants/images are checked before create/save in the existing admin form; the variant form reports missing fields rather than silently returning. Coupon final submission rechecks required dates. Existing employee forms already trim/check required names and emails.

Found empty coupon PATCH not only succeeded but injected create-time defaults (`isActive=true`, false flags and zero minimum order value). Removed defaults from PATCH fields and reject empty coupon/discount updates. Omitted fields now remain omitted; explicit false/null remains supported where intentional. No stored coupon flags were changed by this audit. Optional clearable profile fields remain nullable, description clearing is retained, and zero stock remains valid.

Result: 235 backend tests pass, backend typecheck/lint and frontend build pass. `tests/empty-input-audit.test.ts` checks every required field across the tested schemas and verifies a description-only coupon update does not activate/reset anything. All tests are isolated/mocked; no invalid records were inserted into the connected database.

### Task 9 — Duplicate scan and prevention

Ran the read-only `prisma/audit-duplicates.ts` on the configured database, using trim/case normalization where appropriate. Results:

| Key checked | Conflicting groups |
| --- | ---: |
| Emails / coupon codes / product identifiers (SKU) | 0 / 0 / 0 |
| Product display names (review only) | 0 |
| Employee identifiers / employee names (review only) | 0 / 0 |
| Formatted phone equivalents (review only) | 0 |
| Material brand/name | 0 |
| Per-product color images | 0 |
| Variant configuration + price | 0 |
| Repeated color labels within a material | 0 |

Cleanup report: **zero records removed, merged or rewritten; removed-record list is empty**. No cleanup backup was needed because no destructive operation was performed. Future cleanup must export affected rows and references before any change. Repeated display names or shared phone numbers alone are not proof of duplicate identities and will not be automatically merged.

After the zero-conflict precheck, applied `006_audit_normalized_uniqueness.sql`: normalized SKU, material brand/name, and per-product variant configuration/price uniqueness. All three indexes are valid. Together with Task 2's normalized email/coupon/color-image indexes and existing unique membership/identifier constraints, database uniqueness is race-safe. Product color arrays also reject case/space-equivalent duplicates. Product/employee display names intentionally remain non-unique. Expression indexes are managed in documented SQL rather than falsely represented as Prisma-supported expression fields.

### Task 10 — Admin field validation

Checked the routed product/variant/color/gallery, employee, profile, coupon, product-discount, order, appointment and notification workflows. Added reusable frontend format/length/range checks without adding price/discount/stock calculations. Backend Zod validation remains authoritative. Products require positive prices, nonnegative integer stock, bounded text, unique color labels and a default image in the current admin add/edit flow; optional color/variant images remain optional. Fractional stock is rejected instead of silently truncated by parseInt. Coupon fields validate enums, positive applicable discounts, percentages <=100, integer usage bounds, real dates, and merged-field relationships during partial updates. Profile/employee name/email/phone/password bounds match the existing backend policy. File checks run before preview/upload and server storage. Extreme page values above 1,000,000 are rejected before overflowing Prisma skip offsets.

| Module | Validation coverage |
| --- | --- |
| Accounts/employees/profile | Required/trimmed names, length limits, email format/normalization, numeric phone format, existing password bounds; role never accepted from public registration |
| Products/material/color labels | Required fields, lengths, plain-text labels, normalized color uniqueness, default gallery image in routed admin flow |
| Variants | Required size/mount/glass enum, positive bounded price/offer price, integer stock 0..2147483647, optional safe image URL |
| Coupons | Required code/type/value/dates, code format, Decimal/integer bounds, percentage/date/usage relationships checked on merged backend state |
| Product discounts | UUID references, optional valid expiry, nonempty strict updates; backend reference and uniqueness checks |
| Orders/cart | Existing owned-address/customer authorization, quantity/status enums and server transition rules retained |
| Appointments | Existing Indian phone/future date/location/frame requirements retained; valid calendar input and plain-text name checks added |
| Notifications/wishlist | Valid UUIDs/enums, authenticated ownership/audience, bounded pages/batches; no new notification editor invented |
| Category/customer incident/payment | No implemented category/incident CRUD to validate; payment deliberately untouched |

Follow-up found while exercising validation errors: product-discount stores could put a structured details object into an error string and crash rendering. Coupon/discount stores now always hold safe message strings, clear stale details, and display errors instead of endless detail loaders.

**Approved contract update:** the user explicitly chose to require images on legacy `POST /api/v1/products` too. It now requires an `images` array (1–30 entries) with at least one default/non-color image. Each entry has `imageUrl` (HTTP/S), `displayOrder` (positive integer), and optional `color`. Product/gallery creation uses one atomic Prisma nested write; missing, empty or color-only galleries return 400 before any write. The current dashboard's `/products/addProduct` uses the same gallery validator. Existing stored products are unchanged. Postman's Create Product example was updated: set `productImageUrl` to the public URL returned by the existing upload endpoint before sending it. Legacy image-less callers must add this field; the route and response envelope remain unchanged.

Final verification: `npm run verify` passes (Prisma validation, TypeScript, backend ESLint, 244 tests and production build). Frontend production build and five isolated validation suites pass; targeted shared-code lint passes. Full frontend lint still reports 38 errors/6 warnings in legacy code (down from the observed 49/6 after fixing touched coupon/discount stores). Local backend/frontend HTTP smoke checks pass; catalog page limit=2 returns total=4 and totalPages=2; limit=101 and an extreme page return 400. No browser/mobile visual or production-concurrency test is claimed.

### Remaining risks / recommendations

- Product/order relation-heavy reads still exceed 200 ms over the current remote connection. Co-locate API/database and evaluate joined loading under representative production data before promising a latency SLA.
- Existing customer-list nested order summaries and first-100 reference selectors remain compatibility/scalability limitations. Dedicated paged row expansions/searchable selectors/streamed full exports need a separate UI/API design rather than silently removing report content.
- Update any external legacy product-creation caller to send the approved required images array. Audit fixes do not rewrite historical products or invalidate stored data retroactively.
- Full frontend lint is not clean; avoid treating the passing build/targeted tests as full browser/end-to-end coverage.
- File signature checks are not antivirus or complete media decoding. Add an isolated scanning pipeline if required by the deployment threat model.
- Database expression indexes are in the two compatibility SQL files; preserve them during future manual schema/migration work.
- No customer/account/order data was deleted or changed, no emails were sent, no credentials were hardcoded, and no Prisma migrations were generated/run. Only additive database indexes were applied. Authentication/RBAC, payment and pricing/order calculations were not rewritten.

Changed-file inventory: [audit file inventory](docs/audit-file-inventory.md).

FrameYaad's REST API is built with Express, TypeScript, Prisma, Supabase PostgreSQL, and Supabase Auth. Validation, authorization, and business logic remain in the backend; this repository contains no frontend code.

## Backend Progress

- [x] Project Setup
- [x] Authentication
- [x] User Management
- [x] Employee Management
- [x] Product Management
- [ ] Material Management
- [ ] Variant Management
- [ ] Product Images
- [x] Wishlist
- [x] Cart
- [x] Orders
- [ ] Coupons (Future phase)
- [x] Notifications
- [x] Coupon Management (backend CRUD)
- [ ] Customer Incidents (Future phase)
- [ ] Payments (Deferred)

## Completed Features

### Authentication and security

- Customer registration and role-specific customer/admin/employee login
- Secure first-admin bootstrap; later admin registration requires an admin session
- HttpOnly access/refresh cookies and bearer-token support for Postman
- Session refresh, global logout, current-user lookup, and profile updates
- Forgot-password email and recovery-session password reset for every role
- Authenticated password change with mandatory old-password verification for every role
- Global session revocation after password changes and resets
- Supabase token verification plus database-backed active status and role checks
- Email/phone verification-state synchronization from Supabase Auth
- Admin-only RBAC middleware and employee/customer ownership protection
- Trusted-origin validation for state-changing cookie requests
- Strict request validation and consistent error responses

### Deployment logging

- Every API operation emits a meaningful method-call message through both structured Pino logging and `console.log`
- Examples include `Product Add method is calling`, `Order Checkout method is calling`, and `Notification Mark Read method is calling`
- Structured entries include the request ID, HTTP method, and path for correlation with the existing completion/error logs
- Passwords, tokens, cookies, authorization headers, and request bodies are never included in method-call logs
- Unknown and future API routes receive a safe `<METHOD> <PATH> API method is calling` fallback

### Customer management

- Customers can register, log in, view/update only their own profile, change password, and request password recovery
- Admins can list, search, filter, view, update, deactivate, and reactivate customers
- Customer email and role are immutable through profile endpoints to prevent identity/authorization drift

### Employee management

- Admin-only employee creation, listing, search, filtering, viewing, updating, deactivation, reactivation, and permanent deletion
- Employees can log in, view/update only their own profile, change password, and request password recovery
- Employees can use customer management but cannot access Employee Management routes

### Product management

- Authenticated customers, employees, and admins can list/search/filter and view products
- Only employees and admins can create, update, or delete products
- Customer attempts to write return HTTP `403`; unauthenticated reads return HTTP `401`
- Product writes require existing active materials and variants
- Product responses include material, variant, and ordered image information
- Product creation records the authenticated employee/admin in `created_by`

### Customer addresses and cart

- Customers can CRUD only their own delivery addresses
- Customers alone can view, add, update, remove, and clear their cart
- One cart is maintained per customer and duplicate products merge quantities
- Cart prices and subtotals are calculated from the active variant in the backend
- Admin/employee cart access and all cross-customer cart access return HTTP `403`

### Orders

- Customers checkout their own cart using an address they own
- Checkout atomically validates availability, refreshes current prices, creates price-snapshot order items, and clears the cart
- Customers can list/view only their orders
- Admins and employees can list/view all orders and filter by customer or status
- Only admins/employees can update order status
- Status transitions are controlled: `PLACED -> CONFIRMED -> PROCESSING -> READY_TO_SHIP -> SHIPPED -> DELIVERED`, with cancellation allowed before shipping
- Orders are retained as audit records and cannot be hard-deleted

### Wishlist

- Logged-in customers can add active products, list their own wishlist, and remove their own entries
- Duplicate wishlist products are rejected with HTTP `409`
- Wishlist ownership comes only from the verified session; the API never accepts a customer id
- Admins and employees cannot access customer wishlist endpoints

### Notifications

- Customer registration creates a private welcome notification and one shared new-account notification for staff
- Checkout creates a private order confirmation and one shared new-order notification for staff
- Notification generation is part of the same database transaction as registration or checkout
- Admins and employees see the same operational notification feed; customers see only their private notifications
- The first admin/employee who marks a shared notification read is preserved in `readBy` (`id`, `name`, `email`, and `role`)
- Admins and employees can read and delete shared staff notifications

### Database schema

Migration `20260801093000_initial_current_scope` is deployed to Supabase and creates:

- `users`
- `user_addresses`
- `materials`
- `variants`
- `products`
- `product_images`

Migration `20260801161500_cart_and_orders` is also deployed and creates:

- `carts`
- `cart_items`
- `orders`
- `order_items`

Migration `20260801170000_wishlist_and_notifications` is deployed and creates:

- `wishlists`
- `notifications`
- `notification_type` enum (`ACCOUNT_CREATED`, `ORDER_PLACED`)

Migration `20260801180000_shared_staff_notifications` is deployed and makes operational notifications shared between admins and employees while retaining private customer notifications and `read_by` tracking.

All application tables have RLS enabled. There are no browser policies because Express is the only business-data access layer.

## API Reference

## Recent Backend Updates

- Order list responses now include database-derived status totals (`pending`, `processing`, `shipped`, `delivered`, and `cancelled`) so dashboards do not calculate global KPIs from one paginated page.
- Customer list responses now include order summaries scoped to the returned customer page, eliminating the frontend's separate 100-order bootstrap request.
- These performance additions are backward-compatible and do not change the Prisma schema or existing endpoint paths.

### Coupon Management (backend complete)

- Added standalone `Coupon` model with coupon and discount enums, indexes, date/usage/percentage constraints, and admin creator relation.
- Added admin-only routes: `GET /coupons`, `GET /coupons/:id`, `POST /coupons`, `PUT /coupons/:id`, `PATCH /coupons/:id/status`, and `DELETE /coupons/:id`.
- Added pagination, search, active-status filtering, and sorting.
- Added validation for dates, discount limits, usage limits, and unique coupon codes.
- Added structured logs for coupon creation, updates, deletion, activation, and deactivation.
- Coupon application, checkout integration, Product Discount, and frontend UI are intentionally deferred for review.

### Product Discount (variant-based backend complete)

- Product discounts are assigned to `Variant` records (the project equivalent of ProductVariant), never to an entire Product.
- Added `ProductDiscount` with `productVariantId`, `couponId`, optional `expiresAt`, timestamps, foreign keys, indexes, and a unique variant/coupon combination.
- Added admin-only CRUD routes: `GET/POST /product-discounts`, `GET/PUT/DELETE /product-discounts/:id`.
- Assignment responses include variant, parent product, and coupon information.
- Validates variant/coupon existence, expiry, and duplicate assignments.
- Checkout application, frontend UI, and discount calculation are intentionally deferred.

- Product listing supports server-side pagination with `page`, `limit`, `search`, and `isActive` filters.
- Order listing supports server-side pagination and status/customer search filters.
- Customer and employee listing endpoints return pagination metadata.
- Product create/edit transactions support multiple variants and image persistence.
- Product and edit transactions use extended Prisma timeouts for multi-variant/image operations.
- Variant price validation follows the database rule `selling price <= MRP`.
- Authentication, role checks, and structured method-call logging remain enforced for all protected operations.

All endpoints use the default prefix `/api/v1`.

### Authentication and self-service

Login sets `frameyaad_access_token` and `frameyaad_refresh_token` as HttpOnly cookies and also returns the short-lived access token for cross-site clients to send as an `Authorization: Bearer <token>` header. Refresh tokens remain HttpOnly-only and are never returned in JSON. The authentication middleware verifies the access JWT with Supabase, then loads the user's current role and active status from PostgreSQL before RBAC runs.

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/auth/customer/register` | Public | Register customer |
| `POST` | `/auth/admin/register` | First admin public; then admin | Bootstrap or create admin |
| `POST` | `/auth/customer/login` | Public | Customer-only login |
| `POST` | `/auth/admin/login` | Public | Admin-only login |
| `POST` | `/auth/employee/login` | Public | Employee-only login |
| `POST` | `/auth/staff/login` | Public | Shared admin/employee dashboard login |
| `POST` | `/auth/refresh` | Refresh cookie | Rotate session cookies |
| `POST` | `/auth/logout` | Public/stale session safe | Revoke session and clear cookies |
| `GET` | `/auth/me` | Authenticated | View own profile |
| `PATCH` | `/auth/profile` | Authenticated | Update own profile |
| `POST` | `/auth/change-password` | Authenticated | Change password after verifying old password |
| `POST` | `/auth/forgot-password` | Public | Send non-enumerating recovery response |
| `POST` | `/auth/reset-password` | Recovery session | Set password from recovery access/refresh tokens |

### Admin customer management

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/users` | Admin | Paginated customer list; supports `search` and `isActive` |
| `GET` | `/users/:id` | Admin | View customer |
| `PATCH` | `/users/:id` | Admin | Update, deactivate, or reactivate customer |

### Admin employee management

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/employees` | Admin | Create Supabase Auth employee and profile |
| `GET` | `/employees` | Admin | Paginated employee list; supports `search` and `isActive` |
| `GET` | `/employees/:id` | Admin | View employee |
| `PATCH` | `/employees/:id` | Admin | Update, deactivate, or reactivate employee |
| `DELETE` | `/employees/:id` | Admin | Permanently delete employee profile and Supabase Auth identity |

### Products

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/products` | Customer, employee, admin | Paginated list; supports `search`, `materialId`, and `variantId` |
| `GET` | `/products/:id` | Customer, employee, admin | View product with material, variant, and images |
| `POST` | `/products` | Employee, admin | Create product using active material and variant |
| `PATCH` | `/products/:id` | Employee, admin | Update product and validate changed references |
| `DELETE` | `/products/:id` | Employee, admin | Delete product and related product-image rows |

### Customer addresses

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/addresses` | Customer | List own addresses |
| `GET` | `/addresses/:id` | Customer owner | View own address |
| `POST` | `/addresses` | Customer | Create address |
| `PATCH` | `/addresses/:id` | Customer owner | Update address |
| `DELETE` | `/addresses/:id` | Customer owner | Delete unused address |

### Cart

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/cart` | Customer | Get/create own cart |
| `POST` | `/cart/items` | Customer | Add product by identifier; server calculates price |
| `PATCH` | `/cart/items/:itemId` | Customer owner | Set item quantity |
| `DELETE` | `/cart/items/:itemId` | Customer owner | Remove item |
| `DELETE` | `/cart` | Customer | Clear cart |

### Orders

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `POST` | `/orders/checkout` | Customer | Convert own cart into an order transactionally |
| `GET` | `/orders` | Authenticated | Customer sees own; admin/employee see all |
| `GET` | `/orders/:id` | Authenticated | Customer-owned or admin/employee order detail |
| `PATCH` | `/orders/:id/status` | Admin, employee | Apply a valid order-status transition |

### Wishlist

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/wishlist` | Customer | List own wishlist with product details |
| `POST` | `/wishlist` | Customer | Add an active product by `productIdentifier` |
| `DELETE` | `/wishlist/:id` | Customer owner | Remove own wishlist entry |

### Notifications

| Method | Endpoint | Access | Description |
| --- | --- | --- | --- |
| `GET` | `/notifications` | Authenticated | Customer private inbox or shared staff inbox; supports `read` and `type` |
| `GET` | `/notifications/unread-count` | Authenticated | Count unread notifications in the actor's inbox |
| `PATCH` | `/notifications/:id/read` | Authenticated viewer | Mark read and preserve the first reader in `readBy` |
| `PATCH` | `/notifications/read-all` | Authenticated viewer | Mark all visible unread notifications with the actor as reader |
| `DELETE` | `/notifications/:id` | Customer owner or admin | Delete private customer or shared staff notification |

Deactivation is used instead of hard deletion so audit relationships remain intact.

## Error Format

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed"
  },
  "requestId": "request-uuid"
}
```

## Environment Variables

Configure the single local `.env` file with the required database, Supabase, frontend, authentication-cookie, and staff login rate-limit settings. Never commit `.env` or real service-role credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `NODE_ENV` | No | `development`, `test`, or `production` |
| `PORT` | No | HTTP port; defaults to `5000` |
| `API_PREFIX` | No | Defaults to `/api/v1` |
| `FRONTEND_URL` | Yes | Exact trusted browser origin |
| `PASSWORD_RESET_REDIRECT_URL` | No | Recovery redirect; defaults to `<FRONTEND_URL>/reset-password` |
| `COOKIE_SAME_SITE` | No | `lax`, `strict`, or `none`; defaults to `lax` |
| `DATABASE_URL` | Yes | Supabase pooled PostgreSQL URL |
| `DIRECT_URL` | Yes | Supabase direct migration URL |
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon/publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only privileged key |

Add `PASSWORD_RESET_REDIRECT_URL` to Supabase Authentication redirect URLs. Supabase's default mail service is rate-limited; configure custom SMTP before production.

## Installation and Development

Requires Node.js 20 or newer.

```bash
npm install
npm exec prisma migrate deploy
npm run prisma:generate
npm run dev
```

## Verification

```bash
npm run verify
```

This validates Prisma, type-checks, lints, runs API/RBAC tests, and creates a clean production build.

## Supabase Demo Data

Run the idempotent seed whenever admin-dashboard test data is needed:

```bash
npm run seed:demo
```

It creates or refreshes two customers, two employees, two products, two orders, and two shared staff notifications in Supabase. Demo records can be found using the `@frameyaad.demo` email domain, product identifiers `FY-DEMO-001` and `FY-DEMO-002`, and order numbers `FY-1001` and `FY-1002`. Re-running the command does not intentionally create duplicate demo records.

## Postman Testing

Import [postman/FrameYaad-Phase1.postman_collection.json](postman/FrameYaad-Phase1.postman_collection.json). Postman's cookie jar automatically retains the HttpOnly cookies returned by login.

Recommended order:

1. Register the first admin once.
2. Register and test a customer.
3. Log in as admin and test customer management.
4. Create an employee and test admin employee management.
5. Log in as the employee and test own-profile/password operations.
6. Test an employee/customer request against `/users` and confirm HTTP `403`.
7. Test deactivated accounts and confirm login returns HTTP `403`.
8. As customer, create an address, add an active product to cart, and checkout.
9. Confirm customer order listing contains only that customer's orders.
10. Log in as admin/employee, list all orders, and advance the order through valid statuses.
11. Confirm customer status updates and employee/admin cart requests return HTTP `403`.
12. Log in as customer, add/list/remove a wishlist item, and confirm an employee receives HTTP `403`.
13. After customer registration and checkout, list private notifications as the customer and the shared feed as an admin/employee.
14. Mark a shared notification read as an employee and confirm `readBy` contains that employee; confirm employee deletion returns HTTP `403`.

The collection's **Security Checks** folder uses `127.0.0.1` instead of `localhost`, preventing Postman's `localhost` cookie from being sent. **Create Employee Without Any Session - Must Fail** must return HTTP `401`. You can also inspect or clear retained cookies using Postman's **Cookies** button.

For password recovery, copy the access and refresh tokens from the Supabase recovery redirect into the collection variables `recoveryAccessToken` and `recoveryRefreshToken`, then run **Reset Password from Recovery Session**.

## Project Structure

```text
prisma/               # Schema and migrations
postman/              # Importable API collection
src/
  config/             # Environment, logging, Supabase
  constants/
  middleware/         # Authentication, RBAC, validation, errors
  modules/
    auth/
    users/
    employees/
    health/
    addresses/
    cart/
    orders/
    wishlist/
    notifications/
    newsletter/
    appointment/
  services/
    appointment-email/
  prisma/
  routes/
  types/
  utils/
  app.ts
  server.ts
tests/                # API, validation, and RBAC tests
```

## Next Planned Module

Material management, followed by variants and product images. Coupons and payments remain excluded from the implemented checkout flow.

## Newsletter Module

Newsletter subscriptions are stored independently from users, so visitors can subscribe without creating or signing in to an account. Emails are trimmed, normalized to lowercase, and uniquely stored. Inactive records are reactivated when the same visitor subscribes again; records are retained when unsubscribed.

### Schema

- `NewsletterSubscriber` maps to `newsletter_subscribers`.
- Fields: UUID `id`, unique `email`, `isActive`, `subscribedAt`, nullable `unsubscribedAt`, `createdAt`, and `updatedAt`.
- An index on status and subscription date supports staff list queries.
- Migration: `prisma/migrations/20260819090000_newsletter_subscribers/migration.sql`.

Apply migrations during deployment with:

```bash
npm exec prisma migrate deploy
```

### APIs

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/newsletter/subscribe` | Public | Subscribe or reactivate a normalized email |
| `POST` | `/api/v1/newsletter/unsubscribe` | Public | Mark an email unsubscribed without deleting it |
| `GET` | `/api/v1/newsletter/subscribers` | Admin, Employee | Paginated list with `search` and `status` filters |
| `GET` | `/api/v1/newsletter/subscribers/export` | Admin, Employee | Download the filtered subscriber list as CSV |

Validation rejects empty or malformed emails, invalid pagination, and unsupported statuses. Duplicate active subscriptions return HTTP `409` with code `ALREADY_SUBSCRIBED`. Subscriber management reuses the existing authentication and staff-role middleware; customers receive HTTP `403`. Centralized error handling prevents Prisma and database details from reaching API consumers.

Focused API coverage is provided by `tests/newsletter-rbac.test.ts`, including normalization, duplicate handling, reactivation, unsubscribe behavior, request validation, Admin/Employee authorization, customer denial, pagination/filter forwarding, CSV headers, and safe unexpected-error responses.

## Appointment Booking Module

Appointment booking is isolated from users, orders, notifications, and other business modules. Visitors can submit a framing-service request without authentication; only authenticated `ADMIN` and `EMPLOYEE` users can view or manage appointments.

### Schema and migration

- New enums: `AppointmentLocation`, `AppointmentStatus`, and `AppointmentEmailStatus`.
- New `Appointment` model mapped to `appointments`, including immutable `originalBookingDate`, current `bookingDate`, location, frame requirements, lifecycle reasons, aggregate email delivery status, and timestamps.
- Indexed by status/date, location/date, creation date, and email.
- Migration: `prisma/migrations/20260820130000_appointments/migration.sql`.

### APIs

| Method | Endpoint | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/v1/appointments` | Public | Validate and create a pending appointment; send customer and admin emails |
| `GET` | `/api/v1/appointments` | Admin, Employee | Paginated newest-first list with search, status, location, and date filters |
| `GET` | `/api/v1/appointments/:id` | Admin, Employee | Read appointment details |
| `PATCH` | `/api/v1/appointments/:id/status` | Admin, Employee | Confirm, reschedule, cancel, or complete through enforced transitions |

The backend enforces Indian phone, email, future-date, location, frame-type, conditional `OTHERS`, reschedule-date, and lifecycle validation. `CANCELLED` and `COMPLETED` are terminal. Rescheduling never overwrites `originalBookingDate`. Reasons are trimmed and stripped of HTML tags. Email delivery uses the Resend HTTPS API and never blocks a successful database update; failures are logged and recorded as `FAILED` without leaking provider details.

Required deployment variables:

```env
RESEND_API_KEY=re_your_resend_key
EMAIL_FROM=FrameYaad <appointments@your-verified-domain.com>
ADMIN_EMAIL=appointments@frameyaad.com
```

Customer templates cover request received, confirmed, rescheduled, and cancelled. The admin receives a new-request email requiring action. Completion is intentionally admin-only with no email. Focused coverage lives in `tests/appointment-rbac.test.ts` and `tests/appointment.service.test.ts`.

## Staff global search

GET /api/v1/admin/search?q=... requires authenticated ADMIN or EMPLOYEE access. It accepts a trimmed 1–120-character query and returns at most five order and five customer suggestions, full per-group counts, normalized query, and a routing kind. FY- followed by digits identifies an order search; bare digits take order precedence only when matching an actual order number. Otherwise phone-like input is normalized and classified at 7–15 digits. Names/emails search both orders and CUSTOMER accounts case-insensitively. All queries are parameterized, LIKE wildcards are escaped, and no raw regular expression is created from input.

The customer list reuses the normalized phone/name/email builder, so a global-search URL and its target list agree even when stored phones contain spaces/dashes/country codes. Existing customer detail/list routes and order APIs keep their contracts. Search is read-only and uses existing search indexes; no database/schema changes were needed. Authorization tests cover both staff roles, guests, customers and spoofed role parameters. Live read-only checks verified exact/partial/numeric order IDs, normalized phones, grouped name/email matches, no results, and the five-result cap.

## Shared frame colours and order snapshots

The persistent frame_colors catalogue is exposed read-only via GET /colors. POST /colors requires server-verified ADMIN or EMPLOYEE authentication; CUSTOMER and unauthenticated callers get 403/401. Strict schemas accept only trimmed 2–30-character alphanumeric/space names and six-digit hexes. Case-normalized unique names and canonical uppercase unique hexes prevent races/duplicates, with legacy aliases reserved to avoid changing old colour interpretation. The table has RLS enabled and direct anon/authenticated mutation privileges revoked; the backend owns writes. Only Black #000000 and White #FFFFFF were seeded. Existing Material.availableColors data is untouched.

Cart APIs accept optional variantId/color, verify product membership and availability, retain server-resolved name/hex, and distinguish cart lines through a selection-aware unique key. Checkout derives price using the existing selected-variant price/subtotal formula and saves product ID/name, selected variant ID/size, colour name/hex, and material snapshots on OrderItem. Order responses and export prefer snapshots even if the live catalogue changes/disappears. Historical rows are not backfilled; safe read-only catalogue fallback and '-' are used instead. No current cart is guessed as historical evidence after checkout.

Applied the reviewable prisma/compatibility/color-order-snapshots.sql additions: frame_colors, nullable snapshot/selection columns, and replacement of the old product-only cart uniqueness index with selection-aware uniqueness. No Prisma migration was generated/run, and no existing order or product-colour rows were rewritten. Prisma client was regenerated after the running Windows backend was stopped. Other databases need this script before deployment.

Tests cover Admin/Employee creation, customer/guest rejection, invalid/duplicate input, snapshot precedence and deletion fallback, selected size/colour capture, unchanged subtotal calculation and distinct cart selections. Checkout UI remains unchanged by user request. There is no existing confirmation/itemized-email/invoice flow to modify; order-placed notifications remain unchanged.

## Orders Management filters and export

Root cause: dateFilter was stripped by the list-query schema; search handled only orderNumber; the UI export read the current page. orders.filters.ts now builds one Prisma filter for list and staff-only GET /orders/export. Range starts are local midnight N calendar days before today, using ORDER_TIME_ZONE, then TZ, then Asia/Kolkata. Today starts at today's local midnight; All Time adds no date constraint. Date, search, status, and customer ownership restrictions combine.

Search is trimmed/case-insensitive for full/partial order number, customer name, and email. Numeric/phone-like searches remove punctuation and an Indian country prefix; parameterized SQL matches normalized stored user/address phones without updating them. LIKE wildcards are escaped for textual search. Summary queries retain date/search while preserving existing status-independent buckets (Pending = Placed; Processing = Confirmed + Processing + Ready to Ship). Export uses the same full filter, reads all matches in 500-row batches, and calculates count/revenue/average only from those matches.

Verified existing primary/unique order-number/phone and date/status-date indexes. Applied six additive indexes: Order_userAddressId_idx (join), Order_orderNumber_trgm_idx, users_name_trgm_idx, users_email_trgm_idx (partial insensitive lookup), users_normalized_phone_trgm_idx and user_address_normalized_phone_trgm_idx (normalized partial phone lookup). pg_trgm already existed. The reviewable SQL is prisma/compatibility/order-search-indexes.sql; concurrent statements require a direct SQL session. Prisma rejected concurrent builds, so the approved application used separate short transactions with 2-second lock and 15-second statement timeouts. No migrations or row changes were made.

Regression coverage includes local/DST boundaries, 7/30/90/all-time, wildcard/script-like input as data, partial order/phone searches, combined filters, ownership, admin/employee export authorization, empty results, and exporting 501 records across batches. Live checks confirmed 4 all-time orders, no recent-range matches, matching table/export counts, and one match for each requested order/phone search example.

## Admin product required-field validation

Admin product creation now requires a nonblank, trimmed description, matching the Basic Info form. Product updates reject a blank description when supplied, while partial updates can still omit it. Existing name, brand, material, color, variant, price/stock, and image validation is retained. Added missing/null/empty/whitespace description tests and updated valid test fixtures. No database schema or stored data changed.

## 404 handling

Unknown API routes return generic JSON 404 without reflecting the URL. Malformed encoded paths and invalid scalar UUID path parameters return 404; body/query validation remains 400. Existing error handling hides internal stack traces and keeps server errors distinct. No schema, data, or authentication behavior changed.

`npm run verify` passes: 26 test files, 251 tests, and TypeScript build. New tests cover unknown routes, malformed/undefined IDs, encoded script-like paths, long paths, and a nonexistent product UUID.

## Notifications and complete exports - 9 November 2026

The notification page previously waited for the write, then refetched both its list and the bell list. Mark-all also refetched its list. Read actions now update the shared page/bell/popup state immediately, decrement the server-backed unread count, and show one deduplicated "Marked as read" toast. Failures roll back affected records/counts and offer Retry. Polling/out-of-order responses cannot undo newer reads. Reader names appear optimistically and reconcile with the backend first-reader identity.

Single read and mark-all each use one conditional updateMany, not a per-item loop, and return unreadCount (plus notification or updatedCount). The post-write lookup/count run independently. Customer writes use authenticated userId. As clarified, staff retain the shared userId=null inbox, showing the first ADMIN/EMPLOYEE reader's name. No per-user receipt schema was added. The live database already has notifications_userId_date_idx and notifications_userId_read_date_idx; no duplicate indexes or schema changes were needed.

Exports retain existing formats/buttons: product/customer CSV and orders table PDF. Staff-only GET /products/export and /users/export reuse the list filter builders, stream all matches in 250-record batches, and handle backpressure/disconnects. Customer order totals use one aggregate per batch. Orders reuse buildOrderWhere with 500-record batches and batched coupon-code lookup. Loading/success/error toasts are deduplicated; no matches produces an amber warning and no download.

- Product CSV: one row per variant (one blank-variant row if none), with product ID/name/brand/description/status/material/category/created date/base price/active price discount/stock total; variant ID/size/color name/hex/original price/selling price/stock/status. Missing category is "-"; variant ID is used where no separate SKU exists.
- Customer CSV: ID/name/email/phone/default and all saved addresses/registered date/status/order count/amount spent/last order date/wishlist count. Explicit selects exclude passwords/tokens/OTPs/authentication internals.
- Order PDF: all matching orders, contact/address/payment/coupon/subtotal/discount/total and snapshot item product ID/name/size/color/material/quantity/unit price/line total. Missing payment fields are "-" because this schema has no payment data. Stored prices/totals/statuses are unchanged.
- CSV formula prefixes (=,+,-,@), including leading whitespace/control characters, are neutralized. Exports require ADMIN or EMPLOYEE server-side.
- jsPDF + jspdf-autotable retain repeated headers, row-safe page breaks, wrapped cells, INR amounts, DD/MM/YYYY dates, totals and page numbers. A 501-order sample produced 75 pages; first/final pages were visually checked.

### Notification timing measurements

Three rollback-only database-operation samples, milliseconds; no existing notifications changed. These exclude HTTP/authentication. Interactive transactions serialize parallel queries.

| Operation | Before (ms) | After (ms) |
| --- | --- | --- |
| Single-read DB work | 1328.39 / 264.66 / 269.91 | 534.55 / 265.40 / 233.86 (includes unread count) |
| Click completion including both refetches | 2326.26 / 582.48 / 591.34 | Synchronous optimistic UI; no refetch |
| Batched mark-all plus count, fixture-only predicate | Not measured | 137.35 / 158.56 / 162.37 |

Reproduce in backend: npx tsx scripts/benchmark-notification-reads.ts. Its fixture always rolls back. Warm single-read DB timings remain above the ~200ms target; authenticated production endpoint timing is still needed. The original multi-minute server delay was not reproduced, so no infrastructure/root-cause claim is made. Connection/retry settings were not changed.

Tests cover rollback/retry, duplicates, polling races, reader names, concurrent counts, export authorization, variant/no-variant products, safe fields, CSV injection, 0/501 records and PDF pagination. Browser interaction checks against the running application remain manual.

