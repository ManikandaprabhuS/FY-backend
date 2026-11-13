import {randomUUID} from "node:crypto";
import {prisma} from "../src/prisma/client";
import {supabaseAdmin} from "../src/config/supabase";
import {env} from "../src/config/env";
import {getPhotoMaxBytes,MAX_PHOTO_MAX_MB,PHOTO_MB_BYTES} from "../src/utils/photo-limits";
async function main(){
 if(!process.argv.includes("--run"))throw new Error("Use --run.");
 const before=await prisma.variant.count(),orders=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 const rollback=new Error("rollback photo-limit fixture");
 try{
  await prisma.$transaction(async tx=>{
   const id=randomUUID();
   const variant=await tx.variant.create({data:{id,color:"Photo limit check",frameSize:"5x5",mountType:"NONE",mrp:1,price:1,maxPhotoSizeMB:2}});
   if(getPhotoMaxBytes([variant])!==2*PHOTO_MB_BYTES)throw new Error("2 MB check failed");
   for(const value of [null,1,2.5,10]){
    const updated=await tx.variant.update({where:{id},data:{maxPhotoSizeMB:value}});
    if(updated.maxPhotoSizeMB!==value)throw new Error("Nullable range failed");
   }
   for(const value of [0,-1,11,2.55]){
    await tx.$executeRawUnsafe("DO $$ BEGIN BEGIN UPDATE public.\"ProductVariant\" SET \"maxPhotoSizeMB\"="+value+" WHERE id='"+id+"'; RAISE EXCEPTION 'Invalid photo limit accepted'; EXCEPTION WHEN check_violation THEN NULL; END; END $$;");
   }
   throw rollback;
  },{timeout:15000});
 }catch(error){if(error!==rollback)throw error;}
 if(before!==await prisma.variant.count()||JSON.stringify(orders)!==JSON.stringify(await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}})))throw new Error("Historical data changed");
 const bucket=await supabaseAdmin.storage.getBucket(env.SUPABASE_PHOTO_BUCKET);
 if(bucket.error||bucket.data.public!==false||Number(bucket.data.file_size_limit)!==MAX_PHOTO_MAX_MB*PHOTO_MB_BYTES)throw new Error("Private bucket invariant failed");
 console.info("Live variant range/null checks passed in a rolled-back fixture; private bucket cap verified. Existing variants and orders unchanged.");
}
void main().catch(()=>{console.error("Variant photo-limit check failed; no credentials logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
