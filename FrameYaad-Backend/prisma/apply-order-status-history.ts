import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply on the reviewed test database.");
 const before=await prisma.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count,sum("totalAmount")::text AS total FROM public."Order"');
 await prisma.$executeRawUnsafe('ALTER TABLE public."Order" ADD COLUMN IF NOT EXISTS "statusHistory" jsonb');
 const after=await prisma.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count,sum("totalAmount")::text AS total FROM public."Order"');
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Order invariant failed");
 console.info(JSON.stringify({nullableHistoryAdded:true,existingOrdersUnchanged:true}));
}
void main().catch(()=>{console.error("Status history setup failed; check configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
