import {prisma} from "../src/prisma/client";
import {supabaseAdmin} from "../src/config/supabase";
import {env} from "../src/config/env";
async function main(){
 if(!process.argv.includes("--apply"))throw new Error("Review setup and run with --apply.");
 const before=await supabaseAdmin.storage.getBucket("customer-photos");
 const options={public:true,fileSizeLimit:2097152,allowedMimeTypes:["image/jpeg","image/png","image/webp"]};
 const bucket=await supabaseAdmin.storage.getBucket(env.SUPABASE_BANNER_BUCKET);
 const result=bucket.data?await supabaseAdmin.storage.updateBucket(env.SUPABASE_BANNER_BUCKET,options):await supabaseAdmin.storage.createBucket(env.SUPABASE_BANNER_BUCKET,options);
 if(result.error)throw new Error("Banner bucket setup failed");
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('ALTER TABLE public.homepage_banner ADD COLUMN IF NOT EXISTS "bannerImageUrl" text, ADD COLUMN IF NOT EXISTS "bannerImagePath" text');
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit DROP CONSTRAINT IF EXISTS offer_audit_field_check");
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit ADD CONSTRAINT offer_audit_field_check CHECK (field IN ('percentage','minOrderAmount','enabled','banner.enabled','banner.featuredOfferCode','banner.image'))");
 });
 const after=await supabaseAdmin.storage.getBucket("customer-photos");
 if(JSON.stringify(before.data)!==JSON.stringify(after.data))throw new Error("Private photo bucket invariant failed");
 console.info("Public site-banners bucket and additive banner fields ready; customer-photos unchanged.");
}
void main().catch(()=>{console.error("Banner image setup failed; no credentials logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
