import { createHmac } from 'node:crypto';
import { describe,it,expect } from 'vitest';
import { verifyResendWebhook } from '../src/services/delivery/resend-webhook';
import { deliveryBackoffMs } from '../src/services/delivery/outbox-worker';
import { orderEmail,welcomeEmail } from '../src/services/delivery/transactional-email';
describe('durable email transport safeguards',()=>{
 it('verifies exact raw-body signatures and rejects tampering/expired replay',()=>{
  const secret='whsec_'+Buffer.from('dummy-test-signing-secret').toString('base64'),raw=Buffer.from('{"type":"email.delivered"}'),id='test-event',timestamp=String(Math.floor(Date.now()/1000));
  const signature='v1,'+createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.`).update(raw).digest('base64');
  expect(()=>verifyResendWebhook(raw,id,timestamp,signature,secret)).not.toThrow();
  expect(()=>verifyResendWebhook(Buffer.from('{}'),id,timestamp,signature,secret)).toThrow();
  expect(()=>verifyResendWebhook(raw,id,timestamp,signature,secret,Date.now()+301000)).toThrow();
 });
 it('uses bounded increasing backoff',()=>expect([1,2,3,4,5,6].map(deliveryBackoffMs)).toEqual([5000,30000,120000,600000,3600000,3600000]));
 it('welcome template escapes names and contains no second verification link',()=>{
  const message=welcomeEmail({name:'Test <Customer>',email:'test@example.invalid'});expect(message.html).toContain('Test &lt;Customer&gt;');expect(message.html).not.toContain('verifyOtp');
 });
 it.each(['PLACED','CANCELLED','SHIPPED','DELIVERED'])('uses real saved order snapshot for %s',status=>{
  const message=orderEmail({id:'dummy-order',orderNumber:'FY-DUMMY',status,createdAt:new Date(),totalPrice:900,subtotal:1000,discountAmount:100,couponTitle:'New Year',user:{name:'Test <Name>',email:'test@example.invalid'},items:[{snapshotProductName:'Test <Frame>',quantity:1,price:1000,subtotal:1000}]},status,new Date());
  expect(message.html).toContain('900.00');expect(message.html).toContain('New Year');expect(message.html).toContain('Test &lt;Frame&gt;');expect(message.html).not.toContain('trackingNumber');
 });
});
