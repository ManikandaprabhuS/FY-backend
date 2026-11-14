import {prisma} from "../src/prisma/client";
import {listCleanup} from "../src/modules/photo-cleanup/photo-cleanup.service";
import {storageMetrics} from "../src/modules/photo-cleanup/storage-metrics";
async function main(){
 const snapshot=()=>prisma.$queryRawUnsafe('SELECT count(*)::text AS rows,coalesce(sum("sizeBytes"),0)::text AS bytes FROM public.order_photos');
 const before=await snapshot();
 const [list,usage,permissions]=await Promise.all([
  listCleanup({limit:1},{id:"read-only-check",name:"Read-only check",role:"ADMIN"}),
  storageMetrics(true),
  prisma.$queryRawUnsafe<Array<{anon:boolean;authenticated:boolean}>>("SELECT has_function_privilege('anon','public.frameyaad_database_size()','EXECUTE') AS anon,has_function_privilege('authenticated','public.frameyaad_database_size()','EXECUTE') AS authenticated")
 ]);
 if(permissions[0]?.anon||permissions[0]?.authenticated)throw new Error("Database size function must not be public");
 if(usage.database.bytes===null)throw new Error("Database size could not be read");
 if(list.photos.some(p=>p.orderStatus!=="DELIVERED"&&p.orderStatus!=="CANCELLED"))throw new Error("Unexpected photo eligibility");
 const dates=await prisma.$queryRawUnsafe<Array<{date:Date|null}>>("SELECT public.frameyaad_photo_completed_at($1::jsonb,$2::text,NULL::timestamp) AS date",JSON.stringify([{status:"DELIVERED",changedAt:"not-a-date"}]),"DELIVERED");
 if(dates[0]?.date!==null)throw new Error("Invalid history must not invent a completion date");
 if(JSON.stringify(before)!==JSON.stringify(await snapshot()))throw new Error("Photo invariant changed");
 console.info("Read-only cleanup query, size metrics and function permissions verified. No photo records or files changed.");
}
void main().catch(()=>{console.error("Read-only photo cleanup check failed; no private data logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
