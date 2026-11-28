import { z } from 'zod';
import {getBusinessFacts} from '../../config/business-facts';
import {notifyCustomer} from '../../modules/customer-notifications/customer-notifications.service';
import {emailLayout} from './transactional-email';
import type { DeliveryJob, Prisma } from '@prisma/client';
import { prisma } from '../../prisma/client';
import { processOrderPlacedEffects } from '../../modules/orders/order-placed-effects';
import { processOrderStatusEffects } from '../../modules/orders/order-status-effects';
import { processRefundNotification } from '../../modules/orders/order-refunds';
import { buildAppointmentCreatedEmails,buildAppointmentStatusEmail } from '../appointment-email/appointment-email.service';
import { orderEmail,welcomeEmail,escapeEmailText } from './transactional-email';
import type { EmailMessage } from '../email.service';
import type { AppointmentEmailView } from '../../modules/appointment/appointment.types';

const eventSchema=z.object({id:z.string()}).passthrough();
const snapshotDate=(value:unknown)=>new Date(String(value));
async function mail(job:DeliveryJob,suffix:string,message:EmailMessage,appointment?:AppointmentEmailView){
 const support=await getBusinessFacts();
 const contact=new URL('/contact#get-in-touch',support.siteUrl).href;
 message={...message,html:message.html+`<p style="font:12px Arial,sans-serif;color:#555;text-align:center">Questions? <a href="${escapeEmailText(contact)}">Contact FrameYaad</a>${support?.email?` &middot; ${escapeEmailText(support.email)}`:''}${support?.phone?` &middot; ${escapeEmailText(support.phone)}`:''}</p>`};
 const payload={message,...(appointment?{appointmentId:appointment.id,appointmentStatus:appointment.status,bookingDate:appointment.bookingDate.toISOString(),parentId:job.id}: {})};
 await prisma.deliveryJob.upsert({where:{idempotencyKey:`${job.idempotencyKey}:${suffix}`},create:{kind:'EMAIL',idempotencyKey:`${job.idempotencyKey}:${suffix}`,payload:payload as unknown as Prisma.InputJsonValue},update:{}});
}
export async function processDeliveryEvent(job:DeliveryJob){
 const body=eventSchema.parse(job.payload),id=body.id;
 if(job.kind==='REFUND_REQUEST'){
  const event=z.object({id:z.string(),eventId:z.string(),orderId:z.string(),userId:z.string(),action:z.string(),status:z.string(),resolution:z.string().nullable(),approvedAmount:z.string().nullable(),adminMessage:z.string(),createdAt:z.string()}).parse(body);
  const order=await prisma.order.findUnique({where:{id:event.orderId},select:{id:true,orderNumber:true,userId:true,user:{select:{name:true,email:true}}}});if(!order)return;
  const titles:Record<string,string>={REQUESTED:'Refund request received',UNDER_REVIEW:'Refund request under review',APPROVE:'Refund request approved',REJECT:'Refund request rejected',INITIATED:'Refund initiated',COMPLETED:'Refund completed',REPLACEMENT_DISPATCHED:'Replacement dispatched',WITHDRAW:'Refund request withdrawn'};
  const title=titles[event.action];if(!title)throw new Error('Unknown refund request event');
  const message=`${event.id} · ${order.orderNumber}: ${title}.${event.adminMessage?' '+event.adminMessage:''}`.slice(0,500);
  await notifyCustomer(order.userId,'RETURN_'+event.action,{eventId:event.eventId,orderId:order.id,orderNumber:order.orderNumber,title,message,createdAt:new Date(event.createdAt)});
  if(event.action==='REQUESTED')await prisma.notification.upsert({where:{id:event.eventId},create:{id:event.eventId,userId:null,type:'INFO',title:'New refund request '+event.id,message:`${order.user.name} submitted ${event.id} for order ${order.orderNumber}.`},update:{}});
  const facts=await getBusinessFacts(),link=new URL(`/orders/${encodeURIComponent(order.id)}`,facts.siteUrl).href;
  await mail(job,'customer',{to:order.user.email,subject:`${title}: ${event.id}`,html:emailLayout(title,`<p>Hello ${escapeEmailText(order.user.name)},</p><p>Request <strong>${escapeEmailText(event.id)}</strong> for order ${escapeEmailText(order.orderNumber)}.</p><p>${escapeEmailText(title)}</p>${event.resolution?`<p>Resolution: ${escapeEmailText(event.resolution)}</p>`:''}${event.approvedAmount?`<p>Refund amount: Rs ${escapeEmailText(event.approvedAmount)}</p>`:''}${event.adminMessage?`<p>${escapeEmailText(event.adminMessage)}</p>`:''}<p><a href="${escapeEmailText(link)}">View your request in order details</a></p>`)});return;
 }
 if(job.kind==='ORDER_PLACED'||job.kind==='ORDER_STATUS'){
  if(job.kind==='ORDER_PLACED')await processOrderPlacedEffects(id);
  else await processOrderStatusEffects(id,job.idempotencyKey.slice('order-status:'.length));
  const status=job.kind==='ORDER_PLACED'?'PLACED':String(body.orderStatus);
  if(!['PLACED','CANCELLED','SHIPPED','DELIVERED'].includes(status))return;
  const order=await prisma.order.findUnique({where:{id},include:{user:{select:{name:true,email:true}},items:true}});if(!order)return;
  const history=Array.isArray(body.statusHistory)?body.statusHistory:[];
  const last=history.at(-1) as {changedAt?:string}|undefined;
  const occurredAt=last?.changedAt?new Date(last.changedAt):order.createdAt;
  await mail(job,'customer',orderEmail({...order,status,totalPrice:body.totalAmount??order.totalPrice,subtotal:body.subtotal??order.subtotal,discountAmount:body.discountAmount??order.discountAmount},status,occurredAt));return;
 }
 if(job.kind==='REFUND'){
  await processRefundNotification({id,userId:String(body.userId),orderNumber:String(body.orderNumber),cancelledBy:typeof body.cancelledBy==='string'?body.cancelledBy:null,refundStatus:typeof body.refundStatus==='string'?body.refundStatus:null,refundHistory:body.refundHistory,statusHistory:body.statusHistory});return;
 }
 if(job.kind==='WELCOME'){
  const user=await prisma.user.findFirst({where:{id,role:'CUSTOMER',isActive:true,isEmailVerified:true},select:{name:true,email:true}});
  if(user)await mail(job,'customer',welcomeEmail(user));return;
 }
 if(job.kind==='APPOINTMENT_CREATED'||job.kind==='APPOINTMENT_STATUS'){
  const appointment={...body,originalBookingDate:snapshotDate(body.originalBookingDate),bookingDate:snapshotDate(body.bookingDate)} as AppointmentEmailView;
  if(!Number.isFinite(appointment.bookingDate.getTime()))throw new Error('Invalid appointment snapshot');
  const messages=job.kind==='APPOINTMENT_CREATED'?buildAppointmentCreatedEmails(appointment):[buildAppointmentStatusEmail(appointment,snapshotDate(body.previousBookingDate))].filter((message):message is NonNullable<typeof message>=>message!==null);
  for(let i=0;i<messages.length;i++)await mail(job,i===0?'customer':'admin',messages[i]!,i===0?appointment:undefined);
  if(job.kind==='APPOINTMENT_CREATED')await prisma.notification.upsert({where:{id:job.id},create:{id:job.id,userId:null,type:'INFO',title:'New appointment request',message:`Appointment ${appointment.id}: ${appointment.firstName} requested a framing appointment.`},update:{}});
  return;
 }
 throw new Error('Unsupported delivery event');
}
