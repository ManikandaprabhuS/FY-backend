import { Router } from "express";
import { authenticate,staffOnly } from "../../middleware/auth.middleware";
import { ApiError } from "../../utils/api-error";
import { fixedOfferCode,updateOfferSchema } from "./offers.schemas";
import { listAdminOffers,offerHistory,updateOffer } from "./offers.service";
export const offersRouter=Router();
offersRouter.use(authenticate,staffOnly);
offersRouter.use((_req,res,next)=>{res.setHeader("Cache-Control","no-store");next();});
const updates=new Map<string,{count:number;expires:number}>();
offersRouter.get("/",async(_req,res)=>{res.json({success:true,data:{offers:await listAdminOffers()}});});
offersRouter.get("/:code/history",async(req,res)=>{const code=fixedOfferCode.parse(req.params.code);res.json({success:true,data:{history:await offerHistory(code)}});});
offersRouter.patch("/:code",async(req,res)=>{
 const actor=req.auth!.user,now=Date.now(),key=actor.id;
 for(const[k,v]of updates)if(v.expires<=now)updates.delete(k);
 const rate=updates.get(key)??{count:0,expires:now+60000};updates.set(key,rate);
 if(++rate.count>30)throw new ApiError(429,"Please wait before updating offers again.","OFFER_UPDATE_RATE_LIMIT");
 const code=fixedOfferCode.parse(req.params.code),input=updateOfferSchema.parse(req.body);
 res.json({success:true,data:{offer:await updateOffer(code,input,{id:actor.id,name:actor.name})}});
});
