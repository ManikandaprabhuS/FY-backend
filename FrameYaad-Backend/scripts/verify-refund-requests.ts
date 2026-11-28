import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Prisma,UserRole} from '@prisma/client';
import {prisma} from '../src/prisma/client';
import * as returns from '../src/modules/refund-requests/refund-requests.service';
import {supabaseAdmin} from '../src/config/supabase';
import {revenueSummary} from '../src/modules/orders/revenue';
import {claimDeliveryJob,runDeliveryJob} from '../src/services/delivery/outbox-worker';
import {EmailDeliveryError} from '../src/services/email.service';
if(process.env.CONFIRM_DEV_DATABASE!=='true')throw new Error('Explicit dedicated dev database confirmation is required.');
const userId=randomUUID(),otherId=randomUUID(),staffId=randomUUID(),addressId=randomUUID(),orderId=randomUUID(),ineligibleId=randomUUID();
const customer={id:userId,role:UserRole.CUSTOMER},employee={id:staffId,role:UserRole.EMPLOYEE},requestIds:string[]=[],eventIds:string[]=[],jobs:string[]=[],messages:Array<{subject:string;html:string}>=[];
const failCode=(code:string)=>(error:unknown)=>(error as {code:string}).code===code;
async function snapshot(){return {orders:await prisma.order.count(),stock:(await prisma.variant.aggregate({_sum:{stockQuantity:true}}))._sum.stockQuantity,revenue:String((await prisma.order.aggregate({where:{status:{not:'CANCELLED'}},_sum:{totalPrice:true}}))._sum.totalPrice),requests:await prisma.refundRequest.count()};}
async function draft(){const value=await returns.createRefundDraft(orderId,customer);requestIds.push(value.id);return value.id;}
async function submit(id:string){return returns.submitRefundRequest(id,{reasonCategory:'Damaged',reasonDetails:'Dummy Test Order: frame arrived damaged.',preferredResolution:'REFUND',affectedItemIds:[]},customer);}
async function action(id:string,kind:string,extra:Record<string,unknown>={}){const current=await prisma.refundRequest.findUniqueOrThrow({where:{id}});return returns.changeRefundRequest(id,{version:current.version,mutationKey:randomUUID(),action:kind,...extra},employee);}
async function main(){const before=await snapshot();try{
 await prisma.user.createMany({data:[{id:userId,name:'Dummy Test Order',email:`refund-${userId}@example.invalid`,role:'CUSTOMER',isEmailVerified:false},{id:otherId,name:'Dummy Refund Other',email:`refund-${otherId}@example.invalid`,role:'CUSTOMER',isEmailVerified:false},{id:staffId,name:'Dummy Refund Employee',email:`refund-${staffId}@example.invalid`,role:'EMPLOYEE',isEmailVerified:false}]});
 await prisma.userAddress.create({data:{id:addressId,userId,addressLine:'12 Dummy Test Road',postalCode:'600040',city:'Chennai',state:'Tamil Nadu',country:'India',contactPerson:'Dummy Test Order',contactNumber:'9000000000'}});
 for(const [id,status,deliveredAt]of [[orderId,'DELIVERED',new Date()],[ineligibleId,'PROCESSING',null]] as const)await prisma.order.create({data:{id,userId,userAddressId:addressId,orderNumber:'FY-DUMMY-'+randomUUID().slice(0,8),status,deliveredAt,totalPrice:1200,subtotal:1500,discountAmount:300,paymentMethod:'COD',items:{create:{snapshotProductName:'Dummy Test Order Frame',quantity:1,price:1500,subtotal:1500}}}});
 await assert.rejects(returns.createRefundDraft(ineligibleId,customer),failCode('REFUND_INELIGIBLE'));
 await prisma.order.update({where:{id:ineligibleId},data:{status:'DELIVERED',deliveredAt:new Date(Date.now()-49*3600000),statusHistory:[{status:'DELIVERED',eventId:randomUUID(),changedAt:new Date().toISOString(),changedBy:employee}]}});
 await assert.rejects(returns.createRefundDraft(ineligibleId,customer),failCode('REFUND_INELIGIBLE'));
 await assert.rejects(returns.createRefundDraft(orderId,{id:otherId,role:UserRole.CUSTOMER}),failCode('ORDER_NOT_FOUND'));
 const first=await draft();
 await assert.rejects(returns.reserveEvidence(first,{name:'big.png',mime:'image/png',size:5*1048576+1},customer),failCode('INVALID_EVIDENCE'));
 await assert.rejects(returns.reserveEvidence(first,{name:'file.png',mime:'text/html',size:12},customer),failCode('INVALID_EVIDENCE'));
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS2sAAAAASUVORK5CYII=','base64');
 const signed=await returns.reserveEvidence(first,{name:'Dummy-refund.png',mime:'image/png',size:png.length},customer);
 const uploaded=await fetch(signed.signedUrl,{method:'PUT',headers:{'Content-Type':'image/png'},body:png});assert(uploaded.ok,'Signed evidence upload HTTP '+uploaded.status);
 await returns.completeEvidence(first,signed.id,customer);
 const fileReservations:string[]=[];for(let i=0;i<4;i++)fileReservations.push((await returns.reserveEvidence(first,{name:`pending-${i}.png`,mime:'image/png',size:10},customer)).id);
 await assert.rejects(returns.reserveEvidence(first,{name:'sixth.png',mime:'image/png',size:10},customer),failCode('EVIDENCE_LIMIT'));
 for(const fileId of fileReservations)await returns.deleteRefundEvidence(first,customer,{fileId});
 const failed=await returns.reserveEvidence(first,{name:'failed.png',mime:'image/png',size:10},customer);await assert.rejects(returns.completeEvidence(first,failed.id,customer),failCode('EVIDENCE_UPLOAD_INCOMPLETE'));
 await submit(first);await assert.rejects(returns.createRefundDraft(orderId,customer),failCode('REFUND_REQUEST_EXISTS'));
 await assert.rejects(returns.getRefundRequest(first,{id:otherId,role:UserRole.CUSTOMER}),failCode('REFUND_REQUEST_NOT_FOUND'));
 await assert.rejects(returns.readRefundEvidence(first,signed.id,false,customer),failCode('FORBIDDEN'));
 const view=await returns.readRefundEvidence(first,signed.id,false,employee);assert.equal((await fetch(view.url)).status,200);
 const path=(await prisma.refundRequestFile.findUniqueOrThrow({where:{id:signed.id}})).storagePath;
 const expiry=await supabaseAdmin.storage.from('refund-evidence').createSignedUrl(path,1);assert(!expiry.error);await new Promise(resolve=>setTimeout(resolve,2100));assert((await fetch(expiry.data!.signedUrl)).status>=400,'Expired test storage URL should fail');
 await action(first,'UNDER_REVIEW');await action(first,'APPROVE',{resolution:'REFUND',approvedAmount:400,adminMessage:'Dummy partial refund approved.'});
 const current=await prisma.refundRequest.findUniqueOrThrow({where:{id:first}}),init={version:current.version,mutationKey:randomUUID(),action:'INITIATED'};
 await Promise.all([returns.changeRefundRequest(first,init,employee),returns.changeRefundRequest(first,init,employee)]);
 let order=await prisma.order.findUniqueOrThrow({where:{id:orderId}});assert.equal(Number(order.refundedAmount),400);assert.equal(Number(order.completedReturnRefund),0);assert.equal(revenueSummary([order]).totalRevenue,1200);
 const initiated=await prisma.refundRequest.findUniqueOrThrow({where:{id:first}}),complete={version:initiated.version,mutationKey:randomUUID(),action:'COMPLETED'};
 await Promise.all([returns.changeRefundRequest(first,complete,employee),returns.changeRefundRequest(first,complete,employee)]);
 order=await prisma.order.findUniqueOrThrow({where:{id:orderId}});assert.equal(Number(order.completedReturnRefund),400);assert.equal(revenueSummary([order]).totalRevenue,800);
 await returns.deleteRefundEvidence(first,employee);assert((await prisma.refundRequest.findUniqueOrThrow({where:{id:first}})).filesDeletedAt);await assert.rejects(returns.readRefundEvidence(first,signed.id,false,employee),failCode('EVIDENCE_NOT_FOUND'));
 const replacement=await draft();await submit(replacement);await action(replacement,'APPROVE',{resolution:'REPLACEMENT',adminMessage:'Dummy replacement approved.'});await action(replacement,'REPLACEMENT_DISPATCHED');
 const rejected=await draft();await submit(rejected);await action(rejected,'REJECT',{adminMessage:'Dummy rejection for test coverage.'});
 const withdrawn=await draft();const submitted=await submit(withdrawn);await returns.changeRefundRequest(withdrawn,{version:submitted.version,mutationKey:randomUUID(),action:'WITHDRAW'},customer);
 const second=await draft();await submit(second);await assert.rejects(action(second,'APPROVE',{resolution:'REFUND',approvedAmount:801}),failCode('REFUND_AMOUNT_EXCEEDED'));
 const pending=await prisma.refundRequest.findUniqueOrThrow({where:{id:second}}),updates=await Promise.allSettled([returns.changeRefundRequest(second,{version:pending.version,mutationKey:randomUUID(),action:'APPROVE',resolution:'REFUND',approvedAmount:800},employee),returns.changeRefundRequest(second,{version:pending.version,mutationKey:randomUUID(),action:'APPROVE',resolution:'REFUND',approvedAmount:800},{id:staffId,role:UserRole.ADMIN})]);assert.equal(updates.filter(r=>r.status==='fulfilled').length,1);
 await action(second,'INITIATED');await action(second,'COMPLETED');order=await prisma.order.findUniqueOrThrow({where:{id:orderId}});assert.equal(Number(order.refundedAmount),1200);assert.equal(Number(order.completedReturnRefund),1200);assert.equal(revenueSummary([order]).totalRevenue,0);
 const events=await prisma.deliveryJob.findMany({where:{kind:'REFUND_REQUEST',idempotencyKey:{startsWith:'refund-request:'},OR:requestIds.map(id=>({payload:{path:['id'],equals:id}}))},orderBy:{sequence:'asc'}});
 for(const event of events){jobs.push(event.id);const job=await claimDeliveryJob(true,event.id);assert(job);await runDeliveryJob(job,async()=>{throw new Error('Parent events must not send directly.');});assert.equal((await prisma.deliveryJob.findUniqueOrThrow({where:{id:event.id}})).state,'SENT');}
 const emails=await prisma.deliveryJob.findMany({where:{kind:'EMAIL',OR:requestIds.map(id=>({idempotencyKey:{startsWith:'refund-request:'+id+':'}}))}});
 for(const [index,email]of emails.entries()){jobs.push(email.id);let job=await claimDeliveryJob(true,email.id);assert(job);if(index===0){await runDeliveryJob(job,async()=>{throw new EmailDeliveryError(503);});assert.equal((await prisma.deliveryJob.findUniqueOrThrow({where:{id:email.id}})).state,'PENDING');assert.equal(Number((await prisma.order.findUniqueOrThrow({where:{id:orderId}})).completedReturnRefund),1200);await prisma.deliveryJob.update({where:{id:email.id},data:{availableAt:new Date()}});job=await claimDeliveryJob(true,email.id);assert(job);}await runDeliveryJob(job,async message=>{messages.push(message);return {id:randomUUID()};});}
 assert(messages.some(m=>m.subject.includes('Refund completed')));assert(messages.some(m=>m.subject.includes('Replacement dispatched')));assert.equal(await prisma.customerNotification.count({where:{userId}}),events.length);
 console.log(JSON.stringify({eligibility:true,ownerIsolation:true,privateSignedUpload:true,signedStaffRead:true,manualStorageDeletion:true,partialRefund400:{reserved:400,completedRevenue:800},cumulativeCap1200:true,concurrentApprovalsOne:true,idempotentInitiateAndComplete:true,replacementRejectedWithdrawn:true,stockUntouched:true,capturedEmails:messages.length,realEmails:0}));
 }finally{
 const rows=await prisma.refundRequest.findMany({where:{userId},select:{id:true}});requestIds.push(...rows.map(r=>r.id));
 const files=await prisma.refundRequestFile.findMany({where:{requestId:{in:requestIds}},select:{storagePath:true}});if(files.length){const removed=await supabaseAdmin.storage.from('refund-evidence').remove(files.map(f=>f.storagePath));if(removed.error)throw new Error('Dummy evidence storage cleanup failed; keep manifest.');}
 const audit=await prisma.refundRequestAudit.findMany({where:{requestId:{in:requestIds}},select:{id:true}});eventIds.push(...audit.map(a=>a.id));
 await prisma.deliveryJob.deleteMany({where:{OR:[{id:{in:jobs}},{payload:{path:['id'],equals:orderId}},{payload:{path:['id'],equals:ineligibleId}},...requestIds.map(id=>({idempotencyKey:{contains:id}})),{idempotencyKey:{contains:orderId}},{idempotencyKey:{contains:ineligibleId}},{idempotencyKey:{contains:userId}}]}});
 await prisma.notification.deleteMany({where:{id:{in:[...eventIds,orderId,ineligibleId]}}});await prisma.customerNotification.deleteMany({where:{userId}});
 await prisma.refundRequestAudit.deleteMany({where:{requestId:{in:requestIds}}});await prisma.refundRequestFile.deleteMany({where:{requestId:{in:requestIds}}});await prisma.refundRequest.deleteMany({where:{userId}});
 await prisma.orderItem.deleteMany({where:{orderId:{in:[orderId,ineligibleId]}}});await prisma.order.deleteMany({where:{id:{in:[orderId,ineligibleId]}}});await prisma.userAddress.deleteMany({where:{id:addressId}});await prisma.user.deleteMany({where:{id:{in:[userId,otherId,staffId]}}});
 const after=await snapshot();assert.deepEqual(after,before);console.log(JSON.stringify({cleanupVerified:true,before,after}));await prisma.$disconnect();
 }}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Refund verification failed');process.exitCode=1;});
