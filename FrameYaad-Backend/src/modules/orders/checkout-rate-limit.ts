import type {RequestHandler} from "express";
import {ApiError} from "../../utils/api-error";
const windows=new Map<string,{count:number;until:number}>();
export const checkoutRateLimit:RequestHandler=(req,res,next)=>{
 const now=Date.now();
 for(const [key,value] of windows)if(value.until<=now)windows.delete(key);
 for(const [key,limit] of [[`user:${req.auth!.user.id}`,10],[`ip:${req.ip}`,30]] as const){
  const entry=windows.get(key)??{count:0,until:now+60000};
  windows.set(key,entry);
  if(++entry.count>limit){res.setHeader("Retry-After",Math.ceil((entry.until-now)/1000));return next(new ApiError(429,"Please wait a moment before placing another order.","CHECKOUT_RATE_LIMIT"));}
 }
 next();
};
