import {Router,type RequestHandler} from "express";
import multer from "multer";
import {authenticate,staffOnly} from "../../middleware/auth.middleware";
import {ApiError} from "../../utils/api-error";
import {BANNER_IMAGE_MAX_BYTES,replaceBannerImage,removeBannerImage} from "./banner-image.service";
export const bannerImageRouter=Router();
bannerImageRouter.use(authenticate,staffOnly,(_req,res,next)=>{res.set("Cache-Control","no-store");next();});
const limits=new Map<string,{count:number;until:number}>();
const rate:RequestHandler=(req,res,next)=>{
 const now=Date.now();
 for(const[key,value]of limits)if(value.until<=now)limits.delete(key);
 for(const key of ["user:"+req.auth!.user.id,"ip:"+req.ip]){
  const value=limits.get(key)??{count:0,until:now+60000};limits.set(key,value);
  if(++value.count>10){res.set("Retry-After",String(Math.ceil((value.until-now)/1000)));next(new ApiError(429,"Please wait before updating the banner image again.","BANNER_IMAGE_RATE_LIMIT"));return;}
 }
 next();
};
const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:BANNER_IMAGE_MAX_BYTES+1,files:1,fields:0,parts:2}}).single("image");
const parse:RequestHandler=(req,res,next)=>upload(req,res,error=>{
 if(error instanceof multer.MulterError)next(new ApiError(error.code==="LIMIT_FILE_SIZE"?413:400,error.code==="LIMIT_FILE_SIZE"?"Image must be 2 MB or smaller":"Upload one image using the image field.","BANNER_IMAGE_UPLOAD_INVALID"));
 else next(error as unknown);
});
bannerImageRouter.post("/",rate,parse,async(req,res)=>res.status(201).json({success:true,data:await replaceBannerImage(req.file,req.auth!.user)}));
bannerImageRouter.delete("/",rate,async(req,res)=>res.json({success:true,data:await removeBannerImage(req.auth!.user)}));
