import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),update:vi.fn(),effects:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user,update:vi.fn()}}}));
vi.mock("../src/modules/orders/orders.service",()=>({updateOrderStatus:m.update}));
vi.mock("../src/modules/orders/order-status-effects",()=>({enqueueOrderStatusEffects:m.effects}));
import {app} from "../src/app";
const id="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
beforeEach(()=>{vi.clearAllMocks();m.auth.mockResolvedValue({data:{user:{id:"owner",email_confirmed_at:"2026-01-01"}},error:null});m.user.mockResolvedValue({id:"owner",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});m.update.mockResolvedValue({id,items:[],status:"CANCELLED",statusHistory:[{status:"CANCELLED",changedAt:new Date().toISOString(),changedBy:{id:"owner",role:"CUSTOMER"},eventId:"event"}]});});
it("requires login for flow and cancel",async()=>{
 expect((await request(app).get("/api/v1/orders/status-flow")).status).toBe(401);
 expect((await request(app).post("/api/v1/orders/"+id+"/cancel").send({})).status).toBe(401);
});
it("returns the single shared flow to authenticated customers",async()=>{
 const response=await request(app).get("/api/v1/orders/status-flow").set("Authorization","Bearer test");
 expect(response.status).toBe(200);
 const body=response.body as {data:{flow:{steps:Array<{status:string}>}}};
 expect(body.data.flow.steps.map(s=>s.status)).toEqual(["PLACED","PROCESSING","READY_TO_SHIP","SHIPPED","DELIVERED"]);
});
it("allows only customer cancellation with server-derived identity",async()=>{
 const response=await request(app).post("/api/v1/orders/"+id+"/cancel").set("Authorization","Bearer test").send({expectedStatus:"PLACED",note:"Please cancel"});
 expect(response.status).toBe(200);
 expect(m.update).toHaveBeenCalledWith(id,{status:"CANCELLED",expectedStatus:"PLACED",note:"Please cancel"},{id:"owner",role:"CUSTOMER"});
 expect(m.effects).toHaveBeenCalledWith(id,"event");
});
it("does not trust client user ID, role, status or markup on the cancel endpoint",async()=>{
 for(const body of [{userId:"other"},{role:"ADMIN"},{status:"SHIPPED"},{note:"<script>bad</script>"}])expect((await request(app).post("/api/v1/orders/"+id+"/cancel").set("Authorization","Bearer test").send(body)).status).toBe(400);
 expect(m.update).not.toHaveBeenCalled();
});
it.each(["ADMIN","EMPLOYEE"])("does not expose customer-only cancellation to %s",async role=>{
 m.user.mockResolvedValue({id:"staff",role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).post("/api/v1/orders/"+id+"/cancel").set("Authorization","Bearer test").send({})).status).toBe(403);
});
