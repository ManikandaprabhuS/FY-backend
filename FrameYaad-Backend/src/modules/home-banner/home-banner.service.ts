import {type Prisma,UserRole} from "@prisma/client";
import {z} from "zod";
import {prisma} from "../../prisma/client";
import {ApiError} from "../../utils/api-error";
import {offerIdentity,hasOrderHistory} from "../checkout/checkout.service";
import {cachedBannerConfig,invalidateHomepageBanner,type BannerOffer} from "./banner-cache";
export const BANNER_ID="homepage_banner";
export const updateBannerSchema=z.object({enabled:z.boolean().optional(),featuredOfferCode:z.enum(["BIG_ORDER","FIRST_ORDER"]).optional()}).strict().refine(value=>Object.keys(value).length>0,"No banner changes supplied");
export const seedHomepageBanner=(db:Prisma.TransactionClient=prisma)=>db.homepageBanner.createMany({data:[{id:BANNER_ID,enabled:true,featuredOfferCode:"BIG_ORDER"}],skipDuplicates:true});
export const getAdminBanner=async()=>{
 const settings=await prisma.homepageBanner.findUniqueOrThrow({where:{id:BANNER_ID}});
 const updater=settings.updatedBy?await prisma.user.findUnique({where:{id:settings.updatedBy},select:{id:true,name:true}}):null;
 const {bannerImagePath:_path,...safe}=settings;void _path;
 return {...safe,updatedBy:updater};
};
export const updateHomepageBanner=async(input:z.infer<typeof updateBannerSchema>,actor:{id:string;name:string})=>{
 await prisma.$transaction(async tx=>{
  await tx.$queryRawUnsafe("SELECT id FROM public.homepage_banner WHERE id=$1 FOR UPDATE",BANNER_ID);
  const previous=await tx.homepageBanner.findUniqueOrThrow({where:{id:BANNER_ID}});
  const changes:Array<{field:string;oldValue:string|boolean;newValue:string|boolean}>=[];
  if(input.enabled!==undefined&&input.enabled!==previous.enabled)changes.push({field:"enabled",oldValue:previous.enabled,newValue:input.enabled});
  if(input.featuredOfferCode!==undefined&&input.featuredOfferCode!==previous.featuredOfferCode)changes.push({field:"featuredOfferCode",oldValue:previous.featuredOfferCode,newValue:input.featuredOfferCode});
  if(!changes.length)return;
  await tx.homepageBanner.update({where:{id:BANNER_ID},data:{...input,updatedBy:actor.id,updatedAt:new Date()}});
  await tx.offerAudit.createMany({data:changes.map(change=>({offerCode:input.featuredOfferCode??previous.featuredOfferCode,field:"banner."+change.field,oldValue:change.oldValue,newValue:change.newValue,actorId:actor.id,actorName:actor.name}))});
 },{timeout:15000});
 invalidateHomepageBanner();return getAdminBanner();
};
export const publicHomepageBanner=async(actor?:{id:string;role:UserRole}):Promise<BannerOffer|null>=>{
 const config=await cachedBannerConfig(async()=>{
  const setting=await prisma.homepageBanner.findUnique({where:{id:BANNER_ID},select:{enabled:true,featuredOfferCode:true,bannerImageUrl:true}});
  if(!setting?.enabled)return {enabled:false,offer:null};
  const offer=await prisma.offer.findUnique({where:{code:setting.featuredOfferCode},select:{code:true,title:true,enabled:true,percentage:true,minOrderAmount:true}});
  if(!offer?.enabled||!["FIRST_ORDER","BIG_ORDER"].includes(offer.code))return {enabled:true,offer:null};
  return {enabled:true,offer:{bannerImageUrl:setting.bannerImageUrl??null,code:offer.code as BannerOffer["code"],title:offer.title,percentage:Number(offer.percentage),minOrderAmount:offer.minOrderAmount===null?null:Number(offer.minOrderAmount)}};
 });
 if(!config.enabled||!config.offer)return null;
 if(config.offer.code==="FIRST_ORDER"&&actor?.role===UserRole.CUSTOMER){
  const identity=await offerIdentity(prisma,actor.id);
  if(await hasOrderHistory(prisma,identity.email,identity.phone))return null;
 }
 return config.offer;
};
export const requireBannerActor=(actor:{id:string;role:UserRole;name:string}|undefined)=>{
 if(!actor)throw new ApiError(401,"Authentication is required","AUTHENTICATION_REQUIRED");
 if(actor.role!==UserRole.ADMIN&&actor.role!==UserRole.EMPLOYEE)throw new ApiError(403,"You do not have permission for this action","FORBIDDEN");
 return actor;
};
