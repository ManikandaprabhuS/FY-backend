import { randomUUID } from "node:crypto";
import { prisma } from "../src/prisma/client";
import { env } from "../src/config/env";
import { reviewFingerprint } from "../src/modules/reviews/reviews.rate-limit";
import { processReviewEffects } from "../src/modules/reviews/reviews.worker";
async function main() {
  if (env.NODE_ENV === "production" || !process.argv.includes("--confirm-demo")) throw new Error("Use --confirm-demo against a non-production database.");
  const products = await prisma.product.findMany({ where: { material: { isActive: true }, variant: { isActive: true } }, select: { id: true, productName: true }, orderBy: { createdAt: "asc" }, take: 50 });
  if (!products.length) throw new Error("No active products available.");
  let created = 0;
  for (const product of products) for (const rating of [4,5]) {
    const email = "demo-" + rating + "-" + product.id + "@reviews.example.invalid";
    const comment = "[DEMO REVIEW - safe to delete] The " + product.productName + " has a clean finish and makes a lovely display for family memories.";
    const result = await prisma.review.createMany({ data: [{ id: randomUUID(), productId: product.id, email, name: rating === 4 ? "Demo Reviewer A" : "Demo Reviewer B", rating, title: "[DEMO] Frame quality feedback", comment, status: "APPROVED", verifiedPurchase: false, reviewedAt: new Date(), requestIpHash: reviewFingerprint("demo-seed"), commentHash: reviewFingerprint(comment), effectsProcessedAt: new Date() }], skipDuplicates: true });
    created += result.count;
  }
  for (const index of [1,2]) {
    const product = products[(index - 1) % products.length]!;
    const email = "demo-pending-" + index + "@reviews.example.invalid";
    const comment = "[DEMO REVIEW - pending moderation, safe to delete] I like the design of " + product.productName + " and would love to display it at home.";
    const review = await prisma.review.upsert({ where: { productId_email: { productId: product.id, email } }, update: {}, create: { productId: product.id, email, name: "Demo Pending " + index, rating: index === 1 ? 5 : 4, title: "[DEMO] Please approve or delete", comment, requestIpHash: reviewFingerprint("demo-seed"), commentHash: reviewFingerprint(comment) }, select: { id: true, status: true } });
    await processReviewEffects(review.id);
  }
  const pending = await prisma.review.count({ where: { email: { in: ["demo-pending-1@reviews.example.invalid","demo-pending-2@reviews.example.invalid"] }, status: "PENDING" } });
  console.info(JSON.stringify({ approvedDemoRowsCreated: created, productsWithDemoReviews: products.length, pendingDemoReviews: pending, note: "Demo reviews use reserved invalid email addresses; no products, orders or customer records changed." }));
}

main().catch(()=>{console.error("Demo review seeding did not complete; no private database data printed.");process.exitCode=1;}).finally(()=>prisma.$disconnect());
