import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { prisma } from "../src/prisma/client";
import { env } from "../src/config/env";
import { checkout } from "../src/modules/orders/orders.service";
import { eligibleOffers,hasOrderHistory } from "../src/modules/checkout/checkout.service";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--run"))throw new Error("Use --run on test only.");
 const marker="Offer check "+randomUUID(),ids:string[]=[];
 const before=await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}});
 try{
  const product=await prisma.product.findFirst({where:{material:{isActive:true},variants:{some:{isActive:true,stockQuantity:{gte:1}}}},select:{productIdentifier:true,variants:{where:{isActive:true,stockQuantity:{gte:1}},select:{id:true,price:true},take:1}}});
  assert(product?.variants[0],"Need an existing available product");
  const phone="8"+Date.now().toString().slice(-9),addresses:string[]=[];
  for(let i=0;i<2;i++){
   const user=await prisma.user.create({data:{name:marker,email:randomUUID()+"@example.invalid",phoneNumber:i?"+91 "+phone:phone,role:"CUSTOMER"},select:{id:true}});ids.push(user.id);
   const id=randomUUID();
   await prisma.$executeRaw`INSERT INTO public.user_address (id,"userId","addressLine","postCode",city,state,country,"contactPerson","contactNumber","updatedAt") VALUES (${id},${user.id},'Temporary test address','600040','Chennai','Tamil Nadu','India',${marker},${phone},NOW())`;
   addresses.push(id);
  }
  const first=(await eligibleOffers(prisma,ids[0]!,6000)).offers.find(o=>o.code==="FIRST_ORDER");
  assert(first,"Enable FIRST_ORDER before running this explicit test");
  const items=[{productIdentifier:product.productIdentifier,variantId:product.variants[0].id,quantity:1}];
  const targets=process.argv.includes("--same-user")?[0,0]:[0,1]; const outcomes=await Promise.allSettled(targets.map(i=>checkout(ids[i]!,{userAddressId:addresses[i]!,paymentMethod:"COD",checkoutKey:randomUUID(),items,couponCode:"FIRST_ORDER",couponVersion:first.version})));
  console.info(JSON.stringify({outcomes:outcomes.map(o=>{if(o.status==="fulfilled")return {status:o.status};const e:unknown=o.reason;return {status:o.status,code:e&&typeof e==="object"&&"code" in e?e.code:"unknown",message:e instanceof Error?e.message.slice(-500):"unknown"};})}));
  assert.equal(outcomes.filter(o=>o.status==="fulfilled").length,1,"Exactly one first-order checkout must succeed for shared phone");
  const rejected=outcomes.find(o=>o.status==="rejected");
  const reason:unknown=rejected?.status==="rejected"?rejected.reason:undefined;
  assert(reason&&typeof reason==="object"&&"code" in reason&&reason.code==="OFFER_UNAVAILABLE","Other checkout must receive clear offer error");
  const winner=outcomes.find(o=>o.status==="fulfilled");assert(winner?.status==="fulfilled");
  assert.equal(Number(winner.value.totalPrice),Number(product.variants[0].price.mul(1-first.percent/100).toDecimalPlaces(2)));
  assert.equal(winner.value.couponCode,"FIRST_ORDER");
  const user=await prisma.user.findUniqueOrThrow({where:{id:winner.value.userId},select:{email:true}});
  assert(await hasOrderHistory(prisma,user.email,"0000000000"));
  assert(await hasOrderHistory(prisma,"unknown@example.invalid",phone));
  await prisma.order.update({where:{id:winner.value.id},data:{status:"CANCELLED"}});
  assert(await hasOrderHistory(prisma,user.email,phone));
  const samples:number[]=[];
  for(let i=0;i<5;i++){const start=performance.now();await hasOrderHistory(prisma,user.email,phone);samples.push(Math.round(performance.now()-start));}
  console.info(JSON.stringify({firstOrderRace:"one success, one OFFER_UNAVAILABLE",emailOnly:true,phoneOnly:true,cancelledCounts:true,serverPrice:true,historyMs:samples}));
 }finally{
  await prisma.$transaction(async tx=>{
   await tx.notification.deleteMany({where:{OR:[{userId:{in:ids}},{message:{contains:marker}}]}});
   await tx.orderItem.deleteMany({where:{order:{userId:{in:ids}}}});
   await tx.order.deleteMany({where:{userId:{in:ids}}});
   await tx.user.deleteMany({where:{id:{in:ids}}});
  },{timeout:15000});
  assert.deepEqual(await prisma.order.aggregate({_count:true,_sum:{totalPrice:true}}),before);
  console.info(JSON.stringify({fixtureCleanup:true,existingOrdersUnchanged:true}));
 }
}
void main().catch((error:unknown)=>{console.error(error instanceof Error?error.message:"Offer check failed");process.exitCode=1;}).finally(()=>prisma.$disconnect());
