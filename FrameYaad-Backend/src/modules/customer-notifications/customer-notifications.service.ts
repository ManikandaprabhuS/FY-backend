import {prisma} from "../../prisma/client";
import {Prisma} from '@prisma/client';
import {customerHistoryPage} from './customer-notification-query';
import {ApiError} from "../../utils/api-error";
import {paginationMeta} from "../../utils/pagination";
import {z} from "zod";
export const notifyCustomer=async(userId:string,event:string,data:{eventId:string;orderId:string;orderNumber:string;status?:string;createdAt?:Date;message?:string;title?:string})=>{
 const cancelled=data.status==="Cancelled";
 const placed=event==="ORDER_PLACED";
 const title=placed?"Order placed":cancelled?"Order cancelled":"Order status updated";
 const message=placed?"Your order "+data.orderNumber+" has been placed.":"Your order "+data.orderNumber+" is now "+data.status+".";
 // Future email-channel integration belongs here; this function sends no email.
 await prisma.customerNotification.upsert({where:{id:data.eventId},create:{id:data.eventId,userId,type:cancelled?"ORDER_CANCELLED":event,title:data.title??title,message:data.message??message,orderId:data.orderId,createdAt:data.createdAt??new Date()},update:{}});
};
export const customerUnreadCount=async(userId:string)=>{
 return (await customerHistoryPage(userId,1,1)).unread;
};
export const listCustomerNotifications=async(userId:string,raw:unknown)=>{
 const {page,limit,read}=z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(20),read:z.preprocess(v=>typeof v==='boolean'?String(v):v,z.enum(['true','false']).transform(v=>v==='true').optional())}).parse(raw);
 const result=await customerHistoryPage(userId,page,limit,read);
 const summary={totalCount:result.total,unreadCount:result.unread,readCount:result.total-result.unread};
 const total=read===undefined?result.total:read?summary.readCount:result.unread;
 return {notifications:result.notifications,pagination:paginationMeta(page,limit,total),unreadCount:result.unread,summary};
};
export const readCustomerNotification=async(userId:string,id?:string)=>{
 const result=await prisma.$queryRaw<Array<{owned:boolean}>>(Prisma.sql`
  WITH modern_update AS (
   UPDATE public.customer_notifications SET "isRead"=true
   WHERE "userId"=${userId} AND NOT "isRead" ${id?Prisma.sql`AND id=${id}`:Prisma.empty} RETURNING id
  ), legacy_update AS (
   UPDATE public.notifications SET read=true,"readBy"=${userId},"updatedAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
   WHERE "userId"=${userId} AND NOT read ${id?Prisma.sql`AND id=${id}`:Prisma.empty} RETURNING id
  ) SELECT ${id?Prisma.sql`EXISTS(SELECT 1 FROM public.customer_notifications WHERE id=${id} AND "userId"=${userId}) OR EXISTS(SELECT 1 FROM public.notifications WHERE id=${id} AND "userId"=${userId})`:Prisma.sql`true`} AS owned
 `);
 if(id&&!result[0]?.owned)throw new ApiError(404,"Notification was not found","NOTIFICATION_NOT_FOUND");
 const page=await customerHistoryPage(userId,1,1);
 return {unreadCount:page.unread,summary:{totalCount:page.total,unreadCount:page.unread,readCount:page.total-page.unread}};
};
// Full customer history is retained. Keep startup/job API compatibility without pruning.
export const cleanupCustomerNotifications=async()=>({count:0});
export const startCustomerNotificationCleanup=()=>()=>undefined;
