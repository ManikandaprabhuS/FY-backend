import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { prisma } from "../src/prisma/client";
import { env } from "../src/config/env";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply on the reviewed test database only.");
 const directory=resolve(process.env.COUPON_BACKUP_DIR??"D:/FrameYaad/backups/coupons-2026-11-10");
 mkdirSync(directory,{recursive:true});
 const archive=await prisma.$transaction(async tx=>{
   const coupons=await tx.$queryRawUnsafe<unknown[]>('SELECT * FROM public.coupon');
   const assignments=await tx.$queryRawUnsafe<unknown[]>('SELECT * FROM public.product_discount');
   const orders=await tx.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count, sum("totalAmount")::text AS total FROM public."Order"');
   return {coupons,assignments,orders};
 });
 const file=resolve(directory,"legacy-coupon-data-"+Date.now()+".json");
 writeFileSync(file,JSON.stringify(archive,(_,v:unknown)=>typeof v==="bigint"?String(v):v,2),{flag:"wx"});
 const sql=readFileSync(resolve("prisma/compatibility/two-offers.sql"),"utf8");
 await prisma.$transaction(async tx=>{
   for(const statement of sql.split(";").map(s=>s.trim()).filter(Boolean))await tx.$executeRawUnsafe(statement);
   await tx.$executeRawUnsafe('DELETE FROM public.product_discount');
   await tx.$executeRawUnsafe('UPDATE public.coupon SET "isActive"=false');
   const after=await tx.$queryRawUnsafe<unknown[]>('SELECT count(*)::text AS count, sum("totalAmount")::text AS total FROM public."Order"');
   if(JSON.stringify(after)!==JSON.stringify(archive.orders))throw new Error("Historical order invariant failed");
 },{timeout:30000});
 console.info(JSON.stringify({backup:file,legacyCoupons:archive.coupons.length,removedAssignments:archive.assignments.length,oldOrdersUnchanged:true}));
}
void main().catch(()=>{console.error("Offer update failed; inspect database configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
