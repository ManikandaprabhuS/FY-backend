import request from "supertest";
import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({getUser:vi.fn(),find:vi.fn(),offers:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:mocks.getUser}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:mocks.find,update:vi.fn()}}}));
vi.mock("../src/modules/checkout/checkout.service",()=>({getCheckoutOffers:mocks.offers}));
import { app } from "../src/app";
beforeEach(()=>{vi.clearAllMocks();mocks.getUser.mockResolvedValue({data:{user:{id:"user",email_confirmed_at:"2026-01-01"}},error:null});mocks.find.mockResolvedValue({id:"user",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});mocks.offers.mockResolvedValue({offers:[],subtotal:2000,addresses:[]});});
it("requires login for both offers endpoints",async()=>{
 expect((await request(app).get("/api/v1/checkout/offers")).status).toBe(401);
 expect((await request(app).post("/api/v1/checkout/offers").send({items:[]})).status).toBe(401);
 expect(mocks.offers).not.toHaveBeenCalled();
});
it.each(["ADMIN","EMPLOYEE"])("does not let %s claim customer offers",async role=>{
 mocks.find.mockResolvedValue({id:"user",role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).get("/api/v1/checkout/offers").set("Authorization","Bearer test")).status).toBe(403);
});
it("derives the customer ID from verified authentication",async()=>{
 const result=await request(app).get("/api/v1/checkout/offers").set("Authorization","Bearer test");
 expect(result.status).toBe(200);expect(mocks.offers).toHaveBeenCalledWith("user",undefined,false);
});
it("summary derives ownership from auth and batches the supplied selection",async()=>{
 const result=await request(app).post("/api/v1/checkout/summary").set("Authorization","Bearer test").send({items:[{productIdentifier:"FRAME",variantId:"99999999-9999-4999-8999-999999999999",quantity:1}]});
 expect(result.status).toBe(200);expect(mocks.offers).toHaveBeenCalledWith("user",expect.any(Array),true);
 expect((await request(app).get("/api/v1/checkout/summary")).status).toBe(401);
});
it("validates selection input and returns 404 for old coupon APIs",async()=>{
 expect((await request(app).post("/api/v1/checkout/offers").set("Authorization","Bearer test").send({items:[{productIdentifier:"P",variantId:"bad",quantity:-1}]})).status).toBe(400);
 expect((await request(app).get("/api/v1/coupons")).status).toBe(404);
 expect((await request(app).get("/api/v1/product-discounts")).status).toBe(404);
});
