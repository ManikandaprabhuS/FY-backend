import {prisma} from "../src/prisma/client";
import {supabaseAdmin} from "../src/config/supabase";
import {env} from "../src/config/env";
import {CONTACT_VIDEO_MAX} from "../src/modules/contact-media/contact-media.validation";
async function main(){
 if(!process.argv.includes("--apply"))throw new Error("Review setup and run with --apply.");
 const privateBefore=await supabaseAdmin.storage.getBucket("customer-photos");
 const options={public:true,fileSizeLimit:CONTACT_VIDEO_MAX,allowedMimeTypes:["video/mp4","video/webm","image/jpeg","image/png","image/webp"]};
 const existing=await supabaseAdmin.storage.getBucket(env.SUPABASE_SITE_MEDIA_BUCKET);
 const result=existing.data?await supabaseAdmin.storage.updateBucket(env.SUPABASE_SITE_MEDIA_BUCKET,options):await supabaseAdmin.storage.createBucket(env.SUPABASE_SITE_MEDIA_BUCKET,options);
 if(result.error)throw new Error("Site media bucket setup failed");
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS public.site_contact_settings (key varchar(40) PRIMARY KEY CHECK (key IN (\'storyboard_video\',\'custom_framing_banner\',\'contact_details\')),data jsonb NOT NULL DEFAULT \'{}\'::jsonb,"updatedBy" text,"updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await tx.$executeRawUnsafe("INSERT INTO public.site_contact_settings (key) VALUES ('storyboard_video'),('custom_framing_banner'),('contact_details') ON CONFLICT (key) DO NOTHING");
  await tx.$executeRawUnsafe("ALTER TABLE public.site_contact_settings ENABLE ROW LEVEL SECURITY");
  await tx.$executeRawUnsafe("DROP POLICY IF EXISTS site_media_backend_only ON storage.objects");
  await tx.$executeRawUnsafe("CREATE POLICY site_media_backend_only ON storage.objects AS RESTRICTIVE FOR ALL TO anon, authenticated USING (bucket_id <> 'site-media') WITH CHECK (bucket_id <> 'site-media')");
  await tx.$executeRawUnsafe("REVOKE ALL ON public.site_contact_settings FROM anon, authenticated");
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit DROP CONSTRAINT IF EXISTS offer_audit_field_check");
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit ADD CONSTRAINT offer_audit_field_check CHECK (field IN ('percentage','minOrderAmount','enabled','banner.enabled','banner.featuredOfferCode','banner.image','contact.video','contact.poster','contact.banner','contact.details'))");
 },{timeout:15000});
 const privateAfter=await supabaseAdmin.storage.getBucket("customer-photos");
 if(JSON.stringify(privateBefore.data)!==JSON.stringify(privateAfter.data))throw new Error("Private bucket invariant failed");
 console.info("Contact settings and public site-media bucket ready. Existing settings and private photos preserved.");
}
void main().catch(()=>{console.error("Contact media setup failed; no credentials or raw database errors logged.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
