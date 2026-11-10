import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {prisma} from "../src/prisma/client";
import {env} from "../src/config/env";
import {checkout} from "../src/modules/orders/orders.service";
import {checkoutSchema} from "../src/modules/orders/orders.schemas";
import {createAddress} from "../src/modules/addresses/addresses.service";
async function main(){
 if(env.NODE_ENV==="production"||!process.argv.includes("--run"))throw new Error("Test database only; use --run.");
 const original=await prisma.order.findMany({orderBy:{id:"asc"}});
 const marker="COD check "+randomUUID();let userId="";
 try{
  const user=await prisma.user.create({data:{name:marker,email:randomUUID()+"@example.invalid",role:"CUSTOMER",phoneNumber:"8"+Date.now().toString().slice(-9)}});userId=user.id;
  const data={addressLine:"Temporary COD test address",city:"Chennai",state:"Tamil Nadu",country:"India",postalCode:"600040",contactPerson:marker,contactNumber:"9876543210"};
  const address=await createAddress(userId,data);
  assert.equal((await createAddress(userId,data)).id,address.id,"Repeated address saves must not duplicate");
  const profile=await prisma.user.findUniqueOrThrow({where:{id:userId}});
  assert.equal(profile.addressLine,data.addressLine);assert.equal(profile.name,marker);assert.equal(profile.phoneNumber,user.phoneNumber);
  const product=await prisma.product.findFirst({where:{material:{isActive:true},variants:{some:{isActive:true,stockQuantity:{gte:1}}}},select:{productIdentifier:true,variants:{where:{isActive:true,stockQuantity:{gte:1}},take:1,select:{id:true,price:true,stockQuantity:true}}}});
  assert(product?.variants[0]);const variant=product.variants[0];
  const input={paymentMethod:"COD" as const,checkoutKey:randomUUID(),userAddressId:address.id,items:[{productIdentifier:product.productIdentifier,variantId:variant.id,quantity:1}]};
  for(const patch of [{items:[]},{paymentMethod:"CARD"},{checkoutKey:"invalid"},{items:[{...input.items[0],quantity:0}]},{items:[{...input.items[0],quantity:-1}]},{items:[{...input.items[0],quantity:1.5}]},{totalPrice:1}]){
   assert.equal(checkoutSchema.safeParse({...input,...patch}).success,false);
  }
  await assert.rejects(checkout(userId,{...input,checkoutKey:randomUUID(),items:undefined}),{code:"CART_EMPTY"});
  await assert.rejects(checkout(userId,{...input,checkoutKey:randomUUID(),userAddressId:randomUUID()}),{code:"INVALID_ORDER_ADDRESS"});
  await assert.rejects(checkout(userId,{...input,checkoutKey:randomUUID(),items:[{...input.items[0]!,quantity:variant.stockQuantity+1}]}),{code:"INSUFFICIENT_STOCK"});
  await assert.rejects(checkout(userId,{...input,checkoutKey:randomUUID(),items:[{...input.items[0]!,productIdentifier:"missing-"+randomUUID()}]}),{code:"CART_PRODUCT_UNAVAILABLE"});
  const started=performance.now();
  const results=await Promise.all([checkout(userId,input),checkout(userId,input),checkout(userId,{...input,checkoutKey:randomUUID()})]);
  assert.equal(new Set(results.map(o=>o.id)).size,1,"Concurrent retries must create one order");
  assert.equal(await prisma.order.count({where:{userId}}),1);
  assert.equal(results[0].paymentMethod,"COD");assert.equal(Number(results[0].totalPrice),Number(variant.price));
  assert.equal((await checkout(userId,input)).id,results[0].id);
  await assert.rejects(checkout(userId,{...input,remark:"changed"}),{code:"CHECKOUT_KEY_CONFLICT"});
  console.info(JSON.stringify({emptyCartRejected:true,invalidInputsRejected:true,foreignAddressRejected:true,stockEnforced:true,concurrentRequests:3,ordersCreated:1,paymentMethod:"COD",addressSynced:true,concurrentMilliseconds:Math.round(performance.now()-started)}));
 }finally{
  if(userId){
   await prisma.notification.deleteMany({where:{OR:[{userId},{message:{contains:marker}}]}});
   const orders=await prisma.order.findMany({where:{userId},select:{id:true}});
   await prisma.orderItem.deleteMany({where:{orderId:{in:orders.map(o=>o.id)}}});
   await prisma.order.deleteMany({where:{userId}});
   await prisma.user.delete({where:{id:userId}});
  }
  assert.deepEqual(await prisma.order.findMany({orderBy:{id:"asc"}}),original,"Existing orders must remain unchanged");
 }
}
void main().catch(error=>{console.error(error instanceof Error?error.message:"COD verification failed");process.exitCode=1;}).finally(()=>prisma.$disconnect());
