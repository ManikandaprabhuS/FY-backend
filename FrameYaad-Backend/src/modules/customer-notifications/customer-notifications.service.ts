import {prisma} from "../../prisma/client";
import {importLegacyCustomerOrderNotifications} from "./legacy-customer-notifications";
import {logger} from "../../config/logger";
import {ApiError} from "../../utils/api-error";
import {paginationMeta} from "../../utils/pagination";
import {z} from "zod";
const recent=()=>new Date(Date.now()-90*86400000);
export const notifyCustomer=async(userId:string,event:string,data:{eventId:string;orderId:string;orderNumber:string;status?:string;createdAt?:Date;message?:string;title?:string})=>{
 const cancelled=data.status==="Cancelled";
 const placed=event==="ORDER_PLACED";
 const title=placed?"Order placed":cancelled?"Order cancelled":"Order status updated";
 const message=placed?"Your order "+data.orderNumber+" has been placed.":"Your order "+data.orderNumber+" is now "+data.status+".";
 // Future email-channel integration belongs here; this function sends no email.
 await prisma.customerNotification.upsert({where:{id:data.eventId},create:{id:data.eventId,userId,type:cancelled?"ORDER_CANCELLED":event,title:data.title??title,message:data.message??message,orderId:data.orderId,createdAt:data.createdAt??new Date()},update:{}});
};
export const customerUnreadCount=async(userId:string)=>{
 await importLegacyCustomerOrderNotifications(userId);
 return prisma.customerNotification.count({where:{userId,isRead:false,createdAt:{gte:recent()}}});
};
export const listCustomerNotifications=async(userId:string,raw:unknown)=>{
 const {page,limit}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(20)}).parse(raw);
 await importLegacyCustomerOrderNotifications(userId);
 const where={userId,createdAt:{gte:recent()}};
 const [notifications,total,unreadCount]=await Promise.all([
  prisma.customerNotification.findMany({where,orderBy:[{createdAt:"desc"},{id:"desc"}],skip:(page-1)*limit,take:limit,select:{id:true,type:true,title:true,message:true,orderId:true,isRead:true,createdAt:true}}),
  prisma.customerNotification.count({where}),customerUnreadCount(userId)
 ]);
 return {notifications,pagination:paginationMeta(page,limit,total),unreadCount};
};
export const readCustomerNotification=async(userId:string,id?:string)=>{
 await importLegacyCustomerOrderNotifications(userId);
 const result=await prisma.customerNotification.updateMany({where:{userId,...(id?{id}:{}),isRead:false},data:{isRead:true}});
 if(id&&!result.count&&!await prisma.customerNotification.findFirst({where:{id,userId},select:{id:true}}))throw new ApiError(404,"Notification was not found","NOTIFICATION_NOT_FOUND");
 return {unreadCount:await customerUnreadCount(userId)};
};
export const cleanupCustomerNotifications=()=>prisma.customerNotification.deleteMany({where:{createdAt:{lt:recent()}}});
export const startCustomerNotificationCleanup=()=>{
 const run=()=>{void cleanupCustomerNotifications().catch(()=>logger.warn("Customer notification cleanup failed"));};
 run();const timer=setInterval(run,86400000);timer.unref();return()=>clearInterval(timer);
};
