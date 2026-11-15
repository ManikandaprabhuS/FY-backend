import {Router,type RequestHandler} from "express";
import multer from "multer";
import {authenticate,staffOnly} from "../../middleware/auth.middleware";
import {ApiError} from "../../utils/api-error";
import {CONTACT_IMAGE_MAX,CONTACT_VIDEO_MAX,mediaKind,contactDetailsSchema} from "./contact-media.validation";
import {publicContactMedia,adminContactSettings,replaceContactMedia,removeContactMedia,updateContactDetails} from "./contact-media.service";
export const contactPublicRouter=Router(),contactAdminRouter=Router();
contactPublicRouter.get("/contact-media",async(_req,res)=>{
 const content=await publicContactMedia();res.set("Cache-Control","public, max-age=60, stale-while-revalidate=60");res.json({success:true,data:content});
});
contactAdminRouter.use(authenticate,staffOnly,(_req,res,next)=>{res.set("Cache-Control","no-store");next();});
const hits=new Map<string,{count:number;until:number}>();
const rate:RequestHandler=(req,res,next)=>{
 const now=Date.now();for(const[key,value]of hits)if(value.until<=now)hits.delete(key);
 for(const key of ["user:"+req.auth!.user.id,"ip:"+req.ip]){
  const value=hits.get(key)??{count:0,until:now+60000};hits.set(key,value);
  if(++value.count>12){res.set("Retry-After",String(Math.ceil((value.until-now)/1000)));next(new ApiError(429,"Please wait before updating Contact settings again.","CONTACT_MEDIA_RATE_LIMIT"));return;}
 }next();
};
const active=new Set<string>();
const concurrency:RequestHandler=(req,res,next)=>{
 const id=req.auth!.user.id;if(active.has(id)||active.size>=2){next(new ApiError(429,"Another upload is in progress. Please wait.","CONTACT_UPLOAD_BUSY"));return;}
 active.add(id);const done=()=>active.delete(id);res.once("finish",done);res.once("close",done);next();
};
const upload:RequestHandler=(req,res,next)=>{
 const kind=mediaKind.parse(req.params.kind),max=kind==="video"?CONTACT_VIDEO_MAX:CONTACT_IMAGE_MAX;
 multer({storage:multer.memoryStorage(),limits:{fileSize:max+1,files:1,fields:0,parts:2}}).single("file")(req,res,error=>{
  if(error instanceof multer.MulterError){next(new ApiError(error.code==="LIMIT_FILE_SIZE"?413:400,error.code==="LIMIT_FILE_SIZE"?(kind==="video"?"Video must be 50 MB or smaller.":"Image must be 2 MB or smaller."):"Upload one file using the file field.","CONTACT_UPLOAD_INVALID"));return;}
  next(error as unknown);
 });
};
contactAdminRouter.get("/",async(_req,res)=>res.json({success:true,data:await adminContactSettings()}));
contactAdminRouter.patch("/details",rate,async(req,res)=>res.json({success:true,data:await updateContactDetails(contactDetailsSchema.parse(req.body),req.auth!.user)}));
contactAdminRouter.put("/media/:kind",rate,concurrency,upload,async(req,res)=>res.status(201).json({success:true,data:await replaceContactMedia(mediaKind.parse(req.params.kind),req.file,req.auth!.user)}));
contactAdminRouter.delete("/media/:kind",rate,async(req,res)=>res.json({success:true,data:await removeContactMedia(mediaKind.parse(req.params.kind),req.auth!.user)}));
