import {randomUUID} from "node:crypto";
import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),get:vi.fn(),update:vi.fn(),public:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:m.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:m.user,update:vi.fn()}}}));
vi.mock("../src/modules/home-banner/home-banner.service",async()=>{
 const actual=await vi.importActual<typeof import("../src/modules/home-banner/home-banner.service")>("../src/modules/home-banner/home-banner.service");
 return {...actual,getAdminBanner:m.get,updateHomepageBanner:m.update,publicHomepageBanner:m.public};
});
import {app} from "../src/app";
beforeEach(()=>{
 vi.clearAllMocks();const id=randomUUID();m.auth.mockResolvedValue({data:{user:{id,email_confirmed_at:"2026-01-01"}},error:null});
 m.user.mockResolvedValue({id,role:"ADMIN",name:"Staff",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 m.get.mockResolvedValue({enabled:true});m.update.mockResolvedValue({enabled:false});m.public.mockResolvedValue(null);
});
it("public responses are not cached across users",async()=>{
 const response=await request(app).get("/api/v1/home/banner");expect(response.status).toBe(200);expect(response.body).toMatchObject({data:{banner:null}});
 expect(response.headers["cache-control"]).toBe("private, no-store");expect(m.public).toHaveBeenCalledWith(undefined);
});
it.each(["ADMIN","EMPLOYEE"])("allows only verified %s staff to manage the banner",async role=>{
 m.user.mockResolvedValue({id:randomUUID(),role,name:"Staff",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).patch("/api/v1/offers/homepage-banner").set("Authorization","Bearer test").send({enabled:false})).status).toBe(200);
 expect(m.update).toHaveBeenCalledWith({enabled:false},expect.objectContaining({role}) as unknown);
});
it("rejects guests/customers and rejects non-whitelisted input",async()=>{
 expect((await request(app).patch("/api/v1/offers/homepage-banner").send({enabled:false})).status).toBe(401);
 m.user.mockResolvedValue({id:randomUUID(),role:"CUSTOMER",name:"Customer",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).patch("/api/v1/offers/homepage-banner").set("Authorization","Bearer test").send({enabled:false})).status).toBe(403);
 m.user.mockResolvedValue({id:randomUUID(),role:"ADMIN",name:"Staff",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).patch("/api/v1/offers/homepage-banner").set("Authorization","Bearer test").send({featuredOfferCode:"OTHER"})).status).toBe(400);
 expect(m.update).not.toHaveBeenCalled();
});
it("rate limits banner updates",async()=>{
 for(let i=0;i<20;i++)expect((await request(app).patch("/api/v1/offers/homepage-banner").set("Authorization","Bearer test").send({enabled:true})).status).toBe(200);
 expect((await request(app).patch("/api/v1/offers/homepage-banner").set("Authorization","Bearer test").send({enabled:true})).status).toBe(429);
});
