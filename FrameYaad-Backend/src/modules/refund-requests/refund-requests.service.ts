import {randomUUID,createHash} from 'node:crypto';
import {Prisma,UserRole} from '@prisma/client';
import {prisma} from '../../prisma/client';
import {supabaseAdmin} from '../../config/supabase';
import {ApiError} from '../../utils/api-error';
import {orderViewSelect} from '../orders/orders.select';
import {REFUND_LIMITS,refundEligibility,requestInput,actionInput,evidenceType,evidenceCleanupAllowed} from './refund-policy';
import {wakeDeliveryWorker} from '../../services/delivery/outbox-signal';
import {invalidateStorageMetrics} from '../photo-cleanup/storage-metrics';

export type RefundActor={id:string;role:UserRole};
type Tx=Prisma.TransactionClient;
const closed=['COMPLETED','REJECTED','WITHDRAWN'];
const bucket=()=>supabaseAdmin.storage.from('refund-evidence');
const fail=(message:string,code='REFUND_REQUEST_INVALID',status=400)=>new ApiError(status,message,code);
const staff=(actor:RefundActor)=>actor.role===UserRole.ADMIN||actor.role===UserRole.EMPLOYEE;
const include={order:{select:{...orderViewSelect,deliveredAt:true,refundedAmount:true,completedReturnRefund:true}},user:{select:{name:true,email:true,phoneNumber:true}},files:true,audit:{orderBy:{createdAt:'asc' as const}}};
const lock=async(tx:Tx,orderId:string)=>{await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`return:${orderId}`}))::text`;};
async function ownedOrder(tx:Tx,id:string,actor:RefundActor){
 const order=await tx.order.findUnique({where:{id},select:{...orderViewSelect,deliveredAt:true,refundedAmount:true,completedReturnRefund:true}});
 if(!order||(!staff(actor)&&order.userId!==actor.id))throw fail('Order was not found.','ORDER_NOT_FOUND',404);
 return order;
}
function safeView<T extends Prisma.RefundRequestGetPayload<{include:typeof include}>>(request:T,actor:RefundActor){
 if(staff(actor))return request;
 const {internalNotes:_notes,audit,files,...publicRequest}=request;void _notes;
 return {...publicRequest,files:files.map(({id,kind,sizeBytes,mimeType,originalName,uploadedAt,deletedAt})=>({id,kind,sizeBytes,mimeType,originalName,uploadedAt,deletedAt})),audit:audit.map(({action,createdAt})=>({action,createdAt}))};
}
export async function getRefundRequest(id:string,actor:RefundActor){
 const request=await prisma.refundRequest.findUnique({where:{id},include});
 if(!request||(!staff(actor)&&request.userId!==actor.id))throw fail('Refund request was not found.','REFUND_REQUEST_NOT_FOUND',404);
 return safeView(request,actor);
}
export async function orderRefundInfo(orderId:string,actor:RefundActor){
 const order=await ownedOrder(prisma,orderId,actor),requests=await prisma.refundRequest.findMany({where:{orderId,requestedAt:{not:null}},orderBy:{createdAt:'desc'},select:{id:true,status:true,refundStatus:true,resolution:true,approvedAmount:true,adminMessage:true,requestedAt:true,closedAt:true,version:true,filesDeletedAt:true}});
 const eligibility=refundEligibility(order),open=requests.some(r=>!closed.includes(r.status));
 const remaining=Prisma.Decimal.max(0,order.totalPrice.sub(order.refundedAmount));
 return {...eligibility,eligible:eligibility.eligible&&!open,message:open?'An open request already exists for this order.':remaining.lte(0)?'No refundable balance remains. Replacement requests can still be reviewed.':eligibility.message,refundedAmount:order.refundedAmount,completedRefundAmount:order.completedReturnRefund,maxRefundable:remaining,requests,limits:REFUND_LIMITS};
}
export async function createRefundDraft(orderId:string,actor:RefundActor){
 if(actor.role!==UserRole.CUSTOMER)throw fail('Only the customer can submit a request.','FORBIDDEN',403);
 return prisma.$transaction(async tx=>{
  await lock(tx,orderId);const order=await ownedOrder(tx,orderId,actor),eligibility=refundEligibility(order);
  if(!eligibility.eligible)throw fail(eligibility.message,'REFUND_INELIGIBLE');
  if(await tx.refundRequest.count({where:{orderId,requestedAt:{not:null},status:{notIn:closed}}}))throw fail('An open request already exists.','REFUND_REQUEST_EXISTS',409);
  const draft=await tx.refundRequest.findFirst({where:{orderId,userId:actor.id,requestedAt:null},orderBy:{createdAt:'desc'}});
  return draft??tx.refundRequest.create({data:{id:'RFD-'+randomUUID().replaceAll('-','').slice(0,16).toUpperCase(),orderId,userId:actor.id}});
 });
}
async function recordEvent(tx:Tx,request:Prisma.RefundRequestGetPayload<object>,actor:RefundActor,action:string,mutationKey:string,inputHash:string,previous:unknown){
 const eventId=randomUUID();
 await tx.refundRequestAudit.create({data:{id:eventId,requestId:request.id,actorId:actor.id,actorRole:actor.role,action,mutationKey,inputHash,oldValue:JSON.parse(JSON.stringify(previous)) as Prisma.InputJsonValue,newValue:JSON.parse(JSON.stringify(request)) as Prisma.InputJsonValue}});
 if(!['NOTES','EVIDENCE_DELETED'].includes(action))await tx.deliveryJob.create({data:{kind:'REFUND_REQUEST',idempotencyKey:`refund-request:${request.id}:${request.version}`,payload:{id:request.id,eventId,userId:request.userId,orderId:request.orderId,action,status:request.status,resolution:request.resolution,approvedAmount:request.approvedAmount?.toString()??null,adminMessage:request.adminMessage,refundStatus:request.refundStatus,createdAt:new Date().toISOString()}}});
}
export async function reserveEvidence(id:string,input:{name:string;mime:string;size:number},actor:RefundActor){
 const type=evidenceType(input.name,input.mime);
 if(!type||!Number.isInteger(input.size)||input.size<=0||input.size>(type.kind==='photo'?REFUND_LIMITS.photoBytes:REFUND_LIMITS.videoBytes))throw fail('Choose a supported photo up to 5 MB or video up to 30 MB.','INVALID_EVIDENCE');
 const file=await prisma.$transaction(async tx=>{
  const request=await tx.refundRequest.findUnique({where:{id}});if(!request||request.userId!==actor.id||actor.role!==UserRole.CUSTOMER)throw fail('Request was not found.','NOT_FOUND',404);
  await lock(tx,request.orderId);
  const current=await tx.refundRequest.findUniqueOrThrow({where:{id},include:{files:true}});
  if(current.requestedAt)throw fail('Evidence cannot be added after submission.');
  const eligibility=refundEligibility(await ownedOrder(tx,current.orderId,actor));if(!eligibility.eligible)throw fail(eligibility.message);
  const active=current.files.filter(f=>!f.deletedAt);
  if(active.filter(f=>f.kind===type.kind).length>=(type.kind==='photo'?REFUND_LIMITS.photoCount:REFUND_LIMITS.videoCount)||active.reduce((s,f)=>s+f.sizeBytes,0)+input.size>REFUND_LIMITS.totalBytes)throw fail('Up to five photos and one video are allowed.','EVIDENCE_LIMIT');
  const fileId=randomUUID(),name=input.name.replace(/[<>/\\]/g,'').split('').filter(char=>char.charCodeAt(0)>=32&&char.charCodeAt(0)!==127).join('').slice(0,160)||`evidence.${type.ext}`;
  if(current.filesDeletedAt)await tx.refundRequest.update({where:{id},data:{filesDeletedAt:null}});
  return tx.refundRequestFile.create({data:{id:fileId,requestId:id,storagePath:`refund/${id}/${fileId}.${type.ext}`,kind:type.kind,sizeBytes:input.size,mimeType:input.mime,originalName:name}});
 });
 const signed=await bucket().createSignedUploadUrl(file.storagePath,{upsert:false});
 if(signed.error){await prisma.refundRequestFile.update({where:{id:file.id},data:{deletedAt:new Date()}});throw fail('Upload could not start. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);}
 invalidateStorageMetrics();return {id:file.id,signedUrl:signed.data.signedUrl,kind:file.kind};
}
async function verifyEvidence(file:{storagePath:string;sizeBytes:number;mimeType:string;kind:string}){
 const info=await bucket().info(file.storagePath);const metadata=info.data as {size?:number;contentType?:string}|null;
 if(info.error){const status=Number('statusCode' in info.error?info.error.statusCode:0);if(status!==404)throw fail('Evidence storage is temporarily unavailable. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);throw fail('An evidence upload is incomplete. Remove it or retry.','EVIDENCE_UPLOAD_INCOMPLETE');}
 if(!metadata)throw fail('Evidence storage is temporarily unavailable. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);
 if(metadata.size!==file.sizeBytes||metadata.contentType!==file.mimeType)throw fail('The evidence file does not match its declared type or size.','INVALID_EVIDENCE');
 const signed=await bucket().createSignedUrl(file.storagePath,60);if(signed.error)throw fail('Evidence verification failed. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);
 const response=await fetch(signed.data.signedUrl,{headers:{Range:'bytes=0-63'},signal:AbortSignal.timeout(15000)});
 if(!response.ok||!response.body)throw fail('Evidence verification failed. Please retry.');
 const reader=response.body.getReader();let bytes=Buffer.alloc(0);while(bytes.length<64){const part=await reader.read();if(part.done)break;bytes=Buffer.concat([bytes,Buffer.from(part.value).subarray(0,64-bytes.length)]);}await reader.cancel();
 const mime=file.mimeType,match=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':mime==='video/webm'?bytes.subarray(0,4).equals(Buffer.from([26,69,223,163])):bytes.toString('ascii',4,8)==='ftyp'&&(mime.startsWith('image/')?/heic|heix|hevc|mif1|msf1/.test(bytes.toString('ascii',8)):/isom|iso[2-9]|mp4|avc1|qt {2}|M4V/.test(bytes.toString('ascii',8)));
 if(!match)throw fail('The evidence file contents do not match the selected file type.','INVALID_EVIDENCE');
}
export async function completeEvidence(id:string,fileId:string,actor:RefundActor){
 const file=await prisma.refundRequestFile.findFirst({where:{id:fileId,requestId:id,deletedAt:null,request:{userId:actor.id}}});
 if(!file||actor.role!==UserRole.CUSTOMER)throw fail('Evidence was not found.','NOT_FOUND',404);
 if(file.uploadedAt)return {id:fileId,verified:true};
 try{await verifyEvidence(file);}catch(error){if(error instanceof ApiError&&['INVALID_EVIDENCE','EVIDENCE_UPLOAD_INCOMPLETE'].includes(error.code)){const removed=await bucket().remove([file.storagePath]);if(!removed.error)await prisma.refundRequestFile.updateMany({where:{id:fileId,uploadedAt:null},data:{deletedAt:new Date()}});}throw error;}
 await prisma.refundRequestFile.update({where:{id:fileId},data:{uploadedAt:new Date()}});invalidateStorageMetrics();return {id:fileId,verified:true};
}
export async function submitRefundRequest(id:string,raw:unknown,actor:RefundActor){
 const input=requestInput.parse(raw),request=await prisma.refundRequest.findUnique({where:{id},include:{files:true}});
 if(!request||request.userId!==actor.id||actor.role!==UserRole.CUSTOMER)throw fail('Request was not found.','NOT_FOUND',404);
 if(request.requestedAt)return getRefundRequest(id,actor);
 const files=request.files.filter(f=>!f.deletedAt);await Promise.all(files.filter(file=>!file.uploadedAt).map(file=>completeEvidence(id,file.id,actor)));
 try{await prisma.$transaction(async tx=>{
  await lock(tx,request.orderId);const current=await tx.refundRequest.findUniqueOrThrow({where:{id},include:{files:true}});if(current.requestedAt)return;
  const order=await ownedOrder(tx,current.orderId,actor),eligibility=refundEligibility(order);if(!eligibility.eligible)throw fail(eligibility.message,'REFUND_INELIGIBLE');
  if(input.affectedItemIds.some(itemId=>!order.items.some(item=>item.id===itemId)))throw fail('An affected item does not belong to this order.');
  if(current.files.filter(f=>!f.deletedAt).map(f=>f.id).sort().join()!==files.map(f=>f.id).sort().join())throw fail('Evidence changed. Please wait for uploads and submit again.','REFUND_CONFLICT',409);
  if(await tx.refundRequest.count({where:{orderId:current.orderId,requestedAt:{not:null},status:{notIn:closed}}}))throw fail('An open request already exists.','REFUND_REQUEST_EXISTS',409);
  const updated=await tx.refundRequest.update({where:{id},data:{...input,requestedAt:new Date(),version:{increment:1}}});
  await tx.refundRequestFile.updateMany({where:{id:{in:files.map(f=>f.id)}},data:{uploadedAt:new Date()}});
  await recordEvent(tx,updated,actor,'REQUESTED',randomUUID(),'submit',current);
 },{timeout:15000});}catch(error){if(error instanceof Prisma.PrismaClientKnownRequestError&&error.code==='P2002')throw fail('An open request already exists.','REFUND_REQUEST_EXISTS',409);throw error;}
 wakeDeliveryWorker();return getRefundRequest(id,actor);
}

export async function changeRefundRequest(id:string,raw:unknown,actor:RefundActor){
 const input=actionInput.parse(raw),inputHash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 await prisma.$transaction(async tx=>{
  const found=await tx.refundRequest.findUnique({where:{id}});
  if(!found||(!staff(actor)&&found.userId!==actor.id))throw fail('Request was not found.','NOT_FOUND',404);
  if(!staff(actor)&&input.action!=='WITHDRAW')throw fail('You do not have permission for this action.','FORBIDDEN',403);
  await lock(tx,found.orderId);
  const current=await tx.refundRequest.findUniqueOrThrow({where:{id}}),previous=await tx.refundRequestAudit.findUnique({where:{requestId_mutationKey:{requestId:id,mutationKey:input.mutationKey}}});
  if(previous){if(previous.inputHash!==inputHash||previous.actorId!==actor.id)throw fail('This action key was already used for a different update.','REFUND_CONFLICT',409);return;}
  if(!current.requestedAt)throw fail('This request has not been submitted.');
  if(current.version!==input.version)throw fail('This request changed. Refresh it before trying again.','REFUND_CONFLICT',409);
  const order=await ownedOrder(tx,current.orderId,actor),now=new Date();
  const changes:Prisma.RefundRequestUpdateInput={version:{increment:1},...(input.adminMessage===undefined?{}:{adminMessage:input.adminMessage}),...(staff(actor)&&input.internalNotes!==undefined?{internalNotes:input.internalNotes}:{})};
  const remaining=Prisma.Decimal.max(0,order.totalPrice.sub(order.refundedAmount));
  const invalid=()=>{throw fail('This action is not available in the current request status.','INVALID_REFUND_TRANSITION');};
  switch(input.action){
   case 'UNDER_REVIEW':if(current.status!=='REQUESTED')invalid();changes.status='UNDER_REVIEW';changes.reviewedAt=now;break;
   case 'APPROVE':{
    if(!['REQUESTED','UNDER_REVIEW'].includes(current.status))invalid();
    const resolution=input.resolution??current.preferredResolution;changes.status='APPROVED';changes.resolution=resolution;changes.reviewedAt=now;
    if(resolution==='REFUND'){
     const amount=new Prisma.Decimal(input.approvedAmount??remaining);
     if(amount.lte(0)||amount.decimalPlaces()>2||amount.gt(remaining))throw fail(`Max refundable: Rs ${remaining.toFixed(2)}. Enter an amount within the remaining paid balance.`,'REFUND_AMOUNT_EXCEEDED');
     changes.approvedAmount=amount;
    }else changes.approvedAmount=null;
    break;
   }
   case 'REJECT':if(!['REQUESTED','UNDER_REVIEW'].includes(current.status))invalid();if(!input.adminMessage?.trim())throw fail('Please provide a message explaining the rejection.');changes.status='REJECTED';changes.closedAt=now;changes.reviewedAt=now;break;
   case 'WITHDRAW':if(!['REQUESTED','UNDER_REVIEW'].includes(current.status))invalid();changes.status='WITHDRAWN';changes.closedAt=now;delete changes.adminMessage;break;
   case 'INITIATED':{
    if(current.status!=='APPROVED'||current.resolution!=='REFUND'||current.refundStatus!==null||!current.approvedAmount)invalid();
    const amount=current.approvedAmount!;
    if(amount.gt(remaining))throw fail(`Max refundable: Rs ${remaining.toFixed(2)}. The remaining paid balance has changed.`,'REFUND_AMOUNT_EXCEEDED');
    changes.refundStatus='INITIATED';await tx.order.update({where:{id:order.id},data:{refundedAmount:{increment:amount}}});break;
   }
   case 'COMPLETED':if(current.status!=='APPROVED'||current.resolution!=='REFUND'||current.refundStatus!=='INITIATED'||!current.approvedAmount)invalid();changes.refundStatus='COMPLETED';changes.status='COMPLETED';changes.closedAt=now;await tx.order.update({where:{id:order.id},data:{completedReturnRefund:{increment:current.approvedAmount!}}});break;
   case 'REPLACEMENT_DISPATCHED':if(current.status!=='APPROVED'||current.resolution!=='REPLACEMENT')invalid();changes.status='COMPLETED';changes.closedAt=now;break;
   case 'NOTES':delete changes.adminMessage;break;
  }
  const updated=await tx.refundRequest.update({where:{id},data:changes});await recordEvent(tx,updated,actor,input.action,input.mutationKey,inputHash,current);
 },{timeout:15000});
 wakeDeliveryWorker();return getRefundRequest(id,actor);
}

export async function listRefundRequests(query:{page:number;limit:number;status?:string;search?:string;from?:Date;to?:Date;evidence?:boolean},actor:RefundActor){
 if(!staff(actor))throw fail('You do not have permission for this action.','FORBIDDEN',403);
 const search=query.search?.trim();
 const base:Prisma.RefundRequestWhereInput={...(query.evidence?{files:{some:{deletedAt:null}}}:{requestedAt:{not:null}}),...(search?{OR:[{id:{contains:search,mode:'insensitive'}},{order:{orderNumber:{contains:search,mode:'insensitive'}}},{user:{OR:[{name:{contains:search,mode:'insensitive'}},{email:{contains:search,mode:'insensitive'}},{phoneNumber:{contains:search}}]}}]}:{}),...(query.from||query.to?{createdAt:{gte:query.from,lte:query.to}}:{})};
 const where={...base,...(query.status?{status:query.status}:{})};
 const [requests,total,groups]=await Promise.all([prisma.refundRequest.findMany({where,orderBy:[{createdAt:'desc'},{id:'asc'}],skip:(query.page-1)*query.limit,take:query.limit,include:{order:{select:{orderNumber:true,totalPrice:true,deliveredAt:true}},user:{select:{name:true,email:true,phoneNumber:true}},files:{select:{id:true,kind:true,sizeBytes:true,uploadedAt:true,deletedAt:true}}}}),prisma.refundRequest.count({where}),prisma.refundRequest.groupBy({by:['status'],where:base,_count:{_all:true}})]);
 return {requests,pagination:{page:query.page,limit:query.limit,total,totalPages:Math.max(1,Math.ceil(total/query.limit))},summary:Object.fromEntries(groups.map(g=>[g.status,g._count._all]))};
}
export async function deleteRefundEvidence(id:string,actor:RefundActor,options:{fileId?:string;confirmOpen?:boolean}={}){
 const request=await prisma.refundRequest.findUnique({where:{id}});
 if(!request||(!staff(actor)&&request.userId!==actor.id))throw fail('Request was not found.','NOT_FOUND',404);
 if(!staff(actor)&&(request.requestedAt||!options.fileId))throw fail('Only draft evidence can be removed by its owner.','FORBIDDEN',403);
 if(staff(actor)&&!evidenceCleanupAllowed(request)&&!options.confirmOpen)throw fail('This request is awaiting review or is an unsubmitted draft. Confirm the warning before deleting its evidence.','OPEN_EVIDENCE_CONFIRMATION_REQUIRED');
 const result=await prisma.$transaction(async tx=>{
  await lock(tx,request.orderId);const current=await tx.refundRequest.findUniqueOrThrow({where:{id}});
  if(!staff(actor)&&current.requestedAt)throw fail('Evidence cannot be removed after submission.');
  if(staff(actor)&&!evidenceCleanupAllowed(current)&&!options.confirmOpen)throw fail('This request is still awaiting review or is unsubmitted.');
  const files=await tx.refundRequestFile.findMany({where:{requestId:id,deletedAt:null,...(options.fileId?{id:options.fileId}:{})}});
  if(!files.length&&current.filesDeletedAt)return {deletedCount:0,bytesFreed:0};
  if(files.length){const removed=await bucket().remove(files.map(f=>f.storagePath));if(removed.error)throw fail('Evidence could not be deleted. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);}
  const now=new Date();await tx.refundRequestFile.updateMany({where:{id:{in:files.map(f=>f.id)}},data:{deletedAt:now}});
  if(staff(actor)){const updated=await tx.refundRequest.update({where:{id},data:{filesDeletedAt:now,version:{increment:1}}});await recordEvent(tx,updated,actor,'EVIDENCE_DELETED',randomUUID(),'manual-delete',current);}
  return {deletedCount:files.length,bytesFreed:files.reduce((s,f)=>s+f.sizeBytes,0)};
 },{timeout:30000});invalidateStorageMetrics();return result;
}
export async function readRefundEvidence(id:string,fileId:string,download:boolean,actor:RefundActor){
 if(!staff(actor))throw fail('You do not have permission to view evidence.','FORBIDDEN',403);
 const file=await prisma.refundRequestFile.findFirst({where:{id:fileId,requestId:id,uploadedAt:{not:null},deletedAt:null}});
 if(!file)throw fail('Evidence is unavailable or has been deleted.','EVIDENCE_NOT_FOUND',404);
 const result=await bucket().createSignedUrl(file.storagePath,REFUND_LIMITS.signedReadSeconds,download?{download:file.originalName}:undefined);
 if(result.error)throw fail('Evidence could not be opened. Please retry.','EVIDENCE_STORAGE_UNAVAILABLE',503);
 return {url:result.data.signedUrl,expiresIn:REFUND_LIMITS.signedReadSeconds};
}
