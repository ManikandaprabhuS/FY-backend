import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Test database only; use --apply.");
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.customer_notifications (id text PRIMARY KEY, "userId" text NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, type varchar(40) NOT NULL, title varchar(120) NOT NULL, message varchar(500) NOT NULL, "orderId" text NOT NULL, "isRead" boolean NOT NULL DEFAULT false, "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "customer_notifications_userId_isRead_createdAt_idx" ON public.customer_notifications ("userId","isRead","createdAt" DESC)');
  await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "customer_notifications_userId_createdAt_idx" ON public.customer_notifications ("userId","createdAt" DESC)');
  await tx.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "customer_notifications_createdAt_idx" ON public.customer_notifications ("createdAt")');
 },{timeout:30000});
 console.info("Customer notifications table/indexes ready. Existing data unchanged.");
}
void main().catch(()=>{console.error("Customer notification setup failed");process.exitCode=1;}).finally(()=>prisma.$disconnect());
