import {Router} from "express";
import {optionalAuthenticate} from "../../middleware/auth.middleware";
import {publicHomepageBanner} from "./home-banner.service";
export const homeBannerRouter=Router();
homeBannerRouter.get("/banner",optionalAuthenticate,async(req,res)=>{
 res.setHeader("Cache-Control","private, no-store");
 const actor=req.auth?{id:req.auth.user.id,role:req.auth.user.role}:undefined;
 res.json({success:true,data:{banner:await publicHomepageBanner(actor)}});
});
