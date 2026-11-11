import { prisma } from "../src/prisma/client";
import { supabaseAdmin } from "../src/config/supabase";
import { env } from "../src/config/env";
import { PHOTO_MAX_BYTES, PHOTO_MIMES } from "../src/modules/order-photos/photo-file";
let stage = "bucket";
async function main() {
  if (!process.argv.includes("--apply")) throw new Error("Review setup and run with --apply.");
  const options = { public: false, fileSizeLimit: PHOTO_MAX_BYTES, allowedMimeTypes: [...PHOTO_MIMES] };
  const found = await supabaseAdmin.storage.getBucket(env.SUPABASE_PHOTO_BUCKET);
  if (found.data) {
    const updated = await supabaseAdmin.storage.updateBucket(env.SUPABASE_PHOTO_BUCKET, options);
    if (updated.error) throw new Error("Private photo bucket setup failed");
  } else {
    const created = await supabaseAdmin.storage.createBucket(env.SUPABASE_PHOTO_BUCKET, options);
    if (created.error) throw new Error("Private photo bucket setup failed");
  }
  stage = "database";
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.order_photos ("id" text PRIMARY KEY, "userId" text NOT NULL REFERENCES public.users("id") ON DELETE RESTRICT, "orderId" text UNIQUE REFERENCES public."Order"("id") ON DELETE RESTRICT, "storagePath" text NOT NULL, "fileName" varchar(110) NOT NULL, "mimeType" varchar(20) NOT NULL CHECK ("mimeType" IN (\'image/jpeg\',\'image/png\',\'image/webp\')), "sizeBytes" integer NOT NULL CHECK ("sizeBytes">0 AND "sizeBytes"<=4194304), "status" varchar(10) NOT NULL DEFAULT \'TEMP\' CHECK ("status" IN (\'TEMP\',\'ATTACHED\')), "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "attachedAt" timestamp(3), CHECK (("status"=\'TEMP\' AND "orderId" IS NULL AND "attachedAt" IS NULL) OR ("status"=\'ATTACHED\' AND "orderId" IS NOT NULL AND "attachedAt" IS NOT NULL)))');
    await tx.$executeRawUnsafe('ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "photoId" text UNIQUE, ADD COLUMN IF NOT EXISTS "photoFileName" varchar(110), ADD COLUMN IF NOT EXISTS "photoSizeBytes" integer');
    await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "order_photos_userId_idx" ON public.order_photos ("userId")');
    await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "order_photos_status_createdAt_idx" ON public.order_photos ("status","createdAt")');
    await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "order_photos_one_temp_per_user" ON public.order_photos ("userId") WHERE "status"=\'TEMP\'');
    await tx.$executeRawUnsafe('ALTER TABLE public.order_photos ENABLE ROW LEVEL SECURITY');
    // No direct client policies: only the backend service role may access this private table/bucket.
    await tx.$executeRawUnsafe('REVOKE ALL ON public.order_photos FROM anon, authenticated');
  }, { timeout: 20000 });
  // Restrictive policy only affects this bucket, even if another existing policy is permissive.
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("DROP POLICY IF EXISTS customer_photos_backend_only ON storage.objects");
    await tx.$executeRawUnsafe("CREATE POLICY customer_photos_backend_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> 'customer-photos') WITH CHECK (bucket_id <> 'customer-photos')");
  });
  console.info("Private customer photo bucket and additive tables are ready. Existing orders were not modified.");
}
void main().catch(() => { console.error("Photo setup failed at "+stage+" stage. Check server configuration; credentials and paths are not logged."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
