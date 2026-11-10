import request from "supertest";
import {beforeEach,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),list:vi.fn(),update:vi.fn(),history:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:mocks.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:mocks.user,update:vi.fn()}}}));
vi.mock("../src/modules/offers/offers.service",()=>({listAdminOffers:mocks.list,updateOffer:mocks.update,offerHistory:mocks.history}));
import {app} from "../src/app";
import {ApiError} from "../src/utils/api-error";
beforeEach(()=>{
 vi.clearAllMocks();mocks.auth.mockResolvedValue({data:{user:{id:"staff",email_confirmed_at:"2026-01-01"}},error:null});
 mocks.user.mockResolvedValue({id:"staff",name:"Verified Staff",role:"ADMIN",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 mocks.list.mockResolvedValue([]);mocks.history.mockResolvedValue([]);mocks.update.mockResolvedValue({code:"FIRST_ORDER",percentage:8,version:2});
});
it("requires authentication for list, edits and history",async()=>{
 for(const method of ["get","patch"] as const){expect((await request(app)[method]("/api/v1/offers"+(method==="patch"?"/FIRST_ORDER":""))).status).toBe(401);}
 expect((await request(app).get("/api/v1/offers/FIRST_ORDER/history")).status).toBe(401);
});
it.each(["ADMIN","EMPLOYEE"])("allows verified %s to read and edit",async role=>{
 mocks.user.mockResolvedValue({id:"staff",name:"Verified Staff",role,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).get("/api/v1/offers").set("Authorization","Bearer test")).status).toBe(200);
 expect((await request(app).patch("/api/v1/offers/FIRST_ORDER").set("Authorization","Bearer test").send({version:1,percentage:8})).status).toBe(200);
 expect(mocks.update).toHaveBeenCalledWith("FIRST_ORDER",{version:1,percentage:8},{id:"staff",name:"Verified Staff"});
});
it("rejects customers even with client supplied role/creator values",async()=>{
 mocks.user.mockResolvedValue({id:"customer",name:"Customer",role:"CUSTOMER",isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});
 expect((await request(app).get("/api/v1/offers").set("Authorization","Bearer test")).status).toBe(403);
 expect((await request(app).patch("/api/v1/offers/FIRST_ORDER").set("Authorization","Bearer test").send({role:"ADMIN",version:1,percentage:8})).status).toBe(403);
 expect(mocks.update).not.toHaveBeenCalled();
});
it.each([{percentage:"8"},{percentage:0},{percentage:101},{percentage:8.001},{enabled:"false"},{title:"Changed"},{code:"OTHER"},{updatedBy:"attacker"}])("rejects invalid or non-whitelisted body %j",async input=>{
 expect((await request(app).patch("/api/v1/offers/FIRST_ORDER").set("Authorization","Bearer test").send({version:1,...input})).status).toBe(400);
});
it("has no create/delete endpoints and returns clear edit conflict",async()=>{
 expect((await request(app).post("/api/v1/offers").set("Authorization","Bearer test").send({code:"NEW"})).status).toBe(404);
 expect((await request(app).delete("/api/v1/offers/FIRST_ORDER").set("Authorization","Bearer test")).status).toBe(404);
 mocks.update.mockRejectedValue(new ApiError(409,"Updated by another staff member","OFFER_CONFLICT"));
 expect((await request(app).patch("/api/v1/offers/FIRST_ORDER").set("Authorization","Bearer test").send({version:1,percentage:8})).status).toBe(409);
});
