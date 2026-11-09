import { Prisma } from "@prisma/client";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(()=>({ product:vi.fn(), unique:vi.fn(), count:vi.fn(), create:vi.fn(), many:vi.fn(), groups:vi.fn(), update:vi.fn(), remove:vi.fn(), order:vi.fn(), notification:vi.fn(), transaction:vi.fn() }));
vi.mock("../src/prisma/client",()=>({prisma:{ product:{findFirst:mocks.product},review:{findUnique:mocks.unique,count:mocks.count,create:mocks.create,findMany:mocks.many,groupBy:mocks.groups,update:mocks.update,delete:mocks.remove},order:{findFirst:mocks.order},notification:{create:mocks.notification},$transaction:mocks.transaction }}));
import { reviewInputSchema, moderationSchema } from "../src/modules/reviews/reviews.schemas";
import { submitReview, publicReviews, publicReviewSelect, moderateReview, deleteReview, listAdminReviews, exportReviews } from "../src/modules/reviews/reviews.service";
import { ratingSummaries, invalidateRatings } from "../src/modules/reviews/reviews.ratings";
import { processReviewEffects } from "../src/modules/reviews/reviews.worker";
const productId="11111111-1111-4111-8111-111111111111", id="22222222-2222-4222-8222-222222222222";
const input=()=>reviewInputSchema.parse({name:" Guest Reviewer ",email:" Reviewer@Example.com ",rating:5,title:"My review",comment:"A lovely frame with a carefully made finish.",website:""});
const publicRow={id,name:"Reviewer",rating:5,title:"Lovely frame",comment:"A beautifully finished frame.",verifiedPurchase:false,createdAt:new Date()};
beforeEach(()=>{
 vi.clearAllMocks();invalidateRatings(productId);
 const db={product:{findFirst:mocks.product},review:{findUnique:mocks.unique,count:mocks.count,create:mocks.create,findMany:mocks.many,groupBy:mocks.groups,update:mocks.update,delete:mocks.remove},order:{findFirst:mocks.order},notification:{create:mocks.notification}};
 mocks.transaction.mockImplementation((fn:(tx:typeof db)=>unknown)=>fn(db));
 mocks.product.mockResolvedValue({id:productId});mocks.unique.mockResolvedValue(null);mocks.count.mockResolvedValue(0);mocks.create.mockResolvedValue({id,productId,status:"PENDING"});
 mocks.many.mockResolvedValue([publicRow]);mocks.groups.mockResolvedValue([{productId,rating:5,_count:{_all:2}}]);mocks.update.mockResolvedValue({...publicRow,productId,status:"APPROVED"});mocks.notification.mockResolvedValue({id:"notice"});mocks.order.mockResolvedValue(null);
});
it("normalizes email/name and accepts guest non-buyers as pending without an order lookup",async()=>{
 const value=input();expect(value.email).toBe("reviewer@example.com");expect(value.name).toBe("Guest Reviewer");
 expect(await submitReview(productId,value,null,"127.0.0.1")).toMatchObject({status:"PENDING"});
 const query=mocks.create.mock.calls[0]?.[0] as {data:Record<string,unknown>};
 expect(query.data).toMatchObject({status:"PENDING",userId:null,email:"reviewer@example.com"});
 expect(mocks.order).not.toHaveBeenCalled();expect(mocks.notification).not.toHaveBeenCalled();
});
it("uses only the server-verified customer ID passed by the route",async()=>{
 await submitReview(productId,input(),"verified-user","127.0.0.1");
 expect((mocks.create.mock.calls[0]?.[0] as {data:{userId:string}}).data.userId).toBe("verified-user");
 expect(reviewInputSchema.safeParse({...input(),userId:"forged"}).success).toBe(false);
});
it.each([{name:" "},{email:"bad"},{rating:0},{rating:6},{rating:1.5},{comment:"x"},{comment:"<script>alert(1)</script>"},{name:"<b>Test</b>"},{website:"https://bot.invalid"}])("rejects invalid review input %j",patch=>expect(reviewInputSchema.safeParse({...input(),...patch}).success).toBe(false));
it("rejects normalized duplicates with the requested message",async()=>{
 mocks.unique.mockResolvedValue({id});await expect(submitReview(productId,input(),null,"ip")).rejects.toMatchObject({statusCode:409,message:"You have already reviewed this product."});expect(mocks.create).not.toHaveBeenCalled();
});
it("handles a concurrent database unique conflict as a duplicate",async()=>{
 mocks.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError("duplicate",{code:"P2002",clientVersion:"6"}));await expect(submitReview(productId,input(),null,"ip")).rejects.toMatchObject({code:"REVIEW_DUPLICATE"});
});
it.each([[3,0,0],[0,15,0],[0,0,1]])("limits email/IP/identical-comment spam %j",async(email,ip,repeat)=>{
 mocks.count.mockResolvedValueOnce(email).mockResolvedValueOnce(ip).mockResolvedValueOnce(repeat);
 await expect(submitReview(productId,input(),null,"ip")).rejects.toMatchObject({statusCode:429});expect(mocks.create).not.toHaveBeenCalled();
});
it("public list requests approved rows with an explicit privacy whitelist",async()=>{
 const result=await publicReviews(productId,{sort:"highest",page:2});
 const query=mocks.many.mock.calls[0]?.[0] as {where:Record<string,unknown>;select:Record<string,unknown>;skip:number};
 expect(query.where).toEqual({productId,status:"APPROVED"});expect(query.select).toEqual(publicReviewSelect);expect(query.skip).toBe(10);
 expect(JSON.stringify(result)).not.toMatch(/email|userId|requestIpHash|commentHash|reviewedBy/);
 expect(result.summary).toMatchObject({count:2,average:5});
});
it("approval/rejection/deletion invalidate approved rating caches",async()=>{
 await ratingSummaries([productId]);expect(mocks.groups).toHaveBeenCalledTimes(1);
 mocks.unique.mockResolvedValue({productId});await moderateReview(id,"admin",{status:"REJECTED",reason:"Not suitable"});
 const mutation=mocks.update.mock.calls[0]?.[0] as {where:{id:string};data:{status:string;rejectionReason:string;reviewedById:string;reviewedAt:Date}};
 expect(mutation.where).toEqual({id});expect(mutation.data).toMatchObject({status:"REJECTED",rejectionReason:"Not suitable",reviewedById:"admin"});expect(mutation.data.reviewedAt).toBeInstanceOf(Date);
 mocks.groups.mockResolvedValue([]);expect((await ratingSummaries([productId]))[productId]).toMatchObject({count:0,average:0});
 await deleteReview(id);expect(mocks.remove).toHaveBeenCalledWith({where:{id}});await ratingSummaries([productId]);expect(mocks.groups).toHaveBeenCalledTimes(3);
 expect(moderationSchema.safeParse({status:"PENDING",reviewedBy:"forged"}).success).toBe(false);
});
it.each([false,true])("purchase verification is asynchronous and informational, buyer=%s",async buyer=>{
 mocks.unique.mockResolvedValue({id,name:"Guest",email:"guest@example.com",rating:4,userId:buyer?"customer":null,effectsProcessedAt:null,product:{id:productId,productName:"Frame",productIdentifier:"FRAME"}});
 mocks.order.mockResolvedValue(buyer?{id:"order"}:null);await processReviewEffects(id);
 const update=mocks.update.mock.calls[0]?.[0] as {data:{verifiedPurchase:boolean;notificationId:string;effectsProcessedAt:Date}};
 expect(update.data.verifiedPurchase).toBe(buyer);expect(update.data.notificationId).toBe("notice");
 expect(mocks.notification).toHaveBeenCalledWith({data:{userId:null,type:"INFO",title:"New product review",message:"New review from Guest for Frame (4 stars)"},select:{id:true}});
});
it("uses the same combined filters for staff table and export",async()=>{
 mocks.groups.mockResolvedValue([{status:"PENDING",_count:{_all:1},_avg:{rating:4}}]);
 const filters={status:"PENDING",rating:"4",search:"Reviewer",productId,dateFilter:"30"};
 await listAdminReviews(filters);const first=(mocks.many.mock.calls[0]?.[0] as {where:unknown}).where;
 await exportReviews(filters);expect((mocks.many.mock.calls[1]?.[0] as {where:unknown}).where).toEqual(first);
});
