import {prisma} from '../src/prisma/client';
import {wakeDeliveryWorker} from '../src/services/delivery/outbox-signal';
async function main(){
 const id=process.argv[2];if(!id)throw new Error('Usage: node --import tsx scripts/retry-delivery-job.ts <job-id>');
 const job=await prisma.deliveryJob.findUniqueOrThrow({where:{id}});
 if(job.state!=='FAILED')throw new Error('Only FAILED jobs can be manually retried');
 if(job.kind==='EMAIL'&&job.firstAttemptAt&&Date.now()-job.firstAttemptAt.getTime()>23*3600000)throw new Error('Provider reconciliation is required: do not resend beyond the original idempotency window. Check Resend logs/message ID first.');
 const result=await prisma.deliveryJob.updateMany({where:{id,state:'FAILED',updatedAt:job.updatedAt},data:{state:'PENDING',attempts:0,availableAt:new Date(),lockToken:null,lockedAt:null,lastError:null}});
 if(!result.count)throw new Error('Job changed; inspect it again');
 wakeDeliveryWorker();console.log('Job queued with its original idempotency key; the running worker will pick it up.');
}
void main().catch(error=>{console.error(error instanceof Error?error.message:'Retry failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
