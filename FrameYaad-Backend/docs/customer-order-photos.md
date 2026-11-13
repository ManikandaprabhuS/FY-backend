# Private customer order photos

## Setup
Run npm run prisma:generate, then npx tsx prisma/setup-order-photos.ts --apply against the intended Supabase project. Setup is idempotent/additive: it creates/updates the private customer-photos bucket, adds order_photos and nullable Order photo snapshots, and never rewrites old orders. This was applied and smoke-tested on the configured project. No migrations were run.

Backend variable names are in .env.example: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PHOTO_BUCKET. The bucket defaults to customer-photos when unset. Never expose the service key in frontend environment variables.

The bucket is private, with a 10,485,760-byte physical cap (effective limits are per variant, default 4 MB) and only image/jpeg, image/png, image/webp. A restrictive bucket-scoped policy prevents anon/authenticated direct access even when other existing Storage policies are permissive. order_photos has RLS and no client grants/policies.

## Upload and checkout
Product upload/crop stays browser-local. Guests see "Please log in to upload your photo." Buy Now carries the selected File to the existing checkout; saved local preview data can also be restored after a product-page reload. Files are sent to Storage only at checkout.

The optional checkout card has progress, replacement, Clear and Retry. It restores server TEMP metadata on return. A failed upload may be retried or skipped; Place Order is disabled while an upload/check/clear is pending.

Endpoints (under /api/v1):
- POST /order-photos: verified customer only, multipart field photo, returns imageId/fileName/sizeBytes only.
- GET /order-photos/temp: restore the owned TEMP metadata.
- DELETE /order-photos/:imageId: owner-only, TEMP-only.
- GET /orders/:orderId/photo/download-url: owner or verified ADMIN/EMPLOYEE, fresh signed URL, 60-second expiry, forced readable download name, no-store.

Checkout optionally accepts photoId. The existing serializable COD transaction locks the photo owner, validates an owned TEMP photo and saves Order snapshots plus the ATTACHED association. If the order transaction fails, its TEMP image remains available. No-photo retry hashes are preserved.

After commit, attachment copies to the order folder, persists that destination, and removes the TEMP object. A Storage failure never fails the saved order. An ATTACHED record retaining a TEMP path is the durable retry marker; the worker retries it. Customer/staff details and confirmation render download text only, never a photo. PDF and CSV exports include Photo uploaded Yes/No and the filename.

## Naming and privacy
Logical paths:
- customer-photos/{userId}/temp/FY-{CustomerName}-{ImageName}.{ext}
- customer-photos/{userId}/{orderId}/FY-{CustomerName}-{ImageName}.{ext}

Object keys omit the bucket prefix. Photo IDs remain internal UUIDs. The shared helper trims, hyphenates spaces, removes unsafe/non-ASCII characters, separators, dots and control characters, collapses hyphens, and applies 30/50-character limits with Customer/photo fallbacks. No transliteration library exists, so non-Latin characters are removed. Extensions come from verified bytes. Collisions get suffixes; writes never upsert. Names are upload-time snapshots, unaffected by later profile edits.

No decoder/metadata library was present and no heavy dependency was added. Validation checks signatures and file structure, not a full pixel decode. EXIF is retained. This is not malware scanning; uploaded files must never be executed. Full decoder validation and metadata stripping remain hardening considerations.

## Recovery and retention
An advisory lock and partial unique index enforce one TEMP record per customer; unique orderId enforces one photo per order. Failed upload DB writes compensate by removing the new object and retaining the previous record. The orphan sweep recovers interrupted compensating deletions.

Clear commits DB removal before removing its object, so a failed DB commit cannot leave a valid row pointing at a deleted file. If object deletion is interrupted, the unreferenced private object is swept later.

The worker checks TEMP rows older than 24 hours hourly in bounded batches, scans unreferenced TEMP objects, and retries attached moves every minute. Logs contain counts/event codes only. A sleeping host needs an external scheduler or a continuously running backend; backlogs may need several bounded passes.

Cancelled-order photos are retained. No customer/order deletion endpoint currently exists. Foreign-key RESTRICT prevents direct deletion from silently orphaning photos. A future deletion feature must explicitly clean Storage before removing rows. The existing employee deletion route only deletes employees, who cannot upload.

## Verification
- Backend photo suite: 38 passed; full backend suite: 520 passed.
- Frontend photo tests: 5 passed; full frontend suite: 211 passed.
- Prisma validation/generation, backend types, frontend build and focused lint were run.
- Live disposable fixture: upload, same-name replacement, one TEMP row, private bucket/size limits, signed forced download, Clear and fixture cleanup passed. Existing order count/totals were unchanged.
- Browser fixture at 320/390/768/1280px: no horizontal overflow or console warnings/errors.
- Tests cover unsupported/empty/oversize files, exact 4 MB boundary, traversal-like/Tamil/long/empty names, guest/staff denial, ownership, replacement compensation, attachment retry and downloads.

Manual acceptance remains: real customer Buy Now -> COD with/without a photo; staff/customer downloads on a phone; throttled/lost network walkthrough; a real near-4 MB phone-camera JPEG; expired signed-link check after 60 seconds. No production order was created solely for testing.

## Per-variant customer photo limits — audit and update
### Audit (before this change)
| Location | Previous rule | Current rule |
| --- | --- | --- |
| backend src/modules/order-photos/photo-file.ts | PHOTO_MAX_BYTES = 4 x 1024 x 1024; fixed 4 MB error | Absolute transport/type-validation cap derived from MAX_PHOTO_MAX_MB (10) |
| backend order-photos.routes.ts | Multer cap 4 MB + one byte; fixed 4 MB error | Global cap + one byte; authenticated cart context then enforces the stricter DB limit |
| backend order-photos.service.ts | No variant-dependent check at upload or final reservation | getPhotoMaxBytes at upload and before order creation; final maxAllowedMB snapshot |
| frontend services/order-photos.service.ts | Fixed 4 MB validation | Shared helper, default 4 or selected/cart variant limits |
| product Upload Your Photo | Fixed “up to 4 MB” hint/check | Live “Max file size: X MB” for the selected variant |
| checkout Upload your photo card | Fixed “up to 4 MB” hint/check | Lowest limit across final cart variants; shows the unique limiting item when applicable |
| Supabase customer-photos | Private, 4,194,304-byte bucket cap | Still private, 10,485,760-byte physical cap; same three MIME types |
| order_photos sizeBytes CHECK | Positive and at most 4,194,304 bytes | Positive and at most the global 10 MB cap; necessary to store permitted larger photos |

### Configuration and admin
DEFAULT_PHOTO_MAX_MB = 4, MIN_PHOTO_MAX_MB = 1, MAX_PHOTO_MAX_MB = 10 live in utils/photo-limits.ts. These independently deployed repositories carry byte-identical copies of this small shared contract; the backend is authoritative and frontend values cannot bypass it. SHA-256 parity was checked during validation. Keep both contract copies in sync when changing defaults/ranges.

Variant.maxPhotoSizeMB is nullable. Null/omitted/empty means default, not zero. Values must be numbers from 1 through 10 with at most one decimal. Add/Edit Product's existing per-variant modal now includes the optional input and helper text; variant rows/details show the effective limit. Existing required-step/Next rules remain intact. Admin/Employee role checks are unchanged, and customer updates are rejected. The API whitelist, product response types and variant CSV export include the new field.

getPhotoMaxBytes([variant]) uses that variant or the default. For several items it chooses the lowest effective limit; an empty list uses the default. Byte limits are floored to whole bytes; a file exactly at the byte limit passes. Validation messages show the file's size and allowed MB.

### Server-resolved cart context
The storefront cart is browser-local; existing checkout already resolves submitted item selections on the backend. Photo uploads therefore optionally include an items JSON field containing product/variant IDs and quantities only, never limit values. The backend reads the authenticated server cart and verifies each provided selection against current product/variant DB relations. When local selection IDs are supplied, independent lookups run in parallel. Without context, the owned server cart is used. Empty carts use the default for temporary upload; existing empty-order rejection is unchanged.

Checkout summaries return the current authoritative photo limit and limiting item. Product changes keep the local preview but warn and disable Add to Cart/Buy Now when the selected file is too large. Checkout rechecks on cart changes and immediately before placement. Oversized uploads return 413. Final order validation uses freshly loaded final variant IDs within the existing order transaction and rejects PHOTO_LIMIT_CHANGED (400, allowed MB included) before creating the order. Clear/replacement allows retry. An asynchronous Storage move failure still never fails a saved order.

OrderPhoto.maxAllowedMB is nullable for historical records and snapshots the applied limit for new uploads/final attachments. Existing attached photos/orders are not backfilled or recalculated.

### Deployment and storage
Stop the backend if Prisma is Windows-locked, run npm run prisma:generate, then npx tsx prisma/setup-variant-photo-limits.ts --apply. The script only adds the two nullable fields, validates the new variant range, raises the existing photo byte CHECK, and updates customer-photos to the global cap. It does not rewrite existing variant/photo/order values. No Prisma migrations were generated. The idempotent original photo setup script also reads the global cap now.

The bucket remains private. JPG/PNG/WebP, magic-byte validation, non-empty file checks, ownership, rate limits, one TEMP photo, one photo per order, optional upload, signed downloads, cleanup and failed-move retries remain unchanged. Admin product-media/banner uploads are separate and were not changed.

### Verification
- New backend tests cover defaults/range/empty input, 1.9 MB, exact 2 MB, one byte above, mixed 2/5 MB variants, forged context rejection, customer update denial, and a 3 MB TEMP upload becoming invalid after adding a 2 MB variant. Clearing/replacing then passes.
- Six new frontend tests pass; 18 focused affected upload/checkout/form tests pass.
- Live range/null/check-constraint tests ran in a rolled-back fixture; the private 10 MB bucket cap was verified. Existing variants and order totals/counts were unchanged.
- Shared helper sources are byte-identical. Builds/types and backend lint pass. Changed frontend limit components pass focused lint; ProductDetailsPage retains two pre-existing synchronous-effect lint findings outside this change.
- Mobile/admin/checkout fixture checked at 320/375/768/1440px: no overflow or console errors/warnings, optional 1–10 MB input, default text and limiting-item note readable.
- Full frontend suite: 225/230 pass; the same five unrelated header/collection/review failures remain untouched. No real customer order was created just for testing; a full real-device customer checkout walkthrough remains a final user acceptance check.
