import {Router} from "express";
import {UserRole} from "@prisma/client";
import {supabaseAdmin} from "../../config/supabase";
import {prisma} from "../../prisma/client";
import {getAccessToken} from "../../utils/auth-cookies";
import {publicHomepageBanner} from "./home-banner.service";
export const homeBannerRouter=Router();
// Public configuration is safe for intermediary caches; eligibility never is.
homeBannerRouter.get("/banner/public",async(_req,res)=>{
 res.setHeader("Cache-Control","public, max-age=30, stale-while-revalidate=60");
 res.json({success:true,data:{banner:await publicHomepageBanner()}});
});
homeBannerRouter.get("/banner",async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 const publicBanner=await publicHomepageBanner();
 if(publicBanner?.code!=="FIRST_ORDER"){res.json({success:true,data:{banner:publicBanner}});return;}
 const token=getAccessToken(req);
 let actor:{id:string;role:UserRole}|undefined;
 if(token){
  // Only this informational endpoint tolerates invalid credentials.
  // Protected routes retain their existing strict authentication.
  try{
   const {data,error}=await supabaseAdmin.auth.getUser(token);
   if(!error&&data.user){
    const profile=await prisma.user.findUnique({where:{id:data.user.id},select:{id:true,role:true,isActive:true}});
    if(profile?.isActive)actor={id:profile.id,role:profile.role};
   }
  }catch{
   // Auth-provider outages must not make public marketing content unavailable.
  }
 }
 res.json({success:true,data:{banner:await publicHomepageBanner(actor)}});
});
