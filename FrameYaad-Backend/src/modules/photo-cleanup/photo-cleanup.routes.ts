import {Router} from "express";
import type {RequestHandler} from "express";
import {ApiError} from "../../utils/api-error";
import {authenticate,staffOnly} from "../../middleware/auth.middleware";
import {listCleanup,deleteCleanup} from "./photo-cleanup.service";
import {storageMetrics} from "./storage-metrics";
import {z} from "zod";
const windows=new Map<string,{until:number;count:number}>();
const rate=(limit:number):RequestHandler=>(req,res,next)=>{
 const now=Date.now();
 for(const [key,value]of windows)if(value.until<=now)windows.delete(key);
 for(const key of [limit+":user:"+req.auth!.user.id,limit+":ip:"+req.ip]){
  const value=windows.get(key)??{until:now+60000,count:0};windows.set(key,value);
  if(++value.count>limit){res.setHeader("Retry-After",Math.ceil((value.until-now)/1000));next(new ApiError(429,"Please wait before trying again.","PHOTO_CLEANUP_RATE_LIMIT"));return;}
 }next();
};
export const photoCleanupRouter=Router();

photoCleanupRouter.get("/photo-cleanup",authenticate,staffOnly,async(req,res)=>{res.setHeader("Cache-Control","no-store");res.json({success:true,data:await listCleanup(req.query,req.auth!.user)});});
photoCleanupRouter.post("/photo-cleanup/delete",authenticate,staffOnly,rate(10),async(req,res)=>{
 res.setHeader("Cache-Control","no-store");res.json({success:true,data:await deleteCleanup(req.body,req.auth!.user)});
});
photoCleanupRouter.get("/storage-usage",authenticate,staffOnly,rate(20),async(req,res)=>{
 const q=z.object({refresh:z.enum(["true","false"]).optional()}).parse(req.query);
 res.setHeader("Cache-Control","no-store");res.json({success:true,data:await storageMetrics(q.refresh==="true")});
});
