import { UserRole } from "@prisma/client";
import request from "supertest";
import { beforeEach, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),submit:vi.fn(),list:vi.fn(),public:vi.fn(),moderate:vi.fn(),remove:vi.fn(),export:vi.fn(),queue:vi.fn()}));
vi.mock("../src/config/supabase",()=>({supabaseAdmin:{auth:{getUser:mocks.auth}},createUserSupabaseClient:vi.fn()}));
vi.mock("../src/prisma/client",()=>({prisma:{user:{findUnique:mocks.user,update:vi.fn()}}}));
vi.mock("../src/modules/reviews/reviews.service",()=>({submitReview:mocks.submit,publicReviews:mocks.public,listAdminReviews:mocks.list,moderateReview:mocks.moderate,deleteReview:mocks.remove,exportReviews:mocks.export}));
vi.mock("../src/modules/reviews/reviews.worker",()=>({queueReviewEffects:mocks.queue}));
import {app} from "../src/app";
const id="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
let sequence=0;
const input=()=>({name:"Guest Reviewer",email:"route-"+(++sequence)+"@example.com",rating:5,title:"Great frame",comment:"The frame has a very nice clean finish.",website:""});
const role=(value:UserRole)=>{mocks.auth.mockResolvedValue({data:{user:{id:actor,email_confirmed_at:"2026-01-01",phone_confirmed_at:null}},error:null});mocks.user.mockResolvedValue({id:actor,role:value,isActive:true,isEmailVerified:true,isPhoneNumberVerified:false});};
beforeEach(()=>{vi.clearAllMocks();role(UserRole.CUSTOMER);mocks.submit.mockResolvedValue({id,productId:id,status:"PENDING"});mocks.list.mockResolvedValue({reviews:[],pagination:{page:1,total:0},summary:{}});mocks.public.mockResolvedValue({reviews:[],summary:{count:0},pagination:{total:0}});mocks.moderate.mockResolvedValue({id,status:"APPROVED"});mocks.export.mockResolvedValue({reviews:[]});});
it("accepts a guest/non-buyer with no auth and queues effects only after creating a pending review",async()=>{
 const response=await request(app).post("/api/v1/reviews/product/"+id).send(input());
 expect(response.status).toBe(201);expect(mocks.submit).toHaveBeenCalledWith(id,expect.any(Object),null,expect.any(String));expect(mocks.queue).toHaveBeenCalledWith(id);
});
it("uses a verified customer from the token, not a body identity",async()=>{
 expect((await request(app).post("/api/v1/reviews/product/"+id).set("Authorization","Bearer customer").send(input())).status).toBe(201);
 expect(mocks.submit).toHaveBeenCalledWith(id,expect.any(Object),actor,expect.any(String));
 expect((await request(app).post("/api/v1/reviews/product/"+id).send({...input(),userId:actor})).status).toBe(400);
});
it("an invalid optional session falls back to a guest instead of requiring login",async()=>{
 mocks.auth.mockResolvedValue({data:{user:null},error:{message:"expired"}});
 expect((await request(app).post("/api/v1/reviews/product/"+id).set("Authorization","Bearer expired").send(input())).status).toBe(201);
 expect(mocks.submit).toHaveBeenCalledWith(id,expect.any(Object),null,expect.any(String));
});
it("public approved-review endpoint needs no login",async()=>{expect((await request(app).get("/api/v1/reviews/product/"+id)).status).toBe(200);});
it.each([UserRole.ADMIN,UserRole.EMPLOYEE])("allows %s moderation and filtered exports with server actor ID",async value=>{
 role(value);
 expect((await request(app).get("/api/v1/reviews/admin?status=PENDING").set("Authorization","Bearer staff")).status).toBe(200);
 expect((await request(app).patch("/api/v1/reviews/admin/"+id).set("Authorization","Bearer staff").send({status:"APPROVED"})).status).toBe(200);
 expect(mocks.moderate).toHaveBeenCalledWith(id,actor,{status:"APPROVED"});
 expect((await request(app).get("/api/v1/reviews/admin/export?rating=5").set("Authorization","Bearer staff")).status).toBe(200);
});
it("rejects unauthenticated/customer staff APIs and forged moderation identity",async()=>{
 for(const path of ["/api/v1/reviews/admin","/api/v1/reviews/admin/export"]){expect((await request(app).get(path)).status).toBe(401);expect((await request(app).get(path).set("Authorization","Bearer customer")).status).toBe(403);}
 role(UserRole.ADMIN);expect((await request(app).patch("/api/v1/reviews/admin/"+id).set("Authorization","Bearer admin").send({status:"APPROVED",reviewedBy:"forged"})).status).toBe(400);
});
it.each([{name:" "},{email:"invalid"},{comment:"x"},{comment:"<script>bad</script>"},{website:"bot.example.com"}])("validates public submissions %j",async patch=>{
 expect((await request(app).post("/api/v1/reviews/product/"+id).send({...input(),...patch})).status).toBe(400);
});
