import {prisma} from "../../prisma/client";
import {logger} from "../../config/logger";
import {notifyCustomer} from "../customer-notifications/customer-notifications.service";
import {parseStatusHistory,statusLabel} from "./order-status-flow";
export const processOrderStatusEffects=async(orderId:string,eventId:string)=>{
 const order=await prisma.order.findUnique({where:{id:orderId},select:{id:true,orderNumber:true,userId:true,statusHistory:true}});
 const event=parseStatusHistory(order?.statusHistory).find(e=>e.eventId===eventId);
 if(!order||!event)return;
 const status=statusLabel(event.status);
 await notifyCustomer(order.userId,"ORDER_STATUS",{eventId,orderId:order.id,orderNumber:order.orderNumber,status,createdAt:new Date(event.changedAt)});
};
const pending=new Set<string>();
export const enqueueOrderStatusEffects=(orderId:string,eventId:string)=>{
 if(pending.has(eventId))return;pending.add(eventId);
 const run=(attempt:number)=>{setImmediate(()=>{void processOrderStatusEffects(orderId,eventId).then(()=>pending.delete(eventId)).catch(()=>{
  if(attempt<2){const timer=setTimeout(()=>run(attempt+1),1000*(attempt+1));timer.unref();}
  else{pending.delete(eventId);logger.warn({orderId},"Order status notification could not be delivered");}
 });});};
 run(0);
};
