import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/prisma/client';
import { createAppointment,updateAppointmentStatus } from '../src/modules/appointment/appointment.service';
import { updateOrderStatus } from '../src/modules/orders/orders.service';
import {updateRefund} from '../src/modules/orders/order-refunds';
import { claimDeliveryJob,runDeliveryJob } from '../src/services/delivery/outbox-worker';
import { reconcileProviderDelivery } from '../src/services/delivery/resend-webhook';

// Dedicated dev only. Every email uses an injected transport; no external send.
const customer=randomUUID(),staff=randomUUID(),address=randomUUID(),orderId=randomUUID(),rollbackOrder=randomUUID();
const appointmentIds:string[]=[],prefixes:string[]=[`welcome:${customer}`,`order-placed:${orderId}`],jobIds:string[]=[],providerIds:string[]=[];
let calls=0;
async function snapshot(){const [orders,revenue,stock]=await Promise.all([prisma.order.count(),prisma.order.aggregate({where:{status:{not:'CANCELLED'}},_sum:{totalPrice:true}}),prisma.variant.aggregate({_sum:{stockQuantity:true}})]);return {orders,revenue:revenue._sum.totalPrice?.toString()??'0',stock:stock._sum.stockQuantity??0};}
let baseline:Awaited<ReturnType<typeof snapshot>>|undefined;
const transport=async()=>{calls++;const id=randomUUID();providerIds.push(id);return {id};};
async function processKey(key:string){
 const pending=await prisma.deliveryJob.findUniqueOrThrow({where:{idempotencyKey:key}});jobIds.push(pending.id);
 const claimed=await claimDeliveryJob(true,pending.id);assert(claimed);await runDeliveryJob(claimed,transport);
 const result=await prisma.deliveryJob.findUniqueOrThrow({where:{id:pending.id}});assert.equal(result.state,'SENT');return result;
}
async function processChildren(key:string){
 const jobs=await prisma.deliveryJob.findMany({where:{kind:'EMAIL',idempotencyKey:{startsWith:key+':'}}});assert(jobs.length>=1);
 for(const job of jobs){jobIds.push(job.id);const claimed=await claimDeliveryJob(true,job.id);assert(claimed);await runDeliveryJob(claimed,transport);}
 return jobs;
}
async function main(){
 baseline=await snapshot();
 console.log(JSON.stringify({dummyManifest:{customer,staff,address,orderId,rollbackOrder}}));
 if(process.env.OUTBOX_VERIFY_CANCEL_ONLY==='true'){await cancellationCheck();return;}
 await prisma.user.createMany({data:[{id:customer,name:'Dummy Test Order',email:`outbox-${customer}@example.invalid`,role:'CUSTOMER',isEmailVerified:false},{id:staff,name:'Dummy Delivery Test Employee',email:`outbox-${staff}@example.invalid`,role:'EMPLOYEE',isEmailVerified:true}]});
 assert.equal(await prisma.deliveryJob.count({where:{idempotencyKey:`welcome:${customer}`}}),0);
 await prisma.user.update({where:{id:customer},data:{isEmailVerified:true}});await prisma.user.update({where:{id:customer},data:{isEmailVerified:true}});
 assert.equal(await prisma.deliveryJob.count({where:{idempotencyKey:`welcome:${customer}`}}),1);await processKey(`welcome:${customer}`);await processChildren(`welcome:${customer}`);
 await prisma.userAddress.create({data:{id:address,userId:customer,addressLine:'Dummy test address',postalCode:'624001',city:'Test',state:'Tamil Nadu',country:'India',contactPerson:'Dummy Test Order',contactNumber:'9000000000'}});
 const orderData={userId:customer,userAddressId:address,totalPrice:900,subtotal:1000,discountAmount:100,discountPercent:10,couponTitle:'Dummy snapshot',couponCode:'NEW_YEAR',paymentMethod:'COD'};
 const rollback=new Error('expected rollback');
 try{await prisma.$transaction(async tx=>{await tx.order.create({data:{...orderData,id:rollbackOrder,orderNumber:'FY-DUMMY-'+randomUUID().slice(0,8)}});throw rollback;});}catch(error){if(error!==rollback)throw error;}
 assert.equal(await prisma.order.count({where:{id:rollbackOrder}}),0);assert.equal(await prisma.deliveryJob.count({where:{idempotencyKey:`order-placed:${rollbackOrder}`}}),0);
 await prisma.order.create({data:{...orderData,id:orderId,orderNumber:'FY-DUMMY-'+randomUUID().slice(0,8),items:{create:{snapshotProductName:'Dummy Test Frame',snapshotFrameSize:'8 x 10',quantity:1,price:1000,subtotal:1000}}}});
 const parent=await prisma.deliveryJob.findUniqueOrThrow({where:{idempotencyKey:`order-placed:${orderId}`}});jobIds.push(parent.id);
 const claims=await Promise.all([claimDeliveryJob(true,parent.id),claimDeliveryJob(true,parent.id)]);assert.equal(claims.filter(Boolean).length,1);await runDeliveryJob(claims.find(Boolean)!,transport);
 const email=await prisma.deliveryJob.findUniqueOrThrow({where:{idempotencyKey:`order-placed:${orderId}:customer`}});jobIds.push(email.id);
 assert(JSON.stringify(email.payload).includes('900.00'),'Final discounted total in email');
 const first=await claimDeliveryJob(true,email.id);assert(first);await runDeliveryJob(first,async()=>{throw new Error('SimulatedResendFailure');});
 let state=await prisma.deliveryJob.findUniqueOrThrow({where:{id:email.id}});assert.equal(state.state,'PENDING');assert.equal(state.attempts,1);assert(state.availableAt.getTime()>Date.now());assert(await prisma.order.findUnique({where:{id:orderId}}));
 await prisma.deliveryJob.update({where:{id:email.id},data:{availableAt:new Date(0)}});const retry=await claimDeliveryJob(true,email.id);assert(retry);await runDeliveryJob(retry,transport);state=await prisma.deliveryJob.findUniqueOrThrow({where:{id:email.id}});assert.equal(state.state,'SENT');assert.equal(state.attempts,2);
 await prisma.emailDeliveryEvent.create({data:{id:'dummy-'+email.id,providerMessageId:state.providerMessageId!,type:'email.delivered',occurredAt:new Date()}});await reconcileProviderDelivery(state.providerMessageId!);assert((await prisma.deliveryJob.findUniqueOrThrow({where:{id:email.id}})).deliveredAt);
 for(const status of ['PROCESSING','READY_TO_SHIP','SHIPPED','DELIVERED'] as const){
  const order=await updateOrderStatus(orderId,{status},{id:staff,role:'EMPLOYEE'}),history=order.statusHistory as Array<{eventId:string}>;const event=history.at(-1)!.eventId;
  const key='order-status:'+event;prefixes.push(key);await processKey(key);if(status==='SHIPPED'||status==='DELIVERED')await processChildren(key);
 }
 // Guest-style appointment retains old/new snapshots and never waits for Resend.
 const date=new Date(Date.now()+3*86400000);
 const appointment=await createAppointment({firstName:'Dummy Test Appointment',email:`booking-${customer}@example.invalid`,phoneNumber:'9000000000',bookingDate:date,location:'ODDANCHATRAM',frameTypes:['PHOTOGRAPHS']});appointmentIds.push(appointment.id);
 assert.equal(appointment.emailStatus,'PENDING');let key='appointment-created:'+appointment.id;prefixes.push(key);await processKey(key);await processChildren(key);
 for(const status of ['CONFIRMED','RESCHEDULED','CANCELLED'] as const){
  const updated=await updateAppointmentStatus(appointment.id,status==='RESCHEDULED'?{status,bookingDate:new Date(date.getTime()+86400000),rescheduleReason:'Dummy test reschedule'}:status==='CANCELLED'?{status,cancellationReason:'Dummy test cancellation'}:{status});
  assert.equal(updated.originalBookingDate.getTime(),date.getTime());
  const event=await prisma.deliveryJob.findFirstOrThrow({where:{kind:'APPOINTMENT_STATUS',payload:{path:['id'],equals:appointment.id}},orderBy:{sequence:'desc'}});key=event.idempotencyKey;prefixes.push(key);await processKey(key);const jobs=await processChildren(key);
  if(status==='RESCHEDULED'){const body=JSON.stringify(jobs[0]!.payload);assert(body.includes('Previous date:')&&body.includes('New date:'));}
  if(status==='CONFIRMED')await assert.rejects(()=>updateAppointmentStatus(appointment.id,{status:'CONFIRMED'}));
 }
 const recover=await prisma.deliveryJob.create({data:{kind:'EMAIL',idempotencyKey:'dummy-restart:'+customer,payload:{message:{to:`test-${customer}@example.invalid`,subject:'Dummy recovery',html:'Dummy'}},state:'PROCESSING',lockToken:'old-worker',lockedAt:new Date(Date.now()-180000),firstAttemptAt:new Date(),attempts:1}});jobIds.push(recover.id);
 const recovered=await claimDeliveryJob(true,recover.id);assert(recovered&&recovered.lockToken!=='old-worker');await runDeliveryJob(recovered,transport);
 console.log(JSON.stringify({transactionRollback:true,verifiedWelcomeOnce:true,exclusiveLeaseClaim:true,retryAfterFailure:true,businessSavedDuringFailure:true,providerEventReconciled:true,orderPlacedShippedDelivered:true,appointmentAllFour:true,repeatedActionRejected:true,restartLeaseRecovered:true,mockEmailAcceptances:calls,noRealEmails:true}));
}
async function cancellationCheck(){
 await prisma.user.createMany({data:[{id:customer,name:'Dummy Test Order',email:`outbox-${customer}@example.invalid`,role:'CUSTOMER',isEmailVerified:false},{id:staff,name:'Dummy Delivery Test Employee',email:`outbox-${staff}@example.invalid`,role:'EMPLOYEE',isEmailVerified:true}]});
 await prisma.userAddress.create({data:{id:address,userId:customer,addressLine:'Dummy test address',postalCode:'624001',city:'Test',state:'Tamil Nadu',country:'India',contactPerson:'Dummy Test Order',contactNumber:'9000000000'}});
 await prisma.order.create({data:{id:orderId,userId:customer,userAddressId:address,orderNumber:'FY-DUMMY-'+randomUUID().slice(0,8),totalPrice:900,subtotal:1000,discountAmount:100,paymentMethod:'COD',items:{create:{snapshotProductName:'Dummy Test Frame',quantity:1,price:1000,subtotal:1000}}}});
 await processKey('order-placed:'+orderId);await processChildren('order-placed:'+orderId);
 const cancelled=await updateOrderStatus(orderId,{status:'CANCELLED'},{id:customer,role:'CUSTOMER'}),history=cancelled.statusHistory as Array<{eventId:string}>,eventId=history.at(-1)!.eventId;
 const key='order-status:'+eventId;prefixes.push(key);await processKey(key);await processChildren(key);
 await updateOrderStatus(orderId,{status:'CANCELLED'},{id:customer,role:'CUSTOMER'});
 assert.equal(await prisma.deliveryJob.count({where:{idempotencyKey:key}}),1);
 assert.equal(await prisma.customerNotification.count({where:{id:eventId,userId:customer,type:'ORDER_CANCELLED'}}),1);
 // Shared cancellation row is keyed by the business event, not the outbox job.
 jobIds.push(eventId);
 for(const status of ['INITIATED','COMPLETED'] as const){
  const refunded=await updateRefund(orderId,status==='INITIATED'?{status,expectedRefundStatus:null}:{status,expectedRefundStatus:'INITIATED',confirmCompleted:true},{id:staff,role:'EMPLOYEE'}),events=refunded.refundHistory as Array<{eventId:string}>;
  const refundId=events.at(-1)!.eventId,refundKey='refund:'+refundId;prefixes.push(refundKey);await processKey(refundKey);
  assert.equal(await prisma.customerNotification.count({where:{id:refundId,userId:customer}}),1);
 }
 console.log(JSON.stringify({orderCancelledEmail:true,repeatedCancelJobCount:1,cancellationNotificationOnce:true,refundInitiatedAndCompleted:true,noRealEmails:true,mockEmailAcceptances:calls}));
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Outbox verification failed');process.exitCode=1;}).finally(async()=>{
 const parents=await prisma.deliveryJob.findMany({where:{OR:[...prefixes.map(key=>({idempotencyKey:{startsWith:key}})),...appointmentIds.map(id=>({payload:{path:['id'],equals:id}}))]},select:{id:true}});jobIds.push(...parents.map(job=>job.id));
 await prisma.emailDeliveryEvent.deleteMany({where:{OR:[{providerMessageId:{in:providerIds}},{id:{in:jobIds.map(id=>'dummy-'+id)}}]}});
 await prisma.deliveryJob.deleteMany({where:{id:{in:jobIds}}});
 await prisma.notification.deleteMany({where:{id:{in:[orderId,...jobIds]}}});
 await prisma.customerNotification.deleteMany({where:{userId:customer}});
 await prisma.orderItem.deleteMany({where:{orderId:{in:[orderId,rollbackOrder]}}});
 await prisma.order.deleteMany({where:{id:{in:[orderId,rollbackOrder]}}});await prisma.appointment.deleteMany({where:{id:{in:appointmentIds}}});
 await prisma.userAddress.deleteMany({where:{id:address}});await prisma.user.deleteMany({where:{id:{in:[customer,staff]}}});
 console.log(JSON.stringify({remainingDummyOrders:await prisma.order.count({where:{id:orderId}}),remainingDummyAppointments:await prisma.appointment.count({where:{id:{in:appointmentIds}}}),remainingDummyJobs:await prisma.deliveryJob.count({where:{id:{in:jobIds}}}),stockUntouched:true}));
 if(baseline){const after=await snapshot();assert.deepEqual(after,baseline);console.log(JSON.stringify({baselineRestored:true,before:baseline,after}));}await prisma.$disconnect();
});
