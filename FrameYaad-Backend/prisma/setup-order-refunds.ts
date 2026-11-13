import {prisma} from "../src/prisma/client";
async function main(){
 if(!process.argv.includes("--apply"))throw new Error("Run with --apply after review.");
 const before=await prisma.$queryRawUnsafe('SELECT count(*)::text AS count,coalesce(sum("totalAmount"),0)::text AS total FROM public."Order"');
 await prisma.$executeRawUnsafe('ALTER TYPE public.notification_type ADD VALUE IF NOT EXISTS \'ORDER_CANCELLED\'');
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "cancelledBy" varchar(10), ADD COLUMN IF NOT EXISTS "cancelledAt" timestamp(3), ADD COLUMN IF NOT EXISTS "cancellationReason" varchar(500), ADD COLUMN IF NOT EXISTS "refundStatus" varchar(10), ADD COLUMN IF NOT EXISTS "refundInitiatedAt" timestamp(3), ADD COLUMN IF NOT EXISTS "refundCompletedAt" timestamp(3), ADD COLUMN IF NOT EXISTS "refundUpdatedBy" text, ADD COLUMN IF NOT EXISTS "refundHistory" jsonb');
  await tx.$executeRawUnsafe('DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname=\'order_refund_status_valid\' AND conrelid=\'public."Order"\'::regclass) THEN ALTER TABLE public."Order" ADD CONSTRAINT order_refund_status_valid CHECK ("refundStatus" IS NULL OR ("orderStatus"=\'CANCELLED\' AND "refundStatus" IN (\'INITIATED\',\'COMPLETED\'))); END IF; END $$');
 });
 const after=await prisma.$queryRawUnsafe('SELECT count(*)::text AS count,coalesce(sum("totalAmount"),0)::text AS total FROM public."Order"');
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Order invariant changed");
 console.info("Nullable cancellation/refund fields ready. Existing order count and amounts unchanged.");
}
void main().catch(()=>{console.error("Refund setup failed; no credentials logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
