import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {seedHomepageBanner} from "../src/modules/home-banner/home-banner.service";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--apply"))throw new Error("Use --apply on the reviewed test database.");
 const before=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 await prisma.$transaction(async tx=>{
  await tx.$executeRawUnsafe("CREATE TABLE IF NOT EXISTS public.homepage_banner (id varchar(30) PRIMARY KEY DEFAULT 'homepage_banner' CHECK (id='homepage_banner'), enabled boolean NOT NULL DEFAULT true, \"featuredOfferCode\" varchar(20) NOT NULL DEFAULT 'BIG_ORDER' CHECK (\"featuredOfferCode\" IN ('FIRST_ORDER','BIG_ORDER')), \"updatedBy\" text, \"updatedAt\" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP)");
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit DROP CONSTRAINT IF EXISTS offer_audit_field_check");
  await tx.$executeRawUnsafe("ALTER TABLE public.offer_audit ADD CONSTRAINT offer_audit_field_check CHECK (field IN ('percentage','minOrderAmount','enabled','banner.enabled','banner.featuredOfferCode','banner.image'))");
  await seedHomepageBanner(tx);
 },{timeout:15000});
 const after=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 if(JSON.stringify(before)!==JSON.stringify(after))throw new Error("Historical order invariant failed");
 console.info("Homepage banner settings ready; existing orders unchanged.");
}
void main().catch(()=>{console.error("Banner setup failed; check configuration without logging credentials.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
