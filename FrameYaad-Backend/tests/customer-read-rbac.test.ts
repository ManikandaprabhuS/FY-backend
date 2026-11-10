import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),list:vi.fn(),count:vi.fn(),read:vi.fn(),orders:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user,update:vi.fn()}}}));
vi.mock("../src/modules/customer-notifications/customer-notifications.service",()=>({listCustomerNotifications:m.list,customerUnreadCount:m.count,readCustomerNotification:m.read}));
vi.mock("../src/modules/orders/customer-order-summary",()=>({listCustomerOrderSummaries:m.orders}));
import {app} from "../src/app";
beforeEach(()=>{
 vi.clearAllMocks();m.auth.mockResolvedValue({data:{user:{id:"owner",email_confirmed_at:"2026-01-01"}},error:null});
 m.user.mockResolvedValue({id:"owner",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});m.list.mockResolvedValue({notifications:[]});m.count.mockResolvedValue(0);m.read.mockResolvedValue({unreadCount:0});m.orders.mockResolvedValue({orders:[]});
});
it.each(["/customer-notifications","/customer-notifications/unread-count","/orders/customer-summary"])("requires customer authentication for %s",async(path)=>{
 expect((await request(app).get("/api/v1"+path)).status).toBe(401);
 for(const role of ["ADMIN","EMPLOYEE"]){m.user.mockResolvedValue({id:"staff",role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});expect((await request(app).get("/api/v1"+path).set("Authorization","Bearer test")).status).toBe(403);}
});
it("never accepts another customer ID from query or body",async()=>{
 await request(app).get("/api/v1/customer-notifications?userId=other").set("Authorization","Bearer test");
 expect(m.list).toHaveBeenCalledWith("owner",expect.anything());
 const id="99999999-9999-4999-8999-999999999999";
 await request(app).patch("/api/v1/customer-notifications/"+id+"/read").set("Authorization","Bearer test").send({userId:"other"});
 expect(m.read).toHaveBeenCalledWith("owner",id);
 await request(app).get("/api/v1/orders/customer-summary?userId=other").set("Authorization","Bearer test");
 expect(m.orders).toHaveBeenCalledWith("owner",expect.anything());
});
it("validates notification IDs before querying",async()=>{
 expect((await request(app).patch("/api/v1/customer-notifications/bad/read").set("Authorization","Bearer test")).status).toBe(404);expect(m.read).not.toHaveBeenCalled();
});
