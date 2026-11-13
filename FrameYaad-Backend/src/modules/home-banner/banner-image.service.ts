import {prisma} from "../../prisma/client";
import {supabaseAdmin} from "../../config/supabase";
import {env} from "../../config/env";
import {logger} from "../../config/logger";
import {ApiError} from "../../utils/api-error";
import {verifiedPhotoType} from "../order-photos/photo-file";
import {BANNER_ID,requireBannerActor} from "./home-banner.service";
import {invalidateHomepageBanner} from "./banner-cache";
import {Prisma,type UserRole} from "@prisma/client";
export const BANNER_IMAGE_MAX_BYTES=2*1024*1024;
const storage=()=>supabaseAdmin.storage.from(env.SUPABASE_BANNER_BUCKET);
const unavailable=()=>new ApiError(503,"The banner image could not be saved. Please try again.","BANNER_IMAGE_UNAVAILABLE");
let stamp=0;
export function validateBannerImage(file?:Express.Multer.File){
 if(!file||!file.buffer.length)throw new ApiError(400,"Please choose a non-empty banner image.","BANNER_IMAGE_REQUIRED");
 if(file.buffer.length>BANNER_IMAGE_MAX_BYTES)throw new ApiError(413,"Image must be 2 MB or smaller","BANNER_IMAGE_TOO_LARGE");
 try{return verifiedPhotoType(file.buffer);}
 catch(error){if(error instanceof ApiError)throw new ApiError(error.statusCode,error.statusCode===415?"Please choose a JPG, PNG or WebP banner image.":"This banner image is damaged. Please choose another image.","BANNER_IMAGE_INVALID");throw unavailable();}
}
async function removeObject(path:string){
 try{const result=await storage().remove([path]);if(!result.error)return;}
 catch{/* A later orphan sweep retries without logging object paths. */}
 logger.warn({event:"banner_image_cleanup_pending"},"Banner image cleanup will retry");
}
export async function replaceBannerImage(file:Express.Multer.File|undefined,actor:{id:string;name:string;role:UserRole}){
 requireBannerActor(actor);
 const type=validateBannerImage(file);
 let path:string|undefined;
 try{
  for(let attempt=0;attempt<5;attempt++){
   stamp=Math.max(Date.now(),stamp+1);
   const candidate="banner-"+stamp+"."+type.ext;
   const uploaded=await storage().upload(candidate,file!.buffer,{contentType:type.mimeType,upsert:false,cacheControl:"31536000"});
   if(!uploaded.error){path=candidate;break;}
   if(!("statusCode" in uploaded.error)||Number(uploaded.error.statusCode)!==409)throw unavailable();
  }
  if(!path)throw unavailable();
  const imageUrl=storage().getPublicUrl(path).data.publicUrl;
  const previousPath=await prisma.$transaction(async tx=>{
   await tx.$queryRawUnsafe("SELECT id FROM public.homepage_banner WHERE id=$1 FOR UPDATE",BANNER_ID);
   const previous=await tx.homepageBanner.findUniqueOrThrow({where:{id:BANNER_ID}});
   await tx.homepageBanner.update({where:{id:BANNER_ID},data:{bannerImageUrl:imageUrl,bannerImagePath:path,updatedBy:actor.id,updatedAt:new Date()}});
   await tx.offerAudit.create({data:{offerCode:previous.featuredOfferCode,field:"banner.image",oldValue:previous.bannerImageUrl??Prisma.JsonNull,newValue:imageUrl,actorId:actor.id,actorName:actor.name}});
   return previous.bannerImagePath;
  },{timeout:15000});
  invalidateHomepageBanner();
  if(previousPath)await removeObject(previousPath);
  return {imageUrl};
 }catch(error){
  if(path){
   // A connection can fail after commit: never delete an image unless DB state confirms it is unused.
   const current=await prisma.homepageBanner.findUnique({where:{id:BANNER_ID},select:{bannerImagePath:true}}).catch(()=>undefined);
   if(current!==undefined&&current?.bannerImagePath!==path)await removeObject(path);
  }
  if(error instanceof ApiError)throw error;
  throw unavailable();
 }
}
export async function removeBannerImage(actor:{id:string;name:string;role:UserRole}){
 requireBannerActor(actor);
 const path=await prisma.$transaction(async tx=>{
  await tx.$queryRawUnsafe("SELECT id FROM public.homepage_banner WHERE id=$1 FOR UPDATE",BANNER_ID);
  const previous=await tx.homepageBanner.findUniqueOrThrow({where:{id:BANNER_ID}});
  if(!previous.bannerImagePath&&!previous.bannerImageUrl)return null;
  await tx.homepageBanner.update({where:{id:BANNER_ID},data:{bannerImagePath:null,bannerImageUrl:null,updatedBy:actor.id,updatedAt:new Date()}});
  await tx.offerAudit.create({data:{offerCode:previous.featuredOfferCode,field:"banner.image",oldValue:previous.bannerImageUrl??Prisma.JsonNull,newValue:Prisma.JsonNull,actorId:actor.id,actorName:actor.name}});
  return previous.bannerImagePath;
 },{timeout:15000});
 invalidateHomepageBanner();
 if(path)await removeObject(path);
 return {imageUrl:null};
}
let sweeping=false;
export async function cleanupBannerImages(){
 if(sweeping)return;sweeping=true;
 let removed=0;
 try{
  const current=await prisma.homepageBanner.findUnique({where:{id:BANNER_ID},select:{bannerImagePath:true}});
  const result=await storage().list("",{limit:1000,sortBy:{column:"created_at",order:"asc"}});
  if(result.error)throw unavailable();
  const stale=result.data.filter(file=>/^banner-\d+\.(jpg|png|webp)$/.test(file.name)&&file.name!==current?.bannerImagePath&&file.created_at&&Date.parse(file.created_at)<Date.now()-3600000);
  for(const file of stale){
   // Re-check before removal to exclude an image currently being saved by another worker.
   const active=await prisma.homepageBanner.findUnique({where:{id:BANNER_ID},select:{bannerImagePath:true}});
   if(active?.bannerImagePath!==file.name){await removeObject(file.name);removed++;}
  }
  logger.info({removed},"Banner image cleanup completed");
 }finally{sweeping=false;}
}
export function startBannerImageCleanup(){
 const timer=setInterval(()=>{void cleanupBannerImages().catch(()=>logger.warn({event:"banner_cleanup_retry"},"Banner image cleanup will retry"));},3600000);
 timer.unref();
}
