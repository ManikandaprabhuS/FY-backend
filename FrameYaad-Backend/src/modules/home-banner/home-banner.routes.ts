import {Router} from "express";
import {publicHomepageBanner} from "./home-banner.service";
export const homeBannerRouter=Router();
// Marketing content is identical for guests and signed-in visitors.
// Eligibility remains authoritative at checkout, not in banner visibility.
for(const path of ["/banner","/banner/public"]){
 homeBannerRouter.get(path,async(_req,res)=>{
  res.setHeader("Cache-Control","public, max-age=30, stale-while-revalidate=60");
  res.json({success:true,data:{banner:await publicHomepageBanner()}});
 });
}
