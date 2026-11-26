import { createHmac,timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../prisma/client';
import { ApiError } from '../../utils/api-error';
import {trackAppointmentEmail} from './appointment-delivery-result';

export function verifyResendWebhook(raw:Buffer,id:string,timestamp:string,signatures:string,secret:string,now=Date.now()){
 const seconds=Number(timestamp);
 if(!id||id.length>200||!/^\d+$/.test(timestamp)||!Number.isSafeInteger(seconds)||Math.abs(now/1000-seconds)>300)throw new ApiError(401,'Invalid webhook signature','INVALID_WEBHOOK_SIGNATURE');
 const key=Buffer.from(secret.replace(/^whsec_/,''),'base64');
 if(!secret.startsWith('whsec_')||key.length<16)throw new ApiError(503,'Email delivery webhook is not configured','WEBHOOK_NOT_CONFIGURED');
 const expected=createHmac('sha256',key).update(`${id}.${timestamp}.`).update(raw).digest();
 const valid=signatures.split(' ').some(signature=>{const [version,value]=signature.split(',');if(version!=='v1'||!value)return false;const received=Buffer.from(value,'base64');return received.length===expected.length&&timingSafeEqual(received,expected);});
 if(!valid)throw new ApiError(401,'Invalid webhook signature','INVALID_WEBHOOK_SIGNATURE');
}
const eventSchema=z.object({type:z.enum(['email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed']),created_at:z.iso.datetime({offset:true}),data:z.object({email_id:z.string().min(1).max(200)})});
export async function reconcileProviderDelivery(providerMessageId:string){
 const event=await prisma.emailDeliveryEvent.findFirst({where:{providerMessageId},orderBy:[{occurredAt:'desc'},{receivedAt:'desc'}]});
 if(!event)return;
 await prisma.deliveryJob.updateMany({where:{providerMessageId},data:{deliveryEvent:event.type,...(event.type==='email.delivered'?{deliveredAt:event.occurredAt}:{})}});
 if(['email.delivered','email.bounced','email.failed','email.complained','email.suppressed'].includes(event.type)){
  const job=await prisma.deliveryJob.findUnique({where:{providerMessageId},select:{payload:true}});
  if(job)await trackAppointmentEmail(job.payload,event.type==='email.delivered');
 }
}
export const resendWebhook:RequestHandler=async(request,response)=>{
 if(!env.RESEND_WEBHOOK_SECRET)throw new ApiError(503,'Email delivery webhook is not configured','WEBHOOK_NOT_CONFIGURED');
 if(!Buffer.isBuffer(request.body))throw new ApiError(400,'A raw JSON body is required','INVALID_WEBHOOK_BODY');
 const id=request.header('svix-id')??'';
 verifyResendWebhook(request.body,id,request.header('svix-timestamp')??'',request.header('svix-signature')??'',env.RESEND_WEBHOOK_SECRET);
 let parsed:unknown;try{parsed=JSON.parse(request.body.toString('utf8'));}catch{throw new ApiError(400,'Invalid webhook body','INVALID_WEBHOOK_BODY');}
 const envelope=z.object({type:z.string()}).parse(parsed);
 if(!['email.sent','email.delivered','email.delivery_delayed','email.bounced','email.complained','email.failed','email.suppressed'].includes(envelope.type)){response.status(200).json({success:true});return;}
 const payload=eventSchema.parse(parsed);
 const stored=await prisma.emailDeliveryEvent.upsert({where:{id},create:{id,providerMessageId:payload.data.email_id,type:payload.type,occurredAt:new Date(payload.created_at)},update:{}});
 await reconcileProviderDelivery(stored.providerMessageId);
 response.status(200).json({success:true});
};
