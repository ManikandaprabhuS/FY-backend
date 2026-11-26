import {prisma} from "../../prisma/client";
import {wakeDeliveryWorker} from "../../services/delivery/outbox-signal";
import {notifyCustomer} from "../customer-notifications/customer-notifications.service";

export const processOrderPlacedEffects=async(orderId:string)=>{
 const order=await prisma.order.findUnique({where:{id:orderId},select:{id:true,userId:true,orderNumber:true,totalPrice:true,createdAt:true,user:{select:{name:true}}}});
 if(!order)return;
 await Promise.all([
  notifyCustomer(order.userId,"ORDER_PLACED",{eventId:order.id,orderId:order.id,orderNumber:order.orderNumber,createdAt:order.createdAt}),
  prisma.notification.upsert({where:{id:order.id},create:{id:order.id,userId:null,title:"New order placed",message:order.user.name+" placed order "+order.orderNumber+" for "+order.totalPrice.toFixed(2)+".",type:"ORDER_PLACED"},update:{}})
 ]);
};
export const enqueueOrderPlacedEffects=(id:string)=>{void id;wakeDeliveryWorker();};
