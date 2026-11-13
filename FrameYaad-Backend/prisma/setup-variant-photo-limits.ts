import {prisma} from "../src/prisma/client";
import {supabaseAdmin} from "../src/config/supabase";
import {env} from "../src/config/env";
import {MAX_PHOTO_MAX_MB,MIN_PHOTO_MAX_MB,PHOTO_MB_BYTES} from "../src/utils/photo-limits";
import {PHOTO_MIMES} from "../src/modules/order-photos/photo-file";
async function main(){
 if(!process.argv.includes("--apply"))throw new Error("Review setup and run with --apply.");
 const before=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE public."ProductVariant" ADD COLUMN IF NOT EXISTS "maxPhotoSizeMB" double precision');
  await tx.$executeRawUnsafe('ALTER TABLE public.order_photos ADD COLUMN IF NOT EXISTS "maxAllowedMB" double precision');
  const constraints=await tx.$queryRawUnsafe<Array<{conname:string}>>("SELECT conname FROM pg_constraint WHERE conrelid='public.order_photos'::regclass AND contype='c' AND pg_get_constraintdef(oid) LIKE '%sizeBytes%'");
  for(const row of constraints)await tx.$executeRawUnsafe('ALTER TABLE public.order_photos DROP CONSTRAINT "'+row.conname.replaceAll('"','""')+'"');
  await tx.$executeRawUnsafe('ALTER TABLE public.order_photos ADD CONSTRAINT order_photos_size_cap CHECK ("sizeBytes">0 AND "sizeBytes"<='+MAX_PHOTO_MAX_MB*PHOTO_MB_BYTES+')');
  await tx.$executeRawUnsafe('ALTER TABLE public."ProductVariant" DROP CONSTRAINT IF EXISTS variant_photo_size_range');
  await tx.$executeRawUnsafe('ALTER TABLE public."ProductVariant" ADD CONSTRAINT variant_photo_size_range CHECK ("maxPhotoSizeMB" IS NULL OR ("maxPhotoSizeMB">='+MIN_PHOTO_MAX_MB+' AND "maxPhotoSizeMB"<='+MAX_PHOTO_MAX_MB+' AND abs("maxPhotoSizeMB"*10-round(("maxPhotoSizeMB"*10)::numeric)::double precision)<0.00000001))');
 },{timeout:15000});
 const updated=await supabaseAdmin.storage.updateBucket(env.SUPABASE_PHOTO_BUCKET,{public:false,fileSizeLimit:MAX_PHOTO_MAX_MB*PHOTO_MB_BYTES,allowedMimeTypes:[...PHOTO_MIMES]});
 if(updated.error)throw new Error("Private bucket update failed");
 const after=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Historical order invariant failed");
 console.info("Nullable variant/photo limits ready; private bucket cap is 10 MB. Existing variants, photos and orders were not rewritten.");
}
void main().catch(()=>{console.error("Variant photo-limit setup failed; no credentials logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
