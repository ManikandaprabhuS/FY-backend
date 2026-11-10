import { Router, type RequestHandler } from "express";
import { authenticate, authorize } from "../../middleware/auth.middleware";
import { UserRole } from "@prisma/client";
import { ApiError } from "../../utils/api-error";
import { checkoutItemsSchema } from "./checkout.schemas";
import { getCheckoutOffers } from "./checkout.service";
export const checkoutRouter=Router();
const requests=new Map<string,{count:number,expires:number}>();
checkoutRouter.use(authenticate,authorize(UserRole.CUSTOMER));
const offersHandler: RequestHandler = async(req,res)=>{
  const id=req.auth!.user.id,now=Date.now(),key=id+":"+req.ip;
  let entry=requests.get(key);
  if(!entry||entry.expires<=now){entry={count:0,expires:now+60000};requests.set(key,entry);}
  if(++entry.count>60)throw new ApiError(429,"Please wait before checking offers again.","OFFER_RATE_LIMIT");
  if(requests.size>10000)for(const [k,v]of requests)if(v.expires<=now)requests.delete(k);
  const items=req.method==="POST"?checkoutItemsSchema.parse((req.body as {items?:unknown})?.items):undefined;
  res.setHeader("Cache-Control","no-store");
  res.json({success:true,data:await getCheckoutOffers(id,items)});
};
checkoutRouter.get("/offers",offersHandler);
checkoutRouter.post("/offers",offersHandler);
