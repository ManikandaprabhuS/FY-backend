import {beforeEach,expect,it,vi} from 'vitest';
import type {DeliveryJob} from '@prisma/client';
const m=vi.hoisted(()=>({update:vi.fn(),event:vi.fn(),process:vi.fn()}));
vi.mock('../src/prisma/client',()=>({prisma:{deliveryJob:{updateMany:m.update},emailDeliveryEvent:{findFirst:m.event}}}));
vi.mock('../src/services/delivery/outbox-events',()=>({processDeliveryEvent:m.process}));
import {runDeliveryJob} from '../src/services/delivery/outbox-worker';
const job=(fields:Partial<DeliveryJob>={}):DeliveryJob=>({id:'test-job',sequence:1n,idempotencyKey:'dummy:email:one',kind:'EMAIL',payload:{message:{to:'test@example.invalid',subject:'Dummy',html:'Dummy'}},state:'PROCESSING',attempts:1,availableAt:new Date(),lockedAt:new Date(),lockToken:'lease',firstAttemptAt:new Date(),providerMessageId:null,lastError:null,deliveryEvent:null,deliveredAt:null,createdAt:new Date(),updatedAt:new Date(),...fields});
beforeEach(()=>{vi.resetAllMocks();m.update.mockResolvedValue({count:1});m.event.mockResolvedValue(null);});
it('retains a failed request for backoff without deleting business data',async()=>{
 const send=vi.fn().mockRejectedValue(new Error('Simulated outage'));await runDeliveryJob(job(),send);
 expect(m.update.mock.calls.at(-1)?.[0] as unknown).toMatchObject({where:{id:'test-job',lockToken:'lease',state:'PROCESSING'},data:{state:'PENDING',lastError:'Error'}});
});
it('retains exhausted jobs as FAILED for investigation',async()=>{
 await runDeliveryJob(job({attempts:6}),vi.fn().mockRejectedValue(new Error('Simulated outage')));
 expect(m.update.mock.calls.at(-1)?.[0] as unknown).toMatchObject({data:{state:'FAILED'}});
});
it('does not resend an ambiguous job beyond the provider dedupe window',async()=>{
 const send=vi.fn();await runDeliveryJob(job({firstAttemptAt:new Date(Date.now()-24*3600000)}),send);
 expect(send).not.toHaveBeenCalled();expect(m.update.mock.calls.at(-1)?.[0] as unknown).toMatchObject({data:{state:'FAILED',lastError:'PROVIDER_RECONCILIATION_REQUIRED'}});
});
it('passes a stable provider idempotency key and saves acceptance separately from delivery',async()=>{
 const send=vi.fn().mockResolvedValue({id:'provider-id'});await runDeliveryJob(job(),send);
 expect(send).toHaveBeenCalledWith(expect.objectContaining({subject:'Dummy'}),'dummy:email:one');
 expect(m.update.mock.calls.at(-1)?.[0] as unknown).toMatchObject({data:{state:'SENT',providerMessageId:'provider-id'}});
 expect(m.event).toHaveBeenCalledWith(expect.objectContaining({where:{providerMessageId:'provider-id'}}));
});
