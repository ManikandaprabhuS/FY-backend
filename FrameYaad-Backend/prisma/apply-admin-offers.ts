import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {seedOffers} from "../src/modules/offers/offers.seed";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply on the reviewed test database.");
 const before=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 const sql=readFileSync(resolve("prisma/compatibility/admin-offers.sql"),"utf8");
 await prisma.$transaction(async tx=>{
  for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
  await seedOffers(tx);
 },{timeout:15000});
 const after=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Historical order invariant failed");
 console.info(JSON.stringify({offers:await prisma.offer.count(),historicalOrdersUnchanged:true}));
}
void main().catch(()=>{console.error("Admin offers setup failed. Check configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
