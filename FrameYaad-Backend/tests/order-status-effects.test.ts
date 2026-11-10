import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({find:vi.fn(),upsert:vi.fn(),send:vi.fn(),configured:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{order:{findUnique:m.find},customerNotification:{upsert:m.upsert}}}));
vi.mock("../src/services/email.service",()=>({assertEmailConfigured:m.configured,sendEmail:m.send}));
import {processOrderStatusEffects,enqueueOrderStatusEffects} from "../src/modules/orders/order-status-effects";
beforeEach(()=>{vi.clearAllMocks();m.find.mockResolvedValue({id:"order",orderNumber:"FY-1234",userId:"owner",user:{email:"test@example.invalid"},statusHistory:[{status:"SHIPPED",changedAt:"2026-11-10",changedBy:{id:"staff",role:"ADMIN"},eventId:"event"}]});m.upsert.mockResolvedValue({id:"event"});m.send.mockResolvedValue({id:"mail"});});
it("creates an idempotent owner notification without sending email",async()=>{
 await processOrderStatusEffects("order","event");
 expect(m.upsert).toHaveBeenCalledWith({where:{id:"event"},create:{id:"event",userId:"owner",orderId:"order",title:"Order status updated",message:"Your order FY-1234 is now Shipped.",type:"ORDER_STATUS",createdAt:new Date("2026-11-10")},update:{}});
 expect(m.send).not.toHaveBeenCalled();
});
it("skips email if no transport is configured, without losing the notification",async()=>{
 m.configured.mockImplementation(()=>{throw new Error("Not configured");});
 await processOrderStatusEffects("order","event");expect(m.upsert).toHaveBeenCalled();expect(m.send).not.toHaveBeenCalled();
});
it("does nothing for missing events",async()=>{
 await processOrderStatusEffects("order","unknown");expect(m.upsert).not.toHaveBeenCalled();
});
it("notification failures stay in the background and exhaust bounded retries without throwing",async()=>{
 vi.useFakeTimers();
 try{
  m.upsert.mockRejectedValue(new Error("Forced notification failure"));
  expect(()=>enqueueOrderStatusEffects("order","event")).not.toThrow();
  await vi.runAllTimersAsync();
  expect(m.upsert).toHaveBeenCalledTimes(3);expect(m.send).not.toHaveBeenCalled();
 }finally{vi.useRealTimers();}
});
