import {prisma} from "../../prisma/client";
import {logger} from "../../config/logger";
import {notifyCustomer} from "../customer-notifications/customer-notifications.service";
const pending=new Set<string>();
export const processOrderPlacedEffects=async(orderId:string)=>{
 const order=await prisma.order.findUnique({where:{id:orderId},select:{id:true,userId:true,orderNumber:true,totalPrice:true,createdAt:true,user:{select:{name:true}}}});
 if(!order)return;
 await Promise.all([
  notifyCustomer(order.userId,"ORDER_PLACED",{eventId:order.id,orderId:order.id,orderNumber:order.orderNumber,createdAt:order.createdAt}),
  prisma.notification.upsert({where:{id:order.id},create:{id:order.id,userId:null,title:"New order placed",message:order.user.name+" placed order "+order.orderNumber+" for "+order.totalPrice.toFixed(2)+".",type:"ORDER_PLACED"},update:{}})
 ]);
};
export const enqueueOrderPlacedEffects=(id:string)=>{
 if(pending.has(id))return;pending.add(id);
 const run=(attempt:number)=>setImmediate(()=>{void processOrderPlacedEffects(id).then(()=>pending.delete(id)).catch(()=>{
  if(attempt<2){const timer=setTimeout(()=>run(attempt+1),1000*(attempt+1));timer.unref();}
  else{pending.delete(id);logger.warn({orderId:id},"Order placed notification could not be delivered");}
 });});
 run(0);
};
