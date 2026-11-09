import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient, type Prisma } from "@prisma/client";
import { env } from "../src/config/env";
const database = new PrismaClient({ datasourceUrl: env.NODE_ENV === "development" ? env.DIRECT_URL : env.DATABASE_URL });
const rollback = new Error("REVIEW_CHECK_ROLLBACK");
async function main() {
  if (env.NODE_ENV === "production" || !process.argv.includes("--run")) throw new Error("Use --run on a non-production database.");
  await database.$transaction(async tx => {
    const wrapped = new Proxy(database, { get(_target, key): unknown { if (key === "$transaction") return (callback: (client: Prisma.TransactionClient) => Promise<unknown>) => callback(tx); return Reflect.get(tx, key) as unknown; } });
    (globalThis as unknown as { prisma: PrismaClient }).prisma = wrapped;
    const service = await import("../src/modules/reviews/reviews.service.js");
    const { processReviewEffects } = await import("../src/modules/reviews/reviews.worker.js");
    const { reviewInputSchema } = await import("../src/modules/reviews/reviews.schemas.js");
    const purchased = await tx.order.findFirst({ where: { items: { some: { product: { material: { isActive: true }, variant: { isActive: true } } } } }, select: { userId: true, items: { where: { product: { material: { isActive: true }, variant: { isActive: true } } }, take:1, select: { product: { select: { id:true } } } } } });
    const product = purchased?.items[0]?.product ?? await tx.product.findFirst({ where: { material: { isActive:true }, variant: { isActive:true } }, select:{id:true} });
    const moderator = await tx.user.findFirst({where:{role:{in:["ADMIN","EMPLOYEE"]}},select:{id:true}});
    if (!product || !moderator) throw new Error("Product/staff fixtures are required.");
    const key = randomUUID().slice(0,8);
    const input = reviewInputSchema.parse({ name:"Integration "+key, email:key+"@example.invalid",rating:5,title:"Rollback-only test",comment:"Rollback-only guest review with original feedback "+key,website:"" });
    const guest = await service.submitReview(product.id,input,null,"integration-"+key);
    assert.equal(guest.status,"PENDING");
    await assert.rejects(service.submitReview(product.id,input,null,"integration-"+key),{code:"REVIEW_DUPLICATE"});
    const pending = await service.publicReviews(product.id,{});
    assert.equal(pending.reviews.some(row=>row.id===guest.id),false);
    await processReviewEffects(guest.id);
    const deferred = await tx.review.findUniqueOrThrow({where:{id:guest.id}});
    assert.ok(deferred.notificationId);assert.equal(deferred.verifiedPurchase,false);
    const approved = await service.moderateReview(guest.id,moderator.id,{status:"APPROVED"});
    assert.equal(approved.reviewedBy?.id,moderator.id);assert.ok(approved.reviewedAt);
    const visible = await service.publicReviews(product.id,{});
    assert.equal(visible.reviews.some(row=>row.id===guest.id),true);
    assert.equal(visible.summary!.count,pending.summary!.count+1);
    const publicItem = visible.reviews.find(row=>row.id===guest.id)!;
    assert.equal("email" in publicItem,false);assert.equal("requestIpHash" in publicItem,false);assert.equal("userId" in publicItem,false);
    await service.moderateReview(guest.id,moderator.id,{status:"REJECTED",reason:"Rollback-only moderation test"});
    assert.equal((await service.publicReviews(product.id,{})).reviews.some(row=>row.id===guest.id),false);
    if(purchased){
      const buyer = await service.submitReview(product.id,{...input,email:"buyer-"+input.email,comment:"Rollback-only logged-in buyer feedback "+key},purchased.userId,"integration-buyer-"+key);
      await processReviewEffects(buyer.id);
      assert.equal((await tx.review.findUniqueOrThrow({where:{id:buyer.id}})).verifiedPurchase,true);
      await service.deleteReview(buyer.id);
    }
    await service.deleteReview(guest.id);
    console.info(JSON.stringify({guestNonBuyerAccepted:true,pendingHidden:true,duplicateBlocked:true,approvedVisible:true,rejectedHidden:true,publicPrivacy:true,moderationAudit:true,verifiedBuyerChecked:Boolean(purchased),rollback:true}));
    throw rollback;
  },{timeout:120000,maxWait:10000});
}
main().catch(error=>{if(error!==rollback){console.error("Review integration check failed; fixture transaction rolled back. No customer data printed.");process.exitCode=1;}}).finally(()=>database.$disconnect());
