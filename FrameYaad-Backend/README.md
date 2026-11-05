# FrameYaad Backend

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
