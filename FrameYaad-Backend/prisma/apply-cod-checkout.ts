import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply on the reviewed test database.");
 await prisma.$transaction(async tx=>{
  const before=await tx.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count,sum("totalAmount")::text AS total FROM public."Order"');
  await tx.$executeRawUnsafe('ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "paymentMethod" varchar(20), ADD COLUMN IF NOT EXISTS "checkoutKey" varchar(36), ADD COLUMN IF NOT EXISTS "checkoutHash" varchar(64)');
  await tx.$executeRawUnsafe('CREATE UNIQUE INDEX IF NOT EXISTS "Order_userId_checkoutKey_key" ON public."Order" ("userId","checkoutKey")');
  await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "Order_userId_checkoutHash_createdAt_idx" ON public."Order" ("userId","checkoutHash","createdAt")');
  const after=await tx.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count,sum("totalAmount")::text AS total FROM public."Order"');
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Order invariant failed");
 },{timeout:30000});
 console.info("COD fields and retry indexes ready; existing orders unchanged.");
}
void main().catch(()=>{console.error("COD setup failed; inspect configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
