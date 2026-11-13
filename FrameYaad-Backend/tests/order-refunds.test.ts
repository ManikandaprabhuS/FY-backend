import {Prisma,UserRole} from "@prisma/client";
import {beforeEach,expect,it,vi} from "vitest";
import request from "supertest";
const m=vi.hoisted(()=>({transaction:vi.fn(),find:vi.fn(),first:vi.fn(),update:vi.fn(),profile:vi.fn(),auth:vi.fn(),staff:vi.fn(),customer:vi.fn(),list:vi.fn(),groups:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{
 $transaction:m.transaction,user:{findUnique:m.profile},order:{findUnique:m.find},
 notification:{upsert:m.staff,findMany:m.list,groupBy:m.groups},customerNotification:{upsert:m.customer}
}}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth}},createUserSupabaseClient:vi.fn()}));
import {app} from "../src/app";
import {updateRefund,enqueueRefundNotification,refundMessage} from "../src/modules/orders/order-refunds";
import {updateOrderStatus} from "../src/modules/orders/orders.service";
import {processOrderStatusEffects} from "../src/modules/orders/order-status-effects";
import {revenueSummary,revenueWhere} from "../src/modules/orders/revenue";
import {updateRefundSchema} from "../src/modules/orders/orders.schemas";
const id="11111111-1111-4111-8111-111111111111",owner="22222222-2222-4222-8222-222222222222";
const admin={id:"33333333-3333-4333-8333-333333333333",role:UserRole.ADMIN};
let order:Record<string,unknown>;
beforeEach(()=>{
 vi.clearAllMocks();
 order={id,userId:owner,orderNumber:"FY-1234",status:"CANCELLED",statusHistory:[],cancelledBy:"admin",refundStatus:null,refundHistory:null,totalPrice:new Prisma.Decimal(1300),createdAt:new Date(),user:{name:"Customer",email:"test@example.invalid"},items:[],userAddress:{},couponId:null,couponTitle:null};
 m.find.mockImplementation(()=>Promise.resolve({...order}));
 m.first.mockImplementation(({where}:{where:{userId?:string}})=>Promise.resolve(!where.userId||where.userId===order.userId?{...order}:null));
 m.update.mockImplementation(({where,data}:{where:{status:string;refundStatus?:string|null};data:Record<string,unknown>})=>{
  if(where.status!==order.status||("refundStatus" in where&&where.refundStatus!==order.refundStatus))return Promise.resolve({count:0});
  Object.assign(order,data);return Promise.resolve({count:1});
 });
 m.transaction.mockImplementation((fn:(tx:unknown)=>unknown)=>fn({order:{findUnique:m.find,findFirst:m.first,findUniqueOrThrow:m.find,updateMany:m.update}}));
 m.staff.mockResolvedValue({});m.customer.mockResolvedValue({});
 m.profile.mockResolvedValue({...admin,name:"Admin Name",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 m.auth.mockResolvedValue({data:{user:{id:admin.id,email_confirmed_at:"2026-01-01"}},error:null});
 m.list.mockResolvedValue([]);m.groups.mockResolvedValue([]);
});
it("revenue, count and average exclude cancelled orders without altering their amount",()=>{
 const rows=[{status:"PLACED",totalPrice:new Prisma.Decimal(500)},{status:"CANCELLED",totalPrice:new Prisma.Decimal(1300)},{status:"DELIVERED",totalPrice:new Prisma.Decimal(700)}];
 expect(revenueSummary(rows)).toEqual({totalRevenue:1200,orderCount:2,averageOrderValue:600});
 expect(revenueSummary([])).toEqual({totalRevenue:0,orderCount:0,averageOrderValue:0});
 expect(revenueWhere).toEqual({status:{not:"CANCELLED"}});
 expect(rows[1]!.totalPrice.toNumber()).toBe(1300);
});
it("saves forward-only refund timestamps and server actor audit",async()=>{
 await updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},admin);
 expect(order).toMatchObject({refundStatus:"INITIATED",refundUpdatedBy:admin.id});expect(order.refundInitiatedAt).toBeInstanceOf(Date);
 await updateRefund(id,{status:"COMPLETED",expectedRefundStatus:"INITIATED",confirmCompleted:true},admin);
 expect(order).toMatchObject({refundStatus:"COMPLETED"});expect(order.refundCompletedAt).toBeInstanceOf(Date);
 expect(order.refundHistory).toHaveLength(2);
 expect(order.totalPrice).toEqual(new Prisma.Decimal(1300));
});
it("requires explicit confirmation for direct completion",async()=>{
 await expect(updateRefund(id,{status:"COMPLETED",expectedRefundStatus:null},admin)).rejects.toMatchObject({statusCode:400});
 await updateRefund(id,{status:"COMPLETED",expectedRefundStatus:null,confirmCompleted:true},admin);
 expect(order.refundStatus).toBe("COMPLETED");
});
it("repeating the same refund is idempotent and does not append history",async()=>{
 await updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},admin);
 await updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},admin);
 expect(order.refundHistory).toHaveLength(1);expect(m.update).toHaveBeenCalledTimes(1);
});
it("rejects completed to initiated, non-cancelled orders and customer callers",async()=>{
 order.refundStatus="COMPLETED";
 await expect(updateRefund(id,{status:"INITIATED",expectedRefundStatus:"COMPLETED"},admin)).rejects.toMatchObject({statusCode:400});
 order.status="PROCESSING";
 await expect(updateRefund(id,{status:"INITIATED",expectedRefundStatus:"COMPLETED"},admin)).rejects.toMatchObject({statusCode:400});
 await expect(updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},{id:owner,role:UserRole.CUSTOMER})).rejects.toMatchObject({statusCode:403});
});
it("only one concurrent refund compare-and-set succeeds",async()=>{
 const result=await Promise.allSettled([
  updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},admin),
  updateRefund(id,{status:"COMPLETED",expectedRefundStatus:null,confirmCompleted:true},admin)
 ]);
 expect(result.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(order.refundHistory).toHaveLength(1);
});
it.each([UserRole.CUSTOMER,UserRole.ADMIN,UserRole.EMPLOYEE])("cancels once as %s and saves metadata without duplicate audit",async role=>{
 order.status="PLACED";
 const actor={id:role===UserRole.CUSTOMER?owner:admin.id,role};
 await updateOrderStatus(id,{status:"CANCELLED",note:"No longer needed"},actor);
 await updateOrderStatus(id,{status:"CANCELLED",expectedStatus:"PLACED"},actor);
 expect(order.cancelledBy).toBe(role===UserRole.CUSTOMER?"customer":"admin");expect(order.cancelledAt).toBeInstanceOf(Date);
 expect(order.cancellationReason).toBe("No longer needed");expect(order.statusHistory).toHaveLength(1);
});
it.each(["CUSTOMER","ADMIN"])("sends customer and staff cancellation messages for %s",async role=>{
 order.statusHistory=[{status:"CANCELLED",eventId:"event",changedAt:"2026-11-13T12:00:00Z",changedBy:{id:admin.id,role}}];
 await processOrderStatusEffects(id,"event");
 const staffCall=m.staff.mock.calls[0]?.[0] as {where:{id:string};create:{type:string;userId:null;title:string;message:string}};
 expect(staffCall.where.id).toBe("event");expect(staffCall.create).toMatchObject({type:"ORDER_CANCELLED",userId:null,title:"Order cancelled"});
 expect(staffCall.create.message).toContain("Rs. 1300.00");
 const text=staffCall.create.message;
 expect(text).toContain("FY-1234");expect(text).toContain("Customer");if(role==="ADMIN")expect(text).toContain("Admin Name");
 if(role==="ADMIN")expect((m.customer.mock.calls[0]?.[0] as {create:{message:string}}).create.message).toBe("Your order FY-1234 has been cancelled by FrameYaad.");
});
it("refund notifications reuse their event id and failures cannot fail the update",async()=>{
 vi.useFakeTimers();
 try{
  await updateRefund(id,{status:"INITIATED",expectedRefundStatus:null},admin);
  enqueueRefundNotification(order as Parameters<typeof enqueueRefundNotification>[0]);await vi.runAllTimersAsync();
  const first=(m.customer.mock.calls[0]?.[0] as {where:{id:string}}).where.id;
  enqueueRefundNotification(order as Parameters<typeof enqueueRefundNotification>[0]);await vi.runAllTimersAsync();
  expect((m.customer.mock.calls[1]?.[0] as {where:{id:string}}).where.id).toBe(first);
  m.customer.mockRejectedValue(new Error("offline"));
  expect(()=>enqueueRefundNotification(order as Parameters<typeof enqueueRefundNotification>[0])).not.toThrow();await vi.runAllTimersAsync();
 }finally{vi.useRealTimers();}
});
it.each([["admin",null,"Your order was cancelled by FrameYaad."],["admin","INITIATED","Your order was cancelled by FrameYaad and your refund has been initiated. You will be getting your money back."],["customer","INITIATED","Your cancellation is confirmed and your refund has been initiated. You will be getting your money back."],["customer","COMPLETED","Your refund is completed. Please check your respective bank account."]])("formats %s/%s customer message", (by,status,message)=>expect(refundMessage(by??null,status??null)).toBe(message));
it("rejects guest/customer refund API requests and rejects untrusted extra fields",async()=>{
 expect((await request(app).patch("/api/v1/orders/"+id+"/refund").send({status:"INITIATED",expectedRefundStatus:null})).status).toBe(401);
 m.profile.mockResolvedValue({id:owner,role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).patch("/api/v1/orders/"+id+"/refund").set("Authorization","Bearer test").send({status:"INITIATED",expectedRefundStatus:null})).status).toBe(403);
 expect(updateRefundSchema.safeParse({status:"INITIATED",expectedRefundStatus:null,role:"ADMIN"}).success).toBe(false);
});
it("a customer never receives the shared staff notification audience",async()=>{
 m.profile.mockResolvedValue({id:owner,role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 const res=await request(app).get("/api/v1/notifications").set("Authorization","Bearer test");
 expect(res.status).toBe(200);expect((m.list.mock.calls[0]?.[0] as {where:{userId:string}}).where).toMatchObject({userId:owner});
});

it.each([UserRole.ADMIN,UserRole.EMPLOYEE])("allows %s refund updates through the authenticated API",async role=>{
 m.profile.mockResolvedValue({id:admin.id,role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 const res=await request(app).patch("/api/v1/orders/"+id+"/refund").set("Authorization","Bearer test").send({status:"INITIATED",expectedRefundStatus:null});
 expect(res.status).toBe(200);expect((res.body as {data:{order:{refundStatus:string}}}).data.order.refundStatus).toBe("INITIATED");
});
it("rejects guest and customer revenue reports",async()=>{
 expect((await request(app).get("/api/v1/orders/revenue?from=2026-01-01&to=2026-12-31")).status).toBe(401);
 m.profile.mockResolvedValue({id:owner,role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).get("/api/v1/orders/revenue?from=2026-01-01&to=2026-12-31").set("Authorization","Bearer test")).status).toBe(403);
});
