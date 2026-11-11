# Private customer order photos

## Setup
Run npm run prisma:generate, then npx tsx prisma/setup-order-photos.ts --apply against the intended Supabase project. Setup is idempotent/additive: it creates/updates the private customer-photos bucket, adds order_photos and nullable Order photo snapshots, and never rewrites old orders. This was applied and smoke-tested on the configured project. No migrations were run.

Backend variable names are in .env.example: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_PHOTO_BUCKET. The bucket defaults to customer-photos when unset. Never expose the service key in frontend environment variables.

The bucket is private, with a 4,194,304-byte limit and only image/jpeg, image/png, image/webp. A restrictive bucket-scoped policy prevents anon/authenticated direct access even when other existing Storage policies are permissive. order_photos has RLS and no client grants/policies.

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
