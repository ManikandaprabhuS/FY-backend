import { randomUUID } from 'node:crypto';
import { Prisma, type DeliveryJob } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../prisma/client';
import { env } from '../../config/env';
import { logger } from '../../config/logger';
import { sendEmail,EmailDeliveryError } from '../email.service';
import { processDeliveryEvent } from './outbox-events';
import { setDeliveryWake } from './outbox-signal';
import {reconcileProviderDelivery} from './resend-webhook';
import {trackAppointmentEmail} from './appointment-delivery-result';

export const deliveryBackoffMs=(attempt:number)=>[5000,30000,120000,600000,3600000][Math.min(Math.max(attempt-1,0),4)]!;
const emailPayload=z.object({message:z.object({to:z.email(),subject:z.string().min(1),html:z.string().min(1),text:z.string().optional(),from:z.string().optional()}),appointmentId:z.string().optional(),appointmentStatus:z.string().optional(),bookingDate:z.string().optional(),parentId:z.string().optional()});
const leaseMs=120000,maxAttempts=6,providerWindowMs=23*60*60*1000;
let running=false,stopped=true,workerFailures=0,timer:ReturnType<typeof setTimeout>|undefined;
export async function claimDeliveryJob(allowEmail=env.EMAIL_OUTBOX_DELIVERY_ENABLED,jobId?:string):Promise<DeliveryJob|undefined>{
 const token=randomUUID();
 const rows=await prisma.$queryRaw<DeliveryJob[]>(Prisma.sql`
 WITH candidate AS (
 SELECT id FROM public.delivery_jobs
 WHERE (state='PENDING' AND "availableAt"<=now() OR state='PROCESSING' AND "lockedAt"<now()-(${leaseMs}::text||' milliseconds')::interval)
 AND (${allowEmail} OR kind<>'EMAIL')
 AND (${jobId??null}::text IS NULL OR id=${jobId??null})
 ORDER BY sequence FOR UPDATE SKIP LOCKED LIMIT 1
 ) UPDATE public.delivery_jobs j SET state='PROCESSING',attempts=attempts+1,"lockedAt"=now(),"lockToken"=${token},"firstAttemptAt"=COALESCE("firstAttemptAt",now()),"updatedAt"=now()
 FROM candidate WHERE j.id=candidate.id RETURNING j.*`);
 return rows[0];
}
export async function runDeliveryJob(job:DeliveryJob,transport=sendEmail){
 const where={id:job.id,lockToken:job.lockToken,state:'PROCESSING' as const};
 try{
  if(job.attempts>maxAttempts)throw new Error('RETRY_EXHAUSTED');
  if(job.kind==='EMAIL'){
   if(job.firstAttemptAt&&Date.now()-job.firstAttemptAt.getTime()>providerWindowMs)throw new Error('PROVIDER_RECONCILIATION_REQUIRED');
   const payload=emailPayload.parse(job.payload);
   if(!payload.message.from&&env.EMAIL_FROM){
    payload.message.from=env.EMAIL_FROM;
    const frozen=await prisma.deliveryJob.updateMany({where,data:{payload}});
    if(!frozen.count)return;
   }
   const result=await transport(payload.message,job.idempotencyKey);
   const updated=await prisma.deliveryJob.updateMany({where,data:{state:'SENT',providerMessageId:result.id,lastError:null,lockedAt:null,lockToken:null}});
   if(updated.count){
    await trackAppointmentEmail(job.payload,true).catch(()=>logger.warn({deliveryJobId:job.id},'Accepted email saved; appointment status tracking needs reconciliation'));
    await reconcileProviderDelivery(result.id).catch(()=>logger.warn({deliveryJobId:job.id},'Accepted email saved; delivery event reconciliation will retry on webhook'));
   }
  }else{
   await processDeliveryEvent(job);await prisma.deliveryJob.updateMany({where,data:{state:'SENT',lastError:null,lockedAt:null,lockToken:null}});
  }
  logger.info({deliveryJobId:job.id,kind:job.kind},'Delivery job processed (email acceptance is not inbox delivery)');
 }catch(error){
  const reconcile=error instanceof Error&&error.message==='PROVIDER_RECONCILIATION_REQUIRED';
  const failed=job.attempts>=maxAttempts||reconcile||error instanceof z.ZodError;
  const code=reconcile?'PROVIDER_RECONCILIATION_REQUIRED':error instanceof z.ZodError?'INVALID_JOB_PAYLOAD':error instanceof EmailDeliveryError&&error.providerStatus?'RESEND_'+error.providerStatus:error instanceof Error?error.name:'DELIVERY_FAILED';
  await prisma.deliveryJob.updateMany({where,data:{state:failed?'FAILED':'PENDING',availableAt:new Date(Date.now()+deliveryBackoffMs(job.attempts)),lastError:code,lockedAt:null,lockToken:null}});
  if(job.kind==='EMAIL')await trackAppointmentEmail(job.payload,false).catch(()=>undefined);
  logger.warn({deliveryJobId:job.id,kind:job.kind,attempt:job.attempts,failed,errorType:code},'Delivery job will retry or needs investigation');
 }
}
async function tick(){
 if(stopped||running)return;running=true;
 try{for(let i=0;i<20&&!stopped;i++){const job=await claimDeliveryJob();if(!job)break;await runDeliveryJob(job);}workerFailures=0;}
 catch(error){workerFailures++;logger.error({errorType:error instanceof Error?error.name:'OutboxError'},'Delivery worker failed; persisted jobs remain available');}
 finally{running=false;if(!stopped)timer=setTimeout(()=>void tick(),workerFailures?Math.min(60000,5000*2**Math.min(workerFailures-1,4)):5000);timer?.unref();}
}
export function startDeliveryWorker(){
 if(!stopped)return ()=>undefined;stopped=false;
 setDeliveryWake(()=>{if(!running&&!stopped){clearTimeout(timer);void tick();}});void tick();
 return()=>{stopped=true;clearTimeout(timer);setDeliveryWake(undefined);};
}
