import {parseStatusHistory} from "./order-status-flow";
import {randomUUID} from "node:crypto";
import {UserRole,Prisma} from "@prisma/client";
import {prisma} from "../../prisma/client";
import {ApiError} from "../../utils/api-error";
import {orderViewSelect} from "./orders.select";
import {z} from "zod";
import {updateRefundSchema} from "./orders.schemas";
import {notifyCustomer} from "../customer-notifications/customer-notifications.service";
import {logger} from "../../config/logger";
export const refundMessage=(cancelledBy:string|null,status:string|null)=>status==="COMPLETED"?"Your refund is completed. Please check your respective bank account.":status==="INITIATED"?(cancelledBy==="customer"?"Your cancellation is confirmed and your refund has been initiated. You will be getting your money back.":"Your order was cancelled by FrameYaad and your refund has been initiated. You will be getting your money back."):(cancelledBy==="admin"?"Your order was cancelled by FrameYaad.":"Your cancellation is confirmed.");
export async function updateRefund(id:string,input:z.infer<typeof updateRefundSchema>,actor:{id:string;role:UserRole}){
 if(actor.role!==UserRole.ADMIN&&actor.role!==UserRole.EMPLOYEE)throw new ApiError(403,"You do not have permission for this action","FORBIDDEN");
 return prisma.$transaction(async tx=>{
  const order=await tx.order.findUnique({where:{id},select:orderViewSelect});
  if(!order)throw new ApiError(404,"Order was not found","ORDER_NOT_FOUND");
  if(order.status!=="CANCELLED")throw new ApiError(400,"Only cancelled orders can have a refund status.","INVALID_REFUND_TRANSITION");
  if(order.refundStatus===input.status)return order;
  if(order.refundStatus!==input.expectedRefundStatus)throw new ApiError(409,"Refund status changed. Please refresh and try again.","REFUND_CONFLICT");
  if(order.refundStatus==="COMPLETED"||(order.refundStatus!==null&&order.refundStatus!=="INITIATED")||(input.status==="INITIATED"&&order.refundStatus!==null))
   throw new ApiError(400,"Refund status can only move forward.","INVALID_REFUND_TRANSITION");
  if(input.status==="COMPLETED"&&!input.confirmCompleted)throw new ApiError(400,"Please confirm the refund amount has been sent to the customer.","REFUND_CONFIRMATION_REQUIRED");
  const now=new Date(),event={eventId:randomUUID(),status:input.status,previousStatus:order.refundStatus,changedAt:now.toISOString(),changedBy:actor};
  const history=Array.isArray(order.refundHistory)?order.refundHistory:[];
  const updated=await tx.order.updateMany({where:{id,status:"CANCELLED",refundStatus:order.refundStatus},data:{
   refundStatus:input.status,refundUpdatedBy:actor.id,refundHistory:[...history,event] as Prisma.InputJsonValue,
   ...(input.status==="INITIATED"?{refundInitiatedAt:now}:{refundCompletedAt:now})
  }});
  if(!updated.count)throw new ApiError(409,"Refund status changed. Please refresh and try again.","REFUND_CONFLICT");
  return tx.order.findUniqueOrThrow({where:{id},select:orderViewSelect});
 });
}
export function enqueueRefundNotification(order:{id:string;userId:string;orderNumber:string;cancelledBy:string|null;refundStatus:string|null;refundHistory:unknown;statusHistory?:unknown}){
 const history=Array.isArray(order.refundHistory)?order.refundHistory:[],event=history.at(-1) as {eventId?:string}|undefined;
 if(!event?.eventId)return;
 const eventId=event.eventId;
 const run=(attempt:number)=>setImmediate(()=>{void notifyCustomer(order.userId,"REFUND_"+order.refundStatus,{eventId,orderId:order.id,orderNumber:order.orderNumber,message:refundMessage(order.cancelledBy??(parseStatusHistory(order.statusHistory).find(e=>e.status==="CANCELLED")?.changedBy.role==="CUSTOMER"?"customer":"admin"),order.refundStatus),title:"Refund "+order.refundStatus?.toLowerCase()}).catch(()=>{
  if(attempt<2)setTimeout(()=>run(attempt+1),1000*(attempt+1)).unref();else logger.warn({orderId:order.id},"Refund notification could not be delivered");
 });});run(0);
}
