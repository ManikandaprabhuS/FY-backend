import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {seedOffers} from "../src/modules/offers/offers.seed";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply only on the reviewed dev database.");
 const before=await prisma.offer.findMany({orderBy:{code:"asc"}}),orders=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 const sql=readFileSync(resolve("prisma/compatibility/seasonal-offers.sql"),"utf8");
 await prisma.$transaction(async tx=>{for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);await seedOffers(tx);},{timeout:15000});
 const unchanged=await prisma.offer.findMany({where:{code:{in:before.map(o=>o.code)}},orderBy:{code:"asc"}});
 if(JSON.stringify(unchanged)!==JSON.stringify(before)||JSON.stringify(await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}}))!==JSON.stringify(orders))throw new Error("Existing settings/order invariant failed");
 console.info(JSON.stringify({offers:await prisma.offer.count(),existingSettingsAndOrdersUnchanged:true}));
}
void main().catch(()=>{console.error("Seasonal offer setup failed; check the reviewed configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
